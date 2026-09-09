/**
 * WebMCP: reading the tools a page registered, and calling them.
 *
 * WebMCP lets a site declare what it can do — `search_catalog`, `update_cart` —
 * instead of leaving an agent to read the DOM and synthesise clicks. Shopify
 * registers ten such tools on every Liquid storefront, with no work by the
 * merchant.
 *
 * Three shapes here were found by running this against a live storefront, not
 * by reading the specification. Each one fails silently if you get it wrong:
 *
 *   1. `inputSchema` arrives as a serialised JSON *string*, not an object.
 *   2. `executeTool` takes its arguments as a JSON *string*, not an object.
 *   3. Results come back in the MCP envelope
 *      `{content: [{type: 'text', text}]}`, usually as a JSON string.
 *
 * @see https://developer.chrome.com/docs/ai/webmcp
 * @see https://shopify.dev/docs/api/web-mcp
 */

import { BaseTool } from '@google/adk';
import type { RunAsyncToolRequest } from '@google/adk';

/** Hints a page attaches to a tool to guide an agent's caution. */
export interface WebMcpAnnotations {
  /** The tool changes no state, so it needs no confirmation. */
  readOnlyHint?: boolean;
  /** The tool returns third-party content, which is data and never orders. */
  untrustedContentHint?: boolean;
}

/** A tool descriptor, as `modelContext.getTools()` returns it. */
export interface WebMcpDescriptor {
  name: string;
  description?: string;
  inputSchema?: string | Record<string, unknown>;
  annotations?: WebMcpAnnotations;
  origin?: string;
  title?: string;
}

/**
 * The subset of `document.modelContext` this app uses.
 *
 * Declared structurally so the same code runs against three things: the real
 * page API, the messaging proxy the extension uses to reach a storefront from
 * the side panel, and a test double.
 */
export interface WebMcpBridge {
  getTools(options?: { fromOrigins?: string[] }): Promise<WebMcpDescriptor[]>;
  executeTool(
    tool: WebMcpDescriptor,
    args: string,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
  addEventListener?(type: 'toolchange', listener: () => void): void;
  removeEventListener?(type: 'toolchange', listener: () => void): void;
}

/** Returns this document's model context, if the browser exposes one. */
export function getPageBridge(): WebMcpBridge | undefined {
  const doc = (globalThis as { document?: { modelContext?: WebMcpBridge } })
    .document;
  return doc?.modelContext;
}

/**
 * Parses a descriptor's argument schema.
 *
 * Chrome returns `inputSchema` as a string. Passing that through unparsed
 * yields a tool the model cannot call, and nothing reports an error.
 */
export function parseInputSchema(
  descriptor: WebMcpDescriptor,
): Record<string, unknown> {
  const schema = descriptor.inputSchema;
  if (!schema) return { type: 'object', properties: {} };
  if (typeof schema !== 'string') return schema;
  try {
    const parsed: unknown = JSON.parse(schema);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* fall through */
  }
  return { type: 'object', properties: {} };
}

/**
 * Flattens the MCP content envelope into plain text.
 *
 * Measured on a live storefront: one `search_catalog` result went from 1711
 * characters to 648. The envelope was the majority of it. That matters because
 * the on-device model has a small context window, and every character of
 * punctuation is a character not spent on the catalogue.
 */
export function unwrapToolResult(result: unknown): unknown {
  let value: unknown = result;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return trimmed;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  if (value && typeof value === 'object' && 'content' in value) {
    const content = (value as { content: unknown }).content;
    if (Array.isArray(content)) {
      const texts = content
        .filter(
          (part): part is { type: string; text: string } =>
            !!part &&
            typeof part === 'object' &&
            (part as { type?: unknown }).type === 'text' &&
            typeof (part as { text?: unknown }).text === 'string',
        )
        .map((part) => part.text);
      if (texts.length) return texts.join('\n');
    }
  }

  return value;
}

/**
 * An ADK tool backed by a WebMCP tool the page registered.
 *
 * Execution stays in the page, in the shopper's own session, so a cart change
 * updates the cart they are looking at.
 */
export class WebMcpTool extends BaseTool {
  readonly readOnlyHint: boolean;
  readonly untrustedContentHint: boolean;
  readonly origin?: string;

  constructor(
    readonly descriptor: WebMcpDescriptor,
    private readonly bridge: WebMcpBridge,
  ) {
    super({
      name: descriptor.name,
      description: descriptor.description ?? '',
    });
    this.readOnlyHint = descriptor.annotations?.readOnlyHint ?? false;
    this.untrustedContentHint =
      descriptor.annotations?.untrustedContentHint ?? false;
    this.origin = descriptor.origin;
  }

  override _getDeclaration() {
    return {
      name: this.name,
      description: this.description,
      // WebMCP already speaks JSON Schema. Passing it straight through avoids
      // a round trip via genai's Schema shape, which would drop the anyOf and
      // the nested option arrays these tools rely on.
      parametersJsonSchema: parseInputSchema(this.descriptor),
    };
  }

  override async runAsync(request: RunAsyncToolRequest): Promise<unknown> {
    const result = await this.bridge.executeTool(
      this.descriptor,
      JSON.stringify(request.args ?? {}),
      { signal: request.toolContext?.abortSignal },
    );
    // A tool that navigates the page resolves to null by design.
    if (result === null || result === undefined) {
      return { ok: true, note: 'Done. The page moved.' };
    }
    return unwrapToolResult(result);
  }
}

/**
 * Discovers the page's tools and keeps the list fresh.
 *
 * A page's tool list is not static: a checkout flow registers and unregisters
 * tools as it advances, and announces that with a `toolchange` event.
 */
export class WebMcpCatalog {
  private cache?: WebMcpTool[];
  private listening = false;
  private readonly invalidate = () => {
    this.cache = undefined;
  };

  constructor(
    private readonly bridge: WebMcpBridge,
    private readonly fromOrigins?: string[],
  ) {}

  async tools(): Promise<WebMcpTool[]> {
    if (this.cache) return this.cache;

    const descriptors = await this.bridge.getTools(
      this.fromOrigins ? { fromOrigins: this.fromOrigins } : undefined,
    );
    this.cache = descriptors.map((d) => new WebMcpTool(d, this.bridge));

    if (!this.listening && this.bridge.addEventListener) {
      this.bridge.addEventListener('toolchange', this.invalidate);
      this.listening = true;
    }
    return this.cache;
  }

  /** Total characters a model would spend just to be told these tools exist. */
  async surfaceSize(): Promise<{ tools: number; chars: number }> {
    const tools = await this.tools();
    let chars = 0;
    for (const tool of tools) {
      chars += tool.description.length;
      chars += JSON.stringify(parseInputSchema(tool.descriptor)).length;
    }
    return { tools: tools.length, chars };
  }

  close(): void {
    if (this.listening && this.bridge.removeEventListener) {
      this.bridge.removeEventListener('toolchange', this.invalidate);
    }
    this.listening = false;
    this.cache = undefined;
  }
}

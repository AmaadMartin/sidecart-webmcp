/**
 * The bridge between a storefront and the side panel.
 *
 * WebMCP tools belong to a *document*. `document.modelContext` on a Shopify
 * storefront is reachable from that page, and from nowhere else — the side
 * panel is a different document and cannot see it. Chrome's guidance is that
 * an extension reaches WebMCP tools through a content script, which is what
 * this is.
 *
 * It does no reasoning. It reads the page's tool list, runs a tool when asked,
 * and reports when the list changes. Everything else — the model, the agent
 * loop, the confirmation gate — lives in the side panel.
 */

import type { WebMcpDescriptor } from '../core/webmcp.js';

interface PageContext {
  getTools(options?: { fromOrigins?: string[] }): Promise<WebMcpDescriptor[]>;
  executeTool(
    tool: WebMcpDescriptor,
    args: string,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
  addEventListener?(type: 'toolchange', listener: () => void): void;
}

type Request =
  | { kind: 'sidecart:ping' }
  | { kind: 'sidecart:list' }
  | { kind: 'sidecart:call'; tool: string; args: string };

function pageContext(): PageContext | undefined {
  return (document as unknown as { modelContext?: PageContext }).modelContext;
}

/** Descriptors are cached so a call can be matched back to its own object. */
let cache: WebMcpDescriptor[] = [];

async function list(): Promise<WebMcpDescriptor[]> {
  const context = pageContext();
  if (!context) return [];
  cache = await context.getTools();
  // The descriptor carries a live `window` reference, which cannot cross the
  // messaging boundary. Only the serialisable fields are sent.
  return cache;
}

function serialisable(tool: WebMcpDescriptor): WebMcpDescriptor {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema:
      typeof tool.inputSchema === 'string'
        ? tool.inputSchema
        : JSON.stringify(tool.inputSchema ?? {}),
    annotations: tool.annotations,
    origin: tool.origin,
    title: tool.title,
  };
}

chrome.runtime.onMessage.addListener((message: Request, _sender, respond) => {
  const context = pageContext();

  if (message?.kind === 'sidecart:ping') {
    respond({ ok: true, webmcp: !!context, url: location.href, host: location.host });
    return true;
  }

  if (message?.kind === 'sidecart:list') {
    if (!context) {
      respond({ ok: false, error: 'This page does not expose WebMCP.' });
      return true;
    }
    list()
      .then((tools) => respond({ ok: true, tools: tools.map(serialisable) }))
      .catch((error: unknown) => respond({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.kind === 'sidecart:call') {
    if (!context) {
      respond({ ok: false, error: 'This page does not expose WebMCP.' });
      return true;
    }
    void (async () => {
      try {
        // Match against the cached descriptor: executeTool wants the object
        // the page handed out, not a copy of it.
        if (!cache.length) await list();
        const tool = cache.find((entry) => entry.name === message.tool);
        if (!tool) {
          respond({ ok: false, error: `No tool named ${message.tool}.` });
          return;
        }
        const result = await context.executeTool(tool, message.args);
        respond({
          ok: true,
          result: typeof result === 'string' ? result : JSON.stringify(result ?? null),
        });
      } catch (error) {
        respond({ ok: false, error: String(error) });
      }
    })();
    return true;
  }

  return false;
});

// A storefront registers and unregisters tools as the shopper moves through
// it, so the panel is told to re-read rather than trusting its cache.
pageContext()?.addEventListener?.('toolchange', () => {
  void chrome.runtime.sendMessage({ kind: 'sidecart:toolchange' }).catch(() => {
    /* the panel may not be open */
  });
});

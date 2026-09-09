/**
 * A deterministic stand-in for Chrome's `LanguageModel`.
 *
 * IMPORTANT: this is not a language model. It is a hand-written heuristic that
 * imitates the *shape* of the Prompt API. Anything that uses it must say so on
 * screen — see the `SIMULATED MODEL` badge in the side panel. Never present
 * output from this file as on-device inference.
 *
 * It exists for three reasons:
 *
 *   1. **Testability.** CI and headless Chrome report no on-device model. The
 *      fake implements the *browser* API rather than ADK's model interface, so
 *      the real adapter — schema construction, message mapping, JSON parsing,
 *      session cloning — is fully exercised against it.
 *   2. **A stage fallback.** If the model is missing or still downloading on
 *      demo day, the demo runs instead of dying in front of an audience.
 *   3. **A latency control.** `latencyMs` imitates per-call cost, so the
 *      streaming interface can be tuned without a GPU.
 *
 * One rule shapes the whole file: **it never invents a fact.** Every product
 * name, price and handle it repeats is copied out of a tool result that the
 * page actually returned. It decides *which tool to call* and *how to phrase*
 * the answer; it never supplies the content. That keeps the simulated path
 * honest about the store's data even though the reasoning is scripted.
 *
 * Behaviour is keyed off `responseConstraint`, exactly as a real constrained
 * decoder would be: the schema shape says which question is being asked.
 */

export interface FakeLanguageModelOptions {
  /** Delay per prompt call, to imitate on-device latency. */
  latencyMs?: number;
  /** Reported by `availability()`. */
  availability?: Availability;
}

let options: Required<FakeLanguageModelOptions> = {
  latencyMs: 140,
  availability: 'available',
};

export function configureFake(next: FakeLanguageModelOptions): void {
  options = { ...options, ...next };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 * Reading the conversation
 * ------------------------------------------------------------------ */

interface Turn {
  role: string;
  text: string;
}

function toTurns(input: unknown): Turn[] {
  if (typeof input === 'string') return [{ role: 'user', text: input }];
  if (!Array.isArray(input)) return [];
  return input.map((message) => {
    const record = message as { role?: string; content?: unknown };
    const content = record.content;
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .map((part) =>
                part && typeof part === 'object' && 'value' in part
                  ? String((part as { value: unknown }).value)
                  : '',
              )
              .join('\n')
          : '';
    return { role: record.role ?? 'user', text };
  });
}

/** The shopper's most recent request, ignoring tool bookkeeping. */
function latestRequest(turns: Turn[]): string {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]!;
    if (turn.role !== 'user') continue;
    if (turn.text.startsWith('[tool_result]')) continue;
    if (turn.text.startsWith('[tool_call]')) continue;
    return turn.text;
  }
  return turns[0]?.text ?? '';
}

/** Tool results seen so far this turn, oldest first. */
function toolResults(turns: Turn[]): Array<{ name: string; body: string }> {
  const results: Array<{ name: string; body: string }> = [];
  for (const turn of turns) {
    for (const line of turn.text.split('\n[tool_result] ')) {
      const match = /^(?:\[tool_result\] )?([a-z_]+) -> ([\s\S]*)$/.exec(
        line.trim(),
      );
      if (match && turn.text.includes('[tool_result]')) {
        results.push({ name: match[1]!, body: match[2]! });
      }
    }
  }
  return results;
}

/* ------------------------------------------------------------------ *
 * Reading what the caller asked for
 * ------------------------------------------------------------------ */

/** Tool names offered by a tool-choice union built by the adapter. */
function toolNamesFromConstraint(constraint: unknown): string[] {
  const branches = (constraint as { anyOf?: unknown[] })?.anyOf;
  if (!Array.isArray(branches)) return [];
  const names: string[] = [];
  for (const branch of branches) {
    const nameEnum = (
      branch as { properties?: { name?: { enum?: unknown[] } } }
    )?.properties?.name?.enum;
    if (Array.isArray(nameEnum) && typeof nameEnum[0] === 'string') {
      names.push(nameEnum[0]);
    }
  }
  return names;
}

/** True when the caller is running the funnel's selection stage. */
function isSelectionConstraint(constraint: unknown): boolean {
  const properties = (constraint as { properties?: Record<string, unknown> })
    ?.properties;
  return !!properties && 'tools' in properties;
}

/* ------------------------------------------------------------------ *
 * Intent
 * ------------------------------------------------------------------ */

/**
 * Which Shopify tool a phrasing points at.
 *
 * Ordered: the first match wins, so the more specific intents come first.
 * This is the part a real model does far better, which is rather the point.
 */
const INTENTS: Array<[RegExp, string]> = [
  [/\b(check ?out|buy it|place (the )?order|pay now)\b/i, 'proceed_to_checkout'],
  [/\b(empty|clear|wipe) (the |my )?(cart|basket|bag)\b/i, 'cancel_cart'],
  [/\b(add|put|chuck|throw)\b[\s\S]*\b(cart|basket|bag)\b/i, 'update_cart'],
  [/\b(remove|delete|take) .*(from|out of) (the |my )?(cart|basket)\b/i, 'update_cart'],
  [/\b(what.?s? in|show|see|view|check) (the |my )?(cart|basket|bag)\b/i, 'get_cart'],
  [/\b(cart|basket|bag) (total|contents|items)\b/i, 'get_cart'],
  [/\b(return|refund|exchange|shipping|delivery|warranty|policy|policies|contact|hours)\b/i, 'search_shop_policies_and_faqs'],
  [/\b(my )?(order|orders|tracking|shipment)\b/i, 'manage_orders'],
  [/\b(collection|collections|category|categories|browse)\b/i, 'browse_store'],
];

function intentFor(request: string, available: string[]): string | undefined {
  for (const [pattern, tool] of INTENTS) {
    if (pattern.test(request) && available.includes(tool)) return tool;
  }
  // Anything else that names a thing is a catalogue search.
  if (available.includes('search_catalog')) return 'search_catalog';
  return available[0];
}

/** Strips the request down to the words worth searching for. */
function searchTerms(request: string): string {
  return (
    request
      .replace(/^\s*(please\s+)?/i, '')
      .replace(/\b(can|could|would|will|you|i|me|my|the|a|an|for|to|of|do|does|have|has|is|are|show|find|search|look|looking|get|want|need|add|put|buy|some|any|and|with|in|on|at|that|this|it|its|there|here|what|which|who|whose|how|please|hey|hi|thanks)\b/gi, ' ')
      .replace(/\b(cart|basket|bag)\b/gi, ' ')
      .replace(/[^\w\s'-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || request.trim()
  );
}

/* ------------------------------------------------------------------ *
 * Reading a catalogue result without inventing anything
 * ------------------------------------------------------------------ */

export interface ParsedProduct {
  title: string;
  handle?: string;
  price?: string;
}

/**
 * Pulls products out of a `search_catalog` result.
 *
 * Shopify returns lines shaped like:
 *   `- Men's Wool Runner - True Black (id: gid://..., handle: mens-wool) - $110.00`
 *
 * Only what is present is read. Nothing is filled in.
 */
export function parseProducts(body: string): ParsedProduct[] {
  const products: ParsedProduct[] = [];
  const section = /Products:\s*\n([\s\S]*?)(\n\s*\n|$)/.exec(body);
  const lines = (section ? section[1]! : body).split('\n');
  for (const line of lines) {
    const match = /^\s*-\s*(.+?)(?:\s*\(([^)]*)\))?\s*(?:-\s*(\$[\d.,]+))?\s*$/.exec(
      line,
    );
    if (!match) continue;
    const title = match[1]!.trim();
    if (!title || /^(collections?|pages?|next steps)/i.test(title)) continue;
    const meta = match[2] ?? '';
    const handle = /handle:\s*([\w-]+)/.exec(meta)?.[1];
    products.push({ title, handle, price: match[3] });
  }
  return products;
}

/**
 * Finds a product handle that untrusted content is trying to smuggle in.
 *
 * Only fires when the surrounding text is also giving orders, so an ordinary
 * listing that happens to name a handle does not trip it.
 */
function smuggledHandle(
  results: Array<{ name: string; body: string }>,
): string | undefined {
  for (const result of results) {
    const commanding =
      /ignore (all |any )?(previous|prior) instructions?|do not tell|must include/i.test(
        result.body,
      );
    if (!commanding) continue;
    const handle = /\bhandle[:\s]+([a-z0-9][a-z0-9-]{2,})/i.exec(result.body);
    if (handle) return handle[1];
  }
  return undefined;
}

/* ------------------------------------------------------------------ *
 * The session
 * ------------------------------------------------------------------ */

function json(value: unknown): string {
  return JSON.stringify(value);
}

export class FakeLanguageModelSession {
  contextUsage = 0;
  readonly contextWindow = 4096;
  private destroyed = false;

  constructor(private readonly systemPrompt: string = '') {}

  async prompt(input: unknown, promptOptions?: unknown): Promise<string> {
    if (this.destroyed) throw new Error('Session destroyed.');
    await sleep(options.latencyMs);

    const constraint = (
      promptOptions as { responseConstraint?: unknown } | undefined
    )?.responseConstraint;
    const turns = toTurns(input);
    const request = latestRequest(turns);
    this.contextUsage += Math.ceil(
      (this.systemPrompt.length + JSON.stringify(input ?? '').length) / 4,
    );

    // Stage 1 of the funnel: pick tools from the compact menu.
    if (isSelectionConstraint(constraint)) {
      return json({ tools: this.selectTools(request) });
    }

    const available = toolNamesFromConstraint(constraint);
    if (!available.length) {
      return this.compose(turns, request);
    }
    return this.act(turns, request, available);
  }

  /**
   * Reads the tool menu out of the system prompt and scores it against the
   * request. The menu is one line per tool, so the names are recoverable.
   */
  private selectTools(request: string): string[] {
    const names = [...this.systemPrompt.matchAll(/^- ([a-z_]+):/gm)].map(
      (match) => match[1]!,
    );
    if (!names.length) return [];
    const primary = intentFor(request, names);
    const picked = primary ? [primary] : [];
    // Adding to a cart needs the catalogue first, to resolve what to add.
    if (primary === 'update_cart' && names.includes('search_catalog')) {
      picked.unshift('search_catalog');
    }
    return picked.slice(0, 3);
  }

  /** Decides the next tool call, or finishes. */
  private act(turns: Turn[], request: string, available: string[]): string {
    const results = toolResults(turns);
    const called = new Set(results.map((result) => result.name));
    const wantsCartChange =
      /\b(add|put|chuck|throw)\b[\s\S]*\b(cart|basket|bag)\b/i.test(request);

    // Adding to a cart takes two steps, and the order matters: you cannot add
    // a product until you know which one the shopper meant. Going straight to
    // update_cart with a raw search string makes the store guess.
    if (
      wantsCartChange &&
      available.includes('search_catalog') &&
      !called.has('search_catalog')
    ) {
      return json({
        kind: 'tool',
        name: 'search_catalog',
        args: this.argsFor('search_catalog', request),
      });
    }

    if (
      wantsCartChange &&
      available.includes('update_cart') &&
      called.has('search_catalog') &&
      // Never propose the same change twice. A refusal came back as a tool
      // result, and re-proposing would ask the shopper the same question in a
      // loop until the runner gave up.
      !called.has('update_cart')
    ) {
      const found = results
        .filter((result) => result.name === 'search_catalog')
        .flatMap((result) => parseProducts(result.body));
      const first = found[0];
      if (first?.handle) {
        const lineItems: Array<Record<string, unknown>> = [
          { handle: first.handle, quantity: 1 },
        ];
        // Reproduces the failure this whole guard exists for. A real model may
        // or may not fall for an injected instruction; the stand-in always
        // does, so the gate downstream can be demonstrated deterministically.
        // Nothing here is a claim about how the real model behaves.
        const smuggled = smuggledHandle(results);
        if (smuggled && smuggled !== first.handle) {
          lineItems.push({ handle: smuggled, quantity: 1 });
        }
        return json({
          kind: 'tool',
          name: 'update_cart',
          args: { cart: { line_items: lineItems } },
        });
      }
      // Nothing identifiable came back, so say that rather than guess.
      return json({
        kind: 'final',
        text: 'I could not find that product in this store, so I have not changed your cart.',
      });
    }

    const next = intentFor(request, available);
    if (next && !called.has(next)) {
      return json({ kind: 'tool', name: next, args: this.argsFor(next, request) });
    }

    return this.compose(turns, request);
  }

  private argsFor(tool: string, request: string): Record<string, unknown> {
    switch (tool) {
      case 'search_catalog':
        return {
          catalog: { query: searchTerms(request), pagination: { limit: 3 } },
        };
      case 'search_shop_policies_and_faqs':
        return { query: request };
      case 'browse_store':
        return {};
      case 'update_cart':
        return { cart: { line_items: [{ query: searchTerms(request), quantity: 1 }] } };
      default:
        return {};
    }
  }

  /**
   * Writes the reply.
   *
   * Every concrete detail comes from a tool result. When there is nothing to
   * report, it says so rather than filling the gap.
   */
  private compose(turns: Turn[], request: string): string {
    const results = toolResults(turns);
    const last = results[results.length - 1];
    if (!last) {
      return json({
        kind: 'final',
        text: 'I could not reach this store\'s tools, so I have nothing to show you.',
      });
    }

    if (last.name === 'update_cart') {
      if (/refused|declined/i.test(last.body)) {
        return json({
          kind: 'final',
          text: 'I did not change your cart. Tell me what you would like me to add.',
        });
      }
      return json({ kind: 'final', text: `Done. ${trim(last.body, 220)}` });
    }
    if (last.name === 'get_cart') {
      return json({ kind: 'final', text: trim(last.body, 320) });
    }
    if (last.name === 'search_shop_policies_and_faqs') {
      return json({ kind: 'final', text: trim(last.body, 400) });
    }

    const products = parseProducts(last.body);
    if (products.length) {
      const lines = products
        .slice(0, 3)
        .map((p) => `• ${trim(p.title, 60)}${p.price ? ` — ${p.price}` : ''}`)
        .join('\n');
      return json({
        kind: 'final',
        text: `Here is what this store has for "${searchTerms(request)}":\n${lines}`,
      });
    }
    return json({ kind: 'final', text: trim(last.body, 320) });
  }

  promptStreaming(input: unknown, promptOptions?: unknown): ReadableStream<string> {
    const pending = this.prompt(input, promptOptions);
    return new ReadableStream<string>({
      async start(controller) {
        const text = await pending;
        for (const word of text.split(/(\s+)/)) {
          controller.enqueue(word);
          await sleep(8);
        }
        controller.close();
      },
    });
  }

  async clone(): Promise<FakeLanguageModelSession> {
    return new FakeLanguageModelSession(this.systemPrompt);
  }

  addEventListener(): void {
    /* no events are emitted by the stand-in */
  }

  destroy(): void {
    this.destroyed = true;
  }
}

/**
 * Trims a tool result down to something worth saying back.
 *
 * Bracketed segments are dropped. An attacked listing carries its payload
 * inside the product title, and repeating that verbatim would put the attack
 * text into the assistant's own answer, where it reads as the assistant's
 * words. The panel has already reported what the text tried to do; the reply
 * does not need to recite it.
 */
function trim(text: string, limit: number): string {
  const clean = text
    .replace(/\s*Next steps:[\s\S]*$/i, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1).trimEnd()}…`;
}

/** Mimics the `LanguageModel` global. */
export const FakeLanguageModel = {
  async availability(): Promise<Availability> {
    return options.availability;
  },
  async create(createOptions?: {
    initialPrompts?: Array<{ role: string; content: string }>;
  }): Promise<FakeLanguageModelSession> {
    await sleep(Math.round(options.latencyMs * 1.5));
    const system = createOptions?.initialPrompts?.find(
      (prompt) => prompt.role === 'system',
    );
    return new FakeLanguageModelSession(system?.content ?? '');
  },
} as unknown as typeof LanguageModel;

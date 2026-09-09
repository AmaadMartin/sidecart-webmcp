/**
 * The gate between the model and anything that spends money.
 *
 * ## Why this is not optional
 *
 * WebMCP tools return content the store's operator, or its customers, wrote:
 * product titles, descriptions, reviews, policy pages. Chrome marks those
 * tools with `untrustedContentHint`, and Shopify sets it on five of its ten.
 * The model reads that text in the same token stream as the shopper's request,
 * so text in a product listing can read as an instruction.
 *
 * Chrome's own guidance is blunt about this: models are probabilistic, and it
 * is impossible to guarantee safety inside one. So the guarantee cannot live
 * in the prompt. It lives here, outside the model, as a rule the model cannot
 * argue with:
 *
 *   **No tool that changes the cart or moves to checkout ever runs without a
 *   human clicking Confirm.**
 *
 * The model proposes. A person disposes. That holds whether or not the model
 * was fooled, which is the only property worth having.
 *
 * ## What the highlighter is, and is not
 *
 * {@link findInjectionMarkers} spots the phrasings an injected instruction
 * usually uses. It exists to make the attack visible in a demo, and to warn a
 * shopper. It is a heuristic and it is evadable. It is not the defence. The
 * confirmation gate is the defence.
 */

import type { BaseTool } from '@google/adk';
import { WebMcpTool } from './webmcp.js';

/** One thing a held call would do, described for a person. */
export interface ApprovalItem {
  /** Handle, query or line id the model gave. */
  ref: string;
  quantity: number;
  title?: string;
  price?: number;
  /** False when the store never returned this item in this turn's results. */
  known: boolean;
  /**
   * False when nothing in the shopper's own words points at this item.
   *
   * This is the signal that matters. The pipeline already knows the turn read
   * untrusted text; pairing that with "and you never mentioned this one"
   * is what turns a list into a warning.
   */
  inRequest: boolean;
}

/** A tool call held back until a person approves it. */
export interface PendingApproval {
  tool: string;
  args: Record<string, unknown>;
  /** True when untrusted content was read earlier in this same turn. */
  afterUntrustedContent: boolean;
  /** Suspicious phrasings seen in untrusted content this turn. */
  markers: string[];
  /** What the call would do, itemised. Empty for tools without line items. */
  items: ApprovalItem[];
  /** Total price of the items, when every price is known. */
  total?: number;
}

/** What the guard decided, for the audit trail. */
export interface GuardEvent {
  kind: 'allowed' | 'held' | 'approved' | 'refused' | 'untrusted-read';
  tool: string;
  detail?: string;
  at: number;
}

/**
 * What a person decided about a held call.
 *
 * `only-asked` exists because refusing everything is a bad answer to a
 * smuggled line item: the shopper still wants the thing they asked for. The
 * guard drops the unasked-for items and lets the rest through.
 */
export type ApprovalDecision = 'all' | 'only-asked' | 'none';

/** Asks a person to approve a call. */
export type ApprovalPrompt = (
  request: PendingApproval,
) => Promise<ApprovalDecision>;

export interface GuardOptions {
  /** Asks the shopper. Without one, every consequential call is refused. */
  approve?: ApprovalPrompt;
  /** The shopper's own words, used to spot items they never asked for. */
  request?: string;
  /** Looks up a product the assistant has already seen this turn. */
  resolve?: (ref: string) => { title?: string; price?: number } | undefined;
  /**
   * Tools allowed to run unattended.
   *
   * Shopify marks its navigation tools as not read-only, because they move the
   * browser. Moving the browser is visible and reversible, so it does not need
   * a click. Changing a cart or entering checkout does.
   */
  autoApprove?: string[];
  onEvent?: (event: GuardEvent) => void;
}

const DEFAULT_AUTO_APPROVE = [
  'get_product',
  'browse_store',
  'show_variant',
  'manage_orders',
];

/**
 * Phrasings that an injected instruction tends to use.
 *
 * Deliberately narrow. A broad filter would fire on ordinary product copy and
 * teach the shopper to ignore the warning, which is worse than not warning.
 */
const INJECTION_PATTERNS: Array<[RegExp, string]> = [
  [/ignore (all |any )?(previous|prior|above)\s+instructions?/i, 'ignore previous instructions'],
  [/disregard (the |all )?(previous|prior|above)/i, 'disregard previous'],
  [/you (are|act) (now )?(a|an|as)\b/i, 'role reassignment'],
  [/system\s*(prompt|message|instruction)/i, 'refers to the system prompt'],
  [/\bdo not (tell|inform|mention|ask)\b/i, 'asks to conceal'],
  [/without (asking|confirming|telling) the (user|customer|shopper)/i, 'asks to skip confirmation'],
  [/\badd .{0,40}\bto (the |your |their )?cart\b/i, 'instructs a cart change'],
  [/\bproceed to checkout\b/i, 'instructs checkout'],
];

const NOISE = new Set([
  'the', 'and', 'for', 'with', 'plan', 'pack', 'set', 'add', 'cart', 'you',
  'your', 'that', 'this', 'from', 'into', 'item', 'items', 'one', 'two',
]);

/** Meaningful words, for comparing a request against an item. */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !NOISE.has(word));
}

/** Returns the names of injection phrasings present in `text`. */
export function findInjectionMarkers(text: string): string[] {
  const found: string[] = [];
  for (const [pattern, label] of INJECTION_PATTERNS) {
    if (pattern.test(text) && !found.includes(label)) found.push(label);
  }
  return found;
}

/**
 * Holds the per-turn taint state and produces the ADK callbacks.
 *
 * One guard covers one turn. Taint does not leak between turns, because a new
 * request from the shopper is a fresh intent.
 */
export class ToolGuard {
  private untrustedSeen = false;
  private markers: string[] = [];
  readonly events: GuardEvent[] = [];

  constructor(private readonly options: GuardOptions = {}) {}

  private record(event: Omit<GuardEvent, 'at'>): void {
    const full: GuardEvent = { ...event, at: Date.now() };
    this.events.push(full);
    this.options.onEvent?.(full);
  }

  /** True when untrusted content was read during this turn. */
  get tainted(): boolean {
    return this.untrustedSeen;
  }

  /** Suspicious phrasings seen so far this turn. */
  get seenMarkers(): string[] {
    return [...this.markers];
  }

  private isConsequential(tool: BaseTool): boolean {
    const autoApprove = this.options.autoApprove ?? DEFAULT_AUTO_APPROVE;
    if (autoApprove.includes(tool.name)) return false;
    // A page that does not mark a tool read-only is telling us it does
    // something. Absent a hint, assume it matters.
    return !(tool instanceof WebMcpTool) || !tool.readOnlyHint;
  }

  /**
   * The `beforeToolCallback`.
   *
   * Returning a record makes ADK skip the tool and hand the record back to the
   * model as the result, which is exactly the shape a refusal needs.
   */
  readonly beforeTool = async (params: {
    tool: BaseTool;
    args: Record<string, unknown>;
  }): Promise<Record<string, unknown> | undefined> => {
    const { tool, args } = params;

    if (!this.isConsequential(tool)) {
      this.record({ kind: 'allowed', tool: tool.name });
      return undefined;
    }

    const items = this.itemise(args);
    const prices = items.map((item) => item.price);
    const request: PendingApproval = {
      tool: tool.name,
      args,
      afterUntrustedContent: this.untrustedSeen,
      markers: this.seenMarkers,
      items,
      // `every` is vacuously true on an empty list, which would price a
      // checkout call at $0.00.
      total:
        items.length > 0 && prices.every((price) => typeof price === 'number')
          ? items.reduce((sum, item) => sum + (item.price ?? 0) * item.quantity, 0)
          : undefined,
    };

    if (!this.options.approve) {
      this.record({
        kind: 'refused',
        tool: tool.name,
        detail: 'no approver is attached',
      });
      return {
        refused: true,
        reason:
          'This action needs the shopper to confirm it, and no confirmation ' +
          'was available. Tell the shopper what you wanted to do.',
      };
    }

    this.record({
      kind: 'held',
      tool: tool.name,
      detail: this.untrustedSeen
        ? 'It came after text the store does not control.'
        : 'It changes the cart.',
    });

    const decision = await this.options.approve(request);

    if (decision === 'all') {
      this.record({ kind: 'approved', tool: tool.name });
      return undefined;
    }

    if (decision === 'only-asked') {
      const kept = this.dropUnasked(args, items);
      if (kept === 0) {
        this.record({ kind: 'refused', tool: tool.name, detail: 'nothing left' });
        return {
          refused: true,
          reason: 'Nothing in that request was something the shopper asked for.',
        };
      }
      this.record({
        kind: 'approved',
        tool: tool.name,
        detail: 'only the items the shopper asked for',
      });
      return undefined;
    }

    this.record({ kind: 'refused', tool: tool.name, detail: 'declined' });
    return {
      refused: true,
      reason:
        'The shopper declined this action. Do not try it again. Tell them ' +
        'what you were going to do and stop.',
    };
  };

  /**
   * Removes the line items the shopper never asked for, in place.
   *
   * ADK hands the same `args` object to the tool after this callback returns,
   * so editing it here is what makes the shopper's choice take effect.
   * Returns how many items survive.
   */
  private dropUnasked(
    args: Record<string, unknown>,
    items: ApprovalItem[],
  ): number {
    const cart = args['cart'] as { line_items?: unknown[] } | undefined;
    if (!Array.isArray(cart?.line_items)) return 0;
    const keep = cart.line_items.filter((_, index) => items[index]?.inRequest);
    cart.line_items = keep;
    return keep.length;
  }

  /**
   * Turns a tool's arguments into something a person can check.
   *
   * Only `update_cart`-shaped payloads have line items. Anything else falls
   * back to showing the raw arguments, which is honest if less readable.
   */
  private itemise(args: Record<string, unknown>): ApprovalItem[] {
    const cart = args['cart'] as { line_items?: unknown[] } | undefined;
    if (!Array.isArray(cart?.line_items)) return [];
    const asked = tokens(this.options.request ?? '');

    return cart.line_items.map((raw) => {
      const line = raw as {
        handle?: string;
        query?: string;
        id?: string;
        quantity?: number;
        item?: { id?: string };
      };
      const ref = line.handle ?? line.query ?? line.item?.id ?? line.id ?? 'item';
      const found = this.options.resolve?.(ref);
      // An item counts as asked for when the shopper's words and the item's
      // own words share a real term. Loose on purpose: a false "you asked for
      // this" is worse than a false "you did not".
      // Matched on the handle alone. Matching on the title would let a
      // listing claim to be what the shopper asked for by quoting them.
      const itemTerms = tokens(ref);
      return {
        ref,
        quantity: line.quantity ?? 1,
        title: found?.title,
        price: found?.price,
        known: !!found,
        inRequest: itemTerms.some((term) => asked.includes(term)),
      };
    });
  }

  /**
   * The `afterToolCallback`.
   *
   * Marks the turn tainted once a tool the page flagged as untrusted has
   * returned, and notes any injection phrasing for the interface to show.
   */
  readonly afterTool = (params: {
    tool: BaseTool;
    response: unknown;
  }): Record<string, unknown> | undefined => {
    const { tool, response } = params;
    if (!(tool instanceof WebMcpTool) || !tool.untrustedContentHint) {
      return undefined;
    }

    this.untrustedSeen = true;
    const text =
      typeof response === 'string' ? response : JSON.stringify(response ?? '');
    const found = findInjectionMarkers(text);
    for (const marker of found) {
      if (!this.markers.includes(marker)) this.markers.push(marker);
    }

    this.record({
      kind: 'untrusted-read',
      tool: tool.name,
      detail: found.length ? found.join(', ') : undefined,
    });
    return undefined;
  };
}

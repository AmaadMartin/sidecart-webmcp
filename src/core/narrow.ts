/**
 * The funnel: fitting a page's tools into a small context window.
 *
 * ## The problem, measured
 *
 * A live Shopify storefront registers ten WebMCP tools. Their descriptions and
 * argument schemas together come to about 10,500 characters — roughly 3,000
 * tokens the model must read before the shopper has typed anything. Three of
 * those descriptions are longer than the 500 characters Chrome's own guidance
 * recommends, because they are written for large cloud agents.
 *
 * A cloud model does not care. The on-device model has a small context window,
 * and spending most of it on a tool menu leaves little for the catalogue, the
 * conversation, or the answer.
 *
 * ## The funnel
 *
 *   all tools --> 1. menu      name + one line each, no schemas
 *             --> 2. select    one bounded call: which tools apply?
 *             --> 3. equip     full schemas, for the chosen tools only
 *
 * Stage 2 is a small model's best kind of question: pick from a short list.
 * Stage 3 is where the expensive detail lives, and only two or three tools
 * ever reach it.
 *
 * The selector degrades to deterministic lexical ranking when no model is
 * available, so the funnel still runs with the scripted stand-in.
 */

import type { WebMcpTool } from './webmcp.js';
import { parseInputSchema } from './webmcp.js';

/** How many tools may reach the agent. */
export const MAX_EQUIPPED_TOOLS = 3;

/** Characters kept from a tool description when building the menu. */
const MENU_LINE_LIMIT = 140;

/** What the funnel did, so the interface can show it. */
export interface FunnelTrace {
  totalTools: number;
  /** Characters if every tool were handed over with its full schema. */
  fullSurfaceChars: number;
  /** Characters of the compact menu the selector actually reads. */
  menuChars: number;
  /** Characters of the schemas for the equipped tools only. */
  equippedChars: number;
  equipped: string[];
  /** How the choice was made. */
  method: 'model' | 'lexical' | 'all';
  ms: number;
}

/**
 * Shortens a description to its first sentence.
 *
 * Shopify's descriptions open with what the tool does and then spend hundreds
 * of characters on trigger phrases and warnings aimed at a large agent. The
 * first sentence is the part that answers "is this the right tool?".
 */
export function firstSentence(text: string, limit = MENU_LINE_LIMIT): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const stop = clean.search(/[.!?](\s|$)/);
  const sentence = stop > 0 ? clean.slice(0, stop + 1) : clean;
  return sentence.length <= limit
    ? sentence
    : `${sentence.slice(0, limit - 1).trimEnd()}…`;
}

/** Builds the compact menu the selector reads. */
export function buildMenu(tools: WebMcpTool[]): string {
  return tools
    .map((tool) => `- ${tool.name}: ${firstSentence(tool.description)}`)
    .join('\n');
}

/** Characters a model would spend on the full tool surface. */
export function fullSurfaceChars(tools: WebMcpTool[]): number {
  let chars = 0;
  for (const tool of tools) {
    chars += tool.description.length;
    chars += JSON.stringify(parseInputSchema(tool.descriptor)).length;
  }
  return chars;
}

/** Characters spent on the tools that were actually equipped. */
export function equippedChars(tools: WebMcpTool[]): number {
  return fullSurfaceChars(tools);
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'for', 'from',
  'get', 'has', 'have', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or',
  'please', 'that', 'the', 'to', 'want', 'was', 'what', 'with', 'you', 'your',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

/**
 * Ranks tools against the query using only the page's own words.
 *
 * This is the fallback, not the main path. It cannot connect "tree runners" to
 * a catalogue search, because those words appear nowhere in the tool text. It
 * does reliably catch the vocabulary a page repeats in its own descriptions —
 * cart, checkout, policy, order — which is enough to keep the app working when
 * no model is available.
 */
export function lexicalRank(
  query: string,
  tools: WebMcpTool[],
): Array<{ tool: WebMcpTool; score: number }> {
  const terms = tokenize(query);
  return tools
    .map((tool) => {
      const nameTerms = new Set(tokenize(tool.name));
      const bodyTerms = tokenize(`${tool.name} ${tool.description}`);
      const bodyCount = new Map<string, number>();
      for (const term of bodyTerms) {
        bodyCount.set(term, (bodyCount.get(term) ?? 0) + 1);
      }
      let score = 0;
      for (const term of terms) {
        // A hit in the tool's name is worth much more than one in its prose.
        if (nameTerms.has(term)) score += 3;
        const hits = bodyCount.get(term) ?? 0;
        if (hits) score += 1 + Math.log(hits);
      }
      return { tool, score };
    })
    .sort((a, b) => b.score - a.score);
}

/** Picks the read-only tools first, as the safest default. */
function safeDefault(tools: WebMcpTool[], limit: number): WebMcpTool[] {
  const readOnly = tools.filter((tool) => tool.readOnlyHint);
  return [...readOnly, ...tools.filter((t) => !t.readOnlyHint)].slice(0, limit);
}

/**
 * Gives a write tool something to look things up with.
 *
 * A tool that changes state almost always needs a read first: you cannot add a
 * product to a cart until you know which product the shopper meant. Asked to
 * "add the alpine glove liner to my cart", a model reasonably picks only
 * `update_cart` — and then has to invent an identifier, because nothing has
 * told it what the store calls that thing.
 *
 * So when the selection is all writes, the best-matching read-only tool is
 * added alongside. This is a general rule rather than a Shopify one: it keys
 * off the page's own `readOnlyHint`, and does nothing on a page whose tools
 * are all reads.
 */
function withLookup(
  chosen: WebMcpTool[],
  query: string,
  all: WebMcpTool[],
  limit: number,
): WebMcpTool[] {
  if (!chosen.length || chosen.length >= limit) return chosen;
  if (chosen.some((tool) => tool.readOnlyHint)) return chosen;

  const names = new Set(chosen.map((tool) => tool.name));
  const lookup = lexicalRank(query, all)
    .map((row) => row.tool)
    .find((tool) => tool.readOnlyHint && !names.has(tool.name));
  // The lookup runs first, so the write has something to work from.
  return lookup ? [lookup, ...chosen] : chosen;
}

/** Chooses tool names from a menu. Returns names, not tools. */
export type ToolSelector = (
  query: string,
  menu: string,
  names: string[],
) => Promise<string[]>;

/**
 * Runs the funnel and returns the tools the agent should be given.
 *
 * When the selector fails, returns nothing usable, or is absent, this falls
 * back to lexical ranking rather than to handing over everything: passing all
 * ten tools is the failure this whole module exists to avoid.
 */
export async function narrowTools(params: {
  query: string;
  tools: WebMcpTool[];
  select?: ToolSelector;
  limit?: number;
}): Promise<{ equipped: WebMcpTool[]; trace: FunnelTrace }> {
  const started = Date.now();
  const { query, tools } = params;
  const limit = params.limit ?? MAX_EQUIPPED_TOOLS;
  const menu = buildMenu(tools);

  if (tools.length <= limit) {
    return {
      equipped: tools,
      trace: {
        totalTools: tools.length,
        fullSurfaceChars: fullSurfaceChars(tools),
        menuChars: menu.length,
        equippedChars: fullSurfaceChars(tools),
        equipped: tools.map((t) => t.name),
        method: 'all',
        ms: Date.now() - started,
      },
    };
  }

  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  let equipped: WebMcpTool[] = [];
  let method: FunnelTrace['method'] = 'lexical';

  if (params.select) {
    try {
      const chosen = await params.select(query, menu, [...byName.keys()]);
      equipped = chosen
        .map((name) => byName.get(name))
        .filter((tool): tool is WebMcpTool => !!tool)
        .slice(0, limit);
      if (equipped.length) {
        equipped = withLookup(equipped, query, tools, limit);
        method = 'model';
      }
    } catch {
      equipped = [];
    }
  }

  if (!equipped.length) {
    method = 'lexical';
    const ranked = lexicalRank(query, tools).filter((r) => r.score > 0);
    equipped = ranked.slice(0, limit).map((r) => r.tool);
    if (!equipped.length) equipped = safeDefault(tools, limit);
  }

  return {
    equipped,
    trace: {
      totalTools: tools.length,
      fullSurfaceChars: fullSurfaceChars(tools),
      menuChars: menu.length,
      equippedChars: fullSurfaceChars(equipped),
      equipped: equipped.map((t) => t.name),
      method,
      ms: Date.now() - started,
    },
  };
}

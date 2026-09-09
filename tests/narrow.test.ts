/**
 * The funnel.
 *
 * The claim this file has to defend: a page can offer more tool description
 * than a small on-device model can hold, and the funnel gets it down to
 * something that fits without losing the tool the shopper needed.
 *
 * Run: npm test
 */

import { localBridge, RidgelineStore } from '../src/harness/store.js';
import { WebMcpCatalog } from '../src/core/webmcp.js';
import {
  buildMenu,
  firstSentence,
  fullSurfaceChars,
  lexicalRank,
  narrowTools,
} from '../src/core/narrow.js';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

async function main() {
  const catalog = new WebMcpCatalog(localBridge(new RidgelineStore()));
  const tools = await catalog.tools();

  console.log('\ncompression');
  check(
    'first sentence keeps the useful half of a long description',
    firstSentence('Search the store catalog for products. Does NOT add anything.') ===
      'Search the store catalog for products.',
  );
  check('first sentence is bounded', firstSentence('x'.repeat(400)).length <= 140);
  check('an empty description does not throw', firstSentence('') === '');

  const menu = buildMenu(tools);
  const full = fullSurfaceChars(tools);
  console.log(`  menu ${menu.length} chars, full surface ${full} chars`);
  check('the menu names every tool', tools.every((t) => menu.includes(t.name)));
  check(
    'the menu is a small fraction of the full surface',
    menu.length < full / 5,
    `${menu.length} vs ${full}`,
  );

  console.log('\nselection by model');
  const equippedFor = async (query: string, chosen: string[]) =>
    (
      await narrowTools({
        query,
        tools,
        select: async () => chosen,
      })
    ).equipped.map((t) => t.name);

  check(
    'equips what the selector asked for',
    (await equippedFor('anything', ['get_cart'])).join() === 'get_cart',
  );
  check(
    'ignores a name the page never registered',
    (await equippedFor('anything', ['not_a_tool', 'get_cart'])).join() === 'get_cart',
  );
  check(
    'never equips more than the limit',
    (
      await equippedFor('anything', [
        'get_cart',
        'search_catalog',
        'update_cart',
        'browse_store',
      ])
    ).length === 3,
  );

  console.log('\nfallback when no model is available');
  const cartWords = lexicalRank('what is in my cart', tools);
  check(
    'lexical ranking finds cart tools from the page\'s own words',
    cartWords[0]!.tool.name.includes('cart'),
    cartWords[0]!.tool.name,
  );
  const policy = await narrowTools({ query: 'what is your return policy', tools });
  check(
    'a policy question reaches the policy tool with no selector at all',
    policy.equipped.some((t) => t.name === 'search_shop_policies_and_faqs'),
    policy.equipped.map((t) => t.name).join(),
  );
  check('the trace says it fell back', policy.trace.method === 'lexical');

  const broken = await narrowTools({
    query: 'anything',
    tools,
    select: async () => {
      throw new Error('model died');
    },
  });
  check(
    'a selector that throws does not take the turn down',
    broken.equipped.length > 0 && broken.trace.method === 'lexical',
  );
  check(
    'a query matching nothing still equips something safe',
    (await narrowTools({ query: 'zzzz qqqq', tools })).equipped.length === 3,
  );

  console.log('\nthe point of the exercise');
  const narrowed = await narrowTools({
    query: 'what is in my cart',
    tools,
    select: async () => ['get_cart'],
  });
  check(
    'the equipped surface is far smaller than the full one',
    narrowed.trace.equippedChars < narrowed.trace.fullSurfaceChars / 8,
    `${narrowed.trace.equippedChars} vs ${narrowed.trace.fullSurfaceChars}`,
  );
  check(
    'the trace reports honest numbers',
    narrowed.trace.totalTools === 10 &&
      narrowed.trace.equipped.length === 1 &&
      narrowed.trace.menuChars > 0,
  );

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error('test run threw:', error);
  process.exit(1);
});

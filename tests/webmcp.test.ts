/**
 * The WebMCP layer, against Shopify's real tool definitions.
 *
 * The descriptors under test are the ones a live Shopify storefront hands out,
 * captured verbatim. That matters: every bug this file guards against was a
 * silent one, found by running against a real store rather than by reading the
 * specification.
 *
 * Run: npm test
 */

import { SHOPIFY_TOOLS } from '../src/harness/shopify-tools.js';
import { localBridge, RidgelineStore } from '../src/harness/store.js';
import {
  parseInputSchema,
  unwrapToolResult,
  WebMcpCatalog,
  WebMcpTool,
} from '../src/core/webmcp.js';

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
  const store = new RidgelineStore();
  const bridge = localBridge(store);
  const catalog = new WebMcpCatalog(bridge);

  console.log('\ndiscovery');
  const tools = await catalog.tools();
  check('finds all ten Shopify tools', tools.length === 10, `got ${tools.length}`);
  check(
    'reads the page annotations',
    tools.find((t) => t.name === 'search_catalog')!.untrustedContentHint === true &&
      tools.find((t) => t.name === 'update_cart')!.readOnlyHint === false,
  );

  console.log('\nschema parsing');
  const search = tools.find((t) => t.name === 'search_catalog')!;
  const schema = parseInputSchema(search.descriptor);
  check(
    'parses the JSON string Chrome returns',
    schema['type'] === 'object' &&
      Array.isArray(schema['required']) &&
      (schema['required'] as string[]).includes('catalog'),
  );
  check(
    'keeps nested requirements a genai Schema round trip would drop',
    JSON.stringify(schema).includes('"required":["query"]'),
  );
  check(
    'declares parametersJsonSchema, not parameters',
    !!search._getDeclaration().parametersJsonSchema,
  );
  check(
    'survives a schema that does not parse',
    JSON.stringify(parseInputSchema({ name: 'x', inputSchema: 'nope' })) ===
      '{"type":"object","properties":{}}',
  );

  console.log('\nthe surface problem');
  const surface = await catalog.surfaceSize();
  check(
    'the full tool surface really is about 10,500 characters',
    surface.chars > 10000 && surface.chars < 11000,
    `${surface.chars}`,
  );

  console.log('\nexecution');
  const result = (await search.runAsync({
    args: { catalog: { query: 'rain shell' } },
    toolContext: {} as never,
  })) as string;
  check('runs a tool through the bridge', typeof result === 'string');
  check('finds the product', result.includes('Trailhead Rain Shell'));
  check(
    'unwraps the MCP envelope before the model sees it',
    !result.includes('"content"') && !result.includes('"type":"text"'),
    result.slice(0, 80),
  );
  check(
    'unwrapToolResult joins text parts',
    unwrapToolResult(
      JSON.stringify({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }),
    ) === 'a\nb',
  );
  check(
    'unwrapToolResult leaves plain text alone',
    unwrapToolResult('just text') === 'just text',
  );

  console.log('\narguments');
  // The bridge must stringify arguments; passing an object silently fails.
  let seenArgs = '';
  const spy = new WebMcpTool(search.descriptor, {
    async getTools() {
      return [];
    },
    async executeTool(_tool, args) {
      seenArgs = args;
      return 'ok';
    },
  });
  await spy.runAsync({ args: { catalog: { query: 'x' } }, toolContext: {} as never });
  check(
    'sends arguments as a JSON string',
    seenArgs === '{"catalog":{"query":"x"}}',
    seenArgs,
  );

  console.log('\ncart state');
  await (tools.find((t) => t.name === 'update_cart') as WebMcpTool).runAsync({
    args: { cart: { line_items: [{ handle: 'summit-45-pack', quantity: 2 }] } },
    toolContext: {} as never,
  });
  check('a tool call changes the store', store.lines.length === 1);
  check('quantity is honoured', store.lines[0]!.quantity === 2);
  check('total is right', store.total === 480, String(store.total));

  console.log('\nfidelity');
  check(
    'the captured tools carry Shopify descriptions, not paraphrases',
    SHOPIFY_TOOLS.find((t) => t.name === 'get_product')!.description.length > 800,
  );
  check(
    'five tools are marked untrusted, as on the live store',
    SHOPIFY_TOOLS.filter((t) => t.annotations.untrustedContentHint).length === 5,
  );

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error('test run threw:', error);
  process.exit(1);
});

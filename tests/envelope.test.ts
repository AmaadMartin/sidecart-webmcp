/**
 * The reply envelope.
 *
 * The claim this file has to defend: whatever a small model does to the JSON it
 * was asked for, the shopper reads an answer and never reads JSON.
 *
 * Every malformed string below was either produced by Gemini Nano during a demo
 * run or is a one-character variation on one that was.
 *
 * Run: npm test
 */

import type { FunctionDeclaration } from '@google/genai';
import {
  buildToolChoiceSchema,
  parseToolChoice,
  salvageFinalText,
} from '../src/model/chrome-prompt-llm.js';

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

const decls = [
  {
    name: 'search_catalog',
    description: 'Search the catalog.',
    parametersJsonSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'update_cart',
    description: 'Change the cart.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        cart: {
          type: 'object',
          properties: { line_items: { type: 'array', items: { type: 'object' } } },
        },
      },
      required: ['cart'],
    },
  },
] as unknown as FunctionDeclaration[];

/** Reads the text an LlmResponse would show. */
function shown(res: any): string | undefined {
  return res?.content?.parts?.[0]?.text;
}

/** Reads the call an LlmResponse would make. */
function called(res: any): { name: string; args: any } | undefined {
  const fc = res?.content?.parts?.[0]?.functionCall;
  return fc ? { name: fc.name, args: fc.args } : undefined;
}

function main() {
  console.log('\nthe constraint closes every branch');
  const schema = buildToolChoiceSchema(decls) as any;
  const branches: any[] = schema.anyOf;
  check('one branch for the answer and one per tool', branches.length === 3);
  check(
    'every branch forbids keys it did not declare',
    branches.every((b) => b.additionalProperties === false),
    JSON.stringify(branches.map((b) => b.additionalProperties)),
  );
  check(
    'the answer branch still requires kind and text',
    branches[0].required.join(',') === 'kind,text',
  );

  // The bug this guards: without additionalProperties, `,"` is a legal
  // continuation after `text`, so the object never has to close and the reply
  // arrives truncated.
  const args = branches[2].properties.args;
  check(
    "a tool's own args schema is left alone",
    args.additionalProperties === undefined && args.properties.cart !== undefined,
  );

  console.log('\na truncated answer still reads as an answer');
  // Captured from a demo run on Gemini Nano: the prose finished, the object
  // did not, and the panel printed the envelope.
  const truncated =
    '{"kind":"final","text":"You can return unworn items within 60 days for a full refund. Return shipping is free in the UK and the US.","';
  check(
    'JSON.parse cannot read it',
    (() => {
      try {
        JSON.parse(truncated);
        return false;
      } catch {
        return true;
      }
    })(),
  );
  check(
    'the answer comes back without the envelope',
    salvageFinalText(truncated) ===
      'You can return unworn items within 60 days for a full refund. Return shipping is free in the UK and the US.',
    JSON.stringify(salvageFinalText(truncated)),
  );
  check(
    'and that is what the shopper is shown',
    !!shown(parseToolChoice(truncated, decls))?.startsWith('You can return unworn items'),
    JSON.stringify(shown(parseToolChoice(truncated, decls))),
  );
  check(
    'no brace, quote or key name survives into the answer',
    !/[{}]|"kind"|"text"/.test(shown(parseToolChoice(truncated, decls)) ?? ''),
  );

  console.log('\nother shapes a small model produces');
  check(
    'a well-formed answer is unwrapped',
    shown(parseToolChoice('{"kind":"final","text":"Two jackets."}', decls)) ===
      'Two jackets.',
  );
  check(
    'a fenced answer is unwrapped',
    shown(
      parseToolChoice('```json\n{"kind":"final","text":"Two jackets."}\n```', decls),
    ) === 'Two jackets.',
  );
  check(
    'an escaped quote survives truncation',
    salvageFinalText('{"kind":"final","text":"She said \\"no\\" to it') ===
      'She said "no" to it',
    JSON.stringify(salvageFinalText('{"kind":"final","text":"She said \\"no\\" to it')),
  );
  check(
    'a unicode escape survives truncation',
    salvageFinalText('{"kind":"final","text":"caf\\u00e9 hours') === 'café hours',
    JSON.stringify(salvageFinalText('{"kind":"final","text":"caf\\u00e9 hours')),
  );
  check(
    'a truncation mid-escape does not throw',
    salvageFinalText('{"kind":"final","text":"ends here\\') === 'ends here',
  );
  check(
    'plain prose is passed through, not mistaken for a broken envelope',
    shown(parseToolChoice('We have two waterproof jackets.', decls)) ===
      'We have two waterproof jackets.',
  );
  check(
    'a broken envelope with no answer in it does not reach the shopper',
    shown(parseToolChoice('{"kind":"fin', decls)) ===
      'The model started an answer and did not finish it. Ask again.',
    JSON.stringify(shown(parseToolChoice('{"kind":"fin', decls))),
  );
  check(
    'a non-string text is still rendered',
    shown(parseToolChoice('{"kind":"final","text":42}', decls)) === '42',
  );

  console.log('\ntool calls are unaffected');
  const call = called(
    parseToolChoice(
      '{"kind":"tool","name":"search_catalog","args":{"query":"rain shell"}}',
      decls,
    ),
  );
  check('a tool call still becomes a function call', call?.name === 'search_catalog');
  check('its args survive intact', call?.args?.query === 'rain shell');
  check(
    'nesting survives intact',
    called(
      parseToolChoice(
        '{"kind":"tool","name":"update_cart","args":{"cart":{"line_items":[{"handle":"x"}]}}}',
        decls,
      ),
    )?.args?.cart?.line_items?.[0]?.handle === 'x',
  );
  check(
    'an unknown tool is reported, not called',
    !!shown(parseToolChoice('{"kind":"tool","name":"wire_money","args":{}}', decls))
      ?.includes('unknown tool'),
  );

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main();

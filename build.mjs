/**
 * Build script.
 *
 * This is the whole thing. `@google/adk` publishes a `browser` export
 * condition and a browser build that bundles, so a browser app imports the
 * package the way a Node app does and esbuild resolves it: no aliases, no
 * plugins, no shims for Node built-ins.
 *
 * That was not true before google/adk-js#614 and #618. An earlier version of
 * this app carried six workarounds to reach the same result. They are gone,
 * and this comment is the only trace.
 *
 *   node build.mjs [--watch] [--dev]
 */
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');
const dev = watch || process.argv.includes('--dev');

const shared = {
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome138',
  minify: !dev,
  sourcemap: dev ? true : 'linked',
  logLevel: 'info',
  logLimit: 0,
  define: { 'process.env.NODE_ENV': '"production"' },
};

const outdir = path.join(root, 'dist');
fs.mkdirSync(outdir, { recursive: true });

const targets = [
  { in: 'src/harness/harness.ts', out: 'dist/harness.js' },
  { in: 'src/ext/sidepanel.ts', out: 'dist/sidepanel.js' },
  { in: 'src/ext/service-worker.ts', out: 'dist/service-worker.js' },
  { in: 'src/ext/content-script.ts', out: 'dist/content-script.js' },
];

const STATIC = [
  ['src/ext/panel.css', 'dist/panel.css'],
  ['src/harness/harness.html', 'dist/harness.html'],
  ['src/harness/harness.css', 'dist/harness.css'],
  ['src/ext/manifest.json', 'dist/manifest.json'],
  ['src/ext/sidepanel.html', 'dist/sidepanel.html'],
];

function copyStatic() {
  for (const [from, to] of STATIC) {
    const source = path.join(root, from);
    if (!fs.existsSync(source)) continue;
    fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
    fs.copyFileSync(source, path.join(root, to));
  }
}

/**
 * The content script must be a classic script, not a module: MV3 content
 * scripts have no module loader.
 */
function optionsFor(target) {
  const isContentScript = target.in.endsWith('content-script.ts');
  return {
    ...shared,
    entryPoints: [path.join(root, target.in)],
    outfile: path.join(root, target.out),
    format: isContentScript ? 'iife' : 'esm',
  };
}

const present = targets.filter((target) =>
  fs.existsSync(path.join(root, target.in)),
);

if (watch) {
  copyStatic();
  const contexts = await Promise.all(
    present.map((target) => esbuild.context(optionsFor(target))),
  );
  await Promise.all(contexts.map((context) => context.watch()));
  fs.watch(path.join(root, 'src'), { recursive: true }, copyStatic);
  console.log('watching…');
} else {
  await Promise.all(present.map((target) => esbuild.build(optionsFor(target))));
  copyStatic();
  const total = present.reduce(
    (sum, target) => sum + fs.statSync(path.join(root, target.out)).size,
    0,
  );
  console.log(`built ${present.length} bundles, ${(total / 1024).toFixed(0)} kB`);
}

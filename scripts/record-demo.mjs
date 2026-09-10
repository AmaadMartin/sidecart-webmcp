/**
 * Records the Sidecart demo to an MP4.
 *
 * Launches Chrome, drives the *real* interface — the same input, the same
 * buttons a presenter would use — captures frames with CDP's
 * `Page.startScreencast`, and muxes them with ffmpeg.
 *
 * Screencast frames arrive only when the page changes, at irregular intervals,
 * so a naive `ffmpeg -framerate N` over the files would drift badly: pauses
 * would play back instantly and fast changes would stretch. Each frame's
 * arrival time is recorded and fed to ffmpeg's concat demuxer with an explicit
 * per-frame duration, which reproduces the real timing.
 *
 * The caption bar is added by this script, not by the app. The thing being
 * recorded is the product, not a presentation mode.
 *
 *   npm run record
 *   node scripts/record-demo.mjs --out demo.mp4 --headful
 *   node scripts/record-demo.mjs --url http://localhost:8901/harness.html
 */

import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);

function arg(name, fallback) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : fallback;
}

const outFile = path.resolve(root, arg('--out', 'demo.mp4'));
const framesDir = path.join(root, 'tmp/frames');
const URL_ = arg('--url', 'http://localhost:8901/harness.html');
const WIDTH = 1440;
const HEIGHT = 900;
const FPS = 30;

/** Finds an installed Chrome. Override with --chrome or CHROME_PATH. */
function findChrome() {
  const explicit = arg('--chrome') ?? process.env.CHROME_PATH;
  if (explicit) return explicit;

  const candidates =
    process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
        ]
      : process.platform === 'win32'
        ? [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          ]
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/opt/google/chrome/chrome',
            '/usr/bin/chromium',
          ];

  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(
      `Could not find Chrome. Tried:\n  ${candidates.join('\n  ')}\n` +
        'Pass --chrome "/path/to/chrome" or set CHROME_PATH.',
    );
  }
  return found;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 * The caption bar, injected by the recorder
 * ------------------------------------------------------------------ */

const CAPTION_CSS = `
  #rec-cap {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483647;
    padding: 14px 22px 16px;
    background: linear-gradient(to top, rgb(11 14 19 / 96%), rgb(11 14 19 / 80%));
    color: #fff; font: 15px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI',
      Roboto, Helvetica, Arial, sans-serif;
    opacity: 0; transition: opacity .28s ease;
  }
  #rec-cap.on { opacity: 1; }
  #rec-cap b { display: block; font-size: 19px; font-weight: 640;
    letter-spacing: -.01em; margin-bottom: 3px; }
  #rec-cap span { color: #b9c2ce; }
`;

async function installCaption(page) {
  await page.evaluate(
    (css) => {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.append(style);
      const bar = document.createElement('div');
      bar.id = 'rec-cap';
      document.body.append(bar);
    },
    CAPTION_CSS,
  );
}

/* ------------------------------------------------------------------ */

async function main() {
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: !argv.includes('--headful'),
    args: [
      // --disable-gpu is deliberately NOT set on a machine that has the
      // built-in model: the GPU is how it runs. Only headless Linux needs it.
      ...(process.platform === 'linux' && !argv.includes('--headful')
        ? ['--no-sandbox', '--disable-gpu']
        : []),
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${WIDTH},${HEIGHT}`,
    ],
    defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
  });

  const page = await browser.newPage();
  await page.goto(URL_, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.sidecartReady === true', {
    timeout: 30000,
  });
  await installCaption(page);

  const kind = await page.evaluate('window.sidecart.modelKind()');
  const tools = await page.evaluate('window.sidecart.toolCount()');
  console.log(`model: ${kind}   tools on page: ${tools}`);
  if (kind === 'simulated') {
    console.log(
      'NOTE: no on-device model here, so the recording will carry the\n' +
        '      SIMULATED badge. That is correct and must stay visible.',
    );
  }

  const client = await page.createCDPSession();
  const frames = [];
  let frameNo = 0;

  client.on('Page.screencastFrame', async ({ data, sessionId }) => {
    const file = path.join(
      framesDir,
      `f${String(frameNo++).padStart(5, '0')}.jpg`,
    );
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, t: Date.now() });
    try {
      await client.send('Page.screencastFrameAck', { sessionId });
    } catch {
      /* the cast may already have stopped */
    }
  });

  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 92,
    maxWidth: WIDTH,
    maxHeight: HEIGHT,
    everyNthFrame: 1,
  });

  const started = Date.now();
  await runScript(page);
  const seconds = (Date.now() - started) / 1000;

  await client.send('Page.stopScreencast');
  await sleep(400);
  await browser.close();

  console.log(`captured ${frames.length} frames over ${seconds.toFixed(1)}s`);
  if (frames.length < 10) throw new Error('too few frames captured');

  await encode(frames);
  console.log(`\nwrote ${outFile}`);
}

/* ------------------------- the demo script ------------------------- */

async function runScript(page) {
  const run = (fn, ...args) => page.evaluate(fn, ...args);
  const cap = async (title, sub = '') => {
    await run(
      (t, s) => {
        const bar = document.getElementById('rec-cap');
        bar.innerHTML = `<b></b><span></span>`;
        bar.querySelector('b').textContent = t;
        bar.querySelector('span').textContent = s;
        bar.classList.add('on');
      },
      title,
      sub,
    );
  };
  const hide = () =>
    run(() => document.getElementById('rec-cap').classList.remove('on'));

  /**
   * Types a question, sends it, and waits for the turn however long it takes.
   *
   * A real on-device model answers in seconds, not milliseconds, and a turn
   * that needs two tools runs three inference calls. Waiting on a fixed sleep
   * would capture a half-finished panel, so this waits on state and fails
   * loudly rather than recording a broken take.
   */
  const ask = async (question, pause = 900) => {
    await run((q) => window.sidecart.type(q), question);
    await sleep(pause);
    await run(() => window.sidecart.submit());
    const result = await run(() => window.sidecart.settled());
    if (result.state === 'timeout') {
      throw new Error(
        `The assistant did not finish "${question}" within ` +
          `${Math.round(result.ms / 1000)}s. If the model is real and the ` +
          'machine is slow, raise the budget in window.sidecart.settled.',
      );
    }
    console.log(`  "${question}" -> ${result.state} in ${result.ms} ms`);
    return result.state;
  };

  // 1. The premise ----------------------------------------------------
  await cap(
    'This store publishes its own agent tools',
    'Shopify registers ten WebMCP tools on every storefront. The merchant did nothing.',
  );
  await sleep(4200);

  // 2. An ordinary question -------------------------------------------
  await cap('Ask it something', 'The model runs in the browser, on this device.');
  await ask('what waterproof jackets do you have?');
  await sleep(1200);

  const funnel = await run(() => window.sidecart.funnel());
  console.log(`  funnel: ${funnel}`);
  await cap(
    'Ten tools do not fit a small model',
    'Their descriptions and schemas are 10,469 characters. Only what the question needs is sent.',
  );
  await sleep(4600);

  // 3. A different question picks different tools ---------------------
  await hide();
  await cap('A different question, a different tool', '');
  await ask('what is your return policy?');
  await sleep(3000);

  // 4. The attack ------------------------------------------------------
  await cap(
    'Now a listing that targets the assistant',
    'Its title tells the assistant to add something else, and not to mention it.',
  );
  await run(() => window.sidecart.setInjection(true));
  await sleep(4200);

  await hide();
  await ask('add the alpine glove liner to my cart');
  await sleep(900);

  const approval = await run(() => window.sidecart.approval());
  console.log('  approval:', JSON.stringify(approval));
  if (!approval) throw new Error('the confirmation card never appeared');

  await cap(
    'The assistant fell for it. Nothing happened anyway.',
    'The cart change is held. The line you never asked for is marked.',
  );
  await sleep(5200);

  // 5. The resolution ---------------------------------------------------
  await cap('You decide what goes in', 'Add only the item you asked for.');
  await sleep(2600);

  const before = await run(() => window.sidecart.cart());
  await run(() => window.sidecart.choose('Add only'));
  // The tool runs as soon as it is approved, so watch the cart rather than
  // guessing how long the model takes to write its closing sentence.
  const changed = await run((t) => window.sidecart.cartChanged(t), before.total);
  if (changed === null) throw new Error('The cart never changed after approval.');
  await sleep(1800);

  const cart = await run(() => window.sidecart.cart());
  console.log('  cart:', JSON.stringify(cart));
  await cap(
    `One item in the cart. ${cart.total}.`,
    'The model proposes. A person confirms. That holds even when the model is fooled.',
  );
  await sleep(4800);
  await hide();
  await sleep(900);
}

/* ---------------------------- encoding ---------------------------- */

/**
 * Encodes with the concat demuxer and explicit per-frame durations, so the
 * playback timing matches what actually happened.
 */
async function encode(frames) {
  const listFile = path.join(framesDir, 'frames.txt');
  const lines = [];
  for (let i = 0; i < frames.length; i++) {
    const next = frames[i + 1]?.t ?? frames[i].t + 1000 / FPS;
    const duration = Math.max((next - frames[i].t) / 1000, 1 / FPS);
    lines.push(`file '${frames[i].file}'`);
    lines.push(`duration ${duration.toFixed(4)}`);
  }
  // The concat demuxer ignores the final duration unless the last file repeats.
  lines.push(`file '${frames[frames.length - 1].file}'`);
  fs.writeFileSync(listFile, lines.join('\n'));

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  await new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      'ffmpeg',
      [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', listFile,
        // The concat demuxer supplies per-frame durations, so the input is
        // variable rate. Resampling to a constant rate here keeps the file
        // playable everywhere, including in slide decks. ffmpeg 8 rejects the
        // older `-vsync vfr` alongside `-r`.
        '-fps_mode', 'cfr',
        '-r', String(FPS),
        '-c:v', 'libx264',
        '-preset', 'slow',
        '-crf', '20',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        outFile,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    ffmpeg.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    ffmpeg.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg exited ${code}\n${stderr.slice(-2000)}`)),
    );
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

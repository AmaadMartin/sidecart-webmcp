/**
 * The offline demo page: a storefront on the left, the assistant on the right.
 *
 * The storefront registers Shopify's real WebMCP tools. When the browser
 * supports `document.modelContext.registerTool`, registration goes through it
 * and the assistant discovers the tools the way it would on a real store. When
 * it does not, an in-process bridge serves the same descriptors, so the demo
 * still runs and the code under it is unchanged.
 */

import { ShoppingAssistant } from '../core/agent.js';
import { productArt } from './product-art.js';
import { getPageBridge, parseInputSchema } from '../core/webmcp.js';
import type { WebMcpBridge } from '../core/webmcp.js';
import { createModel } from '../model/create-model.js';
import { Panel } from '../ui/panel.js';
import {
  CARE_PLAN,
  localBridge,
  POISONED_PRODUCT,
  registerWithBrowser,
  RidgelineStore,
} from './store.js';

const store = new RidgelineStore();
const money = (value: number) => `$${value.toFixed(2)}`;

/* ---------------------------------------------------------------- *
 * Storefront rendering
 * ---------------------------------------------------------------- */

const grid = document.getElementById('grid')!;
const cartList = document.getElementById('cart-list')!;
const cartCount = document.getElementById('cart-count')!;
const cartTotal = document.getElementById('cart-total')!;
const cartChip = document.getElementById('cart-chip')!;
const productCount = document.getElementById('product-count')!;

/** Real stores drop the cents when a price is whole. */
const price = (value: number) =>
  Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;

function renderStore(): void {
  grid.innerHTML = '';
  for (const product of store.products) {
    const poisoned = product.handle === POISONED_PRODUCT.handle;
    const card = document.createElement('article');
    card.className = `hs-card${poisoned ? ' is-flagged' : ''}`;
    // A product card carries a picture, a name and a price. The spec copy
    // that used to sit here appears on no real listing page.
    card.innerHTML = `
      <div class="hs-thumb">${productArt(product.handle)}</div>
      <div class="hs-card-body">
        <p class="hs-card-title"></p>
        <p class="hs-card-note"></p>
        <p class="hs-card-price">${price(product.price)}</p>
        ${poisoned ? '<span class="hs-card-flag">Listing text targets the assistant</span>' : ''}
      </div>
    `;
    card.querySelector('.hs-card-title')!.textContent = product.title;
    card.querySelector('.hs-card-note')!.textContent = product.variant;
    grid.append(card);
  }

  productCount.textContent = String(store.products.length);

  const lines = store.lines;
  cartCount.textContent = String(lines.reduce((n, l) => n + l.quantity, 0));
  cartTotal.textContent = money(store.total);

  cartList.innerHTML = '';
  if (!lines.length) {
    const empty = document.createElement('p');
    empty.className = 'hs-empty';
    empty.textContent = 'The cart is empty.';
    cartList.append(empty);
    return;
  }
  for (const line of lines) {
    const unexpected = line.handle === CARE_PLAN.handle;
    const row = document.createElement('div');
    row.className = `hs-line${unexpected ? ' is-unexpected' : ''}`;
    row.innerHTML = `
      <span class="hs-line-title"></span>
      <span>
        ${unexpected ? '<span class="hs-line-note">not asked for</span> ' : ''}
        × ${line.quantity} · ${money(line.price * line.quantity)}
      </span>
    `;
    row.querySelector('.hs-line-title')!.textContent = line.title;
    cartList.append(row);
  }
}

store.onChange = () => {
  renderStore();
  cartChip.classList.add('is-hot');
  setTimeout(() => cartChip.classList.remove('is-hot'), 900);
};

document.getElementById('inject-toggle')!.addEventListener('change', (event) => {
  store.setInjection((event.target as HTMLInputElement).checked);
});

document.getElementById('reset')!.addEventListener('click', () => {
  store.reset();
  location.reload();
});

/* ---------------------------------------------------------------- *
 * Wiring
 * ---------------------------------------------------------------- */

async function main(): Promise<void> {
  renderStore();

  const bannerText = document.getElementById('webmcp-status')!;

  const registered = await registerWithBrowser(store);
  let bridge: WebMcpBridge;
  if (registered && getPageBridge()) {
    bridge = getPageBridge()!;
    bannerText.textContent = 'WebMCP live · document.modelContext';
  } else {
    bridge = localBridge(store);
    bannerText.textContent = 'WebMCP not in this browser · tools served in process';
  }

  const { model, status } = await createModel();
  const panel = new Panel({
    root: document.getElementById('panel')!,
    status,
    storeName: 'Ridgeline Supply',
    suggestions: [
      'what waterproof jackets do you have?',
      'add the cirrus down jacket to my cart',
      'what is your return policy?',
      "what's in my cart?",
    ],
  });

  const assistant = new ShoppingAssistant({
    bridge,
    model,
    approve: panel.approve,
    onUpdate: panel.onUpdate,
  });
  panel.attach(assistant);

  const surface = await assistant.availableTools();
  panel.showSurface(
    surface.length,
    surface.reduce(
      (sum, tool) =>
        sum +
        tool.description.length +
        JSON.stringify(parseInputSchema(tool.descriptor)).length,
      0,
    ),
  );
  console.info(
    `[sidecart] ${surface.length} WebMCP tools discovered on this page.`,
  );

  // A handle for the screen recorder, which drives the real interface rather
  // than a special demo mode: it types into the same input and clicks the same
  // buttons a presenter would. Nothing here changes how the app behaves.
  (window as unknown as { sidecart: unknown }).sidecart = {
    modelKind: () => status.kind,
    toolCount: () => surface.length,
    /** Types a question one character at a time, so the video looks human. */
    async type(text: string, msPerChar = 45) {
      const input = document.querySelector<HTMLInputElement>('.sc-input')!;
      input.focus();
      input.value = '';
      for (const char of text) {
        input.value += char;
        await new Promise((r) => setTimeout(r, msPerChar));
      }
    },
    submit() {
      document.querySelector<HTMLFormElement>('.sc-composer')!.requestSubmit();
    },
    /**
     * Resolves once the assistant has finished, or a card is waiting.
     *
     * Two things here matter on a machine with a real model, and neither did
     * against the scripted stand-in.
     *
     * It waits for the turn to *start* before waiting for it to end.
     * `submit()` disables the send button asynchronously, so polling straight
     * after it could see a still-enabled button and report 'done' before a
     * single token had been generated.
     *
     * And the budget is generous. One turn can be three inference calls — the
     * tool selection, the tool-calling turn and the reply — and a cold session
     * on real hardware takes seconds per call, not milliseconds.
     */
    async settled(timeoutMs = 180000) {
      const began = Date.now();
      const idle = () => {
        const button = document.querySelector<HTMLButtonElement>('.sc-send');
        return !!button && !button.disabled;
      };
      // Phase one: wait for it to pick the turn up, briefly.
      while (Date.now() - began < 3000 && idle()) {
        if (document.querySelector('.sc-approval')) break;
        await new Promise((r) => setTimeout(r, 40));
      }
      // Phase two: wait for it to put the turn down.
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        if (document.querySelector('.sc-approval')) {
          return { state: 'approval', ms: Date.now() - started };
        }
        if (idle()) return { state: 'done', ms: Date.now() - started };
        await new Promise((r) => setTimeout(r, 120));
      }
      return { state: 'timeout', ms: Date.now() - started };
    },

    /** Resolves once the cart total changes, or the budget runs out. */
    async cartChanged(from: string, timeoutMs = 60000) {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const now = document.getElementById('cart-total')?.textContent ?? '';
        if (now !== from) return now;
        await new Promise((r) => setTimeout(r, 100));
      }
      return null;
    },
    approval() {
      const card = document.querySelector('.sc-approval');
      if (!card) return null;
      return {
        title: card.querySelector('.sc-approval-title')?.textContent?.trim(),
        items: [...card.querySelectorAll('.sc-item')].map((item) =>
          item.textContent?.replace(/\s+/g, ' ').trim(),
        ),
        buttons: [...card.querySelectorAll('button')].map((b) =>
          b.textContent?.trim(),
        ),
      };
    },
    /** Clicks a confirmation button by its visible label. */
    choose(label: string) {
      const buttons = [
        ...document.querySelectorAll<HTMLButtonElement>('.sc-approval button'),
      ];
      const match = buttons.find((b) => b.textContent?.includes(label));
      if (!match) throw new Error(`No approval button matching "${label}".`);
      match.click();
    },
    setInjection(on: boolean) {
      const box = document.getElementById('inject-toggle') as HTMLInputElement;
      if (box.checked !== on) box.click();
    },
    funnel() {
      return document
        .querySelector('.sc-funnel')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim();
    },
    cart() {
      return {
        count: document.getElementById('cart-count')?.textContent,
        total: document.getElementById('cart-total')?.textContent,
      };
    },
  };
  (window as unknown as { sidecartReady: boolean }).sidecartReady = true;
}

void main();

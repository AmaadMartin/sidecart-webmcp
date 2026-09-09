/**
 * The assistant panel.
 *
 * Shared by the extension side panel and the offline harness, so both show the
 * same thing and there is only one interface to get right.
 *
 * Three things on screen are non-negotiable, and none of them are decoration:
 *
 *   1. **The model badge.** It says whether answers came from Chrome's model or
 *      from the scripted stand-in. Simulated output must never be able to pass
 *      as inference.
 *   2. **The funnel line.** It shows how many of the page's tools were handed
 *      to the model, and how much of the context that cost. It is the whole
 *      technical argument, made visible.
 *   3. **The confirmation card.** Nothing reaches the cart without it, and it
 *      shows the exact arguments, so a smuggled line item is visible.
 */

import type { ShoppingAssistant, TurnUpdate } from '../core/agent.js';
import type { ApprovalDecision, PendingApproval } from '../core/guard.js';
import type { ModelStatus } from '../model/create-model.js';

export interface PanelOptions {
  root: HTMLElement;
  status: ModelStatus;
  /** Store name shown in the header. */
  storeName: string;
  /** Suggested opening questions. */
  suggestions?: string[];
}

const escape = (text: string): string =>
  text.replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );

export class Panel {
  private thread!: HTMLElement;
  private input!: HTMLInputElement;
  private send!: HTMLButtonElement;
  private current?: HTMLElement;
  private busy = false;
  private assistant?: ShoppingAssistant;
  private surface?: HTMLElement;

  constructor(private readonly options: PanelOptions) {
    this.render();
  }

  /**
   * Shows the page's tool surface before anything is asked.
   *
   * At rest the panel was an empty white column, and the figure carrying the
   * whole technical argument did not exist until someone typed a question.
   * The number is true the moment the page loads, so it is shown then.
   */
  showSurface(tools: number, chars: number): void {
    const node = document.createElement('div');
    node.className = 'sc-surface';
    node.innerHTML = `
      <p class="sc-surface-fig">${fmtChars(chars)}<span>chars of tools</span></p>
      <p class="sc-surface-sub">
        ${tools} tools on this page. More than this model can hold at once.
      </p>
    `;
    // Above the thread, not inside it. It describes the page rather than the
    // conversation, and inside a bottom-anchored thread it left a void above.
    this.surface = node;
    this.thread.before(node);
  }

  /**
   * Attaches the assistant.
   *
   * Separate from the constructor because the assistant needs this panel's
   * approval prompt and update handler, and the panel needs the assistant.
   * One of them has to exist first, and it is cheaper for the panel to wait
   * than for the assistant to hold a mutable callback.
   */
  attach(assistant: ShoppingAssistant): void {
    this.assistant = assistant;
  }

  /** The approval prompt to hand to the assistant. */
  readonly approve = (request: PendingApproval): Promise<ApprovalDecision> =>
    new Promise((resolve) => this.showApproval(request, resolve));

  private render(): void {
    const { root, status, storeName } = this.options;
    const simulated = status.kind === 'simulated';

    root.innerHTML = `
      <div class="sc-panel">
        <header class="sc-head">
          <div class="sc-brand">
            <span class="sc-mark" aria-hidden="true"></span>
            <span class="sc-name">Sidecart</span>
          </div>
          <span class="sc-badge ${simulated ? 'is-sim' : 'is-live'}"
                title="${escape(status.detail)}">
            ${simulated ? 'SIMULATED · NOT A MODEL' : 'ON-DEVICE'}
          </span>
        </header>

        ${
          simulated
            ? `<details class="sc-warn">
                 <summary>
                   <b>No language model is running.</b>
                   Every answer below comes from a fixed script.
                 </summary>
                 <p>${escape(status.detail)}</p>
               </details>`
            : ''
        }

        <p class="sc-store">
          Driving <strong>${escape(storeName)}</strong> through its own tools.
        </p>

        <div class="sc-thread" role="log" aria-live="polite"></div>

        <form class="sc-composer">
          <input class="sc-input" type="text" autocomplete="off"
                 placeholder="Ask about this store…" aria-label="Ask about this store" />
          <button class="sc-send" type="submit">Ask</button>
        </form>
        <p class="sc-foot">
          ${
            simulated
              ? 'No model is running here.'
              : 'No model server is involved. The reasoning happens on this device.'
          }
          Search terms go to the store, the same as using its search box.
          Nothing reaches your cart until you confirm it.
        </p>
      </div>
    `;

    this.thread = root.querySelector('.sc-thread')!;
    this.input = root.querySelector('.sc-input')!;
    this.send = root.querySelector('.sc-send')!;

    root.querySelector('.sc-composer')!.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.submit(this.input.value);
    });

    this.showSuggestions();
  }

  /** Shows a standing message above the composer. */
  notice(text: string): void {
    const existing = this.options.root.querySelector('.sc-notice');
    existing?.remove();
    const node = document.createElement('p');
    node.className = 'sc-notice';
    node.textContent = text;
    this.thread.before(node);
  }

  private showSuggestions(): void {
    const suggestions = this.options.suggestions ?? [];
    if (!suggestions.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'sc-suggests';
    wrap.innerHTML = `<p class="sc-suggests-label">Try</p>`;
    for (const suggestion of suggestions) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'sc-chip';
      chip.textContent = suggestion;
      chip.addEventListener('click', () => void this.submit(suggestion));
      wrap.append(chip);
    }
    this.thread.append(wrap);
  }

  private async submit(raw: string): Promise<void> {
    const query = raw.trim();
    const assistant = this.assistant;
    if (!query || this.busy || !assistant) return;
    this.busy = true;
    this.input.value = '';
    this.send.disabled = true;
    this.thread.querySelector('.sc-suggests')?.remove();

    // Once there is a conversation, each turn reports its own figure, so the
    // resting one is redundant and it was clipping the scrolling thread.
    this.surface?.remove();
    this.surface = undefined;

    this.addUser(query);
    this.current = this.addAssistant();

    try {
      const result = await assistant.ask(query);
      this.setText(result.text);
      this.setMeta(`${result.ms} ms`);
    } catch (error) {
      this.setText(
        `Something failed while answering: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.busy = false;
      this.send.disabled = false;
      this.input.focus();
    }
  }

  /** Handles progress from the assistant. */
  readonly onUpdate = (update: TurnUpdate): void => {
    const host = this.current;
    if (!host) return;
    const steps = host.querySelector('.sc-steps')!;

    switch (update.type) {
      case 'status':
        host.querySelector('.sc-text')!.textContent = update.text;
        break;

      case 'funnel': {
        const { trace } = update;
        const row = document.createElement('div');
        row.className = 'sc-step sc-funnel';
        row.innerHTML = `
          <p class="sc-figure">
            <span class="sc-figure-was">${fmtChars(trace.fullSurfaceChars)}</span>
            <span class="sc-figure-arrow">→</span>
            <span class="sc-figure-now">${fmtChars(trace.equippedChars)}</span>
            <span class="sc-figure-unit">chars of tools</span>
          </p>
          <p class="sc-figure-sub">
            ${trace.totalTools} on this page
            <span class="sc-arrow">→</span> menu ${fmtChars(trace.menuChars)}
            <span class="sc-arrow">→</span> ${trace.equipped.length} sent to the model
          </p>
        `;
        steps.append(row);
        break;
      }

      case 'tool-start': {
        const row = document.createElement('div');
        row.className = 'sc-step sc-tool';
        row.dataset['tool'] = update.tool;
        row.innerHTML = `
          <span class="sc-spinner" aria-hidden="true"></span>
          <code class="sc-tool-name">${escape(update.tool)}</code>
          <span class="sc-tool-args">${escape(summarise(update.args))}</span>
          <button type="button" class="sc-raw" title="Show the exact arguments"
                  data-raw="${escape(JSON.stringify(update.args))}">json</button>
        `;
        steps.append(row);
        this.bindRawButtons(row);
        break;
      }

      case 'tool-end': {
        const row = steps.querySelector<HTMLElement>(
          `.sc-tool[data-tool="${CSS.escape(update.tool)}"]:not(.is-done)`,
        );
        if (!row) break;
        row.classList.add('is-done');
        row.querySelector('.sc-spinner')?.remove();
        const tick = document.createElement('span');
        tick.className = 'sc-tick';
        tick.textContent = '✓';
        row.prepend(tick);
        if (update.untrusted) {
          const flag = document.createElement('span');
          flag.className = 'sc-untrusted';
          flag.textContent = 'third-party text';
          flag.title =
            'The page marked this tool\'s output as content it does not control.';
          row.append(flag);
        }
        break;
      }

      case 'guard': {
        if (update.event.kind === 'allowed') break;
        const row = document.createElement('div');
        // Reading third-party text is normal and happens on almost every turn.
        // It is only worth alarm when the text tried something, so the quiet
        // case stays quiet and the loud case keeps its meaning.
        const quiet =
          update.event.kind === 'untrusted-read' && !update.event.detail;
        row.className = `sc-step sc-guard is-${update.event.kind}${
          quiet ? ' is-quiet' : ''
        }`;
        row.textContent = guardLine(update.event.kind, update.event.tool, update.event.detail);
        steps.append(row);
        break;
      }

      case 'text':
        this.setText(update.text);
        break;
    }
    this.scroll();
  };

  private addUser(text: string): void {
    const node = document.createElement('div');
    node.className = 'sc-msg is-user';
    node.textContent = text;
    this.thread.append(node);
    this.scroll();
  }

  private addAssistant(): HTMLElement {
    const node = document.createElement('div');
    node.className = 'sc-msg is-assistant';
    node.innerHTML = `<div class="sc-steps"></div><div class="sc-text">Working…</div><div class="sc-meta"></div>`;
    this.thread.append(node);
    this.scroll();
    return node;
  }

  /** Reveals the exact arguments behind a tool row. */
  private bindRawButtons(row: HTMLElement): void {
    row.querySelector('.sc-raw')?.addEventListener('click', (event) => {
      const button = event.currentTarget as HTMLElement;
      const existing = row.querySelector('.sc-raw-body');
      if (existing) {
        existing.remove();
        return;
      }
      const pre = document.createElement('pre');
      pre.className = 'sc-raw-body';
      pre.textContent = JSON.stringify(
        JSON.parse(button.dataset['raw'] ?? '{}'),
        null,
        2,
      );
      row.append(pre);
    });
  }

  private setText(text: string): void {
    const target = this.current?.querySelector('.sc-text');
    if (target) target.textContent = text;
  }

  private setMeta(text: string): void {
    const target = this.current?.querySelector('.sc-meta');
    if (target) target.textContent = text;
  }

  private showApproval(
    request: PendingApproval,
    resolve: (decision: ApprovalDecision) => void,
  ): void {
    const card = document.createElement('div');
    const suspect = request.items.filter((item) => !item.inRequest);
    const wanted = request.items.filter((item) => item.inRequest);
    const alarming = request.afterUntrustedContent && suspect.length > 0;
    card.className = `sc-approval${alarming ? ' is-alarming' : ''}`;

    const rows = request.items
      .map((item) => {
        const cost =
          typeof item.price === 'number'
            ? money(item.price * item.quantity)
            : 'price unknown';
        return `
          <li class="sc-item${item.inRequest ? '' : ' is-suspect'}">
            <span class="sc-item-name">${escape(cleanName(item.title ?? item.ref))}</span>
            <span class="sc-item-cost${
              typeof item.price === 'number' ? '' : ' is-unknown'
            }">${item.quantity > 1 ? `× ${item.quantity} ` : ''}${escape(cost)}</span>
            <span class="sc-item-note${item.inRequest ? ' is-ok' : ''}">${
              item.inRequest
                ? 'You asked for this'
                : `You did not ask for this${
                    item.known ? '' : ' · never appeared in the results'
                  }`
            }</span>
          </li>`;
      })
      .join('');

    // One action is right, one is safe, one is dangerous. They should not
    // look alike, and the dangerous one should not be the biggest target.
    const canSplit = alarming && wanted.length > 0;
    card.innerHTML = `
      <p class="sc-approval-title">${
        alarming
          ? 'This would add something you did not ask for'
          : 'Confirm this change'
      }</p>
      ${
        request.items.length
          ? `<ul class="sc-items">${rows}</ul>`
          : `<pre class="sc-approval-args">${escape(
              JSON.stringify(request.args, null, 2),
            )}</pre>`
      }
      ${
        typeof request.total === 'number'
          ? `<p class="sc-total"><span>Total</span><b>${escape(
              money(request.total),
            )}</b></p>`
          : ''
      }
      <p class="sc-approval-tool">Runs <code>${escape(request.tool)}</code></p>
      <div class="sc-approval-actions">
        ${
          canSplit
            ? `<button type="button" class="sc-btn is-primary" data-decision="only-asked">
                 Add only ${escape(cleanName(wanted[0]!.title ?? wanted[0]!.ref, 28))}
               </button>`
            : ''
        }
        <button type="button" class="sc-btn${canSplit ? '' : ' is-primary'}"
                data-decision="none">Add nothing</button>
        <button type="button" class="sc-link" data-decision="all">${
          alarming
            ? 'Add everything anyway'
            : typeof request.total === 'number'
              ? `Confirm — ${escape(money(request.total))}`
              : 'Confirm'
        }</button>
      </div>
    `;

    this.setText(
      alarming
        ? 'Stopped. Check this before it runs.'
        : 'Waiting for you to confirm.',
    );

    const notes: Record<ApprovalDecision, string> = {
      all: 'Confirmed. Running it…',
      'only-asked': 'Adding only what you asked for…',
      none: 'Cancelled. Nothing was added.',
    };
    for (const button of card.querySelectorAll<HTMLButtonElement>('[data-decision]')) {
      button.addEventListener('click', () => {
        const decision = button.dataset['decision'] as ApprovalDecision;
        card.remove();
        this.setText(notes[decision]);
        resolve(decision);
      });
    }

    (this.current ?? this.thread).append(card);
    card.querySelector<HTMLButtonElement>('.is-primary')?.focus();
    card.scrollIntoView({ block: 'nearest' });
    this.scroll();
  }

  private scroll(): void {
    this.thread.scrollTop = this.thread.scrollHeight;
  }
}

/**
 * A product name fit to print.
 *
 * An attacked listing carries its payload inside the title, so rendering the
 * raw title puts the attack text where the product name belongs, and a plain
 * truncation cuts it mid-instruction. The bracketed part is dropped here; the
 * steps block above already reports what the text tried to do.
 */
function cleanName(text: string, limit = 46): string {
  const stripped = text
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const name = stripped || text.trim();
  return name.length > limit ? `${name.slice(0, limit - 1).trimEnd()}…` : name;
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function fmtChars(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : `${count}`;
}

function guardLine(kind: string, tool: string, detail?: string): string {
  switch (kind) {
    case 'held':
      return `Held ${tool}. ${detail ?? 'Waiting for you.'}`;
    case 'approved':
      return detail ? `You allowed ${tool}: ${detail}.` : `You confirmed ${tool}.`;
    case 'refused':
      return `Blocked ${tool}.`;
    case 'untrusted-read':
      return detail
        ? `Page text tried to give orders: ${detail}`
        : 'Read text the store does not control';
    default:
      return `${kind} ${tool}`;
  }
}

/**
 * A readable preview of tool arguments.
 *
 * Raw JSON is what makes a panel look like a log viewer. The exact payload is
 * still one click away, behind the `json` button.
 */
function summarise(args: Record<string, unknown>): string {
  const parts: string[] = [];
  const walk = (value: unknown, key?: string): void => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((entry) => walk(entry, key));
      return;
    }
    if (typeof value === 'object') {
      for (const [childKey, child] of Object.entries(value)) {
        walk(child, childKey);
      }
      return;
    }
    if (key && key !== 'limit') parts.push(`${key} ${String(value)}`);
  };
  walk(args);
  const text = parts.slice(0, 3).join(', ');
  return text.length > 72 ? `${text.slice(0, 71)}…` : text;
}

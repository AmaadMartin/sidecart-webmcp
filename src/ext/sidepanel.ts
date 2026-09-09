/**
 * The side panel: where the model and the agent loop live.
 *
 * The panel cannot see the storefront's WebMCP tools directly, because tools
 * belong to a document and this is a different one. {@link tabBridge} stands
 * in for `document.modelContext`, forwarding every call to the content script
 * running in the active tab.
 *
 * That indirection is the whole reason `WebMcpBridge` is an interface rather
 * than a direct reference to the page API: the agent, the funnel and the guard
 * cannot tell whether they are talking to a page or to a message port.
 */

import { ShoppingAssistant } from '../core/agent.js';
import type { WebMcpBridge, WebMcpDescriptor } from '../core/webmcp.js';
import { createModel } from '../model/create-model.js';
import { Panel } from '../ui/panel.js';

interface Reply {
  ok: boolean;
  error?: string;
  tools?: WebMcpDescriptor[];
  result?: string;
  webmcp?: boolean;
  host?: string;
}

/** Sends one message to the content script in the active tab. */
async function ask(message: unknown): Promise<Reply> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined) {
    return { ok: false, error: 'No active tab.' };
  }
  try {
    return (await chrome.tabs.sendMessage(tab.id, message)) as Reply;
  } catch {
    return {
      ok: false,
      error:
        'Could not reach this page. Reload the tab after installing the ' +
        'extension, and note that Chrome pages cannot be scripted.',
    };
  }
}

/** A `WebMcpBridge` backed by the content script in the active tab. */
function tabBridge(): WebMcpBridge {
  const listeners: Array<() => void> = [];

  chrome.runtime.onMessage.addListener((message: { kind?: string }) => {
    if (message?.kind === 'sidecart:toolchange') {
      listeners.forEach((listener) => listener());
    }
  });

  return {
    async getTools() {
      const reply = await ask({ kind: 'sidecart:list' });
      if (!reply.ok) throw new Error(reply.error ?? 'Could not list tools.');
      return reply.tools ?? [];
    },
    async executeTool(tool, args) {
      const reply = await ask({
        kind: 'sidecart:call',
        tool: tool.name,
        args,
      });
      if (!reply.ok) throw new Error(reply.error ?? 'The tool failed.');
      return reply.result ?? null;
    },
    addEventListener(_type, listener) {
      listeners.push(listener);
    },
    removeEventListener(_type, listener) {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
  };
}

const SUGGESTIONS = [
  'what do you sell?',
  "what's in my cart?",
  'what is your return policy?',
];

async function main(): Promise<void> {
  const root = document.getElementById('panel')!;
  const probe = await ask({ kind: 'sidecart:ping' });
  const { model, status } = await createModel();

  const panel = new Panel({
    root,
    status,
    storeName: probe.host ?? 'this page',
    suggestions: SUGGESTIONS,
  });

  const assistant = new ShoppingAssistant({
    bridge: tabBridge(),
    model,
    approve: panel.approve,
    onUpdate: panel.onUpdate,
  });
  panel.attach(assistant);

  if (!probe.webmcp) {
    panel.notice(
      'This page does not register WebMCP tools, so there is nothing to ' +
        'drive. Open a Shopify storefront and reload it.',
    );
  }
}

void main();

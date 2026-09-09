# Running the Sidecart demo

## The one sentence

Shopify put agent tools on every storefront, Chrome put a model in the browser,
and ADK is the loop between them — running on the device, with a human gate in
front of the cart.

---

## Before demo day

**1. Check the machine.** Run `npm run doctor`, or open DevTools anywhere and
run `await LanguageModel.availability()`. The panel badge reads `ON-DEVICE` when
the model is live and `SIMULATED · NOT A MODEL` when it is not.

**2. Trigger the download the day before.** First use downloads several GB. Not
on stage.

**3. Rehearse against the harness.** `npm run serve`, then
<http://localhost:8901/harness.html>. It serves from your own machine, so
conference wifi cannot break it. Leave this tab open during the talk, and ask
it one warm-up question, so the 3:30 beat is not a cold session's first call.

**4. Open a real Shopify store too, and reload the tab.** The content script
does not attach to tabs that were already open. Any Liquid storefront works;
`allbirds.com` is a known-good one.

**5. Learn the shortcut.** **Ctrl+Shift+U**, or **Cmd+Shift+U** on macOS, opens
the panel. The toolbar icon works too.

**6. Record a backup video.** Non-negotiable. Chrome evicts the model when free
disk drops below 10 GB.

**7. Decide your fallback line.** If the model is gone, the badge says so and
everything still runs. Say it out loud: *"no model on this machine right now, so
the reasoning is scripted — the tools, the funnel and the gate are all real."*
Never let scripted output be taken for inference.

---

## Six minutes

| Time | Beat | The point |
|---|---|---|
| 0:00 | Open a **real Shopify store**, already loaded, DevTools already on the console. Run `await document.modelContext.getTools()`. Ten tools come back. | Not our tools. Shopify ships these on every storefront, and no merchant asked for them. |
| 0:40 | Open the panel. Ask *"what waterproof jackets do you have?"* | It answers from the store's own data. No DOM scraping. |
| 1:10 | Point at the big figure in the panel: `10.5k → 645 chars of tools`. | **The technical beat.** Ten tools are 10,469 characters. The on-device model cannot hold that. We send a one-line menu, ask which tools apply, and equip only those. The second number changes per question — one tool for a search, two for a cart change — so read whatever is on screen. |
| 1:50 | Open DevTools → Network. No model traffic. Point at the catalog calls that *are* there. | Say it precisely: there is no model server, and the search request is the store's own — the same one its search box makes. Do not say offline. |
| 2:20 | Ask *"add the cirrus down jacket to my cart"*. Confirmation card appears. Click confirm. Cart updates. | It is an agent, and a person is in the loop. |
| 3:00 | Switch to the harness tab, which you left open and warmed up. Tick **Add a listing that tries to instruct the assistant**. | Show the poisoned product card. Read the title out loud. |
| 3:30 | Ask *"add the alpine glove liner to my cart"*. | **The money shot.** The assistant reads the listing, is told to secretly add a care plan, and proposes exactly that. |
| 4:10 | Let the card sit on screen. | It stopped. It shows both line items. It marks the one you never asked for, and says it was never in the results. |
| 4:40 | Click **Add only Alpine Glove Liner**. Cart gets one item. | The gate is not all-or-nothing. The shopper still gets what they wanted. |
| 5:10 | Show `src/core/guard.ts`, the `beforeTool` callback. Returning a record makes ADK skip the tool. | The guarantee lives outside the model, because it cannot live inside one. |
| 5:40 | Name `src/model/chrome-prompt-llm.ts`. | Chrome returns strings; ADK needs function calls; the adapter builds them from constrained decoding. Upstream as #843. |

---

## What to say about the numbers

**10,469 characters** is measured, on a live Shopify storefront: ten tools,
their descriptions and their JSON schemas. The harness uses the same
definitions copied verbatim, so it reports the same figure.

The second number is not fixed. It is whatever the funnel equipped for that
question — about 650 characters for a catalog search, about 2,400 for a cart
change. Read what is on screen rather than a number you memorized.

Say **characters**, not tokens, and not cost. There is no token meter here, so
there is no baseline and no cost claim to make.

---

## Lines that land

- "Shopify shipped these tools to every storefront. We did not ask them to."
- "The model never touches your cart. It asks, and you answer."
- "Ten tools is ten thousand characters. That is fine for a cloud model and
  fatal for this one."
- "A tool that was never equipped cannot be called. Narrowing started as a
  context optimization and ended up as a safety property."

---

## Do not claim

- **That it is offline.** The reasoning is local; the catalog calls are not.
  This is the easiest thing to get wrong, and the easiest to be corrected on.
- **That the shopper's words stay on the device.** They do not. The search terms
  go to the store's own `search_catalog`, exactly as its search box would. What
  never leaves is model traffic, because there is no model server.
- **A cost saving.** No token meter, no baseline, no number.
- **That the model is Gemma.** Chrome's docs say Gemini Nano. Use that.
- **That prompt injection is solved.** It is not, and Chrome's own guidance says
  so. What is solved is that a fooled model still cannot spend money.
- **That simulated output is model output.** Ever.

---

## If something breaks

| Symptom | Cause | Do this |
|---|---|---|
| Badge reads `SIMULATED · NOT A MODEL` | No usable model | Say so, keep going. Everything else is real. |
| "This page does not register WebMCP tools" | Not a WebMCP page, or the tab predates the install | Reload the tab. Check `document.modelContext` in the console. |
| Panel is blank | Bundle failed | `npm run build`, then reload the extension |
| First answer is slow | Cold session | Run one warm-up question before you start |
| The assistant refuses a cart change outright | No approver attached | Expected in headless runs; in the panel it always asks |
| Confirmation never appears | The tool was read-only | Only cart and checkout tools are gated. Navigation is not. |

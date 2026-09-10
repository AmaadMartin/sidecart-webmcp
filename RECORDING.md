# Running and recording the demo

Two things you can do here: run it live, or produce an MP4. The recorder drives
the real interface — it types into the same box and clicks the same buttons you
would — so the video is the product, not a presentation mode.

---

## 1. Run it, offline

```bash
cd ~/Workspace/sidecart
npm install
npm run serve
```

Open <http://localhost:8901/harness.html>.

`npm run serve` builds and then serves on port 8901. It stays in the
foreground; stop it with Ctrl-C. If 8901 is taken:

```bash
node build.mjs --dev && node scripts/serve.mjs --port 8910
```

**Check the badge, top right of the panel.**

| Badge | Meaning |
| --- | --- |
| `ON-DEVICE` | Chrome's built-in model is running the demo |
| `SIMULATED · NOT A MODEL` | No usable model. Everything else is real; the reasoning is scripted |

If it says `SIMULATED`, that is a property of the machine, not a bug. Say so on
stage and carry on. Never present scripted output as inference.

**Drive it by hand, in this order:**

1. `what waterproof jackets do you have?`
2. `what is your return policy?` — note the funnel figure changes
3. `add the alpine glove liner to my cart`
4. On the card, click **Confirm — $32.00**

The guard against a listing that instructs the assistant is not part of this
run. To exercise it, open the harness with `?inject=1` and tick **Add a listing
that tries to instruct the assistant**. The card then offers three actions and
makes **Add everything anyway** the smallest target.

## 2. Run it on a real Shopify store

```bash
npm run build
```

1. `chrome://extensions` → **Developer mode** on → **Load unpacked** → pick `dist/`
2. Open a Shopify storefront. `allbirds.com` is known good.
3. **Reload that tab.** A content script does not attach to tabs that were
   already open, and the panel reaches the store's tools through it.
4. **Ctrl+Shift+U**, or **Cmd+Shift+U** on macOS.

Sanity check in the page console before you present:

```js
(await document.modelContext.getTools()).map(t => t.name)
```

Ten names should come back. If `document.modelContext` is undefined, the store
is not on the WebMCP origin trial and the extension has nothing to drive.

---

## 3. Record the MP4

```bash
# terminal 1
npm run serve

# terminal 2
npm run record
```

That writes `demo.mp4` in the repo root: 1440x900, H.264, about 55 seconds,
roughly 1.6 MB.

Options:

```bash
node scripts/record-demo.mjs --out /tmp/sidecart.mp4   # somewhere else
node scripts/record-demo.mjs --headful                 # watch it happen
node scripts/record-demo.mjs --chrome /path/to/chrome  # pick the binary
node scripts/record-demo.mjs --url http://localhost:8910/harness.html
```

### What it records

| Beat | On screen |
| --- | --- |
| 1 | The store, and the claim that Shopify publishes these tools |
| 2 | `what waterproof jackets do you have?` typed and answered |
| 3 | The funnel figure, held long enough to read |
| 4 | `what is your return policy?` — a different tool is chosen |
| 5 | `add the alpine glove liner to my cart` |
| 6 | The card stops it. The model proposed the change, it did not make it |
| 7 | **Confirm — $32.00** → one item in the cart |

The captions are added by the recorder, not the app. The recorder waits on the
model, so the running time depends on the machine.

### Record against a real store instead

The recorder drives the harness, because the harness is the reliable path. To
capture a real storefront, record your screen while you drive the extension by
hand — the extension cannot be loaded into the recorder's throwaway Chrome
profile without extra flags, and a live store is not worth the flakiness on
stage.

---

## Before you present

- **Trigger the model download a day early.** First use pulls several GB.
- **Record the backup video anyway.** Chrome evicts the model when free disk
  drops below 10 GB, and it will do that to you at the worst moment.
- **Leave the harness tab open and warm.** Ask it one throwaway question so the
  attack beat is not a cold session's first call.
- **Have the store tab already loaded, with DevTools already on the console.**
  Opening DevTools live costs fifteen seconds you do not have.

## If it breaks

| Symptom | Cause | Do this |
| --- | --- | --- |
| `too few frames captured` | The page never became ready | Is `npm run serve` running? Open the URL by hand first. |
| `the confirmation card never appeared` | The injection toggle did not take | Reload and retry; the recorder sets it itself |
| ffmpeg exits non-zero | Version differences in flags | `ffmpeg -version`; the script targets ffmpeg 8 |
| `Could not find Chrome` | Non-standard install | `--chrome /path/to/chrome` or `CHROME_PATH=...` |
| Panel is blank | Stale bundle | `npm run build` and reload |
| Extension sees no tools | Tab predates the install | Reload the tab |

## What not to say over the video

- Not "offline". The reasoning is local; the catalog calls go to the store.
- Not "the shopper's words stay on the device". They go into `search_catalog`.
  What never leaves is model traffic, because there is no model server.
- No cost or token claims. There is no meter here and so no baseline.
- Not "Gemma". Chrome's docs say Gemini Nano.
- Never call the scripted stand-in a model.

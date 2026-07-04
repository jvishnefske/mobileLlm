# Pocket Agent — a local LLM agent in your browser

A tiny agentic chat app that runs a language model **entirely on your phone** —
no server, no API key, no data leaving the device. It works the same on Android
and iOS because it only uses web platform features common to both, and it
installs to your home screen as an offline-capable app.

**Live app:** https://jvishnefske.github.io/mobileLlm/

## What it does

- **Local inference** — [wllama](https://github.com/ngxson/wllama) (llama.cpp
  compiled to WebAssembly) runs small GGUF models (SmolLM2 135M/360M,
  Qwen2.5 0.5B, or any custom GGUF URL) directly in the browser. WASM works on
  both Android Chrome and iOS Safari — no WebGPU required.
- **Agent tools** — the model can call device tools built on cross-platform web
  APIs (toggle with the 🛠 button):
  - `run_javascript` — real code execution in a QuickJS-WASM **sandbox** (no
    DOM, no network, 32 MB / 2 s limits) for math, dates, and logic
  - `memory` — save/get/list/delete persistent notes in IndexedDB that
    survive across chats
  - `documents` — list/read/keyword-search markdown and text files the user
    imports with the 📎 button
  - `delegate` — spawn a focused subagent: a fresh conversation against the
    same loaded model for self-contained subtasks
  - `get_time`, `get_location`, `device_info`, `copy_to_clipboard`, `speak`
    (text-to-speech)
- **Robust tool calling** — if a small model emits malformed tool JSON, the
  call is regenerated under a GBNF grammar constraint that forces valid JSON
  with a known tool name.
- **Markdown replies** — assistant output renders as sanitized markdown
  (marked + DOMPurify); chats export via the Web Share API (📤) or download.
- **Offline-first** — a service worker precaches the app shell, and models are
  cached on-device after the first download. Once installed, the whole app
  works in airplane mode.
- **Frictionless install** — Android gets a one-tap *Add to Home Screen* button
  (via `beforeinstallprompt`); iOS gets exact Share → *Add to Home Screen*
  instructions (Safari has no install API). Manifest + icons + service worker
  make the installed app full-screen and offline.
- **Multi-threaded on GitHub Pages** — Pages can't send the COOP/COEP headers
  needed for `SharedArrayBuffer`, so the service worker injects them and the
  page silently reloads once on first visit. Where isolation isn't available,
  wllama falls back to single-threaded automatically.

## Deployment — two release channels

`.github/workflows/deploy.yml` publishes **two channels of the same Pages
site**, so all validation happens on a second URL before anything reaches
the stable app:

| Channel | Branch | URL | Purpose |
| --- | --- | --- | --- |
| stable | `main` | `/<repo>/` | what users install |
| dev | `dev` | `/<repo>/dev/` | validate PWA updates first |

Push to `dev` → the dev URL updates (after unit/e2e CI plus the headless
verify gate). When it looks good on real phones, merge `dev` into `main` to
promote the exact same code to stable. Each channel is its own service-worker
scope, so the dev channel is a **separately installable PWA** (named "Pocket
Agent (dev)" on the home screen) with its own namespaced localStorage,
IndexedDB, and app-shell caches — the two installs never interfere, though
they share the (immutable, URL-keyed) model cache so models aren't downloaded
twice. Every deploy rebuilds both channels from their branch heads, and each
build must pass verification before the deploy ships.

One-time setup for the dev channel: allow the `dev` branch to deploy in
**Settings → Environments → github-pages → Deployment branches** (the
environment only permits `main` by default). The base path is derived from
the repository name automatically, and the workflow enables Pages on first
run.

The UI shows the running build's id, build date/time, and channel at the
bottom of the model panel (and in the diagnostics report); dev-channel builds
also get an orange badge in the header.

## Development

```sh
npm install
npm run dev            # local dev server
npm run build          # type-check + production build to dist/
npm run preview        # serve the production build
npm test               # unit tests (vitest)
npm run test:coverage  # unit tests + coverage report
npm run test:e2e       # Playwright e2e against the production build
npm run verify         # headless self-tests against dist/ (CHROMIUM_PATH=… to pick a browser)
npm run icons          # regenerate PWA icons from the inline SVG (committed)
```

## Testing & verification

- **Unit tests** (`tests/`) cover the agent loop with a scripted fake engine
  (tool dispatch, grammar repair, delegate subagent, round limits), tool-call
  parsing, the GBNF grammar, every tool (QuickJS sandbox isolation and
  timeouts, memory and documents over fake-indexeddb, clipboard/TTS stubs),
  and markdown sanitization.
- **E2E tests** (`e2e/`) run the production build in Chromium and verify the
  app shell, PWA manifest and icons, service-worker control, cross-origin
  isolation (SharedArrayBuffer available), offline reload, and the iOS
  install banner.
- `.github/workflows/ci.yml` runs both suites plus the type-checked build on
  every push and pull request, and writes a coverage table to the job summary.

Phones in the field have no debugger attached, so verification has two more
legs beyond the test suites:

1. **On-device diagnostics** — tap the *Pocket Agent* title in the header.
   The app runs a self-test suite (service worker control, offline cache for
   the current build, cross-origin isolation / thread count, storage
   persistence and quota, IndexedDB round-trip, cached model inventory,
   install state, tool API availability) and renders a plain-text report
   with **Copy** and **Share** buttons. That report is the bug-report
   format: ask a user to paste it and you know exactly what their device
   supports and which build they're running.
2. **Deploy gate** — `npm run verify` boots the built app in headless Chrome
   at a phone-sized viewport, runs the *same* check suite via
   `window.pocketAgent.runChecks()`, asserts the critical checks pass with
   zero console errors, then severs the network and confirms the app shell
   still renders. The deploy workflow runs it after every build; a failing
   check blocks the deploy.

For interactive debugging on real hardware: Android Chrome supports USB
remote debugging via `chrome://inspect`, and iOS Safari via
Settings → Safari → Advanced → Web Inspector plus a Mac.

## Upgrades & data migration

- **App code**: each build stamps a `BUILD_ID` into the service worker; on
  the next launch after a deploy the new worker installs, precaches the new
  assets, and deletes only old `pocket-agent-*` caches. If the app is open
  when an update lands, a "New version ready — Reload" toast appears.
- **Models**: cached by wllama independently of the app-shell caches, so
  they survive every upgrade. After each successful model load the app
  garbage-collects cached models that are no longer in the picker list
  (and not the model in use), and requests `navigator.storage.persist()` so
  the OS doesn't evict multi-hundred-MB downloads.
- **Settings**: all localStorage keys are namespaced (`pocket-agent:`)
  because the GitHub Pages origin is shared across all of a user's Pages
  projects, and carry a schema version with startup migrations
  (`src/storage.ts`).
- **Escape hatch**: storage is per-origin, so moving to a custom domain
  means starting fresh — an export/import feature should land together with
  the first persistent-memory feature.

## Architecture

| Piece | File | Notes |
| --- | --- | --- |
| LLM engine | `src/llm.ts` | wllama wrapper, model list, download progress, offline cache, GBNF grammar option |
| Agent loop | `src/agent.ts` | prompt-based tool calling (`TOOL: {...}`), grammar repair, delegate subagent, max 3 tool rounds |
| Device tools | `src/tools.ts` | sandboxed JS, memory, documents, time, geolocation, device info, clipboard, TTS |
| JS sandbox | `src/sandbox.ts` | QuickJS-WASM with memory/time limits |
| Storage | `src/db.ts` | IndexedDB stores for agent memory and imported documents |
| Markdown | `src/markdown.ts` | marked + DOMPurify rendering of replies |
| Install UX | `src/install.ts` | Android install prompt + iOS instructions |
| UI | `src/main.ts`, `index.html`, `src/style.css` | vanilla TS, mobile-first, wake lock, share/export |
| Offline + COI | `public/sw.js` | precache app shell, inject COOP/COEP headers |
| Diagnostics | `src/diagnostics.ts` | on-device self-tests, copy/share report (tap the title) |
| Storage | `src/storage.ts` | namespaced keys, schema migrations, persistence request |
| Verifier | `scripts/verify.mjs` | headless CI gate running the same self-tests |
| SW manifest | `vite.config.ts` | build plugin injects the precache asset list into `sw.js` |
| Deploy | `.github/workflows/deploy.yml` | build + deploy to GitHub Pages |

Model files are large (145–400 MB); download them on Wi-Fi. Small models are
fast but modest — expect a friendly pocket assistant, not a frontier model.

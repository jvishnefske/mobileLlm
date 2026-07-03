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

## Deployment

Every push to `main` triggers `.github/workflows/deploy.yml`, which builds the
site with Vite and deploys it to GitHub Pages (the workflow enables Pages on
first run). The base path is derived from the repository name automatically.

## Development

```sh
npm install
npm run dev            # local dev server
npm run build          # type-check + production build to dist/
npm run preview        # serve the production build
npm test               # unit tests (vitest)
npm run test:coverage  # unit tests + coverage report
npm run test:e2e       # Playwright e2e against the production build
npm run icons          # regenerate PWA icons from the inline SVG (committed)
```

## Testing

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
| SW manifest | `vite.config.ts` | build plugin injects the precache asset list into `sw.js` |
| Deploy | `.github/workflows/deploy.yml` | build + deploy to GitHub Pages |

Model files are large (145–400 MB); download them on Wi-Fi. Small models are
fast but modest — expect a friendly pocket assistant, not a frontier model.

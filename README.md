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
  APIs: current time, calculator, geolocation, and device/network info. Toggle
  with the 🛠 button.
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
npm run dev       # local dev server
npm run build     # type-check + production build to dist/
npm run preview   # serve the production build
npm run icons     # regenerate PWA icons from the inline SVG (committed)
```

## Architecture

| Piece | File | Notes |
| --- | --- | --- |
| LLM engine | `src/llm.ts` | wllama wrapper, model list, download progress, offline cache |
| Agent loop | `src/agent.ts` | prompt-based tool calling (`TOOL: {...}`), max 3 tool rounds |
| Device tools | `src/tools.ts` | time, calculator, geolocation, device info |
| Install UX | `src/install.ts` | Android install prompt + iOS instructions |
| UI | `src/main.ts`, `index.html`, `src/style.css` | vanilla TS, mobile-first |
| Offline + COI | `public/sw.js` | precache app shell, inject COOP/COEP headers |
| SW manifest | `vite.config.ts` | build plugin injects the precache asset list into `sw.js` |
| Deploy | `.github/workflows/deploy.yml` | build + deploy to GitHub Pages |

Model files are large (145–400 MB); download them on Wi-Fi. Small models are
fast but modest — expect a friendly pocket assistant, not a frontier model.

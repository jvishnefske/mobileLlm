# CLAUDE.md

Pocket Agent — a PWA that runs a small LLM entirely in the browser via
wllama (llama.cpp WASM), with an agent loop over device tools. No server,
no API key; targets Android Chrome and iOS Safari equally (WASM, not
WebGPU). Deployed to GitHub Pages. Vanilla TypeScript + Vite, no UI
framework.

## Commands

```sh
npm run dev            # dev server (service worker disabled in dev)
npm run build          # tsc --noEmit + vite build → dist/
npm test               # vitest unit tests (jsdom + fake-indexeddb)
npm run test:e2e       # Playwright e2e vs production build (port 4317)
npm run verify         # headless self-test gate vs dist/ (port 8899)
npm run icons          # regenerate public/icons/ from inline SVG (committed)
```

Env vars: `BASE_PATH` (Pages base, e.g. `/mobileLlm/`; default `/`),
`CHANNEL` (`stable` default, or `dev`), `CHROMIUM_PATH` (browser binary for
verify/e2e; CI falls back to `channel: 'chrome'`). Run `npm run build` with
the same `BASE_PATH`/`CHANNEL` you pass to `verify`.

## Architecture

- `src/llm.ts` — wllama wrapper (`LlmEngine`), model list (`MODELS`),
  GBNF grammar option on `chat()`
- `src/agent.ts` — agent loop: prompt-based tool calling (`TOOL: {...}`
  lines), grammar-constrained repair of malformed calls
  (`toolCallGrammar()`), `delegate` subagent, `MAX_TOOL_ROUNDS = 3`
- `src/tools.ts` — device tools (run_javascript, memory, documents,
  get_time, get_location, device_info, copy_to_clipboard, speak);
  `delegate` lives in agent.ts because it needs the engine
- `src/sandbox.ts` — QuickJS-WASM sandbox for run_javascript
- `src/db.ts` — IndexedDB stores (memory, documents)
- `src/storage.ts` — namespaced localStorage + schema migrations +
  `requestPersistence()`
- `src/diagnostics.ts` — on-device self-tests; panel opens by tapping the
  header title; exposes `window.pocketAgent.runChecks/buildReport`
- `src/install.ts` — Android `beforeinstallprompt` + iOS share-sheet install
- `src/markdown.ts` — marked + DOMPurify for assistant replies
- `public/sw.js` — precache app shell; injects COOP/COEP headers (GitHub
  Pages can't send them) to enable SharedArrayBuffer → multi-threaded
  inference; placeholders filled by the `sw-manifest` plugin in
  vite.config.ts
- `scripts/verify.mjs` — headless deploy gate; runs the SAME checks as the
  diagnostics panel

## Release channels

`main` → `/<repo>/` (stable); `dev` branch → `/<repo>/dev/` (dev channel,
separately installable PWA). `.github/workflows/deploy.yml` builds BOTH
channels from their branch heads on every deploy, runs `verify` on each,
and ships one Pages artifact. Promotion = merge `dev` into `main`.
`ci.yml` runs unit + e2e + build on every push/PR.

## Invariants — easy to break, hard to notice

- **Cache naming must stay in sync** between `public/sw.js`
  (`pocket-agent:${BASE_URL}:${BUILD_ID}`) and `src/diagnostics.ts`
  (same string built from `import.meta.env.BASE_URL` + `__BUILD_ID__`).
  The base path is part of the name so the stable and dev service workers
  (same origin) never delete each other's caches.
- **`scripts/verify.mjs` asserts diagnostics checks by display name**
  (`REQUIRED` list). Renaming a check in diagnostics.ts breaks the deploy
  gate.
- **Channel isolation**: localStorage prefix (`storage.ts`) and IndexedDB
  name (`db.ts`) are channel-suffixed on non-stable channels; the legacy
  key migration runs on stable only. The wllama model cache is shared
  across channels on purpose (immutable, URL-keyed).
- **Build-time globals** `__BUILD_ID__`, `__BUILD_TIME__`, `__CHANNEL__`
  are Vite `define`s declared in `src/globals.d.ts`; sw.js gets them via
  string placeholders (`self.__BUILD_ID` etc.) replaced in `closeBundle`.
- **Storage schema changes** need a migration in `storage.ts` `migrate()`
  (bump `SCHEMA_VERSION`, stack `if (version < N)` blocks) or an IndexedDB
  version bump in `db.ts`.
- **iOS cannot run multi-threaded inference** even though the COI trick
  makes `crossOriginIsolated` true there: the multi-thread llama.cpp build
  reserves a large SHARED WebAssembly.Memory upfront and iOS Safari refuses
  it ("Cannot allocate WebAssembly.Memory"). `loadAttempts()` in
  `src/llm.ts` therefore starts single-threaded on iOS and degrades on any
  memory error (multi → single → smaller context). Don't "simplify" the
  ladder away.
- The stable service worker's scope also covers `/dev/` — its fetch
  handler must keep ignoring `BASE_URL + 'dev/'` requests or the stable
  app shell hijacks the dev channel's URL (and vice-versa data poisoning
  of the asset cache).
- The COOP/COEP trick requires a one-time silent reload on first visit
  (see SW registration in main.ts); `verify` and e2e both depend on
  `crossOriginIsolated` ending up true.
- Model GGUF files are fetched by the *user's browser* from Hugging Face;
  CI/sandboxes often block huggingface.co, so model URLs in `src/llm.ts`
  can't be validated from a build environment.

## Gotchas

- `[hidden] { display: none !important }` exists in style.css because
  flex/grid display rules on the same element would otherwise override the
  attribute.
- Composer font-size stays ≥16px to prevent iOS zoom-on-focus.
- Tool results are fed back to the model as `user` turns, not `system` —
  small models follow them far more reliably.
- e2e (vite preview, port 4317) and verify (port 8899) use different ports
  so they can coexist.
- Deploys from branches other than `main` require that branch to be
  allowed in Settings → Environments → github-pages (needed once for
  `dev`). A 1-second deploy-job failure with no runner assigned = that
  protection rule, not a build problem. A "Deployment failed, try again
  later" from actions/deploy-pages is a transient Pages backend error —
  re-run the workflow.

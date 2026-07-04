// Headless verification of the built app — run after `npm run build`.
// Serves dist/ under the same base path GitHub Pages will use, loads the
// app in a mobile-sized Chromium, runs the SAME self-test suite that the
// in-app diagnostics panel runs on a phone (window.pocketAgent.runChecks),
// then severs the network and confirms the app shell still renders.
//
// Locally: CHROMIUM_PATH=/path/to/chromium node scripts/verify.mjs
// CI:      uses the Chrome preinstalled on GitHub runners (channel: chrome).
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const BASE = process.env.BASE_PATH || '/mobileLlm/';
const PORT = 8899;
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

// Checks that must pass for a deploy to be considered good. Names must
// match src/diagnostics.ts.
const REQUIRED = [
  'Service worker controls page',
  'App shell cached for this build',
  'Multi-threaded inference',
  'WebAssembly',
  'IndexedDB read/write',
];

if (!existsSync(path.join(DIST, 'index.html'))) {
  console.error(`No build found at ${DIST} — run \`npm run build\` first.`);
  process.exit(1);
}

const server = createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (!p.startsWith(BASE)) {
    res.writeHead(404);
    return res.end();
  }
  p = p.slice(BASE.length) || 'index.html';
  let file = path.join(DIST, p);
  if (!existsSync(file)) file = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(PORT, resolve));

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : { channel: 'chrome' }),
  args: ['--no-sandbox'],
});

let failed = false;
const fail = (msg) => {
  console.error(`❌ ${msg}`);
  failed = true;
};

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  await page.goto(`http://localhost:${PORT}${BASE}`, { waitUntil: 'networkidle' });
  // First visit: SW installs, takes control, and the page reloads itself
  // once to pick up the injected COOP/COEP headers.
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 15000 });
  await page.waitForFunction(() => !!window.pocketAgent, null, { timeout: 15000 });

  // Give the SW a beat to finish precaching before asserting on the cache.
  await page.waitForFunction(
    async () => {
      const checks = await window.pocketAgent.runChecks();
      return checks.find((c) => c.name === 'App shell cached for this build')?.status === 'pass';
    },
    null,
    { timeout: 15000 }
  ).catch(() => {});

  const report = await page.evaluate(() => window.pocketAgent.buildReport());
  console.log(report + '\n');

  const checks = await page.evaluate(() => window.pocketAgent.runChecks());
  for (const name of REQUIRED) {
    const check = checks.find((c) => c.name === name);
    if (!check) fail(`required check missing from suite: ${name}`);
    else if (check.status === 'fail') fail(`${name}: ${check.detail}`);
    else console.log(`✅ ${name}`);
  }

  if (consoleErrors.length) fail(`console errors: ${consoleErrors.join(' | ')}`);
  else console.log('✅ No console errors');

  // Offline: the whole point of the PWA. Kill the network and reload.
  await page.context().setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  const offlineOk = await page
    .textContent('#header h1', { timeout: 5000 })
    .catch(() => null);
  if (offlineOk === 'Pocket Agent') console.log('✅ App shell renders offline');
  else fail('app shell did not render offline');
} catch (err) {
  fail(`verification crashed: ${err.message}`);
} finally {
  await browser.close();
  server.close();
}

console.log(failed ? '\nVERIFY: FAILED' : '\nVERIFY: PASSED');
process.exit(failed ? 1 : 0);

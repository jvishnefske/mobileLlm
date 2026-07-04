// On-device verification. There is no debugger attached to a phone in the
// field, so the app can verify itself: tapping the header title runs a
// self-test suite (service worker, offline caches, threading, storage,
// model cache) and renders a plain-text report that can be copied or
// shared from the device — that report is the bug-report format.

import { ModelManager } from '@wllama/wllama';

// Must mirror the naming scheme in public/sw.js.
const CACHE_NAME = `pocket-agent:${import.meta.env.BASE_URL}:${__BUILD_ID__}`;


export interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'info';
  detail: string;
}

function fmtMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function checkIndexedDb(): Promise<CheckResult> {
  try {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('pocket-agent-diag', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(Date.now(), 'probe');
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
    return { name: 'IndexedDB read/write', status: 'pass', detail: 'round-trip ok' };
  } catch (err) {
    return {
      name: 'IndexedDB read/write',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const add = (name: string, ok: boolean, detail: string, infoOnly = false) =>
    results.push({ name, status: infoOnly ? 'info' : ok ? 'pass' : 'fail', detail });

  // --- offline / upgrade machinery ---
  const controller = navigator.serviceWorker?.controller;
  add('Service worker controls page', !!controller, controller ? 'controlled' : 'NOT controlled — offline will not work');

  let hasBuildCache = false;
  let precacheCount = 0;
  try {
    hasBuildCache = await caches.has(CACHE_NAME);
    if (hasBuildCache) {
      precacheCount = (await (await caches.open(CACHE_NAME)).keys()).length;
    }
  } catch {
    /* caches API unavailable */
  }
  add(
    'App shell cached for this build',
    hasBuildCache,
    hasBuildCache
      ? `cache ${CACHE_NAME} holds ${precacheCount} assets`
      : 'current build not yet cached (first visit, or SW still installing)'
  );

  // --- inference capability ---
  add(
    'Multi-threaded inference',
    window.crossOriginIsolated,
    window.crossOriginIsolated
      ? `cross-origin isolated, ${navigator.hardwareConcurrency} cores available`
      : 'not isolated — llama.cpp will run single-threaded (slower but functional)'
  );
  add('WebAssembly', typeof WebAssembly !== 'undefined', typeof WebAssembly !== 'undefined' ? 'available' : 'missing — inference impossible');

  // --- storage durability ---
  let persisted = false;
  try {
    persisted = (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    /* unsupported */
  }
  // Info-level: browsers grant persistence at their own discretion (often
  // only after install or engagement), so "not granted" is not an app bug.
  add(
    'Storage protected from eviction',
    persisted,
    persisted ? 'persistent storage granted' : 'not granted — OS may evict cached models after long disuse',
    true
  );

  try {
    const est = await navigator.storage.estimate();
    add('Storage usage', true, `${fmtMB(est.usage ?? 0)} used of ${fmtMB(est.quota ?? 0)} quota`, true);
  } catch {
    add('Storage usage', true, 'estimate unavailable', true);
  }

  results.push(await checkIndexedDb());

  // --- model cache ---
  try {
    const models = await new ModelManager().getModels({ includeInvalid: true });
    const list = models
      .map((m) => `${m.url.split('/').pop()} (${fmtMB(m.size)}, ${m.validate()})`)
      .join('; ');
    add('Cached models', true, models.length ? list : 'none downloaded yet', true);
  } catch (err) {
    add('Cached models', false, `model cache unreadable: ${err instanceof Error ? err.message : err}`);
  }

  // --- environment (informational) ---
  add('Installed as app', true, matchMedia('(display-mode: standalone)').matches ? 'yes (home screen)' : 'no (browser tab)', true);
  add('Network', true, navigator.onLine ? 'online' : 'offline', true);
  add(
    'Tool APIs',
    true,
    [
      'geolocation' in navigator ? 'geolocation✓' : 'geolocation✗',
      navigator.clipboard ? 'clipboard✓' : 'clipboard✗',
      'share' in navigator ? 'share✓' : 'share✗',
      'wakeLock' in navigator ? 'wakeLock✓' : 'wakeLock✗',
    ].join(' '),
    true
  );

  return results;
}

export async function buildReport(): Promise<string> {
  const checks = await runChecks();
  const failures = checks.filter((c) => c.status === 'fail').length;
  const icon = { pass: '✅', fail: '❌', info: 'ℹ️' } as const;
  return [
    `Pocket Agent diagnostics — ${new Date().toISOString()}`,
    `build: ${__BUILD_ID__} (${__CHANNEL__}) — built ${__BUILD_TIME__}`,
    `url: ${location.href}`,
    `ua: ${navigator.userAgent}`,
    `screen: ${screen.width}x${screen.height} @${devicePixelRatio}x`,
    '',
    ...checks.map((c) => `${icon[c.status]} ${c.name}: ${c.detail}`),
    '',
    failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} check(s) FAILED`,
  ].join('\n');
}

// Exposed for the headless CI verifier (scripts/verify.mjs) and for anyone
// poking around in a remote-debugging console on a real device.
declare global {
  interface Window {
    pocketAgent?: {
      runChecks: typeof runChecks;
      buildReport: typeof buildReport;
    };
  }
}
window.pocketAgent = { runChecks, buildReport };

export function setupDiagnosticsPanel(trigger: HTMLElement): void {
  trigger.style.cursor = 'pointer';
  trigger.addEventListener('click', () => void openPanel());
}

async function openPanel(): Promise<void> {
  if (document.getElementById('diag-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'diag-overlay';
  overlay.innerHTML = `
    <div id="diag-card">
      <h2>Diagnostics</h2>
      <pre id="diag-report">running checks…</pre>
      <div id="diag-actions">
        <button class="primary" id="diag-copy">Copy</button>
        <button class="primary" id="diag-share">Share</button>
        <button class="primary" id="diag-close">Close</button>
      </div>
    </div>`;
  document.body.append(overlay);

  const report = await buildReport();
  const pre = document.getElementById('diag-report')!;
  pre.textContent = report;

  document.getElementById('diag-copy')!.addEventListener('click', async (e) => {
    await navigator.clipboard.writeText(report);
    (e.target as HTMLButtonElement).textContent = 'Copied!';
  });
  const shareBtn = document.getElementById('diag-share')!;
  if ('share' in navigator) {
    shareBtn.addEventListener('click', () =>
      navigator.share({ title: 'Pocket Agent diagnostics', text: report }).catch(() => {})
    );
  } else {
    shareBtn.remove();
  }
  document.getElementById('diag-close')!.addEventListener('click', () => overlay.remove());
}

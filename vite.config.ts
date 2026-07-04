/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// One build id shared by the app bundle (via define) and the service worker
// (via placeholder replacement) so diagnostics can verify the SW cache
// matches the running app version.
const buildId = Date.now().toString(36);
const buildTime = new Date().toISOString();

// Release channel. 'stable' is main → /<repo>/ ; 'dev' is the dev branch →
// /<repo>/dev/ — a second, independently installable PWA (its own service
// worker scope) where every change is validated before promotion to stable.
const channel = process.env.CHANNEL || 'stable';

// Injects the final list of built assets into the service worker so it can
// precache the full app shell, and stamps a unique cache version per build.
function serviceWorkerManifest(): Plugin {
  let outDir = 'dist';
  let base = '/';
  return {
    name: 'sw-manifest',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
      base = config.base;
    },
    closeBundle() {
      const swPath = path.resolve(outDir, 'sw.js');
      if (!fs.existsSync(swPath)) return;
      const assets: string[] = [];
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else assets.push(base + path.relative(outDir, full).replaceAll(path.sep, '/'));
        }
      };
      walk(path.resolve(outDir));
      const precache = assets.filter(
        (a) => !a.endsWith('sw.js') && !a.endsWith('.map')
      );
      let sw = fs.readFileSync(swPath, 'utf8');
      sw = sw
        .replace('self.__PRECACHE_MANIFEST', JSON.stringify(precache))
        .replace('self.__BUILD_ID', JSON.stringify(buildId))
        .replace('self.__BASE_URL', JSON.stringify(base));
      fs.writeFileSync(swPath, sw);
    },
  };
}

// On the dev channel, rename the app in the manifest so the two home-screen
// installs (stable + dev) are distinguishable side by side.
function channelManifest(): Plugin {
  return {
    name: 'channel-manifest',
    apply: 'build',
    closeBundle() {
      if (channel === 'stable') return;
      const outDir = 'dist';
      const manifestPath = path.resolve(outDir, 'manifest.webmanifest');
      if (!fs.existsSync(manifestPath)) return;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.name = `${manifest.name} (${channel})`;
      manifest.short_name = `${manifest.short_name} ${channel}`;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    },
  };
}

export default defineConfig({
  // On GitHub Pages the app is served from /<repo-name>/ — the deploy
  // workflow sets BASE_PATH accordingly. Local dev uses '/'.
  base: process.env.BASE_PATH || '/',
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
    __BUILD_TIME__: JSON.stringify(buildTime),
    __CHANNEL__: JSON.stringify(channel),
  },
  plugins: [serviceWorkerManifest(), channelManifest()],
  build: {
    target: 'es2022',
  },
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'json-summary'],
    },
  },
});

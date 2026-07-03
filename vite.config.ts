import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

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
        .replace('self.__BUILD_ID', JSON.stringify(Date.now().toString(36)))
        .replace('self.__BASE_URL', JSON.stringify(base));
      fs.writeFileSync(swPath, sw);
    },
  };
}

export default defineConfig({
  // On GitHub Pages the app is served from /<repo-name>/ — the deploy
  // workflow sets BASE_PATH accordingly. Local dev uses '/'.
  base: process.env.BASE_PATH || '/',
  plugins: [serviceWorkerManifest()],
  build: {
    target: 'es2022',
  },
});

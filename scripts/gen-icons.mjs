// Generates all PWA icons from an inline SVG using sharp.
// Run: npm run icons   (outputs are committed, so CI doesn't need this)
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'icons'
);
mkdirSync(outDir, { recursive: true });

// pad: extra safe-area padding around the glyph (maskable icons need ~20%).
function logoSvg({ pad = 0, rounded = true } = {}) {
  const s = 512;
  const r = rounded ? 110 : 0;
  const scale = 1 - pad * 2;
  const off = s * pad;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1b2440"/>
      <stop offset="1" stop-color="#0f1117"/>
    </linearGradient>
    <linearGradient id="fg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#9db4ff"/>
      <stop offset="1" stop-color="#6d8dff"/>
    </linearGradient>
  </defs>
  <rect width="${s}" height="${s}" rx="${r}" fill="url(#bg)"/>
  <g transform="translate(${off},${off}) scale(${scale})">
    <!-- chat bubble -->
    <path d="M116 150 h280 a44 44 0 0 1 44 44 v140 a44 44 0 0 1 -44 44 h-160 l-80 62 v-62 h-40 a44 44 0 0 1 -44 -44 v-140 a44 44 0 0 1 44 -44 z"
          fill="none" stroke="url(#fg)" stroke-width="30" stroke-linejoin="round"/>
    <!-- spark: on-device intelligence -->
    <circle cx="196" cy="264" r="22" fill="url(#fg)"/>
    <circle cx="276" cy="264" r="22" fill="url(#fg)"/>
    <circle cx="356" cy="264" r="22" fill="url(#fg)"/>
  </g>
</svg>`;
}

const jobs = [
  { file: 'icon-192.png', size: 192, svg: logoSvg() },
  { file: 'icon-512.png', size: 512, svg: logoSvg() },
  // Maskable: full-bleed square background, glyph inside the safe zone.
  { file: 'icon-maskable-512.png', size: 512, svg: logoSvg({ pad: 0.12, rounded: false }) },
  // iOS applies its own corner mask; give it a square icon.
  { file: 'apple-touch-icon.png', size: 180, svg: logoSvg({ pad: 0.04, rounded: false }) },
];

for (const { file, size, svg } of jobs) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(path.join(outDir, file));
  console.log('wrote', file);
}

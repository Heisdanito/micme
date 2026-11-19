// Generates every app icon (desktop + mobile) from one vector description,
// with no image tools needed: shapes are drawn as signed-distance fields and
// written as PNG with node:zlib.  Run: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- PNG encoder ----------
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- shapes (coords in -0.5..0.5) ----------
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
/** Microphone glyph distance; s = glyph scale. */
function sdMic(x, y, s) {
  x /= s;
  y /= s;
  const body = sdRoundRect(x, y, 0, -0.13, 0.13, 0.24, 0.13);
  // lower half ring (the cradle)
  const cy = -0.06;
  let ring = Math.abs(Math.hypot(x, y - cy) - 0.25) - 0.035;
  if (y < cy) ring = Math.hypot(Math.abs(x) - 0.25, y - cy) - 0.035; // round caps at the top ends
  const stem = sdRoundRect(x, y, 0, 0.27, 0.035, 0.07, 0.02);
  const base = sdRoundRect(x, y, 0, 0.35, 0.15, 0.035, 0.035);
  return Math.min(body, ring, stem, base) * s;
}

const VIOLET_A = [0x8b, 0x7c, 0xff];
const VIOLET_B = [0x5b, 0x4b, 0xff];

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function render(size, paint) {
  const out = Buffer.alloc(size * size * 4);
  const aa = 1.2 / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / size - 0.5;
      const y = (py + 0.5) / size - 0.5;
      const [r, g, b, a] = paint(x, y, aa);
      const i = (py * size + px) * 4;
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = Math.round(clamp(a, 0, 1) * 255);
    }
  }
  return png(size, out);
}

const cover = (d, aa) => clamp(0.5 - d / aa, 0, 1);
const over = (base, color, alpha) => {
  const a = alpha + base[3] * (1 - alpha);
  if (a === 0) return [0, 0, 0, 0];
  const c = [0, 1, 2].map((i) => (color[i] * alpha + base[i] * base[3] * (1 - alpha)) / a);
  return [...c.map(Math.round), a];
};
const gradient = (x, y) => mix(VIOLET_A, VIOLET_B, clamp((x + y) / 1.4 + 0.5, 0, 1));

// Full icon: rounded violet tile + white mic.
const appIcon = (tileRadius, inset, glyph) => (x, y, aa) => {
  let px = [0, 0, 0, 0];
  const tile = sdRoundRect(x, y, 0, 0, 0.5 - inset, 0.5 - inset, tileRadius);
  px = over(px, gradient(x, y), cover(tile, aa));
  px = over(px, [255, 255, 255], cover(sdMic(x, y + 0.02, glyph), aa) * (px[3] > 0 ? 1 : 0));
  return px;
};
const glyphOnly = (color, glyph) => (x, y, aa) => [...color, cover(sdMic(x, y + 0.02, glyph), aa)];
const solid = (fn) => (x, y) => [...fn(x, y), 1];

const targets = [
  ['desktop/build/icon.png', 512, appIcon(0.22, 0.04, 0.8)],
  ['mobile/assets/icon.png', 1024, solid((x, y) => gradient(x, y))],
  ['mobile/assets/splash-icon.png', 512, appIcon(0.24, 0.02, 0.8)],
  ['mobile/assets/favicon.png', 48, appIcon(0.22, 0.02, 0.8)],
  ['mobile/assets/android-icon-foreground.png', 1024, glyphOnly([255, 255, 255], 0.5)],
  ['mobile/assets/android-icon-background.png', 1024, solid((x, y) => gradient(x, y))],
  ['mobile/assets/android-icon-monochrome.png', 1024, glyphOnly([255, 255, 255], 0.5)],
];

// iOS/store icon: full-bleed gradient + glyph (the OS applies its own mask).
targets[1][2] = (x, y, aa) => over([...gradient(x, y), 1], [255, 255, 255], cover(sdMic(x, y + 0.02, 0.62), aa));

for (const [file, size, paint] of targets) {
  const full = join(root, file);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, render(size, paint));
  console.log('wrote', file, `${size}px`);
}


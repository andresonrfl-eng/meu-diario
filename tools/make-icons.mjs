// Gera os ícones PNG do app (sem dependências). Uso: node tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(OUT, { recursive: true });

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
// Visual "Calmo e natural" — símbolo "sol no horizonte" (respiro):
// fundo sálvia, meio sol pêssego nascendo sobre uma linha de horizonte cor de areia
// e duas linhas mais curtas embaixo, como água calma.
const BG_TOP = hex('#6f8f7a');
const BG_BOTTOM = hex('#557463');
const SUN = hex('#e9b49a');
const SAND = hex('#f4f1ea');
const SAND_SOFT = hex('#b9c8bb');
const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
// segmento horizontal com pontas arredondadas (de x1 a x2, na altura y, espessura t)
const inBar = (x, y, x1, x2, cy, t) => {
  const r = t / 2;
  const px = Math.min(Math.max(x, x1), x2);
  return (x - px) ** 2 + (y - cy) ** 2 <= r * r;
};

// Coordenadas no espaço 512x512 (mesmo desenho do icon.svg)
function insideRoundRect(x, y, rx, ry, w, h, r) {
  if (x < rx || y < ry || x > rx + w || y > ry + h) return false;
  const cx = Math.min(Math.max(x, rx + r), rx + w - r);
  const cy = Math.min(Math.max(y, ry + r), ry + h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function colorAt(x, y, { rounded, scale }) {
  // scale < 1 encolhe o desenho para caber na "zona segura" dos ícones maskable
  const sx = 256 + (x - 256) / scale;
  const sy = 256 + (y - 256) / scale;
  if (rounded && !insideRoundRect(x, y, 0, 0, 512, 512, 112)) return null;
  const t = Math.min(1, Math.max(0, y / 512));
  let c = BG_TOP.map((v, i) => Math.round(v + (BG_BOTTOM[i] - v) * t));
  if (inCircle(sx, sy, 256, 266, 122) && sy <= 254) c = SUN;
  if (inBar(sx, sy, 116, 396, 278, 22)) c = SAND;
  if (inBar(sx, sy, 172, 340, 330, 18)) c = SAND_SOFT;
  if (inBar(sx, sy, 214, 298, 374, 18)) c = SAND_SOFT;
  return c;
}

function render(size, opts) {
  const SS = 4; // supersampling para bordas suaves
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // filtro "none"
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) {
        const x = ((px + (i + 0.5) / SS) / size) * 512;
        const y = ((py + (j + 0.5) / SS) / size) * 512;
        const c = colorAt(x, y, opts);
        if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
      }
      const n = SS * SS;
      const o = py * (size * 4 + 1) + 1 + px * 4;
      const alpha = a / n;
      // cores pré-divididas pelo alfa (evita bordas escuras)
      const k = a ? n / (a / 255) : 0;
      raw[o] = Math.round((r / n) * k) || 0;
      raw[o + 1] = Math.round((g / n) * k) || 0;
      raw[o + 2] = Math.round((b / n) * k) || 0;
      raw[o + 3] = Math.round(alpha);
    }
  }
  return png(size, size, raw);
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // RGBA 8 bits
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync(join(OUT, 'icon-192.png'), render(192, { rounded: true, scale: 1 }));
writeFileSync(join(OUT, 'icon-512.png'), render(512, { rounded: true, scale: 1 }));
writeFileSync(join(OUT, 'icon-maskable-512.png'), render(512, { rounded: false, scale: 0.8 }));
console.log('Ícones gerados em', OUT);

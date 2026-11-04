// Gera os ícones PNG do app (sem dependências). Uso: node tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(OUT, { recursive: true });

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BG = hex('#5865a8');
const PAGE = hex('#ffffff');
const SPINE = hex('#dfe2f3');
const LINE1 = hex('#5865a8');
const LINE2 = hex('#8f9be0');

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
  const shapes = [
    [146, 106, 232, 300, 28, PAGE],
    [146, 106, 40, 300, 14, SPINE],
    [214, 170, 128, 16, 8, LINE1],
    [214, 222, 128, 16, 8, LINE2],
    [214, 274, 90, 16, 8, LINE2],
  ];
  let c = BG;
  for (const [rx, ry, w, h, r, col] of shapes) if (insideRoundRect(sx, sy, rx, ry, w, h, r)) c = col;
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

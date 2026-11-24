// Génère build/icon.png (512x512) en Node pur : formes dessinées pixel par pixel + encodage PNG.
// Usage : node scripts/make-icon.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 512;
const SS = 4; // sur-échantillonnage pour lisser les bords
const px = new Float32Array(SIZE * SIZE * 4); // RGBA prémultiplié 0..1

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

// Dessine un rectangle arrondi ; color peut être une fonction (x, y) -> [r, g, b]
function roundRect(x, y, w, h, r, color, alpha = 1) {
  const x0 = Math.floor(x), x1 = Math.ceil(x + w), y0 = Math.floor(y), y1 = Math.ceil(y + h);
  for (let py = y0; py < y1; py++) {
    for (let pxl = x0; pxl < x1; pxl++) {
      let cover = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = pxl + (sx + 0.5) / SS, fy = py + (sy + 0.5) / SS;
          if (fx < x || fx > x + w || fy < y || fy > y + h) continue;
          const cx = Math.max(x + r, Math.min(fx, x + w - r));
          const cy = Math.max(y + r, Math.min(fy, y + h - r));
          if ((fx - cx) ** 2 + (fy - cy) ** 2 <= r * r) cover++;
        }
      }
      if (!cover) continue;
      const a = (cover / (SS * SS)) * alpha;
      const [cr, cg, cb] = typeof color === 'function' ? color(pxl, py) : color;
      const i = (py * SIZE + pxl) * 4;
      px[i] = cr * a + px[i] * (1 - a);
      px[i + 1] = cg * a + px[i + 1] * (1 - a);
      px[i + 2] = cb * a + px[i + 2] * (1 - a);
      px[i + 3] = a + px[i + 3] * (1 - a);
    }
  }
}

const c1 = hex('#8b6cff'), c2 = hex('#4b2fd1');
const gradient = (x, y) => {
  const t = Math.min(1, Math.max(0, (x + y) / (2 * SIZE)));
  return c1.map((v, k) => v + (c2[k] - v) * t);
};
const white = [1, 1, 1], teal = hex('#2ec4b6'), orange = hex('#ff9f43');

roundRect(16, 16, 480, 480, 110, gradient);
// trois touches
roundRect(96, 150, 96, 96, 20, white, 0.95);
roundRect(208, 150, 96, 96, 20, white, 0.35);
roundRect(320, 150, 96, 96, 20, teal);
// pistes de timeline
for (const [y, x, w, col] of [[262, 96, 210, white], [304, 160, 120, orange], [346, 250, 150, teal]]) {
  roundRect(96, y, 320, 22, 11, white, 0.35);
  roundRect(x, y, w, 22, 11, col);
}

// ---- Encodage PNG
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filtre "none"
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    const a = px[i + 3];
    const o = y * (SIZE * 4 + 1) + 1 + x * 4;
    raw[o] = Math.round((a ? px[i] / a : 0) * 255);
    raw[o + 1] = Math.round((a ? px[i + 1] / a : 0) * 255);
    raw[o + 2] = Math.round((a ? px[i + 2] / a : 0) * 255);
    raw[o + 3] = Math.round(a * 255);
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // profondeur
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('icône écrite :', out);

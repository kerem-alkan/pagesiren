// Generates the project's assets from scratch, so their origin is clear and they carry no third-party license:
//   extension/siren.wav   two-tone siren, a few seconds, loops cleanly
//   extension/icon.png    128x128 program icon
// Run: node tools/make-assets.js
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const EK = path.join(__dirname, '..', 'extension');

// ------------------------------------------------------------------ siren.wav
function sirenWav() {
  const oran = 22050;
  const sn = 3;
  const n = oran * sn;
  const veri = Buffer.alloc(n * 2);
  let faz = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    // a smooth rise and fall between 650 and 1250 Hz; a whole number of sweeps, so the loop has no click
    const f = 950 + 300 * Math.sin(2 * Math.PI * t * 2 - Math.PI / 2);
    faz += 2 * Math.PI * f / oran;
    const dalga = Math.sin(faz) * 0.75 + Math.sin(faz * 2) * 0.18 + Math.sin(faz * 3) * 0.07;
    veri.writeInt16LE(Math.round(dalga * 0.8 * 32767), i * 2);
  }
  const bas = Buffer.alloc(44);
  bas.write('RIFF', 0); bas.writeUInt32LE(36 + veri.length, 4); bas.write('WAVE', 8);
  bas.write('fmt ', 12); bas.writeUInt32LE(16, 16); bas.writeUInt16LE(1, 20); bas.writeUInt16LE(1, 22);
  bas.writeUInt32LE(oran, 24); bas.writeUInt32LE(oran * 2, 28); bas.writeUInt16LE(2, 32); bas.writeUInt16LE(16, 34);
  bas.write('data', 36); bas.writeUInt32LE(veri.length, 40);
  return Buffer.concat([bas, veri]);
}

// ------------------------------------------------------------------ icon.png
function crc32(b) {
  let c = ~0;
  for (let i = 0; i < b.length; i++) { c ^= b[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  return (~c) >>> 0;
}
function pngParca(tur, veri) {
  const uz = Buffer.alloc(4); uz.writeUInt32BE(veri.length);
  const t = Buffer.from(tur, 'latin1');
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, veri])));
  return Buffer.concat([uz, t, veri, c]);
}
// Signed-distance drawing, one pixel at a time, with soft edges.
const yuvarlakKutu = (x, y, x0, y0, x1, y1, r) => {
  const qx = Math.abs(x - (x0 + x1) / 2) - ((x1 - x0) / 2 - r);
  const qy = Math.abs(y - (y0 + y1) / 2) - ((y1 - y0) / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const halka = (x, y, cx, cy, r, kalin, a0, a1) => {
  const a = Math.atan2(y - cy, x - cx);
  if (a < a0 || a > a1) return 1e3;
  return Math.abs(Math.hypot(x - cx, y - cy) - r) - kalin / 2;
};
function ikonPng(N) {
  const olcek = N / 128;
  const ham = Buffer.alloc((N * 4 + 1) * N);
  const karistir = (r, g, b, a, r2, g2, b2, a2) => {
    const oa = a2 + a * (1 - a2);
    if (oa <= 0) return [0, 0, 0, 0];
    return [(r2 * a2 + r * a * (1 - a2)) / oa, (g2 * a2 + g * a * (1 - a2)) / oa, (b2 * a2 + b * a * (1 - a2)) / oa, oa];
  };
  for (let py = 0; py < N; py++) {
    ham[py * (N * 4 + 1)] = 0;
    for (let px = 0; px < N; px++) {
      const x = (px + 0.5) / olcek;
      const y = (py + 0.5) / olcek;
      let c = [0, 0, 0, 0];
      const kat = (d, r, g, b) => { const a = Math.min(1, Math.max(0, 0.5 - d * olcek)); if (a > 0) c = karistir(c[0], c[1], c[2], c[3], r, g, b, a); };
      // rounded square background
      kat(yuvarlakKutu(x, y, 4, 4, 124, 124, 26), 24, 27, 33);
      // the light: a dome on a base
      const kubbe = Math.max(Math.hypot(x - 64, y - 62) - 30, y - 62);
      const govde = yuvarlakKutu(x, y, 34, 60, 94, 82, 3);
      kat(Math.min(kubbe, govde), 226, 37, 47);
      // a highlight on the dome
      kat(Math.max(Math.hypot(x - 54, y - 52) - 8, 0) > 0 ? Math.hypot(x - 54, y - 52) - 8 : -1, 255, 150, 150);
      kat(yuvarlakKutu(x, y, 26, 84, 102, 98, 5), 235, 238, 243);
      // sound waves on both sides
      for (const r of [40, 50]) {
        kat(halka(x, y, 64, 62, r, 5, -Math.PI * 0.42, -Math.PI * 0.12), 255, 196, 64);
        kat(halka(x, y, 64, 62, r, 5, -Math.PI * 0.88, -Math.PI * 0.58), 255, 196, 64);
      }
      const o = py * (N * 4 + 1) + 1 + px * 4;
      ham[o] = Math.round(c[0]); ham[o + 1] = Math.round(c[1]); ham[o + 2] = Math.round(c[2]); ham[o + 3] = Math.round(c[3] * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), pngParca('IHDR', ihdr), pngParca('IDAT', zlib.deflateSync(ham, { level: 9 })), pngParca('IEND', Buffer.alloc(0))]);
}

fs.writeFileSync(path.join(EK, 'siren.wav'), sirenWav());
fs.writeFileSync(path.join(EK, 'icon.png'), ikonPng(128));
console.log('siren.wav and icon.png written');

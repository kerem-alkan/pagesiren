// Records docs/demo.gif, docs/screenshot.png and docs/alarm.png: the real program, a fake local shop, a headless browser. Nothing opens on screen, nothing leaves 127.0.0.1.
// Run: node tools/make-demo.js [--lang tr]   (needs Chrome, Edge or Brave; takes about 3 minutes because reads are real, 30 s apart. --lang tr writes demo.tr.gif and so on)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { tarayiciBul } = require('../app/browser');

const KOK = path.join(__dirname, '..');
const GEN = 1120; // wide enough for the filter column
const YUK = 680;
const UI_PORT = 47499;
const UI = 'http://127.0.0.1:' + UI_PORT;
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const gecici = fs.mkdtempSync(path.join(os.tmpdir(), 'pagesiren-demo-'));
const DIL = process.argv[process.argv.indexOf('--lang') + 1] === 'tr' ? 'tr' : 'en';
const UZANTI = DIL === 'tr' ? '.tr' : '';
const METIN = {
  en: {
    baslik: 'Example Shop', dukkan: 'EXAMPLE SHOP', urun: 'Limited Edition Sneakers', fiyat: '$129.00', yok: 'Sold out', var: 'Add to cart',
    p1: 'Only a small batch is made, and it goes fast. Sign up for nothing: just watch this page.', p2: 'Free returns within thirty days, shipped from the warehouse the same day.',
    ad: ['Limited', 'Limited sneakers'],
    y1: 'A page you care about: sold out, for now', y2: 'Paste the address. No account, nothing to configure', y3: 'It reads the page in the background, in a small browser of its own',
    y4: 'Cookie banners, ads and clocks are ignored: it speaks up only when it matters', y5: 'Later, the page changes...', y6: 'It tells you exactly what changed',
  },
  tr: {
    baslik: 'Örnek Mağaza', dukkan: 'ÖRNEK MAĞAZA', urun: 'Sınırlı Üretim Spor Ayakkabı', fiyat: '₺4.999', yok: 'Tükendi', var: 'Sepete ekle',
    p1: 'Az sayıda üretildi, çabuk tükeniyor. Üye olmanıza gerek yok: bu sayfayı izlemeniz yeter.', p2: '30 gün içinde ücretsiz iade, aynı gün depodan kargo.',
    ad: ['Sınırlı', 'Sınırlı spor ayakkabı'],
    y1: 'Önemsediğiniz bir sayfa: şimdilik tükenmiş', y2: 'Adresi yapıştırın. Hesap yok, ayar yok', y3: 'Sayfayı arka planda, kendi küçük tarayıcısıyla okur',
    y4: 'Çerez kutuları, reklamlar ve saatler elenir: sadece önemliyse ses çıkarır', y5: 'Sonra sayfa değişir...', y6: 'Neyin değiştiğini tam olarak söyler',
  },
}[DIL];

// ------------------------------------------------------------------ fake shop
let stokta = false;
const dukkan = http.createServer((q, c) => {
  c.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  c.end(`<!doctype html><html><head><meta charset="utf-8"><title>${METIN.baslik}</title><style>
    body{margin:0;background:#f4f4f6;color:#17181c;font:16px "Segoe UI",system-ui,sans-serif}
    nav{background:#17181c;color:#fff;padding:14px 26px;font-weight:700;letter-spacing:.04em}
    main{display:flex;gap:34px;padding:34px 26px}
    .foto{width:300px;height:300px;background:#fff;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:130px}
    h1{margin:0 0 8px;font-size:30px}.fiyat{font-size:22px;margin:10px 0 18px}
    .yok{display:inline-block;padding:11px 26px;border-radius:9px;background:#c9ccd3;color:#50535b;font-weight:700}
    button{padding:13px 34px;border:0;border-radius:9px;background:#16a34a;color:#fff;font:700 17px "Segoe UI",system-ui,sans-serif}
    </style></head><body><nav>${METIN.dukkan}</nav><main><div class="foto">👟</div><div>
    <h1>${METIN.urun}</h1><p>${METIN.p1}</p>
    <p>${METIN.p2}</p><div class="fiyat">${METIN.fiyat}</div>
    ${stokta ? `<button>${METIN.var}</button>` : `<span class="yok">${METIN.yok}</span>`}
    </div></main></body></html>`);
});

// ------------------------------------------------------------------ small DevTools client for the camera browser
class Kamera {
  async ac() {
    const profil = path.join(gecici, 'kamera');
    this.c = spawn(tarayiciBul(), ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profil, '--window-size=' + GEN + ',' + YUK, '--force-device-scale-factor=1',
      '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--force-color-profile=srgb', 'about:blank'], { stdio: 'ignore' });
    const portDosyasi = path.join(profil, 'DevToolsActivePort');
    for (let i = 0; i < 150 && !fs.existsSync(portDosyasi); i++) await bekle(200);
    const [port, wsYol] = fs.readFileSync(portDosyasi, 'utf8').split(/\r?\n/);
    this.ws = new WebSocket('ws://127.0.0.1:' + port + wsYol);
    await new Promise((coz, red) => { this.ws.onopen = coz; this.ws.onerror = red; });
    this.sira = 1;
    this.bek = new Map();
    this.ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && this.bek.has(m.id)) { const b = this.bek.get(m.id); this.bek.delete(m.id); if (m.error) b.red(new Error(m.error.message)); else b.coz(m.result); } };
    const { targetId } = await this.g('Target.createTarget', { url: 'about:blank' });
    this.oturum = (await this.g('Target.attachToTarget', { targetId, flatten: true })).sessionId;
    await this.g('Page.enable', {}, this.oturum);
    await this.g('Emulation.setDeviceMetricsOverride', { width: GEN, height: YUK, deviceScaleFactor: 1, mobile: false }, this.oturum);
    await this.g('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, this.oturum);
  }
  g(yontem, params, sessionId) {
    return new Promise((coz, red) => { const id = this.sira++; this.bek.set(id, { coz, red }); this.ws.send(JSON.stringify({ id, method: yontem, params: params || {}, ...(sessionId ? { sessionId } : {}) })); });
  }
  async git(url) { await this.g('Page.navigate', { url }, this.oturum); await bekle(900); }
  async js(kod) { const r = await this.g('Runtime.evaluate', { expression: kod, awaitPromise: true, returnByValue: true }, this.oturum); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + kod.slice(0, 80)); return r.result.value; }
  async foto() { return Buffer.from((await this.g('Page.captureScreenshot', { format: 'png' }, this.oturum)).data, 'base64'); }
  kapat() { try { this.c.kill(); } catch (e) { /* harmless */ } }
}

// ------------------------------------------------------------------ PNG -> pixels
function pngCoz(b) {
  let p = 8;
  let gen; let yuk; let kanal;
  const idat = [];
  while (p < b.length) {
    const uz = b.readUInt32BE(p);
    const tur = b.toString('latin1', p + 4, p + 8);
    if (tur === 'IHDR') { gen = b.readUInt32BE(p + 8); yuk = b.readUInt32BE(p + 12); kanal = b[p + 17] === 6 ? 4 : 3; }
    if (tur === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + uz));
    p += 12 + uz;
  }
  const ham = zlib.inflateSync(Buffer.concat(idat));
  const satir = gen * kanal;
  const c = Buffer.alloc(gen * yuk * 3);
  const once = Buffer.alloc(satir);
  const su = Buffer.alloc(satir);
  for (let y = 0; y < yuk; y++) {
    const f = ham[y * (satir + 1)];
    const bas = y * (satir + 1) + 1;
    for (let x = 0; x < satir; x++) {
      const a = x >= kanal ? su[x - kanal] : 0;
      const u = once[x];
      const ul = x >= kanal ? once[x - kanal] : 0;
      let d = ham[bas + x];
      if (f === 1) d += a;
      else if (f === 2) d += u;
      else if (f === 3) d += (a + u) >> 1;
      else if (f === 4) { const t = a + u - ul; const pa = Math.abs(t - a); const pb = Math.abs(t - u); const pc = Math.abs(t - ul); d += pa <= pb && pa <= pc ? a : pb <= pc ? u : ul; }
      su[x] = d & 255;
    }
    su.copy(once);
    for (let x = 0; x < gen; x++) { c[(y * gen + x) * 3] = su[x * kanal]; c[(y * gen + x) * 3 + 1] = su[x * kanal + 1]; c[(y * gen + x) * 3 + 2] = su[x * kanal + 2]; }
  }
  return { gen, yuk, rgb: c };
}

// ------------------------------------------------------------------ pixels -> GIF
function lzw(veri) {
  const cikti = [];
  let bit = 0;
  let nbit = 0;
  let boy = 9;
  let sonraki = 258;
  let sozluk = new Map();
  const yaz = (k) => { bit |= k << nbit; nbit += boy; while (nbit >= 8) { cikti.push(bit & 255); bit >>>= 8; nbit -= 8; } };
  yaz(256);
  let w = veri[0];
  for (let i = 1; i < veri.length; i++) {
    const c = veri[i];
    const a = (w << 8) | c;
    const v = sozluk.get(a);
    if (v !== undefined) { w = v; continue; }
    yaz(w);
    if (sonraki === 4096) { yaz(256); sozluk = new Map(); sonraki = 258; boy = 9; } else { if (sonraki >= (1 << boy)) boy++; sozluk.set(a, sonraki++); }
    w = c;
  }
  yaz(w);
  yaz(257);
  if (nbit > 0) cikti.push(bit & 255);
  return Buffer.from(cikti);
}
function gifYaz(kareler, dosya) {
  const { gen, yuk } = kareler[0];
  // Palette: the 255 most used colors. A screen of flat colors fits well; index 255 means "unchanged".
  const say = new Float64Array(32768);
  const top = [new Float64Array(32768), new Float64Array(32768), new Float64Array(32768)];
  for (const k of kareler) for (let i = 0; i < gen * yuk; i++) {
    const r = k.rgb[i * 3]; const g = k.rgb[i * 3 + 1]; const b = k.rgb[i * 3 + 2];
    const a = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    say[a]++; top[0][a] += r; top[1][a] += g; top[2][a] += b;
  }
  const puan = (a) => { const r = (a >> 10) & 31; const g = (a >> 5) & 31; const b = a & 31; return say[a] * (1 + ((Math.max(r, g, b) - Math.min(r, g, b)) / 31) * 30); }; // rare but saturated colors (a green dot) get a place too
  const secili = [...say.keys()].filter((a) => say[a] > 0).sort((x, y) => puan(y) - puan(x)).slice(0, 255);
  const pal = secili.map((a) => [Math.round(top[0][a] / say[a]), Math.round(top[1][a] / say[a]), Math.round(top[2][a] / say[a])]);
  while (pal.length < 256) pal.push([0, 0, 0]);
  const esle = new Int16Array(32768).fill(-1);
  const enYakin = (a) => {
    if (esle[a] >= 0) return esle[a];
    const r = ((a >> 10) & 31) * 8 + 4; const g = ((a >> 5) & 31) * 8 + 4; const b = (a & 31) * 8 + 4;
    let en = 0; let fark = Infinity;
    for (let i = 0; i < 255; i++) { const d = (pal[i][0] - r) ** 2 + (pal[i][1] - g) ** 2 + (pal[i][2] - b) ** 2; if (d < fark) { fark = d; en = i; } }
    esle[a] = en;
    return en;
  };
  const parcalar = [];
  const bas = Buffer.alloc(13);
  bas.write('GIF89a', 0, 'latin1');
  bas.writeUInt16LE(gen, 6); bas.writeUInt16LE(yuk, 8); bas[10] = 0xF7;
  parcalar.push(bas, Buffer.from(pal.flat()), Buffer.from([0x21, 0xFF, 11, ...Buffer.from('NETSCAPE2.0', 'latin1'), 3, 1, 0, 0, 0]));
  let once = null;
  for (const k of kareler) {
    const su = new Uint8Array(gen * yuk);
    for (let i = 0; i < gen * yuk; i++) su[i] = enYakin(((k.rgb[i * 3] >> 3) << 10) | ((k.rgb[i * 3 + 1] >> 3) << 5) | (k.rgb[i * 3 + 2] >> 3));
    let x0 = 0; let y0 = 0; let x1 = gen - 1; let y1 = yuk - 1;
    if (once) {
      x0 = gen; y0 = yuk; x1 = -1; y1 = -1;
      for (let i = 0; i < gen * yuk; i++) if (su[i] !== once[i]) { const x = i % gen; const y = (i - x) / gen; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0) { x0 = 0; y0 = 0; x1 = 0; y1 = 0; }
    }
    const g = (x1 - x0 + 1); const h = (y1 - y0 + 1);
    const parca = new Uint8Array(g * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < g; x++) { const i = (y + y0) * gen + x + x0; parca[y * g + x] = once && su[i] === once[i] ? 255 : su[i]; }
    const gce = Buffer.from([0x21, 0xF9, 4, 0x05, 0, 0, 255, 0]);
    gce.writeUInt16LE(Math.round(k.ms / 10), 4);
    const ic = Buffer.alloc(10);
    ic[0] = 0x2C; ic.writeUInt16LE(x0, 1); ic.writeUInt16LE(y0, 3); ic.writeUInt16LE(g, 5); ic.writeUInt16LE(h, 7);
    parcalar.push(gce, ic, Buffer.from([8]));
    const sik = lzw(parca);
    for (let p = 0; p < sik.length; p += 255) { const d = sik.subarray(p, p + 255); parcalar.push(Buffer.from([d.length]), d); }
    parcalar.push(Buffer.from([0]));
    once = su;
  }
  parcalar.push(Buffer.from([0x3B]));
  fs.writeFileSync(dosya, Buffer.concat(parcalar));
}

// ------------------------------------------------------------------ the scenes
let k = null;
let uyg = null;
(async () => {
  await new Promise((r) => dukkan.listen(0, '127.0.0.1', r));
  const dukkanAdres = 'http://127.0.0.1:' + dukkan.address().port + '/sneakers';
  uyg = spawn(process.execPath, [path.join(KOK, 'app', 'pagesiren.js'), '--data', path.join(gecici, 'veri'), '--port', String(UI_PORT), '--no-helper', '--headless', '--lang', DIL,
    '--clock-ms', '500', '--read-wait-ms', '400', '--reread-ms', '300', '--spread-ms', '0', '--open-limit', '100'], { stdio: 'ignore' });
  const mesaj = (m) => fetch(UI + '/mesaj', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m) }).then((r) => r.json());
  for (let i = 0; i < 60; i++) { try { await mesaj({ tip: 'LISTE' }); break; } catch (e) { await bekle(300); } }

  k = new Kamera();
  await k.ac();
  const kareler = [];
  const yazi = async (metin) => k.js(`(()=>{let e=document.getElementById('__alt');if(!e){e=document.createElement('div');e.id='__alt';e.style.cssText='position:fixed;left:0;right:0;bottom:0;padding:12px 18px;background:#000000d9;color:#fff;font:600 18px "Segoe UI",system-ui,sans-serif;text-align:center;z-index:99';document.body.appendChild(e);}e.textContent=${JSON.stringify(metin)};})()`);
  const cek = async (ms) => { kareler.push({ ...pngCoz(await k.foto()), ms }); };
  const izlemeyiBekle = async (kosul, sn) => { for (let i = 0; i < sn * 2; i++) { const d = await mesaj({ tip: 'LISTE' }); if (kosul(d)) return d; await bekle(500); } throw new Error('timed out'); };

  // 1) the page today
  await k.git(dukkanAdres);
  await yazi(METIN.y1);
  await cek(2200);

  // 2) add it
  await k.git(UI + '/');
  await bekle(800);
  await yazi(METIN.y2);
  // the add panel opens by itself while there are no watches; the slider's first step is 30 s
  await k.js(`(()=>{if(document.querySelector('#ekleBlok').hidden)document.querySelector('#ekleAc').click();const r=document.querySelector('#y_aralik');r.value='0';r.dispatchEvent(new Event('input'))})()`);
  await cek(700);
  for (const parca of METIN.ad) { await k.js(`document.querySelector('#y_ad').value=${JSON.stringify(parca)}`); await cek(260); }
  await k.js(`document.querySelector('#y_url').value=${JSON.stringify(dukkanAdres)}`);
  await cek(1400);
  await k.js(`document.querySelector('#ekleBtn').click()`);
  await bekle(700);
  await yazi(METIN.y3);
  await cek(1600);

  // 3) watching
  await izlemeyiBekle((d) => d.izlemeler[0] && /watching \d+ items|\d+ öğe izleniyor/.test(d.izlemeler[0].ozet) && !/awaiting|onay bekliyor/.test(d.izlemeler[0].ozet) && d.izlemeler[0].durum === 'izleniyor', 150);
  await bekle(5500);
  await yazi(METIN.y4);
  await cek(2800);

  // 4) the page changes
  stokta = true;
  await k.git(dukkanAdres);
  await yazi(METIN.y5);
  await cek(2000);

  // 5) siren
  await izlemeyiBekle((d) => d.alarmlar.some((a) => a.durum === 'yeni'), 150);
  await k.git(UI + '/alarm');
  await bekle(600);
  for (let i = 0; i < 5; i++) { await cek(600); await bekle(600); }
  await k.js(`document.body.style.animation='none'`); // the still picture: steady red, no blink
  await bekle(200);
  fs.writeFileSync(path.join(KOK, 'docs', 'alarm' + UZANTI + '.png'), await k.foto());

  // 6) the dashboard: what changed
  await k.git(UI + '/');
  await bekle(800);
  fs.writeFileSync(path.join(KOK, 'docs', 'screenshot' + UZANTI + '.png'), await k.foto());
  await yazi(METIN.y6);
  await cek(3800);

  const gif = path.join(KOK, 'docs', 'demo' + UZANTI + '.gif');
  gifYaz(kareler, gif);
  console.log(path.basename(gif) + ':', Math.round(fs.statSync(gif).size / 1024), 'KB,', kareler.length, 'frames');

  k.kapat();
  await fetch(UI + '/dur', { method: 'POST' }).catch(() => {});
  dukkan.close();
  await bekle(1500);
  uyg.kill();
  try { fs.rmSync(gecici, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }); } catch (e) { /* temp folder */ }
  process.exit(0);
})().catch(async (e) => {
  console.error(e);
  if (k) k.kapat();
  await fetch(UI + '/dur', { method: 'POST' }).catch(() => {});
  await bekle(1500);
  if (uyg) uyg.kill();
  process.exit(1);
});

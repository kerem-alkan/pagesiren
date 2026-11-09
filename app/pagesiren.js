#!/usr/bin/env node
// =====================================================================================================
// PageSiren — SMALL WATCH PROGRAM THAT DOESN'T LOAD INTO A BROWSER
// =====================================================================================================
// WHAT IT DOES: runs extension/background.js (the brain: reading, baseline, alarm rules) UNCHANGED inside Node. The chrome.* calls the
//   brain uses are provided here:
//     storage.local -> store.js (files)                 alarms -> setInterval
//     tabs + scripting -> virtual tabs: when an address arrives, a reader is chosen
//        okuyucu:'http' -> plain HTTP (no browser, very light; only for pages proven to have the info in raw HTML)
//        others         -> browser.js (a separate small Chrome; closes when idle)
//   The alarm window and sound live in PageSirenAlarm.exe on Windows (which also restarts this program if it gets stuck); elsewhere in a browser alarm window.
//
// RUN        : node app/pagesiren.js   (or: npx pagesiren)
// SCREEN     : http://127.0.0.1:47431/ (same screen as the extension's dashboard.html)
// DATA       : see veriKlasoru() below: store/ (watches, baselines, alarms), profile/ (reader browser; CONTAINS COOKIES,
//              must never go into git or a package), notify.json (notification settings), pagesiren.log
// OPTIONS    : see YARDIM below. For tests: --helper-port <n> --extension <folder> --headless --clock-ms <n> --read-wait-ms <n> --reread-ms <n> --idle-ms <n>
//              --health-ms <n> --alarm-retry-ms <n> --tabs <n> --spread-ms <n> --open-limit <n>
// =====================================================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');
const { Depo } = require('./store');
const { Tarayici, tarayiciBul } = require('./browser');
const { depoyaYaz } = require('./import');
const { Bildirim } = require('./notify');
const { yardimciHazirla } = require('./helper');
const otoBaslat = require('./autostart');

// ------------------------------------------------------------------ settings
const arg = (ad, varsayilan) => { const i = process.argv.indexOf('--' + ad); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : varsayilan; };
const YARDIM = `PageSiren - free, local page watcher with a siren.

Usage: pagesiren [options]

  --port <n>       Dashboard port (default 47431)
  --data <folder>  Where watches, the browser profile and logs are kept
  --chrome <path>  Chrome, Edge or Brave to use (default: found automatically)
  --lang <code>    Interface language: en, tr, de or es (default: the dashboard setting, then your system)
  --no-open        Don't open the dashboard when starting
  --no-helper      Windows: use the browser alarm window instead of the desktop helper
  --version        Show the version
  --help           Show this help

By Kerem Alkan. MIT license. https://github.com/kerem-alkan/pagesiren
`;
if (process.argv.includes('--help') || process.argv.includes('-h')) { process.stdout.write(YARDIM); process.exit(0); }
if (process.argv.includes('--version')) { process.stdout.write(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version + '\n'); process.exit(0); }
function veriKlasoru() {
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || os.homedir(), 'PageSiren');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'PageSiren');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'pagesiren');
}
const VERI = path.resolve(arg('data', veriKlasoru()));
const EKLENTI = arg('extension', path.join(__dirname, '..', 'extension'));
const UI_PORT = Number(arg('port', 47431));
const YARDIMCI_PORT = Number(arg('helper-port', 47430));
const GIZLI = process.argv.includes('--headless');
const EKRANI_AC = !GIZLI && !process.argv.includes('--no-open');
const CHROME_YOLU = arg('chrome', process.env.PAGESIREN_CHROME || tarayiciBul());
// A reading tab opens only when the clock strikes: 3 tabs per 30 s = at most 6 reads per minute. 15 s leaves a margin.
const SAAT_MS = Number(arg('clock-ms', 15000));
const SAGLIK_MS = Number(arg('health-ms', 15 * 60e3)); // if NO page could be read for this long, it raises its own alarm
const ESZAMANLI_TARAYICI_SEKMESI = Number(arg('tabs', 3));
const YEREL = 'pagesiren://local/';
const YARDIMCI_ESKI = 'http://127.0.0.1:47430';
const YARDIMCI = 'http://127.0.0.1:' + YARDIMCI_PORT;
const UI_KOKEN = 'http://127.0.0.1:' + UI_PORT;
const HTTP_UA = 'Mozilla/5.0 (compatible; PageSiren; local page monitor)';
const HTTP_EN_COK_BAYT = 8 * 1024 * 1024;

fs.mkdirSync(VERI, { recursive: true });
const LOG = path.join(VERI, 'pagesiren.log');
function gunluk(satir) {
  const s = new Date().toISOString() + ' ' + satir + '\n';
  try {
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 2e6) fs.renameSync(LOG, LOG + '.old');
    fs.appendFileSync(LOG, s);
  } catch (e) { /* if the log cannot be written, the program must not stop */ }
  if (process.stdout.isTTY) process.stdout.write(s);
}
const metne = (a) => a.map((x) => (x instanceof Error ? (x.stack || x.message) : typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
console.error = (...a) => gunluk('ERROR ' + metne(a));
console.log = (...a) => gunluk(metne(a));

const manifestYolu = path.join(EKLENTI, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestYolu, 'utf8'));
const depo = new Depo(path.join(VERI, 'store'));

// Tabs from the previous run no longer exist: the records get cleared. A watch interrupted mid-read must not wait a full interval, it's read again right away.
{
  const liste = depo.oku('izlemeler');
  if (liste && liste.some((x) => x.sekmeId != null)) {
    for (const x of liste) if (x.sekmeId != null) { x.sekmeId = null; x.sonYenileme = 0; }
    depo.set({ izlemeler: liste });
  }
}

let pidYazildi = false;
function cik(kod, neden) {
  gunluk('exiting (' + kod + '): ' + neden);
  try { depo.hemenYaz(); } catch (e) { /* harmless */ }
  if (pidYazildi) { try { fs.unlinkSync(path.join(VERI, 'pagesiren.pid')); } catch (e) { /* harmless */ } }
  process.exit(kod);
}
// A deliberate exit (Ctrl+C, the Quit menu): the reader browser closes, and the helper closes too so its supervisor doesn't bring the program back.
let kapaniyor = false;
async function kapan(kod, neden) {
  if (kapaniyor) return;
  kapaniyor = true;
  await Promise.race([tarayici.tamKapat().catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
  if (YARDIMCI_EXE) { try { await gercekFetch(YARDIMCI + '/cikis', { method: 'POST', signal: AbortSignal.timeout(800) }); } catch (e) { /* already closed */ } }
  cik(kod, neden);
}
process.on('uncaughtException', (e) => { gunluk('UNEXPECTED ERROR ' + (e && e.stack || e)); cik(1, 'unexpected error'); });
process.on('unhandledRejection', (e) => { gunluk('unhandled: ' + (e && e.stack || e)); });
process.on('SIGTERM', () => kapan(0, 'SIGTERM'));
process.on('SIGINT', () => kapan(0, 'SIGINT'));

function ekraniAc(yol) {
  const adres = UI_KOKEN + (yol || '/');
  const [komut, arglar] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', adres]] : process.platform === 'darwin' ? ['open', [adres]] : ['xdg-open', [adres]];
  try {
    const c = spawn(komut, arglar, { detached: true, stdio: 'ignore', windowsHide: true });
    c.on('error', (e) => gunluk('dashboard could not open: ' + e.message));
    c.unref();
  } catch (e) { gunluk('dashboard could not open: ' + e.message); }
}

// ------------------------------------------------------------------ helper (alarm window) connection
const gercekFetch = globalThis.fetch;
const bekleyenAlarm = []; // alarms that can't reach the helper: retried until they do, never lost
let alarmZamanlayici = null;
let ozetHatasi = 0;
// Windows: a small helper built from source shows the red window on top of everything (tests bring their own on another port).
// Anywhere else, or if it can't be built, or with --no-helper: a red browser window.
const YARDIMCISIZ = process.argv.includes('--no-helper');
const YARDIMCI_EXE = !YARDIMCISIZ && YARDIMCI_PORT === 47430 ? yardimciHazirla(VERI, manifest.version, gunluk) : null;
const YARDIMCI_VAR = !YARDIMCISIZ && (!!YARDIMCI_EXE || YARDIMCI_PORT !== 47430);
const bildirim = new Bildirim({ dosya: path.join(VERI, 'notify.json'), gunluk, fetch: (...a) => gercekFetch(...a) });

function yardimciyiBaslat() {
  if (!YARDIMCI_EXE) return;
  try {
    const c = spawn(YARDIMCI_EXE, ['--port', String(YARDIMCI_PORT), '--ui-port', String(UI_PORT), '--data', VERI, '--node', process.execPath, '--app', __filename, '--lang', globalThis.T ? T.dil() : 'en'],
      { detached: true, stdio: 'ignore' }); // single process (mutex): exits by itself if already running
    c.on('error', (e) => gunluk('helper could not start: ' + e.message));
    c.unref();
    gunluk('helper started');
  } catch (e) { gunluk('helper could not start: ' + e.message); }
}

// Browser alarm window (no helper): the app-mode window reads the list from /alarm-listesi and closes when it is empty.
const tarayiciAlarmlari = [];
let alarmPenceresi = null;
let alarmPenceresiSayisi = 0;
function tarayiciAlarmi(govde) {
  try { tarayiciAlarmlari.unshift(JSON.parse(govde)); } catch (e) { return; }
  tarayiciAlarmlari.length = Math.min(tarayiciAlarmlari.length, 10);
  if (alarmPenceresi) return;
  alarmPenceresiSayisi++;
  gunluk('browser alarm window');
  if (GIZLI) return;
  if (!CHROME_YOLU) { ekraniAc('/alarm'); return; }
  const bitti = () => { alarmPenceresi = null; tarayiciAlarmlari.length = 0; };
  alarmPenceresi = spawn(CHROME_YOLU, ['--user-data-dir=' + path.join(VERI, 'alarm-profile'), '--app=' + UI_KOKEN + '/alarm', '--autoplay-policy=no-user-gesture-required',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--window-size=780,560'], { detached: true, stdio: 'ignore' });
  alarmPenceresi.on('exit', bitti);
  alarmPenceresi.on('error', (e) => { bitti(); gunluk('alarm window could not open: ' + e.message); ekraniAc('/alarm'); });
  alarmPenceresi.unref();
}
async function alarmDene(govde) {
  try {
    const r = await gercekFetch(YARDIMCI + '/alarm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: govde, signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch (e) { return false; }
}
function alarmTekrarPlanla() {
  if (alarmZamanlayici) return;
  alarmZamanlayici = setTimeout(async () => {
    alarmZamanlayici = null;
    while (bekleyenAlarm.length && await alarmDene(bekleyenAlarm[0])) { bekleyenAlarm.shift(); gunluk('queued alarm reached the helper'); }
    if (bekleyenAlarm.length) { yardimciyiBaslat(); alarmTekrarPlanla(); }
  }, Number(arg('alarm-retry-ms', 3000)));
}
async function alarmGonder(govde) {
  if (!YARDIMCI_VAR) { tarayiciAlarmi(govde); return; }
  if (!bekleyenAlarm.length && await alarmDene(govde)) return;
  bekleyenAlarm.push(govde);
  gunluk('alarm could not reach the helper, queued (' + bekleyenAlarm.length + ')');
  yardimciyiBaslat();
  alarmTekrarPlanla();
}

// The brain's fetch: helper addresses map to the app's source, extension files come from disk. No other request passes through here.
globalThis.fetch = async (u, o) => {
  const s = String(u);
  if (s === YEREL + 'manifest.json') return new Response(fs.readFileSync(manifestYolu), { status: 200 });
  if (!s.startsWith(YARDIMCI_ESKI)) return gercekFetch(s, o);
  const yol = s.slice(YARDIMCI_ESKI.length);
  if (yol === '/alarm') { await alarmGonder(o.body); return new Response('{"ok":true}', { status: 200 }); }
  if (!YARDIMCI_VAR) {
    if (yol === '/kapat') tarayiciAlarmlari.length = 0;
    if (yol === '/durum') return new Response('{"ok":false}', { status: 503 });
    return new Response(yol === '/komutlar' ? '[]' : '{"ok":true}', { status: 200 });
  }
  if (yol === '/ozet' || yol === '/komutlar') {
    try {
      const r = await gercekFetch(YARDIMCI + yol + '?kaynak=mini', o);
      ozetHatasi = 0;
      return r;
    } catch (e) {
      if (yol === '/ozet' && ++ozetHatasi >= 3) { ozetHatasi = 0; gunluk('helper is not answering'); yardimciyiBaslat(); }
      throw e;
    }
  }
  return gercekFetch(YARDIMCI + yol, o);
};

// ------------------------------------------------------------------ virtual tabs
const dinle = () => { const l = []; return { l, addListener: (f) => l.push(f) }; };
const onUpdated = dinle();
const onRemoved = dinle();
const IZLEME_PENCERESI = 1;
let sonSekme = 0;
const sekmeler = new Map(); // id -> {id, windowId, url, pendingUrl, status, hedef, kapali, sayfa, kusak, hata, httpKod}
const hedeften = new Map(); // CDP targetId -> tab
let sonBasariliOkuma = Date.now();

const disari = (t) => ({ id: t.id, windowId: t.windowId, url: t.url, pendingUrl: t.pendingUrl, status: t.status, active: false, title: '' });
const yerelMi = (u) => String(u || '').startsWith(YEREL);
const izSahibi = (sekmeId) => (depo.oku('izlemeler') || []).find((x) => x.sekmeId === sekmeId);
const httpOkusunMu = (iz) => !!iz && iz.okuyucu === 'http';

// Show the state of watches left to the extension in Chrome on screen
async function eklentiDurumuAl() {
  if (!(depo.oku('izlemeler') || []).some((x) => x.aktif && x.okuyucu === 'eklenti')) return;
  let oz = null;
  try { oz = await (await gercekFetch(YARDIMCI + '/ozet?kaynak=eklenti', { signal: AbortSignal.timeout(1500) })).json(); } catch (e) { /* no helper: extension state unknown */ }
  await self.__PAGESIREN.uzakDurum(oz);
}

function tamamlandi(t) {
  t.status = 'complete';
  for (const f of onUpdated.l) Promise.resolve(f(t.id, { status: 'complete' }, disari(t))).catch((e) => console.error('onUpdated', e));
}
function hataSayfasi(t, neden) {
  t.url = 'chrome-error://chromewebdata/';
  t.pendingUrl = undefined;
  t.hata = neden;
  tamamlandi(t);
}
function sekmeBitti(t) {
  if (t.kapali) return;
  t.kapali = true;
  sekmeler.delete(t.id);
  if (t.hedef) hedeften.delete(t.hedef);
  for (const f of onRemoved.l) Promise.resolve(f(t.id, {})).catch((e) => console.error('onRemoved', e));
}

const tarayici = new Tarayici({
  chromeYolu: CHROME_YOLU,
  profil: path.join(VERI, 'profile'),
  gizli: GIZLI,
  bostaMs: Number(arg('idle-ms', 120000)),
  gunluk,
  olay: {
    adres: (hedef, url, hata) => {
      const t = hedeften.get(hedef);
      if (!t) return;
      t.kareUrl = url;
      if (hata) { t.url = 'chrome-error://chromewebdata/'; t.hata = 'page failed to load'; t.pendingUrl = undefined; return; }
      if (url === 'about:blank' && t.pendingUrl) return; // blank start page, the real address is on its way
      t.url = url;
      t.pendingUrl = undefined;
    },
    yuklendi: (hedef) => {
      const t = hedeften.get(hedef);
      if (!t || (t.pendingUrl && t.kareUrl === 'about:blank')) return;
      tamamlandi(t);
    },
    kapandi: (hedef) => { const t = hedeften.get(hedef); if (t) sekmeBitti(t); },
    hepsiKapandi: () => { for (const t of [...hedeften.values()]) sekmeBitti(t); },
  },
});

// A text that comes as "T&uuml;kendi" in raw HTML becomes "Tükendi" in a browser (outerHTML resolves the entity). The engine's text rules (OLUMSUZ, SATIS_SOZ)
// are written for the browser, so plain reading resolves them too. &amp; &lt; &gt; &quot; &nbsp; stay the same in a browser, untouched.
const ISARET = { uml: '\u0308', acute: '\u0301', grave: '\u0300', circ: '\u0302', tilde: '\u0303', ring: '\u030A', cedil: '\u0327', caron: '\u030C' };
const ADLI = { szlig: 'ß', oslash: 'ø', Oslash: 'Ø', aelig: 'æ', AElig: 'Æ', eth: 'ð', thorn: 'þ', times: '×', middot: '·', ndash: '–', mdash: '—', hellip: '…', euro: '€', copy: '©', reg: '®', raquo: '»', laquo: '«', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', deg: '°', bull: '•', apos: "'" };
function varlikCoz(html) {
  return html.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (tum, on, on6, ad) => {
    if (ad) {
      const m = ad.match(/^([a-z])(uml|acute|grave|circ|tilde|ring|cedil|caron)$/i);
      return m ? (m[1] + ISARET[m[2]]).normalize('NFC') : (ADLI[ad] || tum);
    }
    const n = on ? Number(on) : parseInt(on6, 16);
    if (n < 32 || n > 0x10FFFF || n === 34 || n === 38 || n === 60 || n === 62 || n === 160) return tum;
    return String.fromCodePoint(n);
  });
}

async function httpOku(t, adres, kusak) {
  const iz = izSahibi(t.id);
  try {
    const r = await gercekFetch(adres, {
      headers: { 'User-Agent': HTTP_UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'en,tr;q=0.8' },
      redirect: 'follow', signal: AbortSignal.timeout(30000),
    });
    const parcalar = [];
    let boy = 0;
    for await (const p of r.body) { boy += p.length; if (boy > HTTP_EN_COK_BAYT) throw new Error('page too big'); parcalar.push(p); }
    const kp = (String(r.headers.get('content-type')).match(/charset=["']?([\w-]+)/i) || [])[1] || 'utf-8';
    let html;
    try { html = new TextDecoder(kp).decode(Buffer.concat(parcalar)); } catch (e) { html = Buffer.concat(parcalar).toString('utf8'); }
    html = varlikCoz(html);
    if (t.kapali || t.kusak !== kusak) return;
    t.url = r.url || adres;
    t.pendingUrl = undefined;
    // 403/429: "don't wear the site out" rule -> no more plain HTTP to this address; the watch goes back to the browser reader (new baseline)
    if (r.status === 403 || r.status === 429) {
      gunluk('http ' + r.status + ', the watch goes back to the browser reader: ' + (iz ? iz.ad : adres));
      if (iz && self.__PAGESIREN) { await self.__PAGESIREN.islem({ tip: 'GUNCELLE', id: iz.id, okuyucu: '' }); await self.__PAGESIREN.islem({ tip: 'NOBET', id: iz.id }); }
      return hataSayfasi(t, 'HTTP ' + r.status);
    }
    if (r.status >= 400) return hataSayfasi(t, 'HTTP ' + r.status);
    t.sayfa = { html, url: t.url, baslik: (html.match(/<title[^>]*>([^<]*)/i) || [])[1] || '' };
    tamamlandi(t);
  } catch (e) {
    if (t.kapali || t.kusak !== kusak) return;
    hataSayfasi(t, String(e && e.message || e).slice(0, 80));
  }
}

// Sends the tab to an address. tabs.update returns at once (like Chrome); the work runs behind and onUpdated complete comes when done.
async function git(t, adres) {
  t.kusak = (t.kusak || 0) + 1;
  const kusak = t.kusak;
  t.pendingUrl = adres;
  t.status = 'loading';
  t.sayfa = null;
  t.hata = '';
  if (httpOkusunMu(izSahibi(t.id))) {
    if (t.hedef) { const h = t.hedef; t.hedef = null; hedeften.delete(h); tarayici.sekmeKapat(h).catch(() => {}); }
    return httpOku(t, adres, kusak);
  }
  try {
    if (!t.hedef) {
      const h = await tarayici.sekmeAc();
      if (t.kapali) { await tarayici.sekmeKapat(h); return; }
      t.hedef = h;
      hedeften.set(h, t);
    }
    const hata = await tarayici.git(t.hedef, adres);
    if (hata && !t.kapali && t.kusak === kusak) hataSayfasi(t, hata);
  } catch (e) {
    if (!t.kapali && t.kusak === kusak) hataSayfasi(t, String(e && e.message || e).slice(0, 80));
  }
}

globalThis.chrome = {
  storage: { local: depo },
  alarms: (() => {
    const saatler = new Map();
    const onAlarm = dinle();
    return {
      get: async (ad) => (saatler.has(ad) ? { name: ad } : undefined),
      create: (ad) => {
        if (saatler.has(ad)) return;
        saatler.set(ad, setInterval(() => { for (const f of onAlarm.l) f({ name: ad }); saglikKontrol(); eklentiDurumuAl().catch((e) => console.error('extension state', e)); }, SAAT_MS));
      },
      onAlarm,
    };
  })(),
  runtime: {
    getManifest: () => manifest,
    getURL: (p) => YEREL + p,
    reload: () => {
      // A new version on disk. The helper's supervisor restarts the program; without a helper it restarts itself (not in tests: they use another helper port).
      if (!YARDIMCI_EXE && YARDIMCI_PORT === 47430) spawn(process.execPath, [...process.argv.slice(1).filter((a) => a !== '--no-open'), '--no-open'], { detached: true, stdio: 'ignore' }).unref();
      cik(0, 'new version / reload');
    },
    sendMessage: async () => undefined, // sound is in the helper; the extension's own sound page doesn't exist here
    onMessage: dinle(), onStartup: dinle(), onInstalled: dinle(),
  },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, onClicked: dinle() },
  offscreen: { hasDocument: async () => true, createDocument: async () => {} },
  declarativeNetRequest: { getSessionRules: async () => [], updateSessionRules: async () => {} }, // blocking is in browser.js
  windows: {
    create: async () => ({ id: IZLEME_PENCERESI }),
    get: async (id) => { if (id !== IZLEME_PENCERESI) throw new Error('No window with id: ' + id); return { id }; },
    update: async () => {},
  },
  tabs: {
    onUpdated, onRemoved,
    create: async (o) => {
      const url = o.url || 'about:blank';
      // A site the user asked for (the "Open" button): a VISIBLE window on the reader profile. Login / verification happens there, later reads pass too.
      if (o.active && !yerelMi(url)) {
        tarayici.gorunurAc(url).catch((e) => gunluk('window could not open: ' + e.message));
        return { id: -1, windowId: 2, url, status: 'loading' };
      }
      const t = { id: ++sonSekme, windowId: o.windowId || IZLEME_PENCERESI, url: 'about:blank', status: 'complete' };
      sekmeler.set(t.id, t);
      if (yerelMi(url)) t.url = url; // placeholder / dashboard: no real tab needed
      else if (url !== 'about:blank') git(t, url);
      return disari(t);
    },
    get: async (id) => { const t = sekmeler.get(id); if (!t) throw new Error('No tab with id: ' + id); return disari(t); },
    update: async (id, o) => {
      const t = sekmeler.get(id);
      if (!t) throw new Error('No tab with id: ' + id);
      if (o && o.url) git(t, o.url);
      return disari(t);
    },
    remove: async (id) => {
      const t = sekmeler.get(id);
      if (!t) throw new Error('No tab with id: ' + id);
      const h = t.hedef;
      sekmeBitti(t);
      if (h) await tarayici.sekmeKapat(h);
    },
    query: async (q) => [...sekmeler.values()].filter((t) => (q && q.windowId != null ? t.windowId === q.windowId : true)).map(disari),
  },
  scripting: {
    executeScript: async ({ target, func, args }) => {
      const t = sekmeler.get(target.tabId);
      if (!t) throw new Error('No tab with id: ' + target.tabId);
      if (/^chrome-error:/.test(t.url)) throw new Error(t.hata || 'error page');
      if (t.sayfa) { // a page read over plain HTTP (nothing other than sayfaOku is requested)
        if (func.name !== 'sayfaOku') throw new Error('this page is read without a browser');
        sonBasariliOkuma = Date.now();
        return [{ result: t.sayfa }];
      }
      if (!t.hedef) throw new Error('page not open yet');
      const sonuc = await tarayici.calistir(t.hedef, func.toString(), args || [], 58000);
      sonBasariliOkuma = Date.now();
      return [{ result: sonuc }];
    },
  },
};

// ------------------------------------------------------------------ self health check
// If the program is running but no page can be read (browser can't open etc.), one alarm: watching must never stop silently.
let saglikUyarildi = false;
let saglikTaban = Date.now();
let sonSaat = Date.now();
function saglikKontrol() {
  const simdi = Date.now();
  if (simdi - sonSaat > Math.max(120000, SAAT_MS * 4)) saglikTaban = simdi; // computer slept: time starts over
  sonSaat = simdi;
  const aktif = (depo.oku('izlemeler') || []).filter((x) => x.aktif && x.okuyucu !== 'eklenti').length;
  const gecikme = simdi - Math.max(sonBasariliOkuma, saglikTaban);
  if (!aktif) { saglikTaban = simdi; saglikUyarildi = false; return; }
  if (gecikme < SAGLIK_MS) { saglikUyarildi = false; return; }
  if (saglikUyarildi) return;
  saglikUyarildi = true;
  gunluk('health: no page read for ' + Math.round(gecikme / 60000) + ' min');
  const uyari = {
    ad: T('PageSiren: WATCHING STOPPED'), url: UI_KOKEN + '/', zaman: new Date().toISOString(), ses: true, sesSn: 60,
    satirlar: [T('{n} minutes without reading any page. You may miss alarms!', { n: Math.round(gecikme / 60000) }), T('The program is running, but the reader browser may be unable to open. Check the dashboard.')],
  };
  bildirim.gonder(uyari);
  alarmGonder(JSON.stringify(uyari)).catch(() => {});
}

// ------------------------------------------------------------------ dashboard (local server)
const SUNULAN = { '/dashboard.js': 'text/javascript; charset=utf-8', '/i18n.js': 'text/javascript; charset=utf-8', '/icon.png': 'image/png', '/siren.wav': 'audio/wav', '/manifest.json': 'application/json' };
// Requests only the app can answer: the dashboard hides them in the extension.
const UYGULAMA_ISTEKLERI = {
  APP_DURUM: async () => ({ tarayici: CHROME_YOLU ? path.basename(CHROME_YOLU) : '', alarm: YARDIMCI_VAR ? 'helper' : 'browser', otoBaslat: otoBaslat.durum(VERI), bildirim: bildirim.ekranIcin() }),
  APP_BILDIRIM_KAYDET: async (m) => ({ ok: true, bildirim: bildirim.kaydet(m.ayar || {}) }),
  APP_BILDIRIM_TEST: async (m) => bildirim.testEt(String(m.kanal)),
  APP_OTOBASLAT: async (m) => otoBaslat.ayarla(!!m.acik, { exe: YARDIMCI_EXE, node: process.execPath, uygulama: __filename, veri: VERI, port: UI_PORT }),
  APP_ALARM_KAPAT: async () => { tarayiciAlarmlari.length = 0; return { ok: true }; },
};
const KROM_JS = 'window.__PAGESIREN_APP=true;window.chrome=window.chrome||{};chrome.runtime={'
  + 'sendMessage:(m)=>fetch("/mesaj",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(m)}).then((r)=>r.json()),'
  + 'getURL:(p)=>"/"+p,getManifest:()=>({version:"' + manifest.version + '"}),reload:()=>{}};\n';

function hostDogru(host) { return host === '127.0.0.1:' + UI_PORT || host === 'localhost:' + UI_PORT; } // against DNS rebinding attacks

const sunucu = http.createServer((q, c) => {
  const yanit = (kod, tip, govde) => { c.writeHead(kod, { 'Content-Type': tip, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); c.end(govde); };
  const json = (kod, o) => yanit(kod, 'application/json; charset=utf-8', JSON.stringify(o));
  if (!hostDogru(q.headers.host)) return json(403, { hata: 'host' });
  const yol = q.url.split('?')[0];
  if (q.method === 'GET') {
    if (yol === '/' || yol === '/dashboard.html') {
      const html = fs.readFileSync(path.join(EKLENTI, 'dashboard.html'), 'utf8').replace('<script src="dashboard.js"></script>', '<script src="/krom.js"></script><script src="/dashboard.js"></script>');
      return yanit(200, 'text/html; charset=utf-8', html);
    }
    if (yol === '/krom.js') return yanit(200, 'text/javascript; charset=utf-8', KROM_JS);
    if (yol === '/alarm') return yanit(200, 'text/html; charset=utf-8', fs.readFileSync(path.join(__dirname, 'alarm.html')));
    if (yol === '/alarm-listesi') return json(200, { dil: globalThis.T ? T.dil() : 'en', alarmlar: tarayiciAlarmlari });
    if (SUNULAN[yol]) { try { return yanit(200, SUNULAN[yol], fs.readFileSync(path.join(EKLENTI, yol.slice(1)))); } catch (e) { return json(404, {}); } }
    if (yol === '/saglik') return json(200, { ok: true, surum: manifest.version, pid: process.pid, tarayici: tarayici.calisiyorMu(), sekme: sekmeler.size, bekleyenAlarm: bekleyenAlarm.length, alarmPenceresi: alarmPenceresiSayisi, sonOkumaSn: Math.round((Date.now() - sonBasariliOkuma) / 1000), rssMb: Math.round(process.memoryUsage().rss / 1048576) });
    return json(404, {});
  }
  if (q.method === 'POST' && (yol === '/mesaj' || yol === '/dur' || yol === '/ice-aktar')) {
    // Web pages can't write here: a browser always sends Origin on a cross-site request. Origin-less = a tool on this computer.
    const koken = q.headers.origin;
    if (koken && koken !== UI_KOKEN && koken !== 'http://localhost:' + UI_PORT) return json(403, { hata: 'koken' });
    if (koken && yol !== '/mesaj') return json(403, { hata: 'local tools only' }); // closing and bulk data writes aren't available from the screen either
    if (yol === '/dur') {
      json(200, { ok: true });
      return void kapan(0, 'stop request');
    }
    const parcalar = [];
    let boy = 0;
    q.on('data', (p) => { boy += p.length; if (boy <= 1e6) parcalar.push(p); });
    q.on('end', async () => {
      if (boy > 1e6) return json(413, { hata: 'buyuk' });
      try {
        if (yol === '/ice-aktar') {
          let sonuc;
          try { sonuc = depoyaYaz(JSON.parse(Buffer.concat(parcalar).toString('utf8')), depo, /force=1/.test(q.url)); } catch (e) { return json(409, { hata: e.message }); }
          gunluk('imported: ' + JSON.stringify(sonuc));
          self.__PAGESIREN.tik();
          return json(200, sonuc);
        }
        const m = JSON.parse(Buffer.concat(parcalar).toString('utf8'));
        const cevap = m && Object.hasOwn(UYGULAMA_ISTEKLERI, m.tip) ? await UYGULAMA_ISTEKLERI[m.tip](m) : await self.__PAGESIREN.islem(m);
        json(200, cevap === undefined ? {} : cevap);
      } catch (e) { json(500, { hata: String(e && e.message || e) }); }
    });
    return undefined;
  }
  return json(405, {});
});

// ------------------------------------------------------------------ startup
sunucu.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    // Already running: just show its screen.
    if (EKRANI_AC) { process.stdout.write('PageSiren is already running: ' + UI_KOKEN + '/\n'); ekraniAc('/'); }
    cik(3, 'another PageSiren is running (port ' + UI_PORT + ')');
  } else { gunluk('server error: ' + e.message); cik(1, 'server error'); }
});
// The brain starts only after the server port is taken: two brains never run at once (no double alarms).
sunucu.listen(UI_PORT, '127.0.0.1', () => {
  globalThis.self = globalThis;
  self.__MINI = true;
  self.__ESZAMANLI_SEKME = ESZAMANLI_TARAYICI_SEKMESI;
  const sayi = (ad, oz) => { const v = arg(ad); if (v != null) self[oz] = Number(v); };
  sayi('read-wait-ms', '__TEST_OKUMA_BEKLE_MS');
  sayi('reread-ms', '__TEST_TEKRAR_OKU_MS');
  sayi('spread-ms', '__TEST_YAYMA_MS');
  sayi('open-limit', '__TEST_ACMA_SINIRI');
  self.__DIL = arg('lang', '');
  self.__BILDIRIM = (o) => bildirim.gonder(o);
  globalThis.importScripts = (f) => vm.runInThisContext(fs.readFileSync(path.join(EKLENTI, f), 'utf8'), { filename: f });
  fs.writeFileSync(path.join(VERI, 'pagesiren.pid'), String(process.pid));
  pidYazildi = true;
  gunluk('started: version ' + manifest.version + ', pid ' + process.pid + ', ' + (depo.oku('izlemeler') || []).filter((x) => x.aktif).length + ' active watches');
  if (otoBaslat.tazele({ exe: YARDIMCI_EXE, node: process.execPath, uygulama: __filename, veri: VERI, port: UI_PORT })) gunluk('start at login now points to this copy');
  vm.runInThisContext(fs.readFileSync(path.join(EKLENTI, 'background.js'), 'utf8'), { filename: 'background.js' });
  yardimciyiBaslat();
  if (EKRANI_AC) { process.stdout.write('PageSiren is running: ' + UI_KOKEN + '/   (Ctrl+C to quit)\n'); ekraniAc('/'); }
});

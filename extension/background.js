// =====================================================================================================
// PageSiren — BACKGROUND (the brain)                                   Chrome MV3 service worker
// =====================================================================================================
// WHAT IT DOES
//   Opens the pages the user added (watches) in a real browser tab at set intervals,
//   reads the page's HTML and compares it with the previous "baseline" using engine.js; if a change looks
//   like something worth telling the user, it raises an ALARM (red window + sound).
//
// RUNS IN TWO HOMES (this file is IDENTICAL in both):
//   Chrome extension    : as written below. While the app runs, it only reads the watches the app left to it (fallback: reads all if the app goes quiet).
//   app/pagesiren.js (Node): self.__MINI = true; the app provides chrome.* (store files, virtual tabs, 15 s clock).
//                            Who reads a watch: the okuyucu field ('' separate browser, 'http' plain HTTP, 'eklenti' the extension in the user's Chrome).
//
// DATA (this file is the only writer — chrome.storage.local):
//   izlemeler        : watch list  [{id, ad, url, aralikSn, aktif, durum, sorun, ozet, kelimeler,
//                      herDegisiklik, hizli, kaliciSekme, girisYazisi, okuyucu, yoksay[], sekmeId, son*...}]
//   motor_<id>       : that watch's engine state {taban, bekleyen, etiket, isinma}
//   alarmlar         : last 50 alarms  [{id, izId, ad, url, zaman, satirlar[], anahtarlar[], durum}]
//   arsiv            : watches that left the list, both restorable: neden 'silindi' (Delete, last 50) or 'alindi' (Got it, last 100)
//   ayarlar          : {ustte, ses, sesSn, hafifSekme, dil}
//   pencereId, motorSurum : watch window id, version of the last warm-up
//
// FLOW (a "tick" every 30 s)
//   tik -> tikIc -> tekIzleme for each watch (open tab / reload / detect problems) -> tab "complete"
//   -> okumaPlanla (5 s) -> oku (2-3 times if needed, the last read is processed) -> M.turIsle (baseline/confirm)
//   -> alarmSuz (direction rule, keyword filter, ignore list) -> alarmVer -> helper /alarm
//   At the end of a tick, yardimciEsle writes a status summary to the helper (/ozet) and takes queued commands (/komutlar).
//
// FILE MAP (sections are marked with "// ----")
//   constants + settings .......... intervals, waits, light-mode limits
//   watch list .................... izlemeler(), izDegistir() (all writes go through the sirali() lock)
//   window / tabs ................. watch window, sekmeAc, okununcaKapat, event log
//   clock (30 s) .................. tik, yardimciEsle (/ozet + /komutlar + DISA_AKTAR), motorOzeti,
//                                   miniBiraktiklari / uyu (extension sleep), uzakDurum (extension-read watches on the app screen),
//                                   tarayicisiz, yetimleriTemizle, tikIc, hafiflet (image/font blocking), tekIzleme,
//                                   gittiIsle (tab went elsewhere: bot wall / queue / login)
//   reading ....................... okumaPlanla, sayfaOku (runs inside the tab), oku
//   alarm rules ................... BOT_SAYFASI, BOT_YOLU, SATIS_SOZ, OLUMSUZ, alarmSuz
//   alarm ......................... alarmVer, yardimciyaYolla, alarmKapat, sound, dashboard, badge
//   requests ...................... islem() — dashboard and helper commands (EKLE, GUNCELLE, ...)
//   setup ......................... event listeners, surumIsinmasi
//
// IMPORTANT RULES (see docs/ARCHITECTURE.md)
//   - Bot protection / queues / captchas are NEVER bypassed; nothing is bought, added to a cart or logged in to.
//   - A dead or stale watch never looks green. Problems are quiet (orange); the siren is only for changes and queues.
// =====================================================================================================
importScripts('i18n.js');
importScripts('engine.js');

const M = self.GENEL_MOTOR;

const YARDIMCI = 'http://127.0.0.1:47430';
const YAYMA_MS = typeof self.__TEST_YAYMA_MS === 'number' ? self.__TEST_YAYMA_MS : 25000; // spread reloads across the round
const ARALIKLAR = [30, 60, 120, 180, 300, 600, 1800]; // ready-made choices on screen: 30 s, 1-2-3-5-10 min, half an hour
// Values in between are allowed through commands: multiples of 30 s, at most 1 hour.
// From 30 seconds to a day, in steps of 30 seconds (the dashboard slider goes 30 s ... 1 d)
const gecerliAralik = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 30 && n <= 86400 && n % 30 === 0; };
const OKUMA_BEKLE_MS = typeof self.__TEST_OKUMA_BEKLE_MS === 'number' ? self.__TEST_OKUMA_BEKLE_MS : 5000; // wait after the page says "loaded"
const TEKRAR_OKU_MS = typeof self.__TEST_TEKRAR_OKU_MS === 'number' ? self.__TEST_TEKRAR_OKU_MS : 6000;      // look once more if the page looks very empty
const SATIN_ALMA_DK = 30;        // after an alarm, the page is not reloaded for at most this long until the user looks
const okumaPayiMs = (aralikSn) => (aralikSn + Math.max(150, aralikSn / 2)) * 1000;

const al = (k) => chrome.storage.local.get(k).then((o) => o[k]);
const koy = (k, v) => chrome.storage.local.set({ [k]: v });
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
let kilit = Promise.resolve();
// The lock is held at most this long: if a call inside never answers, all writes must not stop.
const KILIT_EN_COK_MS = 60000;
function sirali(fn) {
  const p = kilit.then(fn, fn);
  kilit = new Promise((coz) => { const zt = setTimeout(coz, KILIT_EN_COK_MS); const bitti = () => { clearTimeout(zt); coz(); }; p.then(bitti, bitti); });
  return p;
}
// Chrome calls have a TIMEOUT: a single call that never answered could otherwise freeze the whole clock for hours.
// If no answer comes, it throws; callers already catch it.
const KROM_MS = typeof self.__TEST_KROM_MS === 'number' ? self.__TEST_KROM_MS : 8000;
const krom = (p, ms) => new Promise((coz, red) => {
  const zt = setTimeout(() => red(new Error('Chrome did not answer')), ms || KROM_MS);
  Promise.resolve(p).then((v) => { clearTimeout(zt); coz(v); }, (e) => { clearTimeout(zt); red(e); });
});
const yeniId = () => Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

// hafifSekme (light mode): a watch tab opens only when it's time to read and closes after a clean read (saves gigabytes of RAM with many watches)
const VARSAYILAN_AYAR = { ustte: true, ses: true, sesSn: 60, hafifSekme: true, dil: '' };
const ESZAMANLI_SEKME = typeof self.__ESZAMANLI_SEKME === 'number' ? self.__ESZAMANLI_SEKME : 3; // in light mode, at most this many watch tabs at once (RAM)
const HAFIF_ACMA_SINIRI = typeof self.__TEST_ACMA_SINIRI === 'number' ? self.__TEST_ACMA_SINIRI : 4; // in light mode, at most this many new tabs per 25 s (2 in normal mode)
async function ayarlar() { const ay = Object.assign({}, VARSAYILAN_AYAR, (await al('ayarlar')) || {}); T.dil(ay.dil); return ay; }

function normUrl(u) {
  try {
    const x = new URL(u);
    return (x.host + x.pathname + x.search).replace(/\/$/, '').toLowerCase();
  } catch (e) { return String(u || '').toLowerCase(); }
}
const ayniSayfa = (tabUrl, iz) => !!tabUrl && (normUrl(tabUrl) === normUrl(iz.url) || (!!iz.gercekUrl && normUrl(tabUrl) === iz.gercekUrl));
const kisaAdres = (u) => { try { const x = new URL(u); return x.host + x.pathname; } catch (e) { return String(u || ''); } };

// ------------------------------------------------------------------ watch list
async function izlemeler() { return (await al('izlemeler')) || []; }

function izDegistir(id, fn) {
  return sirali(async () => {
    const liste = await izlemeler();
    const iz = liste.find((x) => x.id === id);
    if (!iz) return null;
    await fn(iz);
    await koy('izlemeler', liste);
    return iz;
  });
}

// ------------------------------------------------------------------ window / tabs
async function izlemePenceresi() {
  const id = await al('pencereId');
  if (id != null) { try { await krom(chrome.windows.get(id)); return id; } catch (e) { /* already closed */ } }
  return null;
}

// Light-mode diagnostics: last tab events per watch (memory only, written to /ozet; repeated events are not logged twice)
const olaylar = new Map();
function olay(izId, yazi) {
  const l = olaylar.get(izId) || [];
  if (l.length && l[l.length - 1].slice(9) === yazi) return;
  l.push(new Date().toISOString().slice(11, 19) + ' ' + yazi);
  olaylar.set(izId, l.slice(-8));
}

// A "placeholder" tab always stays in the watch window: while watch tabs open and close in light mode
// the window must not close (opening a new window each time could show on screen).
const yerTutucuUrl = () => chrome.runtime.getURL('waiting.html');

// bos=true: the tab opens at about:blank first; the caller sends it to the real address after image blocking is set up.
async function sekmeAc(iz, bos) {
  let pid = await izlemePenceresi();
  if (pid == null) {
    const w = await krom(chrome.windows.create({ url: yerTutucuUrl(), state: 'minimized', focused: false }));
    await koy('pencereId', w.id);
    pid = w.id;
  }
  const t = await krom(chrome.tabs.create({ windowId: pid, url: bos ? 'about:blank' : iz.url, active: false }));
  try { await krom(chrome.tabs.update(t.id, { muted: true })); } catch (e) { /* harmless */ }
  return t.id;
}

// LIGHT MODE: a tab that was read gets closed, even if there was a PROBLEM (tabs parked on login / bot walls / queues would hold the RAM).
// It reopens when the watch is due; on a bot wall at most once per 15 min (botDuvari).
// The user passes a check or login with the "Open" button: same browser profile, so later reads pass too.
// Only a queue page stays open (so it doesn't lose its place in line).
async function okununcaKapat(iz, sekmeId) {
  if (!iz || iz.sekmeId !== sekmeId || iz.kaliciSekme) return;
  if ((await ayarlar()).hafifSekme === false) return;
  olay(iz.id, iz.durum === 'sorun' ? 'read with a problem, closed' : 'read, closed');
  await izDegistir(iz.id, (x) => { if (x.sekmeId === sekmeId) x.sekmeId = null; });
  try { await krom(chrome.tabs.remove(sekmeId)); } catch (e) { /* already closed */ }
}

// ------------------------------------------------------------------ clock (30 s)
let tikSuruyor = false;
let tikBasladi = 0;
let tikTakilma = 0; // how many stuck rounds were abandoned (shown in the summary)
const TIK_TAKILDI_MS = typeof self.__TEST_TIK_TAKILDI_MS === 'number' ? self.__TEST_TIK_TAKILDI_MS : 120000;
const acmaZamanlari = []; // recent tab-open times (rate limit: at most 2 per 25 s; 4 in light mode)
let tur = { hafif: false, acik: 0 }; // this round's settings and number of open watch tabs
// If a Chrome call inside tikIc never answers, tikSuruyor would stay true forever. The clock alarm keeps the service worker awake
// (no restart, no reset), so no page would be read and no summary written for hours, and commands would not arrive.
// So: we sync with the helper while a round is running, and a round that exceeds TIK_TAKILDI_MS is abandoned and a new one starts.
async function tik() {
  const simdi = Date.now();
  if (tikSuruyor && simdi - tikBasladi < TIK_TAKILDI_MS) { await yardimciEsle(); return; }
  if (tikSuruyor) { tikTakilma++; console.error('tick stuck, starting a new round'); }
  tikSuruyor = true;
  tikBasladi = simdi;
  try { await tikIc(); } catch (e) { console.error('tik', e); } finally { if (tikBasladi === simdi) tikSuruyor = false; }
  await yardimciEsle();
}

// Sync with the desktop helper: write the status summary, take queued local commands.
const KOMUT_IZINLI = ['EKLE', 'GUNCELLE', 'NOBET', 'NOBET_HEPSI', 'DURAKLAT', 'BASLAT', 'ALARM_KAPAT', 'DISA_AKTAR'];
// DISA_AKTAR: the next summary includes a FULL backup (watches with all fields, last 200 alarms, deleted and got-it watches, settings).
// For backups or moving to another computer.
let disaAktarIstendi = false;
// If the version on disk differs from the loaded one, the extension reloads itself: after the files change and the manifest version
// goes up, new code runs within 30 s, without clicking in chrome://extensions and without relying on the command queue.
async function diskteYeniSurumVar() {
  try {
    const r = await krom(fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' }));
    const d = await krom(r.json());
    if (d && d.version && d.version !== chrome.runtime.getManifest().version) { chrome.runtime.reload(); return true; }
  } catch (e) { /* harmless */ }
  return false;
}
async function yardimciEsle() {
  if (await diskteYeniSurumVar()) return;
  try {
    const simdi = Date.now();
    const liste = await izlemeler();
    const alarmlar = (await al('alarmlar')) || [];
    const motorlar = await Promise.all(liste.map((x) => al('motor_' + x.id).catch(() => null)));
    // The helper cuts bodies larger than 200 KB -> large lists are trimmed.
    const kirp = (x) => { const { sekmeId, sonAlarmKalkan, ...g } = x; return { ...g, yoksay: (x.yoksay || []).slice(0, 60) }; };
    let yedek;
    if (disaAktarIstendi) {
      yedek = {
        zaman: new Date().toISOString(), surum: chrome.runtime.getManifest().version,
        izlemeler: liste.map(kirp), alarmlar: alarmlar.map((a) => ({ ...a, anahtarlar: (a.anahtarlar || []).slice(0, 20) })),
        arsiv: ((await al('arsiv')) || []).map(kirp), ayarlar: await ayarlar(),
      };
      if (JSON.stringify(yedek).length > 110000) { // a non-Latin letter takes 2 bytes in UTF-8: leave a margin
        yedek.izlemeler = yedek.izlemeler.map((x) => ({ ...x, yoksay: (x.yoksay || []).length + ' keys (trimmed)' }));
        yedek.arsiv = yedek.arsiv.map((x) => ({ ...x, yoksay: (x.yoksay || []).length + ' keys (trimmed)' }));
        yedek.alarmlar = yedek.alarmlar.map((a) => ({ ...a, anahtarlar: undefined }));
        yedek.kirpildi = true;
      }
    }
    let sekmeListesi = [];
    try { sekmeListesi = await krom(chrome.tabs.query({})); } catch (e) { /* the summary still goes out */ }
    // aktifSayi is the FIRST field: the helper's watchdog looks at the start of the body to decide "is anything being watched"
    const gitti = await yardimciyaYolla('/ozet', {
      aktifSayi: liste.filter((x) => x.aktif).length,
      ok: true, zaman: new Date().toISOString(), surum: chrome.runtime.getManifest().version,
      tikTakilma, sonTikSn: Math.round((simdi - tikBasladi) / 1000),
      ...(yedek ? { disaAktar: yedek } : {}),
      pencere: await izlemePenceresi(),
      izlemeler: liste.map((x, i) => ({
        id: x.id, ad: x.ad, url: x.url, aktif: x.aktif, durum: x.durum, sorun: x.sorun, ozet: x.ozet,
        aralikSn: x.aralikSn, sonKontrolSn: x.sonKontrol ? Math.round((simdi - x.sonKontrol) / 1000) : null,
        sekme: x.sekmeId, hata: x.hata || '', kuyrukSessiz: !!x.kuyrukSessiz,
        kelimeler: x.kelimeler || '', herDegisiklik: !!x.herDegisiklik, hizli: !!x.hizli, kaliciSekme: !!x.kaliciSekme, girisYazisi: x.girisYazisi || '', okuyucu: x.okuyucu || '',
        ...motorOzeti(motorlar[i], x),
        sonYenilemeSn: x.sonYenileme ? Math.round((simdi - x.sonYenileme) / 1000) : null,
        olaylar: olaylar.get(x.id) || [],
      })),
      acikAlarmlar: alarmlar.filter((a) => a.durum === 'yeni').map((a) => ({ id: a.id, ad: a.ad, zaman: a.zaman, satirlar: a.satirlar, anahtarlar: (a.anahtarlar || []).slice(0, 80) })),
      tumSekmeler: sekmeListesi.filter((t) => /^https?:/.test(t.url || '')).map((t) => {
        let a = t.url; try { const u = new URL(t.url); a = u.host + u.pathname; } catch (e) { /* harmless */ }
        return { pencere: t.windowId, izleme: liste.some((x) => x.sekmeId === t.id), adres: a.slice(0, 140) };
      }),
      sonAlarmlar: alarmlar.slice(0, 10).map((a) => ({ ad: a.ad, zaman: a.zaman, durum: a.durum, satir: (a.satirlar || [])[0] })),
    });
    if (yedek && gitti) disaAktarIstendi = false; // once is enough if the backup reached the helper
  } catch (e) {
    // Summary could not be prepared: the reason is still written to the helper (never swallowed silently) and commands are taken
    console.error('ozet', e);
    await yardimciyaYolla('/ozet', { aktifSayi: null, ok: false, zaman: new Date().toISOString(), surum: chrome.runtime.getManifest().version, hata: String(e && e.message || e), tikTakilma, izlemeler: [] });
  }
  try {
    const ctl = new AbortController();
    const zt = setTimeout(() => ctl.abort(), 1500);
    let komutlar = [];
    try { const r = await fetch(YARDIMCI + '/komutlar', { signal: ctl.signal }); if (r.ok) komutlar = await r.json(); } finally { clearTimeout(zt); }
    for (const m of Array.isArray(komutlar) ? komutlar : []) {
      if (m && m.tip === 'YENIDEN_YUKLE') { chrome.runtime.reload(); return; } // load the new version from disk
      if (m && KOMUT_IZINLI.includes(m.tip)) await islem(m);
    }
  } catch (e) { /* helper closed: not a problem */ }
}

// For the summary: sale-status texts in the baseline and differences awaiting confirmation. On sites with bot walls this
// is the only way to see from outside what the page shows in the user's browser
// (it sends no request to the site).
function motorOzeti(m, iz) {
  if (!m || !m.taban) return {};
  const et = m.etiket || {};
  const yazi = (k) => k[0] + ': ' + String(et[k] || k.slice(2)).slice(0, 80);
  const anahtarlar = Object.keys(m.taban.text || {}).concat(Object.keys(m.taban.ids || {}));
  const durumYazilari = [
    ...anahtarlar.filter((k) => k[0] === 'D' || k[0] === 'M'),
    ...anahtarlar.filter((k) => k[0] !== 'D' && k[0] !== 'M' && OLUMSUZ.test(k.slice(2))),
    ...anahtarlar.filter((k) => k[0] !== 'D' && k[0] !== 'M' && !OLUMSUZ.test(k.slice(2)) && SATIS_SOZ.test(k.slice(2))),
  ].slice(0, 12).map(yazi);
  const b = m.bekleyen || {};
  const bekleyen = (b.added || []).map((k) => '+ ' + yazi(k)).concat((b.removed || []).map((k) => '- ' + yazi(k))).slice(0, 12);
  // detay (GUNCELLE {id, detay:true}): ALL baseline keys (with link addresses) — to see what is being read on a new site.
  // Turn off when done (the summary grows).
  if (iz && iz.detay) return { durumYazilari, bekleyen, anahtarlar: anahtarlar.slice(0, 400).map((k) => k.slice(0, 110) + (et[k] && et[k] !== k.slice(2) ? ' = ' + String(et[k]).slice(0, 60) : '')) };
  return { durumYazilari, bekleyen };
}

// Orphan tabs in the watch window: if one is on the address of a watch without a tab, it gets attached to it,
// otherwise closed (at most 40 per round).
async function yetimleriTemizle(liste) {
  const pid = await izlemePenceresi();
  if (pid == null) return;
  let sekmeler;
  try { sekmeler = await krom(chrome.tabs.query({ windowId: pid })); } catch (e) { return; }
  let kapatilan = 0;
  const yer = yerTutucuUrl();
  let yerVar = false;
  for (const t of sekmeler) {
    if ((t.url || t.pendingUrl || '').startsWith(yer)) { // a single placeholder stays
      if (yerVar) { try { await krom(chrome.tabs.remove(t.id)); } catch (e) { /* harmless */ } }
      yerVar = true;
      continue;
    }
    if (liste.some((x) => x.sekmeId === t.id)) continue;
    const sahipsizIz = liste.find((x) => x.aktif && x.sekmeId == null && ayniSayfa(t.url || t.pendingUrl || '', x));
    if (sahipsizIz) { await izDegistir(sahipsizIz.id, (x) => { x.sekmeId = t.id; x.sekmeAcilis = Date.now(); }); continue; }
    if (kapatilan >= 40) break;
    kapatilan++;
    try { await krom(chrome.tabs.remove(t.id)); } catch (e) { /* already closed */ }
  }
  if (!yerVar) { try { await krom(chrome.tabs.create({ windowId: pid, url: yer, active: false })); } catch (e) { /* harmless */ } }
}

// If the app (app/pagesiren.js) is running, the extension sleeps: the same watches must not be read twice (double alarms), and Chrome RAM must not be wasted.
// It only reads the watches the app marks okuyucu:'eklenti' (some sites treat the separate browser as automation and show a verification wall;
// they work in the user's own Chrome). If the app writes no summary for 3 min the helper says "mini: false" and the extension reads everything (fallback).
// Returns: null = no app; otherwise the ids of the watches the extension reads.
async function miniBiraktiklari() {
  if (self.__MINI) return null;
  const ctl = new AbortController();
  const zt = setTimeout(() => ctl.abort(), 1500);
  try {
    const d = await (await fetch(YARDIMCI + '/durum', { signal: ctl.signal })).json();
    if (!d.mini) return null;
    const oz = await (await fetch(YARDIMCI + '/ozet?kaynak=mini', { signal: ctl.signal })).json();
    return new Set((oz.izlemeler || []).filter((x) => x.okuyucu === 'eklenti').map((x) => x.id));
  } catch (e) { return null; } finally { clearTimeout(zt); }
}
async function uyu(liste, hepsi) {
  for (const x of liste) {
    if (x.sekmeId == null) continue;
    try { await krom(chrome.tabs.remove(x.sekmeId)); } catch (e) { /* already closed */ }
    await izDegistir(x.id, (y) => { y.sekmeId = null; });
  }
  if (!hepsi) return;
  const pid = await izlemePenceresi();
  if (pid == null) return;
  try { for (const t of await krom(chrome.tabs.query({ windowId: pid }))) await krom(chrome.tabs.remove(t.id)); } catch (e) { /* harmless */ }
}
// App side: show the latest state of extension-read watches on screen. If the extension is not running they turn orange: a dead watch never looks green.
// oz: extension summary from the helper (null if none)
async function uzakDurum(oz) {
  const simdi = Date.now();
  const taze = !!oz && !!oz.zaman && simdi - Date.parse(oz.zaman) < 180000;
  await sirali(async () => {
    const liste = await izlemeler();
    let degisti = false;
    for (const x of liste) {
      if (x.okuyucu !== 'eklenti' || !x.aktif) continue;
      const e = taze ? (oz.izlemeler || []).find((y) => y.id === x.id) : null;
      const g = e
        ? { durum: e.durum, sorun: e.sorun || '', ozet: e.ozet || '', sonKontrol: e.sonKontrolSn != null ? simdi - e.sonKontrolSn * 1000 : 0 }
        : { durum: 'sorun', ozet: '', sonKontrol: x.sonKontrol || 0, sorun: T('This site is read by the Chrome extension, but the extension is not running: NOT BEING READ. Open Chrome; if the extension is off, turn it on at chrome://extensions.') };
      for (const k of Object.keys(g)) if (x[k] !== g[k]) { x[k] = g[k]; degisti = true; }
    }
    if (degisti) await koy('izlemeler', liste);
  });
}
// A watch read without a browser (app only): not counted against the tab limit, no browser opens.
const tarayicisiz = (x) => !!self.__MINI && x.okuyucu === 'http';

async function tikIc() {
  const simdi = Date.now();
  let liste = await izlemeler();
  const mini = await miniBiraktiklari();
  if (mini) {
    await uyu(liste.filter((x) => !mini.has(x.id)), !mini.size);
    if (!mini.size) return;
    liste = liste.filter((x) => mini.has(x.id));
  }
  acmaZamanlari.splice(0, acmaZamanlari.length, ...acmaZamanlari.filter((z) => simdi - z < 25000));
  // Tabs parked in a queue don't count against the limit: they must not block the others.
  // The counter is computed from tabs that are REALLY open (after a Chrome restart, old tab ids could stay in the records,
  // count as "open", fill the limit, and no page would be read).
  let canli = null;
  try { canli = new Set((await krom(chrome.tabs.query({}))).map((t) => t.id)); } catch (e) { canli = null; }
  tur = {
    hafif: (await ayarlar()).hafifSekme !== false,
    acik: liste.filter((x) => x.aktif && x.sekmeId != null && (!canli || canli.has(x.sekmeId)) && !x.kuyrukBasi && !x.kaliciSekme && !tarayicisiz(x)).length,
  };
  let yenilenenSay = 0;
  // Order of opening tabs in light mode: most overdue first (in list order, the last watches
  // could not get a turn for minutes while work was piling up).
  const gecikme = (x) => simdi - (x.sonYenileme || 0) - x.aralikSn * 1000;
  const sira = tur.hafif ? [...liste].sort((a, b) => gecikme(b) - gecikme(a)) : liste;
  // An error in one watch doesn't stop the others
  for (const iz of sira) {
    try { yenilenenSay = await tekIzleme(iz, simdi, yenilenenSay); } catch (e) { olay(iz.id, 'round error: ' + String(e && e.message || e).slice(0, 60)); }
  }
  await yetimleriTemizle(await izlemeler());
  await hafiflet();
  await rozet();
}

// Watch tabs block images/video/fonts (browser load): a session rule.
let hafifSekmeler = '';
async function hafiflet() {
  try {
    const liste = await izlemeler();
    const ids = liste.map((x) => x.sekmeId).filter((x) => x != null);
    const anahtar = ids.sort((a, b) => a - b).join(',');
    if (anahtar === hafifSekmeler) return;
    hafifSekmeler = anahtar;
    const eski = await krom(chrome.declarativeNetRequest.getSessionRules());
    await krom(chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: eski.map((r) => r.id),
      addRules: ids.length ? [{
        id: 1, priority: 1,
        action: { type: 'block' },
        condition: { tabIds: ids, resourceTypes: ['image', 'media', 'font'] },
      }] : [],
    }));
  } catch (e) { /* harmless */ }
}

async function tekIzleme(iz, simdi, yenilenenSay) {
  if (self.__MINI && iz.okuyucu === 'eklenti') return yenilenenSay; // read by the extension in Chrome; its state arrives through uzakDurum
  if (!iz.aktif) {
    if (iz.sekmeId != null) {
      try { await krom(chrome.tabs.remove(iz.sekmeId)); } catch (e) { /* already closed */ }
      await izDegistir(iz.id, (x) => { x.sekmeId = null; });
    }
    return yenilenenSay;
  }
  // kaliciSekme (per watch): the tab stays open even in light mode (on some sites a ticket table in a new tab
  // doesn't fill until read time and only the title is read; a permanent tab reads it fully).
  const hafif = tur.hafif && !iz.kaliciSekme;
  // 1) is there a tab?
  let t = null;
  if (iz.sekmeId != null) { try { t = await krom(chrome.tabs.get(iz.sekmeId)); } catch (e) { t = null; } }
  if (!t && iz.sekmeId != null) { // dead tab record (Chrome restarted / tab closed from outside): clean up right away
    olay(iz.id, 'dead tab record cleared #' + iz.sekmeId);
    await izDegistir(iz.id, (x) => { if (x.sekmeId === iz.sekmeId) x.sekmeId = null; });
  }
  if (!t) {
    if (hafif) {
      // LIGHT MODE: no tab is normal; a tab opens only when it's time to read.
      // A watch that hasn't been read for long (computer was off / waiting in line) still doesn't look GREEN.
      if (iz.sonKontrol && simdi - iz.sonKontrol > okumaPayiMs(iz.aralikSn) && iz.durum === 'izleniyor') {
        await izDegistir(iz.id, (x) => { if (x.durum === 'izleniyor') { x.durum = 'hazirlaniyor'; x.ozet = T('reading again…'); } });
      }
      if ((iz.satinAlmaBekle || 0) > simdi) return yenilenenSay;
      // on a bot wall at most once per 15 min (trying every 5 min pushed Queue-it to its /error page). Verification is NEVER solved.
      const enAzSn = iz.botDuvari ? Math.max(iz.aralikSn, 900) : iz.aralikSn;
      if (simdi - (iz.sonYenileme || 0) < enAzSn * 1000 - 2000) return yenilenenSay;
      if (!tarayicisiz(iz)) {
        if (tur.acik >= ESZAMANLI_SEKME || acmaZamanlari.length >= HAFIF_ACMA_SINIRI) { olay(iz.id, 'in line (open ' + tur.acik + ', last 25 s ' + acmaZamanlari.length + ')'); return yenilenenSay; }
        tur.acik++;
      }
    } else if (acmaZamanlari.length >= 2) return yenilenenSay;
    if (!tarayicisiz(iz)) acmaZamanlari.push(simdi);
    const sid = await sekmeAc(iz, hafif);
    olay(iz.id, 'opened #' + sid);
    // A watch with no tab that hasn't been read for long must not look GREEN (computer off overnight: in the
    // morning everything would still say "watching"). It shows "getting ready" (gray) until read again.
    await izDegistir(iz.id, (x) => {
      x.sekmeId = sid; x.sonYenileme = simdi; x.sekmeAcilis = simdi;
      const bayat = !x.sonKontrol || simdi - x.sonKontrol > okumaPayiMs(x.aralikSn);
      if (bayat && x.durum !== 'degisti') { x.durum = 'hazirlaniyor'; x.sorun = ''; x.ozet = x.sonKontrol ? T('reading again…') : ''; }
    });
    // light mode: image/video blocking must be set before the page loads, then go to the real address
    if (hafif && sid != null) { await hafiflet(); try { await krom(chrome.tabs.update(sid, { url: iz.url })); } catch (e) { /* harmless */ } }
    return yenilenenSay;
  }
  // 1b) light mode: a tab that was read and isn't waiting for a reload is closed at once (when switching to light mode, old permanent
  // tabs with 10/30 min intervals would stay open until their next read and fill the esZamanli limit).
  if (hafif && !iz.kuyrukBasi && iz.sonKontrol && iz.sonKontrol >= (iz.sekmeAcilis || 0) && iz.sonKontrol >= (iz.sonYenileme || 0)) {
    await izDegistir(iz.id, (x) => { if (x.sekmeId === t.id) x.sekmeId = null; });
    try { await krom(chrome.tabs.remove(t.id)); } catch (e) { /* already closed */ }
    if (tur.acik > 0 && !tarayicisiz(iz)) tur.acik--;
    olay(iz.id, 'idle, closed #' + t.id);
    return yenilenenSay;
  }
  // 2) after an alarm: don't touch it until the user looks (at most 30 min)
  if ((iz.satinAlmaBekle || 0) > simdi) return yenilenenSay;
  // 3) did the tab leave the watched page? (no check before the first read: if the site redirects, the first read address becomes the "real address")
  const url = t.pendingUrl || t.url || '';
  if (iz.gercekUrl && url && !/^chrome-error:|^about:blank/.test(url) && !ayniSayfa(url, iz)) {
    await gittiIsle(iz, t, url, simdi);
    return yenilenenSay;
  }
  // 4) reload when due — instead of "Reload", we go to the watch address EVERY TIME (sites that redirect).
  if (simdi - (iz.sonYenileme || 0) >= iz.aralikSn * 1000 - 2000 && yenilenenSay < 6) {
    yenilenenSay++;
    await izDegistir(iz.id, (x) => { x.sonYenileme = simdi; });
    const sid = t.id;
    const yayma = Math.min(YAYMA_MS, iz.aralikSn * 500); // spread the load across the round (not all reloading at once)
    bekle(Math.random() * yayma).then(() => chrome.tabs.update(sid, { url: iz.url })).catch(() => {});
  }
  // 4b) SAFETY NET: reads normally happen on the "page loaded" event, but that event can be missed (while the service worker
  // sleeps) or never come. If a tab hasn't been read for a while we trigger the read ourselves.
  // It's read even if the tab looks "loading". No extra read EVERY round: if the same DOM were read twice,
  // something coming and going could count as "confirmed in two reads" and raise a false alarm.
  // Short wait if the tab hasn't been read since it opened (always the case in light mode); longer if it has.
  const okunmadi = !iz.sonKontrol || (iz.sekmeAcilis || 0) > iz.sonKontrol;
  const beklemeMs = okunmadi ? Math.min(iz.aralikSn, 60) * 1000 + OKUMA_BEKLE_MS : iz.aralikSn * 1000 + 45000;
  if (simdi - Math.max(iz.sonKontrol || 0, iz.sekmeAcilis || 0) > beklemeMs) okumaPlanla(iz.id, t.id);
  // 5) no read for a long time: problem + reopen the tab
  const sonOkuma = Math.max(iz.sonKontrol || 0, iz.sekmeAcilis || 0) || iz.olusturma || simdi;
  const pay = okumaPayiMs(iz.aralikSn);
  if (simdi - sonOkuma > pay) {
    await izDegistir(iz.id, (x) => { x.durum = 'sorun'; x.sorun = T('page could not be read for {n} minutes', { n: Math.round((simdi - sonOkuma) / 60000) }); });
    if (simdi - sonOkuma > 2 * pay) {
      try { await krom(chrome.tabs.remove(t.id)); } catch (e) { /* harmless */ }
      await izDegistir(iz.id, (x) => { x.sekmeId = null; x.sekmeAcilis = simdi; });
      olay(iz.id, 'unread for long, closed #' + t.id);
    }
  }
  return yenilenenSay;
}

// The tab went to another page: ALARM if it's a waiting room, otherwise a quiet "problem" + go back.
async function gittiIsle(iz, t, url, simdi) {
  let host = '';
  let yol = '';
  try { const x = new URL(url); host = x.host; yol = x.pathname; } catch (e) { /* harmless */ }
  // In light mode the tab closes and reopens when the watch is due; in permanent mode the tab is sent back to the watch address
  const geriDon = async (enAzSn) => {
    if (tur.hafif && !iz.kaliciSekme) {
      olay(iz.id, 'stayed on another page, closed (' + kisaAdres(url).slice(0, 50) + ')');
      await izDegistir(iz.id, (x) => { if (x.sekmeId === t.id) x.sekmeId = null; });
      try { await krom(chrome.tabs.remove(t.id)); } catch (e) { /* already closed */ }
      return;
    }
    if (simdi - (iz.geriDonus || 0) >= enAzSn * 1000) {
      await izDegistir(iz.id, (x) => { x.geriDonus = simdi; x.sonYenileme = simdi; });
      try { await krom(chrome.tabs.update(t.id, { url: iz.url })); } catch (e) { /* harmless */ }
    }
  };
  // A bot block page (e.g. hd-queue.../softblock/) is NOT a sale queue: no siren, orange warning.
  if (BOT_YOLU.test(yol)) {
    await izDegistir(iz.id, (x) => { x.durum = 'sorun'; x.sorun = T('the site put the page behind a bot check ({adres}) — {ipucu}', { adres: kisaAdres(url), ipucu: BOT_UYARI() }); x.ozet = T('bot check'); x.botDuvari = true; x.kuyrukBasi = 0; });
    // The wall may be temporary: go back to the watch address at most once per 15 minutes (trying every 5 min pushed Queue-it
    // to its /error page). Verification is NEVER solved.
    await geriDon(Math.max(iz.aralikSn, 900));
    return;
  }
  const kuyruk = /queue|kuyruk|waiting|bekleme|virtual-?room|waitingroom/i.test(host + yol);
  if (kuyruk) {
    // A queue tab stays open (to keep its place), but not forever: a tab can get stuck on a Queue-it "afterevent"
    // page and the watch would never be read again. It retries the watch address every KUYRUK_YENILE_MS.
    if (!iz.kuyrukBasi) await izDegistir(iz.id, (x) => { x.kuyrukBasi = simdi; });
    else if (simdi - iz.kuyrukBasi >= KUYRUK_YENILE_MS) {
      await izDegistir(iz.id, (x) => { x.kuyrukBasi = simdi; x.sonYenileme = simdi; });
      try { await krom(chrome.tabs.update(t.id, { url: iz.url })); } catch (e) { /* harmless */ }
    }
    if (iz.kuyrukSessiz) {
      await izDegistir(iz.id, (x) => { x.durum = 'sorun'; x.sorun = T('in a waiting room (queue) — watching continues by itself when your turn comes'); });
      return;
    }
    if (!iz.kuyrukAlarmi) {
      // Some sites send visitors through a waiting room on and off all day. The first ring says it; more rings within hours say nothing new.
      // The page is compared again as soon as it can be read, so a real opening behind the queue still rings.
      const tekrar = !!iz.kuyrukSonAlarm && simdi - iz.kuyrukSonAlarm < KUYRUK_ALARM_ARA_MS;
      await izDegistir(iz.id, (x) => {
        x.kuyrukAlarmi = true;
        if (tekrar) { x.durum = 'sorun'; x.sorun = T('in a waiting room (queue) — watching continues by itself when your turn comes'); } else x.kuyrukSonAlarm = simdi;
      });
      if (tekrar) olay(iz.id, 'waiting room again: no new alarm yet');
      else await alarmVer(iz, [T('A waiting room (queue) page opened — something may be starting!'), T('Tab: {adres}', { adres: kisaAdres(url) })], ['kuyruk:' + host]);
    }
    return;
  }
  // Login page: oku() also treats it as a lost session (one alarm after two reads); keep the warning text the same
  const giris = GIRIS_YOLU.test(yol);
  await izDegistir(iz.id, (x) => {
    x.durum = 'sorun';
    if (giris) { x.sorun = OTURUM_UYARI(); x.ozet = T('login required'); } else x.sorun = T('the tab went to another page ({adres}) — may be a login / error page', { adres: kisaAdres(url) });
    x.kuyrukBasi = 0;
  });
  await geriDon(iz.aralikSn);
}

// ------------------------------------------------------------------ reading
const okumaZamanlayici = new Map(); // tab id -> timeout
function okumaPlanla(izId, sekmeId) {
  clearTimeout(okumaZamanlayici.get(sekmeId));
  okumaZamanlayici.set(sekmeId, setTimeout(() => { okumaZamanlayici.delete(sekmeId); oku(izId, sekmeId, 0).catch((e) => console.error('oku', e)); }, OKUMA_BEKLE_MS));
}

function sayfaOku() { // runs inside the tab
  return { html: document.documentElement ? document.documentElement.outerHTML : '', url: location.href, baslik: document.title || '' };
}

async function oku(izId, sekmeId, deneme, ilkSayi) {
  let r;
  try {
    const sonuc = await krom(chrome.scripting.executeScript({ target: { tabId: sekmeId }, func: sayfaOku }), 30000);
    r = sonuc && sonuc[0] && sonuc[0].result;
  } catch (e) {
    const msg = String(e.message || e);
    if (/No tab with id/i.test(msg)) { await izDegistir(izId, (x) => { if (x.sekmeId === sekmeId) x.sekmeId = null; }); return; }
    const izh = await izDegistir(izId, (x) => { x.durum = 'sorun'; x.sorun = T('page could not be read ({neden})', { neden: msg.slice(0, 80) }); x.sonKontrol = Date.now(); });
    await okununcaKapat(izh, sekmeId);
    return;
  }
  if (!r) return;
  const iz0 = (await izlemeler()).find((x) => x.id === izId);
  if (!iz0 || !iz0.aktif || iz0.sekmeId !== sekmeId) { olay(izId, 'read skipped (tab changed #' + sekmeId + ')'); return; }
  let okunanYol = '';
  let izlenenYol = '';
  try { okunanYol = new URL(r.url).pathname; izlenenYol = new URL(iz0.url).pathname; } catch (e) { /* harmless */ }
  // Redirected to a login page? (handled below the same way as girisYazisi; also read for a watch with a baseline so that
  // it counts as a lost session and alarms once)
  const giriseYonlendi = GIRIS_YOLU.test(okunanYol) && !GIRIS_YOLU.test(izlenenYol);
  if (!ayniSayfa(r.url, iz0) && iz0.gercekUrl && !giriseYonlendi) { olay(izId, 'read skipped (other address: ' + kisaAdres(r.url).slice(0, 60) + ')'); return; } // another page: the clock (tik) handles it
  // If the address PATH is a bot wall (e.g. hd-queue.../softblock/, in a language the BOT_SAYFASI
  // texts don't catch): a baseline is NEVER taken; a language-independent general rule.
  if (BOT_YOLU.test(okunanYol)) {
    const izb = await izDegistir(izId, (x) => { x.durum = 'sorun'; x.sorun = T('the site put the page behind a bot check ({adres}) — {ipucu}', { adres: kisaAdres(r.url), ipucu: BOT_UYARI() }); x.sonKontrol = Date.now(); x.ozet = T('bot check'); x.botDuvari = true; });
    await okununcaKapat(izb, sekmeId);
    return;
  }
  // Bot verification / block page (e.g. "Ensuring a fair fan experience"): a baseline is NEVER taken
  if (BOT_SAYFASI.test(r.html.slice(0, 200000))) {
    const izb = await izDegistir(izId, (x) => { x.durum = 'sorun'; x.sorun = T('the site is showing a bot check — {ipucu}', { ipucu: BOT_UYARI() }); x.sonKontrol = Date.now(); x.ozet = T('bot check'); x.botDuvari = true; });
    await okununcaKapat(izb, sekmeId);
    return;
  }
  const rep = M.represent(r.html);
  let saglik = M.healthCheck(r.html, rep);
  const sayi = M.itemCount(rep);
  // Pages that fill late through JS: always look once more; if the item count is still changing (a seat map and cookie
  // window arriving seconds later could produce a baseline from half a page and a false alarm)
  // look once more. Within a page load ONLY the last read is processed: the two-reads rule stays intact.
  const degisiyor = ilkSayi != null && sayi !== ilkSayi;
  if (deneme === 0 || (deneme === 1 && degisiyor)) {
    await bekle(TEKRAR_OKU_MS);
    return oku(izId, sekmeId, deneme + 1, sayi);
  }
  // A small page (>= 5 items) that stays the same across two reads really is small, not half loaded: accept it
  if (deneme >= 1 && sayi >= 5 && sayi === ilkSayi) saglik = null;
  // PAGES THAT NEED LOGIN (per-watch girisYazisi): if the text visible only when logged in is missing in the LAST read too, the session
  // is gone. A logged-out page can say "sale not open" even when the sale is open (members-only events)
  // -> the baseline is NOT taken / updated; if missing in two consecutive loads, ONE alarm (the page isn't put on hold).
  // Even without girisYazisi: same thing if the site REDIRECTED to a login page (GIRIS_YOLU). Otherwise the login form becomes the "real
  // address" and the baseline, and the content never appears while the watch stays green.
  const normal = (s) => String(s || '').replace(/\s+/g, ' ');
  if (giriseYonlendi || (iz0.girisYazisi && !normal(r.html).includes(normal(iz0.girisYazisi).trim()))) {
    let oturumAlarmi = false;
    const izo = await izDegistir(izId, (x) => {
      x.sonKontrol = Date.now();
      x.oturumSay = (x.oturumSay || 0) + 1;
      x.durum = 'sorun'; x.ozet = T('login required'); x.sorun = OTURUM_UYARI();
      x.girisliydi = false; x.cikisYok = 0; // this branch tells the user: the logout-link check below must not say it again
      if (x.oturumSay >= 2 && !x.oturumAlarmi) { x.oturumAlarmi = true; oturumAlarmi = true; }
    });
    olay(izId, giriseYonlendi ? 'redirected to a login page (' + kisaAdres(r.url).slice(0, 60) + ')' : 'login text missing (session?)');
    if (izo && oturumAlarmi) await alarmVer(izo, OTURUM_ALARMI(), ['oturum']);
    await okununcaKapat(izo, sekmeId);
    return;
  }
  let alarm = null;
  let oturumBitti = false;
  const iz = await izDegistir(izId, async (x) => {
    const anahtar = 'motor_' + x.id;
    const s = M.turIsle((await al(anahtar)) || null, rep, saglik, x.hizli ? { ...ISINMA_SINYAL, hizli: true } : ISINMA_SINYAL);
    if (s.durum) await koy(anahtar, s.durum);
    x.sonKontrol = Date.now();
    x.ozet = s.ozet;
    x.hata = '';
    if (s.ilk) x.gercekUrl = normUrl(r.url);
    if (s.uyari) { x.durum = 'sorun'; x.sorun = s.uyari; } else if (x.durum !== 'degisti') { x.durum = 'izleniyor'; x.sorun = ''; }
    x.kuyrukAlarmi = false; x.kuyrukBasi = 0; x.botDuvari = false;
    if (x.girisYazisi || x.oturumSay) { x.oturumSay = 0; x.oturumAlarmi = false; } // login text seen / redirect ended: session is in place
    // WITHOUT girisYazisi: a logout link means this page was read logged in. If it stays gone for two page loads the site logged us out.
    // Account links aren't compared, so nothing else would say so. One alarm, and watching goes on: the public part can still change.
    if (rep.cikisVar) { x.girisliydi = true; x.cikisYok = 0; }
    else if (x.girisliydi && !x.girisYazisi && !saglik && !s.uyari) {
      x.cikisYok = (x.cikisYok || 0) + 1;
      if (x.cikisYok >= 2) { x.girisliydi = false; x.cikisYok = 0; oturumBitti = true; }
    }
    if (s.alarm) alarm = alarmSuz(x, s, (s.durum && s.durum.etiket) || {});
    if (alarm) x.sonAlarmKalkan = alarm.kalkan.slice(0, 200);
  });
  if (!iz) return;
  if (oturumBitti) await alarmVer(iz, OTURUM_ALARMI(), ['oturum']);
  if (alarm) await alarmVer(iz, alarm.satirlar, alarm.anahtarlar);
  await okununcaKapat(iz, sekmeId);
}

const BOT_SAYFASI = /Ensuring a fair fan experience|prevent automated bots|Checking your browser before accessing|<title>\s*Just a moment\.\.\.\s*<\/title>|<title>\s*Attention Required|Request unsuccessful\. Incapsula|Pardon Our Interruption|verify you are (a )?human|are you a robot\?|<title>\s*Access Denied\s*<\/title>|<title>\s*Queue-?it\s*<\/title>|i['’]?m not a robot|i am not a robot|δεν ε[ιί]μαι ρομπ|ε[ιί]στε πραγματικ[οό]ς χρ[ηή]στης|<abuse-component\b|__EPS_BLOCK_TEMPLATE|Let['’]s Get Your Identity Verified|Your Browsing Activity Has Been Paused|captcha-delivery\.com|Unable to verify/i;
// Bot walls recognized from the address PATH (whatever the page language): no baseline, no alarm.
const BOT_YOLU = /softblock|captcha|challenge|blocked|access-denied|cdn-cgi|\/error/i;
// Login pages recognized from the address PATH (e.g. sites that redirect to /account/login when logged out). If we land here and the
// watched address itself isn't a login page, there is no session -> same path as girisYazisi (no baseline, one alarm after two reads).
const GIRIS_YOLU = /(^|\/)(log-?in|sign-?in|giris|uye-?girisi|anmelden|einloggen|logga-?in|logg-?inn|connexion|customerlogin|accountlogin)(\/|\.|$)/i;
const BOT_UYARI = () => T('use the "Open" button to open the site and pass the check');
const KUYRUK_YENILE_MS = 30 * 60e3;
const KUYRUK_ALARM_ARA_MS = 6 * 3600e3;
const OTURUM_UYARI = () => T('SESSION LOST — this page needs a login; without it, changes will not show. Log in to the site (Open site).');
const OTURUM_ALARMI = () => [T('SESSION LOST — the page looks logged out; changes behind the login will not show.'),
  T('Please log in to the site (Open site). Watching continues by itself after you log in.')];
// "add ticket" / "last tickets": a "+ Add ticket" row must count as a sale signal, or it gets absorbed in warm-up.
const SATIS_SOZ = /sat[ıi]n al|bilet al|buy|acheter|r[ée]serv|kaufen|warenkorb|add to (cart|basket)|add (a )?tickets?|last tickets|get tickets|купить|sotib|kj[øo]p n[åa]|k[öo]p nu|comprar( bilhete)?|αγορ[άα]|לרכישה|הוסף לסל|הוספה לסל|לקופה/i;
const OLUMSUZ = /t[üu]kendi|t[üu]kenmek|uygun bilet|bilet bulunma|sold[\s-]?out|unavailable|not available|coming soon|yak[ıi]nda|complet|[ée]puis[ée]|indisponible|non disponible|bient[ôo]t|ausverkauft|nicht verf[üu]gbar|demn[äa]chst|εξαντλ|μη διαθ[εέ]σιμ|προσεχ[ωώ]ς|δεν υπ[αά]ρχουν διαθ|распродан|разпродад|изчерпан|нет в наличии|sotuvda yo|rasprodat|uskoro|nema ulaznica|esgotad|agotad|esaurit|nu sunt puse [îi]n v[âa]nzare|epuizat|no tickets? (are |is )?(currently )?(available|found|left)|not currently available|no longer available|couldn['’]t find any tickets|\bno results\b|keine tickets|aucun billet|plus de billets|pas de billets disponibles|\b0 (available|tickets?)\b|got tickets to sell|set up a listing|uts[oø]lgt|udsolgt|slutsåld|slutsålt|utsåld|utsålt|ikke tilgjengelig|ikke tilg[æa]ngelig|ikke (lenger|l[æa]ngere) tilg(jengelig|[æa]ngelig)|inte tillg[äa]nglig|inte l[äa]ngre tillg[äa]nglig|feilside|fejlside|felsida|fehlerseite|error page|page d['’]erreur|hata sayfas|ej tillg[äa]nglig|billettsalget (starter|har ikke)|biljetter sl[äa]pps|loppuunmyyty|sem[ _]?disponibilidade|indispon[ií]vel|sem bilhetes|bilhetes esgotados|daha sonra tekrar dene|sat[ıi][şs]a sunulacak|sat[ıi][şs] ba[şs]lamad[ıi]|טרם נפתח|אין מידע עבור האירוע|אזל|לא זמין|אין כרטיסים|המכירה הסתיימה|בקרוב/i;
const satisSinyali = (k) => SATIS_SOZ.test(String(k).slice(2));
// In a warm-up round (first read after the first baseline), which differences count as a sale opening: the engine doesn't absorb these.
const ISINMA_SINYAL = { olumsuz: (k) => String(k).endsWith('|soluk') || OLUMSUZ.test(String(k).slice(2)), satis: satisSinyali };

// From confirmed changes, those the user marked "ignore" and those that don't match the keyword filter are dropped.
function alarmSuz(iz, s, etiket) {
  const yoksay = new Set(iz.yoksay || []);
  const c = { added: s.alarm.confirmed.added.filter((k) => !yoksay.has(k)), removed: s.alarm.confirmed.removed.filter((k) => !yoksay.has(k)) };
  if (!c.added.length && !c.removed.length) return null;
  // An event whose day has come dropping off a list is not news, even on "every change" watches. Its link and heading go with it:
  // a removed item whose text sits inside such a dated text.
  const yazisi = (k) => String((etiket && etiket[k]) || k.slice(2)).replace(/\|soluk$/, '');
  const gecmisler = c.removed.filter((k) => M.gecmisTarihli(yazisi(k)));
  if (gecmisler.length) {
    const metinler = gecmisler.map(yazisi);
    c.removed = c.removed.filter((k) => !gecmisler.includes(k) && !(yazisi(k).length >= 12 && metinler.some((m) => m.includes(yazisi(k)))));
    if (!c.added.length && !c.removed.length) return null;
  }
  // Direction in counted texts: if the same pattern's number dropped to ZERO, like "1 available • 0 sold" -> "0 available • 0 sold",
  // that is a SELL-OUT signal, not an opening (the counter resets when the last listing sells).
  const kalip = (k) => k.replace(/\d+/g, '#');
  const sifirSay = (k) => (k.match(/(?:^|\D)0(?:\D|$)/g) || []).length;
  const kalkanKaliplar = new Map();
  for (const k of c.removed) {
    const m = kalip(k);
    if (!kalkanKaliplar.has(m)) kalkanKaliplar.set(m, []);
    kalkanKaliplar.get(m).push(k);
  }
  const sayiSifirlandi = (k) => { const l = kalkanKaliplar.get(kalip(k)); return !!l && l.some((r) => sifirSay(k) > sifirSay(r)); };
  const olumsuz = (k) => k.endsWith('|soluk') || OLUMSUZ.test(k.slice(2)) || sayiSifirlandi(k);
  // DIRECTION RULE: an OPENING = something NEW arrives on the page, or a "sold out / not on sale" text goes away.
  // Only a sell-out, only a removal or a negative<->negative change -> NO alarm.
  const ekNeg = c.added.filter(olumsuz).length;
  // RETURN: if what went away at the last alarm comes back with a negative text, this is a SELL-OUT, not
  // something new (when a listing sells, "0 No results" returns along with "View other dates", "2 Tickets").
  const sonKalkan = new Set(ekNeg ? iz.sonAlarmKalkan || [] : []);
  const ekDiger = c.added.filter((k) => !olumsuz(k) && !sonKalkan.has(k)).length;
  // For "NAME — STATUS" keys (events in JSON), a negative status going away is an opening only if the SAME name came back with a new
  // status; not if a past event dropped from the list completely (past events stay "SOLD OUT").
  const konu = (k) => { const i = String(k).indexOf(' — '); return i > 2 ? String(k).slice(0, i) : null; };
  const gelenKonu = new Set(c.added.map(konu).filter(Boolean));
  const kalkNeg = c.removed.filter((k) => olumsuz(k) && (konu(k) == null || gelenKonu.has(konu(k)))).length;
  if (!iz.herDegisiklik && !(ekDiger > 0 || (kalkNeg > 0 && ekNeg === 0))) return null;
  const satirlar = M.alarmSatirlari(c, etiket, 6);
  const kelimeler = String(iz.kelimeler || '').split(',').map((k) => k.trim().toLocaleLowerCase('tr')).filter(Boolean);
  // The keyword filter cuts noise from side lists; but a "Sold out" text GOING AWAY is the opening
  // itself: the filter doesn't block it.
  const tukendiKalkti = kalkNeg > 0 && ekNeg === 0;
  if (kelimeler.length && !tukendiKalkti && !satirlar.some((s0) => kelimeler.some((k) => s0.toLocaleLowerCase('tr').includes(k)))) return null;
  return { satirlar, anahtarlar: [...c.added, ...c.removed], kalkan: c.removed };
}

// ------------------------------------------------------------------ alarm
async function alarmVer(iz, satirlar, anahtarlar) {
  const a = { id: yeniId(), izId: iz.id, ad: iz.ad, url: iz.url, zaman: new Date().toISOString(), satirlar, anahtarlar, durum: 'yeni' };
  await sirali(async () => {
    const liste = (await al('alarmlar')) || [];
    liste.unshift(a);
    await koy('alarmlar', liste.slice(0, 200));
  });
  if (iz.id !== 'test') {
    // a session warning doesn't put the page on hold: once the user logs in, watching must continue right away
    const oturumUyarisi = (anahtarlar || []).length === 1 && anahtarlar[0] === 'oturum';
    await izDegistir(iz.id, (x) => {
      x.durum = 'degisti';
      if (!oturumUyarisi) x.satinAlmaBekle = Date.now() + SATIN_ALMA_DK * 60e3;
      x.alarmSay = (x.alarmSay || 0) + 1; // the card shows how many alarms and when the last one came, even after the list has moved on
      x.sonAlarm = a.zaman;
    });
  }
  await rozet();
  try { await trackerAc(false); } catch (e) { /* even if the screen cannot open, the alarm must reach the helper */ } // alarm: no window shuffling
  const ay = await ayarlar();
  if (self.__BILDIRIM) self.__BILDIRIM({ ad: iz.ad, satirlar, url: iz.url, zaman: a.zaman }); // optional phone notifications (app only)
  let yardimciGosterdi = false;
  if (ay.ustte) {
    yardimciGosterdi = await yardimciyaYolla('/alarm', { ad: iz.ad, satirlar, url: iz.url, zaman: a.zaman, ses: ay.ses, sesSn: ay.sesSn, dil: T.dil() });
  }
  if (ay.ses && !yardimciGosterdi) await sesCal(ay.sesSn);
  return a;
}

async function yardimciyaYolla(yol, veri) {
  const ctl = new AbortController();
  const zt = setTimeout(() => ctl.abort(), 1500);
  try {
    const r = await fetch(YARDIMCI + yol, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(veri || {}), signal: ctl.signal });
    return r.ok;
  } catch (e) {
    return false;
  } finally { clearTimeout(zt); }
}

// A watch leaves the list: 'silindi' (Delete) or 'alindi' (Got it). Both can be restored; each kind keeps its own number of entries.
const ARSIV_SINIR = { silindi: 50, alindi: 100 };
const arsivTuru = (x) => (x.neden === 'alindi' ? 'alindi' : 'silindi');
const arsivOzeti = (x) => ({ id: x.id, ad: x.ad, url: x.url, neden: arsivTuru(x), silinme: x.silinme, alinma: x.alinma, olusturma: x.olusturma, aralikSn: x.aralikSn, alarmSay: x.alarmSay || 0, sonAlarm: x.sonAlarm || '' });
async function arsiveTasi(id, neden) {
  let iz = null;
  const simdi = Date.now();
  await sirali(async () => {
    const l = await izlemeler();
    const i = l.findIndex((x) => x.id === id);
    if (i < 0) return;
    iz = l.splice(i, 1)[0];
    await koy('izlemeler', l);
    const arsiv = (await al('arsiv')) || [];
    arsiv.unshift({ ...iz, sekmeId: null, neden, [neden === 'alindi' ? 'alinma' : 'silinme']: simdi });
    const say = { silindi: 0, alindi: 0 };
    await koy('arsiv', arsiv.filter((x) => ++say[arsivTuru(x)] <= ARSIV_SINIR[arsivTuru(x)]));
  });
  if (iz && iz.sekmeId != null) { try { await krom(chrome.tabs.remove(iz.sekmeId)); } catch (e) { /* harmless */ } }
  if (iz) await chrome.storage.local.remove('motor_' + iz.id);
  return iz;
}

async function alarmKapat(alarmId, islemAdi) {
  const izdenAnahtar = new Map(); // watch -> keys of closed alarms ('*' touches several watches)
  let kalan = 0;
  const kuyrukIzleri = [];
  await sirali(async () => {
    const liste = (await al('alarmlar')) || [];
    for (const a of liste) {
      if (alarmId === '*' ? a.durum === 'yeni' : a.id === alarmId) {
        a.durum = islemAdi; izdenAnahtar.set(a.izId, (izdenAnahtar.get(a.izId) || []).concat(a.anahtarlar || []));
        if ((islemAdi === 'yanlis' || islemAdi === 'yoksay') && (a.anahtarlar || []).some((k) => String(k).startsWith('kuyruk:'))) kuyrukIzleri.push(a.izId);
      }
    }
    kalan = liste.filter((a) => a.durum === 'yeni').length;
    // a closed alarm keeps only a few of its keys: the history shows its lines, and the list stays small
    for (const a of liste) if (a.durum !== 'yeni' && (a.anahtarlar || []).length > 40) a.anahtarlar = a.anahtarlar.slice(0, 40);
    await koy('alarmlar', liste);
  });
  for (const id of new Set(kuyrukIzleri)) await izDegistir(id, (x) => { x.kuyrukSessiz = true; });
  for (const [izId, anahtarlar] of izdenAnahtar) {
    await izDegistir(izId, (x) => {
      x.satinAlmaBekle = 0;
      if (x.durum === 'degisti') { x.durum = x.aktif ? 'izleniyor' : 'duraklatildi'; x.sorun = ''; }
      // "false alarm"/"ignore": this change won't be asked again. EXCEPT BUY signals and session/queue keys.
      const yoksayilacak = anahtarlar.filter((k) => !String(k).startsWith('kuyruk:') && k !== 'oturum' && (islemAdi === 'yoksay' || !satisSinyali(k)));
      if (islemAdi === 'yanlis' || islemAdi === 'yoksay') x.yoksay = [...new Set((x.yoksay || []).concat(yoksayilacak))].slice(0, 500);
      if ((islemAdi === 'yoksay' || islemAdi === 'yanlis') && anahtarlar.some((k) => String(k).startsWith('kuyruk:'))) x.kuyrukSessiz = true;
    });
  }
  if (islemAdi === 'aldim') for (const izId of izdenAnahtar.keys()) await arsiveTasi(izId, 'alindi'); // "Got it": into the Got it history
  if (!kalan) await yardimciyaYolla('/kapat', {});
  await sesDurdur();
  await rozet();
  return { ok: true, kalan };
}

// ------------------------------------------------------------------ sound (Chrome plays it if there's no helper)
async function sesCal(sn) {
  try {
    const varMi = await chrome.offscreen.hasDocument();
    if (!varMi) await chrome.offscreen.createDocument({ url: 'sound.html', reasons: ['AUDIO_PLAYBACK'], justification: 'alarm sound' });
    chrome.runtime.sendMessage({ tip: 'ses', sn: sn || 60 }).catch(() => {});
  } catch (e) { /* harmless */ }
}
async function sesDurdur() {
  try { chrome.runtime.sendMessage({ tip: 'sesDur' }).catch(() => {}); } catch (e) { /* harmless */ }
}

// ------------------------------------------------------------------ dashboard + badge
// kullaniciIstedi=true ONLY when the extension icon is clicked. During an alarm the user's windows
// are NOT TOUCHED (nobody wants an alarm to minimize their browsers): no window is brought to front,
// a minimized watch window isn't made "normal", the open tab isn't changed.
// The alarm already comes as a red window on top of everything + sound; the dashboard opens quietly in the background.
async function trackerAc(kullaniciIstedi) {
  const url = chrome.runtime.getURL('dashboard.html');
  const sekmeler = await krom(chrome.tabs.query({}));
  const v = sekmeler.find((t) => (t.url || '').startsWith(url));
  if (v) {
    if (kullaniciIstedi) {
      try { await krom(chrome.tabs.update(v.id, { active: true })); await krom(chrome.windows.update(v.windowId, { focused: true, state: 'normal' })); } catch (e) { /* harmless */ }
    }
    return v.id;
  }
  const t = await krom(chrome.tabs.create({ url, active: !!kullaniciIstedi }));
  return t.id;
}

async function rozet() {
  const alarmlar = (await al('alarmlar')) || [];
  const yeni = alarmlar.filter((a) => a.durum === 'yeni').length;
  const liste = await izlemeler();
  const sorunlu = liste.filter((x) => x.aktif && x.durum === 'sorun').length;
  try {
    if (yeni) { await krom(chrome.action.setBadgeText({ text: String(yeni) })); await krom(chrome.action.setBadgeBackgroundColor({ color: '#d32f2f' })); }
    else if (sorunlu) { await krom(chrome.action.setBadgeText({ text: String(sorunlu) })); await krom(chrome.action.setBadgeBackgroundColor({ color: '#ef6c00' })); }
    else await krom(chrome.action.setBadgeText({ text: '' }));
  } catch (e) { /* harmless */ }
}

// ------------------------------------------------------------------ requests from the dashboard / helper
// Who reads a watch in the app: '' = separate browser, 'http' = no browser (the info is in the raw HTML), 'eklenti' = the extension in the user's Chrome
const OKUYUCULAR = ['http', 'eklenti'];
async function islem(m) {
  const simdi = Date.now();
  switch (m && m.tip) {
    case 'LISTE': {
      const alarmlar = (await al('alarmlar')) || [];
      const arsiv = (await al('arsiv')) || [];
      return {
        izlemeler: await izlemeler(),
        // hafif: what the dashboard needs every few seconds. Only open alarms (a watch's history comes with ALARM_GECMISI when its card
        // opens) and the archive without baselines and ignore lists.
        alarmlar: m.hafif ? alarmlar.filter((a) => a.durum === 'yeni') : alarmlar,
        arsiv: m.hafif ? arsiv.map(arsivOzeti) : arsiv,
        ayarlar: await ayarlar(),
        yardimci: await yardimciVarMi(),
        dil: T.dil(),
        surum: chrome.runtime.getManifest().version,
      };
    }
    case 'EKLE': {
      let u;
      try { u = new URL(String(m.url || '').trim()); } catch (e) { return { hata: T('Invalid address. Paste the full address starting with https://.') }; }
      if (!/^https?:$/.test(u.protocol)) return { hata: T('The address must start with http:// or https://.') };
      const iz = {
        id: yeniId(), ad: String(m.ad || '').trim() || u.host, url: u.href,
        aralikSn: gecerliAralik(m.aralikSn) ? Number(m.aralikSn) : 60,
        kelimeler: String(m.kelimeler || '').trim(), aktif: true, durum: 'hazirlaniyor', sorun: '', ozet: '',
        olusturma: simdi, sonYenileme: 0, sonKontrol: 0, sekmeId: null, yoksay: [], herDegisiklik: !!m.herDegisiklik, hizli: !!m.hizli,
        girisYazisi: String(m.girisYazisi || '').trim(), okuyucu: OKUYUCULAR.includes(m.okuyucu) ? m.okuyucu : '', kaliciSekme: !!m.kaliciSekme,
      };
      await sirali(async () => { const l = await izlemeler(); l.push(iz); await koy('izlemeler', l); });
      tik();
      return { ok: true, id: iz.id };
    }
    case 'GUNCELLE': {
      const iz = await izDegistir(m.id, (x) => {
        if (m.ad != null) x.ad = String(m.ad).trim() || x.ad;
        if (m.aralikSn != null && gecerliAralik(m.aralikSn)) x.aralikSn = Number(m.aralikSn);
        if (m.kelimeler != null) x.kelimeler = String(m.kelimeler).trim();
        if (m.herDegisiklik != null) x.herDegisiklik = !!m.herDegisiklik;
        if (m.hizli != null) x.hizli = !!m.hizli;
        if (m.detay != null) x.detay = !!m.detay;
        if (m.kaliciSekme != null) x.kaliciSekme = !!m.kaliciSekme;
        if (m.okuyucu != null) x.okuyucu = OKUYUCULAR.includes(m.okuyucu) ? m.okuyucu : ''; // app only: see OKUYUCULAR
        if (m.girisYazisi != null) { x.girisYazisi = String(m.girisYazisi).trim(); x.oturumSay = 0; x.oturumAlarmi = false; }
        if (m.url != null) { try { x.url = new URL(String(m.url).trim()).href; x.gercekUrl = ''; } catch (e) { /* invalid address: leave it */ } }
      });
      return iz ? { ok: true } : { hata: T('Watch not found.') };
    }
    case 'SIL': return { ok: !!(await arsiveTasi(m.id, 'silindi')) };
    // "Got it": the ticket is bought, the slot booked. The watch goes to the Got it history; its open alarms close the same way.
    case 'ALDIM': {
      const acik = ((await al('alarmlar')) || []).filter((a) => a.izId === m.id && a.durum === 'yeni');
      for (const a of acik) await alarmKapat(a.id, 'aldim');
      if (acik.length) return { ok: true };
      return { ok: !!(await arsiveTasi(m.id, 'alindi')) };
    }
    // Gone for good, with its alarms: only from the archive.
    case 'KALICI_SIL': {
      let bulundu = false;
      await sirali(async () => {
        const arsiv = (await al('arsiv')) || [];
        const kalan = arsiv.filter((x) => x.id !== m.id);
        bulundu = kalan.length !== arsiv.length;
        if (!bulundu) return;
        await koy('arsiv', kalan);
        await koy('alarmlar', ((await al('alarmlar')) || []).filter((a) => a.izId !== m.id));
      });
      return { ok: bulundu };
    }
    case 'ALARM_GECMISI': {
      const alarmlar = (await al('alarmlar')) || [];
      return { alarmlar: alarmlar.filter((a) => a.izId === m.id).map(({ anahtarlar, ...a }) => a) };
    }
    case 'GERIAL': {
      let iz = null;
      await sirali(async () => {
        const arsiv = (await al('arsiv')) || [];
        const i = arsiv.findIndex((x) => x.id === m.id);
        if (i < 0) return;
        iz = arsiv.splice(i, 1)[0];
        await koy('arsiv', arsiv);
        const l = await izlemeler();
        const { neden, silinme, alinma, ...geri } = iz;
        l.push({ ...geri, aktif: true, not: '', sekmeId: null, durum: 'hazirlaniyor', sorun: '', ozet: '', sonKontrol: 0, sonYenileme: 0 });
        await koy('izlemeler', l);
      });
      tik();
      return { ok: !!iz };
    }
    case 'DURAKLAT': return (await izDegistir(m.id, (x) => { x.aktif = false; x.durum = 'duraklatildi'; })) ? { ok: true } : { hata: 'not found' };
    case 'BASLAT': {
      await izDegistir(m.id, (x) => { x.aktif = true; x.durum = 'hazirlaniyor'; x.sorun = ''; x.not = ''; x.sonKontrol = 0; x.sekmeAcilis = simdi; x.botDuvari = false; x.kuyrukBasi = 0; });
      tik();
      return { ok: true };
    }
    case 'NOBET': return nobet(m.id);
    case 'NOBET_HEPSI': {
      for (const x of await izlemeler()) await nobet(x.id);
      return { ok: true };
    }
    case 'ALARM_KAPAT': return alarmKapat(m.alarmId, m.islem || 'tamam');
    case 'AYAR': {
      const ay = Object.assign(await ayarlar(), m.ayarlar || {});
      await koy('ayarlar', ay);
      T.dil(ay.dil);
      return { ok: true, ayarlar: ay };
    }
    case 'DISA_AKTAR': disaAktarIstendi = true; return { ok: true };
    case 'TEST_ALARM': {
      await alarmVer({ id: 'test', ad: T('TEST ALARM'), url: 'https://example.com' }, [T('This is a test alarm.'), T('If the sound and window work, everything is fine.')], ['test']);
      return { ok: true };
    }
    case 'SITE_AC': {
      const iz = (await izlemeler()).find((x) => x.id === m.id);
      if (!iz) return { hata: 'not found' };
      await krom(chrome.tabs.create({ url: iz.url, active: true }));
      // The user may be passing verification: the 15 min wait is lifted, retry in 2 min
      if (iz.botDuvari) await izDegistir(iz.id, (x) => { x.botDuvari = false; x.sonYenileme = simdi + 120000 - x.aralikSn * 1000; });
      return { ok: true };
    }
    default: return { hata: 'unknown request' };
  }
}

async function yardimciVarMi() {
  const ctl = new AbortController();
  const zt = setTimeout(() => ctl.abort(), 1200);
  try { const r = await fetch(YARDIMCI + '/durum', { signal: ctl.signal }); return r.ok; } catch (e) { return false; } finally { clearTimeout(zt); }
}

// Re-arm: the page's current state becomes "normal" (baseline reset).
async function nobet(id) {
  await chrome.storage.local.remove('motor_' + id);
  const iz = await izDegistir(id, (x) => {
    // if there's no tab (light mode) sonYenileme is reset so it opens right away
    x.durum = x.aktif ? 'hazirlaniyor' : 'duraklatildi'; x.sorun = ''; x.satinAlmaBekle = 0; x.sonYenileme = x.sekmeId != null ? Date.now() : 0;
    x.sonKontrol = 0; x.sekmeAcilis = Date.now(); x.ozet = ''; x.gercekUrl = ''; x.kuyrukAlarmi = false;
    x.oturumSay = 0; x.oturumAlarmi = false; x.botDuvari = false; x.kuyrukBasi = 0;
  });
  if (iz && iz.sekmeId != null) { try { await krom(chrome.tabs.update(iz.sekmeId, { url: iz.url })); } catch (e) { /* harmless */ } }
  return { ok: !!iz };
}

// ------------------------------------------------------------------ clock setup and events
function saatiKur() {
  chrome.alarms.get('tik').then((a) => { if (!a) chrome.alarms.create('tik', { periodInMinutes: 0.5 }); }).catch(() => {});
}

chrome.runtime.onMessage.addListener((m, g, cevapla) => {
  if (m && m.tip === 'ses') return; // message for the offscreen document
  islem(m).then(cevapla, (e) => cevapla({ hata: String(e && e.message || e) }));
  return true;
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete') return;
  if (tab && /^about:blank/.test(tab.url || '')) return; // in light mode the tab opens blank first
  let iz = (await izlemeler()).find((x) => x.sekmeId === tabId && x.aktif);
  if (!iz) { // a newly opened tab may have loaded before its id was saved
    await bekle(1500);
    iz = (await izlemeler()).find((x) => x.sekmeId === tabId && x.aktif);
  }
  if (iz) { olay(iz.id, 'loaded #' + tabId); okumaPlanla(iz.id, tabId); }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const iz = (await izlemeler()).find((x) => x.sekmeId === tabId);
  if (iz) { olay(iz.id, 'tab closed from outside #' + tabId); await izDegistir(iz.id, (x) => { x.sekmeId = null; }); }
});

chrome.action.onClicked.addListener(() => { trackerAc(true); });

chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'tik') tik(); });

chrome.runtime.onStartup.addListener(async () => { saatiKur(); tik(); });
chrome.runtime.onInstalled.addListener(async () => { saatiKur(); trackerAc(false); tik(); });

// When the version changes, the page representation may have changed too (cookie box cutting, account link filter -> items are REMOVED).
// Each watch's baseline gets one 'surum' WARM-UP: on the next healthy read only non-negative REMOVED items
// are absorbed silently; new items and removed "sold out" texts raise alarms the normal way.
// (If new items were absorbed too, a real change on a page could be misdiagnosed.)
async function surumIsinmasi() {
  const surum = chrome.runtime.getManifest().version;
  if ((await al('motorSurum')) === surum) return;
  await sirali(async () => {
    for (const x of await izlemeler()) {
      const m = await al('motor_' + x.id);
      if (m && m.taban && !m.isinma) { m.isinma = 'surum'; await koy('motor_' + x.id, m); }
    }
    await koy('motorSurum', surum);
  });
}

saatiKur();
surumIsinmasi().then(() => { if (!self.__TEST) tik(); });

self.__PAGESIREN = { uzakDurum, islem, oku, tik, alarmKapat, nobet, alarmSuz, surumIsinmasi, BOT_SAYFASI, BOT_YOLU, GIRIS_YOLU, OLUMSUZ, SATIS_SOZ };

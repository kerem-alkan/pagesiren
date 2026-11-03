// PageSirenAlarm.exe tests: the real exe in --test mode (no window, no tray icon), a small fake program instead of pagesiren.js.
// Requests go only to 127.0.0.1. Run:  node test/helper.test.js [exe path]   (default: built from source)
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { yardimciHazirla } = require('../app/helper');

const EXE = path.resolve(process.argv[2] || '');
const PORT = 47398;
const UI = 47397;
let gecti = 0;
let kaldi = 0;
function ok(ad, kosul, ek) {
  if (kosul) { gecti++; console.log('  OK  ' + ad); }
  else { kaldi++; console.log('  HATA ' + ad + (ek != null ? '  -> ' + ek : '')); }
}
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
async function bekleKadar(kosul, ms) {
  const son = Date.now() + ms;
  while (Date.now() < son) { const v = await kosul(); if (v) return v; await bekle(100); }
  return await kosul();
}
const al = (y) => fetch('http://127.0.0.1:' + PORT + y).then((r) => r.text()).catch(() => null);
const alJson = async (y) => { const t = await al(y); try { return JSON.parse(t); } catch (e) { return null; } };
const yolla = (y, o, bas) => fetch('http://127.0.0.1:' + PORT + y, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(bas || {}) }, body: typeof o === 'string' ? o : JSON.stringify(o) }).then((r) => r.status).catch(() => 0);

if (process.platform !== 'win32') { console.log('skipped: the helper is Windows only'); process.exit(0); }

const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'pagesiren-helper-test-'));
const exe = path.join(kok, 'PageSirenAlarm.exe');
// There is no ready exe in the repository: it is built from source unless a path is given
if (process.argv[2]) fs.copyFileSync(EXE, exe);
else fs.copyFileSync(yardimciHazirla(path.join(kok, 'derle'), 'test', console.log) || process.exit(2), exe);
const veri = path.join(kok, 'veri');
fs.mkdirSync(veri);
const alarmDosyasi = path.join(kok, 'test-alarmlar.jsonl');
const alarmlar = () => { try { return fs.readFileSync(alarmDosyasi, 'utf8').replace(/^﻿/, '').split('\n').filter(Boolean).map((s) => JSON.parse(s)); } catch (e) { return []; } };

// pagesiren.js yerine: arayuz portunu tutar, yardimciya ozet yazar. "sus" dosyasi varsa yazmaz (takilmis gibi), portu birakmaz.
const sahteMini = path.join(kok, 'sahte-pagesiren.js');
fs.writeFileSync(sahteMini, `
const fs = require('fs'), path = require('path'), http = require('http');
const i = process.argv.indexOf('--data'); const veri = process.argv[i + 1];
const p = Number(process.argv[process.argv.indexOf('--port') + 1]);
fs.writeFileSync(path.join(veri, 'pagesiren.pid'), String(process.pid));
fs.appendFileSync(path.join(veri, 'baslama.txt'), process.pid + '\\n');
http.createServer((q, c) => c.end('{}')).listen(p, '127.0.0.1');
setInterval(() => {
  if (fs.existsSync(path.join(veri, 'sus'))) return;
  fetch('http://127.0.0.1:${PORT}/ozet?kaynak=mini', { method: 'POST', body: JSON.stringify({ aktifSayi: 3, ok: true, kim: 'mini', pid: process.pid }) }).catch(() => {});
}, 200);
`);
const baslamalar = () => { try { return fs.readFileSync(path.join(veri, 'baslama.txt'), 'utf8').split('\n').filter(Boolean).map(Number); } catch (e) { return []; } };
const yasiyor = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return false; } };
const hepsiniBitir = () => { for (const p of baslamalar()) { try { process.kill(p); } catch (e) { /* zaten kapali */ } } };

function yardimci(ek) {
  const c = spawn(exe, ['--test', '--lang', 'tr', '--port', String(PORT), '--ui-port', String(UI), '--data', veri, ...(ek || [])], { stdio: 'ignore' });
  return c;
}
async function durdur(c) {
  c.kill();
  await bekleKadar(async () => c.exitCode !== null || c.signalCode !== null, 5000);
  await bekle(300); // mutex + port serbest kalsin
}

(async function () {
  console.log('1) Iki kaynak: eklenti ve mini ayri tutulur, mini varsa o gosterilir');
  let y = yardimci(['--watchdog-sec', '100000']);
  ok('yardimci acildi', !!(await bekleKadar(() => alJson('/durum'), 6000)));
  let d = await alJson('/durum');
  ok('/durum mini=false, ozet yok', d.mini === false && d.ozetYasiSn === null, JSON.stringify(d));
  ok('kaynaksiz ozet: henuz yok', /no summary yet/.test(await al('/ozet')));
  await yolla('/ozet', { kim: 'eklenti' }, { Origin: 'chrome-extension://abc' });
  ok('eklenti ozeti saklandi ve gosterilir', (await alJson('/ozet')).kim === 'eklenti');
  ok('web sayfasi ozet yazamaz', (await yolla('/ozet', { kim: 'kotu' }, { Origin: 'https://kotu.example' })) === 403);
  await yolla('/ozet?kaynak=mini', { aktifSayi: 2, kim: 'mini' });
  d = await alJson('/durum');
  ok('mini yazinca /durum mini=true, yas 0', d.mini === true && d.ozetYasiSn === 0, JSON.stringify(d));
  ok('kaynak belirtilmezse mini gosterilir', (await alJson('/ozet')).kim === 'mini');
  ok('?kaynak=eklenti eklentiyi verir', (await alJson('/ozet?kaynak=eklenti')).kim === 'eklenti');
  await yolla('/ozet', { kim: 'eklenti2' }, { Origin: 'chrome-extension://abc' });
  ok('eklenti yazsa da mini gosterilmeye devam eder', (await alJson('/ozet')).kim === 'mini');
  console.log('2) Komutlar: mini varsa ona gider, kuyruklar karismaz');
  ok('komut kabul', (await yolla('/komut', { tip: 'DURAKLAT', id: 'x' })) === 200);
  ok('web sayfasi komut yazamaz', (await yolla('/komut', { tip: 'SIL', id: 'x' }, { Origin: 'chrome-extension://abc' })) === 403);
  ok('eklenti kuyrugu bos', JSON.stringify(await alJson('/komutlar')) === '[]');
  let k = await alJson('/komutlar?kaynak=mini');
  ok('mini kuyrugu komutu aldi', k.length === 1 && k[0].tip === 'DURAKLAT', JSON.stringify(k));
  ok('alininca kuyruk bosalir', JSON.stringify(await alJson('/komutlar?kaynak=mini')) === '[]');
  await yolla('/komut?kaynak=eklenti', { tip: 'BASLAT', id: 'y' });
  k = await alJson('/komutlar');
  ok('?kaynak=eklenti ile eklentiye gider', k.length === 1 && k[0].tip === 'BASLAT', JSON.stringify(k));
  console.log('3) Alarm: test modunda dosyaya yazilir (pencere yok)');
  await yolla('/alarm', { ad: 'Konser', satirlar: ['a'], url: 'http://x' });
  ok('alarm geldi', alarmlar().length === 1 && alarmlar()[0].ad === 'Konser', JSON.stringify(alarmlar()));
  ok('bozuk alarm reddedilir', (await yolla('/alarm', 'bozuk{')) === 400);
  await durdur(y);
  fs.rmSync(alarmDosyasi, { force: true });

  console.log('4) Bekci: ozet kesilince BIR kez uyarir, geri gelince yeniden kurulur; aktif izleme yoksa uyarmaz');
  y = yardimci(['--watchdog-sec', '3']);
  await bekleKadar(() => alJson('/durum'), 6000);
  ok('acilista hemen uyarmaz', (await bekle(1500), alarmlar().length === 0));
  ok('3 sn ozet yok: alarm', await bekleKadar(() => alarmlar().length === 1, 6000), JSON.stringify(alarmlar()));
  ok('alarm metni acik', /DURDU/.test(alarmlar()[0].ad) && alarmlar()[0].ses === true && /\/\/127\.0\.0\.1:47397\//.test(alarmlar()[0].url), JSON.stringify(alarmlar()[0]));
  await bekle(1500);
  ok('ayni kesinti icin ikinci alarm yok', alarmlar().length === 1, alarmlar().length);
  await yolla('/ozet?kaynak=mini', { aktifSayi: 2 });
  await bekle(1000);
  ok('ozet gelince sessiz', alarmlar().length === 1, alarmlar().length);
  ok('ozet yine kesilince yeni alarm', await bekleKadar(() => alarmlar().length === 2, 6000), alarmlar().length);
  await yolla('/ozet?kaynak=mini', { aktifSayi: 0 });
  await bekle(4500);
  ok('aktif izleme 0 iken uyarmaz', alarmlar().length === 2, alarmlar().length);
  await durdur(y);

  console.log('5) Denetci: mini yoksa baslatir, kapanirsa yeniden baslatir, takilirsa kapatip baslatir');
  // Not 3 s: on a slow CI machine the first summary can take longer than that, and the first copy gets replaced
  y = yardimci(['--watchdog-sec', '100000', '--app', sahteMini, '--app-dead-sec', '8']);
  ok('mini baslatildi', await bekleKadar(() => baslamalar().length === 1, 8000), baslamalar().length);
  ok('mini ozet yaziyor', await bekleKadar(async () => (await alJson('/durum')).mini === true, 7000));
  const p1 = baslamalar()[0];
  await bekle(1000);
  ok('calisirken ikinci kopya acilmaz', baslamalar().length === 1, baslamalar().length);
  process.kill(p1);
  ok('kapaninca yeniden baslatildi', await bekleKadar(() => baslamalar().length === 2, 25000), baslamalar().length);
  const p2 = baslamalar()[1];
  await bekleKadar(async () => (await alJson('/ozet?kaynak=mini')).pid === p2, 5000);
  fs.writeFileSync(path.join(veri, 'sus'), '1');
  ok('takilan mini kapatildi', await bekleKadar(() => !yasiyor(p2), 25000));
  fs.rmSync(path.join(veri, 'sus'));
  ok('yerine yenisi baslatildi', await bekleKadar(() => baslamalar().length === 3, 30000), baslamalar().length);

  console.log('6) Yardimci kapanip acilinca: mini ayakta kalir, port miras kalmadigi icin yardimci yeniden dinler, ikinci mini acilmaz');
  const p3 = baslamalar()[2];
  await durdur(y);
  await bekle(600);
  ok('mini yardimciyla olmedi', yasiyor(p3));
  y = yardimci(['--watchdog-sec', '100000', '--app', sahteMini, '--app-dead-sec', '300']);
  ok('yardimci ayni portu yeniden aldi (soket miras kalmadi)', !!(await bekleKadar(() => alJson('/durum'), 6000)));
  await bekle(1500);
  ok('calisan mini varken yenisi baslatilmaz', baslamalar().length === 3, baslamalar().length);
  ok('mini yeni yardimciya ozet yaziyor', await bekleKadar(async () => (await alJson('/durum')).mini === true, 5000));
  await durdur(y);
  hepsiniBitir();

  console.log('\n' + gecti + ' gecti, ' + kaldi + ' basarisiz');
  await bekle(300);
  try { fs.rmSync(kok, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { /* gecici klasor */ }
  process.exit(kaldi ? 1 : 0);
})().catch((e) => { console.log('TEST HATASI', e); hepsiniBitir(); process.exit(2); });

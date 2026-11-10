// PageSiren — end-to-end tests: the real pagesiren.js + real Chrome (--headless=new, no window opens) + a fake site + a fake helper.
// Requests go only to 127.0.0.1. Run:  node test/app.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { iceAktar } = require('../app/import');
const { Depo } = require('../app/store');

const KOK = path.join(__dirname, '..');
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

// --------------------------------------------------------------- sahte site
const UZUN = '<p>Etkinlik bilgisi burada yazar, oldukça uzun bir paragraf olarak kalır.</p><p>İkinci paragraf: salonlar, saatler ve ulaşım bilgisi.</p>'
  + '<a href="/bilgi">Bilgi</a><a href="/iletisim">İletişim</a><a href="/sss">Sık sorulan sorular</a>';
const sayfa = (govde) => '<html><head><title>Etkinlik</title></head><body><h1>Konser</h1>' + govde + UZUN + '</body></html>';
const site = {
  acik: false, jsAcik: false, istekler: [], cerezler: [],
  durumu: {},
};
const siteSunucu = http.createServer((q, c) => {
  const yol = q.url.split('?')[0];
  site.istekler.push({ yol, ua: q.headers['user-agent'] || '' });
  site.cerezler.push(q.headers.cookie || '');
  const html = (g, kod) => { c.writeHead(kod || 200, { 'Content-Type': 'text/html; charset=utf-8' }); c.end(g); };
  if (yol === '/varlik') return html(sayfa('<ul><li>Salon A <span>T&uuml;kendi</span></li><li>Salon B <span>Ausverkauft &#228; &#xFC; &amp; son</span></li></ul>'));
  if (yol === '/resim.png') { c.writeHead(200, { 'Content-Type': 'image/png' }); return c.end(Buffer.alloc(10)); }
  if (yol === '/ham') return html(sayfa('<ul><li>Salon A <span>' + (site.acik ? 'Satışta</span><button>Satın Al</button>' : 'Tükendi</span>') + '</li><li>Salon B <span>Tükendi</span></li></ul>'));
  // tarayici gerekir: icerik JS ile dolar, resim istegi engellenmeli
  if (yol === '/js') return html(sayfa('<img src="/resim.png"><div id="k"></div><script>document.getElementById("k").innerHTML=' + JSON.stringify('<ul><li>Salon A <span>' + (site.jsAcik ? 'Satışta</span><button>Satın Al</button>' : 'Tükendi</span>') + '</li><li>Salon B <span>Tükendi</span></li></ul>') + ';</script>'));
  if (yol === '/giris-ister') { c.writeHead(302, { Location: '/account/login' }); return c.end(); }
  if (yol === '/account/login') return html(sayfa('<form><input type=password><button>Giriş</button></form>'));
  if (yol === '/yasak') return html('yasak', 403);
  if (yol === '/cerez-koy') { c.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'oturum=abc; Path=/' }); return c.end(sayfa('<p>cerez kondu</p>')); }
  if (yol === '/cerez-bak') return html(sayfa('<p id="c">cerez:' + (/oturum=abc/.test(q.headers.cookie || '') ? 'VAR' : 'YOK') + '</p>'));
  if (yol === '/uyari') return html(sayfa('<script>alert("x")</script><ul><li>Uyarili <span>Tükendi</span></li></ul>'));
  return html(sayfa('<p>bos</p>'));
});

// --------------------------------------------------------------- sahte yardimci (PageSirenAlarm.exe'nin yerine)
const yrd = { acik: true, alarmlar: [], ozetler: [], komutlar: [], yollar: [], oneGetir: [] };
const yrdSunucu = http.createServer((q, c) => {
  const parcalar = [];
  q.on('data', (p) => parcalar.push(p));
  q.on('end', () => {
    yrd.yollar.push(q.method + ' ' + q.url);
    const govde = Buffer.concat(parcalar).toString('utf8');
    const j = (kod, o) => { c.writeHead(kod, { 'Content-Type': 'application/json' }); c.end(JSON.stringify(o)); };
    if (!yrd.acik) { c.destroy(); return; }
    if (q.url === '/alarm') { yrd.alarmlar.push(JSON.parse(govde)); return j(200, { ok: true }); }
    if (q.url === '/ozet?kaynak=mini') { yrd.ozetler.push(JSON.parse(govde)); return j(200, { ok: true }); }
    if (q.url === '/komutlar?kaynak=mini') return j(200, yrd.komutlar.splice(0));
    if (q.url === '/one-getir') { yrd.oneGetir.push(JSON.parse(govde)); return j(200, { ok: true, pencere: 0 }); }
    if (q.url === '/durum') return j(200, { ok: true });
    if (q.url === '/kapat') return j(200, { ok: true });
    return j(404, {});
  });
});

const dinle = (s) => new Promise((coz) => s.listen(0, '127.0.0.1', () => coz(s.address().port)));

// --------------------------------------------------------------- mini'yi calistirma
const UI_PORT = 47395;
let veri;
let yrdPort;
let sitePort;
let uyg = null;
const yaz = (ad, o) => { fs.mkdirSync(path.join(veri, 'store'), { recursive: true }); fs.writeFileSync(path.join(veri, 'store', ad + '.json'), JSON.stringify(o)); };
const oku = (ad) => { try { return JSON.parse(fs.readFileSync(path.join(veri, 'store', ad + '.json'), 'utf8')); } catch (e) { return null; } };
const adres = (y) => 'http://127.0.0.1:' + sitePort + y;
const izle = (o) => ({ ad: o.id, aralikSn: 3, aktif: true, durum: 'hazirlaniyor', sorun: '', ozet: '', olusturma: Date.now(), sonYenileme: 0, sonKontrol: 0, sekmeId: null, yoksay: [], kelimeler: '', ...o });

function baslat(ekArg, ortamVeri) {
  const arglar = [path.join(KOK, 'app', 'pagesiren.js'), '--lang', 'tr', '--data', ortamVeri || veri, '--port', String(UI_PORT), '--helper-port', String(yrdPort), '--headless',
    '--clock-ms', '400', '--read-wait-ms', '200', '--reread-ms', '150', '--spread-ms', '0', '--open-limit', '100', '--idle-ms', '1500', ...(ekArg || [])];
  const c = spawn(process.execPath, arglar, { stdio: 'ignore', windowsHide: true });
  const u = { c, bitti: false, kod: null };
  c.on('exit', (k) => { u.bitti = true; u.kod = k; });
  uyg = u;
  return u;
}
async function durdur(u) {
  if (!u || u.bitti) return;
  await fetch('http://127.0.0.1:' + UI_PORT + '/dur', { method: 'POST' }).catch(() => {});
  await bekleKadar(() => u.bitti, 12000);
  if (!u.bitti) u.c.kill();
}
const saglik = () => fetch('http://127.0.0.1:' + UI_PORT + '/saglik').then((r) => r.json()).catch(() => null);
const mesaj = (m) => fetch('http://127.0.0.1:' + UI_PORT + '/mesaj', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m) }).then((r) => r.json());
const liste = async () => (await mesaj({ tip: 'LISTE' }));
const izlemeBul = async (id) => (await liste()).izlemeler.find((x) => x.id === id);
const hazirBekle = () => bekleKadar(saglik, 15000);
const logOku = () => { try { return fs.readFileSync(path.join(veri, 'pagesiren.log'), 'utf8'); } catch (e) { return ''; } };

(async function () {
  sitePort = await dinle(siteSunucu);
  yrdPort = await dinle(yrdSunucu);
  veri = fs.mkdtempSync(path.join(os.tmpdir(), 'pagesiren-test-'));
  const zamanAsimi = setTimeout(() => { console.log('ZAMAN ASIMI (log):\n' + logOku().slice(-3000)); process.exit(2); }, 420000);

  console.log('1) Tarayicisiz (duz HTTP) okuma: taban, iki okumada onay, alarm; siteye dogru kimlikle gider');
  yaz('izlemeler', [izle({ id: 'ham1', url: adres('/ham'), okuyucu: 'http' })]);
  let u = baslat();
  ok('program ayaga kalkti', !!(await hazirBekle()), logOku().slice(-800));
  ok('taban alindi (izleniyor)', await bekleKadar(async () => (await izlemeBul('ham1')).durum === 'izleniyor', 15000), JSON.stringify(await izlemeBul('ham1')));
  const ilkIstek = site.istekler.find((i) => i.yol === '/ham');
  ok('duz HTTP istegi kendini saklamaz (User-Agent PageSiren)', !!ilkIstek && /PageSiren/.test(ilkIstek.ua), ilkIstek && ilkIstek.ua);
  ok('tarayici hic acilmadi', (await saglik()).tarayici === false, JSON.stringify(await saglik()));
  site.acik = true;
  ok('satis acilinca alarm yardimciya gitti', await bekleKadar(() => yrd.alarmlar.length >= 1, 20000), logOku().slice(-800));
  ok('alarm dogru izleme icin', yrd.alarmlar[0] && yrd.alarmlar[0].ad === 'ham1' && yrd.alarmlar[0].url === adres('/ham'), JSON.stringify(yrd.alarmlar[0]));
  ok('ozet mini kaynagiyla yazildi, aktifSayi ilk alan', yrd.ozetler.length > 0 && Object.keys(yrd.ozetler[0])[0] === 'aktifSayi' && yrd.ozetler[0].aktifSayi === 1, JSON.stringify(yrd.ozetler[0] || {}).slice(0, 200));
  ok('sekme okununca kapandi', await bekleKadar(async () => { const s = await saglik(); return s.sekme <= 1; }, 10000), JSON.stringify(await saglik()));

  const varlik = await mesaj({ tip: 'EKLE', ad: 'varlikli', url: adres('/varlik'), aralikSn: 30, okuyucu: 'http' });
  await mesaj({ tip: 'GUNCELLE', id: varlik.id, detay: true });
  ok('duz okumada HTML varliklari tarayicidaki gibi cozulur', await bekleKadar(() => {
    const oz = yrd.ozetler[yrd.ozetler.length - 1];
    const x = oz && (oz.izlemeler || []).find((i) => i.id === varlik.id);
    return x && x.anahtarlar && x.anahtarlar.some((k) => /Tükendi/.test(k)) && x.anahtarlar.some((k) => /ä ü & son/.test(k));
  }, 15000), JSON.stringify((yrd.ozetler[yrd.ozetler.length - 1].izlemeler || []).find((i) => i.id === varlik.id)));
  await mesaj({ tip: 'DURAKLAT', id: varlik.id });

  console.log('2) Takip ekrani: eklentinin ekrani gelir, yabanci site yazamaz');
  let r = await fetch('http://127.0.0.1:' + UI_PORT + '/');
  let m = await r.text();
  ok('ekran aciliyor, chrome yerine yerel kopru yuklu', r.status === 200 && m.includes('/krom.js') && m.includes('/dashboard.js'), m.slice(0, 200));
  // "en" yazan Turkce ekrani tarayici Ingilizce sanip cevirmeye kalkiyordu: sayfa arayuzun diliyle gider
  ok('ekran arayuzun diliyle sunulur', /<html lang="tr">/.test(m) && !/<html lang="en">/.test(m), m.slice(0, 80));
  ok('alarm penceresi de', /<html lang="tr">/.test(await (await fetch('http://127.0.0.1:' + UI_PORT + '/alarm')).text()));
  const krom = await (await fetch('http://127.0.0.1:' + UI_PORT + '/krom.js')).text();
  ok('kopru mesajlari /mesaj adresine yollar', /sendMessage/.test(krom) && /\/mesaj/.test(krom));
  r = await fetch('http://127.0.0.1:' + UI_PORT + '/mesaj', { method: 'POST', headers: { Origin: 'https://kotu.example', 'Content-Type': 'text/plain' }, body: JSON.stringify({ tip: 'LISTE' }) });
  ok('baska kokenden gelen istek reddedilir', r.status === 403, r.status);
  r = await new Promise((coz) => { const q = http.request({ host: '127.0.0.1', port: UI_PORT, path: '/saglik', headers: { Host: 'kotu.example' } }, coz); q.end(); });
  ok('yabanci Host reddedilir (DNS yeniden baglama)', r.statusCode === 403, r.statusCode);
  r = await fetch('http://127.0.0.1:' + UI_PORT + '/../background.js');
  ok('eklenti klasorunden izinsiz dosya verilmez', r.status !== 200, r.status);
  const kapat = await mesaj({ tip: 'ALARM_KAPAT', alarmId: '*', islem: 'gec' });
  ok('ekrandan alarm kapatilir', kapat.ok === true, JSON.stringify(kapat));
  ok('acik alarm kalmayinca pencere kapatma istegi gider', await bekleKadar(() => yrd.yollar.includes('POST /kapat'), 3000), yrd.yollar.slice(-5).join(','));

  console.log('3) Yardimcidan komut: yeni izleme eklenir, tarayici okuyucusu JS ile dolan sayfayi gorur');
  site.istekler.length = 0;
  yrd.alarmlar.length = 0;
  yrd.komutlar.push({ tip: 'EKLE', ad: 'jsli', url: adres('/js'), aralikSn: 30 });
  const jsIz = await bekleKadar(async () => (await liste()).izlemeler.find((x) => x.ad === 'jsli'), 8000);
  ok('komut kuyrugu okundu, izleme eklendi', !!jsIz);
  // the first read starts a fresh browser on a fresh profile: once it took 30.4 s on a slow ubuntu runner
  const okundu = await bekleKadar(async () => { const x = await izlemeBul(jsIz.id); return x.durum === 'izleniyor' ? x : null; }, 60000);
  ok('tarayici ile okundu, taban alindi', !!okundu, JSON.stringify(await izlemeBul(jsIz.id)) + logOku().slice(-1200));
  ok('sayfanin JS ile doldurdugu icerik goruldu (ozette oge var)', !!okundu && /öğe/.test(okundu.ozet || ''), okundu && okundu.ozet);
  const jsIstek = site.istekler.find((i) => i.yol === '/js');
  ok('tarayici okumasi gercek tarayici kimligiyle', !!jsIstek && /Chrome/.test(jsIstek.ua), jsIstek && jsIstek.ua);
  ok('resim engellendi (siteye resim istegi gitmedi)', !site.istekler.some((i) => i.yol === '/resim.png'), JSON.stringify(site.istekler.map((i) => i.yol)));
  ok('tarayici acik gorunuyor', (await saglik()).tarayici === true || logOku().includes('tarayici baslatildi'));

  console.log('4) Bosta kalinca tarayici kapanir, gerekince yeniden acilir');
  await mesaj({ tip: 'GUNCELLE', id: jsIz.id, aralikSn: 1800 });
  ok('is bitince tarayici kapandi', await bekleKadar(async () => (await saglik()).tarayici === false, 15000), JSON.stringify(await saglik()));
  // Tarayici kapaliyken satis acildi: bir sonraki okuma tarayiciyi yeniden acip gormeli (taban diskte duruyor)
  site.jsAcik = true;
  await mesaj({ tip: 'GUNCELLE', id: jsIz.id, aralikSn: 30 });
  ok('tarayici yeniden acilip satisi gordu, alarm geldi', await bekleKadar(() => yrd.alarmlar.some((a) => a.ad === 'jsli'), 80000), JSON.stringify(await izlemeBul(jsIz.id)) + logOku().slice(-1200));

  console.log('5) Yeniden baslayinca veri ve taban kalir (alarm tekrar calmaz)');
  await durdur(u);
  ok('program temiz kapandi', u.bitti && u.kod === 0, u.kod);
  ok('kapaninca tarayici da kapandi (pid dosyasindaki surec yok)', (() => { try { process.kill(Number(fs.readFileSync(path.join(veri, 'profile.pid'), 'utf8')), 0); return false; } catch (e) { return true; } })());
  const izDisk = oku('izlemeler');
  ok('izlemeler diskte', izDisk && izDisk.length === 3, JSON.stringify(izDisk && izDisk.length));
  ok('taban diskte (motor_ dosyasi)', !!oku('motor_' + jsIz.id));
  yrd.alarmlar.length = 0;
  u = baslat();
  await hazirBekle();
  const onceKontrol = (await izlemeBul('ham1')).sonKontrol;
  ok('ham izleme yeni okundu', await bekleKadar(async () => (await izlemeBul('ham1')).sonKontrol > onceKontrol, 20000));
  ok('ayni durum icin yeniden alarm yok', !yrd.alarmlar.some((a) => a.ad === 'ham1'), JSON.stringify(yrd.alarmlar));

  console.log('6) Giris sayfasina yonlenme: oturum dustu, taban alinmaz; 403: tarayiciya doner, siteye duz HTTP ile bir daha gidilmez');
  await mesaj({ tip: 'DURAKLAT', id: jsIz.id });
  await mesaj({ tip: 'DURAKLAT', id: 'ham1' });
  const giris = await mesaj({ tip: 'EKLE', ad: 'girisli', url: adres('/giris-ister'), aralikSn: 30 });
  ok('oturum dustu turuncu', await bekleKadar(async () => /OTURUM/.test((await izlemeBul(giris.id)).sorun || ''), 20000), JSON.stringify(await izlemeBul(giris.id)));
  await mesaj({ tip: 'DURAKLAT', id: giris.id });
  site.istekler.length = 0;
  const yasak = await mesaj({ tip: 'EKLE', ad: 'yasakli', url: adres('/yasak'), aralikSn: 30, okuyucu: 'http' });
  ok('403 alinca izleme tarayici okuyucusuna dondu', await bekleKadar(async () => (await izlemeBul(yasak.id)).okuyucu === '', 20000), JSON.stringify(await izlemeBul(yasak.id)));
  await mesaj({ tip: 'DURAKLAT', id: yasak.id });

  console.log('7) Tarayici cokerse: izleme takilmaz, sonraki okumada yeniden acilir');
  await mesaj({ tip: 'ALARM_KAPAT', alarmId: '*', islem: 'gec' });
  await mesaj({ tip: 'BASLAT', id: jsIz.id });
  await mesaj({ tip: 'NOBET', id: jsIz.id }); // hemen okunsun
  await bekleKadar(async () => (await saglik()).tarayici === true, 20000);
  const pid = Number(fs.readFileSync(path.join(veri, 'profile.pid'), 'utf8'));
  try { process.kill(pid); } catch (e) { /* zaten kapali */ }
  ok('kopma fark edildi', await bekleKadar(async () => (await saglik()).tarayici === false, 10000), JSON.stringify(await saglik()));
  const kopmaZamani = Date.now();
  ok('izleme tekrar okundu', await bekleKadar(async () => { const x = await izlemeBul(jsIz.id); return x.sonKontrol > kopmaZamani && x.durum !== 'sorun'; }, 80000), JSON.stringify(await izlemeBul(jsIz.id)) + logOku().slice(-1200));
  await mesaj({ tip: 'DURAKLAT', id: jsIz.id });

  console.log('7b) "Ac" dugmesi: okuyucu profilinde pencere acar (burada gizli), acikken tarayici bosta kapanmaz');
  const acma = await mesaj({ tip: 'EKLE', ad: 'acilan', url: adres('/acilan-site'), aralikSn: 1800 });
  await bekleKadar(async () => (await izlemeBul(acma.id)).sonKontrol > 0, 40000);
  site.istekler.length = 0;
  await mesaj({ tip: 'DURAKLAT', id: acma.id });
  const acCevap = await mesaj({ tip: 'SITE_AC', id: acma.id, ekran: { sol: -1920, ust: 0, en: 1920, boy: 1040 } });
  ok('site acildi', acCevap.ok === true && await bekleKadar(() => site.istekler.some((i) => i.yol === '/acilan-site'), 15000), JSON.stringify(site.istekler));
  if (process.platform === 'win32') {
    ok('pencere one alinsin diye yardimciya tarayicinin sureci gitti', await bekleKadar(() => yrd.oneGetir.some((o) => Number.isInteger(o.pid) && o.pid > 0), 5000), JSON.stringify(yrd.oneGetir));
  }
  const tuhaf = await mesaj({ tip: 'SITE_AC', id: acma.id, ekran: { sol: 'x', ust: 1e9, en: -5, boy: null } });
  ok('anlamsiz ekran bilgisi bir sey bozmaz', tuhaf.ok === true, JSON.stringify(tuhaf));
  await bekle(2500); // bosta suresi 1,5 sn
  ok('gorunur pencere varken tarayici acik kalir', (await saglik()).tarayici === true, JSON.stringify(await saglik()));

  console.log('8) Sayfa alert() acsa da okuma takilmaz');
  const uyari = await mesaj({ tip: 'EKLE', ad: 'alertli', url: adres('/uyari'), aralikSn: 30 });
  ok('alert li sayfa okundu', await bekleKadar(async () => (await izlemeBul(uyari.id)).durum === 'izleniyor', 40000), JSON.stringify(await izlemeBul(uyari.id)));
  await mesaj({ tip: 'DURAKLAT', id: uyari.id });

  console.log('9) Yardimci kapaliyken alarm kaybolmaz, acilinca ulasir');
  yrd.alarmlar.length = 0;
  yrd.acik = false;
  await mesaj({ tip: 'TEST_ALARM' });
  await bekle(1000);
  ok('yardimci kapali: alarm kuyrukta bekliyor', (await saglik()).bekleyenAlarm === 1 && yrd.alarmlar.length === 0, JSON.stringify(await saglik()));
  yrd.acik = true;
  ok('yardimci acilinca alarm ulasti', await bekleKadar(() => yrd.alarmlar.some((a) => a.ad === 'TEST ALARMI'), 10000), JSON.stringify(await saglik()));

  console.log('10) Ayni anda ikinci program calismaz (cift alarm olmaz)');
  const u2 = baslat();
  ok('ikinci kopya kod 3 ile kapandi', await bekleKadar(() => u2.bitti, 8000) && u2.kod === 3, u2.kod);
  uyg = u;

  console.log('11) Diskte yeni surum: program kendini kapatir (yardimci yeniden baslatir)');
  await durdur(u);
  const ekKopya = path.join(veri, 'ek');
  fs.mkdirSync(ekKopya);
  for (const f of fs.readdirSync(path.join(KOK, 'extension'))) fs.copyFileSync(path.join(KOK, 'extension', f), path.join(ekKopya, f));
  u = baslat(['--extension', ekKopya]);
  await hazirBekle();
  const man = JSON.parse(fs.readFileSync(path.join(ekKopya, 'manifest.json'), 'utf8'));
  man.version = '99.99';
  fs.writeFileSync(path.join(ekKopya, 'manifest.json'), JSON.stringify(man));
  ok('yeni surumu gorup temiz kapandi', await bekleKadar(() => u.bitti, 10000) && u.kod === 0, u.kod);

  console.log('12) Saglik: hicbir sayfa okunamiyorsa kendi kendine alarm');
  const veri2 = path.join(veri, 'iki');
  fs.mkdirSync(path.join(veri2, 'store'), { recursive: true });
  fs.writeFileSync(path.join(veri2, 'store', 'izlemeler.json'), JSON.stringify([izle({ id: 'okunmaz', url: 'http://127.0.0.1:1/yok', okuyucu: 'http' })]));
  yrd.alarmlar.length = 0;
  u = baslat(['--health-ms', '2500'], veri2);
  ok('okuma durunca "TAKIP DURDU" alarmi geldi', await bekleKadar(() => yrd.alarmlar.some((a) => /DURDU/.test(a.ad)), 15000), JSON.stringify(yrd.alarmlar));
  const sayi0 = yrd.alarmlar.length;
  await bekle(1500);
  ok('ayni kesinti icin bir kez', yrd.alarmlar.length === sayi0, yrd.alarmlar.length);
  await durdur(u);

  console.log('13) Oturum cerezi tarayici yeniden acilinca kaybolmaz (giris dusmesin)');
  const veri3 = path.join(veri, 'uc');
  fs.mkdirSync(path.join(veri3, 'store'), { recursive: true });
  fs.writeFileSync(path.join(veri3, 'store', 'izlemeler.json'), JSON.stringify([izle({ id: 'cerez', url: adres('/cerez-koy'), aralikSn: 30 })]));
  u = baslat(null, veri3);
  await hazirBekle();
  await bekleKadar(async () => (await izlemeBul('cerez')).sonKontrol > 0, 30000);
  await durdur(u); // tarayici tamamen kapanir
  site.cerezler.length = 0;
  const veriIz = JSON.parse(fs.readFileSync(path.join(veri3, 'store', 'izlemeler.json'), 'utf8'));
  veriIz[0].url = adres('/cerez-bak'); veriIz[0].sonYenileme = 0; veriIz[0].sonKontrol = 0;
  fs.writeFileSync(path.join(veri3, 'store', 'izlemeler.json'), JSON.stringify(veriIz));
  u = baslat(null, veri3);
  await hazirBekle();
  await bekleKadar(() => site.cerezler.some((c) => c), 40000);
  ok('oturum cerezi yeniden acilista gitti', site.cerezler.some((c) => /oturum=abc/.test(c)), JSON.stringify(site.cerezler));
  await durdur(u);

  console.log('14) Eklentiden tasima');
  const veri4 = path.join(veri, 'dort', 'store');
  const oz = {
    izlemeler: [
      { id: 'a', ad: 'A', url: 'https://a.test/', aktif: true, aralikSn: 300, hizli: true, kelimeler: 'x', girisYazisi: 'Hesabim', sorun: 'OTURUM DÜŞMÜŞ — bu sayfa giriş istiyor', durum: 'sorun', sonKontrolSn: 5, sekme: 9 },
      { id: 'b', ad: 'B', url: 'https://b.test/', aktif: false, aralikSn: 600, herDegisiklik: true },
    ],
    acikAlarmlar: [{ id: 'al1', ad: 'A', zaman: '2026-11-02T10:00:00Z', satirlar: ['+ eklendi'], anahtarlar: ['A|x'] }],
  };
  const sonuc = iceAktar(oz, veri4);
  ok('hepsi tasindi', sonuc.izleme === 2 && sonuc.aktif === 1 && sonuc.alarm === 1, JSON.stringify(sonuc));
  const l4 = JSON.parse(fs.readFileSync(path.join(veri4, 'izlemeler.json'), 'utf8'));
  ok('ayarlari tasindi, okuma durumu sifirlandi', l4[0].hizli === true && l4[0].kelimeler === 'x' && l4[0].girisYazisi === 'Hesabim' && l4[0].sonKontrol === 0 && l4[0].sekmeId === null, JSON.stringify(l4[0]));
  ok('duraklatilmis izleme duraklatilmis kalir', l4[1].aktif === false && l4[1].durum === 'duraklatildi', JSON.stringify(l4[1]));
  ok('oturumu dusuk izleme gece siren calmaz (sayac dolu)', l4[0].oturumAlarmi === true && l4[0].oturumSay === 2);
  let hata = '';
  try { iceAktar(oz, veri4); } catch (e) { hata = e.message; }
  ok('dolu depoya kazara yazilmaz', /already has watches/.test(hata), hata);

  console.log('15) Calisan programa tasima: bellekte de guncellenir, sadece yerel arac yapabilir');
  const veri5 = path.join(veri, 'bes');
  fs.mkdirSync(veri5, { recursive: true });
  u = baslat(null, veri5);
  await hazirBekle();
  const oz5 = { izlemeler: [{ id: 'c', ad: 'C', url: adres('/ham'), aktif: true, aralikSn: 300, okuyucu: 'http' }], acikAlarmlar: [] };
  const aktarUrl = 'http://127.0.0.1:' + UI_PORT + '/ice-aktar';
  r = await fetch(aktarUrl, { method: 'POST', headers: { Origin: 'http://127.0.0.1:' + UI_PORT }, body: JSON.stringify(oz5) });
  ok('takip ekranindan bile toplu yazilamaz', r.status === 403, r.status);
  r = await fetch(aktarUrl, { method: 'POST', body: JSON.stringify(oz5) });
  ok('yerel aracla aktarildi', r.status === 200, r.status);
  ok('calisan program yeni izlemeyi hemen okudu', await bekleKadar(async () => { const x = (await liste()).izlemeler.find((i) => i.id === 'c'); return x && x.sonKontrol > 0; }, 20000), JSON.stringify((await liste()).izlemeler));
  r = await fetch(aktarUrl, { method: 'POST', body: JSON.stringify(oz5) });
  ok('ikinci kez yazmaz', r.status === 409, r.status);
  await durdur(u);

  console.log('16) Okunurken kapanan izleme bir aralik beklemez; bozuk liste sessizce bosalmaz');
  const veri6 = path.join(veri, 'alti');
  fs.mkdirSync(path.join(veri6, 'store'), { recursive: true });
  const eskiOkuma = Date.now() - 5000;
  fs.writeFileSync(path.join(veri6, 'store', 'izlemeler.json'), JSON.stringify([izle({ id: 'yarim', url: adres('/ham'), okuyucu: 'http', aralikSn: 1800, sekmeId: 77, sonYenileme: Date.now(), sonKontrol: eskiOkuma })]));
  u = baslat(null, veri6);
  await hazirBekle();
  ok('yarim kalan okuma yeniden baslayinca hemen tekrarlandi', await bekleKadar(async () => (await izlemeBul('yarim')).sonKontrol > eskiOkuma, 15000), JSON.stringify(await izlemeBul('yarim')));
  await durdur(u);
  const veri7 = path.join(veri, 'yedi', 'store');
  let dp = new Depo(veri7);
  await dp.set({ izlemeler: [{ id: 'bir' }] });
  dp.hemenYaz();
  await dp.set({ izlemeler: [{ id: 'bir' }, { id: 'iki' }] });
  dp.hemenYaz();
  ok('son saglam kopya tutuluyor', fs.existsSync(path.join(veri7, 'izlemeler.json.yedek')));
  fs.writeFileSync(path.join(veri7, 'izlemeler.json'), '{yarim kalmis');
  const eskiHata = console.error;
  let hataYazisi = '';
  console.error = (m) => { hataYazisi = m; };
  dp = new Depo(veri7);
  console.error = eskiHata;
  ok('bozuk liste yedekten dondu, bos kalmadi', (dp.oku('izlemeler') || []).length === 1 && /from backup/.test(hataYazisi), JSON.stringify(dp.oku('izlemeler')));
  dp.hemenYaz();
  ok('dosya da duzeldi', JSON.parse(fs.readFileSync(path.join(veri7, 'izlemeler.json'), 'utf8')).length === 1);

  console.log('15) Without the helper: red browser window, optional notifications');
  const kanca = [];
  const kancaSunucu = http.createServer((q, c) => { const p = []; q.on('data', (x) => p.push(x)); q.on('end', () => { kanca.push(JSON.parse(Buffer.concat(p).toString('utf8'))); c.end('{}'); }); });
  const kancaPort = await dinle(kancaSunucu);
  const uiKok = 'http://127.0.0.1:' + UI_PORT;
  u = baslat(['--no-helper'], path.join(veri, 'sekiz'));
  await hazirBekle();
  const durum = await mesaj({ tip: 'APP_DURUM' });
  ok('alarm yolu tarayici, bildirim bos', durum.alarm === 'browser' && durum.bildirim.webhook.url === '' && !durum.otoBaslat, JSON.stringify(durum));
  ok('yardimci yok gorunur', (await liste()).yardimci === false);
  ok('kurulu olmayan kanal test edilemez', (await mesaj({ tip: 'APP_BILDIRIM_TEST', kanal: 'webhook' })).hata === 'not configured');
  const kaydedilen = await mesaj({ tip: 'APP_BILDIRIM_KAYDET', ayar: { webhook: { url: 'http://127.0.0.1:' + kancaPort + '/gizli-adres' } } });
  ok('ekrana maskeli doner', kaydedilen.ok && !JSON.stringify(kaydedilen).includes('gizli-adres'), JSON.stringify(kaydedilen));
  await mesaj({ tip: 'TEST_ALARM' });
  const alarmDurumu = await bekleKadar(async () => { const d = await (await fetch(uiKok + '/alarm-listesi')).json(); return d.alarmlar.length ? d : null; }, 5000);
  ok('alarm tarayici penceresine gider', !!alarmDurumu && alarmDurumu.alarmlar[0].ad === 'TEST ALARMI' && alarmDurumu.dil === 'tr', JSON.stringify(alarmDurumu));
  ok('bir pencere acilisi sayildi', (await saglik()).alarmPenceresi === 1);
  ok('bildirim de gider', await bekleKadar(() => kanca.some((k) => k.source === 'pagesiren' && k.name === 'TEST ALARMI'), 5000), JSON.stringify(kanca));
  ok('alarm sayfasi ve sesi sunulur', /PageSiren/.test(await (await fetch(uiKok + '/alarm')).text()) && (await fetch(uiKok + '/siren.wav')).headers.get('content-type') === 'audio/wav');
  ok('dil dosyasi ekranla birlikte sunulur', /<script src="i18n\.js">/.test(await (await fetch(uiKok + '/')).text()) && (await fetch(uiKok + '/i18n.js')).status === 200);
  await mesaj({ tip: 'APP_ALARM_KAPAT' });
  ok('kapatinca liste bosalir', (await (await fetch(uiKok + '/alarm-listesi')).json()).alarmlar.length === 0);
  const baskaKoken = await fetch(uiKok + '/mesaj', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify({ tip: 'APP_BILDIRIM_KAYDET', ayar: {} }) });
  ok('web sayfasi bildirim ayarina dokunamaz', baskaKoken.status === 403);
  await durdur(u);
  kancaSunucu.close();

  clearTimeout(zamanAsimi);
  console.log('\n' + gecti + ' gecti, ' + kaldi + ' basarisiz');
  siteSunucu.close();
  yrdSunucu.close();
  await bekle(500);
  try { fs.rmSync(veri, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch (e) { /* gecici klasor */ }
  process.exit(kaldi ? 1 : 0);
})().catch((e) => { console.log('TEST HATASI', e, '\n' + logOku().slice(-2000)); if (uyg) uyg.c.kill(); process.exit(2); });

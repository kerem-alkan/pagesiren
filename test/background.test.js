// PageSiren — behaviour tests of the brain (fake chrome; no window opens, nothing goes to a site). Labels inside are still mostly Turkish.
// Run:  node test/background.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EK = path.join(__dirname, '..', 'extension');
let gecti = 0;
let kaldi = 0;
function ok(ad, kosul, ek) {
  if (kosul) { gecti++; console.log('  OK  ' + ad); }
  else { kaldi++; console.log('  HATA ' + ad + (ek ? '  -> ' + ek : '')); }
}
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const chromeSekmeSil = async (t, id) => { const iz = (t.depo.izlemeler||[]).find((x) => x.id === id); t.sekmeler.delete(iz.sekmeId); t.sayfalar.delete(iz.sekmeId); };

// --------------------------------------------------------------- sahte chrome
function kur(secenek) {
  secenek = secenek || {};
  // Eski testler kalici sekme varsayar; hafif mod (okununca kapat) sadece istenen testte acik.
  const depo = secenek.hafif ? {} : { ayarlar: { hafifSekme: false } };
  const sekmeler = new Map();
  const sayfalar = new Map();   // sekmeId -> {html, url}
  const pencereler = new Map([[1, { id: 1, type: 'normal' }]]);
  const fetchler = [];
  const sesler = [];
  const olay = { onUpdated: [], onRemoved: [], onMessage: [] };
  let sonId = 100;
  let sonPencere = 10;

  const ctx = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, URL, TextEncoder, Math, Date, JSON, AbortController,
  };
  ctx.chrome = {
    runtime: {
      getManifest: () => ({ version: 'test' }),
      getURL: (p) => 'chrome-extension://test/' + p,
      sendMessage: async (m) => { if (m && (m.tip === 'ses' || m.tip === 'sesDur')) sesler.push(m); },
      onMessage: { addListener: (f) => olay.onMessage.push(f) },
      onStartup: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
      reload: () => { ctx.__yenidenYuklendi = true; },
    },
    storage: {
      local: {
        get: async (k) => (k == null ? { ...depo } : { [k]: depo[k] }),
        set: async (o) => { Object.assign(depo, o); },
        remove: async (k) => { delete depo[k]; },
      },
    },
    windows: {
      create: async ({ url }) => {
        const wid = ++sonPencere;
        pencereler.set(wid, { id: wid, type: 'popup' });
        const t = { id: ++sonId, windowId: wid, url };
        sekmeler.set(t.id, t);
        return { id: wid, tabs: [t] };
      },
      get: async (id) => { if (!pencereler.has(id)) throw new Error('No window'); return pencereler.get(id); },
      update: async () => {},
    },
    tabs: {
      create: async ({ windowId, url }) => { const t = { id: ++sonId, windowId: windowId || 1, url }; sekmeler.set(t.id, t); return t; },
      get: async (id) => { if (!sekmeler.has(id)) throw new Error('No tab with id ' + id); return sekmeler.get(id); },
      update: async (id, o) => { const t = sekmeler.get(id); if (!t) throw new Error('No tab with id'); if (o.url) t.url = o.url; return t; },
      remove: async (id) => { if (!sekmeler.has(id)) throw new Error('No tab'); sekmeler.delete(id); sayfalar.delete(id); },
      query: async (q) => [...sekmeler.values()].filter((t) => (q && q.windowId != null ? t.windowId === q.windowId : true)),
      onUpdated: { addListener: (f) => olay.onUpdated.push(f) },
      onRemoved: { addListener: (f) => olay.onRemoved.push(f) },
    },
    scripting: {
      executeScript: async ({ target, func }) => {
        const s = sayfalar.get(target.tabId);
        if (!s) throw new Error('Cannot access contents of the page');
        if (s.sira && s.sira.length) s.html = s.sira.shift(); // ayni yuklemede art arda okumalar (gec dolan sayfa)
        return [{ result: { html: s.html, url: s.url, baslik: '' } }];
      },
    },
    alarms: { get: async () => null, create: () => {}, onAlarm: { addListener: () => {} } },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, onClicked: { addListener: () => {} } },
    offscreen: { hasDocument: async () => true, createDocument: async () => {} },
    declarativeNetRequest: { getSessionRules: async () => [], updateSessionRules: async () => {} },
  };
  ctx.fetch = async (u, o) => {
    if (/manifest\.json$/.test(u)) return { ok: true, json: async () => (secenek.diskSurum ? { version: secenek.diskSurum } : {}) };
    fetchler.push({ u, o });
    if (/\/durum$/.test(u)) return { ok: true, json: async () => ({ ok: true, mini: !!secenek.miniAcik }) };
    if (/\/ozet\?kaynak=mini$/.test(u)) return { ok: true, json: async () => ({ izlemeler: secenek.miniIzlemeler || [] }) };
    return { ok: true, json: async () => (/\/komutlar$/.test(u) ? (secenek.komutlar || []).splice(0) : {}) };
  };
  ctx.self = ctx;
  ctx.__TEST = true;
  ctx.__DIL = secenek.dil || 'tr';
  if (secenek.mini) ctx.__MINI = true;
  ctx.__TEST_YAYMA_MS = 0;
  ctx.__TEST_OKUMA_BEKLE_MS = 5;
  ctx.__TEST_TEKRAR_OKU_MS = 5;
  if (secenek.acmaSiniri) ctx.__TEST_ACMA_SINIRI = secenek.acmaSiniri;
  if (secenek.kromMs) ctx.__TEST_KROM_MS = secenek.kromMs;
  if (secenek.tikTakildiMs) ctx.__TEST_TIK_TAKILDI_MS = secenek.tikTakildiMs;
  ctx.importScripts = (f) => vm.runInContext(fs.readFileSync(path.join(EK, f), 'utf8'), ctx, { filename: f });
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(EK, 'background.js'), 'utf8'), ctx, { filename: 'background.js' });
  const X = ctx.__PAGESIREN;
  return {
    X, depo, sekmeler, sayfalar, fetchler, sesler, ctx,
    islem: async (m) => { const r = await X.islem(m); await X.tik(); return r; },
    iz: (id) => (depo.izlemeler || []).find((x) => x.id === id),
    alarmlar: () => (depo.alarmlar || []).filter((a) => a.durum === 'yeni'),
    tik: () => X.tik(),
    sayfa: async (id, html, url) => {
      const iz = (depo.izlemeler || []).find((x) => x.id === id);
      const t = sekmeler.get(iz.sekmeId);
      if (url) t.url = url;
      sayfalar.set(iz.sekmeId, { html, url: url || t.url });
      await X.oku(id, iz.sekmeId, 1);
    },
    // Gercek sayfa yuklemesi: ilk okuma + gerekirse tekrar okumalar; her okuma siradaki html'i gorur.
    yukle: async (id, htmller, url) => {
      const iz = (depo.izlemeler || []).find((x) => x.id === id);
      const t = sekmeler.get(iz.sekmeId);
      if (url) t.url = url;
      sayfalar.set(iz.sekmeId, { html: htmller[0], sira: htmller.slice(), url: url || t.url });
      await X.oku(id, iz.sekmeId, 0);
    },
  };
}

// --------------------------------------------------------------- ornek sayfalar
const etkinlikSayfasi = (o) => {
  o = o || {};
  const tukendi = o.tukendi !== false;
  return '<html><head><title>Etkinlik</title></head><body><h1>Konser</h1>'
    + '<ul><li>Salon A <span>' + (tukendi ? 'Tükendi' : 'Satışta') + '</span>' + (o.buton ? '<button>Satın Al</button>' : '') + '</li>'
    + '<li>Salon B <span>Tükendi</span></li><li>Salon C <span>Tükendi</span></li></ul>'
    + '<p>Etkinlik bilgisi burada yazar, oldukça uzun bir paragraf olarak kalır.</p>'
    + '<p>İkinci paragraf: salonlar, saatler ve ulaşım bilgisi.</p>'
    + '<a href="/bilgi">Bilgi</a><a href="/iletisim">İletişim</a><a href="/sss">Sık sorulan sorular</a>'
    + (o.ekstra || '') + '</body></html>';
};

// =============================================================== TESTLER
(async function () {
  console.log('1) Baseline, confirmation in two reads, alarm lines');
  let t = kur();
  let c = await t.islem({ tip: 'EKLE', ad: 'Konser', url: 'https://ornek.test/konser', aralikSn: 60 });
  await bekle(20);
  const id = c.id;
  ok('izleme eklendi, sekme acildi', !!t.iz(id) && t.iz(id).sekmeId != null, JSON.stringify(c));
  await t.sayfa(id, etkinlikSayfasi());
  ok('taban alindi, izleniyor', t.iz(id).durum === 'izleniyor' && /taban alındı/.test(t.iz(id).ozet), t.iz(id).ozet);
  await t.sayfa(id, etkinlikSayfasi());
  ok('ayni sayfa: alarm yok', t.alarmlar().length === 0 && /öğe izleniyor/.test(t.iz(id).ozet), t.iz(id).ozet);
  await t.sayfa(id, etkinlikSayfasi({ tukendi: false, buton: true }));
  ok('ilk gorulen degisiklik henuz alarm degil (onay bekliyor)', t.alarmlar().length === 0 && /onay bekliyor/.test(t.iz(id).ozet), t.iz(id).ozet);
  await t.sayfa(id, etkinlikSayfasi({ tukendi: false, buton: true }));
  const a1 = t.alarmlar()[0];
  ok('ikinci okumada ALARM', t.alarmlar().length === 1 && t.iz(id).durum === 'degisti');
  ok('alarm satirlari ne degistigini soyluyor', a1 && a1.satirlar.some((s) => /Satın Al/.test(s)), a1 && a1.satirlar.join(' | '));
  ok('alarm yardimciya gonderildi', t.fetchler.some((f) => /\/alarm$/.test(f.u)));

  console.log('2) Direction rule: selling out gives no alarm, "sold out" going away does');
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'Yon', url: 'https://ornek.test/yon', aralikSn: 60 });
  await bekle(20);
  for (const h of [etkinlikSayfasi({ tukendi: false }), etkinlikSayfasi({ tukendi: false })]) await t.sayfa(c.id, h);
  for (const h of [etkinlikSayfasi({ tukendi: true }), etkinlikSayfasi({ tukendi: true })]) await t.sayfa(c.id, h);
  ok('"Satışta" -> "Tükendi": alarm YOK', t.alarmlar().length === 0, JSON.stringify(t.alarmlar().map((a) => a.satirlar)));
  for (const h of [etkinlikSayfasi({ tukendi: false }), etkinlikSayfasi({ tukendi: false })]) await t.sayfa(c.id, h);
  ok('"Tükendi" kalkinca ALARM', t.alarmlar().length === 1, JSON.stringify(t.alarmlar().map((a) => a.satirlar)));

  console.log('3) Closing alarms: false alarm / done / not now; BUY is never muted');
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'Kapat', url: 'https://ornek.test/kapat', aralikSn: 60 });
  await bekle(20);
  await t.sayfa(c.id, etkinlikSayfasi());
  await t.sayfa(c.id, etkinlikSayfasi({ tukendi: false, buton: true }));
  await t.sayfa(c.id, etkinlikSayfasi({ tukendi: false, buton: true }));
  let a = t.alarmlar()[0];
  await t.islem({ tip: 'ALARM_KAPAT', alarmId: a.id, islem: 'yanlis' });
  ok('yanlis alarm: kapandi, izleme devam', t.alarmlar().length === 0 && t.iz(c.id).durum === 'izleniyor');
  ok('"Satın Al" sinyali yoksay listesine GIRMEZ', !(t.iz(c.id).yoksay || []).some((k) => /Satın Al/.test(k)), JSON.stringify(t.iz(c.id).yoksay));
  await t.sayfa(c.id, etkinlikSayfasi());
  await t.sayfa(c.id, etkinlikSayfasi());
  await t.sayfa(c.id, etkinlikSayfasi({ tukendi: false, buton: true }));
  await t.sayfa(c.id, etkinlikSayfasi({ tukendi: false, buton: true }));
  ok('ayni "Satın Al" tekrar gelince yine ALARM', t.alarmlar().length === 1);
  a = t.alarmlar()[0];
  await t.islem({ tip: 'ALARM_KAPAT', alarmId: a.id, islem: 'aldim' });
  ok('bilet aldim: izleme durdu, not yazildi', !t.iz(c.id).aktif && /Tamamlandı/.test(t.iz(c.id).not || ''));
  await t.islem({ tip: 'BASLAT', id: c.id });
  ok('tekrar baslatilabilir', t.iz(c.id).aktif === true);

  console.log('4) Keyword filter');
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'Kelime', url: 'https://ornek.test/k', aralikSn: 60, kelimeler: 'Levski' });
  await bekle(20);
  const macSayfa = (ek) => etkinlikSayfasi({ ekstra: '<ul><li>N.E.C. - Levski Sofia' + (ek ? ' <button>Naar Tweedekans verkoop</button>' : '') + '</li><li>N.E.C. - Fortuna</li></ul>' });
  for (const h of [macSayfa(false), macSayfa(false)]) await t.sayfa(c.id, h);
  await t.sayfa(c.id, macSayfa(false).replace('Fortuna', 'Fortuna Sittard yeni'));
  await t.sayfa(c.id, macSayfa(false).replace('Fortuna', 'Fortuna Sittard yeni'));
  ok('kelime gecmeyen degisiklik alarm vermez', t.alarmlar().length === 0, JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  for (const h of [macSayfa(true), macSayfa(true)]) await t.sayfa(c.id, h);
  ok('kelime gecen degisiklikte ALARM', t.alarmlar().length === 1 && t.alarmlar()[0].satirlar.some((s) => /Levski/.test(s)), JSON.stringify(t.alarmlar().map((x) => x.satirlar)));

  console.log('5) Noise: cookie banners and login windows coming and going give no alarm');
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'Gurultu', url: 'https://ornek.test/g', aralikSn: 60 });
  await bekle(20);
  const cerez = '<div><h2>Çerez Ayarları</h2><button>Tümünü kabul et</button><button>Tercihleri Yönet</button><a href="/cerez">Çerez politikası</a></div>';
  const giris = '<div><button>Close</button><h2>Log in or sign up</h2><button>Continue with Google</button><button>Continue with Apple</button>'
    + '<p>By continuing you agree to our terms and conditions</p><button>Show more</button></div>';
  for (const ek of ['', cerez, '', giris, cerez + giris, '']) { await t.sayfa(c.id, etkinlikSayfasi({ ekstra: ek })); }
  ok('cerez + giris penceresi gurultusu: alarm YOK', t.alarmlar().length === 0, JSON.stringify(t.alarmlar().map((x) => x.satirlar)));

  console.log('6) A "0 available" counter reaching zero gives no alarm, a listing does');
  const TSW = 'https://www.ticketswap.com/sport-tickets/x';
  const tsw = (ilan, bekleyen) => '<html><head><title>TS</title></head><body><h1>IFK - Djurgården</h1>'
    + '<span>' + (ilan ? 1 : 0) + ' available • 0 sold • ' + bekleyen + ' wanted</span><h3>Available</h3>'
    + (ilan ? '<ul><li><a href="/listing/a1">Hisingssidan Stå €28,00</a></li></ul>'
      : '<span>No tickets available right now</span><p>Got tickets to sell? Set up a listing for one of the fans.</p>')
    + '<h3>Trending events</h3><ul><li><a href="/e/1">BC Dubai</a></li><li><a href="/e/2">Abu Dhabi GP</a></li></ul></body></html>';
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'TicketSwap', url: TSW, aralikSn: 180 });
  await bekle(20);
  for (const h of [tsw(false, 12), tsw(false, 12), tsw(false, 13), tsw(false, 15)]) await t.sayfa(c.id, h, TSW);
  ok('bos sayfa (sadece "wanted" sayisi degisir): alarm yok', t.alarmlar().length === 0, JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  for (const h of [tsw(true, 12), tsw(true, 12)]) await t.sayfa(c.id, h, TSW);
  ok('ilan gelince ALARM', t.alarmlar().length === 1, JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  await t.islem({ tip: 'ALARM_KAPAT', alarmId: '*', islem: 'tamam' });
  for (const h of [tsw(false, 12), tsw(false, 12)]) await t.sayfa(c.id, h, TSW);
  ok('ilan satilip sayac sifirlaninca alarm YOK', t.alarmlar().length === 0, JSON.stringify(t.alarmlar().map((x) => x.satirlar)));

  console.log('7) Bot walls: recognized from the content and from the address path');
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'AXS', url: 'https://ifkgoteborg.ebiljett.nu/List/Events', aralikSn: 60 });
  await bekle(20);
  const axs = '<html><head><title>AXS</title></head><body><h1>Ensuring a fair fan experience</h1><p>we actively prevent automated bots from accessing our site.</p></body></html>';
  await t.sayfa(c.id, axs);
  ok('AXS bot sayfasi: taban ALINMADI, sessiz "bot kontrolü"', !t.depo['motor_' + c.id] && t.iz(c.id).durum === 'sorun' && /bot kontrolü/.test(t.iz(c.id).sorun) && t.alarmlar().length === 0, t.iz(c.id).sorun);
  await t.sayfa(c.id, etkinlikSayfasi());
  await t.sayfa(c.id, etkinlikSayfasi());
  ok('gercek sayfa gelince taban alinir, yanlis alarm yok', t.alarmlar().length === 0 && t.iz(c.id).durum === 'izleniyor');
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'TM GR', url: 'https://www.ticketmaster.gr/ornek-sayfa-3', aralikSn: 300 });
  await bekle(20);
  const queueit = '<html><head><title>Queue-it</title></head><body><p>Πριν συνεχίσετε, χρειαζόμαστε μια επιβεβαίωση ότι είστε πραγματικός χρήστης</p><button>Δεν είμαι ρομποτ</button></body></html>';
  await t.sayfa(c.id, queueit, 'https://hd-queue.ticketmaster.gr/softblock/?c=x');
  ok('Queue-it softblock (Yunanca): taban ALINMADI, sessiz uyari', !t.depo['motor_' + c.id] && /bot kontrolü/.test(t.iz(c.id).sorun) && t.alarmlar().length === 0, t.iz(c.id).sorun);
  const gr = (maclar) => '<html><head><title>OSFP</title></head><body><h1>ΕΙΣΙΤΗΡΙΑ ΑΓΩΝΩΝ</h1>'
    + '<p>Καλώς ήρθατε στο επίσημο κατάστημα εισιτηρίων του Ολυμπιακού για τη σεζόν 2026-2027.</p>'
    + '<p>Τα εισιτήρια διατίθενται ηλεκτρονικά και στα φυσικά σημεία πώλησης του συλλόγου.</p><ul>'
    + maclar.map((m, i) => '<li><span>' + m + '</span><span>Στάδιο Ειρήνης και Φιλίας</span><a href="/al/' + i + '">Αγορά εισιτηρίων</a></li>').join('')
    + '</ul><ul><li><a href="/oroi">Όροι χρήσης</a></li><li><a href="/epikoinonia">Επικοινωνία</a></li>'
    + '<li><a href="/erotiseis">Συχνές ερωτήσεις</a></li><li><a href="/politiki">Πολιτική απορρήτου</a></li></ul></body></html>';
  await t.sayfa(c.id, gr(['ΟΜΑΔΑ - ΠΑΝΑΘΗΝΑΪΚΟΣ']), 'https://www.ticketmaster.gr/ornek-sayfa-3');
  await t.sayfa(c.id, gr(['ΟΜΑΔΑ - ΠΑΝΑΘΗΝΑΪΚΟΣ']), 'https://www.ticketmaster.gr/ornek-sayfa-3');
  ok('duvar kalkinca gercek sayfadan taban alinir, yanlis alarm yok', t.alarmlar().length === 0 && t.iz(c.id).durum === 'izleniyor', t.iz(c.id).sorun);
  await t.sayfa(c.id, gr(['ΟΜΑΔΑ - ΠΑΝΑΘΗΝΑΪΚΟΣ', 'ΟΜΑΔΑ - ΜΠΑΡΤΣΕΛΟΝΑ']), 'https://www.ticketmaster.gr/ornek-sayfa-3');
  await t.sayfa(c.id, gr(['ΟΜΑΔΑ - ΠΑΝΑΘΗΝΑΪΚΟΣ', 'ΟΜΑΔΑ - ΜΠΑΡΤΣΕΛΟΝΑ']), 'https://www.ticketmaster.gr/ornek-sayfa-3');
  ok('YENI MAC gelince ALARM, mac adi satirda', t.alarmlar().length === 1 && t.alarmlar()[0].satirlar.some((s) => /ΜΠΑΡΤΣΕΛΟΝΑ/.test(s)), JSON.stringify(t.alarmlar().map((x) => x.satirlar)));

  console.log('8) Problems: empty page, going to another page, queue, unreadable page');
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'Sorun', url: 'https://www.biletix.com/etkinlik/x/TURKIYE/tr', aralikSn: 60 });
  await bekle(20);
  await t.sayfa(c.id, etkinlikSayfasi());
  await t.sayfa(c.id, '<html><body><p>.</p></body></html>');
  ok('birden bosalan sayfa: alarm yok, sorun', t.alarmlar().length === 0 && t.iz(c.id).durum === 'sorun', t.iz(c.id).sorun);
  await t.sayfa(c.id, etkinlikSayfasi());
  ok('sayfa geri gelince yeniden izleniyor', t.iz(c.id).durum === 'izleniyor', t.iz(c.id).sorun);
  const sid = t.iz(c.id).sekmeId;
  t.sekmeler.get(sid).url = 'https://www.biletix.com/giris?return=x';
  await t.tik();
  // 5.25: giris sayfasi "oturum dustu" yazisiyla (alarmi oku() iki okumada bir kez verir; tik sessiz)
  ok('giris sayfasina gitti: SESSIZ sorun (siren yok), oturum uyarisi', t.iz(c.id).durum === 'sorun' && /OTURUM DÜŞMÜŞ/.test(t.iz(c.id).sorun) && t.alarmlar().length === 0, t.iz(c.id).sorun);
  ok('ve izleme sayfasina geri donduruldu', t.sekmeler.get(sid).url === 'https://www.biletix.com/etkinlik/x/TURKIYE/tr');
  t.sekmeler.get(sid).url = 'https://biletix.queue-it.net/?c=biletix';
  await t.tik();
  ok('bekleme sirasina (kuyruk) gitti: ALARM', t.alarmlar().length === 1 && /kuyruk/.test(t.alarmlar()[0].satirlar[0]));
  await t.tik();
  ok('kuyruk alarmi tekrar tekrar calmaz', (t.depo.alarmlar || []).length === 1);

  console.log('9) Even if the "loaded" event never comes, the tick triggers a read (safety net)');
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'Ornek Site', url: 'https://entradas.ornek-sitecf.com/?idioma=EN', aralikSn: 300 });
  await bekle(20);
  const msekme = t.iz(c.id).sekmeId;
  t.sayfalar.set(msekme, { html: etkinlikSayfasi(), url: 'https://entradas.ornek-sitecf.com/?idioma=EN' });
  ok('olay gelmeden okunmamis', t.iz(c.id).durum === 'hazirlaniyor' && !t.iz(c.id).sonKontrol);
  t.depo.izlemeler.find((x) => x.id === c.id).sekmeAcilis = Date.now() - 70000;
  t.sekmeler.get(msekme).pendingUrl = 'https://entradas.ornek-sitecf.com/?idioma=EN'; // kalici "yukleniyor" bile olsa
  await t.tik();
  await bekle(120);
  ok('tik okumayi kendisi tetikledi', t.iz(c.id).durum === 'izleniyor' && !!t.iz(c.id).sonKontrol, t.iz(c.id).durum + ' / ' + t.iz(c.id).ozet);
  const okuma1 = t.iz(c.id).sonKontrol;
  await t.tik();
  await bekle(80);
  ok('taze okunmus izlemede fazladan okuma yapilmaz', t.iz(c.id).sonKontrol === okuma1);

  let r;

  console.log('11) Languages: Norwegian/Swedish/Portuguese "sold out" texts are recognized');
  const GLM = 'https://club-z.ticketco.shop/';
  const glm = (durum) => '<html><head><title>Club Z</title></head><body><ul>'
    + '<li><a href="/e/1"><span>League - Team G - Team H</span><span>Kjøp nå</span></a></li>'
    + '<li><a href="/e/2"><span>UEFA Youth League - Bodø/Club Z - Borussia Dortmund</span><span>' + durum + '</span></a></li>'
    + '</ul></body></html>';
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'Club Z', url: GLM, aralikSn: 60, kelimeler: 'Dortmund, Champions' });
  await bekle(20);
  for (const h of [glm('Kjøp nå'), glm('Kjøp nå')]) await t.sayfa(c.id, h, GLM);
  for (const h of [glm('Utsolgt'), glm('Utsolgt')]) await t.sayfa(c.id, h, GLM);
  ok('Norvecce "Utsolgt" gelince alarm YOK (tükenme)', t.alarmlar().length === 0, JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  for (const h of [glm('Kjøp nå'), glm('Kjøp nå')]) await t.sayfa(c.id, h, GLM);
  ok('"Utsolgt" kalkinca ALARM', t.alarmlar().length === 1, JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  const TKL = 'https://www.ticketline.pt/evento/artist-100006';
  const tkl = (acik) => '<html><head><title>Ticketline</title></head><body><h1>EZHEL</h1><div><span>11 OUT 21:00</span>'
    + '<span>Lav - Lisboa Ao Vivo</span><span>26,84€</span>' + (acik ? '<a href="/comprar/1"><span>COMPRAR</span></a>' : '<span>COMPRAR</span><span>SEM_DISPONIBILIDADE</span>')
    + '</div><p>PROMOTOR PRIME ARTISTS</p><p>Classificação M/06</p></body></html>';
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'Ticketline', url: TKL, aralikSn: 60 });
  await bekle(20);
  for (const h of [tkl(false), tkl(false), tkl(false)]) await t.sayfa(c.id, h, TKL);
  ok('Ulke Ace tükenmis sayfa durgun: alarm yok', t.alarmlar().length === 0, JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  for (const h of [tkl(true), tkl(true)]) await t.sayfa(c.id, h, TKL);
  ok('SEM_DISPONIBILIDADE kalkinca ALARM', t.alarmlar().length === 1, JSON.stringify(t.alarmlar().map((x) => x.satirlar)));

  console.log('11b) Event page: "try again later" going away raises an ALARM');
  // 01.01 Team A - Team B (10000001): sayfada tek dugme "Daha Sonra Tekrar Deneyiniz" yaziyor;
  // bu yazi kalkip satin alma dugmesi gelince haber verilmeli (yazi OLUMSUZ sayilmasa alarm sessiz kalirdi).
  const GSB = 'https://www.passo.com.tr/tr/etkinlik/team-a-team-b-mac-bileti-passo/10000001';
  const gsb = (acik) => '<html><head><title>Team A - Team B | Passo</title></head><body>'
    + '<h1>Team A - Team B</h1><h2>ETKİNLİK DETAYLARI</h2><p>13 Ekim Salı Saat 22:00 — Rams Park</p>'
    + '<p>Team A, UEFA Champions League Match Day-2 maçında Team B ile karşı karşıya gelecektir.</p>'
    + '<p>Kombine bilet sahipleri biletlerini baska bir kisiye aktarabilir.</p>'
    + '<p>Passo Hizmet Bedeli ücrete dahildir. Çağrı Merkezi no: 444 1905</p><h3>Oturma Planı</h3>'
    + '<ul><li>1. Kategori</li><li>2. Kategori</li><li>3. Kategori</li><li>4. Kategori</li><li>Misafir</li></ul>'
    + (acik ? '<button>Bilet Al</button>' : '<button>Daha Sonra Tekrar Deneyiniz</button>')
    + '<h3>ÖNEMLİ BİLGİLENDİRME</h3><p>Stad otoparkı yalnızca sezonluk kart sahiplerine açıktır.</p></body></html>';
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'GS - Team B', url: GSB, aralikSn: 60 });
  await bekle(20);
  for (const h of [gsb(false), gsb(false), gsb(false)]) await t.sayfa(c.id, h, GSB);
  ok('"Daha Sonra Tekrar Deneyiniz" dururken alarm yok', t.alarmlar().length === 0 && t.iz(c.id).durum === 'izleniyor', t.iz(c.id).ozet + ' / ' + t.iz(c.id).sorun);
  for (const h of [gsb(true), gsb(true)]) await t.sayfa(c.id, h, GSB);
  ok('yazi kalkip "Bilet Al" gelince ALARM', t.alarmlar().length === 1 && t.alarmlar()[0].satirlar.some((s) => /Bilet Al|Daha Sonra/.test(s)), JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  await t.islem({ tip: 'ALARM_KAPAT', alarmId: '*', islem: 'tamam' });
  for (const h of [gsb(false), gsb(false)]) await t.sayfa(c.id, h, GSB);
  ok('yazi geri gelince (tekrar tükenme) alarm yok', t.alarmlar().length === 0, JSON.stringify(t.alarmlar().map((x) => x.satirlar)));

  console.log('11c) After a long time off: a stale watch without a tab never looks GREEN');
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'Bayat', url: 'https://ornek.test/bayat', aralikSn: 300 });
  await bekle(20);
  await t.sayfa(c.id, etkinlikSayfasi());
  ok('once izleniyor (yesil)', t.iz(c.id).durum === 'izleniyor', t.iz(c.id).durum);
  // bilgisayar kapali kaldi: sekme kayboldu, son okuma 10 saat once
  await chromeSekmeSil(t, c.id);
  Object.assign(t.depo.izlemeler.find((x) => x.id === c.id), { sonKontrol: Date.now() - 36000e3, sekmeAcilis: Date.now() - 36000e3 });
  await t.tik();
  ok('sekme yeniden acilirken yesil DEGIL (hazirlaniyor)', t.iz(c.id).durum === 'hazirlaniyor', t.iz(c.id).durum + ' / ' + t.iz(c.id).ozet);
  await t.sayfa(c.id, etkinlikSayfasi());
  ok('okununca yine yesil', t.iz(c.id).durum === 'izleniyor', t.iz(c.id).durum);

  console.log('12) Commands (helper queue) and status summary');
  t = kur({ komutlar: [{ tip: 'EKLE', ad: 'Uzaktan eklendi', url: 'https://ornek.test/uzak', aralikSn: 30 }] });
  await t.tik();
  await bekle(20);
  ok('komutla eklenen izleme listede (30 sn)', (t.depo.izlemeler || []).some((x) => x.ad === 'Uzaktan eklendi' && x.aralikSn === 30));
  const ozetIstek = t.fetchler.filter((f) => /\/ozet$/.test(f.u)).pop();
  ok('durum ozeti yardimciya yazildi', !!ozetIstek && JSON.parse(ozetIstek.o.body).izlemeler.length >= 1);
  ok('ozetde kelime/kategori bilgisi de var', !!ozetIstek && 'kelimeler' in JSON.parse(ozetIstek.o.body).izlemeler[0]);

  console.log('13) Alarm on every change');
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'Her degisiklik', url: 'https://ornek.test/h', aralikSn: 60, herDegisiklik: true });
  await bekle(20);
  ok('secenek kaydedildi', t.iz(c.id).herDegisiklik === true);
  for (const h of [etkinlikSayfasi({ tukendi: false }), etkinlikSayfasi({ tukendi: false })]) await t.sayfa(c.id, h);
  for (const h of [etkinlikSayfasi({ tukendi: true }), etkinlikSayfasi({ tukendi: true })]) await t.sayfa(c.id, h);
  ok('"her degisiklik" acikken tukenme de ALARM verir', t.alarmlar().length === 1, JSON.stringify(t.alarmlar().map((x) => x.satirlar)));

  console.log('14) Delete / restore / re-arm');
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'Silinecek', url: 'https://ornek.test/s', aralikSn: 60 });
  await bekle(20);
  await t.sayfa(c.id, etkinlikSayfasi());
  ok('taban var', !!t.depo['motor_' + c.id]);
  await t.islem({ tip: 'NOBET', id: c.id });
  ok('yeniden nobet: taban silindi', !t.depo['motor_' + c.id]);
  await t.islem({ tip: 'SIL', id: c.id });
  ok('silindi ve arsive dustu', !t.iz(c.id) && (t.depo.arsiv || []).some((x) => x.ad === 'Silinecek'));
  await t.islem({ tip: 'GERIAL', id: c.id });
  ok('geri alindi', !!(t.depo.izlemeler || []).find((x) => x.ad === 'Silinecek'));

  console.log('15) Bot wall, late seat map, OneTrust window, "0 No results"');
  const TMUK = 'https://www.ticketmaster.co.uk/artist-london-2026/event/3E00000000000003';
  // 01.01 canli: Claude'un tarayicisina 401/403 ile donen EPS engel sayfasi (adres AYNI kaliyor)
  const eps = '<html><head><noscript><title>Let\'s Get Your Identity Verified</title><div class="c1">Let\'s Get Your Identity Verified</div>'
    + '<div class="c2">Your browser hit a snag and we need to make sure you\'re not a bot.</div><ul class="c3"><li>You were browsing too quickly for our site to catch up.</li>'
    + '<li>You disabled your cookies.</li><li>A third-party browser plugin, such as Ghostery or NoScript, is preventing Javascript from running.</li></ul></noscript>'
    + '<script>function showBlockPage(){document.title="Your Browsing Activity Has Been Paused";}</script><script>window.__EPS_BLOCK_TEMPLATE="";</script>'
    + '<script src="/eps-mgr"></script></head><body><div class="container"><div id="boxes_container"></div></div>'
    + '<abuse-component ip="1.2.3.4" rid="x" action="block" reload="true"></abuse-component></body></html>';
  // Canlida gorulen Turkce OneTrust penceresi (kelime listesine takilmayan baslik/dugmeler)
  const onetrust = '<div id="onetrust-consent-sdk"><div class="onetrust-pc-dark-filter"></div><div id="onetrust-banner-sdk"><div role="dialog">'
    + '<h2>Gizliliğinizi Önemsiyoruz</h2><h3>Veriler, tarafımızca veya ortaklarımız tarafından şu amaçlarla işlenir:</h3>'
    + '<button>İş Ortakları Listesi (satıcılar)</button><button>Kabul ediyorum</button><button>Tümünü Reddet</button><button>Amaçları Göster</button></div></div>'
    + '<div id="onetrust-pc-sdk"><h2>Gizliliğiniz Hakkında</h2><h3>Zorunlu Tanımlama Bilgileri</h3><h3>Performans Tanımlama Bilgileri</h3>'
    + '<h4>Kesin coğrafi konum verilerini kullanmak 41 iş ortakları bu özel özelliği kullanabilir</h4><div><div><button>IAB Satıcıları Listesi</button>'
    + '<button>| Görünümleri Görüntüle</button></div></div><button>Clear</button><button>Apply</button><button>Cancel</button>'
    + '<button>Seçimlerimi Onayla</button><button>Tümüne İzin Ver</button></div></div>';
  const tmuk = (o) => {
    o = o || {};
    const nav = ['/', '/concerts', '/sports', '/arts-theatre', '/family', '/help'].map((h, i) => '<a href="' + h + '">Menü ' + i + '</a>').join('');
    const plan = o.plan === false ? '<div class="loading"></div>'
      : '<div><button>Zoom In</button><button>Zoom Out</button><button>Reset Zoom</button><a href="/artist-tickets/artist/5255622">View other dates</a>'
        + (o.bilet ? '<h2>3 Results</h2><ul><li>Standing - Resale Ticket £85.50</li><li>Standing - Resale Ticket £92.00</li><li>Balcony - Resale Ticket £110.00</li></ul>'
          : '<h2>0 No results</h2>') + '</div>';
    const alt = ['/about', '/careers', '/purchase-policy', '/contact', '/accessibility', '/gift-cards'].map((h, i) => '<li><a href="' + h + '">Alt bağlantı ' + i + '</a></li>').join('');
    return '<html><head><title>Artist Tickets | Ticketmaster UK</title></head><body><header>' + nav + '</header><main><h1>Artist</h1>'
      + '<p>Sun • 18 Oct 2026 • 19:00 — O2 Forum Kentish Town, London</p>' + plan + '</main><footer><ul>' + alt + '</ul>'
      + '<p>© 1999-2026 Ticketmaster. All rights reserved.</p></footer>' + (o.cerez ? onetrust : '') + '</body></html>';
  };
  ok('OneTrust kapsayicisi tamamen kesilir, cevresi kalir', kur().ctx.GENEL_MOTOR.cerezKutusuKes('<p>a</p>' + onetrust + '<p>b</p>') === '<p>a</p><p>b</p>');
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'Artist London', url: TMUK, aralikSn: 60 });
  await bekle(20);
  await t.yukle(c.id, [eps], TMUK);
  ok('EPS engel sayfasi: taban ALINMADI, sessiz "bot kontrolü"', !t.depo['motor_' + c.id] && /bot kontrolü/.test(t.iz(c.id).sorun) && t.alarmlar().length === 0, t.iz(c.id).sorun);
  // ilk yukleme: 1. okumada koltuk plani yok, 2.'de geldi (oge sayisi degisti) -> 3. okuma; son okuma islenir
  await t.yukle(c.id, [tmuk({ plan: false }), tmuk(), tmuk()], TMUK);
  ok('gec dolan sayfa: taban TAM sayfadan alindi', /taban alındı/.test(t.iz(c.id).ozet) && t.iz(c.id).durum === 'izleniyor'
    && Object.keys(t.depo['motor_' + c.id].taban.ids).includes('B|Zoom In'), t.iz(c.id).ozet);
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'Artist London', url: TMUK, aralikSn: 60 });
  await bekle(20);
  // en kotu durum: ilk yuklemenin butun okumalari yarim (canlidaki gibi), sonraki yuklemeler tam + cerez penceresi
  await t.yukle(c.id, [tmuk({ plan: false }), tmuk({ plan: false })], TMUK);
  for (const h of [tmuk({ cerez: true }), tmuk({ cerez: true }), tmuk(), tmuk({ cerez: true }), tmuk(), tmuk()]) await t.yukle(c.id, [h, h], TMUK);
  ok('yarim ilk taban + gelip giden OneTrust: alarm YOK (isinma + cerez kesme)', t.alarmlar().length === 0 && t.iz(c.id).durum === 'izleniyor', JSON.stringify(t.alarmlar().map((x) => x.satirlar)) + ' ' + t.iz(c.id).ozet);
  await t.tik(); // ozet her tikte yardimciya yazilir
  ok('"0 No results" olumsuz durum yazisi olarak ozetde', (() => {
    const o = t.fetchler.filter((f) => /\/ozet$/.test(f.u)).pop();
    const iz = o && JSON.parse(o.o.body).izlemeler.find((x) => x.id === c.id);
    return !!iz && (iz.durumYazilari || []).some((y) => /0 No results/.test(y));
  })());
  for (const h of [tmuk({ bilet: true }), tmuk({ bilet: true, cerez: true })]) await t.yukle(c.id, [h, h], TMUK);
  ok('ikinci el bilet gelince ALARM (fiyatli satirlar)', t.alarmlar().length === 1 && t.alarmlar()[0].satirlar.some((s) => /Resale Ticket £|Results/.test(s)), JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  await t.islem({ tip: 'ALARM_KAPAT', alarmId: '*', islem: 'tamam' });
  for (const h of [tmuk(), tmuk()]) await t.yukle(c.id, [h, h], TMUK);
  ok('biletler gidip "0 No results" donunce alarm yok', t.alarmlar().length === 0, JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  // isinma turu satis acilisini YUTMAZ: ilk tabanda "Sold out" vardi, ikinci yuklemede kalkip bilet geldi
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'Isinma', url: 'https://ornek.test/isinma', aralikSn: 60 });
  await bekle(20);
  await t.sayfa(c.id, etkinlikSayfasi());
  await t.sayfa(c.id, etkinlikSayfasi({ tukendi: false, buton: true }));
  await t.sayfa(c.id, etkinlikSayfasi({ tukendi: false, buton: true }));
  ok('isinma turunda "Tükendi" kalkip "Satın Al" gelirse yine ALARM', t.alarmlar().length === 1, JSON.stringify(t.alarmlar().map((x) => x.satirlar)));

  console.log('16) One warm-up round after a version change: only removals are absorbed; new items and "sold out" going away raise an ALARM');
  const RH = 'https://apps.ticketmatic.com/widgets/venue-x/addtickets?event=10004';
  const rh = (tam, acik) => '<html><head><title>Venue X</title></head><body><h1>Artist Y</h1><p>Venue X, Sample City — 4 December 2026, doors 19:00.</p>'
    + '<p>Tickets are personal and sold via Ticketmatic for Venue X.</p><a href="/info">Info</a><a href="/faq">FAQ</a><a href="/venue">Venue</a>'
    + (tam ? '<h3>Standing - General admission</h3><table><tr><td>Standing - General admission €70,00</td><td>' + (acik ? '<button>+ Add ticket</button>' : '<span>No tickets available</span>') + '</td></tr>'
      + '<tr><td>VIP 1 - LIFE IS BEAUTIFUL VIP Q&amp;A EXPERIENCE €463,00</td><td><span>No tickets available</span></td></tr></table>' : '') + '</body></html>';
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'Venue X', url: RH, aralikSn: 300, herDegisiklik: true });
  await bekle(20);
  // eski surum taban'inda yeni surumun artik okumadigi gurultu ogeleri vardi (ör. cerez kutusu)
  const eskiGurultu = '<div><h3>Gizliliğiniz Hakkında</h3><button>Seçimlerimi Onayla</button><button>Tümüne İzin Ver</button></div>';
  for (const h of [rh(false) + eskiGurultu, rh(false) + eskiGurultu]) await t.sayfa(c.id, h, RH);
  t.ctx.chrome.runtime.getManifest = () => ({ version: 'yeni' });
  await t.X.surumIsinmasi();
  ok('surum degisince taban "surum" isinmasina alindi', t.depo['motor_' + c.id].isinma === 'surum' && t.depo.motorSurum === 'yeni');
  for (const h of [rh(false), rh(false)]) await t.sayfa(c.id, h, RH);
  ok('artik okunmayan ogeler sessizce tabandan dustu: "her degisiklik" acik olsa da alarm YOK', t.alarmlar().length === 0 && !t.depo['motor_' + c.id].isinma, JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  await t.X.surumIsinmasi();
  ok('ayni surumde tekrar isinma yok', !t.depo['motor_' + c.id].isinma);
  for (const h of [rh(true), rh(true)]) await t.sayfa(c.id, h, RH);
  ok('Standing/VIP tablosu belirince ALARM (01.01 canlida bu yanlislikla yutulmustu)', t.alarmlar().length === 1 && t.alarmlar()[0].satirlar.some((s) => /Standing|VIP|No tickets/.test(s)), JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  await t.islem({ tip: 'ALARM_KAPAT', alarmId: '*', islem: 'gec' });
  t.ctx.chrome.runtime.getManifest = () => ({ version: 'daha-yeni' });
  await t.X.surumIsinmasi();
  for (const h of [rh(true, true), rh(true, true)]) await t.sayfa(c.id, h, RH);
  // yeniden nobet sonrasi (ilk isinma): tablo "+ Add ticket" ile gelirse yutulmaz (01.01 canli: VIP 2A €310 boyle yutuldu)
  const t5 = kur();
  const c5 = await t5.islem({ tip: 'EKLE', ad: 'Venue X nobet', url: RH, aralikSn: 300, herDegisiklik: true });
  await bekle(20);
  await t5.sayfa(c5.id, rh(false), RH);
  for (const h of [rh(true, true), rh(true, true)]) await t5.sayfa(c5.id, h, RH);
  ok('ilk isinmada "+ Add ticket" satis sinyali: tabana katilmaz, ALARM', t5.alarmlar().length === 1, JSON.stringify(t5.alarmlar().map((x) => x.satirlar)));
  ok('surum isinmasi sirasinda bile "No tickets available" kalkip "Add ticket" gelince ALARM', t.alarmlar().length === 1 && t.alarmlar()[0].satirlar.some((s) => /Add ticket|No tickets/.test(s)), JSON.stringify(t.alarmlar().map((x) => x.satirlar)));

  console.log('17) Fast mode: a resale ticket raises an ALARM in ONE read');
  // canlida gorulen farklar: "0 No results" + "2 Tickets" + "View other dates"  ->  "1 result for:" + "Verified Resale" + "1 Ticket" + "All Prices"
  const tmr = (o) => {
    o = o || {};
    const nav = ['/', '/concerts', '/sports', '/arts-theatre', '/family', '/help'].map((h, i) => '<a href="' + h + '">Menü ' + i + '</a>').join('');
    const panel = o.ilan
      ? '<button>' + (o.ilan > 1 ? o.ilan + ' Tickets' : '1 Ticket') + '</button><button>All Prices</button><h2>1 result for:</h2><ul><li>Verified Resale</li></ul>'
      : '<button>' + (o.adet || '2 Tickets') + '</button><a href="/artist-tickets/artist/5255622">View other dates</a><h2><span>0 No results</span></h2>';
    return '<html><head><title>Artist | Ticketmaster UK</title></head><body><header>' + nav + '</header><main><h1>Artist</h1>'
      + '<p>Sun • 18 Oct 2026 • 19:00 — London</p><div><button>Zoom In</button><button>Zoom Out</button><button>Reset Zoom</button>' + panel + '</div></main>'
      + '<footer><ul>' + ['/about', '/careers', '/contact', '/accessibility', '/gift-cards'].map((h, i) => '<li><a href="' + h + '">Alt ' + i + '</a></li>').join('') + '</ul></footer></body></html>';
  };
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'Normal mod', url: TMUK, aralikSn: 60 });
  await bekle(20);
  for (const h of [tmr(), tmr(), tmr({ ilan: 1 }), tmr()]) await t.sayfa(c.id, h, TMUK);
  ok('normal mod: tek okumalik ilan alarm VERMEZ (canlidaki kacirma)', t.alarmlar().length === 0);
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'Hizli mod', url: TMUK, aralikSn: 60, hizli: true });
  await bekle(20);
  ok('hizli secenegi kaydedildi', t.iz(c.id).hizli === true);
  for (const h of [tmr(), tmr(), tmr({ adet: '1 Ticket' })]) await t.sayfa(c.id, h, TMUK);
  ok('hizli mod: olumsuz yazi kalkmadan (sadece adet dugmesi) TEK okumada alarm YOK', t.alarmlar().length === 0, JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  await t.sayfa(c.id, tmr(), TMUK);
  await t.sayfa(c.id, tmr({ ilan: 1 }), TMUK);
  ok('hizli mod: "0 No results" kalkip ilan gelince TEK okumada ALARM', t.alarmlar().length === 1 && t.alarmlar()[0].satirlar.some((s) => /Verified Resale|1 result/.test(s)), JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  await t.islem({ tip: 'ALARM_KAPAT', alarmId: '*', islem: 'gec' });
  for (const h of [tmr(), tmr()]) await t.sayfa(c.id, h, TMUK);
  ok('ilan satilinca alarm yok', t.alarmlar().length === 0, JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  await t.sayfa(c.id, tmr({ ilan: 2 }), TMUK);
  ok('yeni ilan gelince yine TEK okumada ALARM', t.alarmlar().length === 1, JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  await t.islem({ tip: 'GUNCELLE', id: c.id, hizli: false });
  ok('hizli mod uzaktan kapatilabilir', t.iz(c.id).hizli === false);

  console.log('18) Account change / lost session gives no alarm, a real opening does');
  // 01.01 canli: ust menude giris yapan hesabin adi ("HESAP SAHİBİ A" -> "HESAP SAHİBİ B") ve sepet ikonu;
  // oturum dusunce ayni yerde tek satirda "GİRİŞ YAP" (/tr/giris) + "ÜYE OL" (/tr/kayitol).
  const PSE = 'https://www.passo.com.tr/tr/etkinlik/team-c-team-d-mac-bileti-passo/10000002';
  const pse = (hesap, acik) => '<html><head><title>Team C - Team D A.Ş | Passo</title></head><body><nav><a href="/tr"><img alt="Passo"></a><ul>'
    + ['futbol-mac-biletleri/4615', 'muzik-konser-festival-biletleri/8615', 'spor-basketbol-etkinlik-mac-biletleri/13615'].map((k, i) => '<li><a href="/tr/kategori/' + k + '"><span>Kategori ' + i + '</span></a></li>').join('')
    + '</ul><ul>' + (hesap
      ? '<li><a href="/tr/hesabim"><span>' + hesap + '</span></a></li><li><a href="/tr/sepet"><i class="icon-basket"></i></a></li>'
      : '<li><a href="/tr/giris">GİRİŞ YAP</a> / <a href="/tr/kayitol">ÜYE OL</a></li>')
    + '<li><a>TR</a><a>EN</a></li></ul></nav><main><h1>Team C - Team D A.Ş</h1><h2>ETKİNLİK DETAYLARI</h2>'
    + '<p>18 Ekim 2026 Saat: 16:00 — Trendyol Süper Lig 8.Hafta, Kocaeli Stadyumu</p><p>Passo Hizmet Bedeli ücrete dahildir.</p>'
    + (acik ? '<button>Bilet Al</button>' : '<button>Daha Sonra Tekrar Deneyiniz</button>') + '</main></body></html>';
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'Passo hesap', url: PSE, aralikSn: 300 });
  await bekle(20);
  for (const h of [pse('HESAP SAHİBİ A'), pse('HESAP SAHİBİ A'), pse(null), pse(null), pse('HESAP SAHİBİ B'), pse('HESAP SAHİBİ B'), pse(null), pse(null)]) await t.sayfa(c.id, h, PSE);
  ok('hesap adi degisimi ve oturum dusmesi: alarm YOK, bekleyen fark yok', t.alarmlar().length === 0 && !/onay bekliyor|DEĞİŞİKLİK/.test(t.iz(c.id).ozet), JSON.stringify(t.alarmlar().map((x) => x.satirlar)) + ' ' + t.iz(c.id).ozet);
  const pTaban = Object.keys(t.depo['motor_' + c.id].taban.ids).concat(Object.keys(t.depo['motor_' + c.id].taban.text)).join(' ');
  ok('hesap adi, sepet, GİRİŞ YAP tabanda yok', !/HESAP SAHİBİ|sepet|GİRİŞ/.test(pTaban), pTaban);
  for (const h of [pse('HESAP SAHİBİ B', true), pse('HESAP SAHİBİ B', true)]) await t.sayfa(c.id, h, PSE);
  ok('"Bilet Al" gelince yine ALARM', t.alarmlar().length === 1 && t.alarmlar()[0].satirlar.some((s) => /Bilet Al|Daha Sonra/.test(s)), JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  const GM = kur().ctx.GENEL_MOTOR;
  ok('buyuk harfli Turkce "GİRİŞ YAP" gurultu sayilir', !Object.keys(GM.represent('<a href="/x">GİRİŞ YAP</a>').text).length);
  ok('satin alma linki hesap/sepet adresinde olsa da SAYILIR', Object.keys(GM.represent('<a href="/tr/sepet">Bilet Al</a>').text).includes('A|Bilet Al'));

  console.log('19) In-between intervals and the detail summary');
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'Aralik', url: 'https://ornek.test/aralik', aralikSn: 150 });
  await bekle(20);
  ok('EKLE 150 sn kabul', t.iz(c.id).aralikSn === 150, String(t.iz(c.id).aralikSn));
  await t.islem({ tip: 'GUNCELLE', id: c.id, aralikSn: 420 });
  ok('GUNCELLE 420 sn (7 dk) kabul', t.iz(c.id).aralikSn === 420);
  await t.islem({ tip: 'GUNCELLE', id: c.id, aralikSn: 45 });
  await t.islem({ tip: 'GUNCELLE', id: c.id, aralikSn: 7200 });
  ok('30 sn katı olmayan / 1 saatten uzun aralik reddedilir', t.iz(c.id).aralikSn === 420);
  await t.sayfa(c.id, etkinlikSayfasi());
  await t.islem({ tip: 'GUNCELLE', id: c.id, detay: true });
  await t.tik();
  const dz = JSON.parse(t.fetchler.filter((f) => /\/ozet$/.test(f.u)).pop().o.body).izlemeler.find((x) => x.id === c.id);
  ok('detay acikken ozet tum anahtarlari (link adresleriyle) verir', Array.isArray(dz.anahtarlar) && dz.anahtarlar.some((k) => /^L\|.*\/sss = Sık sorulan sorular$/.test(k)), JSON.stringify(dz.anahtarlar && dz.anahtarlar.slice(0, 5)));

  console.log('20) Light mode: a tab is open only while reading, closes on problems too (bot wall 15 min), opening speed is limited');
  t = kur({ hafif: true, acmaSiniri: 100 }); // acma hizi siniri asagida ayrica denenir
  c = await t.islem({ tip: 'EKLE', ad: 'Hafif', url: 'https://ornek.test/hafif', aralikSn: 300 });
  await bekle(20);
  const hz = () => t.iz(c.id);
  const hazirla = () => { t.depo.izlemeler.find((x) => x.id === c.id).sonYenileme = 0; };
  ok('zamani gelen izlemeye sekme acildi, pencerede yer tutucu var', hz().sekmeId != null && [...t.sekmeler.values()].some((s) => /waiting\.html$/.test(s.url)));
  ok('sekme bos acilip izleme adresine gonderildi', t.sekmeler.get(hz().sekmeId).url === 'https://ornek.test/hafif');
  await t.sayfa(c.id, etkinlikSayfasi());
  ok('sorunsuz okununca sekme KAPANDI', hz().sekmeId == null && hz().durum === 'izleniyor', JSON.stringify({ s: hz().sekmeId, d: hz().durum }));
  ok('yer tutucu sekme duruyor (pencere kapanmaz)', [...t.sekmeler.values()].some((s) => /waiting\.html$/.test(s.url)));
  await t.tik();
  ok('zamani gelmeden yeniden acilmaz', hz().sekmeId == null);
  hazirla(); await t.tik();
  ok('zamani gelince yeniden acilir', hz().sekmeId != null);
  await t.sayfa(c.id, etkinlikSayfasi());
  for (const h of [etkinlikSayfasi({ tukendi: false, buton: true }), etkinlikSayfasi({ tukendi: false, buton: true })]) { hazirla(); await t.tik(); await t.sayfa(c.id, h); }
  ok('hafif modda da ALARM; sekme kapandi', t.alarmlar().length === 1 && hz().sekmeId == null, JSON.stringify({ a: t.alarmlar().length, s: hz().sekmeId }));
  hazirla(); await t.tik();
  ok('alarmdan sonra (siz bakana kadar) sekme acilmaz', hz().sekmeId == null);
  await t.islem({ tip: 'ALARM_KAPAT', alarmId: '*', islem: 'gec' });
  ok('alarm kapaninca yeniden acilir', hz().sekmeId != null);
  await t.sayfa(c.id, '<html><head><title>Just a moment...</title></head><body><p>Checking your browser before accessing</p></body></html>');
  ok('bot duvari: sekme KAPANIR (RAM), turuncu', hz().sekmeId == null && hz().durum === 'sorun' && hz().botDuvari === true, JSON.stringify({ s: hz().sekmeId, d: hz().durum }));
  t.depo.izlemeler.find((x) => x.id === c.id).sonYenileme = Date.now() - 400e3; // 5 dk'lik aralik doldu
  await t.tik();
  ok('bot duvarinda aralik dolsa da 15 dk beklenir', hz().sekmeId == null);
  await t.islem({ tip: 'SITE_AC', id: c.id });
  ok('kullanici "Ac" deyince 15 dk bekleme kalkar, ama hemen acilmaz (dogrulama suruyor)', hz().botDuvari === false && hz().sekmeId == null, JSON.stringify({ b: hz().botDuvari, s: hz().sekmeId }));
  t.depo.izlemeler.find((x) => x.id === c.id).sonYenileme = Date.now() - 901e3;
  await t.tik();
  ok('sure dolunca yeniden denenir', hz().sekmeId != null);
  await t.sayfa(c.id, etkinlikSayfasi({ tukendi: false, buton: true }));
  ok('duvar kalkip sayfa okununca sekme kapanir', hz().sekmeId == null && hz().durum !== 'sorun' && !hz().botDuvari, hz().durum);
  await t.islem({ tip: 'NOBET', id: c.id });
  ok('sekmesiz izlemede yeniden nobet hemen sekme acar', hz().sekmeId != null);
  t = kur({ hafif: true });
  for (let i = 0; i < 9; i++) await t.X.islem({ tip: 'EKLE', ad: 'E' + i, url: 'https://ornek.test/e' + i, aralikSn: 60 });
  await bekle(50); await t.tik(); await t.tik();
  const acik = t.depo.izlemeler.filter((x) => x.sekmeId != null).length;
  ok('9 izleme ayni anda zamani gelse de 25 sn icinde en fazla 4 sekme acilir', acik >= 1 && acik <= 4, String(acik));
  // sira: en cok geciken once (listenin sonundaki izleme ac kalmasin)
  const t3 = kur({ hafif: true, acmaSiniri: 1 }); // turda tek sekme acilabilsin
  t3.depo.izlemeler = [0, 1, 2, 3].map((i) => ({
    id: 's' + i, ad: 'S' + i, url: 'https://ornek.test/s' + i, aralikSn: 300, aktif: true, durum: 'izleniyor', sorun: '', ozet: '',
    sonYenileme: Date.now() - (i === 3 ? 900e3 : 400e3), sonKontrol: Date.now() - 380e3, sekmeId: null, yoksay: [],
  })); // en cok geciken: listenin SONUNDAKI
  await t3.tik();
  ok('en cok geciken izleme (listede sonda olsa da) once acilir', t3.depo.izlemeler[3].sekmeId != null, JSON.stringify(t3.depo.izlemeler.map((x) => x.sekmeId)));
  // izleme bazinda kalici sekme: hafif modda da sekme acik kalir (Venue X/Ticketmatic)
  const t4 = kur({ hafif: true, acmaSiniri: 100 });
  const c4 = await t4.islem({ tip: 'EKLE', ad: 'Kalici', url: 'https://ornek.test/kalici', aralikSn: 300 });
  await bekle(20);
  await t4.islem({ tip: 'GUNCELLE', id: c4.id, kaliciSekme: true });
  await t4.sayfa(c4.id, etkinlikSayfasi());
  await t4.tik();
  ok('kaliciSekme: okunduktan sonra sekme ACIK kalir', t4.iz(c4.id).kaliciSekme === true && t4.iz(c4.id).sekmeId != null, String(t4.iz(c4.id).sekmeId));
  const bekleyenIz = t.depo.izlemeler.find((x) => x.sekmeId == null);
  Object.assign(bekleyenIz, { durum: 'izleniyor', sonKontrol: Date.now() - 3600e3, ozet: '12 öğe izleniyor' });
  await t.tik();
  ok('sira bekleyen bayat izleme YESIL gorunmez', t.iz(bekleyenIz.id).durum === 'hazirlaniyor', t.iz(bekleyenIz.id).durum);
  // hafif moda geciste eski kalici sekme: okunmus ve yenileme beklemiyorsa hemen kapanir
  t = kur(); // once kalici sekme duzeni
  c = await t.islem({ tip: 'EKLE', ad: 'Eski', url: 'https://ornek.test/eski', aralikSn: 1800 });
  await bekle(20);
  await t.sayfa(c.id, etkinlikSayfasi());
  ok('kalici modda okunan sekme acik kalir', t.iz(c.id).sekmeId != null);
  t.depo.ayarlar.hafifSekme = true;
  await t.tik();
  ok('hafif moda gecince bostaki eski sekme hemen kapanir (30 dk beklemez)', t.iz(c.id).sekmeId == null);

  console.log('21) more.com: event status from JSON, event name in the alarm; a past event dropping from the list gives no alarm');
  const ARIS = 'https://www.more.com/ornek-sayfa-1/';
  const moreSayfa = (maclar) => {
    const veri = {
      events: maclar.map((m, i) => ({ 'book-button-label': m.acik ? 'Εισιτήρια' : 'Sold out', BookBtnText: m.acik ? 'Εισιτήρια' : 'Sold out', day: m.gun, playId: 'p' + i,
        isSoldout: !m.acik, isBookingActive: !!m.acik, inactiveBookingMsg: m.acik ? '' : 'SOLD OUT            ', availability: m.kalan || 0 })),
      plays: maclar.map((m, i) => ({ id: 'p' + i, 'play-title': m.ad + ' ' })),
    };
    return '<html><head><title>ΚΑΕ ΣΥΛΛΟΓΟΣ ΕΙΣΙΤΗΡΙΑ ΑΓΩΝΩΝ</title></head><body><h1>ΚΑΕ ΣΥΛΛΟΓΟΣ ΕΙΣΙΤΗΡΙΑ ΑΓΩΝΩΝ Stoiximan GBL 2026-27</h1>'
      + '<p>Η ΚΑΕ ΣΥΛΛΟΓΟΣ ανακοινώνει ότι ξεκινά η διάθεση των εισιτηρίων για όλους τους εντός έδρας αγώνες.</p>'
      + '<p>Για την αγορά εισιτηρίου αγώνα είναι απαραίτητη η αγορά Κάρτας Φιλάθλου.</p><a href="#tickets">Εισιτήρια</a><a href="/info">Πληροφορίες</a><a href="/help">Βοήθεια</a>'
      + (maclar.some((m) => !m.acik) ? '<div><span>Μία ή περισσότερες ημερομηνίες είναι sold out.</span></div>' : '')
      + maclar.map((m) => '<div><span>' + m.gun + '</span><span>' + m.ad + '</span><a href="https://www.google.com/maps/embed?pb=x">Γρηγορίου Λαμπράκη 2</a>'
        + (m.acik ? '<span>από</span><span>10€</span><a href="javascript:">Εισιτήρια</a>' : '<a href="javascript:">Sold out</a>') + '</div>').join('')
      + '<script>if (bookingPanel) bookingPanel.data = ' + JSON.stringify(veri) + ';</script></body></html>';
  };
  const PAO = { gun: '2026-11-01', ad: 'ΣΥΛΛΟΓΟΣ - ΠΑΝΑΘΗΝΑΪΚΟΣ AKTOR' };
  const OLY = { gun: '2026-11-15', ad: 'ΣΥΛΛΟΓΟΣ - ΟΜΑΔΑ' };
  const VIK = { gun: '2026-12-05', ad: 'ΣΥΛΛΟΓΟΣ - VIKOS FALCONS', acik: true, kalan: 120 };
  const HER = { gun: '2027-01-03', ad: 'ΣΥΛΛΟΓΟΣ - ΗΡΑΚΛΗΣ' };
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'Team F - Team E', url: ARIS, aralikSn: 120, hizli: true });
  await bekle(20);
  for (const h of [moreSayfa([PAO, OLY, VIK, HER]), moreSayfa([PAO, OLY, { ...VIK, kalan: 80 }, HER])]) await t.sayfa(c.id, h, ARIS);
  const mTaban = Object.keys(t.depo['motor_' + c.id].taban.text);
  ok('JSON\'dan mac satirlari okundu, gorunen "Sold out" susturuldu', mTaban.includes('M|ΣΥΛΛΟΓΟΣ - ΟΜΑΔΑ (15/11) — SOLD OUT') && !mTaban.some((k) => /^[AD]\|.*sold out/i.test(k)), mTaban.filter((k) => /^[MAD]\|/.test(k)).join(' · '));
  ok('kalan bilet sayisi degisimi alarm vermez', t.alarmlar().length === 0);
  await t.sayfa(c.id, moreSayfa([PAO, { ...OLY, acik: true, kalan: 300 }, VIK, HER]), ARIS);
  ok('Team E satisa cikinca TEK okumada ALARM, satirda mac adi', t.alarmlar().length === 1 && t.alarmlar()[0].satirlar.some((s) => /ΟΜΑΔΑ \(15\/11\) — ON SALE/.test(s)), JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  await t.islem({ tip: 'ALARM_KAPAT', alarmId: '*', islem: 'gec' });
  for (const h of [moreSayfa([PAO, OLY, VIK, HER]), moreSayfa([PAO, OLY, VIK, HER])]) await t.sayfa(c.id, h, ARIS);
  ok('tekrar tukenince alarm yok', t.alarmlar().length === 0, JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  for (const h of [moreSayfa([OLY, VIK, HER]), moreSayfa([OLY, VIK, HER])]) await t.sayfa(c.id, h, ARIS);
  ok('oynanan (SOLD OUT) mac listeden dusunce alarm YOK', t.alarmlar().length === 0, JSON.stringify(t.alarmlar().map((x) => x.satirlar)));

  console.log('22) Export (full backup) is added to the summary once');
  t = kur({ komutlar: [{ tip: 'DISA_AKTAR' }] });
  c = await t.X.islem({ tip: 'EKLE', ad: 'Yedeklenecek', url: 'https://ornek.test/yedek', aralikSn: 300 });
  await bekle(50); // EKLE'nin baslattigi tur biter (komut o turda alinir)
  await t.tik(); // yedek ozet'e eklenir
  await bekle(20);
  const ozetler = t.fetchler.filter((f) => /\/ozet$/.test(f.u)).map((f) => JSON.parse(f.o.body));
  const yedekli = ozetler.filter((o) => o.disaAktar);
  ok('DISA_AKTAR: ozet\'te tam yedek (izlemeler, alarmlar, arsiv, ayarlar)', yedekli.length === 1 && yedekli[0].disaAktar.izlemeler.some((x) => x.ad === 'Yedeklenecek') && Array.isArray(yedekli[0].disaAktar.alarmlar) && 'arsiv' in yedekli[0].disaAktar && 'ayarlar' in yedekli[0].disaAktar, String(yedekli.length));
  await t.tik();
  ok('yedek sadece bir kez gonderilir', t.fetchler.filter((f) => /\/ozet$/.test(f.u)).map((f) => JSON.parse(f.o.body)).filter((o) => o.disaAktar).length === 1);

  console.log('23) After a Chrome restart, dead tab records do not fill the limit');
  t = kur({ hafif: true, acmaSiniri: 100 });
  t.depo.izlemeler = Array.from({ length: 9 }, (_, i) => ({
    id: 'k' + i, ad: 'K' + i, url: 'https://ornek.test/k' + i, aralikSn: 300, aktif: true, durum: 'izleniyor', sorun: '', ozet: '',
    sonYenileme: Date.now() - 400e3, sonKontrol: Date.now() - 380e3, sekmeId: 9000 + i, yoksay: [], // 9000+ sekmeleri ARTIK YOK
  }));
  await t.tik();
  const yeni = t.depo.izlemeler.filter((x) => x.sekmeId != null && x.sekmeId < 9000).length;
  ok('olu sekme kayitlari temizlendi ve yeni sekmeler acildi (kilitlenme yok)', !t.depo.izlemeler.some((x) => x.sekmeId >= 9000) && yeni >= 1 && yeni <= 6,
    JSON.stringify(t.depo.izlemeler.map((x) => x.sekmeId)));

  console.log('24) Eventim inhouse: alert box, Hebrew, login check, fast alarm');
  const HBS = 'https://club-y.eventim-inhouse.co.il/ornek-sayfa-2?eventId=267';
  const hbs = (o) => {
    o = o || {};
    const ust = o.girisli === false ? '<a href="/webshop/webticket/customerlogin.secure">התחברות</a>'
      : '<ul><li><a href="/webshop/webticket/customereditdetails.secure">HESAP SAHİBİ C</a> את/ה מחובר/ת כ: HESAP SAHİBİ C</li></ul><a href="/webshop/webticket/bye">התנתק</a>';
    const govde = o.acik ? '<h2>בחירת מושבים</h2><ul><li>יציע מזרחי 120 ₪</li><li>יציע מערבי 150 ₪</li></ul><button>הוסף לסל</button>'
      : '<div class="alert alert-warning alert-dismissible" role="alert"><button type="button" class="close"><span>&times;</span></button>'
        + '<strong></strong> אין מידע עבור האירוע או שהמכירה טרם נפתחה</div><a href="' + (o.devam || '/webshop/webticket/shop') + '" class="btn">המשך</a>';
    return '<html><head><title>הפועל באר שבע</title></head><body><nav><a href="/ornek-sayfa-4">כרטיסים</a>'
      + '<a href="/webshop/webticket/serie/series">מנויים</a><a href="/webshop/webticket/coupon">גיפטקארד</a>' + ust + '</nav><main>' + govde + '</main>'
      + '<div id="stm-expired" class="alert alert-warning hidden" role="alert">הדף לא היה פעיל במשך זמן רב</div>'
      + '<div class="modal"><div class="h4 modal-title">הסשן שלך יפוג בקרוב</div></div>'
      + '<footer><p>אליהו נאוי 24 באר שבע</p><p>ראשון - חמישי 9:00-16:00</p><p>*טלפון: 8449</p></footer></body></html>';
  };
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'Club Y - OFI', url: HBS, aralikSn: 30, hizli: true, girisYazisi: 'מחובר/ת כ' });
  await bekle(20);
  for (const h of [hbs(), hbs()]) await t.sayfa(c.id, h, HBS);
  const hTaban = Object.keys(t.depo['motor_' + c.id].taban.text);
  ok('uyari kutusundaki "satis henuz acilmadi" D| olarak okundu, gizli sablon okunmadi',
    hTaban.includes('D|אין מידע עבור האירוע או שהמכירה טרם נפתחה') && !hTaban.some((k) => /לא היה פעיל|הסשן שלך/.test(k)), hTaban.filter((k) => /^D\|/.test(k)).join(' · '));
  ok('Ibranice "טרם נפתחה" olumsuz sayilir', t.X.OLUMSUZ.test('אין מידע עבור האירוע או שהמכירה טרם נפתחה') && t.X.SATIS_SOZ.test('הוסף לסל'));
  // 01.01 canli: "המשך" (devam) dugmesi oturumda son ziyaret edilen sayfaya gidiyor; ayni oturumu kullanan baska izleme
  // (mac listesi) yuzunden hedefi okumadan okumaya degisti -> iki kez ust uste gelse bile alarm vermemeli
  for (const h of [hbs({ devam: '/ornek-sayfa-4' }), hbs({ devam: '/ornek-sayfa-4' }), hbs()]) await t.sayfa(c.id, h, HBS);
  ok('"המשך" dugmesinin hedefi degisince alarm YOK', t.alarmlar().length === 0, JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  const tabanOnce = JSON.stringify(t.depo['motor_' + c.id].taban);
  await t.sayfa(c.id, hbs({ girisli: false }), HBS);
  ok('oturum dustu (1. okuma): turuncu, alarm yok, taban degismedi', t.iz(c.id).durum === 'sorun' && /OTURUM/.test(t.iz(c.id).sorun) && t.alarmlar().length === 0
    && JSON.stringify(t.depo['motor_' + c.id].taban) === tabanOnce, t.iz(c.id).sorun);
  await t.sayfa(c.id, hbs({ girisli: false }), HBS);
  ok('oturum dustu (2. okuma): BIR KEZ alarm, sayfa beklemeye alinmadi', t.alarmlar().length === 1 && /OTURUM DÜŞTÜ/.test(t.alarmlar()[0].satirlar[0]) && !(t.iz(c.id).satinAlmaBekle > Date.now()));
  await t.sayfa(c.id, hbs({ girisli: false }), HBS);
  ok('oturum alarmi tekrar tekrar calmaz', (t.depo.alarmlar || []).length === 1);
  await t.islem({ tip: 'ALARM_KAPAT', alarmId: '*', islem: 'gec' });
  await t.sayfa(c.id, hbs(), HBS);
  ok('giris yapilinca izleme devam eder', t.iz(c.id).durum === 'izleniyor' && !t.iz(c.id).oturumSay, t.iz(c.id).durum);
  await t.sayfa(c.id, hbs({ acik: true }), HBS);
  ok('satis acilinca TEK okumada ALARM (hizli mod)', t.alarmlar().length === 1 && t.alarmlar()[0].satirlar.some((s) => /הוסף לסל|טרם נפתחה|בחירת מושבים/.test(s)), JSON.stringify(t.alarmlar().map((x) => x.satirlar)));

  console.log('25) Redirect to a login page: a lost session even without girisYazisi');
  const NFF = 'https://resale.fotball.no/ornek-sayfa-5?performanceId=10000000000005&checkResaleAvailability=true';
  const NFF_GIRIS = 'https://resale.fotball.no/account/login';
  const nff = (o) => {
    o = o || {};
    const ust = o.giris ? '<a href="/account/login">Log in</a> | <a href="/account/create">Sign up</a>' : '<a href="/account">My account</a><a href="/account/logout">Log out</a>';
    const govde = o.giris
      ? '<h1>Identification</h1><p>Please login or create a new account in order to buy tickets and access our services.</p>'
        + '<form><input name="email"><input type="password" name="password"><button>Continue</button></form><a href="/account/create">Create a new account</a>'
      : o.ilan ? '<h1>Country A - Country B</h1><table><tr><td>Sector B, Row 12, Seat 7</td><td>NOK 650</td></tr></table><button>Add to cart</button>'
        : '<h1>Country A - Country B</h1><p>There are no tickets available on resale for this event at the moment.</p>';
    return '<html><head><title>Norges Fotballforbund</title></head><body><nav><a href="/events">Events</a><a href="/faq">FAQ</a>'
      + '<a href="/hospitality">Hospitality</a>' + ust + '</nav><main>' + govde + '</main>'
      + '<footer><p>© 2025 Norges Fotballforbund.</p><a href="/privacy">Privacy</a></footer></body></html>';
  };
  ok('GIRIS_YOLU: giris adreslerini tanir, normal adresleri tanimaz',
    ['/account/login', '/tr/giris', '/login.aspx', '/webshop/webticket/customerlogin.secure', '/de/anmelden/'].every((y) => t.X.GIRIS_YOLU.test(y))
    && !['/ornek-sayfa-5', '/blog/loginfo', '/catalog-in/x', '/tr/etkinlik/team-c'].some((y) => t.X.GIRIS_YOLU.test(y)));
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'Norvec - Galler', url: NFF, aralikSn: 60, hizli: true });
  await bekle(20);
  await t.sayfa(c.id, nff({ giris: true }), NFF_GIRIS);
  ok('ilk okuma giris sayfasi: taban ALINMADI, gercek adres olmadi, turuncu', !(t.depo['motor_' + c.id] && t.depo['motor_' + c.id].taban)
    && !t.iz(c.id).gercekUrl && t.iz(c.id).durum === 'sorun' && /OTURUM/.test(t.iz(c.id).sorun) && t.alarmlar().length === 0, t.iz(c.id).durum + ' ' + t.iz(c.id).sorun);
  await t.sayfa(c.id, nff({ giris: true }), NFF_GIRIS);
  ok('ikinci okumada da giris sayfasi: BIR KEZ "OTURUM DÜŞTÜ" alarmi', t.alarmlar().length === 1 && /OTURUM DÜŞTÜ/.test(t.alarmlar()[0].satirlar[0]));
  await t.islem({ tip: 'ALARM_KAPAT', alarmId: '*', islem: 'gec' });
  for (const h of [nff(), nff()]) await t.sayfa(c.id, h, NFF);
  ok('giris yapilinca taban alinir, izleniyor', t.iz(c.id).durum === 'izleniyor' && !!t.depo['motor_' + c.id].taban && !t.iz(c.id).oturumSay && t.alarmlar().length === 0, t.iz(c.id).durum);
  // Taban alinmis (gercek adresi olan) izlemede oturum duserse: "baska adres" diye atlanmamali
  await t.sayfa(c.id, nff({ giris: true }), NFF_GIRIS);
  await t.sayfa(c.id, nff({ giris: true }), NFF_GIRIS);
  ok('sonradan oturum duserse yine BIR alarm (atlanmadi), taban bozulmadi', t.alarmlar().length === 1 && /OTURUM DÜŞTÜ/.test(t.alarmlar()[0].satirlar[0])
    && Object.keys(t.depo['motor_' + c.id].taban.text).some((k) => /no tickets available on resale/.test(k)), JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  await t.islem({ tip: 'ALARM_KAPAT', alarmId: '*', islem: 'gec' });
  await t.sayfa(c.id, nff(), NFF);
  await t.sayfa(c.id, nff({ ilan: true }), NFF);
  ok('ikinci el ilan gelince TEK okumada ALARM (hizli mod)', t.alarmlar().length === 1 && t.alarmlar()[0].satirlar.some((s) => /Add to cart|NOK 650|no tickets/.test(s)), JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  // 01.01 canli (girisli, Norvecce): ilan yokken sayfa "Feilside" (hata sayfasi). "…ikke lenger tilgjengelig" yazisi ise HER sayfada
  // gizli sablon olarak duruyor (ana satis sayfasinda da) -> kalkmaz; hizli modun tetigi "Feilside" basliginin kalkmasi olmali.
  ok('Norvecce/Isvecce "artik mevcut degil" ve hata sayfasi basliklari olumsuz sayilir', ['Dessverre er varen du har valgt ikke lenger tilgjengelig.',
    'Varen er ikke længere tilgængelig', 'Biljetten är inte längre tillgänglig', 'Feilside', 'Feilside - Norges Fotballforbund', 'Fehlerseite'].every((s) => t.X.OLUMSUZ.test(s)));
  const nffSablon = '<div class="modal hidden"><p>Dessverre er varen du har valgt ikke lenger tilgjengelig.</p><p>Din bestilling behandles.</p></div>';
  const nffFeil = '<html><head><title>Feilside - Norges Fotballforbund</title></head><body><nav><a href="/account/tickets/resale">Videreselg billetter</a><a href="/account/files">Ordrehistorikk</a></nav>'
    + '<main><h1>Feilside</h1><a href="/">Gjør nye reservasjoner</a></main>' + nffSablon
    + '<footer><a href="https://www.fotball.no/tema/billetter/ofte-stilte-sporsmal/">Ofte stilte spørsmål</a><a href="https://www.supporterklubben.no/">Supporterklubben</a></footer></body></html>';
  const nffIlan = '<html><head><title>Videresalg - Norges Fotballforbund</title></head><body><nav><a href="/account/tickets/resale">Videreselg billetter</a><a href="/account/files">Ordrehistorikk</a></nav>'
    + '<main><h1>Norge - Country B</h1><table><tr><td>Felt B, Rad 12, Sete 7</td><td>NOK 650</td></tr></table><button>Legg i handlekurv</button></main>' + nffSablon
    + '<footer><a href="https://www.fotball.no/tema/billetter/ofte-stilte-sporsmal/">Ofte stilte spørsmål</a><a href="https://www.supporterklubben.no/">Supporterklubben</a></footer></body></html>';
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'Norvec - Galler', url: NFF, aralikSn: 60, hizli: true });
  await bekle(20);
  for (const h of [nffFeil, nffFeil]) await t.sayfa(c.id, h, NFF);
  await t.sayfa(c.id, nffIlan, NFF);
  ok('"Feilside / ikke lenger tilgjengelig" kalkip ilan gelince TEK okumada ALARM', t.alarmlar().length === 1, JSON.stringify(t.alarmlar().map((x) => x.satirlar)));

  console.log('26) A Chrome call that never answers: the clock keeps running, summaries and commands flow, alarms go out');
  // a) cevap donmeyen cagri zaman asimina ugrar, tur diger izlemelerle devam eder
  t = kur({ hafif: true, acmaSiniri: 100, kromMs: 20 });
  t.depo.izlemeler = [0, 1].map((i) => ({
    id: 'k' + i, ad: 'K' + i, url: 'https://ornek.test/k' + i, aralikSn: 300, aktif: true, durum: 'izleniyor', sorun: '', ozet: '',
    sonYenileme: Date.now() - 400e3, sonKontrol: Date.now() - 380e3, sekmeId: i === 0 ? 5555 : null, yoksay: [],
  }));
  const gercekGet = t.ctx.chrome.tabs.get;
  t.ctx.chrome.tabs.get = () => new Promise(() => {}); // hic cevap donmez
  await t.tik();
  ok('cevap donmeyen tabs.get turu durdurmaz: diger izleme okunmaya acildi', t.depo.izlemeler[1].sekmeId != null, JSON.stringify(t.depo.izlemeler.map((x) => x.sekmeId)));
  t.ctx.chrome.tabs.get = gercekGet;
  // b) zaman asimi da kurtarmasa (tur takilirsa): ozet + komut yine akar, sure dolunca yeni tur baslar
  t = kur({ hafif: true, acmaSiniri: 100, kromMs: 100000, tikTakildiMs: 60, komutlar: [{ tip: 'DURAKLAT', id: 'yok' }] });
  t.depo.izlemeler = [{
    id: 'y0', ad: 'Y0', url: 'https://ornek.test/y0', aralikSn: 300, aktif: true, durum: 'izleniyor', sorun: '', ozet: '',
    sonYenileme: Date.now() - 400e3, sonKontrol: Date.now() - 380e3, sekmeId: 5556, yoksay: [],
  }];
  t.ctx.chrome.tabs.get = () => new Promise(() => {});
  t.X.tik(); // takilir, beklenmez
  await bekle(10);
  const ozetSayisi = () => t.fetchler.filter((f) => /\/ozet$/.test(f.u)).length;
  const komutSayisi = () => t.fetchler.filter((f) => /\/komutlar$/.test(f.u)).length;
  const oz0 = ozetSayisi();
  await t.tik();
  ok('tur takiliyken de durum ozeti yazilir ve komut kuyrugu okunur', ozetSayisi() === oz0 + 1 && komutSayisi() >= 1, ozetSayisi() + '/' + komutSayisi());
  t.ctx.chrome.tabs.get = gercekGet;
  await bekle(80);
  const oz1 = ozetSayisi();
  await t.tik();
  ok('takilan tur birakildi, yeni tur calisti', ozetSayisi() === oz1 + 1 && t.iz('y0').sekmeId !== 5556, JSON.stringify(t.iz('y0').sekmeId));
  const sonOzet = JSON.parse(t.fetchler.filter((f) => /\/ozet$/.test(f.u)).pop().o.body);
  ok('ozette takilma sayisi ve aktif izleme sayisi var (aktifSayi ilk alan)', sonOzet.tikTakilma === 1 && Object.keys(sonOzet)[0] === 'aktifSayi' && sonOzet.aktifSayi === 1, JSON.stringify({ t: sonOzet.tikTakilma, k: Object.keys(sonOzet)[0] }));
  // c) takip ekrani acilamasa da alarm yardimciya gider
  t = kur({ kromMs: 20 });
  c = await t.islem({ tip: 'EKLE', ad: 'Alarm', url: 'https://ornek.test/alarm', aralikSn: 60 });
  await bekle(20);
  for (const h of [etkinlikSayfasi(), etkinlikSayfasi()]) await t.sayfa(c.id, h);
  t.ctx.chrome.tabs.create = () => new Promise(() => {});
  for (const h of [etkinlikSayfasi({ tukendi: false, buton: true }), etkinlikSayfasi({ tukendi: false, buton: true })]) await t.sayfa(c.id, h);
  ok('tabs.create cevap donmese de alarm yardimciya gitti', t.fetchler.some((f) => /\/alarm$/.test(f.u)), JSON.stringify(t.fetchler.map((f) => f.u).slice(-4)));
  // d) kuyruk sekmesi acik kalir ama sonsuza kadar degil; diger sorunlarda kapanir
  t = kur({ hafif: true, acmaSiniri: 100 });
  c = await t.islem({ tip: 'EKLE', ad: 'Kuyruk', url: 'https://ornek.test/kuyruk', aralikSn: 300 });
  await bekle(20);
  for (const h of [etkinlikSayfasi(), etkinlikSayfasi()]) { await t.tik(); await t.sayfa(c.id, h); t.depo.izlemeler.find((x) => x.id === c.id).sonYenileme = 0; await bekle(5); }
  await t.tik();
  const ksid = t.iz(c.id).sekmeId;
  t.sekmeler.get(ksid).url = 'https://fpfpt.queue-it.net/ornek-sayfa-6';
  await t.tik();
  ok('kuyruk: bir kez alarm, sekme acik kalir', t.alarmlar().length === 1 && t.iz(c.id).sekmeId === ksid && !!t.iz(c.id).kuyrukBasi, JSON.stringify({ a: t.alarmlar().length, s: t.iz(c.id).sekmeId }));
  await t.islem({ tip: 'ALARM_KAPAT', alarmId: '*', islem: 'gec' });
  t.depo.izlemeler.find((x) => x.id === c.id).kuyrukBasi = Date.now() - 31 * 60e3;
  await t.tik();
  ok('kuyrukta 30 dk takilan sekme izleme adresine geri denenir', t.sekmeler.get(ksid).url === 'https://ornek.test/kuyruk', t.sekmeler.get(ksid).url);
  t = kur({ hafif: true, acmaSiniri: 100 });
  c = await t.islem({ tip: 'EKLE', ad: 'Giris', url: 'https://ornek.test/giris-gerek', aralikSn: 300 });
  await bekle(20);
  await t.sayfa(c.id, etkinlikSayfasi(), 'https://ornek.test/gnfc/accountLogin.html');
  ok('giris sayfasi (accountLogin dahil): sekme kapanir, turuncu', t.iz(c.id).sekmeId == null && /OTURUM/.test(t.iz(c.id).sorun), JSON.stringify({ s: t.iz(c.id).sekmeId, d: t.iz(c.id).sorun }));
  // e) diskte yeni surum varsa kendini yeniden yukler
  t = kur({ diskSurum: 'yeni' });
  await t.tik();
  ok('diskteki surum farkliysa eklenti kendini yeniden yukler', t.ctx.__yenidenYuklendi === true);
  t = kur({ diskSurum: 'test' });
  await t.tik();
  ok('surum ayniysa yeniden yuklenmez', !t.ctx.__yenidenYuklendi);

  ok('DataDome dogrulama sayfasi bot duvari sayilir', t.X.BOT_SAYFASI.test("<script>var dd={'rt':'c','host':'geo.captcha-delivery.com'}</script>"));
  console.log('27) While the app runs the extension sleeps (no double alarms); if the app dies it wakes up. Closing all alarms');
  t = kur({ hafif: true, acmaSiniri: 100, miniAcik: true });
  t.depo.izlemeler = [0, 1].map((i) => ({
    id: 'u' + i, ad: 'U' + i, url: 'https://ornek.test/u' + i, aralikSn: 300, aktif: true, durum: 'izleniyor', sorun: '', ozet: '',
    sonYenileme: Date.now() - 400e3, sonKontrol: Date.now() - 380e3, sekmeId: null, yoksay: [],
  }));
  await t.tik();
  ok('mini varken eklenti sekme acmaz', t.depo.izlemeler.every((x) => x.sekmeId == null) && t.sekmeler.size === 0, JSON.stringify([...t.sekmeler.values()]));
  t.sekmeler.set(777, { id: 777, windowId: 1, url: 'https://ornek.test/u0' });
  t.depo.izlemeler[0].sekmeId = 777;
  t.depo.pencereId = 1;
  await t.tik();
  ok('uyurken acik izleme sekmesi ve pencere sekmeleri kapanir', !t.sekmeler.has(777) && t.depo.izlemeler[0].sekmeId == null, JSON.stringify([...t.sekmeler.keys()]));
  t = kur({ hafif: true, acmaSiniri: 100, miniAcik: false });
  t.depo.izlemeler = [{ id: 'u9', ad: 'U9', url: 'https://ornek.test/u9', aralikSn: 300, aktif: true, durum: 'izleniyor', sorun: '', ozet: '', sonYenileme: Date.now() - 400e3, sonKontrol: Date.now() - 380e3, sekmeId: null, yoksay: [] }];
  await t.tik();
  ok('mini dusunce eklenti kendiliginden okumaya devam eder', t.iz('u9').sekmeId != null);
  t = kur({ hafif: true, acmaSiniri: 100 });
  t.depo.izlemeler = [0, 1].map((i) => ({ id: 'a' + i, ad: 'A' + i, url: 'https://ornek.test/a' + i, aralikSn: 300, aktif: false, durum: 'degisti', sorun: '', ozet: '', satinAlmaBekle: Date.now() + 1e6, yoksay: [] }));
  t.depo.alarmlar = [0, 1].map((i) => ({ id: 'al' + i, izId: 'a' + i, ad: 'A' + i, url: '', zaman: '', satirlar: [], anahtarlar: ['A|x' + i], durum: 'yeni' }));
  await t.X.alarmKapat('*', 'gec');
  ok('"*" ile kapatma butun izlemelerin beklemesini kaldirir', t.iz('a0').satinAlmaBekle === 0 && t.iz('a1').satinAlmaBekle === 0, JSON.stringify([t.iz('a0').satinAlmaBekle, t.iz('a1').satinAlmaBekle]));
  await t.X.alarmKapat('al0', 'yanlis');
  ok('"yanlis" sadece o izlemenin anahtarlarini yoksayar', (t.iz('a0').yoksay || []).includes('A|x0') && !(t.iz('a1').yoksay || []).includes('A|x0'), JSON.stringify(t.iz('a0').yoksay));

  console.log('28) Mixed reading: the app leaves sites that refuse its reader to the extension');
  const karmaIz = (id, ek) => ({ id, ad: id, url: 'https://ornek.test/' + id, aralikSn: 300, aktif: true, durum: 'hazirlaniyor', sorun: '', ozet: '', sonYenileme: 0, sonKontrol: 0, sekmeId: null, yoksay: [], ...ek });
  ok('"Unable to verify" dogrulama sayfasi bot duvari sayilir (taban alinmaz)', t.X.BOT_SAYFASI.test('<p>Verifying</p><p>⚠️ Unable to verify.</p><p>JavaScript is required.</p>'));
  t = kur({ hafif: true, acmaSiniri: 100, miniAcik: true, miniIzlemeler: [{ id: 'nff', okuyucu: 'eklenti' }, { id: 'ornek-iz', okuyucu: '' }] });
  t.depo.izlemeler = [karmaIz('nff'), karmaIz('ornek-iz')];
  await t.tik();
  ok('eklenti: sadece kendisine birakilan izlemeyi okur', t.iz('nff').sekmeId != null && t.iz('ornek-iz').sekmeId == null, JSON.stringify([t.iz('nff').sekmeId, t.iz('ornek-iz').sekmeId]));
  t.sekmeler.set(888, { id: 888, windowId: 1, url: 'https://ornek.test/ornek-iz' });
  t.iz('ornek-iz').sekmeId = 888;
  await t.tik();
  ok('eklenti: mini\'nin okudugu izlemenin sekmesi kapanir, kendi sekmesi kalir', !t.sekmeler.has(888) && t.iz('nff').sekmeId != null, JSON.stringify([...t.sekmeler.keys()]));
  t = kur({ hafif: true, acmaSiniri: 100, mini: true });
  t.depo.izlemeler = [karmaIz('nff', { okuyucu: 'eklenti' }), karmaIz('ornek-iz')];
  await t.tik();
  ok('mini: eklentiye birakilan izlemeye sekme acmaz, digerini okur', t.iz('nff').sekmeId == null && t.iz('ornek-iz').sekmeId != null, JSON.stringify([t.iz('nff').sekmeId, t.iz('ornek-iz').sekmeId]));
  await t.X.uzakDurum({ zaman: new Date().toISOString(), izlemeler: [{ id: 'nff', durum: 'izleniyor', sorun: '', ozet: '172 öğe izleniyor', sonKontrolSn: 10 }] });
  ok('mini: eklenti calisiyorsa son durumu ekranda gorunur', t.iz('nff').durum === 'izleniyor' && /172/.test(t.iz('nff').ozet) && Date.now() - t.iz('nff').sonKontrol < 15000, JSON.stringify(t.iz('nff')));
  ok('mini: digerine dokunulmaz', t.iz('ornek-iz').ozet === '', t.iz('ornek-iz').ozet);
  await t.X.uzakDurum({ zaman: new Date(Date.now() - 600e3).toISOString(), izlemeler: [{ id: 'nff', durum: 'izleniyor', sonKontrolSn: 10 }] });
  ok('mini: eklenti ozeti bayatsa izleme yesil gorunmez', t.iz('nff').durum === 'sorun' && /OKUNMUYOR/.test(t.iz('nff').sorun), t.iz('nff').sorun);
  await t.X.uzakDurum({ ok: false });
  ok('mini: eklenti hic yoksa da turuncu', t.iz('nff').durum === 'sorun', t.iz('nff').durum);
  await t.X.islem({ tip: 'GUNCELLE', id: 'ornek-iz', okuyucu: 'bilinmeyen' });
  ok('gecersiz okuyucu kabul edilmez', t.iz('ornek-iz').okuyucu === '', t.iz('ornek-iz').okuyucu);
  await t.X.islem({ tip: 'GUNCELLE', id: 'ornek-iz', okuyucu: 'eklenti' });
  ok('okuyucu eklentiye alinabilir', t.iz('ornek-iz').okuyucu === 'eklenti');

  console.log('30) Interface language: English by default, Turkish by setting; baseline keys do not depend on the language');
  {
    const en = kur({ dil: 'en' });
    const ce = await en.islem({ tip: 'EKLE', ad: 'Page', url: 'https://ornek.test/en', aralikSn: 60 });
    await en.sayfa(ce.id, etkinlikSayfasi());
    await en.sayfa(ce.id, etkinlikSayfasi());
    ok('English summary while watching', /watching \d+ items/.test(en.iz(ce.id).ozet), en.iz(ce.id).ozet);
    await en.sayfa(ce.id, etkinlikSayfasi({ tukendi: false, buton: true }));
    await en.sayfa(ce.id, etkinlikSayfasi({ tukendi: false, buton: true }));
    const al = en.alarmlar()[0];
    ok('English alarm lines', !!al && al.satirlar.some((x) => /^\+ added — /.test(x)) && !al.satirlar.some((x) => /eklendi|kaldırıldı/.test(x)), JSON.stringify(al && al.satirlar));
    const tabanEn = JSON.stringify(en.depo['motor_' + ce.id].taban);
    let hata = await en.X.islem({ tip: 'EKLE', ad: 'x', url: 'yok' });
    ok('English error text', /Invalid address/.test(hata.hata), hata.hata);
    await en.X.islem({ tip: 'AYAR', ayarlar: { dil: 'tr' } });
    hata = await en.X.islem({ tip: 'EKLE', ad: 'x', url: 'yok' });
    ok('the setting switches to Turkish', /Adres geçersiz/.test(hata.hata), hata.hata);
    const liste = await en.X.islem({ tip: 'LISTE' });
    ok('the list reports the language in use', liste.dil === 'tr' && liste.ayarlar.dil === 'tr');
    await en.sayfa(ce.id, etkinlikSayfasi({ tukendi: false, buton: true }));
    ok('the baseline does not change with the language', JSON.stringify(en.depo['motor_' + ce.id].taban) === tabanEn);
    await en.X.islem({ tip: 'AYAR', ayarlar: { dil: '' } });
    ok('automatic goes back to the system language', (await en.X.islem({ tip: 'LISTE' })).dil === 'en');
  }

  console.log('29) False alarms: a Ketch privacy window changing language; a FAQ block coming and going');
  const ketch = (baslik, dugme) => '<div id="lanyard_root"><div class="root__A7aXF"><div id="ketch-banner"><div id="ketch-consent-banner" role="dialog" aria-modal="true"><h3 id="banner-title">' + baslik + '</h3><p>Bu site verilerinizi işler, seçim yapabilirsiniz.</p><button disabled>' + dugme + '</button><button>Onayla</button></div></div></div></div>';
  const G_TR = ketch('Gizlilik seçimleriniz', 'Tümünü reddet');
  const G_EN = ketch('Your Privacy Choices', 'Reject All');
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'Biletix', url: 'https://ornek.test/b', aralikSn: 60, kelimeler: 'Ebru' });
  await bekle(20);
  for (const p of [G_TR, G_TR, G_EN, G_EN, '', '', G_TR, G_TR]) await t.sayfa(c.id, etkinlikSayfasi({ ekstra: p }));
  ok('Ketch penceresi dil degistirince ya da gelip gidince alarm YOK (kelime filtresini de asmaz)', t.alarmlar().length === 0, JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  await t.sayfa(c.id, etkinlikSayfasi({ tukendi: false, ekstra: G_EN }));
  await t.sayfa(c.id, etkinlikSayfasi({ tukendi: false, ekstra: G_EN }));
  ok('pencere dururken gercek acilis (Tükendi kalkti) yine ALARM', t.alarmlar().length === 1, JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  const Gm = t.ctx.GENEL_MOTOR;
  const cipl = '<div><h3>Your Privacy Choices</h3><h3>Gizlilik seçimleriniz</h3><button disabled>Tümünü reddet</button></div>';
  const cr = Gm.represent(etkinlikSayfasi({ ekstra: cipl }));
  ok('bilinmeyen kapsayicida da bu yazilar gurultu', !cr.text['H|Your Privacy Choices'] && !cr.text['H|Gizlilik seçimleriniz'] && !cr.ids['B|Tümünü reddet|soluk'], JSON.stringify(Object.keys(cr.ids)));

  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'Biletix eski taban', url: 'https://ornek.test/b2', aralikSn: 60 });
  await bekle(20);
  await t.sayfa(c.id, etkinlikSayfasi());
  await t.sayfa(c.id, etkinlikSayfasi());
  const mot = t.depo['motor_' + c.id];
  mot.taban.ids['B|Tümünü reddet|soluk'] = 1;
  mot.taban.text['H|Gizlilik seçimleriniz'] = 1;
  mot.isinma = 'surum';
  await t.sayfa(c.id, etkinlikSayfasi());
  await t.sayfa(c.id, etkinlikSayfasi());
  await t.sayfa(c.id, etkinlikSayfasi());
  ok('yeni surumde tabandaki eski gizlilik dugmesi (soluk) "kalkti" alarmi vermez', t.alarmlar().length === 0 && !t.depo['motor_' + c.id].taban.ids['B|Tümünü reddet|soluk'], JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  const mot2 = t.depo['motor_' + c.id];
  mot2.isinma = 'surum';
  mot2.taban.ids['B|Bilet Al|soluk'] = 1;
  await t.sayfa(c.id, etkinlikSayfasi());
  await t.sayfa(c.id, etkinlikSayfasi());
  ok('gurultu olmayan soluk dugmenin kalkmasi surum isinmasinda yine yutulmaz', t.alarmlar().length === 1, JSON.stringify(t.depo['motor_' + c.id].taban.ids));

  const sss = (soru, cevap) => '<div class="categoryFAQOuter"><div id="categoryFAQContainer"><div class="faq-item"><h2 class="faq-question">' + soru + '</h2><div id="faq-answer-1" class="faq-answer-container"><p class="faq-answer">' + cevap + ' <a href="https://help.ornek.test/x">Yardım</a></p></div></div></div></div>';
  const S_EN = sss('Can I buy tickets?', 'Yes, complete the transfer. Tickets may be sold out.');
  const S_GR = sss('Μπορώ να αγοράσω εισιτήρια;', 'Ναι, αγορά online.');
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'TM GR', url: 'https://ornek.test/s', aralikSn: 60, herDegisiklik: true });
  await bekle(20);
  for (const p of [S_EN, S_EN, '', '', S_GR, S_GR, S_EN, S_EN]) await t.sayfa(c.id, etkinlikSayfasi({ ekstra: p }));
  ok('"her degisiklik" izlemesinde SSS blogu gelip gidince / dil degisince alarm YOK', t.alarmlar().length === 0, JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  const yeniMac = '<a href="/mac/1">Ulke B - Gürcistan</a>';
  await t.sayfa(c.id, etkinlikSayfasi({ ekstra: yeniMac + S_GR }));
  await t.sayfa(c.id, etkinlikSayfasi({ ekstra: yeniMac + S_GR }));
  const macAlarm = t.alarmlar();
  ok('ayni anda yeni mac eklenince ALARM, satirlarda sadece mac', macAlarm.length === 1 && /Gürcistan/.test(macAlarm[0].satirlar.join(' ')) && !/Μπορώ|Yardım/.test(macAlarm[0].satirlar.join(' ')), JSON.stringify(macAlarm.map((x) => x.satirlar)));
  const dolgu = '<p>' + 'Etkinlik bilgisi ve salon açıklaması uzun uzun yazılır. '.repeat(20) + '</p>';
  const ic = Gm.represent('<html><body>' + dolgu + '<section class="faq"><section><h2>İç soru?</h2></section><h2>Dış soru?</h2></section><h2>Sonraki başlık</h2></body></html>');
  ok('ic ice bolumler dogru kesilir, bloktan sonrasi okunur', !ic.text['H|İç soru?'] && !ic.text['H|Dış soru?'] && ic.text['H|Sonraki başlık'] === 1, JSON.stringify(Object.keys(ic.text)));
  const satisli = '<html><body>' + dolgu + '<div class="ticket-faq"><h2>Bilet</h2><a href="/al">Bilet Al</a></div></body></html>';
  ok('icinde "Bilet Al" linki olan kutu kesilmez', Gm.sssKutusuKes(satisli) === satisli);
  const tablolu = '<html><body>' + dolgu + '<div class="faq-tickets"><table><tr><td>Kategori 1</td></tr></table></div></body></html>';
  ok('icinde tablo olan kutu kesilmez', Gm.sssKutusuKes(tablolu) === tablolu);
  const sorulu = '<html><body>' + dolgu + '<div class="faq"><button>Nereden bilet al?</button><p>Gişeden.</p></div></body></html>';
  ok('soru bicimli "bilet al" dugmesi satis ogesi sayilmaz, kutu kesilir', Gm.sssKutusuKes(sorulu) !== sorulu);
  const sssSayfasi = '<html><body><h1>Yardım</h1><div class="faq-list"><h2>Satış ne zaman başlıyor?</h2><p>' + 'Satış tarihi burada duyurulur, takipte kalın. '.repeat(20) + '</p></div></body></html>';
  ok('sayfanin cogu SSS ise (izlenen sayfanin kendisi) kesilmez', Gm.sssKutusuKes(sssSayfasi) === sssSayfasi);
  const sssBaslik = (baslik, h1) => '<html><head><title>' + baslik + '</title></head><body><h1>' + h1 + '</h1>' + dolgu + '<div class="faq-list"><h2>Satış ne zaman?</h2><p>Duyurulacak.</p></div></body></html>';
  ok('basligi SSS diyen sayfada, kutu kucuk de olsa kesilmez', Gm.sssKutusuKes(sssBaslik('Sıkça Sorulan Sorular | Kulüp', 'Bilet')) === sssBaslik('Sıkça Sorulan Sorular | Kulüp', 'Bilet'));
  ok('h1 SSS diyorsa da kesilmez', Gm.sssKutusuKes(sssBaslik('Kulüp', 'Συχνές Ερωτήσεις')) === sssBaslik('Kulüp', 'Συχνές Ερωτήσεις'));
  const yariyariSss = '<html><head><title>Maçlar</title></head><body><h1>Maçlar</h1><p>' + 'Ulke B - Gürcistan 12 Kasım. '.repeat(15) + '</p><div class="faq-list"><h2>Bilet nasıl alınır?</h2><p>' + 'Bilet satışı internetten yapılır. '.repeat(25) + '</p></div></body></html>';
  ok('SSS sayfanin yarisindan cok olsa da (TM GR %47) sayfa baska bir seyin sayfasiysa kesilir', Gm.sssKutusuKes(yariyariSss) !== yariyariSss && !Gm.represent(yariyariSss).text['H|Bilet nasıl alınır?']);
  const kendiH1 = '<html><head><title>Maçlar</title></head><body>' + dolgu + '<div class="faq"><h1>Sıkça Sorulan Sorular</h1><p>Cevap.</p></div></body></html>';
  ok('SSS kutusunun kendi h1\'i sayfayi SSS sayfasi yapmaz', Gm.sssKutusuKes(kendiH1) !== kendiH1);
  const kodlu = '<html><body>' + dolgu + '<div class="sar"><div class="faq"><script type="application/ld+json">{"a":"<div>"}</script><!-- <div> --><h2>Soru var mı?</h2></div><h2>Kutudan sonra</h2><a href="/mac/2">Yeni maç</a></div></body></html>';
  const kodluR = Gm.represent(kodlu);
  ok('kutu icindeki betik/yorumda gecen <div> kesimi kutunun disina tasirmaz', !kodluR.text['H|Soru var mı?'] && kodluR.text['H|Kutudan sonra'] === 1 && kodluR.ids['L|/mac/2'] === 1, JSON.stringify(Object.keys(kodluR.text)));
  const betikte = '<html><body>' + dolgu + '<script>var s = \'<div class="faq">\';</script><h2>Betikten sonra</h2><div><p>x</p></div></body></html>';
  ok('betik icindeki SSS yazisi kutu sayilmaz', Gm.sssKutusuKes(betikte) === betikte && Gm.represent(betikte).text['H|Betikten sonra'] === 1);
  const coklu = '<html><body>' + dolgu + '<h2>Korunan</h2>' + '<div class="faq-item"><h3>S?</h3><p>Cevap yazısı.</p></div>'.repeat(12) + '</body></html>';
  ok('kapsayicisiz 12 SSS ogesinin hepsi kesilir', !/faq-item/.test(Gm.sssKutusuKes(coklu)) && /Korunan/.test(Gm.sssKutusuKes(coklu)));
  const sinifsiz = '<html><body>' + dolgu + '<div class="faqir"><a href="/x">x</a></div><div class="bassss"><h2>Korunur</h2></div></body></html>';
  ok('"sss" sadece tam kelimeyse sayilir', Gm.represent(sinifsiz).text['H|Korunur'] === 1);

  console.log('31) False alarms seen in real use: logging in and out, an empty cart widget, a help link. The session warning stays');
  const HESAP_URL = 'https://bilet.ornek.test/shop/etkinlikler';
  const hesapMenu = (girisli) => (girisli
    ? '<ul><li><a href="/shop/myaccount/accountoverview.secure">כניסה לתיק לקוח</a></li>'
      + '<li><a href="/shop/customereditdetails.secure">Test User</a></li><li><a href="/shop/bye">התנתק</a></li>'
      + '<li><a href="#">Test User</a></li><li>Test User את/ה מחובר/ת כ: Test User כניסה לתיק לקוח</li></ul><h4>Test User</h4>'
    : '<ul><li><a href="/shop/customerlogin.secure?eventId=5">התחברות</a></li></ul>');
  const hesapCerez = '<div id="site-bar"><h5>הגדרת קבצי עוגיה</h5><p>אנו משתמשים בטכנולוגיות כגון קוקיז לצורך שיפור חוויית השימוש</p>'
    + '<a href="/campaign/data-protection">הצהרת הגנת נתונים</a><button>קבלו הכל</button><button>מובן</button><button>תצורה</button><button>אשרו בחירה</button></div>';
  const uzunMetin = '<p>' + 'Etkinlik bilgisi uzun uzun yazılır. '.repeat(12) + '</p>';
  const hesapSayfa = (o) => '<html><head><title>Etkinlikler</title></head><body><nav>' + hesapMenu(o.girisli) + '</nav>' + (o.cerez ? hesapCerez : '')
    + '<main><h1>Team A - Team B</h1><a href="/shop/etkinlik/7">Detay</a>' + uzunMetin + (o.acik ? '<button>הוסף לסל</button>' : '<p>טרם נפתח</p>') + '</main></body></html>';
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'Hesap menusu', url: HESAP_URL, aralikSn: 300, herDegisiklik: true });
  await bekle(20);
  for (const o of [{ cerez: true }, { cerez: true }, { girisli: true }, { girisli: true }, { girisli: true }]) await t.sayfa(c.id, hesapSayfa(o), HESAP_URL);
  ok('logging in and accepting the cookie box: no alarm, nothing pending', t.alarmlar().length === 0 && !/onay bekliyor|DEĞİŞİKLİK/.test(t.iz(c.id).ozet), JSON.stringify(t.alarmlar().map((x) => x.satirlar)) + ' ' + t.iz(c.id).ozet);
  const hesapTaban = Object.keys(t.depo['motor_' + c.id].taban.ids).concat(Object.keys(t.depo['motor_' + c.id].taban.text)).join(' ');
  ok('account name, account links and cookie box are not in the baseline', !/Test User|התחברות|התנתק|קבלו הכל|מובן|data-protection|accountoverview|customerlogin|קוקיז/.test(hesapTaban), hesapTaban);
  ok('the page was noticed as logged in', t.iz(c.id).girisliydi === true);
  await t.sayfa(c.id, hesapSayfa({}), HESAP_URL);
  ok('logged out, first read: no alarm yet', t.alarmlar().length === 0);
  await t.sayfa(c.id, hesapSayfa({}), HESAP_URL);
  ok('logged out, second read: ONE session alarm, the page is not put on hold', t.alarmlar().length === 1 && /OTURUM DÜŞTÜ/.test(t.alarmlar()[0].satirlar[0]) && !(t.iz(c.id).satinAlmaBekle > Date.now()), JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  await t.sayfa(c.id, hesapSayfa({}), HESAP_URL);
  ok('the session alarm does not repeat', (t.depo.alarmlar || []).length === 1);
  await t.islem({ tip: 'ALARM_KAPAT', alarmId: '*', islem: 'gec' });
  for (const o of [{ girisli: true }, { girisli: true }]) await t.sayfa(c.id, hesapSayfa(o), HESAP_URL);
  ok('logging back in: no alarm', t.alarmlar().length === 0, JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  for (const o of [{ girisli: true, acik: true }, { girisli: true, acik: true }]) await t.sayfa(c.id, hesapSayfa(o), HESAP_URL);
  ok('a sale opening still rings', t.alarmlar().length === 1 && t.alarmlar()[0].satirlar.some((s) => /הוסף לסל/.test(s)), JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'Acik sayfa', url: HESAP_URL, aralikSn: 300 });
  await bekle(20);
  for (const o of [{}, {}, {}, {}]) await t.sayfa(c.id, hesapSayfa(o), HESAP_URL);
  ok('a page never read logged in gets no session alarm', t.alarmlar().length === 0 && !t.iz(c.id).girisliydi);

  const DUKKAN = 'https://dukkan.ornek.test/tickets';
  const dukkan = (o) => '<html><head><title>Shop</title></head><body><nav><a href="/tickets">Tickets</a><a href="/fans">Fans</a>'
    + (o.sepet ? '<a href="#" class="cart">0 / € 0,00</a><a href="#" class="wish">0</a><h3>Warenkorb</h3><h3>Wunschliste</h3>' : '')
    + (o.yardim ? '<a href="https://help.ornek.test/hc/el">Βοήθεια</a>' : '')
    + '</nav><main><h1>Team A - Team B</h1>' + uzunMetin + (o.acik ? '<button>In den Warenkorb</button>' : '') + '</main></body></html>';
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'Dukkan', url: DUKKAN, aralikSn: 300, herDegisiklik: true });
  await bekle(20);
  for (const o of [{}, {}, { sepet: true }, { sepet: true }, { sepet: true, yardim: true }, { sepet: true, yardim: true }, {}, {}]) await t.sayfa(c.id, dukkan(o), DUKKAN);
  ok('an empty cart widget and a help link coming and going: no alarm', t.alarmlar().length === 0, JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  for (const o of [{ acik: true }, { acik: true }]) await t.sayfa(c.id, dukkan(o), DUKKAN);
  ok('"In den Warenkorb" still rings', t.alarmlar().length === 1 && t.alarmlar()[0].satirlar.some((s) => /In den Warenkorb/.test(s)), JSON.stringify(t.alarmlar().map((x) => x.satirlar)));

  const linkAnahtari = (html) => { const r = Gm.represent(html); return Object.keys(r.ids).concat(Object.keys(r.text)).filter((k) => /^[AL]\|/.test(k)); };
  const menuLinki = (y) => '<a href="' + y + '">Menu item</a>';
  ok('account addresses with file endings and longer names are menu links', ['/login.aspx', '/shop/customerlogin.secure?eventId=5', '/shop/myaccount/overview.do', '/cart.php', '/user-logout', '/wishlist', '/account-overview'].every((y) => !linkAnahtari(menuLinki(y)).length));
  ok('addresses that only look like it stay', ['/event/login-lounge', '/account/tickets/resale', '/shop/7', '/blog/cart-wheels', '/byebye'].every((y) => linkAnahtari(menuLinki(y)).includes('A|Menu item')));
  ok('a sale link on an account address still counts', linkAnahtari('<a href="/login.aspx">Buy tickets</a>').includes('A|Buy tickets'));
  const satirlar = (html) => Object.keys(Gm.represent(html + uzunMetin).text).filter((k) => /^S\|/.test(k));
  ok('two account texts in a short row: a menu row', !satirlar('<a href="/my-account">Test User</a><ul><li>Test User hello again Test User</li></ul>').length);
  ok('one account text in a row: content', satirlar('<a href="/my-account">Tickets</a><ul><li>Tickets Team A - Team B</li></ul>').length === 1);
  ok('a status word keeps the row', satirlar('<a href="/my-account">Test User</a><ul><li>Test User Sold out Test User</li></ul>').length === 1);
  ok('sale buttons are not noise', ['In den Warenkorb', 'Add to cart', 'Kaufen'].every((b) => Object.keys(Gm.represent('<button>' + b + '</button>').ids).includes('B|' + b)));
  ok('only an empty counter is noise', !linkAnahtari('<a href="#">€ 0,00</a>').length && !linkAnahtari('<a href="#">(0)</a>').length && linkAnahtari('<a href="#">€ 5,00</a>').length === 1 && linkAnahtari('<a href="#">10</a>').length === 1);
  ok('logout is recognized by address and by text', ['<a href="/account/logout"></a>', '<a href="/shop/bye">x</a>', '<a href="/logoff.aspx">x</a>', '<a href="#">Log out</a>', '<a href="#">ÇIKIŞ</a>', '<button>Sign out</button>', '<a href="#">התנתק</a>'].every((h) => Gm.represent(h).cikisVar === true));
  ok('a login link is not a logout link', !Gm.represent('<a href="/login">Log in</a><a href="/shop/7">Bye bye tour</a>').cikisVar);

  const kes = (ic) => Gm.represent('<html><body>' + dolgu + ic + '<h2>Sonra</h2></body></html>');
  const kesilen = kes('<div id="site-cookie-bar"><p>Käytämme evästeitä</p><button>Hyväksyn</button></div>');
  ok('a cookie box in any language is cut by its name', !kesilen.ids['B|Hyväksyn'] && !kesilen.text['P|Käytämme evästeitä'] && kesilen.text['H|Sonra'] === 1);
  ok('a box named consent with a sale link stays', kes('<div class="consent-tickets"><a href="/al">Buy now</a></div>').text['A|Buy now'] === 1);
  ok('a box named cookie with a status word stays', kes('<div class="cookie-note"><span>Sold out</span></div>').text['D|Sold out'] === 1);
  const sarmalanmis = Gm.represent('<html><body><div class="cookies-accepted"><h1>Team A</h1>' + dolgu + '</div><p>Alt bilgi</p></body></html>');
  ok('a wrapper named cookies around the content is not cut', sarmalanmis.text['H|Team A'] === 1);

  const cerezPenceresi = '<div id="x_cookie_banner_container" class="y-window"><p>Bu site izleme kullanir.</p><ul><li><table><tr><td>_abc</td><td>Saglayici</td><td>Sitzung</td></tr></table></li></ul><form><input name="secim"><button>Kaydet</button></form></div>';
  const pencereli = kes(cerezPenceresi);
  ok('a consent window with a table of cookies and a form is cut', !pencereli.text['T|_abc ~ Saglayici ~ Sitzung'] && !pencereli.ids['I|secim'] && !pencereli.ids['B|Kaydet'] && pencereli.text['H|Sonra'] === 1, JSON.stringify(Object.keys(pencereli.text)));
  ok('the common cookie window class is known by name', !kes('<div class="cc-window cc-banner"><p>Metin burada.</p><button>Tamam</button></div>').ids['B|Tamam']);
  ok('a table in a box with another name stays', kes('<div class="tickets"><table><tr><td>Kategori 1</td><td>100</td></tr></table></div>').text['T|Kategori 1 ~ 100'] === 1);

  console.log('32) A site that keeps opening a waiting room rings once, not all day');
  const SIRA_URL = 'https://ornek.test/sira';
  const SIRA_KUYRUK = 'https://bekle.ornek.test/queue/x';
  const siraSayfa = (ek) => '<html><head><title>Sira</title></head><body><h1>Team A - Team B</h1><a href="/detay">Detay</a>' + uzunMetin + (ek || '') + '</body></html>';
  t = kur();
  c = await t.islem({ tip: 'EKLE', ad: 'Kuyruk gelip gider', url: SIRA_URL, aralikSn: 300 });
  await bekle(20);
  for (let i = 0; i < 2; i++) await t.sayfa(c.id, siraSayfa(), SIRA_URL);
  const siraSekme = t.iz(c.id).sekmeId;
  t.sekmeler.get(siraSekme).url = SIRA_KUYRUK;
  await t.tik();
  ok('first waiting room: alarm', t.alarmlar().length === 1 && /kuyruk/.test(t.alarmlar()[0].satirlar[0]), JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  await t.islem({ tip: 'ALARM_KAPAT', alarmId: '*', islem: 'gec' });
  await t.sayfa(c.id, siraSayfa(), SIRA_URL);
  t.sekmeler.get(siraSekme).url = SIRA_KUYRUK;
  await t.tik();
  ok('it comes back within hours: no alarm, the watch says it is in a queue', t.alarmlar().length === 0 && t.iz(c.id).durum === 'sorun' && /kuyruk|sıra/i.test(t.iz(c.id).sorun), JSON.stringify({ a: t.alarmlar().length, d: t.iz(c.id).durum, s: t.iz(c.id).sorun }));
  t.sekmeler.get(siraSekme).url = SIRA_URL;
  await t.sayfa(c.id, siraSayfa(), SIRA_URL);
  ok('reading again: the orange warning goes away', t.iz(c.id).durum === 'izleniyor', t.iz(c.id).durum);
  for (let i = 0; i < 2; i++) await t.sayfa(c.id, siraSayfa('<button>Add to cart</button>'), SIRA_URL);
  ok('a real opening behind the queue still rings', t.alarmlar().length === 1 && t.alarmlar()[0].satirlar.some((s) => /Add to cart/.test(s)), JSON.stringify(t.alarmlar().map((x) => x.satirlar)));
  await t.islem({ tip: 'ALARM_KAPAT', alarmId: '*', islem: 'gec' });
  t.depo.izlemeler.find((x) => x.id === c.id).kuyrukSonAlarm = Date.now() - 7 * 3600e3;
  t.sekmeler.get(siraSekme).url = SIRA_KUYRUK;
  await t.tik();
  ok('hours later a waiting room rings again', t.alarmlar().length === 1 && /kuyruk/.test(t.alarmlar()[0].satirlar[0]), JSON.stringify(t.alarmlar().map((x) => x.satirlar)));

  console.log('\n' + gecti + ' gecti, ' + kaldi + ' basarisiz');
  process.exit(kaldi ? 1 : 0);
})();

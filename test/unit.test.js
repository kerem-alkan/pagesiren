// PageSiren — small unit tests: notifications, autostart files, translations. Nothing leaves 127.0.0.1.
// Run:  node test/unit.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { Bildirim } = require('../app/notify');
const otoBaslat = require('../app/autostart');
const T = require('../extension/i18n');
const { Tarayici } = require('../app/browser');

const KOK = path.join(__dirname, '..');
let gecti = 0;
let kaldi = 0;
function ok(ad, kosul, ek) {
  if (kosul) { gecti++; console.log('  OK  ' + ad); }
  else { kaldi++; console.log('  FAIL ' + ad + (ek != null ? '  -> ' + ek : '')); }
}
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

(async function () {
  const dizin = fs.mkdtempSync(path.join(os.tmpdir(), 'pagesiren-unit-'));

  console.log('1) Notifications: every channel sends the right request; secrets stay masked');
  const gelen = [];
  let hataKodu = 0;
  const sunucu = http.createServer((q, c) => {
    const p = [];
    q.on('data', (x) => p.push(x));
    q.on('end', () => {
      gelen.push({ yol: q.url, govde: JSON.parse(Buffer.concat(p).toString('utf8') || '{}') });
      c.writeHead(hataKodu || 200);
      c.end('{}');
    });
  });
  await new Promise((r) => sunucu.listen(0, '127.0.0.1', r));
  const kok = 'http://127.0.0.1:' + sunucu.address().port;
  const gunluk = [];
  const dosya = path.join(dizin, 'notify.json');
  const b = new Bildirim({ dosya, gunluk: (s) => gunluk.push(s), telegramKok: kok, tekrarMs: [30, 30] });
  const alarm = { ad: 'My page', satirlar: ['+ added — button: "Buy"', '- removed — status text: "Sold out"'], url: 'https://example.com/x', zaman: '2026-01-01T00:00:00.000Z' };

  b.gonder(alarm);
  await bekle(50);
  ok('nothing is sent until a channel is set', gelen.length === 0);

  const gizli = 'SECRETTOKEN123456';
  const ekran = b.kaydet({
    telegram: { token: gizli, chatId: '42' },
    discord: { url: kok + '/discord/' + gizli },
    ntfy: { server: kok + '/', topic: 'topic-' + gizli },
    webhook: { url: kok + '/hook' },
  });
  ok('secrets are masked for the screen', !JSON.stringify(ekran).includes(gizli) && ekran.telegram.token.endsWith('3456') && ekran.telegram.chatId === '42');
  b.gonder(alarm);
  await bekle(200);
  const yol = (y) => gelen.find((g) => g.yol.startsWith(y));
  const tg = yol('/bot' + gizli + '/sendMessage');
  ok('Telegram', !!tg && tg.govde.chat_id === '42' && /My page/.test(tg.govde.text) && /Sold out/.test(tg.govde.text) && /example\.com/.test(tg.govde.text), JSON.stringify(gelen.map((g) => g.yol)));
  const ds = yol('/discord/');
  ok('Discord', !!ds && /Buy/.test(ds.govde.content));
  const nt = gelen.find((g) => g.yol === '/' && g.govde.topic);
  ok('ntfy: title and message may hold any language (JSON, not headers)', !!nt && nt.govde.topic === 'topic-' + gizli && nt.govde.title === 'My page' && nt.govde.click === alarm.url && nt.govde.priority === 5);
  const wh = yol('/hook');
  ok('webhook', !!wh && wh.govde.source === 'pagesiren' && wh.govde.name === 'My page' && wh.govde.lines.length === 2 && wh.govde.url === alarm.url);

  b.kaydet({ telegram: { token: ekran.telegram.token } });
  ok('a masked value coming back keeps the real one', b.ayar.telegram.token === gizli);
  const b2 = new Bildirim({ dosya, telegramKok: kok });
  ok('settings survive a restart', b2.ayar.webhook.url === kok + '/hook' && b2.ayar.telegram.token === gizli);

  gelen.length = 0;
  hataKodu = 500;
  gunluk.length = 0;
  b.kaydet({ telegram: { token: '', chatId: '' }, discord: { url: '' }, ntfy: { topic: '' } });
  b.gonder(alarm);
  await bekle(250);
  ok('a failing channel is retried, then gives up', gelen.length === 3, gelen.length);
  ok('the log has no address or token', gunluk.length > 0 && !gunluk.join(' ').includes(gizli) && !gunluk.join(' ').includes('127.0.0.1'), gunluk.join(' | '));
  hataKodu = 0;
  ok('test button: reports a working channel', (await b.testEt('webhook')).ok === true);
  hataKodu = 401;
  ok('test button: reports the status of a bad one', (await b.testEt('webhook')).hata === 'HTTP 401');
  hataKodu = 0;
  ok('test button: says when a channel is empty', (await b.testEt('telegram')).hata === 'not configured');
  ok('test button: unknown channels are refused', !!(await b.testEt('__proto__')).hata);
  sunucu.close();

  console.log('2) Autostart: what would be written (nothing is really installed by this test)');
  const o = { exe: 'C:\\x y\\PageSirenAlarm.exe', node: 'C:\\n\\node.exe', uygulama: 'C:\\a b\\app\\pagesiren.js', veri: 'C:\\d e', port: 47431 };
  ok('Windows runs the helper, paths quoted', otoBaslat.windowsKomutu(o) === '"C:\\x y\\PageSirenAlarm.exe" --app "C:\\a b\\app\\pagesiren.js" --node "C:\\n\\node.exe" --data "C:\\d e" --ui-port 47431');
  const u = { node: '/usr/bin/node', uygulama: '/home/a b/app/pagesiren.js', veri: '/home/a b/d', port: 47431 };
  ok('macOS LaunchAgent', /<string>\/home\/a b\/app\/pagesiren\.js<\/string>/.test(otoBaslat.macIcerik(u)) && /<string>--no-open<\/string>/.test(otoBaslat.macIcerik(u)) && /RunAtLoad/.test(otoBaslat.macIcerik(u)));
  ok('Linux desktop file', /^Exec="\/usr\/bin\/node" "\/home\/a b\/app\/pagesiren\.js" "--no-open"/m.test(otoBaslat.linuxIcerik(u)));
  const eskiYardimci = otoBaslat.windowsKomutu({ ...o, exe: 'C:\\d e\\helper\\PageSirenAlarm-0.1.3.exe' });
  ok('after an update, start-at-login of this data folder moves to the new helper', otoBaslat.tazelenmeli(eskiYardimci, otoBaslat.windowsKomutu(o), '--data "C:\\d e"'));
  ok('a value that is already right is left alone', !otoBaslat.tazelenmeli(otoBaslat.windowsKomutu(o), otoBaslat.windowsKomutu(o), '--data "C:\\d e"'));
  ok('a value for another data folder is left alone', !otoBaslat.tazelenmeli(eskiYardimci, otoBaslat.windowsKomutu(o), '--data "C:\\baska"'));
  ok('an npm copy moving to the installed one on macOS is refreshed', otoBaslat.tazelenmeli(otoBaslat.macIcerik({ ...u, uygulama: '/tmp/npx/pagesiren.js' }), otoBaslat.macIcerik(u), u.veri));

  console.log('3) Translations: every text on screen has a Turkish version');
  const metinler = new Set();
  const bak = (f) => {
    const s = fs.readFileSync(path.join(KOK, f), 'utf8');
    for (const m of s.matchAll(/\bT\(\s*'((?:[^'\\]|\\.)*)'/g)) metinler.add(m[1].replace(/\\(.)/g, '$1'));
    for (const m of s.matchAll(/data-t="([^"]*)"/g)) metinler.add(m[1]);
    for (const m of s.matchAll(/data-t='([^']*)'/g)) metinler.add(m[1]);
  };
  ['extension/background.js', 'extension/engine.js', 'extension/dashboard.js', 'extension/dashboard.html', 'app/pagesiren.js', 'app/alarm.html'].forEach(bak);
  // texts that reach T() through a variable
  ['link', 'option', 'button', 'form field', 'link text', 'heading', 'list row', 'table row', 'text', 'status text', 'event', 'item',
    'OPEN', 'got it', 'false alarm', 'dismissed', 'ignored', 'closed', 'All', 'Active', 'Problems', 'Bot check', 'Paused', 'Got it', 'Deleted',
    'Watching', 'Getting ready', 'On hold', 'Problem', 'Changed', 'Watch again', 'Restore', 'No watches here.', 'No watches yet. Add a page with the button above.', 'No alarms yet.', ' · alarm helper is running', ' · alarm: red desktop window', ' · alarm: browser window',
    'read without a browser', 'read by the Chrome extension', 'Bot token', 'Chat ID', 'Webhook address', 'Server', 'Topic', 'Address',
    'Separate browser (handles JavaScript and logins)', 'Plain HTTP (lightest, no JavaScript)', 'My Chrome extension (Windows, extension installed)'].forEach((m) => metinler.add(m));
  for (const dil of ['tr', 'de', 'es']) {
    T.dil(dil);
    const eksik = [...metinler].filter((m) => !T.ceviriVar(m));
    ok(metinler.size + ' texts are all translated (' + dil + ')', eksik.length === 0, eksik.join(' | '));
    const bozuk = [...metinler].filter((m) => (m.match(/\{\w+\}/g) || []).sort().join() !== (T(m).match(/\{\w+\}/g) || []).sort().join());
    ok('every {placeholder} is kept (' + dil + ')', bozuk.length === 0, bozuk.join(' | '));
  }
  T.dil('tr');
  ok('parameters are filled', T('{n} min', { n: 5 }) === '5 dk');
  T.dil('de');
  ok('German is used when chosen', T('Open site') === 'Seite öffnen');
  T.dil('es');
  ok('Spanish is used when chosen', T('Open site') === 'Abrir sitio');
  T.dil('en');
  ok('English is the source text', T('{n} min', { n: 5 }) === '5 min' && T('Open site') === 'Open site');
  T.dil('xx');
  ok('an unknown language falls back to English', T.dil() === 'en');
  const panel = fs.readFileSync(path.join(KOK, 'extension', 'dashboard.html'), 'utf8');
  ok('every language can be picked on the dashboard', ['en', 'tr', 'de', 'es'].every((d) => panel.includes('<option value="' + d + '">')));
  for (const cs of ['windows-helper/PageSirenAlarm.cs', 'windows-installer/PageSirenSetup.cs']) {
    const kaynak = fs.readFileSync(path.join(KOK, cs), 'utf8');
    const tekDil = [...kaynak.matchAll(/\bY\(("(?:[^"\\]|\\.)*"(?:\s*,\s*"(?:[^"\\]|\\.)*")*)\)/g)].filter((m) => (m[1].match(/"(?:[^"\\]|\\.)*"/g) || []).length !== 4);
    ok(path.basename(cs) + ': every text has English, Turkish, German and Spanish', tekDil.length === 0, tekDil.map((m) => m[1].slice(0, 60)).join(' | '));
  }

  console.log('Browser closing: several requests at once leave nothing behind');
  const gunlukler = [];
  const tar = new Tarayici({ profil: path.join(dizin, 'profil'), kapanisMs: 60, gunluk: (s) => gunlukler.push(s) });
  const sahteWs = () => ({ kapandi: 0, close() { this.kapandi++; } });
  tar.gonder = async () => {};
  tar.eskiyiBitir = async () => {};
  tar.ws = sahteWs();
  tar.kapat('yasli');
  tar.kapat('yasli');
  tar.kapat('yasli');
  tar.kapatIc();
  ok('one closing for several requests', gunlukler.filter((s) => /closing the browser/.test(s)).length === 1, gunlukler.join(' | '));
  tar.koptu(); // the browser closed by itself
  await bekle(10);
  ok('closing is over once the browser is gone', tar.kapaniyor === null);
  const sonraki = sahteWs();
  tar.ws = sonraki; // the next browser has started
  await bekle(150);
  ok('no timer left behind cuts the next browser', sonraki.kapandi === 0);
  tar.kapat('yasli');
  await bekle(150);
  ok('a browser that will not close is cut by the timer', sonraki.kapandi === 1 && tar.kapaniyor === null);

  console.log('\n' + gecti + ' passed, ' + kaldi + ' failed');
  try { fs.rmSync(dizin, { recursive: true, force: true }); } catch (e) { /* temp folder */ }
  process.exit(kaldi ? 1 : 0);
})().catch((e) => { console.log('TEST ERROR', e); process.exit(2); });

// PageSiren-Setup.exe tests: the real installer with --silent --no-integration: no window, no shortcuts, no registry, nothing outside a temp folder,
// and the real program, if one is running, is left alone. Only in CI it also runs once with its small progress window, which closes by itself.
// Requests go only to 127.0.0.1. Run:  node test/installer.test.js [setup exe]   (default: built with tools/build-windows.js)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

if (process.platform !== 'win32') { console.log('skipped: the installer is Windows only'); process.exit(0); }

const KOK = path.join(__dirname, '..');
const PORT = 47396;
const YARDIMCI_PORT = 47395;
const UI = 'http://127.0.0.1:' + PORT;
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
let gecti = 0;
let kaldi = 0;
function ok(ad, kosul, ek) {
  if (kosul) { gecti++; console.log('  OK  ' + ad); }
  else { kaldi++; console.log('  HATA ' + ad + (ek != null ? '  -> ' + ek : '')); }
}
async function bekleKadar(kosul, ms) {
  const son = Date.now() + ms;
  while (Date.now() < son) { const v = await kosul(); if (v) return v; await bekle(200); }
  return kosul();
}
const saglik = () => fetch(UI + '/saglik').then((r) => r.json()).catch(() => null);
const calistir = (exe, arglar) => spawnSync(exe, arglar, { encoding: 'utf8', timeout: 180000, windowsHide: true });

let setup = process.argv[2] && path.resolve(process.argv[2]);
if (!setup) {
  execFileSync(process.execPath, [path.join(KOK, 'tools', 'build-windows.js')], { stdio: 'inherit' });
  setup = path.join(KOK, 'dist', 'PageSiren-Setup.exe');
}
const surum = JSON.parse(fs.readFileSync(path.join(KOK, 'package.json'), 'utf8')).version;
const gecici = fs.mkdtempSync(path.join(os.tmpdir(), 'pagesiren-installer-test-'));
const dizin = path.join(gecici, 'Program Files With Spaces', 'PageSiren'); // a path with spaces, like a real user name
const veri = path.join(gecici, 'veri');
const launcher = path.join(dizin, 'PageSiren.exe');
const programArglari = ['--data', veri, '--port', String(PORT), '--helper-port', String(YARDIMCI_PORT), '--no-open', '--no-helper', '--headless'];

(async () => {
  console.log('1) Kurulum: dosyalar yerinde');
  const kur = calistir(setup, ['--silent', '--no-integration', '--dir', dizin]);
  ok('kurulum basarili', kur.status === 0, kur.status + ' ' + kur.stderr);
  for (const f of ['PageSiren.exe', 'runtime/node.exe', 'runtime/LICENSE', 'app/pagesiren.js', 'extension/manifest.json', 'windows-helper/PageSirenAlarm.cs', 'package.json', 'LICENSE']) {
    ok(f + ' var', fs.existsSync(path.join(dizin, f)));
  }
  const icerik = fs.readFileSync(launcher);
  ok('yonetici izni istemez (asInvoker)', icerik.includes('asInvoker') || icerik.includes(Buffer.from('asInvoker', 'utf16le')));
  const node = path.join(dizin, 'runtime', 'node.exe');
  ok('paketteki Node program surumunu okuyor', execFileSync(node, [path.join(dizin, 'app', 'pagesiren.js'), '--version'], { encoding: 'utf8' }).trim() === surum);
  const yardimci = execFileSync(node, ['-e', `const { yardimciHazirla } = require(${JSON.stringify(path.join(dizin, 'app', 'helper.js'))}); process.stdout.write(yardimciHazirla(${JSON.stringify(path.join(gecici, 'yardimci'))}, 'test', () => {}) || '')`], { encoding: 'utf8' });
  ok('alarm yardimcisi kurulu dosyalardan derleniyor', yardimci.endsWith('.exe') && fs.existsSync(yardimci), yardimci);

  console.log('2) Acilis: konsol penceresi olmadan calisir');
  const ac = calistir(launcher, programArglari);
  ok('acici hemen doner', ac.status === 0, ac.status + ' ' + ac.stderr);
  const s = await bekleKadar(saglik, 30000);
  ok('program cevap veriyor', !!(s && s.ok));
  ok('surum dogru', s && s.surum === surum, s && s.surum);
  const liste = await fetch(UI + '/mesaj', { method: 'POST', body: JSON.stringify({ tip: 'LISTE' }) }).then((r) => r.json()).catch(() => null);
  ok('takip ekrani API calisiyor', !!(liste && Array.isArray(liste.izlemeler)));
  calistir(launcher, programArglari);
  await bekle(1500);
  const s2 = await saglik();
  ok('ikinci acilis calisani bozmaz', !!(s && s2 && s2.pid === s.pid), s2 && s2.pid);
  await fetch(UI + '/dur', { method: 'POST' }).catch(() => {});
  ok('kapandi', await bekleKadar(async () => !(await saglik()), 15000));

  console.log('3) Ustune kurulum: eski dosya kalmaz');
  const artik = path.join(dizin, 'app', 'eski-dosya.js');
  fs.writeFileSync(artik, '// from an older version');
  await bekleKadar(() => { try { fs.accessSync(node, fs.constants.W_OK); return true; } catch (e) { return false; } }, 5000);
  const ustune = calistir(setup, ['--silent', '--no-integration', '--dir', dizin]);
  ok('ustune kurulum basarili', ustune.status === 0, ustune.status + ' ' + ustune.stderr);
  ok('eski dosya silindi', !fs.existsSync(artik));

  console.log('4) Kaldirma');
  const baska = path.join(gecici, 'baska-klasor');
  fs.mkdirSync(baska);
  fs.writeFileSync(path.join(baska, 'onemli.txt'), 'keep');
  const red = calistir(launcher, ['--uninstall', '--silent', '--no-integration', '--dir', baska]);
  ok('PageSiren olmayan klasoru silmeyi reddeder', red.status === 1 && fs.existsSync(path.join(baska, 'onemli.txt')), red.status);
  const kaldir = calistir(launcher, ['--uninstall', '--silent', '--no-integration', '--dir', dizin]);
  ok('kaldirma basarili', kaldir.status === 0, kaldir.status + ' ' + kaldir.stderr);
  ok('klasor silindi', await bekleKadar(() => !fs.existsSync(dizin), 20000));
  ok('veriye dokunulmadi', fs.existsSync(veri));

  if (process.env.CI) {
    console.log('5) Pencereyle kurulum (sadece CI)');
    const d2 = path.join(gecici, 'pencereli');
    const p = calistir(setup, ['--no-integration', '--dir', d2]);
    ok('pencere kendiliginden kapanir, kurulum biter', p.status === 0 && fs.existsSync(path.join(d2, 'app', 'pagesiren.js')), p.status);

    // What a person gets from a double click: real folder, shortcuts, Apps & Features entry, the program, the helper and the red window.
    console.log('6) Gercek kurulum, gercek alarm penceresi (sadece CI)');
    const gercek = path.join(process.env.LOCALAPPDATA, 'Programs', 'PageSiren');
    const kisayol = path.join(os.homedir(), 'Desktop', 'PageSiren.lnk');
    const ANAHTAR = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PageSiren';
    const kayit = () => spawnSync('reg', ['query', ANAHTAR, '/v', 'DisplayVersion'], { encoding: 'utf8' }).stdout || '';
    const anaSaglik = () => fetch('http://127.0.0.1:47431/saglik').then((r) => r.json()).catch(() => null);
    const durum = () => fetch('http://127.0.0.1:47430/durum').then((r) => r.json()).catch(() => null);
    // Someone who ran it another way first may already have a shortcut with this name
    const kisayolBetigi = (ic) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('" + kisayol + "'); " + ic], { encoding: 'utf8' }).stdout || '';
    fs.mkdirSync(path.dirname(kisayol), { recursive: true });
    kisayolBetigi("$s.TargetPath = 'C:\\Windows\\notepad.exe'; $s.Arguments = 'eski-yol'; $s.WindowStyle = 7; $s.Save()");
    const g = calistir(setup, []);
    ok('kurulum penceresi bitti', g.status === 0, g.status);
    ok('program kuruldu', fs.existsSync(path.join(gercek, 'app', 'pagesiren.js')));
    ok('masaustu kisayolu var', fs.existsSync(kisayol));
    const kisayolBilgi = kisayolBetigi("$s.TargetPath + '|' + $s.Arguments + '|' + $s.WindowStyle").trim();
    ok('eski kisayol yenilendi, eski ayari kalmadi', kisayolBilgi.toLowerCase().endsWith('pagesiren.exe||1'), kisayolBilgi);
    ok('Uygulamalar listesinde', kayit().includes(surum), kayit());
    ok('program kendiliginden acildi', !!(await bekleKadar(anaSaglik, 30000)));
    ok('alarm yardimcisi calisiyor', !!(await bekleKadar(durum, 30000)));
    await fetch('http://127.0.0.1:47431/mesaj', { method: 'POST', body: JSON.stringify({ tip: 'TEST_ALARM' }) }).catch(() => {});
    ok('kirmizi pencere acildi', await bekleKadar(async () => { const d = await durum(); return d && d.acik; }, 20000), JSON.stringify(await durum()));
    await bekle(1500);
    const foto = path.join(KOK, 'dist', 'ci-alarm.png');
    spawnSync('powershell', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $p=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($p); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $p.Save('${foto}')`]);
    const sil = calistir(path.join(gercek, 'PageSiren.exe'), ['--uninstall', '--silent']);
    ok('kaldirma basarili', sil.status === 0, sil.status + ' ' + sil.stderr);
    ok('program kapandi', await bekleKadar(async () => !(await anaSaglik()), 20000));
    ok('klasor silindi', await bekleKadar(() => !fs.existsSync(gercek), 30000));
    ok('kisayol silindi', !fs.existsSync(kisayol));
    ok('Uygulamalar listesinden cikti', !kayit().includes(surum));
  }

  try { fs.rmSync(gecici, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch (e) { /* temp folder */ }
  console.log('\n' + gecti + ' gecti, ' + kaldi + ' basarisiz');
  process.exit(kaldi ? 1 : 0);
})().catch(async (e) => {
  console.error('TEST HATASI', e);
  await fetch(UI + '/dur', { method: 'POST' }).catch(() => {});
  process.exit(1);
});

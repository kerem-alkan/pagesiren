// Makes docs/social-preview.png, the picture people see when a link to this repository is shared. GitHub takes it from Settings > Social preview.
// It lays out the logo and docs/alarm.png on a 1280x640 page and photographs it with a headless browser. Nothing opens on screen.
// Run: node tools/make-social.js   (run node tools/make-demo.js first if docs/alarm.png is missing)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { tarayiciBul } = require('../app/browser');

const DOCS = path.join(__dirname, '..', 'docs');
const gecici = fs.mkdtempSync(path.join(os.tmpdir(), 'pagesiren-social-'));
const dosyaAdresi = (p) => 'file:///' + p.replace(/\\/g, '/');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 1280px; height: 640px; overflow: hidden; }
  body { position: relative; color: #fff; font-family: "Segoe UI", system-ui, sans-serif; background: linear-gradient(135deg, #1c1f27, #0e1014); }
  .isik { position: absolute; right: -140px; top: -130px; width: 900px; height: 900px; background: radial-gradient(closest-side, #ff2d3a70, #ff2d3a00); }
  .sol { position: absolute; left: 68px; top: 0; bottom: 0; width: 590px; display: flex; flex-direction: column; justify-content: center; }
  .logo { width: 100px; height: 100px; margin-bottom: 16px; }
  h1 { margin: 0; font-size: 84px; line-height: 1.05; font-weight: 700; }
  h2 { margin: 14px 0 0; font-size: 36px; line-height: 1.25; font-weight: 400; color: #d5d9e2; }
  h2 b { color: #ff6a72; font-weight: 700; }
  .rozet { margin-top: 30px; display: flex; gap: 10px; }
  .rozet span { padding: 8px 16px; border-radius: 999px; background: #ffffff14; border: 1px solid #ffffff26; font-size: 21px; color: #e6e8ee; }
  .foto { position: absolute; right: -70px; top: 132px; width: 620px; border-radius: 14px; border: 1px solid #ffffff2e; box-shadow: 0 26px 70px #000000b8; transform: rotate(-3deg); }
</style></head><body>
  <div class="isik"></div>
  <img class="foto" src="${dosyaAdresi(path.join(DOCS, 'alarm.png'))}">
  <div class="sol">
    <img class="logo" src="${dosyaAdresi(path.join(DOCS, 'logo.svg'))}">
    <h1>PageSiren</h1>
    <h2>Stop pressing refresh. Get a <b>siren</b> the moment a page changes.</h2>
    <div class="rozet"><span>Free</span><span>No account</span><span>No cloud</span><span>Open source</span></div>
  </div>
</body></html>`;

const sayfa = path.join(gecici, 'kart.html');
fs.writeFileSync(sayfa, html);
const hedef = path.join(DOCS, 'social-preview.png');
const r = spawnSync(tarayiciBul(), ['--headless=new', '--hide-scrollbars', '--force-device-scale-factor=1', '--force-color-profile=srgb', '--no-first-run', '--no-default-browser-check',
  '--window-size=1280,640', '--virtual-time-budget=2000', '--user-data-dir=' + path.join(gecici, 'profil'), '--screenshot=' + hedef, dosyaAdresi(sayfa)], { stdio: 'ignore', timeout: 60000 });
try { fs.rmSync(gecici, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }); } catch (e) { /* temp folder */ }
if (r.status !== 0 || !fs.existsSync(hedef)) { console.error('the browser could not make the picture'); process.exit(1); }
console.log('social-preview.png:', Math.round(fs.statSync(hedef).size / 1024), 'KB');

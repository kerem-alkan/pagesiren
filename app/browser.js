// =====================================================================================================
// PageSiren — BROWSER READER
// =====================================================================================================
// WHAT IT DOES: for pages that fill via JS / need login / have bot walls, runs a SEPARATE Chrome instance (own profile, doesn't touch the
//   user's Chrome) and drives it through the DevTools protocol (CDP). No dependencies: Node's built-in WebSocket is enough.
//
// RAM: reading tabs are "hidden" targets not shown in the tab strip and close after reading; images/video/fonts are blocked (same as
//   the extension); with no work, after bostaMs the whole browser closes and reopens when needed (session cookies are kept through
//   --restore-last-session). Since a long-running browser can bloat, it closes at the first idle moment after yasliMs.
//
// RULES (see docs/ARCHITECTURE.md): bot protection is NEVER bypassed. No fingerprint / navigator.webdriver / User-Agent tampering;
//   the browser shows itself as it is. If a wall appears, a human passes the check (gorunurAc). No login / buying / cart.
// =====================================================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const BOSTA_MS = 120000;
const YASLI_MS = 3 * 3600e3;
const CDP_MS = 30000;
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

const BAYRAKLAR = [
  '--no-first-run', '--no-default-browser-check', '--disable-search-engine-choice-screen',
  '--restore-last-session', '--hide-crash-restore-bubble', // keep session cookies when the browser closes and reopens (don't lose the login)
  '--disable-extensions', '--disable-component-extensions-with-background-pages', '--disable-default-apps',
  '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-breakpad',
  '--disable-domain-reliability', '--disable-client-side-phishing-detection', '--no-pings', '--mute-audio',
  '--disable-back-forward-cache', '--disk-cache-size=52428800',
  // don't throttle the background reading tab (some tables don't fill until read time otherwise)
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider,InterestFeedContentSuggestions,AutofillServerCommunication,CalculateNativeWinOcclusion,PrivacySandboxSettings4,SpareRendererForSitePerProcess',
];

// Finds a Chromium-based browser. Firefox can't be driven through this protocol.
function tarayiciBul() {
  const e = process.env;
  const adaylar = process.platform === 'win32'
    ? [e.PROGRAMFILES, e['PROGRAMFILES(X86)'], e.LOCALAPPDATA].filter(Boolean).flatMap((k) => [
      path.join(k, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(k, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(k, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(k, 'Chromium', 'Application', 'chrome.exe'),
    ])
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', '/Applications/Chromium.app/Contents/MacOS/Chromium']
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium',
        '/usr/bin/microsoft-edge', '/usr/bin/brave-browser'];
  return adaylar.find((p) => fs.existsSync(p)) || null;
}

class Tarayici {
  // options: { chromeYolu, profil, gizli (tests only: --headless=new), bostaMs, yasliMs, ekBayrak[], gunluk(fn),
  //            olay: { yuklendi(hedefId), adres(hedefId, url, hata), kapandi(hedefId), hepsiKapandi() } }
  constructor(secenek) {
    this.s = secenek;
    this.gunluk = secenek.gunluk || (() => {});
    this.ws = null;
    this.sira = 1;
    this.bekleyen = new Map();
    this.hedefler = new Map(); // targetId -> {sessionId, cerceve}
    this.oturumdan = new Map(); // sessionId -> targetId
    this.ana = null;
    this.gorunur = new Set();
    this.baslatiliyor = null;
    this.kapaniyor = null;
    this.kapaniyorCoz = null;
    this.bosZamanlayici = null;
    this.hiddenDesteklenmez = false;
    this.acilis = 0;
    this.pidDosyasi = path.join(path.dirname(secenek.profil), path.basename(secenek.profil) + '.pid');
  }

  calisiyorMu() { return !!this.ws; }

  // ---------------------------------------------------------------- startup / connection
  async hazirla() {
    if (this.kapaniyor) await this.kapaniyor;
    if (this.ws) return;
    if (!this.baslatiliyor) this.baslatiliyor = this.baslat().finally(() => { this.baslatiliyor = null; });
    return this.baslatiliyor;
  }

  async baslat() {
    if (!this.s.chromeYolu) throw new Error('no Chrome, Edge or Brave found');
    fs.mkdirSync(this.s.profil, { recursive: true });
    const portDosyasi = path.join(this.s.profil, 'DevToolsActivePort');
    let adres = await this.calisaniBul(portDosyasi);
    if (!adres) {
      // A second Chrome won't start on the same profile (it hands off to the first and exits): if an old one is half finished, it's ended first.
      await this.eskiyiBitir();
      try { fs.unlinkSync(portDosyasi); } catch (e) { /* none */ }
      const arg = ['--user-data-dir=' + this.s.profil, '--remote-debugging-port=0', ...BAYRAKLAR, ...(this.s.ekBayrak || [])];
      if (this.s.gizli) arg.push('--headless=new');
      else arg.push('--window-position=-32000,-32000', '--window-size=1280,900', '--start-minimized');
      arg.push('about:blank');
      const c = spawn(this.s.chromeYolu, arg, { detached: true, stdio: 'ignore', windowsHide: false });
      c.on('error', (e) => this.gunluk('browser could not start: ' + e.message));
      c.unref();
      try { fs.writeFileSync(this.pidDosyasi, String(c.pid)); } catch (e) { /* harmless */ }
      this.gunluk('browser started (pid ' + c.pid + ')');
      const son = Date.now() + 30000;
      while (!adres && Date.now() < son) {
        await bekle(200);
        adres = await this.calisaniBul(portDosyasi);
      }
      if (!adres) { await this.eskiyiBitir(); throw new Error('browser did not open within 30 s'); }
    } else this.gunluk('connecting to the running browser');
    await this.baglan(adres);
    this.acilis = Date.now();
    await this.gonder('Target.setDiscoverTargets', { discover: true });
    await this.gonder('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});
    await this.eskileriTopla();
  }

  // If the last started Chrome is still running, first wait for it to close itself (so it writes cookies to disk), then close it. The pid may
  // have moved to another process: only touched if THIS profile is on its command line (never the user's own Chrome).
  async eskiyiBitir(beklemeMs) {
    let pid;
    try { pid = Number(fs.readFileSync(this.pidDosyasi, 'utf8')); } catch (e) { return; }
    if (!pid) return;
    const yasiyor = () => { try { process.kill(pid, 0); return true; } catch (e) { return false; } };
    for (let k = Date.now() + (beklemeMs || 0); yasiyor() && Date.now() < k;) await bekle(150);
    if (!yasiyor()) return;
    if (!(await this.bizimSurecMi(pid))) return;
    this.gunluk('force-closing the browser (pid ' + pid + ')');
    try { process.kill(pid); } catch (e) { /* harmless */ }
    for (let i = 0; i < 25 && yasiyor(); i++) await bekle(200);
  }

  bizimSurecMi(pid) {
    return new Promise((coz) => {
      const cevap = (h, cikti) => coz(!h && String(cikti || '').toLowerCase().includes(this.s.profil.toLowerCase()));
      if (process.platform !== 'win32') return execFile('ps', ['-ww', '-o', 'command=', '-p', String(pid)], { timeout: 15000 }, cevap);
      const komut = '(Get-CimInstance Win32_Process -Filter "ProcessId=' + pid + '").CommandLine';
      return execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', komut], { windowsHide: true, timeout: 15000 }, cevap);
    });
  }

  async calisaniBul(portDosyasi) {
    let port;
    try { port = fs.readFileSync(portDosyasi, 'utf8').split(/\r?\n/)[0].trim(); } catch (e) { return null; }
    if (!port) return null;
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/json/version', { signal: AbortSignal.timeout(2500) });
      return (await r.json()).webSocketDebuggerUrl || null;
    } catch (e) { return null; }
  }

  baglan(adres) {
    return new Promise((coz, red) => {
      const ws = new WebSocket(adres);
      ws.onopen = () => { this.ws = ws; coz(); };
      ws.onerror = () => { if (!this.ws) red(new Error('could not connect to the browser')); };
      ws.onclose = () => this.koptu();
      ws.onmessage = (o) => this.mesaj(typeof o.data === 'string' ? o.data : Buffer.from(o.data).toString('utf8'));
    });
  }

  koptu() {
    if (!this.ws) return;
    this.ws = null;
    this.gunluk('browser connection closed');
    for (const [, b] of this.bekleyen) { clearTimeout(b.zt); b.red(new Error('browser closed')); }
    this.bekleyen.clear();
    this.hedefler.clear();
    this.oturumdan.clear();
    this.ana = null;
    this.gorunur.clear();
    clearTimeout(this.bosZamanlayici);
    if (this.s.olay && this.s.olay.hepsiKapandi) this.s.olay.hepsiKapandi();
    if (this.kapaniyorCoz) this.kapaniyorCoz();
  }

  // Tabs from the previous run are closed (--restore-last-session brings them back); one stays so the window stays open.
  async eskileriTopla() {
    const { targetInfos } = await this.gonder('Target.getTargets');
    const sayfalar = targetInfos.filter((t) => t.type === 'page');
    this.ana = sayfalar.length ? sayfalar[0].targetId : (await this.gonder('Target.createTarget', { url: 'about:blank' })).targetId;
    for (const t of sayfalar) if (t.targetId !== this.ana) await this.gonder('Target.closeTarget', { targetId: t.targetId }).catch(() => {});
    if (sayfalar.length && !/^about:blank/.test(sayfalar[0].url || '')) {
      // the restored page must not stay in memory
      const { sessionId } = await this.gonder('Target.attachToTarget', { targetId: this.ana, flatten: true });
      await this.gonder('Page.navigate', { url: 'about:blank' }, sessionId).catch(() => {});
      await this.gonder('Target.detachFromTarget', { sessionId }).catch(() => {});
    }
    if (!this.s.gizli) {
      try {
        const { windowId } = await this.gonder('Browser.getWindowForTarget', { targetId: this.ana });
        await this.gonder('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
      } catch (e) { /* harmless */ }
    }
  }

  // ---------------------------------------------------------------- CDP
  gonder(yontem, param, oturum, ms) {
    return new Promise((coz, red) => {
      if (!this.ws) return red(new Error('browser is closed'));
      const id = this.sira++;
      const zt = setTimeout(() => { this.bekleyen.delete(id); red(new Error(yontem + ' did not answer')); }, ms || CDP_MS);
      this.bekleyen.set(id, { coz, red, zt });
      const m = { id, method: yontem, params: param || {} };
      if (oturum) m.sessionId = oturum;
      try { this.ws.send(JSON.stringify(m)); } catch (e) { clearTimeout(zt); this.bekleyen.delete(id); red(e); }
    });
  }

  mesaj(metin) {
    let m;
    try { m = JSON.parse(metin); } catch (e) { return; }
    if (m.id) {
      const b = this.bekleyen.get(m.id);
      if (!b) return;
      this.bekleyen.delete(m.id);
      clearTimeout(b.zt);
      if (m.error) b.red(new Error(m.error.message || 'CDP error'));
      else b.coz(m.result || {});
      return;
    }
    const p = m.params || {};
    const hedef = m.sessionId ? this.oturumdan.get(m.sessionId) : null;
    const o = this.s.olay || {};
    switch (m.method) {
      case 'Page.loadEventFired':
        if (hedef && o.yuklendi) o.yuklendi(hedef);
        break;
      case 'Page.frameNavigated':
        if (hedef && p.frame && !p.frame.parentId) {
          const h = this.hedefler.get(hedef);
          if (h) h.cerceve = p.frame.id;
          if (o.adres) o.adres(hedef, p.frame.url, p.frame.unreachableUrl || '');
        }
        break;
      case 'Page.navigatedWithinDocument': { // pushState: chrome.tabs.get shows the new address too
        const h = hedef && this.hedefler.get(hedef);
        if (h && h.cerceve === p.frameId && o.adres) o.adres(hedef, p.url, '');
        break;
      }
      case 'Page.javascriptDialogOpening': // alert/confirm locks the page: closed in a reading tab
        if (m.sessionId) this.gonder('Page.handleJavaScriptDialog', { accept: false }, m.sessionId).catch(() => {});
        break;
      case 'Fetch.requestPaused':
        if (m.sessionId) this.gonder('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }, m.sessionId).catch(() => {});
        break;
      case 'Target.targetCrashed':
      case 'Target.targetDestroyed': {
        const id = p.targetId;
        if (m.method === 'Target.targetCrashed') { this.gunluk('tab crashed: ' + id); this.gonder('Target.closeTarget', { targetId: id }).catch(() => {}); }
        this.gorunur.delete(id);
        const h = this.hedefler.get(id);
        if (h) { this.hedefler.delete(id); this.oturumdan.delete(h.sessionId); if (o.kapandi) o.kapandi(id); }
        if (id === this.ana) this.ana = null;
        this.bosKontrol();
        break;
      }
      default: break;
    }
  }

  // ---------------------------------------------------------------- tabs
  // New reading tab: not visible in the tab strip, in the background (equivalent of the extension's minimized watch window).
  async sekmeAc() {
    await this.hazirla();
    clearTimeout(this.bosZamanlayici);
    let cevap;
    try {
      if (this.hiddenDesteklenmez) throw new Error('hidden not supported');
      cevap = await this.gonder('Target.createTarget', { url: 'about:blank', background: true, hidden: true });
    } catch (e) {
      if (!this.ws) throw e;
      this.hiddenDesteklenmez = true;
      cevap = await this.gonder('Target.createTarget', { url: 'about:blank', background: true });
    }
    const hedefId = cevap.targetId;
    const { sessionId } = await this.gonder('Target.attachToTarget', { targetId: hedefId, flatten: true });
    this.hedefler.set(hedefId, { sessionId, cerceve: null });
    this.oturumdan.set(sessionId, hedefId);
    await this.gonder('Page.enable', {}, sessionId);
    // image / video / font blocking: same as the extension's session rule
    await this.gonder('Fetch.enable', { patterns: [{ resourceType: 'Image' }, { resourceType: 'Media' }, { resourceType: 'Font' }] }, sessionId);
    return hedefId;
  }

  async git(hedefId, adres) {
    const h = this.hedefler.get(hedefId);
    if (!h) throw new Error('no such tab');
    const c = await this.gonder('Page.navigate', { url: adres }, h.sessionId, 60000);
    return c.errorText || '';
  }

  // Runs a function inside the page. In a SEPARATE world like the extension's executeScript: the page's own variables don't mix.
  async calistir(hedefId, kaynak, argumanlar, ms) {
    const h = this.hedefler.get(hedefId);
    if (!h) throw new Error('No tab with id ' + hedefId);
    const agac = await this.gonder('Page.getFrameTree', {}, h.sessionId);
    const dunya = await this.gonder('Page.createIsolatedWorld', { frameId: agac.frameTree.frame.id, worldName: 'pagesiren' }, h.sessionId);
    const r = await this.gonder('Runtime.evaluate', {
      expression: '(' + kaynak + ')(...' + JSON.stringify(argumanlar || []) + ')',
      contextId: dunya.executionContextId, awaitPromise: true, returnByValue: true,
    }, h.sessionId, ms || 60000);
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text || 'page script failed');
    return r.result ? r.result.value : undefined;
  }

  async sekmeKapat(hedefId) {
    const h = this.hedefler.get(hedefId);
    if (h) { this.hedefler.delete(hedefId); this.oturumdan.delete(h.sessionId); }
    if (this.ws) await this.gonder('Target.closeTarget', { targetId: hedefId }, null, 8000).catch(() => {});
    this.bosKontrol();
  }

  // A window the user will see (login / verification). Same profile: passed logins and checks hold for later reads too.
  async gorunurAc(adres) {
    await this.hazirla();
    clearTimeout(this.bosZamanlayici);
    const { targetId } = await this.gonder('Target.createTarget', { url: adres, newWindow: true });
    this.gorunur.add(targetId);
    if (!this.s.gizli) {
      try {
        const { windowId } = await this.gonder('Browser.getWindowForTarget', { targetId });
        await this.gonder('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
        await this.gonder('Browser.setWindowBounds', { windowId, bounds: { left: 90, top: 50, width: 1280, height: 880 } });
        await this.gonder('Target.activateTarget', { targetId });
      } catch (e) { this.gunluk('window could not be shown: ' + e.message); }
    }
    return targetId;
  }

  // ---------------------------------------------------------------- closing when idle
  bosKontrol() {
    clearTimeout(this.bosZamanlayici);
    if (!this.ws || this.hedefler.size || this.gorunur.size) return;
    const yasli = Date.now() - this.acilis > (this.s.yasliMs || YASLI_MS);
    this.bosZamanlayici = setTimeout(() => { this.kapat(yasli ? 'yasli' : 'bosta').catch(() => {}); }, yasli ? 0 : (this.s.bostaMs || BOSTA_MS));
    if (this.bosZamanlayici.unref) this.bosZamanlayici.unref();
  }

  async kapat(neden) {
    if (!this.ws || this.hedefler.size || this.gorunur.size) return;
    this.gunluk('closing the browser (' + neden + ')');
    await this.kapatIc();
  }

  async kapatIc() {
    // No new tabs until closing ends: don't try to open a tab in a half-closed browser
    this.kapaniyor = new Promise((coz) => { this.kapaniyorCoz = coz; });
    const zt = setTimeout(() => { if (this.ws) { try { this.ws.close(); } catch (e) { /* harmless */ } } if (this.kapaniyorCoz) this.kapaniyorCoz(); }, 6000);
    this.gonder('Browser.close', {}, null, 5000).catch(() => {});
    await this.kapaniyor;
    clearTimeout(zt);
    await this.eskiyiBitir(8000); // if a new one starts on the same profile before the process has fully exited, it can't open
    this.kapaniyor = null;
    this.kapaniyorCoz = null;
  }

  // When the program closes: open tabs close, the browser closes
  async tamKapat() {
    if (this.baslatiliyor) await this.baslatiliyor.catch(() => {});
    if (!this.ws) return;
    this.hedefler.clear();
    await this.kapatIc();
  }
}

module.exports = { Tarayici, BAYRAKLAR, tarayiciBul };

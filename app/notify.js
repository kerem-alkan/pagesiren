// =====================================================================================================
// PageSiren — OPTIONAL NOTIFICATIONS (Telegram, Discord, ntfy, webhook)
// =====================================================================================================
// Off by default: nothing leaves this computer until the user fills in a channel on the dashboard.
// Settings stay in <data>/notify.json. Tokens are never logged and never shown in full on screen.
// A failed send is retried a few times and never blocks or stops the watching.
// =====================================================================================================
'use strict';
const fs = require('fs');

const BOS = {
  telegram: { token: '', chatId: '' },
  discord: { url: '' },
  ntfy: { server: 'https://ntfy.sh', topic: '' },
  webhook: { url: '' },
};
// Fields that act like a password: masked when sent to the screen, kept as they are if the masked value comes back.
const GIZLI_ALAN = { telegram: ['token'], discord: ['url'], ntfy: ['topic'], webhook: ['url'] };
const MASKE = '••••';
const maskele = (v) => (v ? MASKE + String(v).slice(-4) : '');
const httpMi = (u) => /^https?:\/\/\S+$/i.test(String(u || ''));

class Bildirim {
  // options: { dosya, gunluk(fn), fetch(fn), telegramKok (tests), tekrarMs[] (tests) }
  constructor(secenek) {
    this.s = secenek;
    this.gunluk = secenek.gunluk || (() => {});
    this.fetch = secenek.fetch || ((...a) => globalThis.fetch(...a));
    this.telegramKok = secenek.telegramKok || 'https://api.telegram.org';
    this.tekrarMs = secenek.tekrarMs || [15000, 60000, 180000];
    this.ayar = this.yukle();
  }

  yukle() {
    let d = {};
    try { d = JSON.parse(fs.readFileSync(this.s.dosya, 'utf8')); } catch (e) { /* no file yet */ }
    const c = {};
    for (const k of Object.keys(BOS)) c[k] = Object.assign({}, BOS[k], d[k] || {});
    return c;
  }

  // Same shape as the file, with secrets masked
  ekranIcin() {
    const c = {};
    for (const k of Object.keys(BOS)) {
      c[k] = Object.assign({}, this.ayar[k]);
      for (const a of GIZLI_ALAN[k]) c[k][a] = maskele(c[k][a]);
    }
    return c;
  }

  kaydet(yeni) {
    for (const k of Object.keys(BOS)) {
      if (!yeni || !yeni[k]) continue;
      for (const a of Object.keys(BOS[k])) {
        if (yeni[k][a] == null) continue;
        const v = String(yeni[k][a]).trim();
        if (GIZLI_ALAN[k].includes(a) && v.startsWith(MASKE)) continue;
        this.ayar[k][a] = v;
      }
    }
    fs.writeFileSync(this.s.dosya, JSON.stringify(this.ayar, null, 2), { mode: 0o600 });
    return this.ekranIcin();
  }

  kurulu(kanal) {
    const a = this.ayar[kanal];
    if (kanal === 'telegram') return !!(a.token && a.chatId);
    if (kanal === 'discord') return httpMi(a.url);
    if (kanal === 'ntfy') return !!a.topic && httpMi(a.server);
    if (kanal === 'webhook') return httpMi(a.url);
    return false;
  }

  async yolla(kanal, o) {
    const a = this.ayar[kanal];
    const satirlar = o.satirlar || [];
    const metin = '🚨 ' + o.ad + '\n' + satirlar.join('\n') + (o.url ? '\n' + o.url : '');
    const adresVeGovde = {
      telegram: () => [this.telegramKok + '/bot' + a.token + '/sendMessage', { chat_id: a.chatId, text: metin.slice(0, 4000), disable_web_page_preview: true }],
      discord: () => [a.url, { content: metin.slice(0, 1900) }],
      ntfy: () => [a.server.replace(/\/+$/, ''), { topic: a.topic, title: String(o.ad).slice(0, 200), message: satirlar.join('\n').slice(0, 3500) || String(o.ad), click: o.url || undefined, priority: 5, tags: ['rotating_light'] }],
      webhook: () => [a.url, { source: 'pagesiren', name: o.ad, lines: satirlar, url: o.url, time: o.zaman }],
    }[kanal]();
    const r = await this.fetch(adresVeGovde[0], { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(adresVeGovde[1]), signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
  }

  // Sends to every configured channel. Returns at once; retries run behind.
  gonder(o) {
    for (const k of Object.keys(BOS)) if (this.kurulu(k)) this.tekrarli(k, o, 0);
  }

  async tekrarli(kanal, o, deneme) {
    try {
      await this.yolla(kanal, o);
      this.gunluk('notify: ' + kanal + ' sent');
    } catch (e) {
      // only the status or error code: an address can hold a token
      const neden = /^HTTP \d+$/.test(e && e.message) ? e.message : (e && e.name) || 'error';
      this.gunluk('notify: ' + kanal + ' failed (' + neden + '), try ' + (deneme + 1));
      if (deneme < this.tekrarMs.length) { const zt = setTimeout(() => this.tekrarli(kanal, o, deneme + 1), this.tekrarMs[deneme]); if (zt.unref) zt.unref(); }
    }
  }

  async testEt(kanal) {
    if (!BOS[kanal]) return { hata: 'unknown channel' };
    if (!this.kurulu(kanal)) return { hata: 'not configured' };
    try {
      await this.yolla(kanal, { ad: 'PageSiren', satirlar: ['Test OK'], url: '', zaman: new Date().toISOString() });
      return { ok: true };
    } catch (e) { return { hata: /^HTTP \d+$/.test(e && e.message) ? e.message : 'no connection' }; }
  }
}

module.exports = { Bildirim };

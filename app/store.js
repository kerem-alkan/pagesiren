// =====================================================================================================
// PageSiren — STORE (file-based equivalent of chrome.storage.local)
// =====================================================================================================
// Each key is its own file (izlemeler.json, motor_<id>.json...): only what changed is written, one corrupted file doesn't affect the others.
// Writes: temp file + rename (no half files after a power cut). Kept in memory as JSON TEXT: each reader gets its own
// copy (same behaviour as chrome.storage; background.js relies on it).
// =====================================================================================================
'use strict';
const fs = require('fs');
const path = require('path');

const YAZMA_GECIKMESI_MS = 1500;
// If the list gets corrupted, watches must not silently vanish and look "all fine": the last good copy (.yedek) of these keys is kept.
const YEDEKLENEN = new Set(['izlemeler', 'alarmlar', 'arsiv', 'ayarlar']);
const YEDEK_ARALIK_MS = 10 * 60e3;

class Depo {
  constructor(dizin) {
    this.dizin = dizin;
    this.veri = new Map();
    this.kirli = new Set();
    this.silinecek = new Set();
    this.sonYedek = new Map();
    this.zt = null;
    fs.mkdirSync(dizin, { recursive: true });
    const adlar = new Set();
    for (const f of fs.readdirSync(dizin)) {
      if (f.endsWith('.json')) adlar.add(f);
      else if (f.endsWith('.json.yedek')) adlar.add(f.slice(0, -6));
    }
    const okunur = (yol) => { const metin = fs.readFileSync(yol, 'utf8'); JSON.parse(metin); return metin; };
    for (const f of adlar) {
      const anahtar = decodeURIComponent(f.slice(0, -5));
      try {
        this.veri.set(anahtar, okunur(path.join(dizin, f)));
      } catch (e) {
        try {
          this.veri.set(anahtar, okunur(path.join(dizin, f + '.yedek')));
          this.kirli.add(anahtar);
          console.error('store: corrupt/missing file restored from backup: ' + f);
        } catch (e2) { console.error('store: corrupt file skipped: ' + f); }
      }
    }
    if (this.kirli.size) this.planla();
  }

  oku(k) { const m = this.veri.get(k); return m === undefined ? undefined : JSON.parse(m); }

  // chrome.storage.local interface
  async get(k) {
    if (k == null) { const o = {}; for (const [a, m] of this.veri) o[a] = JSON.parse(m); return o; }
    const anahtarlar = Array.isArray(k) ? k : [k];
    const o = {};
    for (const a of anahtarlar) { const m = this.veri.get(a); if (m !== undefined) o[a] = JSON.parse(m); }
    return o;
  }

  async set(o) {
    for (const [a, v] of Object.entries(o)) {
      if (v === undefined) continue;
      const m = JSON.stringify(v);
      if (this.veri.get(a) === m) continue;
      this.veri.set(a, m);
      this.kirli.add(a);
      this.silinecek.delete(a);
    }
    this.planla();
  }

  async remove(k) {
    for (const a of Array.isArray(k) ? k : [k]) {
      if (this.veri.delete(a)) { this.silinecek.add(a); this.kirli.delete(a); }
    }
    this.planla();
  }

  dosya(a) { return path.join(this.dizin, encodeURIComponent(a) + '.json'); }

  planla() {
    if (this.zt) return;
    this.zt = setTimeout(() => { this.zt = null; this.yaz(); }, YAZMA_GECIKMESI_MS);
  }

  yaz() {
    for (const a of this.kirli) {
      const hedef = this.dosya(a);
      const gecici = hedef + '.tmp';
      try {
        if (YEDEKLENEN.has(a) && Date.now() - (this.sonYedek.get(a) || 0) > YEDEK_ARALIK_MS && fs.existsSync(hedef)) {
          fs.copyFileSync(hedef, hedef + '.yedek');
          this.sonYedek.set(a, Date.now());
        }
        fs.writeFileSync(gecici, this.veri.get(a));
        fs.renameSync(gecici, hedef);
      } catch (e) { console.error('store: could not write ' + a + ': ' + e.message); }
    }
    this.kirli.clear();
    for (const a of this.silinecek) { try { fs.unlinkSync(this.dosya(a)); } catch (e) { /* none */ } }
    this.silinecek.clear();
  }

  hemenYaz() { clearTimeout(this.zt); this.zt = null; this.yaz(); }
}

module.exports = { Depo };

// =====================================================================================================
// PageSiren — moves a watch list (one-time)
// =====================================================================================================
// Input: a saved summary or backup JSON (/ozet, DISA_AKTAR). Baselines aren't carried over:
// every watch takes a new baseline on its first read. If the file has no "yoksay" lists they start from scratch as well.
// Usage: node app/import.js <backup.json> [--data <folder>] [--force]
// =====================================================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const { Depo } = require('./store');

function izlemeyeCevir(x, simdi) {
  const oturumDusmus = /SESSION LOST|OTURUM DÜŞMÜŞ/i.test(String(x.sorun || ''));
  return {
    id: x.id, ad: x.ad, url: x.url, aralikSn: x.aralikSn, kelimeler: x.kelimeler || '', aktif: !!x.aktif,
    durum: x.aktif ? 'hazirlaniyor' : 'duraklatildi', sorun: '', ozet: '',
    olusturma: simdi, sonYenileme: 0, sonKontrol: 0, sekmeId: null, yoksay: Array.isArray(x.yoksay) ? x.yoksay : [],
    herDegisiklik: !!x.herDegisiklik, hizli: !!x.hizli, kaliciSekme: !!x.kaliciSekme, kuyrukSessiz: !!x.kuyrukSessiz,
    girisYazisi: x.girisYazisi || '', okuyucu: ['http', 'eklenti'].includes(x.okuyucu) ? x.okuyucu : '',
    // For watches already logged out (the user knows) don't siren again at midnight; the counter resets after login
    ...(oturumDusmus ? { oturumSay: 2, oturumAlarmi: true } : {}),
  };
}

// The running program uses this too (POST /ice-aktar): the store is updated in memory as well
function depoyaYaz(oz, depo, zorla) {
  if ((depo.oku('izlemeler') || []).length && !zorla) throw new Error('the store already has watches (use --force to overwrite)');
  const simdi = Date.now();
  const kaynak = oz.disaAktar || oz;
  const izlemeler = (kaynak.izlemeler || []).filter((x) => x && x.id && x.url).map((x) => izlemeyeCevir(x, simdi));
  depo.set({ izlemeler });
  const alarmlar = (oz.disaAktar ? oz.disaAktar.alarmlar : (oz.acikAlarmlar || []).map((a) => {
    const iz = izlemeler.find((x) => x.ad === a.ad);
    return { id: a.id, izId: iz ? iz.id : 'test', ad: a.ad, url: iz ? iz.url : '', zaman: a.zaman, satirlar: a.satirlar, anahtarlar: a.anahtarlar || [], durum: 'yeni' };
  })) || [];
  depo.set({ alarmlar });
  if (oz.disaAktar && oz.disaAktar.arsiv) depo.set({ arsiv: oz.disaAktar.arsiv.map((x) => izlemeyeCevir(x, simdi)) });
  if (oz.disaAktar && oz.disaAktar.ayarlar) depo.set({ ayarlar: oz.disaAktar.ayarlar });
  depo.hemenYaz();
  return { izleme: izlemeler.length, aktif: izlemeler.filter((x) => x.aktif).length, alarm: alarmlar.length };
}

function iceAktar(oz, dizin, zorla) { return depoyaYaz(oz, new Depo(dizin), zorla); }

// Without a data folder, it's sent to the running program. Not written directly to files: this way the running program always sees the change
// (and sandboxed apps on Windows, which redirect %LOCALAPPDATA% writes to their own copy, still work).
if (require.main === module) {
  (async () => {
    const dosya = process.argv[2];
    if (!dosya) { console.error('usage: node app/import.js <backup.json> [--data <folder>] [--force]'); process.exit(2); }
    const o = JSON.parse(fs.readFileSync(dosya, 'utf8'));
    const zorla = process.argv.includes('--force');
    const vi = process.argv.indexOf('--data');
    if (vi >= 0) return console.log(JSON.stringify(iceAktar(o.ozet || o, path.join(process.argv[vi + 1], 'store'), zorla)));
    const r = await fetch('http://127.0.0.1:47431/ice-aktar' + (zorla ? '?force=1' : ''), { method: 'POST', body: JSON.stringify(o.ozet || o) });
    console.log(r.status, await r.text());
    if (!r.ok) process.exit(1);
  })().catch((e) => { console.error(String(e && e.message || e)); process.exit(1); });
}

module.exports = { iceAktar, depoyaYaz, izlemeyeCevir };

// =====================================================================================================
// PageSiren — DASHBOARD (dashboard.html)
// =====================================================================================================
// WHAT IT DOES: shows the watch list, alarm cards, recent alarms, deleted watches and settings.
//   It writes no data itself: every change goes to background.js islem() through chrome.runtime.sendMessage
//   (the only writer). The screen redraws every few seconds; while the user is editing (locked), drawing waits.
// SECTIONS: ciz() (status bar, alarm cards, watch cards) -> duzenle() -> add form -> settings -> export/import
//   -> notifications (app only: window.__PAGESIREN_APP).
// Colors: green = watching, gray = getting ready / paused, orange = problem, red = changed.
// =====================================================================================================
// When the screen opens: if the version on disk differs from the loaded one, the extension reloads. This works even if the service worker
// is stuck, because this file is read from disk at every opening.
(async () => {
  try {
    const d = await (await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' })).json();
    if (d.version && d.version !== chrome.runtime.getManifest().version) chrome.runtime.reload();
  } catch (e) { /* harmless */ }
})();

const $ = (s) => document.querySelector(s);
const el = (tag, sinif, yazi) => { const e = document.createElement(tag); if (sinif) e.className = sinif; if (yazi != null) e.textContent = yazi; return e; };
const istek = (m) => chrome.runtime.sendMessage(m);
const UYGULAMA = !!window.__PAGESIREN_APP;

const RENK = { izleniyor: 'var(--yesil)', hazirlaniyor: 'var(--gri)', duraklatildi: 'var(--gri)', sorun: 'var(--turuncu)', degisti: 'var(--kirmizi)' };
const ARALIKLAR = [30, 60, 120, 180, 300, 600, 1800];
const aralikAdi = (sn) => (sn < 60 ? T('{n} s', { n: sn }) : T('{n} min', { n: String(sn / 60).replace('.', T.dil() === 'tr' ? ',' : '.') }));
const saat = (z) => { try { return new Date(z).toLocaleString(T.dil() === 'tr' ? 'tr-TR' : undefined); } catch (e) { return z; } };
const DURUM_ADI = { yeni: 'OPEN', aldim: 'done', yanlis: 'false alarm', gec: 'dismissed', yoksay: 'ignored', tamam: 'closed' };

let kilitli = false; // while the user is editing, a redraw must not make the screen jump
let ayarlarDoldu = false;
let ilkCizim = true;
let uygulamaDurumu = null;

// Static texts in the HTML carry their English source in data-t
function metinleriCevir() {
  document.documentElement.lang = T.dil();
  for (const e of document.querySelectorAll('[data-t]')) e.textContent = T(e.dataset.t);
  const sec = $('#y_aralik');
  const secili = sec.value || '300';
  sec.textContent = '';
  for (const sn of ARALIKLAR) { const o = el('option', null, aralikAdi(sn)); o.value = sn; sec.appendChild(o); }
  sec.value = secili;
}

async function ciz() {
  if (kilitli) return;
  const odak = document.activeElement;
  if (odak && odak.tagName === 'SELECT' && $('#liste').contains(odak)) return; // an open list must not close under the user's hand
  const d = await istek({ tip: 'LISTE' });
  if (!d || d.hata) return;
  if (d.dil && d.dil !== T.dil() || ilkCizim) { T.dil(d.dil); metinleriCevir(); }
  $('#surum').textContent = T('version {v}', { v: d.surum || '?' });

  const ust = $('#ustbar');
  const aktif = d.izlemeler.filter((x) => x.aktif);
  const sorunlu = aktif.filter((x) => x.durum === 'sorun');
  if (UYGULAMA && uygulamaDurumu && !uygulamaDurumu.tarayici) {
    ust.className = 'ustbar uyari';
    ust.textContent = T('⚠ No Chrome, Edge or Brave found: only "Plain HTTP" watches can be read.');
  } else if (!UYGULAMA && !d.yardimci) {
    ust.className = 'ustbar uyari';
    ust.textContent = T('⚠ The alarm helper is not running: the red window will not open, only the sound and this screen.');
  } else {
    ust.className = 'ustbar' + (sorunlu.length ? ' uyari' : '');
    const alarmYazisi = !UYGULAMA ? ' · alarm helper is running' : d.yardimci ? ' · alarm: red desktop window' : ' · alarm: browser window';
    ust.textContent = T('Active: {a} · OK: {b}', { a: aktif.length, b: aktif.length - sorunlu.length })
      + (sorunlu.length ? T(' · {n} with problems (orange)', { n: sorunlu.length }) : '') + T(alarmYazisi);
  }

  // --- alarms
  const alarmKutu = $('#alarmlar');
  alarmKutu.textContent = '';
  for (const a of d.alarmlar.filter((x) => x.durum === 'yeni')) {
    const k = el('div', 'kart alarm');
    k.appendChild(el('div', 'baslik', '🔔 ' + a.ad));
    k.appendChild(el('div', 'kucuk', saat(a.zaman)));
    const u = el('ul', 'satirlar');
    for (const s of a.satirlar || []) u.appendChild(el('li', null, s));
    k.appendChild(u);
    const sr = el('div', 'satir');
    const bAc = el('button', 'ana', T('Open site'));
    // A lost session is fixed in the reader's own window: that is where the login must happen
    bAc.onclick = () => { if (UYGULAMA && (a.anahtarlar || []).includes('oturum')) gonder({ tip: 'SITE_AC', id: a.izId }); else window.open(a.url, '_blank'); };
    const bAldim = el('button', null, T('✓ Done — stop watching'));
    bAldim.onclick = () => kapat(a.id, 'aldim');
    const bYanlis = el('button', null, T('False alarm — don\'t ask again'));
    bYanlis.onclick = () => kapat(a.id, 'yanlis');
    const bGec = el('button', 'ikincil', T('Not now'));
    bGec.onclick = () => kapat(a.id, 'gec');
    sr.append(bAc, bAldim, bYanlis, bGec);
    k.appendChild(sr);
    alarmKutu.appendChild(k);
  }

  // --- watch list
  const liste = $('#liste');
  liste.textContent = '';
  for (const x of aktif) liste.appendChild(izlemeKarti(x));
  if (!aktif.length) liste.appendChild(el('div', 'kucuk', T('No watches yet. Add a page below.')));
  if (ilkCizim && !d.izlemeler.length) $('#ekleBlok').open = true;

  // --- paused
  const duran = $('#duraklatilanlar');
  duran.textContent = '';
  for (const x of d.izlemeler.filter((i) => !i.aktif)) {
    const k = el('div', 'kart');
    const sr = el('div', 'satir');
    sr.appendChild(el('div', 'ad', x.ad + (x.not ? ' — ' + x.not : '')));
    const b = el('button', null, T('▶ Start again'));
    b.onclick = () => gonder({ tip: 'BASLAT', id: x.id });
    const bs = el('button', 'ikincil', T('Delete'));
    bs.onclick = () => gonder({ tip: 'SIL', id: x.id });
    const sag = el('div', 'sag'); sag.append(b, bs); sr.appendChild(sag);
    k.appendChild(sr);
    duran.appendChild(k);
  }

  // --- recent alarms
  const son = $('#sonAlarmlar');
  son.textContent = '';
  for (const a of d.alarmlar.slice(0, 15)) {
    const k = el('div', 'kart');
    k.appendChild(el('div', null, a.ad + '  —  ' + T(DURUM_ADI[a.durum] || a.durum)));
    k.appendChild(el('div', 'kucuk', saat(a.zaman) + ' · ' + ((a.satirlar || [])[0] || '')));
    son.appendChild(k);
  }

  // --- deleted
  const sil = $('#silinenler');
  sil.textContent = '';
  for (const x of d.arsiv || []) {
    const k = el('div', 'kart');
    const sr = el('div', 'satir');
    sr.appendChild(el('div', 'ad', x.ad));
    const b = el('button', null, T('Restore'));
    b.onclick = () => gonder({ tip: 'GERIAL', id: x.id });
    const sag = el('div', 'sag'); sag.appendChild(b); sr.appendChild(sag);
    k.appendChild(sr);
    sil.appendChild(k);
  }

  // --- settings (filled once: a redraw must not overwrite what the user is typing)
  if (!ayarlarDoldu) {
    ayarlarDoldu = true;
    $('#a_ustte').checked = !!d.ayarlar.ustte;
    $('#a_ses').checked = !!d.ayarlar.ses;
    $('#a_sesSn').value = d.ayarlar.sesSn;
    $('#a_hafif').checked = d.ayarlar.hafifSekme !== false;
    $('#a_dil').value = d.ayarlar.dil || '';
  }
  ilkCizim = false;
}

function izlemeKarti(x) {
  const k = el('div', 'kart');
  const sr = el('div', 'satir');
  const n = el('div', 'nokta'); n.style.background = RENK[x.durum] || 'var(--gri)';
  sr.appendChild(n);
  sr.appendChild(el('div', 'ad', x.ad));

  const sec = el('select');
  // a value set from outside (e.g. 7 min) gets its own choice, otherwise the screen would show a wrong value
  const secenekler = ARALIKLAR.slice();
  if (!secenekler.includes(Number(x.aralikSn))) secenekler.push(Number(x.aralikSn));
  for (const sn of secenekler.sort((a, b) => a - b)) {
    const o = el('option', null, aralikAdi(sn)); o.value = sn; if (Number(x.aralikSn) === sn) o.selected = true;
    sec.appendChild(o);
  }
  sec.onchange = () => { sec.blur(); gonder({ tip: 'GUNCELLE', id: x.id, aralikSn: Number(sec.value) }); };
  const sag = el('div', 'sag');
  sag.appendChild(sec);
  const bAc = el('button', null, T('Open'));
  // A site the extension reads opens in the user's own browser (the session is there); others in the reader's window
  bAc.onclick = () => { if (x.okuyucu === 'eklenti') window.open(x.url, '_blank'); else gonder({ tip: 'SITE_AC', id: x.id }); };
  const bDur = el('button', null, T('Pause')); bDur.onclick = () => gonder({ tip: 'DURAKLAT', id: x.id });
  const bNob = el('button', null, T('↻ Re-arm')); bNob.onclick = () => gonder({ tip: 'NOBET', id: x.id });
  const bDuz = el('button', 'ikincil', T('Edit')); bDuz.onclick = () => duzenle(k, x);
  const bSil = el('button', 'ikincil', T('Delete')); bSil.onclick = () => { if (confirm(T('Delete {ad}? (can be restored)', { ad: x.ad }))) gonder({ tip: 'SIL', id: x.id }); };
  sag.append(bAc, bDur, bNob, bDuz, bSil);
  sr.appendChild(sag);
  k.appendChild(sr);

  if (x.ozet) k.appendChild(el('div', 'ozet', x.ozet));
  if (x.sorun) k.appendChild(el('div', 'sorun', '⚠ ' + x.sorun));
  const bilgi = [];
  if (x.kelimeler) bilgi.push(T('words: {k}', { k: x.kelimeler }));
  if (x.herDegisiklik) bilgi.push(T('alarm on every change'));
  if (x.hizli) bilgi.push(T('fast mode'));
  if (x.girisYazisi) bilgi.push(T('login check on'));
  if (x.okuyucu) bilgi.push(T(x.okuyucu === 'http' ? 'read without a browser' : 'read by the Chrome extension'));
  if (x.sonKontrol) bilgi.push(T('last read: {n} s ago', { n: Math.round((Date.now() - x.sonKontrol) / 1000) }));
  if (bilgi.length) k.appendChild(el('div', 'kucuk', bilgi.join(' · ')));
  return k;
}

function duzenle(kart, x) {
  kilitli = true;
  const d = el('div', 'kart');
  const girdi = (tip, deger) => { const i = el('input'); i.type = tip; if (tip === 'checkbox') i.checked = !!deger; else i.value = deger || ''; return i; };
  const isaret = (kutu, yazi) => { const l = el('label'); l.append(kutu, document.createTextNode(' ' + yazi)); return l; };
  const ad = girdi('text', x.ad);
  const url = girdi('url', x.url);
  const kel = girdi('text', x.kelimeler);
  const giris = girdi('text', x.girisYazisi);
  const her = girdi('checkbox', x.herDegisiklik);
  const hizli = girdi('checkbox', x.hizli);
  const kalici = girdi('checkbox', x.kaliciSekme);
  d.append(el('label', null, T('Name')), ad, el('label', null, T('Address')), url, el('label', null, T('Words (comma-separated)')), kel,
    el('label', null, T('Login check: text you can only see when logged in (optional)')), giris,
    isaret(her, T('Alarm on every change')), isaret(hizli, T('Fast: alarm on the first read when a "sold out" text goes away')), isaret(kalici, T('Keep the tab open between reads (for slow pages)')));
  let okuyucu = null;
  if (UYGULAMA) {
    okuyucu = el('select');
    for (const [v, y] of [['', 'Separate browser (handles JavaScript and logins)'], ['http', 'Plain HTTP (lightest, no JavaScript)'], ['eklenti', 'My Chrome extension (Windows, extension installed)']]) {
      const o = el('option', null, T(y)); o.value = v; if ((x.okuyucu || '') === v) o.selected = true; okuyucu.appendChild(o);
    }
    d.append(el('label', null, T('Who reads the page')), okuyucu);
  }
  const sr = el('div', 'satir'); sr.style.marginTop = '10px';
  const kaydet = el('button', 'ana', T('Save'));
  kaydet.onclick = () => gonder({
    tip: 'GUNCELLE', id: x.id, ad: ad.value, url: url.value, kelimeler: kel.value, girisYazisi: giris.value,
    herDegisiklik: her.checked, hizli: hizli.checked, kaliciSekme: kalici.checked, ...(okuyucu ? { okuyucu: okuyucu.value } : {}),
  });
  const vazgec = el('button', 'ikincil', T('Cancel'));
  vazgec.onclick = () => { kilitli = false; ciz(); };
  sr.append(kaydet, vazgec);
  d.appendChild(sr);
  kart.replaceChildren(d);
}

async function gonder(m) { kilitli = false; await istek(m); ciz(); }
async function kapat(id, islem) { await istek({ tip: 'ALARM_KAPAT', alarmId: id, islem }); ciz(); }

$('#ekleBtn').onclick = async () => {
  const c = await istek({
    tip: 'EKLE', ad: $('#y_ad').value, url: $('#y_url').value, aralikSn: Number($('#y_aralik').value),
    kelimeler: $('#y_kelime').value, herDegisiklik: $('#y_her').checked, girisYazisi: $('#y_giris').value,
    hizli: $('#y_hizli').checked, kaliciSekme: $('#y_kalici').checked, okuyucu: $('#y_okuyucu').value,
  });
  if (c && c.hata) { $('#ekleHata').textContent = c.hata; return; }
  $('#ekleHata').textContent = '';
  for (const s of ['#y_ad', '#y_url', '#y_kelime', '#y_giris']) $(s).value = '';
  for (const s of ['#y_her', '#y_hizli', '#y_kalici']) $(s).checked = false;
  $('#y_okuyucu').value = '';
  $('#ekleBlok').open = false;
  ciz();
};
$('#hepsiNobet').onclick = () => { if (confirm(T('Treat the current state of all pages as "normal"?'))) gonder({ tip: 'NOBET_HEPSI' }); };

// --- settings
$('#a_dil').onchange = async () => {
  await istek({ tip: 'AYAR', ayarlar: { dil: $('#a_dil').value } });
  ilkCizim = true;
  ciz();
};
$('#ayarKaydet').onclick = async () => {
  await istek({ tip: 'AYAR', ayarlar: { ustte: $('#a_ustte').checked, ses: $('#a_ses').checked, sesSn: Number($('#a_sesSn').value) || 60, hafifSekme: $('#a_hafif').checked } });
  let sonuc = T('Saved.');
  if (UYGULAMA) {
    const r = await istek({ tip: 'APP_OTOBASLAT', acik: $('#a_oto').checked });
    if (r && r.hata) sonuc = T('Not sent: {neden}', { neden: r.hata });
  }
  $('#ayarSonuc').textContent = sonuc;
};
$('#testAlarm').onclick = () => istek({ tip: 'TEST_ALARM' });

// --- export / import: only what the user typed, never baselines or sessions
const DISA_ALANLAR = ['ad', 'url', 'aralikSn', 'kelimeler', 'herDegisiklik', 'hizli', 'kaliciSekme', 'girisYazisi', 'okuyucu', 'aktif'];
$('#disaAktar').onclick = async () => {
  const d = await istek({ tip: 'LISTE' });
  const izlemeler = d.izlemeler.map((x) => Object.fromEntries(DISA_ALANLAR.filter((a) => x[a] !== undefined).map((a) => [a, x[a]])));
  const a = el('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ pagesiren: 1, izlemeler }, null, 2)], { type: 'application/json' }));
  a.download = 'pagesiren-watches.json';
  a.click();
  URL.revokeObjectURL(a.href);
};
$('#iceAktar').onclick = () => $('#iceDosya').click();
$('#iceDosya').onchange = async () => {
  const f = $('#iceDosya').files[0];
  $('#iceDosya').value = '';
  if (!f) return;
  let o = null;
  try { o = JSON.parse(await f.text()); } catch (e) { /* reported below */ }
  if (!o || !o.pagesiren || !Array.isArray(o.izlemeler)) { $('#ayarSonuc').textContent = T('This file is not a PageSiren export.'); return; }
  let n = 0;
  for (const x of o.izlemeler) {
    const c = await istek({ tip: 'EKLE', ...x });
    if (c && c.ok) { n++; if (x.aktif === false) await istek({ tip: 'DURAKLAT', id: c.id }); }
  }
  $('#ayarSonuc').textContent = T('Imported: {n}.', { n });
  ciz();
};

// --- notifications (app only)
const KANALLAR = [
  ['telegram', 'Telegram', [['token', 'Bot token'], ['chatId', 'Chat ID']]],
  ['discord', 'Discord', [['url', 'Webhook address']]],
  ['ntfy', 'ntfy', [['server', 'Server'], ['topic', 'Topic']]],
  ['webhook', 'Webhook', [['url', 'Address']]],
];
function bildirimleriCiz(ayar) {
  const kutu = $('#bildirimler');
  kutu.textContent = '';
  for (const [k, ad, alanlar] of KANALLAR) {
    kutu.appendChild(el('h3', null, ad));
    const sr = el('div', 'ikili');
    for (const [a, y] of alanlar) {
      const c = el('div');
      const l = el('label', null, T(y));
      const i = el('input'); i.type = 'text'; i.id = 'b_' + k + '_' + a; i.value = (ayar[k] && ayar[k][a]) || ''; i.autocomplete = 'off';
      c.append(l, i);
      sr.appendChild(c);
    }
    kutu.appendChild(sr);
    const t = el('button', 'ikincil kucukBtn', T('Send a test')); t.style.marginTop = '6px';
    const s = el('span', 'kucuk'); s.style.marginLeft = '8px';
    t.onclick = async () => {
      await bildirimKaydet();
      const r = await istek({ tip: 'APP_BILDIRIM_TEST', kanal: k });
      s.textContent = r && r.ok ? T('Sent.') : T('Not sent: {neden}', { neden: (r && r.hata) || '?' });
    };
    kutu.append(t, s);
  }
}
async function bildirimKaydet() {
  const ayar = {};
  for (const [k, , alanlar] of KANALLAR) { ayar[k] = {}; for (const [a] of alanlar) ayar[k][a] = $('#b_' + k + '_' + a).value; }
  const r = await istek({ tip: 'APP_BILDIRIM_KAYDET', ayar });
  return r && r.bildirim;
}
$('#bildirimKaydet').onclick = async () => {
  const b = await bildirimKaydet();
  if (b) bildirimleriCiz(b);
  $('#bildirimSonuc').textContent = T('Saved.');
};

(async () => {
  if (UYGULAMA) {
    for (const e of document.querySelectorAll('.sadeceUygulama')) e.hidden = false;
    uygulamaDurumu = await istek({ tip: 'APP_DURUM' });
    $('#a_oto').checked = !!uygulamaDurumu.otoBaslat;
  }
  await ciz();
  if (UYGULAMA && uygulamaDurumu) bildirimleriCiz(uygulamaDurumu.bildirim);
  setInterval(ciz, 5000);
})();

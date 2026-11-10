// =====================================================================================================
// PageSiren — DASHBOARD (dashboard.html)
// =====================================================================================================
// WHAT IT DOES: a filter column (all, active, problems, bot check, paused, got it, deleted), open alarms, and the watch cards.
//   A card shows when the watch was added, a slider for how often it checks, and opens to show its own alarm history.
//   Adding a page and the settings sit at the top. It writes no data itself: every change goes to background.js islem()
//   through chrome.runtime.sendMessage (the only writer). The screen redraws every few seconds; while the user edits a card
//   or drags a slider, drawing waits, and focus is put back where it was.
// Colors: green = watching, gray = getting ready / paused, orange = problem, red = changed. A text badge says the same.
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

// the badge on a card ('Paused' is the name of the filter, so the badge says 'On hold')
const DURUM = { izleniyor: 'Watching', hazirlaniyor: 'Getting ready', duraklatildi: 'On hold', sorun: 'Problem', degisti: 'Changed' };
const DURUM_ADI = { yeni: 'OPEN', aldim: 'got it', yanlis: 'false alarm', gec: 'dismissed', yoksay: 'ignored', tamam: 'closed' };
// the slider's steps: seconds, minutes, hours, a day
const ARALIKLAR = [30, 60, 120, 180, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400];
const sayiYaz = (n) => String(Math.round(n * 10) / 10).replace('.', T.dil() === 'en' ? '.' : ',');
const aralikAdi = (sn) => (sn < 60 ? T('{n} s', { n: sn }) : sn < 3600 ? T('{n} min', { n: sayiYaz(sn / 60) })
  : sn < 86400 ? T('{n} h', { n: sayiYaz(sn / 3600) }) : T('{n} d', { n: sayiYaz(sn / 86400) }));
const sure = (ms) => aralikAdi(Math.max(1, Math.round(ms / 1000)) < 60 ? Math.max(1, Math.round(ms / 1000)) : Math.round(ms / 60000) * 60);
// dates in the interface language, not the computer's: an English screen on a Turkish computer says "Nov 10"
const saat = (z) => { try { return new Date(z).toLocaleString(T.dil(), { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return String(z); } };
const hostu = (u) => { try { return new URL(u).host; } catch (e) { return u; } };

// Which list is shown. The archive kinds come from background.js arsiv: 'alindi' (Got it) and 'silindi' (Deleted).
const FILTRELER = [
  { ad: 'hepsi', yazi: 'All', uyar: () => true },
  { ad: 'aktif', yazi: 'Active', uyar: (x) => x.aktif, renk: 'd-izleniyor' },
  { ad: 'sorun', yazi: 'Problems', uyar: (x) => x.aktif && x.durum === 'sorun', renk: 'd-sorun' },
  { ad: 'bot', yazi: 'Bot check', uyar: (x) => x.aktif && !!x.botDuvari, renk: 'd-bot' },
  { ad: 'duran', yazi: 'Paused', uyar: (x) => !x.aktif },
  { ad: 'alindi', yazi: 'Got it', arsiv: true },
  { ad: 'silindi', yazi: 'Deleted', arsiv: true },
];

let son = null;
let filtre = (() => { try { return localStorage.getItem('pagesiren.filtre') || 'hepsi'; } catch (e) { return 'hepsi'; } })();
if (!FILTRELER.some((f) => f.ad === filtre)) filtre = 'hepsi';
let arama = '';
let detay = null;           // the watch whose details panel is open: { id, mod: 'bilgi' | 'duzenle', imza, acan }
const detayKutu = $('#detay');
const gecmisler = new Map(); // watch id -> { say, alarmlar }
let kilitli = false;         // a card is being edited: a redraw must not throw the typing away
let suruklenen = false;      // a slider is being dragged
let ayarlarDoldu = false;
let ilkCizim = true;
let uygulamaDurumu = null;
let tostZamani = null;

// Static texts in the HTML carry their English source in data-t
function metinleriCevir() {
  document.documentElement.lang = T.dil();
  for (const e of document.querySelectorAll('[data-t]')) e.textContent = T(e.dataset.t);
  $('#ara').placeholder = T('Search watches');
  ekleAraligiYaz();
}

// The redraw replaces the cards: the focused control is found again by its data-odak key.
const odakAnahtari = () => { const e = document.activeElement; return e && e.dataset ? e.dataset.odak || null : null; };
function odagiGeriVer(k) {
  if (!k) return;
  const e = [...document.querySelectorAll('[data-odak]')].find((x) => x.dataset.odak === k);
  if (e) e.focus({ preventScroll: true });
}

async function ciz() {
  if (kilitli || suruklenen) return;
  const d = await istek({ tip: 'LISTE', hafif: true });
  if (!d || d.hata) return;
  son = d;
  if (d.dil && d.dil !== T.dil() || ilkCizim) { T.dil(d.dil); metinleriCevir(); }
  $('#surum').textContent = T('version {v}', { v: d.surum || '?' });
  // open alarms show in the tab title too, for a dashboard left in a background tab
  const acikAlarm = (d.alarmlar || []).filter((a) => a.durum === 'yeni').length;
  document.title = (acikAlarm ? '(' + acikAlarm + ') ' : '') + 'PageSiren';

  const ust = $('#ustbar');
  const aktif = d.izlemeler.filter((x) => x.aktif);
  const sorunlu = aktif.filter((x) => x.durum === 'sorun');
  if (UYGULAMA && uygulamaDurumu && !uygulamaDurumu.tarayici) {
    ust.className = 'durumOzet uyari';
    ust.textContent = T('⚠ No Chrome, Edge or Brave found: only "Plain HTTP" watches can be read.');
  } else if (!UYGULAMA && !d.yardimci) {
    ust.className = 'durumOzet uyari';
    ust.textContent = T('⚠ The alarm helper is not running: the red window will not open, only the sound and this screen.');
  } else {
    ust.className = 'durumOzet' + (sorunlu.length ? ' uyari' : '');
    const alarmYazisi = !UYGULAMA ? ' · alarm helper is running' : d.yardimci ? ' · alarm: red desktop window' : ' · alarm: browser window';
    ust.textContent = T('Active: {a} · OK: {b}', { a: aktif.length, b: aktif.length - sorunlu.length })
      + (sorunlu.length ? T(' · {n} with problems (orange)', { n: sorunlu.length }) : '') + T(alarmYazisi);
  }

  const odak = odakAnahtari();
  filtreleriCiz(d);
  alarmlariCiz(d);
  listeyiCiz(d);
  if (detay && detayKutu.open) { const x = d.izlemeler.find((i) => i.id === detay.id); if (x) detayCiz(x); else detayKutu.close(); }
  odagiGeriVer(odak);

  // settings (filled once: a redraw must not overwrite what the user is typing)
  if (!ayarlarDoldu) {
    ayarlarDoldu = true;
    $('#a_ustte').checked = !!d.ayarlar.ustte;
    $('#a_ses').checked = !!d.ayarlar.ses;
    $('#a_sesSn').value = d.ayarlar.sesSn;
    $('#a_hafif').checked = d.ayarlar.hafifSekme !== false;
    $('#a_dil').value = d.ayarlar.dil || '';
  }
  if (ilkCizim && !d.izlemeler.length) panelAc('ekle', true, false);
  ilkCizim = false;
}

function sayilar(d) {
  const s = {};
  for (const f of FILTRELER) s[f.ad] = f.arsiv ? (d.arsiv || []).filter((x) => x.neden === f.ad).length : d.izlemeler.filter(f.uyar).length;
  return s;
}

function filtreleriCiz(d) {
  const nav = $('#filtreler');
  for (const e of nav.querySelectorAll('.filtre, .filtreAyrac')) e.remove();
  const s = sayilar(d);
  for (const f of FILTRELER) {
    if (f.ad === 'alindi') nav.appendChild(el('div', 'filtreAyrac'));
    const b = el('button', 'filtre' + (f.renk ? ' ' + f.renk : ''));
    b.type = 'button';
    b.dataset.odak = 'filtre-' + f.ad;
    b.setAttribute('aria-pressed', String(filtre === f.ad));
    const nokta = el('span', 'fNokta'); nokta.setAttribute('aria-hidden', 'true');
    b.append(nokta, el('span', null, T(f.yazi)), el('span', 'sayi', String(s[f.ad])));
    b.onclick = () => {
      filtre = f.ad;
      try { localStorage.setItem('pagesiren.filtre', filtre); } catch (e) { /* private mode */ }
      ciz();
    };
    nav.appendChild(b);
  }
}

function alarmlariCiz(d) {
  const kutu = $('#alarmlar');
  kutu.textContent = '';
  const acik = (d.alarmlar || []).filter((x) => x.durum === 'yeni');
  $('#alarmBolumu').hidden = !acik.length;
  for (const a of acik) {
    const k = el('article', 'kart alarm');
    k.appendChild(el('h3', 'alarmBaslik', '🔔 ' + a.ad));
    k.appendChild(el('div', 'meta', saat(a.zaman)));
    const u = el('ul', 'satirlar');
    for (const s of a.satirlar || []) u.appendChild(el('li', null, s));
    k.appendChild(u);
    const sr = el('div', 'dugmeler');
    const bAc = dugme(T('Open site'), 'ana', 'alarm-ac-' + a.id);
    // A lost session is fixed in the reader's own window: that is where the login must happen
    bAc.onclick = () => { if (UYGULAMA && (a.anahtarlar || []).includes('oturum')) gonder({ tip: 'SITE_AC', id: a.izId }); else window.open(a.url, '_blank'); };
    const bAldim = dugme(T('✓ Got it — stop watching'), null, 'alarm-aldim-' + a.id);
    bAldim.onclick = async () => { await kapat(a.id, 'aldim'); tost(T('{ad} moved to Got it.', { ad: a.ad }), () => istek({ tip: 'GERIAL', id: a.izId })); };
    const bYanlis = dugme(T('False alarm — don\'t ask again'), null, 'alarm-yanlis-' + a.id);
    bYanlis.onclick = () => kapat(a.id, 'yanlis');
    const bGec = dugme(T('Not now'), 'ikincil', 'alarm-gec-' + a.id);
    bGec.onclick = () => kapat(a.id, 'gec');
    sr.append(bAc, bAldim, bYanlis, bGec);
    k.appendChild(sr);
    kutu.appendChild(k);
  }
}

function listeyiCiz(d) {
  const f = FILTRELER.find((x) => x.ad === filtre) || FILTRELER[0];
  $('#listeBaslik').textContent = T(f.yazi);
  $('#hepsiNobet').hidden = f.arsiv || !d.izlemeler.some((x) => x.aktif);
  const liste = $('#liste');
  liste.textContent = '';
  const bulur = (x) => !arama || (x.ad + ' ' + x.url).toLocaleLowerCase().includes(arama);
  if (f.arsiv) {
    const kayitlar = (d.arsiv || []).filter((x) => x.neden === f.ad && bulur(x));
    for (const x of kayitlar) liste.appendChild(arsivKarti(x));
    if (!kayitlar.length) liste.appendChild(el('div', 'bos', T('No watches here.')));
    return;
  }
  // The order never changes by itself: a card whose state changes must not jump away from under the pointer.
  // What needs attention is at the top anyway, as an open alarm, and in the Problems filter.
  const izler = d.izlemeler.filter((x) => f.uyar(x) && bulur(x));
  for (const x of izler) liste.appendChild(izlemeKarti(x));
  if (!izler.length) {
    const bos = el('div', 'bos', T(d.izlemeler.length ? 'No watches here.' : 'No watches yet. Add a page with the button above.'));
    liste.appendChild(bos);
  }
}

function dugme(yazi, sinif, odak) {
  const b = el('button', sinif || null, yazi);
  b.type = 'button';
  if (odak) b.dataset.odak = odak;
  return b;
}

function izlemeKarti(x) {
  const durum = x.aktif ? x.durum : 'duraklatildi';
  const k = el('article', 'kart tiklanir d-' + durum);
  const ust = el('div', 'kartUst');
  const nokta = el('span', 'nokta'); nokta.setAttribute('aria-hidden', 'true');
  ust.append(nokta, el('h3', 'kartAd', x.ad), el('span', 'rozet', T(DURUM[durum] || 'Watching')));
  k.appendChild(ust);
  const meta = metaYazisi(x);
  if (meta) k.appendChild(el('div', 'meta', meta));
  if (x.ozet && x.aktif) k.appendChild(el('div', 'ozet', x.ozet));
  if (x.sorun && x.aktif) k.appendChild(el('div', 'sorun', '⚠ ' + x.sorun));
  const bilgi = bilgiYazisi(x);
  if (bilgi) k.appendChild(el('div', 'bilgi', bilgi));
  k.appendChild(aralikCubugu(x, ''));
  k.appendChild(eylemler(x, ''));
  const gb = dugme(T('Details and alarms ({n})', { n: x.alarmSay || 0 }), 'gecmisAc ikincil', 'detay-' + x.id);
  gb.setAttribute('aria-haspopup', 'dialog');
  gb.onclick = () => detayAc(x.id, 'bilgi', 'detay-' + x.id);
  k.appendChild(gb);
  // a click on the card itself opens its details too; buttons and the slider keep their own clicks, and selecting text is not a click
  k.addEventListener('click', (e) => {
    if (e.target.closest('button, a, input, select, label, textarea, summary')) return;
    if (String(window.getSelection ? window.getSelection() : '').trim()) return;
    detayAc(x.id, 'bilgi', 'detay-' + x.id);
  });
  return k;
}

function metaYazisi(x) {
  const m = [];
  if (x.olusturma) m.push(T('Added {t}', { t: saat(x.olusturma) }));
  if (x.sonKontrol) m.push(T('last read: {t} ago', { t: sure(Date.now() - x.sonKontrol) }));
  if (x.alarmSay) m.push(T('Alarms: {n} · last {t}', { n: x.alarmSay, t: saat(x.sonAlarm) }));
  return m.join(' · ');
}
function bilgiYazisi(x) {
  const b = [];
  if (x.kelimeler) b.push(T('words: {k}', { k: x.kelimeler }));
  if (x.herDegisiklik) b.push(T('alarm on every change'));
  if (x.hizli) b.push(T('fast mode'));
  if (x.girisYazisi) b.push(T('login check on'));
  if (x.okuyucu) b.push(T(x.okuyucu === 'http' ? 'read without a browser' : 'read by the Chrome extension'));
  return b.join(' · ');
}

// A watch's buttons, on its card and in its details panel (onEk keeps their focus keys apart)
function eylemler(x, onEk) {
  const dg = el('div', 'dugmeler');
  const bAc = dugme(T('Open'), null, onEk + 'ac-' + x.id);
  // A site the extension reads opens in the user's own browser (the session is there); others in the reader's window
  bAc.onclick = () => { if (x.okuyucu === 'eklenti') window.open(x.url, '_blank'); else gonder({ tip: 'SITE_AC', id: x.id }); };
  dg.appendChild(bAc);
  if (x.aktif) {
    const bDur = dugme(T('Pause'), null, onEk + 'dur-' + x.id); bDur.onclick = () => gonder({ tip: 'DURAKLAT', id: x.id });
    const bNob = dugme(T('↻ Re-arm'), null, onEk + 'nob-' + x.id); bNob.onclick = () => gonder({ tip: 'NOBET', id: x.id });
    dg.append(bDur, bNob);
  } else {
    const bBas = dugme(T('▶ Start again'), null, onEk + 'bas-' + x.id); bBas.onclick = () => gonder({ tip: 'BASLAT', id: x.id });
    dg.appendChild(bBas);
  }
  const bDuz = dugme(T('Edit'), 'ikincil', onEk + 'duz-' + x.id);
  bDuz.onclick = () => { if (detay && detayKutu.open && detay.id === x.id) detayModu('duzenle'); else detayAc(x.id, 'duzenle', onEk + 'duz-' + x.id); };
  const bAldim = dugme(T('✓ Got it'), 'ikincil', onEk + 'aldim-' + x.id);
  bAldim.onclick = async () => {
    await istek({ tip: 'ALDIM', id: x.id });
    if (detayKutu.open) detayKutu.close();
    tost(T('{ad} moved to Got it.', { ad: x.ad }), () => istek({ tip: 'GERIAL', id: x.id }));
    ciz();
  };
  const bSil = dugme(T('Delete'), 'ikincil tehlike', onEk + 'sil-' + x.id);
  bSil.onclick = async () => {
    await istek({ tip: 'SIL', id: x.id });
    if (detayKutu.open) detayKutu.close();
    tost(T('{ad} moved to Deleted.', { ad: x.ad }), () => istek({ tip: 'GERIAL', id: x.id }));
    ciz();
  };
  dg.append(bDuz, bAldim, bSil);
  return dg;
}

// --- details: a panel that slides in from the right over the dimmed page, so the cards never move.
// It is a modal dialog: Esc closes it, focus stays inside, and goes back to the button that opened it.
function detayAc(id, mod, acan) {
  const x = son && son.izlemeler.find((i) => i.id === id);
  if (!x) return;
  detay = { id, mod: mod || 'bilgi', imza: '', acan: acan || null };
  kilitli = detay.mod === 'duzenle';
  detayCiz(x, true);
  if (!detayKutu.open) detayKutu.showModal();
  odakla();
}
function detayModu(mod) {
  if (!detay) return;
  detay.mod = mod;
  kilitli = mod === 'duzenle';
  const x = son && son.izlemeler.find((i) => i.id === detay.id);
  if (x) detayCiz(x, true);
  odakla();
}
function odakla() {
  const hedef = detay && detay.mod === 'duzenle' ? detayKutu.querySelector('input') : detayKutu.querySelector('.kapatX');
  if (hedef) hedef.focus();
}
detayKutu.addEventListener('close', () => {
  const acan = detay && detay.acan;
  detay = null;
  kilitli = false;
  ciz().then(() => { if (acan) odagiGeriVer(acan); });
});
// a click on the dimmed page beside the panel closes it (the panel itself is covered by its children)
detayKutu.addEventListener('click', (e) => { if (e.target === detayKutu) detayKutu.close(); });

const detayImzasi = (x) => JSON.stringify([x.ad, x.url, x.aktif, x.durum, x.ozet, x.sorun, x.aralikSn, x.alarmSay, x.kelimeler, x.herDegisiklik, x.hizli, x.girisYazisi, x.okuyucu, T.dil()]);

function detayUst(x, baslik) {
  const durum = x.aktif ? x.durum : 'duraklatildi';
  const ust = el('div', 'cekmeceUst d-' + durum);
  const nokta = el('span', 'nokta'); nokta.setAttribute('aria-hidden', 'true');
  const h = el('h2', 'cekmeceBaslik', baslik || x.ad); h.id = 'detayBaslik';
  ust.append(nokta, h);
  if (!baslik) ust.appendChild(el('span', 'rozet', T(DURUM[durum] || 'Watching')));
  const k = dugme('×', 'kapatX', 'detay-kapat');
  k.setAttribute('aria-label', T('Close'));
  k.onclick = () => detayKutu.close();
  ust.appendChild(k);
  return ust;
}

// Redrawn only when something on it changed: reading the history must not jump every five seconds
function detayCiz(x, zorla) {
  if (!detay || detay.id !== x.id) return;
  if (detay.mod === 'duzenle') { if (zorla) detayKutu.replaceChildren(detayUst(x, T('Edit')), duzenleGovde(x)); return; }
  const imza = detayImzasi(x);
  if (!zorla && imza === detay.imza) {
    const m = detayKutu.querySelector('.cekmeceGovde > .meta');
    if (m) m.textContent = metaYazisi(x);
    return;
  }
  detay.imza = imza;
  const eski = detayKutu.querySelector('.cekmeceGovde');
  const kaydirma = eski ? eski.scrollTop : 0;
  const odak = odakAnahtari();
  const govde = el('div', 'cekmeceGovde');
  if (x.ozet && x.aktif) govde.appendChild(el('div', 'ozet', x.ozet));
  if (x.sorun && x.aktif) govde.appendChild(el('div', 'sorun', '⚠ ' + x.sorun));
  govde.appendChild(el('div', 'meta', metaYazisi(x)));
  const adres = el('div', 'adres');
  const a = el('a', null, x.url); a.href = x.url; a.target = '_blank'; a.rel = 'noopener';
  adres.append(T('Address') + ': ', a);
  govde.appendChild(adres);
  const bilgi = bilgiYazisi(x);
  if (bilgi) govde.appendChild(el('div', 'bilgi', bilgi));
  govde.appendChild(aralikCubugu(x, 'dt-'));
  govde.appendChild(eylemler(x, 'dt-'));
  const gecmis = el('section', 'gecmis');
  govde.appendChild(gecmis);
  detayKutu.replaceChildren(detayUst(x), govde);
  govde.scrollTop = kaydirma;
  odagiGeriVer(odak);
  gecmisiCiz(gecmis, x).then(() => { govde.scrollTop = kaydirma; });
}

async function gecmisiCiz(kutu, x) {
  const say = x.alarmSay || 0;
  const onbellek = gecmisler.get(x.id);
  if (!onbellek || onbellek.say !== say) {
    if (!onbellek) kutu.textContent = T('loading…');
    const r = await istek({ tip: 'ALARM_GECMISI', id: x.id });
    gecmisler.set(x.id, { say, alarmlar: (r && r.alarmlar) || [] });
  }
  const { alarmlar } = gecmisler.get(x.id);
  kutu.textContent = '';
  kutu.appendChild(el('h3', null, T('Alarm history')));
  if (!alarmlar.length) { kutu.appendChild(el('div', 'kucuk', T(say ? 'Older alarms are no longer kept.' : 'No alarms yet.'))); return; }
  const ol = el('ol');
  for (const al of alarmlar) {
    const li = el('li');
    li.append(el('span', 'zaman', saat(al.zaman)), ' · ' + T(DURUM_ADI[al.durum] || al.durum));
    const u = el('ul', 'satirlar');
    for (const s0 of (al.satirlar || []).slice(0, 4)) u.appendChild(el('li', null, s0));
    li.appendChild(u);
    ol.appendChild(li);
  }
  kutu.appendChild(ol);
  if (say > alarmlar.length) kutu.appendChild(el('div', 'kucuk', T('Older alarms are no longer kept.')));
}

// How often to check, from 30 seconds to a day. It applies from the next read.
function aralikCubugu(x, onEk) {
  const sn0 = Number(x.aralikSn) || 300;
  const adimlar = ARALIKLAR.includes(sn0) ? ARALIKLAR : ARALIKLAR.concat(sn0).sort((a, b) => a - b);
  const kutu = el('div', 'aralik');
  const r = el('input');
  r.type = 'range'; r.id = 'ar_' + onEk + x.id; r.min = '0'; r.max = String(adimlar.length - 1); r.step = '1';
  r.value = String(adimlar.indexOf(sn0)); r.dataset.odak = onEk + 'aralik-' + x.id;
  const etiket = el('label'); etiket.htmlFor = r.id;
  const deger = el('b');
  const [on, arka] = T('Checks every {t}').split('{t}');
  etiket.append(on, deger, arka || '');
  const yaz = () => { const sn = adimlar[Number(r.value)]; deger.textContent = aralikAdi(sn); r.setAttribute('aria-valuetext', aralikAdi(sn)); };
  yaz();
  r.addEventListener('pointerdown', () => { suruklenen = true; });
  r.addEventListener('pointerup', () => { setTimeout(() => { suruklenen = false; }, 300); });
  r.addEventListener('blur', () => { suruklenen = false; });
  r.addEventListener('input', yaz);
  r.addEventListener('change', async () => {
    suruklenen = false;
    const sn = adimlar[Number(r.value)];
    if (sn === sn0) return;
    await istek({ tip: 'GUNCELLE', id: x.id, aralikSn: sn });
    tost(T('{ad}: checks every {t} from the next read.', { ad: x.ad, t: aralikAdi(sn) }));
    ciz();
  });
  const olcek = el('div', 'olcek'); olcek.setAttribute('aria-hidden', 'true');
  olcek.append(el('span', null, aralikAdi(adimlar[0])), el('span', null, aralikAdi(adimlar[adimlar.length - 1])));
  kutu.append(etiket, r, olcek);
  return kutu;
}

function arsivKarti(x) {
  const alindi = x.neden === 'alindi';
  const k = el('article', 'kart');
  const ust = el('div', 'kartUst');
  const nokta = el('span', 'nokta'); nokta.setAttribute('aria-hidden', 'true');
  ust.append(nokta, el('h3', 'kartAd', x.ad));
  k.appendChild(ust);
  const meta = [alindi ? T('Got it {t}', { t: saat(x.alinma) }) : T('Deleted {t}', { t: saat(x.silinme) })];
  if (x.olusturma) meta.push(T('Added {t}', { t: saat(x.olusturma) }));
  if (x.alarmSay) meta.push(T('Alarms: {n} · last {t}', { n: x.alarmSay, t: saat(x.sonAlarm) }));
  k.appendChild(el('div', 'meta', meta.join(' · ')));
  const adres = el('div', 'adres');
  const a = el('a', null, hostu(x.url)); a.href = x.url; a.target = '_blank'; a.rel = 'noopener';
  adres.appendChild(a);
  k.appendChild(adres);
  const dg = el('div', 'dugmeler');
  const bGeri = dugme(T(alindi ? 'Watch again' : 'Restore'), null, 'geri-' + x.id);
  bGeri.onclick = () => gonder({ tip: 'GERIAL', id: x.id });
  const bSil = dugme(T('Delete forever'), 'ikincil tehlike', 'kalici-' + x.id);
  bSil.onclick = () => { if (confirm(T('Delete {ad} for good? Its alarm history goes too. This cannot be undone.', { ad: x.ad }))) gonder({ tip: 'KALICI_SIL', id: x.id }); };
  dg.append(bGeri, bSil);
  k.appendChild(dg);
  return k;
}

let etiketSayac = 0;
// The edit form, inside the details panel
function duzenleGovde(x) {
  const d = el('div', 'cekmeceGovde');
  const girdi = (tip, deger) => { const i = el('input'); i.type = tip; if (tip === 'checkbox') i.checked = !!deger; else i.value = deger || ''; return i; };
  const isaret = (kutu, yazi) => { const l = el('label', 'yan'); l.append(kutu, document.createTextNode(' ' + yazi)); return l; };
  const ad = girdi('text', x.ad);
  const url = girdi('url', x.url);
  const kel = girdi('text', x.kelimeler);
  const giris = girdi('text', x.girisYazisi);
  const her = girdi('checkbox', x.herDegisiklik);
  const hizli = girdi('checkbox', x.hizli);
  const kalici = girdi('checkbox', x.kaliciSekme);
  // each label points at its box, so screen readers say what the box is for
  const etiket = (yazi, kutu) => { kutu.id = 'd_' + x.id + '_' + (++etiketSayac); const l = el('label', null, yazi); l.htmlFor = kutu.id; return l; };
  d.append(etiket(T('Name'), ad), ad, etiket(T('Address'), url), url, etiket(T('Words (comma-separated)'), kel), kel,
    etiket(T('Login check: text you can only see when logged in (optional)'), giris), giris,
    isaret(her, T('Alarm on every change')), isaret(hizli, T('Fast: alarm on the first read when a "sold out" text goes away')), isaret(kalici, T('Keep the tab open between reads (for slow pages)')));
  let okuyucu = null;
  if (UYGULAMA) {
    okuyucu = el('select');
    for (const [v, y] of [['', 'Separate browser (handles JavaScript and logins)'], ['http', 'Plain HTTP (lightest, no JavaScript)'], ['eklenti', 'My Chrome extension (Windows, extension installed)']]) {
      const o = el('option', null, T(y)); o.value = v; if ((x.okuyucu || '') === v) o.selected = true; okuyucu.appendChild(o);
    }
    d.append(etiket(T('Who reads the page'), okuyucu), okuyucu);
  }
  const sr = el('div', 'satir'); sr.style.marginTop = '12px';
  const kaydet = dugme(T('Save'), 'ana');
  kaydet.onclick = async () => {
    await istek({
      tip: 'GUNCELLE', id: x.id, ad: ad.value, url: url.value, kelimeler: kel.value, girisYazisi: giris.value,
      herDegisiklik: her.checked, hizli: hizli.checked, kaliciSekme: kalici.checked, ...(okuyucu ? { okuyucu: okuyucu.value } : {}),
    });
    kilitli = false;
    await ciz();
    detayModu('bilgi');
  };
  const vazgec = dugme(T('Cancel'), 'ikincil');
  vazgec.onclick = () => detayModu('bilgi');
  sr.append(kaydet, vazgec);
  d.appendChild(sr);
  return d;
}

async function gonder(m) { kilitli = false; await istek(m); ciz(); }
async function kapat(id, islem) { await istek({ tip: 'ALARM_KAPAT', alarmId: id, islem }); ciz(); }

// A short note at the bottom, with Undo where it can be undone
function tost(yazi, geriAl) {
  $('#tostYazi').textContent = yazi;
  const b = $('#tostGeri');
  b.hidden = !geriAl;
  b.onclick = geriAl ? async () => { tostGizle(); await geriAl(); ciz(); } : null;
  $('#tost').hidden = false;
  clearTimeout(tostZamani);
  tostZamani = setTimeout(tostGizle, geriAl ? 8000 : 4000);
}
function tostGizle() { $('#tost').hidden = true; }

// --- the two panels at the top: add a page, settings
function panelAc(ad, acik, odakla = true) {
  const blok = ad === 'ekle' ? $('#ekleBlok') : $('#ayarBlok');
  const dugmesi = ad === 'ekle' ? $('#ekleAc') : $('#ayarAc');
  const yeni = acik == null ? blok.hidden : acik;
  blok.hidden = !yeni;
  dugmesi.setAttribute('aria-expanded', String(yeni));
  if (yeni && odakla) { blok.scrollIntoView({ block: 'nearest' }); (ad === 'ekle' ? $('#y_ad') : $('#a_ustte')).focus(); }
  if (!yeni && odakla) dugmesi.focus();
}
$('#ekleAc').onclick = () => panelAc('ekle');
$('#ayarAc').onclick = () => panelAc('ayar');
$('#ekleKapat').onclick = () => panelAc('ekle', false);
$('#ayarKapat').onclick = () => panelAc('ayar', false);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#ekleBlok').hidden && $('#ekleBlok').contains(document.activeElement)) panelAc('ekle', false);
  else if (!$('#ayarBlok').hidden && $('#ayarBlok').contains(document.activeElement)) panelAc('ayar', false);
});

function ekleAraligiYaz() {
  const sn = ARALIKLAR[Number($('#y_aralik').value)];
  $('#y_aralikYazi').textContent = aralikAdi(sn);
  $('#y_aralik').setAttribute('aria-valuetext', aralikAdi(sn));
  $('#y_olcekMin').textContent = aralikAdi(ARALIKLAR[0]);
  $('#y_olcekMaks').textContent = aralikAdi(ARALIKLAR[ARALIKLAR.length - 1]);
}
$('#y_aralik').max = String(ARALIKLAR.length - 1);
$('#y_aralik').addEventListener('input', ekleAraligiYaz);

$('#ekleBtn').onclick = async () => {
  const c = await istek({
    tip: 'EKLE', ad: $('#y_ad').value, url: $('#y_url').value, aralikSn: ARALIKLAR[Number($('#y_aralik').value)],
    kelimeler: $('#y_kelime').value, herDegisiklik: $('#y_her').checked, girisYazisi: $('#y_giris').value,
    hizli: $('#y_hizli').checked, kaliciSekme: $('#y_kalici').checked, okuyucu: $('#y_okuyucu').value,
  });
  if (c && c.hata) { $('#ekleHata').textContent = c.hata; return; }
  $('#ekleHata').textContent = '';
  const eklenen = $('#y_ad').value.trim() || hostu($('#y_url').value.trim());
  for (const s of ['#y_ad', '#y_url', '#y_kelime', '#y_giris']) $(s).value = '';
  for (const s of ['#y_her', '#y_hizli', '#y_kalici']) $(s).checked = false;
  $('#y_okuyucu').value = '';
  panelAc('ekle', false);
  if (filtre !== 'hepsi' && filtre !== 'aktif') filtre = 'hepsi';
  tost(T('{ad} added.', { ad: eklenen }));
  ciz();
};
$('#hepsiNobet').onclick = () => { if (confirm(T('Treat the current state of all pages as "normal"?'))) gonder({ tip: 'NOBET_HEPSI' }); };
$('#ara').addEventListener('input', () => { arama = $('#ara').value.trim().toLocaleLowerCase(); if (son) listeyiCiz(son); });

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
  const d = await istek({ tip: 'LISTE', hafif: true });
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
      const i = el('input'); i.type = 'text'; i.id = 'b_' + k + '_' + a; i.value = (ayar[k] && ayar[k][a]) || ''; i.autocomplete = 'off';
      const l = el('label', null, T(y)); l.htmlFor = i.id;
      c.append(l, i);
      sr.appendChild(c);
    }
    kutu.appendChild(sr);
    const t = dugme(T('Send a test'), 'ikincil kucukBtn'); t.style.marginTop = '6px';
    const s = el('span', 'kucuk'); s.style.marginLeft = '8px'; s.setAttribute('role', 'status');
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

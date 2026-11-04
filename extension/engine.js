// =====================================================================================================
// PageSiren — GENERIC ENGINE (site-independent page representation and comparison)      pure JS, no DOM
// =====================================================================================================
// WHAT IT DOES
//   The page's HTML becomes an "identity multiset" (key -> count); the difference between two reads is taken
//   on this set. It's regex-based (no DOM): runs both in a Chrome service worker and in Node tests.
//
// KEY LAYERS ("X|text" form; ids = L,O,B,I  /  text = the others)
//   L| link (href)        O| option (<option>)       B| button       I| form field
//   A| link text          H| heading                 S| list row     T| table row
//   P| paragraph          D| status text (Sold out / Tükendi / Ausverkauft ...)
//   M| event (from more.com JSON: "NAME (d/m) — SOLD OUT | ON SALE")
//   Y| small page fallback (when very little was read)
//   "|soluk" suffix: disabled / aria-disabled item (not available right now)
//
// NOISE (never represented): cookie boxes (known tools' containers and small boxes named cookie/consent are cut out entirely),
//   FAQ blocks (unless they hold sale items), login/sign-up windows, account/cart links and account names, empty cart counters,
//   "Show more"-style UI buttons, relative times ("3 minutes ago"), address parts with session ids/epochs, plain number changes.
//
// FLOW: represent(html) -> healthCheck -> turIsle(durum, rep, saglik, sinyal)
//   turIsle: takes the baseline on the first read; then compare -> confirm (CONFIRMED BY TWO READS IN A ROW) -> applyToBaseline.
//   Warm-up (first baseline / version change) and fast mode (confirm in one read) are applied here.
//   The alarm decision is NOT made here (direction rule, keyword filter are in background.js alarmSuz); this says "what changed".
//
// FILE MAP: helpers (decode, txt, attr) -> DURUM_SOZ / CEREZ / GURULTU / HESAP_YOLU -> kutuKes, cerezKutusuKes, sssKutusuKes
//   -> moreRezervasyon -> represent -> healthCheck / collapsed -> diffBag / pairNumeric / compare -> confirm
//   -> applyToBaseline -> alarmSatirlari -> turIsle -> birlestir -> API (self.GENEL_MOTOR / module.exports)
// =====================================================================================================
(function () {
  const SOLUK = '|soluk';
  // UI text goes through i18n.js when it's loaded; the engine also works without it (English).
  const T = (m, p) => { const g = typeof self !== 'undefined' && self.T; if (g) return g(m, p); return p ? m.replace(/\{(\w+)\}/g, (a, k) => p[k]) : m; };

  const decode = (s) => String(s)
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (m, d) => String.fromCharCode(parseInt(d, 16)));

  const txt = (h) => decode(String(h).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

  const attr = (etiket, ad) => {
    const m = new RegExp(ad + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s">]+))', 'i').exec(etiket || '');
    return m ? decode(m[2] != null ? m[2] : (m[3] != null ? m[3] : m[4])) : '';
  };

  const soluk = (a) => {
    if (/\bdisabled\b/i.test(a || '')) return true;
    if (/\baria-disabled\s*=\s*["']?true\b/i.test(a || '')) return true;
    return false;
  };

  // Relative times are masked: "3 minutes ago" -> "<rel>" (they keep changing)
  const RELATIVE_TIME = [
    [/\b\d+\s*(saniye|sn|dakika|dk|saat|gun|gün|hafta|ay|yil|yıl)\s+(once|önce)\b/gi, '<rel>'],
    [/\b\d+\s*(second|minute|hour|day|week|month|year)s?\s+ago\b/gi, '<rel>'],
    [/\bil y a\s+\d+\s*\w+/gi, '<rel>'],
    [/\bvor\s+\d+\s*\w+/gi, '<rel>'],
    [/\b\d+\s*(dag|dagar|timmar|minuter|dagen|uur|minuten)\s+(sedan|geleden)\b/gi, '<rel>'],
  ];
  const scrubText = (s) => RELATIVE_TIME.reduce((x, p) => x.replace(p[0], p[1]), String(s)).replace(/\s+/g, ' ').trim();

  // Address parts containing a session / timestamp (they change on every load)
  const VOLATILE_VAL = (v) => /^\d{10,13}$/.test(v) || /^[0-9a-f]{16,}$/i.test(v) || /^[A-Za-z0-9_-]{24,}$/.test(v);
  const SKIP_HREF = /^(#|javascript:|mailto:|tel:)/i;

  const normHref = (href) => {
    try {
      const u = new URL(href, 'https://x.invalid/');
      const p = u.pathname.replace(/;jsessionid=[^;/?]*/i, '').replace(/\/\d{10,13}(?=\/|$)/, '/<epoch>');
      const q = [...u.searchParams.entries()].filter(([k, v]) => !VOLATILE_VAL(v) && !/^(_ga|_gl|utm_|timestamp|ts|rnd|cache)/i.test(k))
        .map(([k, v]) => k + '=' + v).sort().join('&');
      return (u.host === 'x.invalid' ? '' : u.host) + p + (q ? '?' + q : '');
    } catch (e) { return String(href).slice(0, 200); }
  };

  // Sale-status texts (short badges): word list shared across languages
  const DURUM_SOZ = /t[üu]kendi|t[üu]kenmek [üu]zere|sat[ıi][şs]ta|sat[ıi][şs]a (a[çc][ıi]l|[çc][ıi]k)|yak[ıi]nda|bilet al|sat[ıi]n al|uygun bilet|bilet bulunma|son biletler|sold[\s-]?out|on sale|unavailable|not available|available|coming soon|buy now|get tickets|complet|[ée]puis[ée]|indisponible|non disponible|bient[ôo]t|ausverkauft|verf[üu]gbar|demn[äa]chst|εξαντλ|μη διαθ[εέ]σιμ|προσεχ[ωώ]ς|распродан|разпродад|изчерпан|в продаже|нет в наличии|sotuvda|rasprodat|uskoro|esgotad|agotad|esaurit|epuizat|uts[oø]lgt|udsolgt|slutsåld|slutsålt|utsåld|utsålt|tilgjengelig|tillg[äa]nglig|kj[øo]p n[åa]|k[öo]p nu|biljettsl[äa]pp|billettsalg|loppuunmyyty|sem[ _]?disponibilidade|dispon[ií]vel|indispon[ií]vel|^comprar$|daha sonra tekrar dene|sat[ıi][şs]a sunulacak|no results|טרם נפתח|אין מידע עבור האירוע|אזל|לא זמין|אין כרטיסים|המכירה הסתיימה|בקרוב|לרכישה|הוסף לסל|הוספה לסל/i;

  // Cookie / consent banner buttons and links.
  const CEREZ = /[çc]erez|tercihleri y[öo]net|t[üu]m[üu]n[üu] (kabul|reddet)|gizlilik (se[çc]im|tercih|ayar)|kabul ediyorum|cookie|consent|accept all|reject all|manage (preferences|options|cookies)|g[ée]rer (mes|les) (pr[ée]f[ée]rences|choix)|tout accepter|tout refuser|param[èe]tres des cookies|alle akzeptieren|alle ablehnen|einstellungen verwalten|datenschutzeinstellungen|privacy (settings|preferences|choices)|αποδοχ[ηή] [οό]λων|απ[οό]ρριψ[ηή] [οό]λων|^accepteer( alles)?$|^weiger( alles)?$|keuzes opslaan|cookie-?voorkeur|acceptera alla|godk[äa]nn alla|neka alla|accetta tutt[io]|rifiuta tutt[io]|aceptar todo|rechazar todo|aceitar todos|rejeitar todos|zaakceptuj wszystkie|odrzu[ćc] wszystkie|^povolit (v[šs]e|v[ýy]b[ěe]r)$|^odm[íi]tnout$|^souhlas$|nastaven[íi] cookies|v[íi]ce o cookies|^prijat? v[šs]etko$|^odmietnu[ťt]$|tan[ıi]mlama bilgisi|vendor-search|^back button$|^filter button$|^onetrust|^truste|קוקיז|קבצי עוגיה|עוגיות|^קבלו הכל$|^אשרו בחירה$|^מובן$|^תצורה$/i;

  // Login/sign-up windows and UI noise ("Continue with Google" etc.).
  // Inner texts like "Log in om te bestellen" (in an event row) are NOT dropped: only exact-match button texts.
  const GURULTU = /^continue with (google|facebook|apple|email|phone|apple id)$|^(sign|log) ?in with |^log in or sign up$|^(sign|log) ?(in|up)$|^create (an )?account$|^forgot( your)? password\??$|^show (more|less|all)$|^(load|see) more$|^daha fazla( g[öo]ster)?$|^close$|^kapat$|^schlie[sß]en$|^fermer$|^cerrar$|^sluiten$|^st[äa]ng$|^κλε[ιί]σιμο$|^terms (and|&) conditions$|^terms of (use|service)$|^privacy policy$|^cookie statement$|^kullan[ıi]m ko[şs]ullar[ıi]$|^gizlilik politikas[ıi]$|by (continuing|signing up|logging in|creating an account)[^.]{0,60}agree|agree to (our|the) (terms|privacy)|devam ederek[^.]{0,60}kabul|requires you to identify yourself|sign up or sign in|please use the button below|giri[şs] yapman[ıi]z gerek|^giri[şs] yap$|^[üu]ye ol$|^[çc][ıi]k[ıi][şs]$|^(log|sign) ?out$|^hesab[ıi]m$|^my account$|^המשך$|הסשן שלך|your session (will )?expire|session (has )?expired|session time ?out|oturumunuz(un)? s[üu]resi/i;

  // Top-menu labels that say nothing about a sale. Exact matches only: "In den Warenkorb" and "Add to cart" are sale signals and stay.
  const MENU_GURULTU = /^(your |my |shopping )?(cart|basket)$|^(mein )?warenkorb$|^(meine )?(wunschliste|merkliste)$|^(my )?wish ?list$|^favou?rites$|^favoriten$|^(mon )?panier$|^(mi )?carrito$|^cesta$|^carrello$|^winkel(wagen|mand(je)?)$|^varukorg$|^handlekurv$|^sepet(im)?$|^favoriler(im)?$|^help$|^yard[ıi]m$|^hilfe$|^aide$|^ayuda$|^ajuda$|^aiuto$|^hjelp$|^hj[äa]lp$|^βο[ήη]θεια$|^עזרה$|^התחברות$|^התנתק$|^הרשמה$|^הצהרת הגנת (ה)?נתונים$/i;
  // "You are logged in as ...": account information, whatever else the row holds.
  const GIRISLI_SATIR = /(logged|signed) in as\b|eingeloggt als|angemeldet als|connect[ée]e? en tant que|מחובר\/ת כ/i;
  // An empty cart or wishlist counter: "0", "(0)", "€ 0,00". Shops often load it late. "0 / € 0,00" is caught part by part below.
  const BOS_SAYAC = /^[([]?\s*(?:(?:[€$£₺]|eur|usd|gbp|try|tl|nok|sek|dkk|chf)\s*)?0(?:[.,]0{1,2})?(?:\s*(?:[€$£₺]|eur|usd|gbp|try|tl|nok|sek|dkk|chf))?\s*[)\]]?$/i;
  const gurultuMu = (t) => CEREZ.test(t) || GURULTU.test(t) || MENU_GURULTU.test(t) || GIRISLI_SATIR.test(t) || BOS_SAYAC.test(t);
  // Also recognized in Turkish upper case: JS /i doesn't treat "İ" as "i".
  const tekGurultu = (t) => {
    if (gurultuMu(t)) return true;
    return gurultuMu(String(t).toLocaleLowerCase('tr'));
  };
  const PARCA = /\s*[\/|·•]\s*/;
  // Lines made up only of noise parts like "GİRİŞ YAP / ÜYE OL" are noise too.
  const gurultu = (t) => {
    if (tekGurultu(t)) return true;
    const p = String(t).split(PARCA).filter(Boolean);
    return p.length > 1 && p.every(tekGurultu);
  };

  // Links to account / login / cart pages (top menu). Their text can be the NAME of the logged-in account
  // and it carries no sale information -> the link, its text, and any list row/heading with the same text
  // leave the representation.
  const HESAP_YOLU = /\/(giri[sş](-yap)?|uye-?giri[sş]i|uye-?ol|uyelik|kay[ıi]t-?ol|[çc][ıi]k[ıi][sş](-yap)?|hesab[ıi]m|hesap|profil(im)?|sepet(im)?|log-?in|sign-?in|log-?out|sign-?out|register|sign-?up|my-?account|account|cart|basket|warenkorb|panier|mein-?konto|mon-?compte)\/?$/i;
  const SATIS_YAZI = /sat[ıi]n al|bilet al|\bbuy\b|kaufen|acheter|comprar|get tickets|add to (cart|basket)/i;
  const yolu = (href) => { try { return new URL(href, 'https://x.invalid/').pathname; } catch (e) { return ''; } };
  // The same links on sites with file endings or longer names: /login.aspx, /shop/customerlogin.secure, /myaccount/overview.do
  const DOSYA_SONU = /\.\w{1,8}(?=\/?$)/;
  const sonParca = (y) => ((/([^/]+)\/?$/.exec(y) || [])[1] || '').replace(DOSYA_SONU, '');
  const HESAP_KLASORU = /\/(?:my-?account|mein-?konto|mon-?compte|hesab[ıi]m)\//i;
  const HESAP_DOSYASI = /^(?:(?:customer|user|account|member|client|kunden|my)[-_]?)?(?:log[-_]?(?:in|on|out|off)|sign[-_]?(?:in|out))$|^(?:my[-_]?)?account[-_]?(?:overview|details|settings)$|^customer[-_]?(?:edit[-_]?)?(?:details|account|profile)$|^(?:wish[-_]?list|wunschliste|merkliste|favou?rites|favoriten|favoriler)$|^bye$/i;
  const hesapYolu = (y) => HESAP_YOLU.test(y.replace(DOSYA_SONU, '')) || HESAP_KLASORU.test(y) || HESAP_DOSYASI.test(sonParca(y));
  const hesapLinki = (href, t) => !!href && !SKIP_HREF.test(href) && hesapYolu(yolu(href)) && !SATIS_YAZI.test(t || '');
  // A logout link or button means the page was read logged in. background.js warns once when it goes away.
  const CIKIS_DOSYASI = /^(?:(?:customer|user|account|member|client|kunden|my)[-_]?)?(?:log[-_]?(?:out|off)|sign[-_]?out)$|^(?:abmelden|ausloggen|d[ée]connexion|cikis(?:-yap)?|uitloggen|logga-?ut|logg-?ut|cerrar-?sesion|bye)$/i;
  const CIKIS_YAZI = /^(?:log ?out|log ?off|sign ?out|abmelden|ausloggen|d[ée]connexion|se d[ée]connecter|[çc][ıi]k[ıi][şs]( yap)?|oturumu kapat|uitloggen|logga ut|logg ut|cerrar sesi[oó]n|αποσ[υύ]νδεση|התנתק|התנתקות)$/i;
  const cikisYazisi = (t) => CIKIS_YAZI.test(t || '') || CIKIS_YAZI.test(String(t || '').toLocaleLowerCase('tr'));
  const cikisLinki = (href, t) => (!!href && !SKIP_HREF.test(href) && CIKIS_DOSYASI.test(sonParca(yolu(href)))) || cikisYazisi(t);

  // The CONTAINER of cookie/consent windows is cut from the HTML entirely (a late-loading OneTrust window
  // can bring ~130 headings/buttons -> false alarm). A word list can't catch every language.
  // A Ketch window (root: lanyard_root) may also switch language between reads; a removed reject button wouldn't be caught by the word filter.
  const CEREZ_KUTUSU = /<div\b[^>]*?\sid\s*=\s*["']?(onetrust-consent-sdk|onetrust-banner-sdk|onetrust-pc-sdk|CybotCookiebotDialog|didomi-host|qc-cmp2-container|lanyard_root|ketch-banner|ketch-consent-banner|ketch-modal|ketch-preferences)["'\s>]/i;
  // Script, style and comment blocks are skipped: counting "<div>" inside them could let a cut run past the box and delete the sale item next to it.
  const KOD_BLOGU = /<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->/;
  // Cuts containers matching the pattern (nested same tags are counted). If kesilsinMi is given, it can look inside and decide not to cut.
  function kutuKes(h, desen, kesilsinMi) {
    const ara = new RegExp(KOD_BLOGU.source + '|' + desen.source, 'gi');
    let m;
    for (let n = 0; n < 40 && (m = ara.exec(h));) {
      if (/^<(script|style|!--)/i.test(m[0])) continue;
      n++;
      const etiketAdi = /^<([a-z0-9]+)/i.exec(m[0])[1];
      const acilisSonu = h.indexOf('>', m.index) + 1;
      const re = new RegExp(KOD_BLOGU.source + '|<(/?)' + etiketAdi + '\\b[^>]*>', 'gi');
      re.lastIndex = acilisSonu;
      let derinlik = 1;
      let son = -1;
      let x;
      while ((x = re.exec(h))) {
        if (x[1] === undefined) continue; // code block
        derinlik += x[1] ? -1 : 1;
        if (!derinlik) { son = re.lastIndex; break; }
      }
      if (son < 0) break; // closing tag not found: leave as is
      if (kesilsinMi && !kesilsinMi(h.slice(acilisSonu, son))) { ara.lastIndex = son; continue; }
      h = h.slice(0, m.index) + h.slice(son);
      ara.lastIndex = m.index;
    }
    return h;
  }
  // Any language and any tool: a box whose id or class says cookie or consent. These windows hold tables of cookies and forms of switches, so
  // those don't keep it. It stays if it holds a buy link or a short status text, and if it is more than a quarter of the page, so a wrapper
  // like class="cookies-accepted" around the content is never cut.
  const CEREZ_GENEL = /<(?:div|section|aside|dialog)\b[^>]*?\s(?:id|class)\s*=\s*(?:"[^"]*(?:cookie|consent|gdpr|cc-window)[^"]*"|'[^']*(?:cookie|consent|gdpr|cc-window)[^']*')/i;
  const durumOgesiVar = (p) => [...p.matchAll(/<(span|div|strong|b|em|small|label|i|mark|font)\b[^>]*>([^<]{1,80})<\/\1\s*>/gi)].some((m) => { const t = txt(m[2]); return t.length <= 70 && DURUM_SOZ.test(t); });
  const cerezKutusuKes = (h) => {
    const k = kutuKes(h, CEREZ_KUTUSU);
    let sayfa = -1;
    return kutuKes(k, CEREZ_GENEL, (p) => {
      if (sayfa < 0) sayfa = txt(k).length;
      const t = txt(p);
      return t.length <= 20000 && t.length * 4 <= sayfa && !satisLinkiVar(p) && !durumOgesiVar(p);
    });
  };

  // FAQ blocks are cut too (dozens of question-answer items can come and go at once and change language: repeated false alarms
  // on "every change" watches). It's static help text. So we NEVER MISS anything, exceptions: a box with a sale item (select box, table, form,
  // a "Buy" link) stays; if the watched page is the FAQ itself (its title says FAQ, or cutting would leave under a quarter of the text) nothing is cut.
  // The limit is deliberately low: with a "half" limit a list getting a bit shorter could flip the rule on and off between reads.
  const SSS_KUTUSU = /<(?:div|section|ul|dl)\b[^>]*?\s(?:id|class)\s*=\s*(?:"[^"]*(?:faq|\bsss\b|sik-?sorulan)[^"]*"|'[^']*(?:faq|\bsss\b|sik-?sorulan)[^']*')/i;
  const SSS_BASLIK = /faq|\bsss\b|s[ıi]k[çc]a sorulan|frequently asked|h[äa]ufig gestellte|questions fr[ée]quentes|preguntas frecuentes|perguntas frequentes|domande frequenti|veelgestelde vragen|συχν[εέ]ς ερωτ[ηή]σεις/i;
  const satisLinkiVar = (p) => [...p.matchAll(/<(a|button)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)].some((m) => { const t = txt(m[2]); return t.length <= 30 && SATIS_YAZI.test(t) && !/[?;\u037E]$/.test(t); });
  const satisOgesiVar = (p) => /<(select|table|form)\b/i.test(p) || satisLinkiVar(p);
  function sssKutusuKes(h) {
    const k = kutuKes(h, SSS_KUTUSU, (p) => !satisOgesiVar(p));
    if (k === h) return h;
    const baslik = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(k);
    const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(k);
    if (SSS_BASLIK.test(txt((baslik ? baslik[1] : '') + ' ' + (h1 ? h1[1] : '')))) return h;
    return txt(k).length * 4 < txt(h).length ? h : k;
  }

  // Some ticket engines (more.com / Viva) deliver events as JSON (bookingPanel.data); visible rows don't carry the
  // event name (which event does "Sold out" belong to?), and a past event dropping from the list would look like
  // "Sold out went away". The JSON gives one "NAME (dd/mm) — STATUS" key per event.
  function moreRezervasyon(h) {
    const i = h.indexOf('bookingPanel.data = ');
    if (i < 0) return null;
    const bas = i + 'bookingPanel.data = '.length;
    let derinlik = 0;
    let son = -1;
    let tirnak = false;
    let kac = false;
    for (let j = bas; j < h.length && j < bas + 3000000; j++) {
      const ch = h[j];
      if (tirnak) {
        if (kac) kac = false;
        else if (ch === '\\') kac = true;
        else if (ch === '"') tirnak = false;
        continue;
      }
      if (ch === '"') tirnak = true;
      else if (ch === '{') derinlik++;
      else if (ch === '}') { derinlik--; if (!derinlik) { son = j + 1; break; } }
    }
    if (son < 0) return null;
    let d;
    try { d = JSON.parse(h.slice(bas, son)); } catch (e) { return null; }
    const ad = {};
    for (const p of d.plays || []) ad[p.id] = String(p['play-title'] || '').replace(/\s+/g, ' ').trim();
    const etiketler = new Set();
    const etkinlikler = [];
    for (const e of d.events || []) {
      for (const x of [e['book-button-label'], e.BookBtnText, e.inactiveBookingMsg]) if (x && String(x).trim()) etiketler.add(String(x).trim().toLowerCase());
      const g = /^(\d{4})-(\d{2})-(\d{2})/.exec(e.day || e['event-date'] || '');
      const tarih = g ? Number(g[3]) + '/' + Number(g[2]) : '';
      const durum = e.isSoldout ? 'SOLD OUT' : (e.isBookingActive ? 'ON SALE' : 'not available');
      etkinlikler.push((ad[e.playId] || 'event') + (tarih ? ' (' + tarih + ')' : '') + ' — ' + durum);
    }
    return { etiketler, etkinlikler };
  }

  // --------------------------------------------------------------- representation
  function represent(html) {
    const ids = {};
    const text = {};
    const etiket = {}; // key -> human-readable text
    const more = moreRezervasyon(String(html || ''));
    // more.com: visible "Sold out" / "Εισιτήρια" labels are muted (the info comes from the JSON with the event name)
    const moreSus = (anahtar) => !!more && /^[ABD]\|/.test(anahtar)
      && (more.etiketler.has(anahtar.slice(2).replace(/\|soluk$/, '').trim().toLowerCase()) || /sold out/i.test(anahtar));
    const add = (kova, anahtar, yazi) => {
      if (moreSus(anahtar)) return;
      kova[anahtar] = (kova[anahtar] || 0) + 1;
      if (yazi && !etiket[anahtar]) etiket[anahtar] = String(yazi).slice(0, 160);
    };
    const h = sssKutusuKes(cerezKutusuKes(String(html || '')));
    let m;
    let re;
    const hesapYazi = new Set(); // texts of account links (logged-in account name etc.)
    const hesapSatiri = (t) => {
      if (!hesapYazi.size) return false;
      if (hesapYazi.has(t)) return true;
      const p = String(t).split(PARCA).filter(Boolean);
      if (p.length > 1 && p.every((x) => hesapYazi.has(x) || tekGurultu(x))) return true;
      // A menu row that repeats account texts: "Name  Welcome back  Name". Two of them and only a short label left. One is not enough:
      // "Tickets  Team A - Team B" next to an account link called "Tickets" is real content.
      let kalan = String(t);
      let adet = 0;
      for (const y of hesapYazi) {
        if (y.length < 3) continue;
        const parca = kalan.split(y);
        adet += parca.length - 1;
        kalan = parca.join(' ');
      }
      kalan = kalan.replace(/\s+/g, ' ').trim();
      return adet >= 2 && kalan.length <= 40 && !DURUM_SOZ.test(kalan) && !SATIS_YAZI.test(kalan);
    };
    const sus = (t) => gurultu(t) || hesapSatiri(t);

    // (a) LINKS. Account texts are collected first: the same name can also sit on a plain "#" link that opens the account menu.
    let cikisVar = false;
    const linkler = [...h.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)].map((x) => ({ href: attr(x[1], 'href'), t: scrubText(txt(x[2])) }));
    for (const l of linkler) {
      if (cikisLinki(l.href, l.t)) cikisVar = true;
      if (l.t && !gurultu(l.t) && hesapLinki(l.href, l.t)) hesapYazi.add(l.t);
    }
    for (const { href, t } of linkler) {
      // A text-less link to another site (sponsor/ad logo, social icon) doesn't count: those keep rotating.
      const yazisizDis = !t && /^(https?:)?\/\//i.test(href);
      if (gurultu(t) || hesapLinki(href, t)) continue;
      if (href && !SKIP_HREF.test(href) && !yazisizDis) add(ids, 'L|' + normHref(href), t || href);
      if (t && !hesapYazi.has(t)) add(text, 'A|' + t.slice(0, 160), t);
    }

    // (b) OPTIONS — select boxes with more than 15 options (city/filter lists) are skipped
    const bloklar = [...h.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select\s*>/gi)];
    const blokIci = new Set();
    for (const b of bloklar) {
      const secenekler = [...String(b[2]).matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option\s*>/gi)];
      for (const s of secenekler) blokIci.add(s[0]);
      if (secenekler.length > 15) continue;
      const ustSoluk = soluk(b[1]);
      for (const s of secenekler) {
        const yazi = scrubText(txt(s[2]));
        const kimlik = (attr(s[1], 'value') || yazi).slice(0, 120);
        if (!kimlik) continue;
        add(ids, 'O|' + kimlik + (ustSoluk || soluk(s[1]) ? SOLUK : ''), yazi || kimlik);
      }
    }
    re = /<option\b([^>]*)>([\s\S]*?)<\/option\s*>/gi;
    while ((m = re.exec(h))) {
      if (blokIci.has(m[0])) continue;
      const yazi = scrubText(txt(m[2]));
      const kimlik = (attr(m[1], 'value') || yazi).slice(0, 120);
      if (kimlik) add(ids, 'O|' + kimlik + (soluk(m[1]) ? SOLUK : ''), yazi || kimlik);
    }

    // (c) BUTTONS — icon-only buttons don't count (popup close buttons come and go)
    re = /<button\b([^>]*)>([\s\S]*?)<\/button\s*>/gi;
    while ((m = re.exec(h))) {
      const l = scrubText(txt(m[2])) || attr(m[1], 'aria-label') || attr(m[1], 'title');
      if (cikisYazisi(l)) cikisVar = true;
      if (l && /[\p{L}\p{N}]/u.test(l) && !sus(l)) add(ids, 'B|' + l.slice(0, 120) + (soluk(m[1]) ? SOLUK : ''), l.slice(0, 120));
    }

    // (d) FORM FIELDS — hidden/radio/checkbox skipped (cookie consent / filter widgets)
    re = /<input\b([^>]*)>/gi;
    while ((m = re.exec(h))) {
      const tip = (attr(m[1], 'type') || 'text').toLowerCase();
      if (tip === 'hidden' || tip === 'radio' || tip === 'checkbox') continue;
      const kimlik = attr(m[1], 'name') || attr(m[1], 'id') || attr(m[1], 'placeholder') || attr(m[1], 'value') || tip;
      // Boxes of cookie/consent tools are dropped too ("vendor-search-handler" comes and goes)
      if (kimlik && !gurultu(String(kimlik))) add(ids, 'I|' + String(kimlik).slice(0, 100) + (soluk(m[1]) ? SOLUK : ''), kimlik);
    }

    // (e) HEADINGS / LIST ROWS / TABLE ROWS / PARAGRAPHS
    re = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
    while ((m = re.exec(h))) { const t = scrubText(txt(m[2])); if (t && !sus(t)) add(text, 'H|' + t.slice(0, 160), t); }
    re = /<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi;
    while ((m = re.exec(h))) { const t = scrubText(txt(m[1])); if (t && !sus(t)) add(text, 'S|' + t.slice(0, 160), t); }
    re = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi;
    while ((m = re.exec(h))) {
      const c = [...String(m[1]).matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]\s*>/gi)].map((x) => txt(x[1])).filter(Boolean);
      if (c.length) { const t = scrubText(c.join(' ~ ')).slice(0, 160); if (t) add(text, 'T|' + t, t); }
    }
    re = /<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi;
    while ((m = re.exec(h))) { const t = scrubText(txt(m[1])); if (t && !sus(t)) add(text, 'P|' + t.slice(0, 160), t); }

    // (f) STATUS TEXTS: short sale-status labels in leaf elements like <span>/<div>
    // (a "Sold out" badge in a <span> isn't read by any other layer -> its removal would go unseen).
    re = /<(span|div|strong|b|em|small|label|i|mark|font)\b[^>]*>([^<]{1,80})<\/\1\s*>/gi;
    while ((m = re.exec(h))) {
      const t = scrubText(txt(m[2]));
      if (t && t.length <= 70 && DURUM_SOZ.test(t) && !sus(t)) add(text, 'D|' + t, t);
    }

    // (f1) ALERT BOXES: ALL text of role="alert" / class="alert …" containers (even with nested tags), as D| if it contains a
    // status word. e.g. <div class="alert" role="alert"><button>×</button><strong></strong>
    // "sale not open yet"</div> — not a leaf, so layer (f) doesn't read it. Hidden template boxes are skipped.
    re = /<(div|p|section|span)\b([^>]*?(?:\brole\s*=\s*["']alert["']|\bclass\s*=\s*["'][^"']*\balert\b)[^>]*)>/gi;
    while ((m = re.exec(h))) {
      if (/\bhidden\b|display\s*:\s*none/i.test(m[2])) continue;
      const etiketAdi = m[1].toLowerCase();
      const icBas = m.index + m[0].length;
      const kapanis = new RegExp('<(/?)' + etiketAdi + '\\b[^>]*>', 'gi');
      kapanis.lastIndex = icBas;
      let d = 1;
      let son = -1;
      let x;
      while ((x = kapanis.exec(h))) { d += x[1] ? -1 : 1; if (!d) { son = x.index; break; } }
      if (son < 0 || son - icBas > 4000) continue;
      const t = scrubText(txt(h.slice(icBas, son))).replace(/^(&times;|×)\s*/, '');
      if (t && t.length <= 200 && DURUM_SOZ.test(t) && !sus(t)) add(text, 'D|' + t.slice(0, 160), t);
    }

    // (f2) more.com event list (JSON): "TEAM A - TEAM B (15/11) — SOLD OUT"
    if (more) for (const e of more.etkinlikler) add(text, 'M|' + e.slice(0, 160), e);

    // (g) SMALL PAGE FALLBACK: if very little was read, take lines from the body text
    if (count(ids) + count(text) < 5) {
      const govde = scrubText(txt(h)).slice(0, 2000);
      for (const parca of govde.split(/(?<=[.!?])\s+|\s{2,}/)) {
        const t = parca.trim();
        if (t.length >= 3 && !gurultu(t)) add(text, 'Y|' + t.slice(0, 160), t);
      }
    }
    return { ids, text, etiket, cikisVar };
  }

  const count = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
  const itemCount = (rep) => count(rep.ids) + count(rep.text);

  // --------------------------------------------------------------- health
  function healthCheck(html, rep) {
    const h = String(html || '');
    const gorunur = txt(h);
    const oge = itemCount(rep);
    const scriptOrani = (h.match(/<script\b/gi) || []).length;
    if (!gorunur.length && oge === 0) return T('page cannot be read (only {n} characters of visible text; only {oge} readable items)', { n: 0, oge: 0 });
    if (gorunur.length < 200 && oge < 5) {
      return T('page cannot be read (only {n} characters of visible text; only {oge} readable items)', { n: gorunur.length, oge });
    }
    if (oge < 5 && scriptOrani > 3) return T('most of the page is script, no readable content');
    return null;
  }

  function collapsed(prevRep, nextRep) {
    const p = itemCount(prevRep);
    const n = itemCount(nextRep);
    return { prevItems: p, nextItems: n, collapsed: p >= 10 && n < Math.max(3, p * 0.3) };
  }

  // --------------------------------------------------------------- comparison
  function diffBag(a, b) {
    const added = [];
    const removed = [];
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const k of keys) {
      const d = ((b || {})[k] || 0) - ((a || {})[k] || 0);
      for (let i = 0; i < d; i++) added.push(k);
      for (let i = 0; i < -d; i++) removed.push(k);
    }
    return { added, removed };
  }

  const mask = (s) => s.replace(/\d+/g, '#');
  const nums = (s) => (s.match(/\d+/g) || []).map(Number);

  function crossesZero(a, b) {
    const x = nums(a);
    const y = nums(b);
    if (x.length !== y.length) return true;
    for (let i = 0; i < x.length; i++) if ((x[i] === 0) !== (y[i] === 0)) return true;
    return false;
  }

  // Lines where only the number changes (e.g. "12 people viewing") are silent; crossing 0 counts as a change.
  function pairNumeric(grp) {
    const byMask = new Map();
    for (const x of grp.removed) {
      const k = mask(x);
      if (!byMask.has(k)) byMask.set(k, []);
      byMask.get(k).push(x);
    }
    const numeric = [];
    const added = [];
    for (const x of grp.added) {
      const l = byMask.get(mask(x));
      if (l && l.length) {
        const r = l.shift();
        if (crossesZero(r, x)) { added.push(x); numeric.push({ eski: r, yeni: x, sayilir: true }); }
        else numeric.push({ eski: r, yeni: x, sayilir: false });
      } else added.push(x);
    }
    const kalanRemoved = [];
    for (const [, l] of byMask) for (const r of l) kalanRemoved.push(r);
    const sessizEski = numeric.filter((n) => !n.sayilir).map((n) => n.eski);
    const removed = kalanRemoved.concat(numeric.filter((n) => n.sayilir).map((n) => n.eski));
    return { added, removed, numeric, sessizEski };
  }

  function compare(prevRep, nextRep) {
    const a = diffBag(prevRep.ids, nextRep.ids);
    const b = diffBag(prevRep.text, nextRep.text);
    const ham = { added: a.added.concat(b.added), removed: a.removed.concat(b.removed) };
    const p = pairNumeric(ham);
    return { added: p.added, removed: p.removed, numeric: p.numeric };
  }

  // --------------------------------------------------------------- two-read confirmation
  function confirm(pending, c) {
    const take = (list, pool) => {
      const left = new Map();
      for (const x of pool) left.set(x, (left.get(x) || 0) + 1);
      const yes = [];
      const no = [];
      for (const x of list) {
        const k = left.get(x) || 0;
        if (k > 0) { yes.push(x); left.set(x, k - 1); } else no.push(x);
      }
      return { yes, no };
    };
    const p = pending || { added: [], removed: [] };
    const a = take(c.added, p.added || []);
    const r = take(c.removed, p.removed || []);
    return {
      confirmed: { added: a.yes, removed: r.yes },
      pending: { added: a.no, removed: r.no },
    };
  }

  function applyToBaseline(base, confirmed, numeric) {
    const nb = { ids: { ...base.ids }, text: { ...base.text } };
    const bagOf = (k) => (/^[LOBI]\|/.test(k) ? nb.ids : nb.text);
    const inc = (k) => { const b = bagOf(k); b[k] = (b[k] || 0) + 1; };
    const dec = (k) => { const b = bagOf(k); b[k] = (b[k] || 0) - 1; if (b[k] <= 0) delete b[k]; };
    for (const k of confirmed.added) inc(k);
    for (const k of confirmed.removed) dec(k);
    // silent number changes are updated in the baseline at once (so the difference doesn't come back every time)
    for (const n of numeric || []) if (!n.sayilir) { dec(n.eski); inc(n.yeni); }
    return nb;
  }

  // --------------------------------------------------------------- alarm lines
  const TUR_ADI = { L: 'link', O: 'option', B: 'button', I: 'form field', A: 'link text', H: 'heading', S: 'list row', T: 'table row', P: 'text', D: 'status text', Y: 'text', M: 'event' };

  function alarmSatirlari(confirmed, etiket, enFazla) {
    const sinir = enFazla || 6;
    const satir = (k, isaret) => {
      const tur = T(TUR_ADI[k[0]] || 'item');
      let yazi = (etiket && etiket[k]) || k.slice(2);
      yazi = String(yazi).replace(/\|soluk$/, T(' (disabled)')).slice(0, 90);
      return isaret + ' — ' + tur + ': "' + yazi + (String((etiket && etiket[k]) || k.slice(2)).length > 90 ? '…' : '') + '"';
    };
    const hepsi = [].concat(
      confirmed.added.map((k) => satir(k, T('+ added'))),
      confirmed.removed.map((k) => satir(k, T('- removed'))),
    );
    if (hepsi.length <= sinir) return hepsi;
    return hepsi.slice(0, sinir - 1).concat([T('(+{n} more changes)', { n: hepsi.length - (sinir - 1) })]);
  }

  // --------------------------------------------------------------- the decision of one round
  // durum: { taban: {ids,text}, bekleyen: {added,removed}, etiket: {}, isinma? }
  // sinyal (optional): { olumsuz(k), satis(k) } — differences that count as a sale opening in warm-up
  // Returns: { durum, alarm: null | {satirlar, confirmed}, uyari, ozet, ilk }
  function turIsle(durum, rep, saglik, sinyal) {
    const oge = itemCount(rep);
    if (saglik) { // half-loaded / unreadable page: NO baseline, no comparison
      return { durum, alarm: null, uyari: saglik, ozet: T('unreadable: {n} items', { n: oge }), ilk: false };
    }
    if (!durum || !durum.taban) { // first read: take the baseline
      return {
        durum: { taban: { ids: { ...rep.ids }, text: { ...rep.text } }, bekleyen: { added: [], removed: [] }, etiket: { ...rep.etiket }, isinma: true },
        alarm: null, uyari: null, ozet: T('baseline taken ({n} items)', { n: oge }), ilk: true,
      };
    }
    let once = durum;
    const cokme = collapsed(once.taban, rep);
    if (cokme.collapsed) { // page suddenly emptied: baseline kept, silent warning
      return { durum: once, alarm: null, uyari: T('the page suddenly emptied ({once} → {sonra} items) — it may be reloading', { once: cokme.prevItems, sonra: cokme.nextItems }), ozet: T('unreadable: {n} items', { n: oge }), ilk: false };
    }
    let c = compare(once.taban, rep);
    const sv0 = sinyal || {};
    const olumsuz0 = sv0.olumsuz || (() => false);
    // VERSION WARM-UP: only non-negative REMOVED items are absorbed silently (a representation change deletes items: cookie
    // box, account link). NEW items and removed "sold out" texts go the normal way (confirmed by two reads):
    // a table that really appeared could otherwise be absorbed as "reading improved".
    // A text now counted as noise can't enter the representation again: even disabled, its removal isn't an opening, it's the rule's result.
    if (once.isinma === 'surum') {
      const kalkanlar = c.removed.filter((x) => !olumsuz0(x) || gurultu(x.slice(2).replace(/\|soluk$/, '')));
      once = { taban: applyToBaseline(once.taban, { added: [], removed: kalkanlar }, []), bekleyen: once.bekleyen, etiket: once.etiket };
      c = compare(once.taban, rep);
    }
    // WARM-UP: first healthy read after the first baseline. At first load the page may be half done (a seat map + cookie
    // window arriving later can give 100+ "changes" and a false alarm).
    // If the differences don't look like a sale opening (no negative text went away, no "buy" arrived) they're absorbed silently.
    if (once.isinma) {
      const sv = sv0;
      const olumsuz = olumsuz0;
      const satis = sv.satis || (() => false);
      const acilis = (c.removed.some(olumsuz) && !c.added.some(olumsuz)) || c.added.some((x) => satis(x) && !olumsuz(x));
      if (!acilis) {
        return {
          durum: { taban: { ids: { ...rep.ids }, text: { ...rep.text } }, bekleyen: { added: [], removed: [] }, etiket: { ...rep.etiket } },
          alarm: null, uyari: null, ozet: T('watching {n} items', { n: oge }) + (c.added.length + c.removed.length ? T(' · baseline completed') : ''), ilk: false,
        };
      }
    }
    // warm-up over (no isinma field in the state object below)
    let k = confirm(once.bekleyen, { added: c.added, removed: c.removed });
    // FAST MODE (per watch): if a negative text goes away and something positive takes its place, confirm in ONE read.
    // A single resale ticket can replace "0 No results" and be sold by the next read (~90 s)
    // -> the two-read rule would miss it.
    const sv = sinyal || {};
    if (sv.hizli && sv.olumsuz) {
      const acilis = c.removed.some(sv.olumsuz) && !c.added.some(sv.olumsuz) && c.added.some((x) => !sv.olumsuz(x));
      if (acilis) k = { confirmed: { added: c.added.slice(), removed: c.removed.slice() }, pending: { added: [], removed: [] } };
    }
    const etiket = { ...(once.etiket || {}), ...rep.etiket };
    const taban = applyToBaseline(once.taban, k.confirmed, c.numeric);
    // keep the label dictionary from growing: keys not in the baseline or pending are dropped
    const tut = new Set([...Object.keys(taban.ids), ...Object.keys(taban.text)]);
    for (const x of Object.keys(etiket)) {
      if (!tut.has(x) && !k.confirmed.added.includes(x) && !k.confirmed.removed.includes(x)
        && !(k.pending.added || []).includes(x) && !(k.pending.removed || []).includes(x)) delete etiket[x];
    }
    const onayli = k.confirmed.added.length + k.confirmed.removed.length;
    const bekleyenSay = (k.pending.added || []).length + (k.pending.removed || []).length;
    const ozet = T('watching {n} items', { n: oge })
      + (onayli ? T(' · {n} CHANGES', { n: onayli }) : '')
      + (bekleyenSay ? T(' · {n} changes awaiting confirmation', { n: bekleyenSay }) : '');
    return {
      durum: { taban, bekleyen: k.pending, etiket },
      alarm: onayli ? { satirlar: alarmSatirlari(k.confirmed, etiket, 5), confirmed: k.confirmed } : null,
      uyari: null, ozet, ilk: false,
    };
  }

  // Merge frames (iframes): each frame produces its own representation, the sets are added.
  function birlestir(temsiller) {
    const ids = {};
    const text = {};
    const etiket = {};
    for (const r of temsiller || []) {
      if (!r) continue;
      for (const [k, v] of Object.entries(r.ids || {})) ids[k] = (ids[k] || 0) + v;
      for (const [k, v] of Object.entries(r.text || {})) text[k] = (text[k] || 0) + v;
      Object.assign(etiket, r.etiket || {});
    }
    return { ids, text, etiket };
  }

  const API = {
    represent, compare, confirm, applyToBaseline, healthCheck, collapsed, birlestir, turIsle,
    alarmSatirlari, itemCount, cerezKutusuKes, sssKutusuKes, DURUM_SOZ, CEREZ, GURULTU,
  };
  if (typeof self !== 'undefined') self.GENEL_MOTOR = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();

// =====================================================================================================
// PageSiren — UI LANGUAGE
// =====================================================================================================
// English is the source text and also the dictionary key: T('Open site'). Other languages are dictionaries below.
// To add a language: copy the TR block, translate the values, add it to SOZLUK and to the language list in dashboard.html.
// Values may hold {params}: T('{n} min', { n: 5 }). Page data never passes through here, so baselines don't depend on the language.
// Language order: the dashboard setting, then --lang (self.__DIL), then the browser or OS language, then English.
// =====================================================================================================
(function (kok) {
  const TR = {
    // alarms and watch states (background.js, engine.js, app/pagesiren.js)
    'This site is read by the Chrome extension, but the extension is not running: NOT BEING READ. Open Chrome; if the extension is off, turn it on at chrome://extensions.': 'Bu site Chrome eklentisiyle okunuyor ama eklenti çalışmıyor: OKUNMUYOR. Chrome\'u açın; eklenti kapalıysa chrome://extensions\'tan açın.',
    'reading again…': 'yeniden okunuyor…',
    'page could not be read for {n} minutes': 'sayfa {n} dakikadır okunamadı',
    'the site put the page behind a bot check ({adres}) — {ipucu}': 'site bot kontrolüne aldı ({adres}) — {ipucu}',
    'the site is showing a bot check — {ipucu}': 'site bot kontrolü gösteriyor — {ipucu}',
    'bot check': 'bot kontrolü',
    'in a waiting room (queue) — watching continues by itself when your turn comes': 'bekleme sırasında (kuyruk) — sıra gelince izleme kendiliğinden devam eder',
    'A waiting room (queue) page opened — something may be starting!': 'Bekleme sırası (kuyruk) sayfası açıldı — satış başlıyor olabilir!',
    'Tab: {adres}': 'Sekme: {adres}',
    'login required': 'giriş gerekli',
    'the tab went to another page ({adres}) — may be a login / error page': 'sekme başka sayfaya gitti ({adres}) — giriş / hata sayfası olabilir',
    'page could not be read ({neden})': 'sayfa okunamadı ({neden})',
    'SESSION LOST — the page looks logged out; changes behind the login will not show.': 'OTURUM DÜŞTÜ — sayfa giriş yapılmamış görünüyor; satış açılsa da görünmez.',
    'Please log in to the site (Open site). Watching continues by itself after you log in.': 'Lütfen siteye giriş yapın (Siteyi aç). Giriş yapınca izleme kendiliğinden devam eder.',
    'use the "Open" button to open the site and pass the check': '"Aç" düğmesiyle siteyi açıp doğrulamayı geçin',
    'SESSION LOST — this page needs a login; without it, changes will not show. Log in to the site (Open site).': 'OTURUM DÜŞMÜŞ — bu sayfa giriş istiyor; giriş yapılmadan satış açılsa da görünmez. Siteye giriş yapın (Siteyi aç).',
    'Done': 'Tamamlandı',
    'Invalid address. Paste the full address starting with https://.': 'Adres geçersiz. https:// ile başlayan tam adresi yapıştırın.',
    'The address must start with http:// or https://.': 'Adres http:// ya da https:// ile başlamalı.',
    'Watch not found.': 'İzleme bulunamadı.',
    'TEST ALARM': 'TEST ALARMI',
    'This is a test alarm.': 'Bu bir test alarmıdır.',
    'If the sound and window work, everything is fine.': 'Ses ve pencere çalışıyorsa her şey yolunda.',
    'page cannot be read (only {n} characters of visible text; only {oge} readable items)': 'sayfa okunamıyor (sadece {n} karakter görünür yazı; sadece {oge} okunabilir öğe)',
    'most of the page is script, no readable content': 'sayfanın çoğu script, okunabilir içerik yok',
    'link': 'link', 'option': 'seçenek', 'button': 'buton', 'form field': 'form alanı', 'link text': 'link yazısı', 'heading': 'başlık',
    'list row': 'liste satırı', 'table row': 'tablo satırı', 'text': 'yazı', 'status text': 'durum yazısı', 'event': 'maç', 'item': 'öğe',
    ' (disabled)': ' (soluk)',
    '+ added': '+ eklendi',
    '- removed': '- kaldırıldı',
    '(+{n} more changes)': '(+{n} değişiklik daha)',
    'unreadable: {n} items': 'okunamadı: {n} öğe',
    'baseline taken ({n} items)': 'taban alındı ({n} öğe)',
    'the page suddenly emptied ({once} → {sonra} items) — it may be reloading': 'sayfa birden boşaldı ({once} → {sonra} öğe) — yeniden yükleniyor olabilir',
    'watching {n} items': '{n} öğe izleniyor',
    ' · baseline completed': ' · taban tamamlandı',
    ' · {n} CHANGES': ' · {n} DEĞİŞİKLİK',
    ' · {n} changes awaiting confirmation': ' · {n} değişiklik onay bekliyor',
    'PageSiren: WATCHING STOPPED': 'PageSiren: TAKİP DURDU',
    '{n} minutes without reading any page. You may miss alarms!': '{n} dakikadır hiçbir sayfa okunamadı. Alarm gelmeyebilir!',
    'The program is running, but the reader browser may be unable to open. Check the dashboard.': 'Program çalışıyor ama okuyucu tarayıcı açılamıyor olabilir. Takip ekranına bakın.',
    // dashboard
    'loading…': 'yükleniyor…',
    'version {v}': 'sürüm {v}',
    '⚠ The alarm helper is not running: the red window will not open, only the sound and this screen.': '⚠ Alarm yardımcısı çalışmıyor: kırmızı pencere açılmaz, sadece ses ve bu ekran çalışır.',
    'Active: {a} · OK: {b}': '{a} izleme açık · {b} sorunsuz',
    ' · {n} with problems (orange)': ' · {n} sorunlu (turuncu)',
    ' · alarm: red desktop window': ' · alarm: kırmızı masaüstü penceresi',
    ' · alarm: browser window': ' · alarm: tarayıcı penceresi',
    ' · alarm helper is running': ' · alarm yardımcısı çalışıyor',
    '⚠ No Chrome, Edge or Brave found: only "Plain HTTP" watches can be read.': '⚠ Chrome, Edge ya da Brave bulunamadı: sadece "Düz HTTP" izlemeler okunabilir.',
    'Open site': 'Siteyi aç',
    '✓ Done — stop watching': '✓ Tamam — izlemeyi durdur',
    'False alarm — don\'t ask again': 'Yanlış alarm — bir daha sorma',
    'Not now': 'Şimdilik geç',
    'No watches yet. Add a page below.': 'Henüz izleme yok. Aşağıdan sayfa ekleyin.',
    '▶ Start again': '▶ Tekrar başlat',
    'Delete': 'Sil',
    'OPEN': 'AÇIK',
    'Restore': 'Geri al',
    '{n} s': '{n} sn',
    '{n} min': '{n} dk',
    'Open': 'Aç',
    'Pause': 'Duraklat',
    '↻ Re-arm': '↻ Yeniden nöbet',
    'Edit': 'Düzenle',
    'Delete {ad}? (can be restored)': '{ad} silinsin mi? (geri alınabilir)',
    'words: {k}': 'kelime: {k}',
    'alarm on every change': 'her değişiklikte alarm',
    'fast mode': 'hızlı mod',
    'login check on': 'giriş kontrolü açık',
    'read without a browser': 'tarayıcısız okunuyor',
    'read by the Chrome extension': 'Chrome eklentisi okuyor',
    'last read: {n} s ago': 'son okuma: {n} sn önce',
    'Name': 'Ad',
    'Address': 'Adres',
    'Words (comma-separated)': 'Kelimeler (virgülle)',
    'Alarm on every change': 'Her değişiklikte alarm ver',
    'Save': 'Kaydet',
    'Cancel': 'Vazgeç',
    'Treat the current state of all pages as "normal"?': 'Tüm sayfaların şu anki hali "normal" kabul edilsin mi?',
    'Watches': 'İzlemeler',
    '↻ Re-arm all': '↻ Hepsini yeniden nöbete al',
    '+ Add a page to watch': '+ Yeni izleme ekle',
    'Name (e.g. New drop page)': 'Ad (ör. Yeni ürün sayfası)',
    'Page address (https://…)': 'Sayfa adresi (https://…)',
    'How often to check?': 'Ne sıklıkla baksın?',
    'Alarm only if these words appear (comma-separated, optional)': 'Sadece şu kelimeler geçerse alarm ver (virgülle, isteğe bağlı)',
    'More options': 'Daha fazla seçenek',
    'Login check: text you can only see when logged in (optional)': 'Giriş kontrolü: sadece giriş yapınca görünen yazı (isteğe bağlı)',
    'Fast: alarm on the first read when a "sold out" text goes away': 'Hızlı: "tükendi" yazısı kalkınca ilk okumada alarm ver',
    'Keep the tab open between reads (for slow pages)': 'Okumalar arasında sekmeyi açık tut (yavaş sayfalar için)',
    'Who reads the page': 'Sayfayı kim okusun',
    'Separate browser (handles JavaScript and logins)': 'Ayrı tarayıcı (JavaScript ve giriş çalışır)',
    'Plain HTTP (lightest, no JavaScript)': 'Düz HTTP (en hafif, JavaScript yok)',
    'My Chrome extension (Windows, extension installed)': 'Chrome eklentim (Windows, eklenti kurulu)',
    'Tip: for pages that need a login, press Open on the watch and log in once in the window that appears. PageSiren keeps that session.': 'İpucu: giriş isteyen sayfalarda izlemedeki Aç düğmesine basıp açılan pencerede bir kez giriş yapın. PageSiren o oturumu saklar.',
    'Add': 'Ekle',
    'Paused': 'Duraklatılanlar',
    'Recent alarms': 'Son alarmlar',
    'Deleted (can be restored)': 'Silinenler (geri alınabilir)',
    'Settings': 'Ayarlar',
    'Language': 'Dil',
    'Automatic': 'Otomatik',
    'Show the red alarm window': 'Kırmızı alarm penceresi açılsın',
    'Play the alarm sound with it': 'Alarm sesi de çalsın',
    'Sound length (seconds)': 'Ses süresi (saniye)',
    'Low memory: open watch tabs only while reading': 'Az bellek: izleme sekmelerini sadece okurken aç',
    'Start PageSiren when I log in': 'Oturum açınca PageSiren başlasın',
    'Play a test alarm': 'Test alarmı çal',
    'Export watches': 'İzlemeleri dışa aktar',
    'Import watches': 'İzlemeleri içe aktar',
    'Imported: {n}.': '{n} izleme içe aktarıldı.',
    'This file is not a PageSiren export.': 'Bu dosya bir PageSiren dışa aktarımı değil.',
    'Notifications (optional)': 'Bildirimler (isteğe bağlı)',
    'Alarms always show on this computer. You can also send them to your phone. These settings stay on this computer.': 'Alarm her zaman bu bilgisayarda görünür. İsterseniz telefonunuza da gönderebilirsiniz. Bu ayarlar sadece bu bilgisayarda durur.',
    'Bot token': 'Bot anahtarı',
    'Chat ID': 'Sohbet numarası',
    'Webhook address': 'Webhook adresi',
    'Server': 'Sunucu',
    'Topic': 'Konu',
    'Send a test': 'Test gönder',
    'Sent.': 'Gönderildi.',
    'Not sent: {neden}': 'Gönderilemedi: {neden}',
    'Saved.': 'Kaydedildi.',
    'done': 'tamamlandı',
    'false alarm': 'yanlış alarm',
    'dismissed': 'geçildi',
    'ignored': 'yoksayıldı',
    'closed': 'kapatıldı',
    // browser alarm window (app/alarm.html)
    'PAGESIREN ALARM': 'SAYFA ALARMI',
    'Mute': 'Sesi kapat',
    'Dashboard': 'Takip ekranı',
    'Close': 'Kapat',
    'Other alarms: {adlar}': 'Diğer alarmlar: {adlar}',
  };
  const SOZLUK = { tr: TR };
  let dil = '';

  function otomatik() {
    const yerel = kok.__DIL || (kok.navigator && kok.navigator.language) || (typeof Intl !== 'undefined' && new Intl.DateTimeFormat().resolvedOptions().locale) || 'en';
    return String(yerel).slice(0, 2).toLowerCase();
  }
  function T(metin, p) {
    if (!dil) T.dil('');
    const s = (SOZLUK[dil] && SOZLUK[dil][metin]) || metin;
    return p ? s.replace(/\{(\w+)\}/g, (m, k) => (k in p ? p[k] : m)) : s;
  }
  // T.dil() returns the language in use; T.dil('tr') sets it; T.dil('') goes back to automatic.
  T.dil = (d) => {
    if (d !== undefined) { const aday = d || otomatik(); dil = SOZLUK[aday] ? aday : 'en'; }
    return dil || T.dil('');
  };
  T.ceviriVar = (metin) => !!(SOZLUK[dil] && Object.hasOwn(SOZLUK[dil], metin));
  kok.T = T;
  if (typeof module !== 'undefined' && module.exports) module.exports = T;
})(typeof self !== 'undefined' ? self : globalThis);

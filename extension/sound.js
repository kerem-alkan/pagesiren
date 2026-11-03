// PageSiren — FALLBACK SOUND (sound.html, offscreen document)
// If the alarm helper (PageSirenAlarm.exe) is closed/unreachable, background.js sesCal() opens this document and sends {tip:'ses', sn}:
// siren.wav plays for the given time; {tip:'sesDur'} stops it.
let durdur = null;
chrome.runtime.onMessage.addListener((m) => {
  const s = document.getElementById('s');
  if (!s) return;
  if (m && m.tip === 'ses') {
    s.currentTime = 0;
    s.play().catch(() => {});
    clearTimeout(durdur);
    durdur = setTimeout(() => { s.pause(); }, Math.max(5, Number(m.sn) || 60) * 1000);
  }
  if (m && m.tip === 'sesDur') { clearTimeout(durdur); s.pause(); }
});

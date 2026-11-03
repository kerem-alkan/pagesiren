// =====================================================================================================
// PageSiren — START WHEN THE USER LOGS IN (only when the user ticks the box on the dashboard)
// =====================================================================================================
// Windows: a value under HKCU\...\Run that starts the alarm helper, which starts the program without a console window.
// macOS: a LaunchAgent file. Linux: a file in ~/.config/autostart. Nothing here needs admin rights.
// =====================================================================================================
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const RUN = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const ADI = 'PageSiren';
const macDosyasi = () => path.join(os.homedir(), 'Library', 'LaunchAgents', 'io.github.pagesiren.plist');
const linuxDosyasi = () => path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart', 'pagesiren.desktop');
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function windowsKomutu(o) {
  return '"' + o.exe + '" --app "' + o.uygulama + '" --node "' + o.node + '" --data "' + o.veri + '" --ui-port ' + o.port;
}
function macIcerik(o) {
  const parca = [o.node, o.uygulama, '--no-open', '--data', o.veri, '--port', String(o.port)].map((a) => '    <string>' + xml(a) + '</string>').join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n'
    + '  <key>Label</key><string>io.github.pagesiren</string>\n  <key>RunAtLoad</key><true/>\n  <key>ProgramArguments</key><array>\n' + parca + '\n  </array>\n</dict></plist>\n';
}
function linuxIcerik(o) {
  const t = (a) => '"' + String(a).replace(/(["\\`$])/g, '\\$1') + '"';
  return '[Desktop Entry]\nType=Application\nName=PageSiren\nExec=' + [o.node, o.uygulama, '--no-open', '--data', o.veri, '--port', String(o.port)].map(t).join(' ') + '\nX-GNOME-Autostart-enabled=true\n';
}

function durum() {
  try {
    if (process.platform === 'win32') { execFileSync('reg', ['query', RUN, '/v', ADI], { windowsHide: true, stdio: 'pipe' }); return true; }
    return fs.existsSync(process.platform === 'darwin' ? macDosyasi() : linuxDosyasi());
  } catch (e) { return false; }
}

function ayarla(acik, o) {
  try {
    if (process.platform === 'win32') {
      if (acik && !o.exe) return { hata: 'the alarm helper could not be built' };
      if (acik) execFileSync('reg', ['add', RUN, '/v', ADI, '/t', 'REG_SZ', '/d', windowsKomutu(o), '/f'], { windowsHide: true, stdio: 'pipe' });
      else if (durum()) execFileSync('reg', ['delete', RUN, '/v', ADI, '/f'], { windowsHide: true, stdio: 'pipe' });
      return { ok: true, acik };
    }
    const dosya = process.platform === 'darwin' ? macDosyasi() : linuxDosyasi();
    if (acik) {
      fs.mkdirSync(path.dirname(dosya), { recursive: true });
      fs.writeFileSync(dosya, process.platform === 'darwin' ? macIcerik(o) : linuxIcerik(o));
    } else if (fs.existsSync(dosya)) fs.unlinkSync(dosya);
    return { ok: true, acik };
  } catch (e) { return { hata: String(e && e.message || e).slice(0, 120) }; }
}

module.exports = { durum, ayarla, windowsKomutu, macIcerik, linuxIcerik };

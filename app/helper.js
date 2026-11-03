// =====================================================================================================
// PageSiren — BUILDS THE WINDOWS ALARM HELPER
// =====================================================================================================
// There is no binary in this repository: at first run, windows-helper/PageSirenAlarm.cs is compiled with the C# compiler that ships
// with Windows, into <data>/helper. If that fails, the program simply uses the browser alarm window instead.
// =====================================================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function derleyiciBul() {
  const kok = process.env.WINDIR || 'C:\\Windows';
  return ['Framework64', 'Framework'].map((f) => path.join(kok, 'Microsoft.NET', f, 'v4.0.30319', 'csc.exe')).find((p) => fs.existsSync(p)) || null;
}

// Returns the exe path or null. The file name holds the version: a running older helper stays locked and can't be overwritten.
function yardimciHazirla(veri, surum, gunluk) {
  if (process.platform !== 'win32') return null;
  const klasor = path.join(veri, 'helper');
  const exe = path.join(klasor, 'PageSirenAlarm-' + surum + '.exe');
  if (fs.existsSync(exe)) return exe;
  const csc = derleyiciBul();
  if (!csc) { gunluk('helper: C# compiler not found, using the browser alarm window'); return null; }
  try {
    fs.mkdirSync(klasor, { recursive: true });
    execFileSync(csc, ['/nologo', '/target:winexe', '/optimize+', '/codepage:65001', '/out:' + exe,
      '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Web.Extensions.dll',
      path.join(__dirname, '..', 'windows-helper', 'PageSirenAlarm.cs')], { windowsHide: true, timeout: 120000, stdio: 'pipe' });
    gunluk('helper: built ' + path.basename(exe));
  } catch (e) {
    gunluk('helper: build failed, using the browser alarm window: ' + String(e && e.stdout || e && e.message || e).slice(0, 300));
    return null;
  }
  for (const f of fs.readdirSync(klasor)) {
    if (f !== path.basename(exe)) { try { fs.unlinkSync(path.join(klasor, f)); } catch (e) { /* still running: next time */ } }
  }
  return exe;
}

module.exports = { yardimciHazirla, derleyiciBul };

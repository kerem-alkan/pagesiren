// Builds dist/PageSiren-Setup.exe: the program, a Node runtime and the small installer from windows-installer/. Nothing gets installed or opened.
// Uses only what ships with Windows: the C# compiler and tar. The repository holds no binaries; this file makes them for a release.
// Run: node tools/build-windows.js [--node <path to node.exe>]   (default: the node.exe running this script)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { derleyiciBul } = require('../app/helper');

if (process.platform !== 'win32') { console.error('the installer can only be built on Windows'); process.exit(2); }
const KOK = path.join(__dirname, '..');
const DIST = path.join(KOK, 'dist');
const secenek = process.argv.indexOf('--node');
const NODE = path.resolve(secenek >= 0 ? process.argv[secenek + 1] : process.execPath);
const KAYNAK = path.join(KOK, 'windows-installer', 'PageSirenSetup.cs');
const csc = derleyiciBul();
if (!csc) { console.error('C# compiler not found'); process.exit(2); }

const gecici = fs.mkdtempSync(path.join(os.tmpdir(), 'pagesiren-build-'));
const paket = path.join(gecici, 'paket');
fs.mkdirSync(path.join(paket, 'runtime'), { recursive: true });

// What npm would ship, plus package.json
const pj = JSON.parse(fs.readFileSync(path.join(KOK, 'package.json'), 'utf8'));
for (const ad of [...pj.files, 'package.json']) fs.cpSync(path.join(KOK, ad), path.join(paket, ad), { recursive: true });

// The Node runtime, unchanged, keeps its signature. Its license has to travel with it; a local test build may not have one next to node.exe.
fs.copyFileSync(NODE, path.join(paket, 'runtime', 'node.exe'));
const nodeLisans = path.join(path.dirname(NODE), 'LICENSE');
if (fs.existsSync(nodeLisans)) fs.copyFileSync(nodeLisans, path.join(paket, 'runtime', 'LICENSE'));
else if (process.env.CI) { console.error('the Node license was not found next to node.exe'); process.exit(1); }
else fs.writeFileSync(path.join(paket, 'runtime', 'LICENSE'), 'Local test build. Node.js license: https://github.com/nodejs/node/blob/main/LICENSE\n');

// An .ico can simply wrap a PNG
const png = fs.readFileSync(path.join(KOK, 'extension', 'icon.png'));
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4); ico[6] = png.readUInt32BE(16) & 255; ico[7] = png.readUInt32BE(20) & 255;
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12); ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18);
const ikon = path.join(gecici, 'icon.ico');
fs.writeFileSync(ikon, Buffer.concat([ico, png]));

const derle = (cikti, ...ek) => execFileSync(csc, ['/nologo', '/target:winexe', '/optimize+', '/codepage:65001', '/win32icon:' + ikon, '/out:' + cikti,
  '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.IO.Compression.dll', ...ek, KAYNAK], { stdio: 'pipe', windowsHide: true });

derle(path.join(paket, 'PageSiren.exe'));
const zipDosya = path.join(gecici, 'payload.zip');
const tar = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'tar.exe');
execFileSync(tar, ['-a', '-c', '-f', zipDosya, '-C', paket, ...fs.readdirSync(paket)], { stdio: 'pipe', windowsHide: true });

fs.mkdirSync(DIST, { recursive: true });
const cikti = path.join(DIST, 'PageSiren-Setup.exe');
derle(cikti, '/resource:' + zipDosya + ',payload');
const ozet = crypto.createHash('sha256').update(fs.readFileSync(cikti)).digest('hex');
fs.writeFileSync(cikti + '.sha256', ozet + '  PageSiren-Setup.exe\n');
try { fs.rmSync(gecici, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }); } catch (e) { /* temp folder */ }
console.log('PageSiren-Setup.exe:', Math.round(fs.statSync(cikti).size / 1048576), 'MB, version', pj.version, ', sha256', ozet);

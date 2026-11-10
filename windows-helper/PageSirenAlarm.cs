// =====================================================================================================
// PageSirenAlarm.cs - PageSiren desktop alarm helper                          C# 5 / .NET Framework 4
// =====================================================================================================
// SINGLE process (mutex): waits invisibly (icon next to the clock).
// When the watch program (app/pagesiren.js) or the PageSiren extension sends an "alarm" to 127.0.0.1:47430, opens a blinking red window in the
// middle of the screen, ON TOP OF EVERYTHING, and plays an alarm sound (C:\Windows\Media\Alarm01.wav). Opens no CMD/PowerShell window.
//
// SUPERVISOR: starts pagesiren.js; restarts it if it exits; if it writes no summary for 3 min (stuck) closes and restarts it.
// WATCHDOG  : if no summary arrives from any source for 5 min it warns with the red window, ONCE per outage.
//          If the computer slept the time starts over. No warning when there are no active watches (aktifSayi 0).
//
// LOCAL HTTP API (127.0.0.1 only; body at most 200,000 bytes — the rest is CUT)
//   GET  /durum     -> {"ok":true,"acik":<window visible>,"gelen":<alarms received>,"mini":<did pagesiren.js write in the last 3 min>,"ozetYasiSn":<age of the newest summary>}
//   POST /alarm     {ad, satirlar[], url, ses, sesSn}  -> red window + sound   (extension / origin-less only)
//   POST /kapat     -> hides the window, stops the sound (extension: when no alarm remains open)
//   POST /ozet      status summary written every 30 s (kept in memory); ?kaynak=mini = pagesiren.js, no parameter = extension
//   GET  /ozet      -> latest summary (watches, open alarms, tabs, last alarms; full backup on DISA_AKTAR). The app's if it's running;
//                      choose with ?kaynak=mini / ?kaynak=eklenti
//   POST /komut     one JSON object; ONLY local requests without an Origin header (web pages can't write). Goes to the app if it's running
//   POST /one-getir {pid} -> raises the reading browser's visible windows (the "Open" button's window) above the others; origin-less only.
//                      -> {"ok":true,"pencere":<windows raised>}. Only a chrome / msedge / brave process; minimized or off-screen windows stay.
//   GET  /komutlar  -> pending commands (receiver: ?kaynak=mini or eklenti; the queue empties)
// Security: if Origin is present and isn't chrome-extension://, 403. NOT open to the network. No authentication,
//   so never expose this port.
// Log: helper.log ("alarm shown: <name>" lines).
// Build: build.ps1. Test: PageSirenAlarm.exe --test --port 47398 -> no window or icon, writes what it receives to test-alarmlar.jsonl; starts the app
//   only if --app is given (test/helper.test.js). Other options: --ui-port --data --watchdog-sec --app-dead-sec --node --lang
// =====================================================================================================
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Media;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

static class Program
{
    static Control ui;
    static string dil = "en";
    public static string Y(string en, string trMetin, string deMetin, string esMetin) { return dil == "tr" ? trMetin : dil == "de" ? deMetin : dil == "es" ? esMetin : en; }
    static string DilSec(string d) { d = (d ?? "").ToLowerInvariant(); return d == "tr" || d == "de" || d == "es" ? d : "en"; }
    static AlarmPenceresi pencere;
    static bool testModu;
    static string klasor = AppDomain.CurrentDomain.BaseDirectory;
    static int gelenSayisi = 0;
    // Status summary (written every 30 s) and local command queue (e.g. "add a watch"; taken every 30 s): one per source.
    static string sonOzet = "{\"ok\":false,\"neden\":\"no summary yet\"}";
    static string sonOzetMini = null;
    static long ozetEklentiTik = 0, ozetMiniTik = 0;
    static int aktifSayi = -1;
    static readonly List<string> komutlar = new List<string>();
    static readonly List<string> komutlarMini = new List<string>();
    const int MINI_TAZE_SN = 180;
    // Watchdog + supervisor
    static int bekciSn = 300, miniOluSn = 180, uiPort = 47431;
    static string miniYol = null, nodeYol = null, veriKlasoru = null;
    static NotifyIcon simge;

    static double Yas(long tik) { return tik == 0 ? double.MaxValue : TimeSpan.FromTicks(DateTime.UtcNow.Ticks - tik).TotalSeconds; }
    static bool MiniTaze() { return Yas(Interlocked.Read(ref ozetMiniTik)) < MINI_TAZE_SN; }
    static string Secenek(string[] a, string ad) { int i = Array.IndexOf(a, ad); return i >= 0 && i + 1 < a.Length ? a[i + 1] : null; }

    [STAThread]
    static void Main(string[] args)
    {
        testModu = Array.IndexOf(args, "--test") >= 0;
        string dilSec = Secenek(args, "--lang");
        dil = DilSec(dilSec ?? System.Globalization.CultureInfo.CurrentUICulture.TwoLetterISOLanguageName);
        int port = 47430;
        int pi = Array.IndexOf(args, "--port");
        if (pi >= 0 && pi + 1 < args.Length) int.TryParse(args[pi + 1], out port);
        string sec;
        if ((sec = Secenek(args, "--ui-port")) != null) int.TryParse(sec, out uiPort);
        if ((sec = Secenek(args, "--watchdog-sec")) != null) int.TryParse(sec, out bekciSn);
        if ((sec = Secenek(args, "--app-dead-sec")) != null) int.TryParse(sec, out miniOluSn);
        veriKlasoru = Secenek(args, "--data") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PageSiren");
        nodeYol = Secenek(args, "--node") ?? NodeBul();
        miniYol = Secenek(args, "--app");
        if (miniYol == null && !testModu) miniYol = Path.GetFullPath(Path.Combine(klasor, "..", "app", "pagesiren.js"));

        bool yeni;
        Mutex mtx = new Mutex(true, "PageSiren_Alarm_" + port, out yeni);
        if (!yeni) return; // already running

        // An unexpected error must not CLOSE the program: catch it, write to file, carry on.
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += delegate (object s, ThreadExceptionEventArgs e) { Kaydet("UI error: " + e.Exception); };
        AppDomain.CurrentDomain.UnhandledException += delegate (object s, UnhandledExceptionEventArgs e) { Kaydet("CRASH: " + e.ExceptionObject); };
        Kaydet("started (port " + port + ")");
        Application.EnableVisualStyles();
        ui = new Control();
        ui.CreateControl();
        IntPtr h = ui.Handle; // create the UI thread

        Thread t = new Thread(delegate () { Dinle(port); });
        t.IsBackground = true;
        t.Start();
        Thread b = new Thread(Bekci);
        b.IsBackground = true;
        b.Start();
        if (!testModu) SimgeKur();
        Application.Run();
        GC.KeepAlive(mtx);
    }

    public static void Kaydet(string satir)
    {
        try { File.AppendAllText(Path.Combine(klasor, "helper.log"), DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + satir + "\r\n", Encoding.UTF8); } catch { }
    }

    static void Dinle(int port)
    {
        TcpListener dinleyici = new TcpListener(IPAddress.Loopback, port);
        dinleyici.Start();
        while (true)
        {
            TcpClient c = dinleyici.AcceptTcpClient();
            ThreadPool.QueueUserWorkItem(delegate (object o) { try { Isle((TcpClient)o); } catch { } }, c);
        }
    }

    static void Isle(TcpClient c)
    {
        using (c)
        {
            c.ReceiveTimeout = 5000;
            NetworkStream s = c.GetStream();
            // read headers
            MemoryStream bas = new MemoryStream();
            int b, son4 = 0;
            while ((b = s.ReadByte()) >= 0)
            {
                bas.WriteByte((byte)b);
                son4 = ((son4 << 8) | b) & 0x7FFFFFFF;
                if ((son4 & 0xFFFFFF) == 0x0A0D0A && bas.Length >= 4) break; // \n\r\n (end of \r\n\r\n)
                if (bas.Length > 16384) return;
            }
            string basliklar = Encoding.ASCII.GetString(bas.ToArray());
            string[] satirlar = basliklar.Split(new string[] { "\r\n" }, StringSplitOptions.None);
            string[] ilk = satirlar[0].Split(' ');
            if (ilk.Length < 2) return;
            string yontem = ilk[0], yol = ilk[1];
            bool kaynakMini = yol.Contains("kaynak=mini"), kaynakEklenti = yol.Contains("kaynak=eklenti");
            int uzunluk = 0;
            string koken = "";
            foreach (string sat in satirlar)
            {
                int i = sat.IndexOf(':');
                if (i <= 0) continue;
                string ad = sat.Substring(0, i).Trim().ToLowerInvariant(), deger = sat.Substring(i + 1).Trim();
                if (ad == "content-length") int.TryParse(deger, out uzunluk);
                if (ad == "origin") koken = deger;
            }
            byte[] govde = new byte[Math.Max(0, Math.Min(uzunluk, 200000))];
            int okunan = 0;
            while (okunan < govde.Length) { int n = s.Read(govde, okunan, govde.Length - okunan); if (n <= 0) break; okunan += n; }
            string metin = Encoding.UTF8.GetString(govde, 0, okunan);

            // Only the PageSiren extension or an origin-less local request (pagesiren.js): web pages can't trigger an alarm.
            if (koken != "" && !koken.StartsWith("chrome-extension://")) { Cevap(s, 403, "{\"ok\":false}", koken); return; }

            if (yontem == "OPTIONS") { Cevap(s, 204, "", koken); return; }
            if (yontem == "GET" && yol.StartsWith("/durum"))
            {
                bool acik = pencere != null && !pencere.IsDisposed && pencere.Visible;
                double yas = Math.Min(Yas(Interlocked.Read(ref ozetMiniTik)), Yas(Interlocked.Read(ref ozetEklentiTik)));
                Cevap(s, 200, "{\"ok\":true,\"acik\":" + (acik ? "true" : "false") + ",\"gelen\":" + gelenSayisi + ",\"mini\":" + (MiniTaze() ? "true" : "false")
                    + ",\"ozetYasiSn\":" + (yas == double.MaxValue ? "null" : ((long)yas).ToString()) + "}", koken);
                return;
            }
            if (yontem == "POST" && yol.StartsWith("/alarm"))
            {
                Dictionary<string, object> d = null;
                try { d = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(metin); } catch { }
                if (d == null) { Cevap(s, 400, "{\"ok\":false}", koken); return; }
                Interlocked.Increment(ref gelenSayisi);
                AlarmYolla(d, metin);
                Cevap(s, 200, "{\"ok\":true}", koken);
                return;
            }
            if (yontem == "POST" && yol.StartsWith("/ozet"))
            {
                if (kaynakMini) { sonOzetMini = metin; Interlocked.Exchange(ref ozetMiniTik, DateTime.UtcNow.Ticks); }
                else { sonOzet = metin; Interlocked.Exchange(ref ozetEklentiTik, DateTime.UtcNow.Ticks); }
                // From the start of the body: is anything being watched? (older extensions have no such field: unknown)
                Match am = Regex.Match(metin.Length > 200 ? metin.Substring(0, 200) : metin, "\"aktifSayi\":(\\d+)");
                if (kaynakMini || !MiniTaze()) aktifSayi = am.Success ? int.Parse(am.Groups[1].Value) : -1;
                Cevap(s, 200, "{\"ok\":true}", koken);
                return;
            }
            if (yontem == "GET" && yol.StartsWith("/ozet"))
            {
                string oz = sonOzetMini;
                bool miniyiVer = kaynakMini || (!kaynakEklenti && oz != null && (MiniTaze() || Interlocked.Read(ref ozetMiniTik) >= Interlocked.Read(ref ozetEklentiTik)));
                Cevap(s, 200, miniyiVer ? (oz ?? "{\"ok\":false,\"neden\":\"the app has not written a summary yet\"}") : sonOzet, koken);
                return;
            }
            if (yontem == "POST" && yol.StartsWith("/komut"))
            {
                // Only tools on this computer (origin-less request); extensions/web pages can't write commands.
                if (koken != "") { Cevap(s, 403, "{\"ok\":false}", koken); return; }
                try { new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(metin); } catch { Cevap(s, 400, "{\"ok\":false}", koken); return; }
                List<string> hedef = kaynakMini || (!kaynakEklenti && MiniTaze()) ? komutlarMini : komutlar;
                lock (hedef) { if (hedef.Count < 50) hedef.Add(metin); }
                Cevap(s, 200, "{\"ok\":true}", koken);
                return;
            }
            if (yontem == "POST" && yol.StartsWith("/one-getir"))
            {
                // Local tools only (pagesiren.js after "Open"): a web page or an extension can't move windows
                if (koken != "") { Cevap(s, 403, "{\"ok\":false}", koken); return; }
                Match pm = Regex.Match(metin, "\"pid\"\\s*:\\s*(\\d{1,9})");
                int n = pm.Success ? OneGetir(int.Parse(pm.Groups[1].Value)) : 0;
                Cevap(s, 200, "{\"ok\":true,\"pencere\":" + n + "}", koken);
                return;
            }
            if (yontem == "GET" && yol.StartsWith("/komutlar"))
            {
                string json;
                List<string> kuyruk = kaynakMini ? komutlarMini : komutlar;
                lock (kuyruk) { json = "[" + string.Join(",", kuyruk.ToArray()) + "]"; kuyruk.Clear(); }
                Cevap(s, 200, json, koken);
                return;
            }
            if (yontem == "POST" && yol.StartsWith("/cikis"))
            {
                // A deliberate exit of the program (Ctrl+C, Quit): the helper closes too, so the supervisor does not bring it back. Local tools only.
                if (koken != "") { Cevap(s, 403, "{\"ok\":false}", koken); return; }
                Cevap(s, 200, "{\"ok\":true}", koken);
                miniYol = null;
                if (!testModu) Cikis();
                return;
            }
            if (yontem == "POST" && yol.StartsWith("/kapat"))
            {
                if (testModu) File.AppendAllText(Path.Combine(klasor, "test-alarmlar.jsonl"), "{\"kapat\":true}\n", Encoding.UTF8);
                else ui.BeginInvoke(new Action(delegate () { if (pencere != null && !pencere.IsDisposed) pencere.Kapat(); }));
                Cevap(s, 200, "{\"ok\":true}", koken);
                return;
            }
            Cevap(s, 404, "{\"ok\":false}", koken);
        }
    }

    static void Cevap(NetworkStream s, int kod, string govde, string koken)
    {
        byte[] g = Encoding.UTF8.GetBytes(govde);
        string durum = kod == 200 ? "OK" : kod == 204 ? "No Content" : kod == 403 ? "Forbidden" : kod == 400 ? "Bad Request" : "Not Found";
        string b = "HTTP/1.1 " + kod + " " + durum + "\r\n"
            + "Content-Type: application/json; charset=utf-8\r\n"
            + "Access-Control-Allow-Origin: " + (koken != "" ? koken : "*") + "\r\n"
            + "Access-Control-Allow-Headers: Content-Type\r\n"
            + "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
            + "Access-Control-Allow-Private-Network: true\r\n"
            + "Content-Length: " + g.Length + "\r\nConnection: close\r\n\r\n";
        byte[] bb = Encoding.ASCII.GetBytes(b);
        s.Write(bb, 0, bb.Length);
        if (g.Length > 0) s.Write(g, 0, g.Length);
        s.Flush();
    }

    // ------------------------------------------------------------------ alarm
    static void AlarmYolla(Dictionary<string, object> d, string metin)
    {
        if (testModu) { lock (komutlar) File.AppendAllText(Path.Combine(klasor, "test-alarmlar.jsonl"), metin.Replace("\r", "").Replace("\n", " ") + "\n", Encoding.UTF8); }
        else ui.BeginInvoke(new Action(delegate () { AlarmGoster(d); }));
    }

    // ------------------------------------------------------------------ watchdog + supervisor (every 5 s)
    static void Bekci()
    {
        long baslangic = DateTime.UtcNow.Ticks;
        long taban = baslangic; // times count from now on (helper just started / computer woke up)
        long sonTur = baslangic;
        bool uyarildi = false;
        long sonBaslatma = 0;
        int geriCekilme = 5;
        while (true)
        {
            Thread.Sleep(testModu ? 500 : 5000);
            try
            {
                long simdi = DateTime.UtcNow.Ticks;
                if (Yas(sonTur) > 120) { taban = simdi; Kaydet("computer slept: times start over"); }
                sonTur = simdi;
                if (miniYol != null) MiniDenetle(taban, ref sonBaslatma, ref geriCekilme);

                double yas = Math.Min(Math.Min(Yas(Interlocked.Read(ref ozetMiniTik)), Yas(Interlocked.Read(ref ozetEklentiTik))), Yas(taban));
                if (aktifSayi == 0 || yas < bekciSn) uyarildi = false;
                else if (!uyarildi)
                {
                    uyarildi = true;
                    Kaydet("WATCHDOG: no summary for " + (long)yas + " s");
                    Dictionary<string, object> d = new Dictionary<string, object>();
                    d["ad"] = Y("PageSiren: WATCHING STOPPED", "PageSiren: TAKİP DURDU", "PageSiren: BEOBACHTUNG GESTOPPT", "PageSiren: VIGILANCIA DETENIDA");
                    d["satirlar"] = new object[] { ((long)yas / 60) + Y(" minutes without any word from the watch program. You may miss alarms!", " dakikadır takip programından haber yok. Alarm gelmeyebilir!", " Minuten ohne Nachricht vom Beobachtungsprogramm. Alarme können ausbleiben!", " minutos sin noticias del programa de vigilancia. ¡Podrías perderte alarmas!"), Y("Trying to restart it; if this window comes back, check the dashboard.", "Yeniden başlatmayı deniyorum; bu pencere tekrar gelirse takip ekranına bakın.", "Ich versuche, es neu zu starten; kommt dieses Fenster wieder, sieh im Dashboard nach.", "Intento reiniciarlo; si esta ventana vuelve a aparecer, revisa el panel.") };
                    d["url"] = "http://127.0.0.1:" + uiPort + "/";
                    d["ses"] = true;
                    d["sesSn"] = 60;
                    AlarmYolla(d, new JavaScriptSerializer().Serialize(d));
                }
            }
            catch (Exception ex) { Kaydet("watchdog error: " + ex.Message); }
        }
    }

    static void MiniDenetle(long taban, ref long sonBaslatma, ref int geriCekilme)
    {
        if (PortAcik(uiPort))
        {
            // Looks like it's running but writes no summary: stuck. It's closed; restarts next round.
            double sessiz = Math.Min(Yas(Interlocked.Read(ref ozetMiniTik)), Math.Min(Yas(taban), Yas(sonBaslatma)));
            if (sessiz < miniOluSn) return;
            Kaydet("app wrote no summary for " + (long)sessiz + " s: restarting");
            try
            {
                int pid = int.Parse(File.ReadAllText(Path.Combine(veriKlasoru, "pagesiren.pid")).Trim());
                Process p = Process.GetProcessById(pid);
                if (p.ProcessName.ToLowerInvariant() == "node") p.Kill();
            }
            catch (Exception ex) { Kaydet("app could not be closed: " + ex.Message); }
            sonBaslatma = DateTime.UtcNow.Ticks; // wait one round
            return;
        }
        if (Yas(sonBaslatma) < geriCekilme) return;
        // If it keeps exiting right away, don't tire the computer: 5 -> 60 s
        geriCekilme = Yas(sonBaslatma) < 90 ? Math.Min(geriCekilme * 2, 60) : 5;
        sonBaslatma = DateTime.UtcNow.Ticks;
        MiniBaslat();
    }

    static bool PortAcik(int p)
    {
        try
        {
            using (TcpClient c = new TcpClient())
            {
                IAsyncResult r = c.BeginConnect(IPAddress.Loopback, p, null, null);
                if (!r.AsyncWaitHandle.WaitOne(800)) return false;
                c.EndConnect(r);
                return true;
            }
        }
        catch { return false; }
    }

    static string NodeBul()
    {
        string pf = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
        if (File.Exists(pf)) return pf;
        foreach (string k in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
        {
            try { string y = Path.Combine(k.Trim(), "node.exe"); if (File.Exists(y)) return y; } catch { }
        }
        return null;
    }

    // NOT Process.Start: that makes the child inherit the helper's sockets; when the helper closes, 47430 stays held by the app and the helper can't reopen.
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct BASLATMA { public int cb; public string r1, masaustu, baslik; public int x, y, g, h, sx, sy, renk, bayrak; public short goster, r2; public IntPtr r3, gir, cik, hata; }
    [StructLayout(LayoutKind.Sequential)]
    struct SUREC { public IntPtr hSurec, hKol; public int pid, kolId; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcess(string uyg, StringBuilder komut, IntPtr a, IntPtr b, bool miras, uint bayrak, IntPtr ortam, string dizin, ref BASLATMA si, out SUREC pi);
    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr h);

    // --- the "Open" button's window. Windows won't let a program in the background take the foreground right after the user clicked
    // somewhere else, so the window opened behind the dashboard. Moving a window up in the stacking order is allowed: it goes to the top
    // of the always-on-top band and straight back down, which leaves it above every ordinary window. Then the foreground is asked for,
    // which Windows may refuse (the taskbar button flashes then).
    delegate bool PencereSayici(IntPtr h, IntPtr l);
    [StructLayout(LayoutKind.Sequential)]
    struct DORTGEN { public int sol, ust, sag, alt; }
    [DllImport("user32.dll")] static extern bool EnumWindows(PencereSayici cb, IntPtr l);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out DORTGEN r);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr sonra, int x, int y, int g, int y2, uint bayrak);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);

    static int OneGetir(int pid)
    {
        string ad;
        try { using (Process p = Process.GetProcessById(pid)) ad = p.ProcessName.ToLowerInvariant(); } catch { return 0; }
        if (ad != "chrome" && ad != "msedge" && ad != "brave") return 0;
        List<IntPtr> bulunan = new List<IntPtr>();
        EnumWindows(delegate (IntPtr h, IntPtr l)
        {
            uint sahip;
            GetWindowThreadProcessId(h, out sahip);
            if (sahip != (uint)pid || !IsWindowVisible(h) || IsIconic(h)) return true;
            DORTGEN r;
            // the reading window waits minimized and off-screen; small ones are bubbles ("Translate this page?")
            if (!GetWindowRect(h, out r) || r.sag - r.sol < 300 || r.alt - r.ust < 200 || r.sol < -10000 || r.ust < -10000) return true;
            StringBuilder sinif = new StringBuilder(64);
            GetClassName(h, sinif, 64);
            if (sinif.ToString().StartsWith("Chrome_WidgetWin")) bulunan.Add(h);
            return true;
        }, IntPtr.Zero);
        const uint YERINDE = 0x0001 | 0x0002 | 0x0010; // SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE
        foreach (IntPtr h in bulunan)
        {
            SetWindowPos(h, new IntPtr(-1), 0, 0, 0, 0, YERINDE); // HWND_TOPMOST
            SetWindowPos(h, new IntPtr(-2), 0, 0, 0, 0, YERINDE); // HWND_NOTOPMOST
        }
        if (bulunan.Count > 0) SetForegroundWindow(bulunan[0]);
        Kaydet("Open window raised: " + bulunan.Count);
        return bulunan.Count;
    }

    static void MiniBaslat()
    {
        if (nodeYol == null) { Kaydet("node.exe not found: app not started"); return; }
        if (!File.Exists(miniYol)) { Kaydet("app not found: " + miniYol); return; }
        string komut = "\"" + nodeYol + "\" --max-semi-space-size=4 --max-old-space-size=256 \"" + miniYol + "\" --no-open --data \"" + veriKlasoru + "\" --port " + uiPort;
        BASLATMA si = new BASLATMA();
        si.cb = Marshal.SizeOf(typeof(BASLATMA));
        SUREC pi;
        const uint CREATE_NO_WINDOW = 0x08000000;
        if (CreateProcess(nodeYol, new StringBuilder(komut), IntPtr.Zero, IntPtr.Zero, false, CREATE_NO_WINDOW, IntPtr.Zero, Path.GetDirectoryName(miniYol), ref si, out pi))
        {
            CloseHandle(pi.hSurec);
            CloseHandle(pi.hKol);
            Kaydet("app started (pid " + pi.pid + ")");
        }
        else Kaydet("app could not start: error " + Marshal.GetLastWin32Error());
    }

    // ------------------------------------------------------------------ icon next to the clock
    // Tray menu "Quit" and POST /cikis: stops the program, removes the icon, exits.
    public static void Cikis()
    {
        miniYol = null;
        ThreadPool.QueueUserWorkItem(delegate
        {
            try
            {
                HttpWebRequest q = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + uiPort + "/dur");
                q.Method = "POST"; q.ContentLength = 0; q.Timeout = 2000;
                q.GetResponse().Close();
            }
            catch { }
            try { if (simge != null) simge.Visible = false; } catch { }
            Environment.Exit(0);
        });
    }

    public static void EkranAc()
    {
        string adres = "http://127.0.0.1:" + uiPort + "/";
        ThreadPool.QueueUserWorkItem(delegate { try { Process.Start(adres); } catch (Exception ex) { Kaydet("dashboard could not open: " + ex.Message); } });
    }

    static void SimgeKur()
    {
        try
        {
            Bitmap bm = new Bitmap(32, 32);
            using (Graphics g = Graphics.FromImage(bm))
            {
                g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                g.Clear(Color.Transparent);
                using (Brush kirmizi = new SolidBrush(Color.FromArgb(212, 32, 44))) g.FillEllipse(kirmizi, 1, 1, 30, 30);
                using (Font f = new Font("Segoe UI", 15f, FontStyle.Bold, GraphicsUnit.Pixel)) g.DrawString("PS", f, Brushes.White, 4f, 6f);
            }
            simge = new NotifyIcon();
            simge.Icon = Icon.FromHandle(bm.GetHicon());
            simge.Text = "PageSiren";
            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Items.Add(Y("Open the dashboard", "Takip ekranını aç", "Dashboard öffnen", "Abrir el panel"), null, delegate { EkranAc(); });
            menu.Items.Add(Y("Quit PageSiren", "PageSiren'i kapat", "PageSiren beenden", "Salir de PageSiren"), null, delegate { Cikis(); });
            simge.ContextMenuStrip = menu;
            simge.MouseClick += delegate (object s, MouseEventArgs e) { if (e.Button == MouseButtons.Left) EkranAc(); };
            simge.Visible = true;
            System.Windows.Forms.Timer zaman = new System.Windows.Forms.Timer();
            zaman.Interval = 15000;
            zaman.Tick += delegate
            {
                double yas = Math.Min(Yas(Interlocked.Read(ref ozetMiniTik)), Yas(Interlocked.Read(ref ozetEklentiTik)));
                string m = yas == double.MaxValue ? Y("PageSiren: starting", "PageSiren: başlıyor", "PageSiren: startet", "PageSiren: iniciando") : yas > 120 ? Y("PageSiren: NO WORD (", "PageSiren: HABER YOK (", "PageSiren: KEINE NACHRICHT (", "PageSiren: SIN NOTICIAS (") + (long)(yas / 60) + Y(" min)", " dk)", " Min.)", " min)") : "PageSiren: " + (aktifSayi >= 0 ? aktifSayi + Y(" watches, ", " izleme, ", " Beobachtungen, ", " vigilancias, ") : "") + Y("running", "çalışıyor", "läuft", "funcionando");
                simge.Text = m.Length > 63 ? m.Substring(0, 63) : m;
            };
            zaman.Start();
            GC.KeepAlive(zaman);
        }
        catch (Exception ex) { Kaydet("tray icon could not be set up: " + ex.Message); }
    }

    static string Yazi(Dictionary<string, object> d, string k)
    {
        object v;
        return d.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : "";
    }

    static void AlarmGoster(Dictionary<string, object> d)
    {
        List<string> satirlar = new List<string>();
        object v;
        if (d.TryGetValue("satirlar", out v) && v is IEnumerable && !(v is string)) foreach (object x in (IEnumerable)v) satirlar.Add(Convert.ToString(x));
        bool ses = !d.ContainsKey("ses") || !(d["ses"] is bool) || (bool)d["ses"];
        int sesSn = 60;
        if (d.TryGetValue("sesSn", out v) && v != null) int.TryParse(Convert.ToString(v), out sesSn);
        try
        {
            string dilGelen = Yazi(d, "dil");
            if (dilGelen != "") dil = DilSec(dilGelen);
            if (pencere == null || pencere.IsDisposed) pencere = new AlarmPenceresi();
            pencere.Ekle(Yazi(d, "ad"), satirlar, Yazi(d, "url"), ses, sesSn);
            Kaydet("alarm shown: " + Yazi(d, "ad"));
        }
        catch (Exception ex) { Kaydet("alarm could not be shown: " + ex); }
    }
}

class AlarmPenceresi : Form
{
    readonly Label lblBaslik = new Label(), lblAd = new Label(), lblSatirlar = new Label(), lblDiger = new Label();
    readonly Button btnAc = new Button(), btnSes = new Button(), btnKapat = new Button(), btnEkran = new Button();
    readonly System.Windows.Forms.Timer yanip = new System.Windows.Forms.Timer(), sesZamani = new System.Windows.Forms.Timer();
    readonly List<string> adlar = new List<string>();
    SoundPlayer ses;
    string url = "";
    bool koyu = false;

    public AlarmPenceresi()
    {
        Text = "PageSiren - ALARM";
        TopMost = true;
        ShowInTaskbar = true;
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false; MinimizeBox = true;
        ClientSize = new Size(780, 470);
        BackColor = Color.FromArgb(212, 32, 44);
        Font = new Font("Segoe UI", 12f);

        lblBaslik.ForeColor = Color.White; lblBaslik.Font = new Font("Segoe UI", 16f, FontStyle.Bold);
        lblBaslik.SetBounds(24, 16, 560, 34);
        lblAd.ForeColor = Color.White; lblAd.Font = new Font("Segoe UI", 26f, FontStyle.Bold);
        lblAd.SetBounds(24, 54, 730, 100);
        lblSatirlar.ForeColor = Color.White; lblSatirlar.Font = new Font("Segoe UI", 13f);
        lblSatirlar.SetBounds(24, 160, 730, 170);
        lblDiger.ForeColor = Color.FromArgb(255, 225, 225); lblDiger.Font = new Font("Segoe UI", 11f);
        lblDiger.SetBounds(24, 332, 730, 44);

        // Opening the site runs on a separate thread: Process.Start LOCKED the window while waiting for the browser
        // ("not responding" -> Windows closed it). The window never waits.
        Buton(btnAc, 24, delegate {
            string adres = url;
            SesDur();
            ThreadPool.QueueUserWorkItem(delegate { try { if (adres.StartsWith("http")) Process.Start(adres); } catch (Exception ex) { Program.Kaydet("site could not open: " + ex.Message); } });
        });
        Buton(btnSes, 254, delegate { SesDur(); });
        Buton(btnKapat, 484, delegate { Kapat(); });
        Buton(btnEkran, 0, delegate { Program.EkranAc(); });
        btnEkran.SetBounds(600, 14, 156, 36);
        btnEkran.Font = new Font("Segoe UI", 11f, FontStyle.Bold);
        Controls.AddRange(new Control[] { lblBaslik, lblAd, lblSatirlar, lblDiger, btnAc, btnSes, btnKapat, btnEkran });

        yanip.Interval = 600;
        yanip.Tick += delegate { koyu = !koyu; BackColor = koyu ? Color.FromArgb(140, 15, 23) : Color.FromArgb(212, 32, 44); };
        sesZamani.Tick += delegate { SesDur(); };
        FormClosing += delegate (object s, FormClosingEventArgs e) { if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Kapat(); } };
    }

    void Etiketle()
    {
        lblBaslik.Text = Program.Y("PAGESIREN ALARM", "SAYFA ALARMI", "PAGESIREN-ALARM", "ALARMA DE PAGESIREN");
        btnAc.Text = Program.Y("Open site", "Siteyi aç", "Seite öffnen", "Abrir sitio");
        btnSes.Text = Program.Y("Mute", "Sesi kapat", "Stumm", "Silenciar");
        btnKapat.Text = Program.Y("Close", "Kapat", "Schließen", "Cerrar");
        btnEkran.Text = Program.Y("Dashboard", "Takip ekranı", "Dashboard", "Panel");
    }

    void Buton(Button b, int x, EventHandler tik)
    {
        b.SetBounds(x, 392, 210, 56);
        b.BackColor = Color.White; b.ForeColor = Color.FromArgb(150, 10, 20);
        b.Font = new Font("Segoe UI", 14f, FontStyle.Bold); b.FlatStyle = FlatStyle.Flat;
        b.Click += tik;
    }

    public void Ekle(string ad, List<string> satirlar, string adres, bool sesCal, int sesSn)
    {
        Etiketle();
        adlar.Insert(0, ad);
        url = adres;
        lblAd.Text = ad;
        lblSatirlar.Text = string.Join("\n", satirlar.GetRange(0, Math.Min(6, satirlar.Count)).ToArray());
        lblDiger.Text = DateTime.Now.ToString("HH:mm:ss") + (adlar.Count > 1 ? "   ·   " + Program.Y("Other alarms: ", "Diğer alarmlar: ", "Weitere Alarme: ", "Otras alarmas: ") + string.Join(", ", adlar.GetRange(1, Math.Min(4, adlar.Count - 1)).ToArray()) : "")
            + "\n" + Program.Y("Details and the 'Done / False alarm' buttons are on the dashboard (button at top right).", "Ayrıntılar ve 'Tamam / Yanlış alarm' düğmeleri takip ekranında (sağ üstteki düğme).", "Details und die Schaltflächen „Erledigt / Fehlalarm“ sind im Dashboard (Schaltfläche oben rechts).", "Los detalles y los botones «Hecho / Falsa alarma» están en el panel (botón arriba a la derecha).");
        if (sesCal) SesCal(sesSn);
        if (!Visible) Show();
        WindowState = FormWindowState.Normal;
        TopMost = false; TopMost = true; // force to top
        Activate();
        BringToFront();
        yanip.Start();
    }

    void SesHazirla()
    {
        string yol = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "Media\\Alarm01.wav");
        ses = new SoundPlayer(yol);
        try { ses.Load(); } catch (Exception ex) { Program.Kaydet("sound could not load: " + ex.Message); }
    }

    void SesCal(int sn)
    {
        try
        {
            if (ses == null) SesHazirla();
            ses.PlayLooping();
            sesZamani.Stop();
            sesZamani.Interval = Math.Max(5, sn) * 1000;
            sesZamani.Start();
        }
        catch { }
    }

    void SesDur()
    {
        sesZamani.Stop();
        try { if (ses != null) ses.Stop(); } catch { }
    }

    public void Kapat()
    {
        SesDur();
        yanip.Stop();
        adlar.Clear();
        Hide();
    }
}

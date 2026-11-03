// =====================================================================================================
// PageSiren — WINDOWS INSTALLER AND LAUNCHER (one source, built twice by tools/build-windows.js)
// =====================================================================================================
// PageSiren-Setup.exe : carries the program and a Node runtime as a resource named "payload". It installs for this user only, with no
//                       admin rights, into %LOCALAPPDATA%\Programs\PageSiren, adds Start menu and desktop shortcuts and an Apps & Features
//                       entry, and starts the program. Running a newer one over an older one upgrades it; watches live elsewhere and stay.
// PageSiren.exe       : the same code without the resource. It starts the program without a console window (if the program already runs,
//                       the program itself just shows its dashboard). With --uninstall it removes what the installer added.
// Options for tests   : --silent (no windows)  --dir <folder>  --no-integration (no shortcuts, no registry, doesn't stop or start the
//                       real program). Anything else given to PageSiren.exe goes to the program.
// Written for the C# compiler that ships with Windows, which stops at C# 5.
// =====================================================================================================
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

static class PageSirenKurulum
{
    const string AD = "PageSiren";
    const int UI_PORT = 47431;
    const string KALDIR_ANAHTARI = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\PageSiren";
    const string CALISTIR_ANAHTARI = @"Software\Microsoft\Windows\CurrentVersion\Run";
    static readonly bool tr = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "tr";
    static string Y(string en, string trMetin) { return tr ? trMetin : en; }

    [STAThread]
    static int Main(string[] args)
    {
        List<string> a = new List<string>(args);
        bool sessiz = a.Remove("--silent");
        bool entegrasyonsuz = a.Remove("--no-integration");
        bool kaldir = a.Remove("--uninstall");
        string dizin = Deger(a, "--dir");
        try
        {
            if (kaldir) return Kaldir(dizin ?? UygulamaKlasoru(), sessiz, entegrasyonsuz);
            using (Stream paket = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload"))
            {
                if (paket != null)
                {
                    string hedef = dizin ?? VarsayilanKlasor();
                    if (sessiz) Yukle(paket, hedef, entegrasyonsuz, null);
                    else PencereyleKur(paket, hedef, entegrasyonsuz);
                    return 0;
                }
            }
            ProgramiBaslat(UygulamaKlasoru(), a);
            return 0;
        }
        catch (Exception e)
        {
            if (sessiz) Console.Error.WriteLine(e.Message);
            else MessageBox.Show(Y("Something went wrong:\n\n", "Bir sorun çıktı:\n\n") + e.Message, AD, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    static string Deger(List<string> a, string ad)
    {
        int i = a.IndexOf(ad);
        if (i < 0 || i + 1 >= a.Count) return null;
        string v = a[i + 1];
        a.RemoveRange(i, 2);
        return v;
    }
    static string UygulamaKlasoru() { return Path.GetDirectoryName(Application.ExecutablePath); }
    static string YerelKlasor() { return Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData); }
    static string VarsayilanKlasor() { return Path.Combine(YerelKlasor(), "Programs", AD); }
    static string MasaustuKisayolu() { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), AD + ".lnk"); }
    static string MenuKisayolu() { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), AD + ".lnk"); }

    // ------------------------------------------------------------------ starting the program
    static void ProgramiBaslat(string kok, List<string> arglar)
    {
        ProcessStartInfo b = new ProcessStartInfo(Path.Combine(kok, "runtime", "node.exe"));
        string satir = "\"" + Path.Combine(kok, "app", "pagesiren.js") + "\"";
        foreach (string x in arglar) satir += " \"" + x + "\"";
        b.Arguments = satir;
        b.WorkingDirectory = kok;
        b.UseShellExecute = false;
        b.CreateNoWindow = true;
        Process.Start(b);
    }

    static bool Cevapliyor()
    {
        try
        {
            HttpWebRequest q = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + UI_PORT + "/saglik");
            q.Proxy = null;
            q.Timeout = 1000;
            using (WebResponse c = q.GetResponse()) return true;
        }
        catch (Exception) { return false; }
    }

    // A running copy holds node.exe open and must not be overwritten. /dur closes the reader browser and the helper too.
    static void Durdur()
    {
        if (!Cevapliyor()) return;
        try
        {
            HttpWebRequest q = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + UI_PORT + "/dur");
            q.Method = "POST";
            q.Proxy = null;
            q.Timeout = 3000;
            q.ContentLength = 0;
            using (WebResponse c = q.GetResponse()) { }
        }
        catch (Exception) { /* it may close before it answers */ }
        for (int i = 0; i < 60 && Cevapliyor(); i++) Thread.Sleep(250);
        Thread.Sleep(1000);
    }

    // ------------------------------------------------------------------ installing
    static void PencereyleKur(Stream paket, string dizin, bool entegrasyonsuz)
    {
        Application.EnableVisualStyles();
        Form f = new Form();
        f.Text = AD;
        f.FormBorderStyle = FormBorderStyle.FixedDialog;
        f.MaximizeBox = false;
        f.MinimizeBox = false;
        f.StartPosition = FormStartPosition.CenterScreen;
        f.ClientSize = new Size(420, 90);
        try { f.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { /* the default icon will do */ }
        Label yazi = new Label();
        yazi.Text = Y("Installing PageSiren...", "PageSiren kuruluyor...");
        yazi.SetBounds(16, 14, 388, 24);
        ProgressBar cubuk = new ProgressBar();
        cubuk.SetBounds(16, 46, 388, 22);
        cubuk.Maximum = 1000;
        f.Controls.Add(yazi);
        f.Controls.Add(cubuk);

        Exception hata = null;
        bool bitti = false;
        f.FormClosing += delegate(object s, FormClosingEventArgs e) { if (!bitti) e.Cancel = true; };
        f.Shown += delegate
        {
            Thread t = new Thread(delegate()
            {
                try
                {
                    Yukle(paket, dizin, entegrasyonsuz, delegate(double oran) { f.BeginInvoke(new Action(delegate { cubuk.Value = (int)(oran * 1000); })); });
                    if (!entegrasyonsuz)
                    {
                        f.BeginInvoke(new Action(delegate { yazi.Text = Y("Starting PageSiren...", "PageSiren başlatılıyor..."); cubuk.Style = ProgressBarStyle.Marquee; }));
                        ProgramiBaslat(dizin, new List<string>());
                        for (int i = 0; i < 80 && !Cevapliyor(); i++) Thread.Sleep(250); // the first start also builds the alarm helper
                    }
                }
                catch (Exception e) { hata = e; }
                f.BeginInvoke(new Action(delegate { bitti = true; f.Close(); }));
            });
            t.IsBackground = true;
            t.Start();
        };
        Application.Run(f);
        if (hata != null) throw hata;
    }

    static void Yukle(Stream paket, string dizin, bool entegrasyonsuz, Action<double> ilerle)
    {
        if (!entegrasyonsuz) Durdur();
        string kok = Path.GetFullPath(dizin).TrimEnd('\\') + "\\";
        foreach (string eski in new string[] { "app", "extension", "windows-helper" })
        {
            string y = Path.Combine(kok, eski);
            if (Directory.Exists(y)) Directory.Delete(y, true); // files a newer version dropped must not stay behind
        }
        using (ZipArchive zip = new ZipArchive(paket, ZipArchiveMode.Read))
        {
            long toplam = 0;
            long biten = 0;
            foreach (ZipArchiveEntry g in zip.Entries) toplam += g.Length;
            byte[] tampon = new byte[1 << 20];
            foreach (ZipArchiveEntry g in zip.Entries)
            {
                string hedef = Path.GetFullPath(Path.Combine(kok, g.FullName.Replace('/', '\\')));
                if (!hedef.StartsWith(kok, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException(g.FullName);
                if (g.Name.Length == 0) { Directory.CreateDirectory(hedef); continue; }
                Directory.CreateDirectory(Path.GetDirectoryName(hedef));
                using (Stream gelen = g.Open())
                using (FileStream cikan = YazmakIcinAc(hedef))
                {
                    int n;
                    while ((n = gelen.Read(tampon, 0, tampon.Length)) > 0)
                    {
                        cikan.Write(tampon, 0, n);
                        biten += n;
                        if (ilerle != null) ilerle(toplam == 0 ? 1 : (double)biten / toplam);
                    }
                }
            }
        }
        if (!entegrasyonsuz) KisayolVeKayit(kok);
    }

    // node.exe can take a moment to let go after the old copy closes
    static FileStream YazmakIcinAc(string yol)
    {
        for (int i = 0; ; i++)
        {
            try { return new FileStream(yol, FileMode.Create, FileAccess.Write, FileShare.None); }
            catch (IOException) { if (i >= 20) throw; Thread.Sleep(500); }
        }
    }

    static void KisayolVeKayit(string kok)
    {
        string exe = Path.Combine(kok, AD + ".exe");
        Kisayol(MasaustuKisayolu(), exe, kok);
        Kisayol(MenuKisayolu(), exe, kok);
        string surum = Regex.Match(File.ReadAllText(Path.Combine(kok, "package.json")), "\"version\"\\s*:\\s*\"([^\"]+)\"").Groups[1].Value;
        using (RegistryKey k = Registry.CurrentUser.CreateSubKey(KALDIR_ANAHTARI))
        {
            k.SetValue("DisplayName", AD);
            k.SetValue("DisplayVersion", surum);
            k.SetValue("Publisher", "Kerem Alkan");
            k.SetValue("DisplayIcon", exe);
            k.SetValue("InstallLocation", kok);
            k.SetValue("UninstallString", "\"" + exe + "\" --uninstall");
            k.SetValue("QuietUninstallString", "\"" + exe + "\" --uninstall --silent");
            k.SetValue("URLInfoAbout", "https://github.com/kerem-alkan/pagesiren");
            k.SetValue("NoModify", 1, RegistryValueKind.DWord);
            k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        }
    }

    static void Kisayol(string yol, string hedef, string klasor)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(yol));
        Type t = Type.GetTypeFromProgID("WScript.Shell");
        object kabuk = Activator.CreateInstance(t);
        object k = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, kabuk, new object[] { yol });
        Type kt = k.GetType();
        kt.InvokeMember("TargetPath", BindingFlags.SetProperty, null, k, new object[] { hedef });
        kt.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, k, new object[] { klasor });
        kt.InvokeMember("Description", BindingFlags.SetProperty, null, k, new object[] { Y("A siren for web pages", "Web sayfaları için bir siren") });
        kt.InvokeMember("Save", BindingFlags.InvokeMethod, null, k, null);
    }

    // ------------------------------------------------------------------ removing
    static int Kaldir(string dizin, bool sessiz, bool entegrasyonsuz)
    {
        // Deleting a whole folder: only one that really is a PageSiren install
        if (!File.Exists(Path.Combine(dizin, AD + ".exe")) || !File.Exists(Path.Combine(dizin, "app", "pagesiren.js")))
            throw new InvalidOperationException(Y("This folder is not a PageSiren install: ", "Bu klasör bir PageSiren kurulumu değil: ") + dizin);
        if (!sessiz && MessageBox.Show(Y("Remove PageSiren from this computer?", "PageSiren bu bilgisayardan kaldırılsın mı?"), AD, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return 0;
        bool veriyiSil = !sessiz && MessageBox.Show(
            Y("Also delete your watches and saved logins?\n\nChoose No to keep them for a later install.", "İzlemeleriniz ve kayıtlı girişleriniz de silinsin mi?\n\nSonra yeniden kurarsanız kalsın istiyorsanız Hayır'ı seçin."),
            AD, MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes;
        if (!entegrasyonsuz)
        {
            Durdur();
            foreach (string kisayol in new string[] { MasaustuKisayolu(), MenuKisayolu() }) { try { File.Delete(kisayol); } catch (Exception) { /* harmless */ } }
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(CALISTIR_ANAHTARI, true)) { if (k != null) k.DeleteValue(AD, false); }
            Registry.CurrentUser.DeleteSubKeyTree(KALDIR_ANAHTARI, false);
        }
        if (veriyiSil)
        {
            string veri = Path.Combine(YerelKlasor(), AD);
            try { if (Directory.Exists(veri)) Directory.Delete(veri, true); }
            catch (Exception) { MessageBox.Show(Y("Your data could not be deleted completely: ", "Verileriniz tamamen silinemedi: ") + veri, AD); }
        }
        // This exe is inside the folder, so a small command finishes the job after it has closed.
        ProcessStartInfo b = new ProcessStartInfo("cmd.exe", "/c ping -n 4 127.0.0.1 >nul & rmdir /s /q \"" + dizin.TrimEnd('\\') + "\"");
        b.UseShellExecute = false;
        b.CreateNoWindow = true;
        b.WorkingDirectory = Path.GetTempPath();
        Process.Start(b);
        return 0;
    }
}

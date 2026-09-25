// Runs only inside the publisher-signed service. Windows Installer owns replacement
// and rollback. No downloaded script execution, compiler, task registration or AV changes.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace AisDopobrWebService
{
    internal sealed class SignedMsiUpdate : IDisposable
    {
        internal const string PublisherSha256 = "FAB72DC25B08084C8E7D2782D65D3ECF0A1D7ABDEB36A91790641D515DA26EC2";
        internal const string UpgradeCode = "{5191D790-B0F6-4885-9947-E0AD8465E622}";
        internal const string Feed = "https://edu-plus.ru/lms/updates/windows/";
        private readonly string root, shared, current;
        private readonly Action<string, string> log;
        private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 32768 };
        private Timer timer;
        private DateTime nextCheck = DateTime.MinValue;
        private Dictionary<string, object> pending;
        private string token = "";
        private long completedAt;
        private string attemptedHash = "";
        private int busy;
        private volatile bool disposed;

        internal SignedMsiUpdate(string appRoot, Action<string, string> logger)
        {
            root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "AisDopobrWeb");
            AssertProtectedDirectory(root);
            using (SHA256 sha = SHA256.Create())
                shared = Path.Combine(appRoot, ".runtime", "local-updates", Hex(sha.ComputeHash(Encoding.UTF8.GetBytes(Environment.MachineName.ToLowerInvariant()))).Substring(0, 16).ToLowerInvariant());
            current = Assembly.GetExecutingAssembly().GetName().Version.ToString(3);
            log = logger;
            // Do not re-run startup Git/FTP immediately after an MSI restart, or
            // leave an interrupted installation as a permanent maintenance lock.
            string previousPath = Path.Combine(root, "signed-msi-status.json");
            try {
                var previous = File.Exists(previousPath) ? ReadObject(previousPath) : null;
                if (Text(previous, "phase") == "installing" && Text(previous, "targetVersion") == current) completedAt = Now();
                if (Text(previous, "phase") == "installing" && Text(previous, "targetVersion") != current) {
                    nextCheck = DateTime.UtcNow.AddMinutes(30);
                    BlockFailedPackage(Text(previous, "sha256"));
                    Report("error", "Windows Installer восстановил прежнюю службу. Проверьте msi-update.log.", null);
                } else Report("idle", "Служба Windows запущена", null);
            } catch { Report("idle", "Служба Windows запущена", null); }
            timer = new Timer(Tick, null, 20000, 10000);
        }

        internal static void AssertProtectedDirectory(string path)
        {
            for (DirectoryInfo dir = new DirectoryInfo(path); dir != null; dir = dir.Parent)
                if ((dir.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("Protected path is a reparse point.");
            DirectorySecurity acl = Directory.GetAccessControl(path);
            string owner = acl.GetOwner(typeof(SecurityIdentifier)).Value;
            if (owner != "S-1-5-18" && owner != "S-1-5-32-544") throw new IOException("Untrusted protected directory owner.");
            FileSystemRights writes = FileSystemRights.Write | FileSystemRights.Delete | FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership | FileSystemRights.DeleteSubdirectoriesAndFiles;
            foreach (FileSystemAccessRule rule in acl.GetAccessRules(true, true, typeof(SecurityIdentifier)))
                if (rule.AccessControlType == AccessControlType.Allow && (rule.FileSystemRights & writes) != 0
                    && rule.IdentityReference.Value != "S-1-5-18" && rule.IdentityReference.Value != "S-1-5-32-544")
                    throw new IOException("Untrusted write access to protected directory.");
        }

        private void Tick(object unused)
        {
            if (disposed || Interlocked.Exchange(ref busy, 1) != 0) return;
            try
            {
                if (pending != null)
                {
                    Report("ready", "Подписанное обновление службы и трея готово", pending);
                    string requestPath = Path.Combine(shared, "windows-msi-request.json");
                    if (File.Exists(requestPath))
                    {
                        Dictionary<string, object> request = ReadObject(requestPath);
                        if (RequestMatches(request, token, Text(pending, "version"), Now()))
                        {
                            // Verify again immediately before passing the fixed protected path to MSI.
                            string msi = PackagePath(Text(pending, "sha256"));
                            VerifyPackage(msi, pending);
                            if (disposed) return;
                            Report("installing", "Windows Installer обновляет службу и трей", pending);
                            attemptedHash = Text(pending, "sha256");
                            string logFile = Path.Combine(root, "msi-update.log");
                            var start = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "msiexec.exe"),
                                "/i \"" + msi + "\" /qn /norestart /L*v \"" + logFile + "\"") {
                                UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = root,
                                WindowStyle = ProcessWindowStyle.Hidden
                            };
                            // MSI must outlive this service: its standard StopServices/StartServices
                            // actions stop us, replace the signed EXE and start the new version.
                            using (Process process = Process.Start(start))
                            {
                                if (process == null) throw new IOException("Windows Installer did not start.");
                                DateTime deadline = DateTime.UtcNow.AddMinutes(2);
                                while (!disposed && DateTime.UtcNow < deadline) {
                                    if (process.WaitForExit(1000)) throw new IOException("Windows Installer ended before service restart: " + process.ExitCode);
                                    Report("installing", "Windows Installer обновляет службу и трей", pending);
                                }
                                if (!disposed) throw new IOException("Windows Installer did not restart the service within two minutes. Check msi-update.log; no automatic retry was started.");
                            }
                            nextCheck = DateTime.UtcNow.AddMinutes(30);
                            pending = null;
                            return;
                        }
                    }
                }
                if (DateTime.UtcNow < nextCheck) return;
                nextCheck = DateTime.UtcNow.AddMinutes(5);
                var release = json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(Download(Feed + "latest.json", 32768)));
                ValidateDescriptor(release);
                Version candidate = new Version(Text(release, "version"));
                if (candidate <= new Version(current)) { pending = null; Report("idle", "Служба Windows актуальна", null); return; }
                string failedPath = Path.Combine(root, "failed-msi.json");
                if (File.Exists(failedPath) && Text(ReadObject(failedPath), "sha256") == Text(release, "sha256")) {
                    Report("error", "Этот установщик ранее завершился ошибкой. Повтор заблокирован; проверьте журнал или дождитесь исправленного выпуска.", null);
                    nextCheck = DateTime.UtcNow.AddMinutes(30); return;
                }
                string package = PackagePath(Text(release, "sha256"));
                AssertProtectedDirectory(root);
                if (!Directory.Exists(Path.GetDirectoryName(package))) Directory.CreateDirectory(Path.GetDirectoryName(package));
                AssertProtectedDirectory(Path.GetDirectoryName(package));
                Report("downloading", "Загрузка подписанного установщика службы Windows", release);
                if (!File.Exists(package))
                {
                    byte[] bytes = Download(Feed + Text(release, "sha256") + ".msi", Convert.ToInt32(release["size"]));
                    VerifyBytes(bytes, release);
                    using (FileStream stream = new FileStream(package, FileMode.CreateNew, FileAccess.Write, FileShare.None)) stream.Write(bytes, 0, bytes.Length);
                }
                VerifyPackage(package, release);
                pending = release; token = Guid.NewGuid().ToString();
                Report("ready", "Подписанное обновление службы и трея готово", pending);
            }
            catch (Exception ex)
            {
                pending = null;
                nextCheck = DateTime.UtcNow.AddMinutes(30);
                log("UPDATE", ex.Message);
                if (attemptedHash.Length == 64) { try { BlockFailedPackage(attemptedHash); } catch { } }
                try { Report("error", "Обновление компонентов не применено: " + ex.Message, null); } catch { }
            }
            finally { Interlocked.Exchange(ref busy, 0); }
        }

        internal static bool RequestMatches(Dictionary<string, object> request, string token, string version, long now)
        {
            long requested;
            return request != null && token.Length == 36 && Text(request, "token") == token
                && Text(request, "version") == version && Int64.TryParse(Text(request, "requestedAt"), out requested)
                && requested <= now && now - requested < 45000;
        }
        internal static void ValidateDescriptor(Dictionary<string, object> release)
        {
            Version version;
            long size;
            if (release == null || !Version.TryParse(Text(release, "version"), out version) || version.Revision != -1
                || version.Major > 255 || version.Minor > 255 || version.Build < 0 || version.Build > 65535
                || !System.Text.RegularExpressions.Regex.IsMatch(Text(release, "sha256"), "\\A[a-f0-9]{64}\\z")
                || !Int64.TryParse(Text(release, "size"), out size) || size < 1024 || size > 16 * 1024 * 1024)
                throw new IOException("Invalid Windows update descriptor.");
        }
        internal static void VerifyBytes(byte[] bytes, Dictionary<string, object> release)
        {
            using (SHA256 sha = SHA256.Create())
                if (bytes.LongLength != Convert.ToInt64(release["size"]) || Hex(sha.ComputeHash(bytes)).ToLowerInvariant() != Text(release, "sha256"))
                    throw new IOException("Windows installer checksum mismatch.");
        }
        internal static void VerifyPackage(string file, Dictionary<string, object> release)
        {
            ValidateDescriptor(release);
            // Prevent replacement while trust and MSI metadata are inspected.
            using (FileStream locked = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0) throw new IOException("Installer is a reparse point.");
                if (locked.Length != Convert.ToInt64(release["size"])) throw new IOException("Installer size mismatch.");
                byte[] bytes = new byte[locked.Length];
                int offset = 0, read;
                while (offset < bytes.Length && (read = locked.Read(bytes, offset, bytes.Length - offset)) > 0) offset += read;
                VerifyBytes(bytes, release);
                VerifyPublisher(file);
                if (!String.Equals(MsiProperty(file, "UpgradeCode"), UpgradeCode, StringComparison.OrdinalIgnoreCase)
                    || MsiProperty(file, "ProductVersion") != Text(release, "version"))
                    throw new IOException("Installer product or version mismatch.");
            }
        }
        internal static void VerifyPublisher(string file)
        {
            var info = new TrustFile { cbStruct = (uint)Marshal.SizeOf(typeof(TrustFile)), filePath = file };
            IntPtr pointer = Marshal.AllocHGlobal(Marshal.SizeOf(info));
            try
            {
                Marshal.StructureToPtr(info, pointer, false);
                var data = new TrustData { cbStruct = (uint)Marshal.SizeOf(typeof(TrustData)), uiChoice = 2, revocationChecks = 1,
                    unionChoice = 1, fileInfo = pointer, stateAction = 1, provFlags = 0x80 };
                Guid action = new Guid("00AAC56B-CD44-11D0-8CC2-00C04FC295EE");
                try { if (WinVerifyTrust(new IntPtr(-1), ref action, ref data) != 0) throw new IOException("Authenticode signature is not trusted."); }
                finally { data.stateAction = 2; WinVerifyTrust(new IntPtr(-1), ref action, ref data); }
                using (var cert = new X509Certificate2(X509Certificate.CreateFromSignedFile(file)))
                using (SHA256 sha = SHA256.Create())
                    if (Hex(sha.ComputeHash(cert.RawData)) != PublisherSha256) throw new IOException("Unexpected installer publisher.");
            }
            finally { Marshal.DestroyStructure(pointer, typeof(TrustFile)); Marshal.FreeHGlobal(pointer); }
        }
        internal static string MsiProperty(string file, string property)
        {
            uint database, view = 0, record = 0;
            if (MsiOpenDatabase(file, IntPtr.Zero, out database) != 0) throw new IOException("Cannot open MSI database.");
            try
            {
                if (MsiDatabaseOpenView(database, "SELECT `Value` FROM `Property` WHERE `Property`='" + property + "'", out view) != 0
                    || MsiViewExecute(view, 0) != 0 || MsiViewFetch(view, out record) != 0) throw new IOException("Missing MSI property.");
                var value = new StringBuilder(1024); uint size = 1024;
                if (MsiRecordGetString(record, 1, value, ref size) != 0) throw new IOException("Invalid MSI property.");
                return value.ToString();
            }
            finally { if (record != 0) MsiCloseHandle(record); if (view != 0) MsiCloseHandle(view); MsiCloseHandle(database); }
        }
        private string PackagePath(string hash) { return Path.Combine(root, "signed-msi", hash + ".msi"); }
        private void BlockFailedPackage(string hash) {
            if (!System.Text.RegularExpressions.Regex.IsMatch(hash, "\\A[a-f0-9]{64}\\z")) return;
            AssertProtectedDirectory(root);
            File.WriteAllText(Path.Combine(root, "failed-msi.json"), json.Serialize(new Dictionary<string,object>{{"sha256",hash},{"failedAt",Now()}}), new UTF8Encoding(false));
        }
        private static byte[] Download(string url, int limit)
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            var request = (HttpWebRequest)WebRequest.Create(url);
            request.AllowAutoRedirect = false; request.Timeout = 60000; request.ReadWriteTimeout = 60000;
            using (var response = (HttpWebResponse)request.GetResponse())
            {
                if (response.StatusCode != HttpStatusCode.OK || response.ContentLength > limit) throw new IOException("Invalid installer download response.");
                using (var output = new MemoryStream())
                using (Stream input = response.GetResponseStream())
                {
                    byte[] buffer = new byte[65536]; int read;
                    while ((read = input.Read(buffer, 0, buffer.Length)) > 0) {
                        if (output.Length + read > limit) throw new IOException("Installer download too large.");
                        output.Write(buffer, 0, read);
                    }
                    return output.ToArray();
                }
            }
        }
        private Dictionary<string, object> ReadObject(string file)
        {
            using (var input = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read)) {
                if (input.Length > 32768) throw new IOException("Request too large.");
                using (var reader = new StreamReader(input)) return json.Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
            }
        }
        private void Report(string phase, string label, Dictionary<string, object> release)
        {
            if (disposed) return;
            var state = new Dictionary<string, object> { {"protocol", 2}, {"phase", phase}, {"label", label}, {"version", current},
                {"targetVersion", release == null ? "" : Text(release, "version")}, {"sha256", release == null ? "" : Text(release, "sha256")}, {"token", token}, {"updatedAt", Now()}, {"completedAt", completedAt} };
            string destination = Path.Combine(root, "signed-msi-status.json"), temporary = destination + ".new";
            AssertProtectedDirectory(root);
            File.WriteAllText(temporary, json.Serialize(state), new UTF8Encoding(false));
            if (File.Exists(destination)) File.Replace(temporary, destination, null); else File.Move(temporary, destination);
        }
        private static long Now() { return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds; }
        private static string Text(Dictionary<string, object> item, string key) { object value; return item != null && item.TryGetValue(key, out value) ? Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture) : ""; }
        private static string Hex(byte[] bytes) { return BitConverter.ToString(bytes).Replace("-", ""); }
        public void Dispose() { disposed = true; if (timer != null) timer.Dispose(); }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct TrustFile { public uint cbStruct; [MarshalAs(UnmanagedType.LPWStr)] public string filePath; public IntPtr file, knownSubject; }
        [StructLayout(LayoutKind.Sequential)] private struct TrustData { public uint cbStruct; public IntPtr policyData, sipData; public uint uiChoice, revocationChecks, unionChoice; public IntPtr fileInfo; public uint stateAction; public IntPtr stateData, urlReference; public uint provFlags, uiContext; }
        [DllImport("wintrust.dll", ExactSpelling = true)] private static extern int WinVerifyTrust(IntPtr hwnd, ref Guid action, ref TrustData data);
        [DllImport("msi.dll", CharSet = CharSet.Unicode)] private static extern uint MsiOpenDatabase(string path, IntPtr persist, out uint database);
        [DllImport("msi.dll", CharSet = CharSet.Unicode)] private static extern uint MsiDatabaseOpenView(uint database, string query, out uint view);
        [DllImport("msi.dll")] private static extern uint MsiViewExecute(uint view, uint record);
        [DllImport("msi.dll")] private static extern uint MsiViewFetch(uint view, out uint record);
        [DllImport("msi.dll", CharSet = CharSet.Unicode)] private static extern uint MsiRecordGetString(uint record, uint field, StringBuilder value, ref uint size);
        [DllImport("msi.dll")] private static extern uint MsiCloseHandle(uint handle);
    }
}

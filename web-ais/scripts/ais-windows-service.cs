using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.ServiceProcess;
using System.Text;
using System.Threading;

namespace AisDopobrWebService
{
    internal sealed class AisWindowsService : ServiceBase
    {
        internal const string WindowsServiceName = "AisDopobrWeb";
        internal const string DefaultWorkerTaskName = "AisDopobrInteractiveHost";

        private const int WorkerRunIntervalMilliseconds = 25000;
        private const int SchedulerCommandTimeoutMilliseconds = 20000;
        private const int StopScriptTimeoutMilliseconds = 180000;
        private const int ProcessExitGracePeriodMilliseconds = 5000;
        private const int RepeatedFailureLogIntervalMinutes = 10;

        private readonly string appRoot;
        private readonly string stopScript;
        private readonly string logPath;
        private readonly string workerTaskName;
        private readonly string mappedDrive;
        private readonly string mappedTarget;
        private readonly bool consoleMode;
        private readonly object schedulerSync = new object();
        private readonly object logSync = new object();
        private readonly ManualResetEvent consoleExit = new ManualResetEvent(false);

        private Timer workerTimer;
        private volatile bool stopping;
        private int stopStarted;
        private string lastSchedulerFailure;
        private DateTime lastSchedulerFailureLogUtc = DateTime.MinValue;

        internal AisWindowsService(
            string appRoot,
            string stopScriptPath,
            string workerTaskName,
            bool consoleMode,
            string mappedDrive,
            string mappedTarget)
        {
            this.appRoot = appRoot;
            this.workerTaskName = workerTaskName;
            this.consoleMode = consoleMode;
            this.mappedDrive = mappedDrive;
            this.mappedTarget = mappedTarget;
            stopScript = String.IsNullOrWhiteSpace(stopScriptPath)
                ? Path.Combine(appRoot, "scripts", "stop-lan-system.ps1")
                : Path.GetFullPath(stopScriptPath);
            logPath = Path.Combine(appRoot, "tmp", "lan-system", "service-launch.log");

            ServiceName = WindowsServiceName;
            AutoLog = false;
            CanStop = true;
            CanShutdown = true;
            CanPauseAndContinue = false;
        }

        internal void StartForConsole()
        {
            OnStart(new string[0]);
        }

        internal void StopForConsole()
        {
            StopCore("console stop");
        }

        internal void WaitForConsoleExit()
        {
            consoleExit.WaitOne();
        }

        internal void SignalConsoleExit()
        {
            consoleExit.Set();
        }

        protected override void OnStart(string[] args)
        {
            stopping = false;
            Interlocked.Exchange(ref stopStarted, 0);

            ValidateConfiguration();
            OpenLog();
            WriteLog(
                "SERVICE",
                "Starting " + WindowsServiceName + ". Interactive worker task: " + workerTaskName + ".");
            WriteLog("SERVICE", "Physical application root: " + appRoot);
            if (!String.IsNullOrWhiteSpace(mappedDrive))
            {
                WriteLog(
                    "SERVICE",
                    "Interactive worker task owns drive mapping " + mappedDrive + " -> " + mappedTarget + ".");
            }

            // Session 0 must never host Excel COM, WinForms, Explorer, or the web app.
            // The scheduled task is registered for an interactive user and configured
            // with MultipleInstances=IgnoreNew. /Run is therefore both a start request
            // and a cheap singleton health/recovery request after logon or worker failure.
            workerTimer = new Timer(
                WorkerTimerTick,
                null,
                WorkerRunIntervalMilliseconds,
                WorkerRunIntervalMilliseconds);
            ThreadPool.QueueUserWorkItem(delegate { RequestWorkerRun("service start", true); });
        }

        protected override void OnStop()
        {
            StopCore("service stop");
        }

        protected override void OnShutdown()
        {
            StopCore("system shutdown");
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                Timer timer = Interlocked.Exchange(ref workerTimer, null);
                if (timer != null)
                {
                    timer.Dispose();
                }

                CloseLog();
                consoleExit.Close();
            }

            base.Dispose(disposing);
        }

        private void ValidateConfiguration()
        {
            if (!Directory.Exists(appRoot))
            {
                throw new DirectoryNotFoundException("AIS application root does not exist: " + appRoot);
            }

            if (!File.Exists(stopScript))
            {
                throw new FileNotFoundException("AIS stop script was not found.", stopScript);
            }

            if (String.IsNullOrWhiteSpace(workerTaskName))
            {
                throw new ArgumentException("Interactive worker task name is empty.");
            }
        }

        private void WorkerTimerTick(object state)
        {
            RequestWorkerRun("periodic recovery check", false);
        }

        private void RequestWorkerRun(string reason, bool verboseSuccess)
        {
            if (stopping)
            {
                return;
            }

            lock (schedulerSync)
            {
                if (stopping)
                {
                    return;
                }

                try
                {
                    ProcessResult result = RunSchedulerCommand("/Run", false);
                    if (result.Succeeded)
                    {
                        if (lastSchedulerFailure != null)
                        {
                            WriteLog("SERVICE", "Interactive worker task is available again.");
                            lastSchedulerFailure = null;
                            lastSchedulerFailureLogUtc = DateTime.MinValue;
                        }

                        if (verboseSuccess)
                        {
                            WriteLog(
                                "SERVICE",
                                "Requested interactive worker task start (" + reason + ").");
                            WriteCapturedLines("TASK OUT", result.StandardOutput);
                        }

                        return;
                    }

                    LogSchedulerRunFailure(result);
                }
                catch (Exception exception)
                {
                    ProcessResult result = new ProcessResult();
                    result.StartException = exception;
                    LogSchedulerRunFailure(result);
                }
            }
        }

        private void LogSchedulerRunFailure(ProcessResult result)
        {
            string failure = DescribeProcessFailure(result);
            DateTime now = DateTime.UtcNow;
            bool changed = !String.Equals(lastSchedulerFailure, failure, StringComparison.Ordinal);
            bool intervalElapsed = (now - lastSchedulerFailureLogUtc).TotalMinutes
                >= RepeatedFailureLogIntervalMinutes;
            if (changed || intervalElapsed)
            {
                WriteLog(
                    "WARN",
                    "Interactive worker task could not be started. This is expected while no interactive user "
                        + "is signed in; the service will retry automatically. " + failure);
                WriteCapturedLines("TASK OUT", result.StandardOutput);
                WriteCapturedLines("TASK ERR", result.StandardError);
                lastSchedulerFailureLogUtc = now;
            }

            lastSchedulerFailure = failure;
        }

        private void StopCore(string reason)
        {
            if (Interlocked.Exchange(ref stopStarted, 1) != 0)
            {
                return;
            }

            stopping = true;
            WriteLog("SERVICE", "Stopping " + WindowsServiceName + " (" + reason + ").");

            Timer timer = Interlocked.Exchange(ref workerTimer, null);
            if (timer != null)
            {
                timer.Dispose();
            }

            // Wait for a currently executing /Run request. Any queued callbacks see
            // stopping=true and return without starting the interactive task again.
            lock (schedulerSync)
            {
            }

            try
            {
                RunStopScript();
            }
            catch (Exception exception)
            {
                WriteLog("ERROR", "AIS stop script failed: " + exception);
            }

            try
            {
                EndWorkerTask();
            }
            catch (Exception exception)
            {
                WriteLog("WARN", "Could not end the interactive worker task: " + exception);
            }

            WriteLog("SERVICE", WindowsServiceName + " stopped.");
            CloseLog();
        }

        private void RunStopScript()
        {
            if (!File.Exists(stopScript))
            {
                WriteLog("ERROR", "AIS stop script is missing: " + stopScript);
                return;
            }

            WriteLog("SERVICE", "Running the AIS stop script with Docker services preserved.");
            ProcessStartInfo startInfo = CreateHiddenStartInfo(
                FindWindowsPowerShell(),
                new string[]
                {
                    "-NoLogo",
                    "-NoProfile",
                    "-NonInteractive",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    stopScript,
                    "-KeepDocker",
                    "-AppRoot",
                    appRoot
                },
                appRoot,
                new UTF8Encoding(false));
            ProcessResult result = RunProcess(
                startInfo,
                StopScriptTimeoutMilliseconds,
                true,
                "STOP OUT",
                "STOP ERR");

            if (!result.Started)
            {
                WriteLog("ERROR", "AIS stop script did not start. " + DescribeProcessFailure(result));
                return;
            }

            if (result.TimedOut)
            {
                WriteLog("ERROR", "AIS stop script exceeded the three-minute timeout and was terminated.");
                return;
            }

            WriteLog("SERVICE", "AIS stop script exited with code " + result.ExitCode + ".");
            if (result.ExitCode != 0)
            {
                WriteLog("ERROR", "AIS stop script reported a failure.");
            }
        }

        private void EndWorkerTask()
        {
            lock (schedulerSync)
            {
                WriteLog("SERVICE", "Ending interactive worker task " + workerTaskName + ".");
                ProcessResult result = RunSchedulerCommand("/End", true);
                if (!result.Succeeded)
                {
                    WriteLog(
                        "WARN",
                        "Task Scheduler did not confirm that the interactive worker ended. "
                            + DescribeProcessFailure(result));
                }
            }
        }

        private ProcessResult RunSchedulerCommand(string operation, bool logOutput)
        {
            string schtasksPath = FindSystemExecutable("schtasks.exe");
            ProcessStartInfo startInfo = CreateHiddenStartInfo(
                schtasksPath,
                new string[] { operation, "/TN", workerTaskName },
                appRoot,
                GetConsoleOutputEncoding());
            return RunProcess(
                startInfo,
                SchedulerCommandTimeoutMilliseconds,
                false,
                logOutput ? "TASK OUT" : null,
                logOutput ? "TASK ERR" : null);
        }

        private ProcessResult RunProcess(
            ProcessStartInfo startInfo,
            int timeoutMilliseconds,
            bool extendServiceStop,
            string stdoutLogSource,
            string stderrLogSource)
        {
            ProcessResult result = new ProcessResult();
            object captureSync = new object();
            using (Process process = new Process())
            {
                process.StartInfo = startInfo;
                process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs)
                {
                    if (eventArgs.Data == null)
                    {
                        return;
                    }

                    lock (captureSync)
                    {
                        result.StandardOutput.Add(eventArgs.Data);
                    }

                    if (stdoutLogSource != null)
                    {
                        WriteLog(stdoutLogSource, eventArgs.Data);
                    }
                };
                process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs)
                {
                    if (eventArgs.Data == null)
                    {
                        return;
                    }

                    lock (captureSync)
                    {
                        result.StandardError.Add(eventArgs.Data);
                    }

                    if (stderrLogSource != null)
                    {
                        WriteLog(stderrLogSource, eventArgs.Data);
                    }
                };

                try
                {
                    result.Started = process.Start();
                    if (!result.Started)
                    {
                        return result;
                    }

                    process.BeginOutputReadLine();
                    process.BeginErrorReadLine();
                    bool exited = WaitForExit(process, timeoutMilliseconds, extendServiceStop);
                    if (!exited)
                    {
                        result.TimedOut = true;
                        TryKill(process);
                        WaitForExit(process, ProcessExitGracePeriodMilliseconds, false);
                    }

                    if (HasExited(process))
                    {
                        // This parameterless call flushes asynchronous line handlers.
                        process.WaitForExit();
                        result.ExitCode = process.ExitCode;
                    }
                }
                catch (Exception exception)
                {
                    result.StartException = exception;
                    if (result.Started && !HasExited(process))
                    {
                        TryKill(process);
                        WaitForExit(process, ProcessExitGracePeriodMilliseconds, false);
                    }
                }
            }

            return result;
        }

        private bool WaitForExit(Process process, int timeoutMilliseconds, bool extendServiceStop)
        {
            if (extendServiceStop && !consoleMode)
            {
                TryRequestAdditionalStopTime();
            }

            Stopwatch stopwatch = Stopwatch.StartNew();
            while (stopwatch.ElapsedMilliseconds < timeoutMilliseconds)
            {
                int remaining = timeoutMilliseconds - (int)stopwatch.ElapsedMilliseconds;
                int wait = Math.Min(5000, Math.Max(1, remaining));
                try
                {
                    if (process.WaitForExit(wait))
                    {
                        return true;
                    }
                }
                catch (InvalidOperationException)
                {
                    return true;
                }

                if (extendServiceStop && !consoleMode)
                {
                    TryRequestAdditionalStopTime();
                }
            }

            return HasExited(process);
        }

        private void TryRequestAdditionalStopTime()
        {
            try
            {
                RequestAdditionalTime(10000);
            }
            catch (InvalidOperationException)
            {
                // SCM may already be tearing down the service; continue cleanup.
            }
            catch (Win32Exception)
            {
                // A stale SCM status handle must not prevent process cleanup.
            }
        }

        private void OpenLog()
        {
            string directory = Path.GetDirectoryName(logPath);
            Directory.CreateDirectory(directory);
        }

        private void WriteLog(string source, string message)
        {
            string line = "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + "] [" + source + "] " + message;
            lock (logSync)
            {
                for (int attempt = 0; ; attempt++)
                {
                    try
                    {
                        using (FileStream stream = new FileStream(
                            logPath,
                            FileMode.Append,
                            FileAccess.Write,
                            FileShare.Read | FileShare.Delete))
                        using (StreamWriter writer = new StreamWriter(stream, new UTF8Encoding(false)))
                        {
                            writer.WriteLine(line);
                        }
                        break;
                    }
                    catch (IOException)
                    {
                        if (attempt >= 39)
                        {
                            throw;
                        }
                        Thread.Sleep(25);
                    }
                }
            }

            if (consoleMode && Environment.UserInteractive)
            {
                try
                {
                    Console.WriteLine(line);
                }
                catch
                {
                    // The UTF-8 file remains authoritative if a console is detached.
                }
            }
        }

        private void WriteCapturedLines(string source, IList<string> lines)
        {
            for (int index = 0; index < lines.Count; index++)
            {
                WriteLog(source, lines[index]);
            }
        }

        private void CloseLog()
        {
            // Each line is appended under an exclusive writer handle and closed immediately.
        }

        private static ProcessStartInfo CreateHiddenStartInfo(
            string executable,
            IEnumerable<string> arguments,
            string workingDirectory,
            Encoding outputEncoding)
        {
            ProcessStartInfo startInfo = new ProcessStartInfo();
            startInfo.FileName = executable;
            startInfo.Arguments = JoinArguments(arguments);
            startInfo.WorkingDirectory = workingDirectory;
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = true;
            startInfo.WindowStyle = ProcessWindowStyle.Hidden;
            startInfo.RedirectStandardOutput = true;
            startInfo.RedirectStandardError = true;
            startInfo.StandardOutputEncoding = outputEncoding;
            startInfo.StandardErrorEncoding = outputEncoding;
            return startInfo;
        }

        private static string FindWindowsPowerShell()
        {
            return FindSystemExecutable(Path.Combine("WindowsPowerShell", "v1.0", "powershell.exe"));
        }

        private static string FindSystemExecutable(string relativePath)
        {
            string windowsDirectory = Environment.GetEnvironmentVariable("WINDIR");
            if (String.IsNullOrWhiteSpace(windowsDirectory))
            {
                windowsDirectory = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            }

            string[] candidates = new string[]
            {
                Path.Combine(windowsDirectory, "System32", relativePath),
                Path.Combine(windowsDirectory, "Sysnative", relativePath)
            };
            foreach (string candidate in candidates)
            {
                if (File.Exists(candidate))
                {
                    return candidate;
                }
            }

            throw new FileNotFoundException("Required Windows executable was not found: " + relativePath);
        }

        private static Encoding GetConsoleOutputEncoding()
        {
            try
            {
                return Encoding.GetEncoding(CultureInfo.CurrentCulture.TextInfo.OEMCodePage);
            }
            catch
            {
                return Encoding.Default;
            }
        }

        private static string DescribeProcessFailure(ProcessResult result)
        {
            if (result.StartException != null)
            {
                return result.StartException.Message;
            }

            if (!result.Started)
            {
                return "Process was not started.";
            }

            if (result.TimedOut)
            {
                return "Command timed out.";
            }

            string detail = JoinNonEmptyLines(result.StandardError);
            if (String.IsNullOrWhiteSpace(detail))
            {
                detail = JoinNonEmptyLines(result.StandardOutput);
            }

            return "Exit code " + result.ExitCode
                + (String.IsNullOrWhiteSpace(detail) ? "." : ": " + detail);
        }

        private static string JoinNonEmptyLines(IList<string> lines)
        {
            StringBuilder result = new StringBuilder();
            for (int index = 0; index < lines.Count; index++)
            {
                string line = lines[index];
                if (String.IsNullOrWhiteSpace(line))
                {
                    continue;
                }

                if (result.Length > 0)
                {
                    result.Append(" | ");
                }

                result.Append(line.Trim());
            }

            return result.ToString();
        }

        private static bool HasExited(Process process)
        {
            try
            {
                return process.HasExited;
            }
            catch (InvalidOperationException)
            {
                return true;
            }
        }

        private static void TryKill(Process process)
        {
            try
            {
                if (!process.HasExited)
                {
                    process.Kill();
                }
            }
            catch (InvalidOperationException)
            {
            }
            catch (Win32Exception)
            {
            }
        }

        private static string JoinArguments(IEnumerable<string> arguments)
        {
            StringBuilder result = new StringBuilder();
            foreach (string argument in arguments)
            {
                if (result.Length > 0)
                {
                    result.Append(' ');
                }

                result.Append(QuoteWindowsArgument(argument));
            }

            return result.ToString();
        }

        // Implements CommandLineToArgvW quoting, including trailing backslashes.
        private static string QuoteWindowsArgument(string argument)
        {
            if (argument == null)
            {
                argument = String.Empty;
            }

            StringBuilder result = new StringBuilder();
            result.Append('"');
            int backslashes = 0;
            foreach (char character in argument)
            {
                if (character == '\\')
                {
                    backslashes++;
                    continue;
                }

                if (character == '"')
                {
                    result.Append('\\', backslashes * 2 + 1);
                    result.Append('"');
                    backslashes = 0;
                    continue;
                }

                result.Append('\\', backslashes);
                backslashes = 0;
                result.Append(character);
            }

            result.Append('\\', backslashes * 2);
            result.Append('"');
            return result.ToString();
        }

        private sealed class ProcessResult
        {
            internal readonly List<string> StandardOutput = new List<string>();
            internal readonly List<string> StandardError = new List<string>();
            internal bool Started;
            internal bool TimedOut;
            internal int ExitCode;
            internal Exception StartException;

            internal bool Succeeded
            {
                get
                {
                    return Started && !TimedOut && StartException == null && ExitCode == 0;
                }
            }
        }
    }

    internal static class Program
    {
        private const uint AttachParentProcess = 0xFFFFFFFF;

        private sealed class Options
        {
            internal string AppRoot;
            internal string StopScriptPath;
            internal string WorkerTaskName = AisWindowsService.DefaultWorkerTaskName;
            internal string MappedDrive;
            internal string MappedTarget;
            internal bool ConsoleMode;
            internal bool ServiceMode;
            internal bool ShowHelp;
        }

        private static int Main(string[] args)
        {
            Options options;
            try
            {
                options = ParseArguments(args);
            }
            catch (ArgumentException exception)
            {
                EnsureDiagnosticConsole();
                Console.Error.WriteLine(exception.Message);
                PrintUsage();
                return 2;
            }

            if (options.ShowHelp)
            {
                EnsureDiagnosticConsole();
                PrintUsage();
                return 0;
            }

            if (String.IsNullOrWhiteSpace(options.AppRoot))
            {
                EnsureDiagnosticConsole();
                Console.Error.WriteLine("The required --app-root argument is missing.");
                PrintUsage();
                return 2;
            }

            if (options.ConsoleMode && options.ServiceMode)
            {
                EnsureDiagnosticConsole();
                Console.Error.WriteLine("--console and --service cannot be used together.");
                return 2;
            }

            string appRoot;
            string stopScriptPath = null;
            string mappedDrive = null;
            string mappedTarget = null;
            try
            {
                appRoot = Path.GetFullPath(options.AppRoot.Trim());
                if (!String.IsNullOrWhiteSpace(options.StopScriptPath))
                {
                    stopScriptPath = Path.GetFullPath(options.StopScriptPath.Trim());
                }
                NormalizeMapping(options, out mappedDrive, out mappedTarget);
            }
            catch (Exception exception)
            {
                EnsureDiagnosticConsole();
                Console.Error.WriteLine("Invalid service configuration: " + exception.Message);
                return 2;
            }

            if (options.ConsoleMode)
            {
                if (!Environment.UserInteractive)
                {
                    return 2;
                }

                EnsureDiagnosticConsole();
                return RunInConsole(
                    appRoot,
                    stopScriptPath,
                    options.WorkerTaskName,
                    mappedDrive,
                    mappedTarget);
            }

            ServiceBase.Run(new ServiceBase[] {
                new AisWindowsService(
                    appRoot,
                    stopScriptPath,
                    options.WorkerTaskName,
                    false,
                    mappedDrive,
                    mappedTarget)
            });
            return 0;
        }

        private static int RunInConsole(
            string appRoot,
            string stopScriptPath,
            string workerTaskName,
            string mappedDrive,
            string mappedTarget)
        {
            using (AisWindowsService service = new AisWindowsService(
                appRoot,
                stopScriptPath,
                workerTaskName,
                true,
                mappedDrive,
                mappedTarget))
            {
                Console.WriteLine(
                    "Diagnostic console mode. Press Ctrl+C to stop "
                        + AisWindowsService.WindowsServiceName + ".");
                ConsoleCancelEventHandler cancelHandler = delegate(object sender, ConsoleCancelEventArgs eventArgs)
                {
                    eventArgs.Cancel = true;
                    service.SignalConsoleExit();
                };

                Console.CancelKeyPress += cancelHandler;
                bool started = false;
                try
                {
                    service.StartForConsole();
                    started = true;
                    service.WaitForConsoleExit();
                    return 0;
                }
                catch (Exception exception)
                {
                    Console.Error.WriteLine("AIS diagnostic service failed: " + exception);
                    return 1;
                }
                finally
                {
                    if (started)
                    {
                        service.StopForConsole();
                    }

                    Console.CancelKeyPress -= cancelHandler;
                }
            }
        }

        private static Options ParseArguments(string[] args)
        {
            Options options = new Options();
            for (int index = 0; index < args.Length; index++)
            {
                string argument = args[index];
                if (String.Equals(argument, "--console", StringComparison.OrdinalIgnoreCase))
                {
                    options.ConsoleMode = true;
                }
                else if (String.Equals(argument, "--service", StringComparison.OrdinalIgnoreCase))
                {
                    options.ServiceMode = true;
                }
                else if (String.Equals(argument, "--help", StringComparison.OrdinalIgnoreCase)
                    || String.Equals(argument, "-h", StringComparison.OrdinalIgnoreCase)
                    || String.Equals(argument, "/?", StringComparison.OrdinalIgnoreCase))
                {
                    options.ShowHelp = true;
                }
                else if (String.Equals(argument, "--app-root", StringComparison.OrdinalIgnoreCase))
                {
                    options.AppRoot = RequireValue(args, ref index, "--app-root");
                }
                else if (argument.StartsWith("--app-root=", StringComparison.OrdinalIgnoreCase))
                {
                    options.AppRoot = argument.Substring("--app-root=".Length);
                }
                else if (String.Equals(argument, "--worker-task", StringComparison.OrdinalIgnoreCase))
                {
                    options.WorkerTaskName = RequireValue(args, ref index, "--worker-task");
                }
                else if (argument.StartsWith("--worker-task=", StringComparison.OrdinalIgnoreCase))
                {
                    options.WorkerTaskName = argument.Substring("--worker-task=".Length);
                }
                else if (String.Equals(argument, "--stop-script", StringComparison.OrdinalIgnoreCase))
                {
                    options.StopScriptPath = RequireValue(args, ref index, "--stop-script");
                }
                else if (argument.StartsWith("--stop-script=", StringComparison.OrdinalIgnoreCase))
                {
                    options.StopScriptPath = argument.Substring("--stop-script=".Length);
                }
                else if (String.Equals(argument, "--mapped-drive", StringComparison.OrdinalIgnoreCase))
                {
                    options.MappedDrive = RequireValue(args, ref index, "--mapped-drive");
                }
                else if (argument.StartsWith("--mapped-drive=", StringComparison.OrdinalIgnoreCase))
                {
                    options.MappedDrive = argument.Substring("--mapped-drive=".Length);
                }
                else if (String.Equals(argument, "--mapped-target", StringComparison.OrdinalIgnoreCase))
                {
                    options.MappedTarget = RequireValue(args, ref index, "--mapped-target");
                }
                else if (argument.StartsWith("--mapped-target=", StringComparison.OrdinalIgnoreCase))
                {
                    options.MappedTarget = argument.Substring("--mapped-target=".Length);
                }
                else
                {
                    throw new ArgumentException("Unknown argument: " + argument);
                }
            }

            if (String.IsNullOrWhiteSpace(options.WorkerTaskName))
            {
                throw new ArgumentException("--worker-task cannot be empty.");
            }

            return options;
        }

        private static string RequireValue(string[] args, ref int index, string option)
        {
            if (++index >= args.Length)
            {
                throw new ArgumentException(option + " requires a value.");
            }

            return args[index];
        }

        private static void NormalizeMapping(
            Options options,
            out string mappedDrive,
            out string mappedTarget)
        {
            mappedDrive = null;
            mappedTarget = null;
            if (String.IsNullOrWhiteSpace(options.MappedDrive)
                && String.IsNullOrWhiteSpace(options.MappedTarget))
            {
                return;
            }

            if (String.IsNullOrWhiteSpace(options.MappedDrive)
                || String.IsNullOrWhiteSpace(options.MappedTarget))
            {
                throw new ArgumentException("--mapped-drive and --mapped-target must be supplied together.");
            }

            string candidateDrive = options.MappedDrive.Trim();
            if (candidateDrive.Length != 2
                || !Char.IsLetter(candidateDrive[0])
                || candidateDrive[1] != ':')
            {
                throw new ArgumentException("--mapped-drive must have the form Y:.");
            }

            mappedDrive = Char.ToUpperInvariant(candidateDrive[0]) + ":";
            mappedTarget = Path.GetFullPath(options.MappedTarget.Trim());
        }

        private static void EnsureDiagnosticConsole()
        {
            if (!Environment.UserInteractive)
            {
                return;
            }

            AttachConsole(AttachParentProcess);
            if (GetConsoleWindow() == IntPtr.Zero)
            {
                AllocConsole();
            }

            try
            {
                StreamWriter stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
                stdout.AutoFlush = true;
                Console.SetOut(stdout);
                StreamWriter stderr = new StreamWriter(Console.OpenStandardError(), new UTF8Encoding(false));
                stderr.AutoFlush = true;
                Console.SetError(stderr);
                Console.OutputEncoding = new UTF8Encoding(false);
            }
            catch
            {
                // Diagnostics still remain available through service-launch.log.
            }
        }

        private static void PrintUsage()
        {
            Console.WriteLine("Usage:");
            Console.WriteLine(
                "  ais-windows-service.exe --service --app-root <path> [--stop-script <path>] [--worker-task <name>]");
            Console.WriteLine(
                "  ais-windows-service.exe --console --app-root <path> [--stop-script <path>] [--worker-task <name>]");
            Console.WriteLine(
                "  Compatibility options: --mapped-drive Y: --mapped-target <path>");
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool AttachConsole(uint processId);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool AllocConsole();

        [DllImport("kernel32.dll")]
        private static extern IntPtr GetConsoleWindow();
    }
}

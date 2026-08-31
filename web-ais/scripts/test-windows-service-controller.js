"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const paths = {
  host: path.join(__dirname, "ais-service-host.ps1"),
  controller: path.join(__dirname, "control-ais-service.ps1"),
  installer: path.join(__dirname, "setup-ais-windows-service.ps1"),
  tray: path.join(__dirname, "ais-service-tray.ps1"),
  favicon: path.join(appRoot, "favicon.ico"),
  logViewer: path.join(__dirname, "show-ais-service-log.ps1"),
  serviceSource: path.join(__dirname, "ais-windows-service.cs"),
  launcher: path.join(__dirname, "start-lan-system.js"),
  stop: path.join(__dirname, "stop-lan-system.ps1")
};

const read = (filePath) => fs.readFileSync(filePath, "utf8");
for (const [name, filePath] of Object.entries(paths)) {
  assert.ok(fs.existsSync(filePath), `${name} file is missing: ${filePath}`);
}

const hostSource = read(paths.host);
const controllerSource = read(paths.controller);
const installerSource = read(paths.installer);
const traySource = read(paths.tray);
const logViewerSource = read(paths.logViewer);
const serviceSource = read(paths.serviceSource);
const launcherSource = read(paths.launcher);
const stopSource = read(paths.stop);

assert.match(serviceSource, /class AisWindowsService\s*:\s*ServiceBase/u);
assert.match(serviceSource, /WindowsServiceName\s*=\s*"AisDopobrWeb"/u);
assert.match(serviceSource, /DefaultWorkerTaskName\s*=\s*"AisDopobrInteractiveHost"/u);
assert.match(serviceSource, /schtasks\.exe/u);
assert.match(serviceSource, /RunSchedulerCommand\("\/Run"/u);
assert.match(serviceSource, /RunSchedulerCommand\("\/End"/u);
assert.match(serviceSource, /EndWorkerTask\(\)[\s\S]*?RunStopScript\(\)/u);
assert.match(serviceSource, /new Timer\(/u);
assert.match(serviceSource, /stop-lan-system\.ps1[\s\S]*?"-KeepDocker"/u);
assert.match(serviceSource, /--stop-script/u);
assert.match(serviceSource, /--mapped-drive/u);
assert.match(serviceSource, /--service/u);
assert.match(serviceSource, /--worker-task/u);
assert.doesNotMatch(serviceSource, /serviceHostScript/u);
assert.doesNotMatch(serviceSource, /JobObject/u);

assert.match(hostSource, /sync-and-deploy-startup\.ps1/u);
assert.match(hostSource, /Ensure-ServiceDriveMapping/u);
assert.match(hostSource, /subst\.exe/u);
assert.match(hostSource, /--skip-docker/u);
assert.match(hostSource, /Docker Desktop\.exe/u);
assert.match(hostSource, /Wait-DockerEngine/u);
assert.match(hostSource, /codex-runtimes/u);
assert.match(hostSource, /dependencies[\s\S]{0,30}node[\s\S]{0,30}bin/u);
assert.match(hostSource, /Get-Service\s+-Name\s+"AisDopobrWeb"/u);
assert.match(hostSource, /Test-AisServiceRunning/u);
assert.match(hostSource, /IO\.Path\]::Combine\(\$resolvedAppRoot/u);
assert.match(hostSource, /worker-launch\.log/u);
assert.doesNotMatch(hostSource, /service-launch\.log/u);
assert.doesNotMatch(hostSource, /--open-browser/u);
assert.match(hostSource, /function Invoke-HiddenPowerShellScript/u);
assert.match(hostSource, /function Ensure-AisTrayVisible/u);
assert.match(hostSource, /CommonApplicationData[\s\S]*?control-ais-service\.ps1/u);
assert.match(
  hostSource,
  /\$controllerPath\s*=\s*if\s*\(Test-Path[^\r\n]*\$sourceControllerPath[\s\S]*?\$sourceControllerPath[\s\S]*?else[\s\S]*?\$protectedControllerPath/u
);
assert.match(hostSource, /Invoke-HiddenPowerShellScript\s+\$controllerPath\s+"TRAY"[\s\S]*?"-Action",\s*"Tray"/u);
assert.match(hostSource, /"-Action",\s*"Tray",\s*"-SourceAppRoot",\s*\$resolvedAppRoot/u);
assert.match(hostSource, /Проверка значка АИС в системном трее/u);
assert.match(hostSource, /CreateNoWindow\s*=\s*\$true/u);
assert.match(hostSource, /WindowStyle\s*=\s*\[Diagnostics\.ProcessWindowStyle\]::Hidden/u);
assert.doesNotMatch(hostSource, /& powershell\.exe[\s\S]*?\$startupUpdatePath/u);
assert.match(hostSource, /Global\\AisDopobrWeb\.InteractiveHost/u);
assert.doesNotMatch(hostSource, /Local\\AisDopobrWeb\.InteractiveHost/u);
assert.match(hostSource, /Threading\.Mutex/u);
assert.match(hostSource, /WaitOne\(0\)/u);
assert.match(hostSource, /AbandonedMutexException/u);
assert.match(hostSource, /Другой интерактивный рабочий процесс уже выполняет запуск АИС/u);
assert.match(hostSource, /finally[\s\S]*?ReleaseMutex\(\)[\s\S]*?Dispose\(\)/u);
assert.ok(
  hostSource.indexOf("$workerMutex.WaitOne(0)") < hostSource.indexOf("Ensure-ServiceDriveMapping $MappedDrive"),
  "the machine-wide host mutex must be acquired before startup side effects"
);

assert.match(launcherSource, /launcherMutexName\s*=\s*"Global\\\\AisDopobrWeb\.Launcher"/u);
assert.match(launcherSource, /function buildLauncherMutexScript/u);
assert.match(launcherSource, /New-Object Threading\.Mutex/u);
assert.match(launcherSource, /\$mutex\.WaitOne\(0\)/u);
assert.match(launcherSource, /\[Console\]::In\.ReadLine\(\)/u);
assert.doesNotMatch(launcherSource, /\$currentParent|\$parentStartedAt|ReadLineAsync/u);
assert.match(launcherSource, /process\.on\("exit",\s*releaseLauncherGuardOnExit\)/u);
assert.doesNotMatch(launcherSource, /function readLauncherLock|lockAgeMilliseconds|acquireLauncherLock/u);
assert.match(launcherSource, /function inspectNodeProcess/u);
assert.match(launcherSource, /status:\s*"unknown"/u);
assert.match(launcherSource, /function inspectExpectedNodeServiceProcess/u);
assert.match(
  launcherSource,
  /processState\.status\s*===\s*"unknown"[\s\S]{0,180}автоматический перезапуск отменён/u
);
assert.match(launcherSource, /if \(pid === process\.pid\)[\s\S]{0,180}останавливать собственный процесс/u);
assert.match(launcherSource, /function buildExpectedProcessStopScript/u);
assert.match(
  launcherSource,
  /Diagnostics\.Process\]::GetProcessById[\s\S]*?targetStartedAt[\s\S]*?cimStartedAt[\s\S]*?\$target\.Kill\(\)/u
);
assert.doesNotMatch(
  launcherSource,
  /async function stopExpectedNodeService[\s\S]*?(?=\nfunction onlyOfficeContainerSecretMatches)[\s\S]*?taskkill\.exe/u
);
assert.match(launcherSource, /scriptName:\s*"app-server\.js"[\s\S]{0,140}startupTimeoutMilliseconds:\s*180000/u);
assert.match(launcherSource, /scriptName:\s*"local-server\.js"[\s\S]{0,140}startupTimeoutMilliseconds:\s*60000/u);
assert.match(
  launcherSource,
  /managedChildren\.get\(definition\.key\)\s*===\s*child[\s\S]*?managedChildren\.delete\(definition\.key\)/u
);
assert.match(
  launcherSource,
  /waitForOwnedPort\([\s\S]{0,120}definition\.port,[\s\S]{0,80}child,[\s\S]{0,100}definition\.startupTimeoutMilliseconds/u
);
assert.doesNotMatch(launcherSource, /await waitForPort\("127\.0\.0\.1",\s*definition\.port\)/u);
assert.match(launcherSource, /async function inspectListeningPort/u);
assert.match(
  launcherSource,
  /function listeningPid[\s\S]*?catch \(_error\) \{\s*return null;[\s\S]*?return 0;/u
);
assert.match(
  launcherSource,
  /ownerPid\s*===\s*0\s*&&\s*!\(await isPortOpen\(host,\s*port\)\)/u
);
assert.match(launcherSource, /portState\.open\s*&&\s*portState\.pid\s*===\s*0/u);
assert.match(launcherSource, /async function stopManagedChild/u);
assert.match(launcherSource, /function waitForChildExit/u);
assert.match(
  launcherSource,
  /async function stopManagedChild[\s\S]{0,900}child\.kill\("SIGKILL"\)/u
);
assert.doesNotMatch(
  launcherSource,
  /async function stopManagedChild[\s\S]{0,900}(?:isExpectedNodeServiceProcess|taskkill\.exe)/u
);
assert.match(launcherSource, /await stopManagedChild\(child\)/u);
assert.match(launcherSource, /const activeServerOperations\s*=\s*new Set\(\)/u);
assert.match(launcherSource, /async function startServer\(definition, commonEnvironment\)/u);
assert.match(launcherSource, /function startTrackedServer/u);
assert.match(
  launcherSource,
  /typeof shuttingDown\s*!==\s*"undefined"\s*&&\s*shuttingDown[\s\S]{0,300}fs\.openSync\(stdoutPath/u
);
assert.match(launcherSource, /activeServerOperations\.add\(trackedOperation\)/u);
assert.match(launcherSource, /async function waitForActiveServerOperations/u);
assert.match(launcherSource, /async function drainManagedChildren\(\)[\s\S]*?for \(;;\)/u);
assert.match(
  launcherSource,
  /runtimeMatches\s*&&\s*trackedChild\s*&&\s*existingPid\s*===\s*trackedChild\.pid[\s\S]{0,240}return existingPid/u
);
assert.match(
  launcherSource,
  /найден исправный процесс без активного супервизора[\s\S]{0,500}await stopExpectedNodeService\(existingPid, definition\.scriptName\)/u
);
assert.match(
  launcherSource,
  /async function performShutdown[\s\S]*?waitForActiveServerOperations\(\)[\s\S]*?drainManagedChildren\(\)[\s\S]*?releaseLauncherGuard/u
);
assert.match(launcherSource, /let shutdownPromise\s*=\s*null/u);
assert.match(launcherSource, /requestedExitCode\s*=\s*Math\.max\(requestedExitCode,\s*normalizedExitCode\)/u);
assert.match(launcherSource, /if \(shutdownPromise\) return shutdownPromise/u);
assert.match(launcherSource, /process\.exit\(requestedExitCode\)/u);
assert.match(launcherSource, /class ShutdownRequestedError[\s\S]*?AIS_SHUTDOWN_REQUESTED/u);
assert.match(
  launcherSource,
  /main\(\)\.catch\(\(error\)[\s\S]*?AIS_SHUTDOWN_REQUESTED[\s\S]*?&&\s*shuttingDown\) return/u
);

const diagnosticFunctions = launcherSource.match(
  /function inspectNodeProcess\(pid\)[\s\S]*?(?=\nfunction buildLauncherMutexScript\()/u
)?.[0];
assert.ok(diagnosticFunctions, "tri-state process diagnostic functions are missing");
const createDiagnosticHarness = new Function(
  "execFileSync",
  "path",
  "appRoot",
  `${diagnosticFunctions}
return { inspectNodeProcess, inspectExpectedNodeServiceProcess };`
);
const queryFailureHarness = createDiagnosticHarness(
  () => { throw new Error("query timeout"); },
  path,
  appRoot
);
assert.deepEqual(queryFailureHarness.inspectNodeProcess(42), { status: "unknown", pid: 42 });
const commandFailureHarness = createDiagnosticHarness(
  (command) => {
    if (command === "tasklist.exe") return '"node.exe","42","Console","1","1 K"';
    throw new Error("CIM timeout");
  },
  path,
  appRoot
);
assert.deepEqual(
  commandFailureHarness.inspectExpectedNodeServiceProcess(42, "app-server.js"),
  { status: "unknown", pid: 42 }
);

const mutexScriptFunction = launcherSource.match(
  /function buildLauncherMutexScript\(mutexName = launcherMutexName\)[\s\S]*?(?=\nfunction acquireWindowsLauncherMutex\()/u
)?.[0];
assert.ok(mutexScriptFunction, "launcher mutex helper script builder is missing");
if (process.platform === "win32") {
  const mutexProbe = `"use strict";
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
${mutexScriptFunction}
const mutexName = \`Global\\\\AisDopobrWeb.Test.\${process.pid}.\${Date.now()}\`;
function launch() {
  const encoded = Buffer.from(buildLauncherMutexScript(mutexName), "utf16le").toString("base64");
  const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"]
  });
  child.stdout.setEncoding("utf8");
  let output = "";
  const marker = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("mutex marker timeout")), 10000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.includes("ACQUIRED")) { clearTimeout(timer); resolve("ACQUIRED"); }
      if (output.includes("BUSY")) { clearTimeout(timer); resolve("BUSY"); }
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!output.includes("ACQUIRED") && !output.includes("BUSY")) {
        clearTimeout(timer);
        reject(new Error(\`mutex helper exited early: \${code}\`));
      }
    });
  });
  const exited = () => child.exitCode !== null
    ? Promise.resolve(child.exitCode)
    : new Promise((resolve) => child.once("exit", resolve));
  return { child, marker, exited };
}
(async () => {
  const first = launch();
  assert.equal(await first.marker, "ACQUIRED");
  const second = launch();
  assert.equal(await second.marker, "BUSY");
  assert.equal(await second.exited(), 2);
  first.child.stdin.end();
  assert.equal(await first.exited(), 0);
  const third = launch();
  assert.equal(await third.marker, "ACQUIRED");
  third.child.stdin.end();
  assert.equal(await third.exited(), 0);
})().catch((error) => { console.error(error); process.exitCode = 1; });`;
  const mutexProbeResult = spawnSync(process.execPath, ["-e", mutexProbe], {
    cwd: appRoot,
    encoding: "utf8",
    timeout: 30000
  });
  assert.equal(mutexProbeResult.status, 0, `${mutexProbeResult.stdout}\n${mutexProbeResult.stderr}`);
}

const startServerFunction = launcherSource.match(
  /async function startServer\(definition, commonEnvironment\)[\s\S]*?(?=\nfunction startTrackedServer\()/u
)?.[0];
assert.ok(startServerFunction, "startServer function is missing");
const inspectListeningPortFunction = launcherSource.match(
  /async function inspectListeningPort\(host, port, attempts = 3\)[\s\S]*?(?=\nfunction childHasExited\()/u
)?.[0];
assert.ok(inspectListeningPortFunction, "inspectListeningPort function is missing");
const unknownPortOwnerProbe = `"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const managedChildren = new Map();
const logRoot = process.cwd();
class ShutdownRequestedError extends Error {
  constructor(message) { super(message); this.code = "AIS_SHUTDOWN_REQUESTED"; }
}
let shuttingDown = false;
let closePortAndRequestShutdown = false;
let spawnCount = 0;
function listeningPid() { return closePortAndRequestShutdown ? 0 : null; }
async function isPortOpen() {
  if (closePortAndRequestShutdown) shuttingDown = true;
  return false;
}
async function wait() {}
function childHasExited() { return false; }
function spawn() { spawnCount += 1; throw new Error("spawn must not run"); }
${inspectListeningPortFunction}
${startServerFunction}
(async () => {
  await assert.rejects(
    startServer({ key: "probe", name: "Probe", scriptName: "probe.js", port: 49123 }, {}),
    /owner|владелец|определён/u
  );
  closePortAndRequestShutdown = true;
  await assert.rejects(
    startServer({ key: "probe", name: "Probe", scriptName: "probe.js", port: 49123 }, {}),
    /остановки супервизора/u
  );
  assert.equal(spawnCount, 0, "a server was spawned while the listener owner was unknown");
})().catch((error) => { console.error(error); process.exitCode = 1; });`;
const unknownPortOwnerResult = spawnSync(process.execPath, ["-e", unknownPortOwnerProbe], {
  cwd: appRoot,
  encoding: "utf8",
  timeout: 10000
});
assert.equal(
  unknownPortOwnerResult.status,
  0,
  `${unknownPortOwnerResult.stdout}\n${unknownPortOwnerResult.stderr}`
);

const shutdownFunction = launcherSource.match(
  /function shutdown\(exitCode = 0\)[\s\S]*?(?=\nasync function main\()/u
)?.[0];
assert.ok(shutdownFunction, "shutdown function is missing");
const createShutdownHarness = new Function(
  "process",
  "performShutdown",
  `let requestedExitCode = 0;
let shutdownPromise = null;
let shuttingDown = false;
${shutdownFunction}
return { shutdown, state: () => ({ requestedExitCode, shuttingDown }) };`
);
let finishShutdown;
const shutdownGate = new Promise((resolve) => { finishShutdown = resolve; });
const fakeProcess = { exitCode: 0 };
const shutdownHarness = createShutdownHarness(fakeProcess, () => shutdownGate);
const firstShutdown = shutdownHarness.shutdown(0);
const escalatedShutdown = shutdownHarness.shutdown(1);
assert.equal(firstShutdown, escalatedShutdown);
assert.deepEqual(shutdownHarness.state(), { requestedExitCode: 1, shuttingDown: true });
assert.equal(fakeProcess.exitCode, 1);
finishShutdown();

assert.match(controllerSource, /Start-Service\s+-Name\s+\$serviceName/u);
assert.match(controllerSource, /Stop-Service\s+-Name\s+\$serviceName/u);
assert.match(controllerSource, /stop-lan-system\.ps1/u);
assert.match(controllerSource, /-KeepDocker/u);
assert.match(controllerSource, /show-ais-service-log\.ps1/u);
assert.match(controllerSource, /setup-ais-windows-service\.ps1/u);
assert.match(controllerSource, /Test-AisPortListener/u);
assert.match(controllerSource, /8081,\s*19081/u);
assert.match(controllerSource, /Get-AisManagedNodeProcesses/u);
assert.match(controllerSource, /Invoke-AisProtectedCleanup/u);
assert.match(controllerSource, /tray-ready\.json/u);
assert.match(controllerSource, /worker-launch\.log/u);
assert.match(controllerSource, /function Request-AisWorkerStart[\s\S]*?Start-ScheduledTask/u);
assert.match(controllerSource, /\[Ожидание\] Прошло/u);
assert.match(controllerSource, /function Start-AisTrayDirect/u);
assert.match(controllerSource, /Stop-IncompatibleAisTrayProcesses/u);
assert.match(controllerSource, /function Start-AisTrayDirect[\s\S]*?UseShellExecute\s*=\s*\$true/u);
assert.match(controllerSource, /Задача планировщика не подготовила значок/u);
assert.match(controllerSource, /\$runningFromProtectedRoot[\s\S]*?\$protectedTrayPath/u);
assert.match(controllerSource, /function Test-AisTrayReady/u);
assert.match(controllerSource, /function Wait-AisTrayReady/u);
assert.match(controllerSource, /\(-not \$workerTask -or -not \$trayTask\)[\s\S]*?Install-AisService/u);
assert.doesNotMatch(controllerSource, /if\s*\(\$ShowTray\)\s*\{\s*Start-AisTray/u);
assert.match(controllerSource, /"Start"\s*\{[\s\S]*?Start-AisService[\s\S]*?Start-AisTray\s+\$true/u);
assert.match(controllerSource, /"Restart"\s*\{[\s\S]*?Start-AisService[\s\S]*?Start-AisTray\s+\$true/u);
assert.match(
  controllerSource,
  /function Start-AisTray[\s\S]*?Start-ScheduledTask[\s\S]*?Wait-AisTrayReady/u
);
assert.match(controllerSource, /CreateNoWindow\s*=\s*\$true/u);
assert.doesNotMatch(controllerSource, /function Start-AisInteractiveWorker/u);
assert.doesNotMatch(controllerSource, /Join-Path\s+\$PSScriptRoot\s+"install-ais-service\.ps1"/u);
assert.match(installerSource, /start= delayed-auto/u);
assert.match(installerSource, /failure[\s\S]*restart\/5000\/restart\/15000\/restart\/60000/u);
assert.match(installerSource, /New-ScheduledTaskTrigger\s+-AtLogOn/u);
assert.match(installerSource, /AisDopobrInteractiveHost/u);
assert.match(installerSource, /Register-WorkerTask/u);
assert.match(installerSource, /-LogonType\s+Interactive/u);
assert.match(installerSource, /-RunLevel\s+Limited/u);
assert.doesNotMatch(installerSource, /-RunLevel\s+Highest/u);
assert.match(installerSource, /-MultipleInstances\s+IgnoreNew/u);
assert.match(installerSource, /AIS_SERVICE_TEST_MODE/u);
assert.match(installerSource, /serviceStopScriptPath/u);
assert.match(installerSource, /Protect-ProgramDataRoot/u);
assert.match(installerSource, /SetAccessRuleProtection\(\$true,\s*\$false\)/u);
assert.match(installerSource, /FileSystemRights\]::ReadAndExecute/u);
assert.match(installerSource, /Grant-InteractiveAppAccess/u);
assert.match(installerSource, /Grant-InteractiveServiceControl/u);
assert.match(installerSource, /LCRPWPLO/u);
assert.match(installerSource, /--stop-script/u);
assert.match(installerSource, /Quote-WindowsArgument/u);
assert.match(installerSource, /AisDopobrWeb\.install-/u);
assert.match(installerSource, /Directory\]::Move\(\$stagingPath,\s*\$programDataRoot\)/u);
assert.match(installerSource, /serviceControllerPath/u);
assert.match(installerSource, /serviceTrayPath/u);
assert.match(installerSource, /serviceSourceCopyPath/u);
assert.match(installerSource, /Compile-ServiceHost[\s\S]*?\$serviceSourceCopyPath/u);
assert.match(installerSource, /CommonApplicationData/u);

assert.match(traySource, /System\.Windows\.Forms/u);
assert.match(traySource, /NotifyIcon/u);
assert.match(traySource, /Mutex/u);
assert.match(traySource, /Открыть АИС/u);
assert.match(traySource, /Запустить/u);
assert.match(traySource, /Остановить/u);
assert.match(traySource, /Перезапустить/u);
assert.match(traySource, /Окно терминала запуска/u);
assert.match(traySource, /Открыть папку журналов/u);
assert.match(traySource, /127\.0\.0\.1:8081/u);
assert.match(traySource, /notifyIcon\.add_MouseDoubleClick/u);
assert.match(traySource, /MouseButtons\]::Left[\s\S]{0,100}Open-Ais/u);
assert.doesNotMatch(traySource, /notifyIcon\.add_DoubleClick/u);
assert.doesNotMatch(traySource, /InstallIfMissing/u);
assert.match(traySource, /\$script:exitItem\s*=\s*New-Object Windows\.Forms\.ToolStripMenuItem "Выход"/u);
assert.match(traySource, /\$script:exitItem\.Enabled\s*=\s*\$false/u);
assert.match(
  traySource,
  /\$script:exitItem\.Enabled\s*=\s*\$Installed\s+-and\s+\$ServiceStatus\s+-eq\s+"Stopped"/u
);
assert.match(
  traySource,
  /function Invoke-ControlAction[\s\S]*?\$script:exitItem\.Enabled\s*=\s*\$false[\s\S]*?Start-DetachedPowerShell/u
);
assert.match(traySource, /contextMenu\.add_Opening\(\{ Update-TrayState \}\)/u);
assert.match(traySource, /tray-ready\.json/u);
assert.match(traySource, /function Write-TrayReadyMarker/u);
assert.match(traySource, /function Remove-TrayReadyMarker/u);
assert.match(
  traySource,
  /Set-TrayVisual[\s\S]*?Write-TrayReadyMarker\s+\$State\s+\$ServiceStatus/u
);
assert.match(
  traySource,
  /function Stop-TrayResources[\s\S]*?Remove-TrayReadyMarker/u
);
assert.match(
  traySource,
  /exitItem\.add_Click\(\{[\s\S]*?Get-Service\s+-Name\s+\$serviceName[\s\S]*?Status\s+-ne\s+"Stopped"[\s\S]*?return[\s\S]*?ExitThread\(\)/u
);
assert.match(traySource, /\$faviconPath\s*=\s*Join-Path\s+\$resolvedAppRoot\s+"favicon\.ico"/u);
assert.match(traySource, /function New-FaviconStateIcon/u);
assert.match(traySource, /Drawing\.Image\]::FromFile\(\$Path\)/u);
assert.match(traySource, /\.GetHicon\(\)/u);
assert.match(traySource, /running\s*=\s*New-AisStateIcon\s+\$false/u);
for (const stateName of ["pending", "stopped", "missing"]) {
  assert.match(traySource, new RegExp(`${stateName}\\s*=\\s*New-AisStateIcon\\s+\\$true`, "u"));
}
const faviconBytes = fs.readFileSync(paths.favicon);
assert.deepEqual([...faviconBytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
assert.equal(faviconBytes.readUInt32BE(16), 76);
assert.equal(faviconBytes.readUInt32BE(20), 76);
assert.match(logViewerSource, /Get-Content[\s\S]*-Tail\s+200[\s\S]*-Wait/u);
assert.match(logViewerSource, /service-launch\.log/u);
assert.match(logViewerSource, /worker-launch\.log/u);
assert.match(stopSource, /taskkill\.exe[\s\S]*?\/PID[\s\S]*?\/T[\s\S]*?\/F/u);
assert.match(stopSource, /Stop-PreviewCleanupWorker/u);
assert.match(stopSource, /Stop-AllManagedNodeProcesses/u);
assert.match(stopSource, /\.cleanup-worker\.lock/u);

if (process.platform === "win32") {
  for (const filePath of [paths.host, paths.controller, paths.installer, paths.tray, paths.logViewer]) {
    const bytes = fs.readFileSync(filePath);
    assert.deepEqual(
      [...bytes.subarray(0, 3)],
      [0xef, 0xbb, 0xbf],
      `${path.basename(filePath)} must have an UTF-8 BOM for Windows PowerShell 5.1`
    );
  }

  const parseProbe = `$failed = $false
foreach ($path in @(${[paths.host, paths.controller, paths.installer, paths.tray, paths.logViewer]
    .map((value) => `'${value.replace(/'/gu, "''")}'`)
    .join(",")})) {
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors) | Out-Null
  if ($errors.Count -gt 0) {
    $errors | ForEach-Object { [Console]::Error.WriteLine("$($path): $($_.Message)") }
    $failed = $true
  }
}
if ($failed) { exit 1 }`;
  const parseResult = spawnSync("powershell.exe", [
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand",
    Buffer.from(parseProbe, "utf16le").toString("base64")
  ], { cwd: appRoot, encoding: "utf8", timeout: 30000 });
  assert.equal(parseResult.status, 0, `${parseResult.stdout}\n${parseResult.stderr}`);

  const hiddenPowerShellProbe = `$source = Get-Content -LiteralPath '${paths.host.replace(/'/gu, "''")}' -Raw -Encoding UTF8
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
foreach ($name in @("Quote-ProcessArgument", "Invoke-HiddenPowerShellScript")) {
  $functionAst = $ast.Find({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
  }, $true)
  if (-not $functionAst) { throw "Missing function: $name" }
  Invoke-Expression $functionAst.Extent.Text
}
$powerShellPath = Join-Path ([Environment]::SystemDirectory) "WindowsPowerShell\\v1.0\\powershell.exe"
$resolvedAppRoot = '${appRoot.replace(/'/gu, "''")}'
$utf8 = New-Object Text.UTF8Encoding($false)
$script:captured = New-Object Collections.Generic.List[string]
function Write-ServiceOutput([string]$Source, $Value) {
  if (-not [string]::IsNullOrWhiteSpace([string]$Value)) { $script:captured.Add("$Source|$Value") }
}
$exitCode = Invoke-HiddenPowerShellScript '${paths.controller.replace(/'/gu, "''")}' "TEST"
if ($exitCode -ne 0 -or -not ($script:captured -match "Служба:")) {
  throw "Hidden PowerShell output was not captured. Exit=$exitCode"
}`;
  const hiddenPowerShellResult = spawnSync("powershell.exe", [
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand",
    Buffer.from(hiddenPowerShellProbe, "utf16le").toString("base64")
  ], { cwd: appRoot, encoding: "utf8", timeout: 30000 });
  assert.equal(
    hiddenPowerShellResult.status,
    0,
    `${hiddenPowerShellResult.stdout}\n${hiddenPowerShellResult.stderr}`
  );

  const validationResult = spawnSync("powershell.exe", [
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", paths.installer,
    "-Action", "Validate", "-AppRoot", appRoot, "-AsJson"
  ], {
    cwd: appRoot,
    env: { ...process.env, AIS_SERVICE_TEST_MODE: "1" },
    encoding: "utf8",
    timeout: 30000
  });
  assert.equal(validationResult.status, 0, `${validationResult.stdout}\n${validationResult.stderr}`);
  const validation = JSON.parse(validationResult.stdout.trim());
  assert.equal(validation.serviceName, "AisDopobrWeb");
  assert.equal(validation.workerTaskName, "AisDopobrInteractiveHost");
  assert.ok(validation.interactiveUser);
  assert.equal(path.resolve(validation.sourceAppRoot), appRoot);
  assert.ok(fs.existsSync(validation.serviceAppRoot), validation.serviceAppRoot);
  if (path.parse(appRoot).root.toUpperCase() === "Y:\\") {
    assert.equal(validation.mappedDrive, "Y:");
    assert.equal(path.parse(validation.serviceAppRoot).root.toUpperCase(), "O:\\");
    assert.equal(path.parse(validation.mappedTarget).root.toUpperCase(), "O:\\");
  }

  const statusResult = spawnSync("powershell.exe", [
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", paths.controller,
    "-Action", "Status", "-AsJson"
  ], { cwd: appRoot, encoding: "utf8", timeout: 30000 });
  assert.equal(statusResult.status, 0, `${statusResult.stdout}\n${statusResult.stderr}`);
  const status = JSON.parse(statusResult.stdout.trim());
  assert.equal(status.serviceName, "AisDopobrWeb");
  assert.equal(status.localUrl, "http://127.0.0.1:8081/");

  const windowsDirectory = process.env.WINDIR || "C:\\Windows";
  const compiler = path.join(windowsDirectory, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  assert.ok(fs.existsSync(compiler), `C# compiler is missing: ${compiler}`);
  const compileRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ais-service-compile-"));
  const executable = path.join(compileRoot, "AisDopobrService.exe");
  try {
    const compileResult = spawnSync(compiler, [
      "/nologo", "/warnaserror+", "/target:exe", "/platform:anycpu",
      "/reference:System.dll", "/reference:System.Core.dll", "/reference:System.ServiceProcess.dll",
      `/out:${executable}`, paths.serviceSource
    ], { cwd: appRoot, encoding: "utf8", timeout: 30000 });
    assert.equal(compileResult.status, 0, `${compileResult.stdout}\n${compileResult.stderr}`);
    const helpResult = spawnSync(executable, ["--help"], { encoding: "utf8", timeout: 10000 });
    assert.equal(helpResult.status, 0, `${helpResult.stdout}\n${helpResult.stderr}`);
    assert.match(helpResult.stdout, /--service/u);
    assert.match(helpResult.stdout, /--mapped-drive/u);
  } finally {
    fs.rmSync(compileRoot, { recursive: true, force: true });
  }
}

console.log("windows service controller tests: OK");

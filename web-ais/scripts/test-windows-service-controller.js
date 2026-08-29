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
assert.match(hostSource, /Get-Service\s+-Name\s+"AisDopobrWeb"/u);
assert.match(hostSource, /Test-AisServiceRunning/u);
assert.match(hostSource, /IO\.Path\]::Combine\(\$resolvedAppRoot/u);
assert.doesNotMatch(hostSource, /--open-browser/u);

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
assert.match(traySource, /\$script:exitItem\s*=\s*New-Object Windows\.Forms\.ToolStripMenuItem "Выход из трея"/u);
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

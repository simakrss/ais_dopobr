"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(appRoot, "..");
const paths = {
  hiddenProcess: path.join(__dirname, "ais-hidden-process.vbs"),
  controller: path.join(__dirname, "control-ais-service.ps1"),
  installer: path.join(__dirname, "setup-ais-windows-service.ps1"),
  tray: path.join(__dirname, "ais-service-tray.ps1"),
  remoteServices: path.join(__dirname, "start-remote-services.ps1"),
  remoteCommand: path.join(__dirname, "start-remote-services.cmd"),
  launcher: path.join(__dirname, "start-lan-system.js"),
  rootStart: path.join(repositoryRoot, "ЗАПУСТИТЬ АИС.bat"),
  rootStop: path.join(repositoryRoot, "ОСТАНОВИТЬ АИС.cmd"),
  appStart: path.join(appRoot, "ЗАПУСТИТЬ АИС В ЛОКАЛЬНОЙ СЕТИ.cmd"),
  appStop: path.join(appRoot, "ОСТАНОВИТЬ АИС.cmd")
};

const read = (filePath) => fs.readFileSync(filePath, "utf8");
for (const [name, filePath] of Object.entries(paths)) {
  assert.ok(fs.existsSync(filePath), `${name} file is missing: ${filePath}`);
}

const hiddenProcessSource = read(paths.hiddenProcess);
const controllerSource = read(paths.controller);
const installerSource = read(paths.installer);
const traySource = read(paths.tray);
const remoteServicesSource = read(paths.remoteServices);
const remoteCommandSource = read(paths.remoteCommand);
const launcherSource = read(paths.launcher);
const userLauncherSources = [
  ["root start", read(paths.rootStart)],
  ["root stop", read(paths.rootStop)],
  ["app start", read(paths.appStart)],
  ["app stop", read(paths.appStop)]
];

assert.match(hiddenProcessSource, /CreateObject\("WScript\.Shell"\)/u);
assert.match(hiddenProcessSource, /shell\.Run\(commandLine, 0, True\)/u);
assert.match(hiddenProcessSource, /Function QuoteWindowsArgument/u);
assert.match(hiddenProcessSource, /--notify-errors/u);
assert.match(hiddenProcessSource, /hidden-process\.log/u);
assert.match(hiddenProcessSource, /ExpandEnvironmentStrings\("%TEMP%"\)[\s\S]*?working directory was not found/u);
assert.match(hiddenProcessSource, /Working directory could not be activated/u);
assert.ok(
  hiddenProcessSource.indexOf("If Not fileSystem.FolderExists(workingDirectory)") <
    hiddenProcessSource.indexOf("EnsureFolder logDirectory"),
  "the hidden host must validate its working directory before creating log folders"
);

for (const [name, source] of userLauncherSources) {
  assert.match(source, /AIS_LAUNCHER_VALIDATE_ONLY/u, name);
  assert.match(
    source,
    /start "" \/b "%SystemRoot%\\System32\\wscript\.exe" \/\/NoLogo/u,
    `${name} must hand control to the GUI WScript host`
  );
  assert.match(source, /ais-hidden-process\.vbs/u, name);
  assert.match(source, /--notify-errors/u, name);
  assert.doesNotMatch(source, /\bpause\b/iu, `${name} must never hold a command window`);
  const validationLabel = source.indexOf(":validate");
  assert.ok(validationLabel > 0, `${name} validation-only branch is missing`);
  assert.doesNotMatch(
    source.slice(0, validationLabel),
    /^\s*powershell\.exe\b/imu,
    `${name} must not synchronously execute PowerShell during normal startup`
  );
}

assert.match(remoteCommandSource, /start "" \/b "%SystemRoot%\\System32\\wscript\.exe"/u);
assert.match(remoteCommandSource, /ais-hidden-process\.vbs/u);
assert.doesNotMatch(remoteCommandSource, /\bpause\b/iu);

assert.match(
  controllerSource,
  /function Start-AisTrayDirect[\s\S]*?FileName\s*=\s*\$wscriptPath/u
);
assert.doesNotMatch(
  controllerSource,
  /function Start-AisTrayDirect[\s\S]*?FileName\s*=\s*\$powerShellPath/u
);
assert.match(
  controllerSource,
  /function Test-AisScheduledTaskUsesHiddenHost[\s\S]*?taskActions\.Count -ne 1[\s\S]*?protectedHiddenProcessPath[\s\S]*?catch[\s\S]*?return \$false/u
);
assert.match(
  controllerSource,
  /function Start-AisTray[\s\S]*?Test-AisScheduledTaskUsesHiddenHost \$task[\s\S]*?\$task\s*=\s*\$null/u
);
assert.match(
  controllerSource,
  /if \(-not \(Test-AisScheduledTaskUsesHiddenHost \$workerTask\)\)[\s\S]*?устаревший запуск с командным окном/u
);
assert.match(
  controllerSource,
  /-not \$workerTaskCompatible[\s\S]*?-not \$trayTaskCompatible[\s\S]*?Install-AisService/u
);
assert.match(
  controllerSource,
  /function Invoke-ElevatedControl[\s\S]*?Resolve-ElevationSafePath \$hiddenProcessPath[\s\S]*?Start-Process -FilePath \$wscriptPath/u
);
for (const functionName of ["Install-AisService", "Uninstall-AisService"]) {
  assert.match(
    controllerSource,
    new RegExp(
      `function ${functionName}[\\s\\S]*?Resolve-ElevationSafePath \\$hiddenProcessPath[\\s\\S]*?\\$elevationHiddenProcessPath, \\$elevationAppRoot[\\s\\S]*?Start-Process -FilePath \\$wscriptPath[\\s\\S]*?-Verb RunAs`,
      "u"
    ),
    `${functionName} must elevate through an elevation-safe GUI WScript host`
  );
}
assert.match(controllerSource, /launcher-error\.log/u);

assert.match(installerSource, /function Write-InstallerFailureLog[\s\S]*?installer-error\.log/u);
assert.match(
  installerSource,
  /function Invoke-SelfElevated[\s\S]*?ais-hidden-process\.vbs[\s\S]*?Start-Process -FilePath \$wscriptPath[\s\S]*?-Verb RunAs/u
);
assert.match(
  installerSource,
  /ais-hidden-process\.vbs[\s\S]*?Destination\s*=\s*\$serviceHiddenProcessPath/u
);
assert.equal(
  (installerSource.match(/New-ScheduledTaskAction\s+-Execute\s+\$wscriptPath/gu) || []).length,
  2,
  "worker and tray scheduled tasks must both use the GUI WScript host"
);
assert.match(
  installerSource,
  /Register-TrayTask[\s\S]*?"\/\/B"[\s\S]*?\$serviceHiddenProcessPath[\s\S]*?"-WindowStyle", "Hidden"/u
);
assert.match(
  installerSource,
  /Register-WorkerTask[\s\S]*?"\/\/B"[\s\S]*?\$serviceHiddenProcessPath[\s\S]*?"-WindowStyle", "Hidden"/u
);

assert.match(traySource, /function Start-HiddenPowerShell/u);
assert.match(traySource, /FileName\s*=\s*\$wscriptPath/u);
assert.match(
  traySource,
  /function Start-DetachedPowerShell[\s\S]*?if \(\$Hidden\)[\s\S]*?Start-HiddenPowerShell/u
);
assert.match(
  remoteServicesSource,
  /if \(-not \$Supervisor\)[\s\S]*?FileName\s*=\s*\$wscriptPath/u
);
assert.match(remoteServicesSource, /hiddenProcessPath[\s\S]*?ais-hidden-process\.vbs/u);
assert.match(
  launcherSource,
  /startRemoteServicesSupervisor[\s\S]*?"-NonInteractive"[\s\S]*?"-WindowStyle"[\s\S]*?"Hidden"/u
);

if (process.platform === "win32") {
  const powerShellFiles = [
    paths.controller,
    paths.installer,
    paths.tray,
    paths.remoteServices
  ];
  const parseProbe = `$failed = $false
foreach ($path in @(${powerShellFiles
    .map((value) => `'${value.replace(/'/gu, "''")}'`)
    .join(",")})) {
  $tokens = $null
  $errors = $null
  [Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors) | Out-Null
  if ($errors.Count -gt 0) {
    $errors | ForEach-Object { [Console]::Error.WriteLine("$($path): $($_.Message)") }
    $failed = $true
  }
}
if ($failed) { exit 1 }`;
  const parseResult = spawnSync("powershell.exe", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
    Buffer.from(parseProbe, "utf16le").toString("base64")
  ], {
    cwd: appRoot,
    encoding: "utf8",
    timeout: 30000,
    windowsHide: true
  });
  assert.equal(parseResult.status, 0, `${parseResult.stdout}\n${parseResult.stderr}`);

  const hiddenHostRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ais-hidden-host-"));
  const hiddenHostWorkingDirectory = path.join(hiddenHostRoot, "working directory");
  fs.mkdirSync(hiddenHostWorkingDirectory);
  try {
    const windowsPowerShellPath = path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe"
    );
    const hiddenHostResult = spawnSync("cscript.exe", [
      "//B", "//NoLogo", paths.hiddenProcess,
      hiddenHostWorkingDirectory,
      windowsPowerShellPath,
      "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "exit 7"
    ], {
      cwd: appRoot,
      encoding: "utf8",
      timeout: 30000,
      windowsHide: true
    });
    assert.equal(
      hiddenHostResult.status,
      7,
      `hidden host did not return the child exit code: ${hiddenHostResult.stdout}\n${hiddenHostResult.stderr}`
    );
    const hiddenHostLog = fs.readFileSync(
      path.join(hiddenHostWorkingDirectory, "tmp", "lan-system", "hidden-process.log"),
      "utf16le"
    );
    assert.match(hiddenHostLog, /finished: exit=7/u);

    const missingWorkingDirectory = path.join(hiddenHostRoot, "must-not-be-created");
    const missingDirectoryResult = spawnSync("cscript.exe", [
      "//B", "//NoLogo", paths.hiddenProcess,
      missingWorkingDirectory,
      windowsPowerShellPath
    ], {
      cwd: appRoot,
      env: { ...process.env, TEMP: hiddenHostRoot, TMP: hiddenHostRoot },
      encoding: "utf8",
      timeout: 30000,
      windowsHide: true
    });
    assert.equal(missingDirectoryResult.status, 3);
    assert.equal(fs.existsSync(missingWorkingDirectory), false);
    const fallbackLog = fs.readFileSync(
      path.join(hiddenHostRoot, "AisDopobrWeb", "hidden-process.log"),
      "utf16le"
    );
    assert.match(fallbackLog, /working directory was not found/u);
  } finally {
    fs.rmSync(hiddenHostRoot, { recursive: true, force: true });
  }
}

console.log("hidden Windows launch tests: OK");

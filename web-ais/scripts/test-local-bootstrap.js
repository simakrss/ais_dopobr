"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(appRoot, "..");
const bootstrapPath = path.join(__dirname, "bootstrap-local-system.ps1");
const startupUpdatePath = path.join(__dirname, "sync-and-deploy-startup.ps1");
const deployPath = path.join(__dirname, "deploy-lms.ps1");
const rootLauncherPath = path.join(repositoryRoot, "ЗАПУСТИТЬ АИС.bat");
const localLauncherPath = path.join(appRoot, "ЗАПУСТИТЬ АИС В ЛОКАЛЬНОЙ СЕТИ.cmd");
const rootStopPath = path.join(repositoryRoot, "ОСТАНОВИТЬ АИС.cmd");
const localStopPath = path.join(appRoot, "ОСТАНОВИТЬ АИС.cmd");

const read = (filePath) => fs.readFileSync(filePath, "utf8");
const bootstrapSource = read(bootstrapPath);
const startupUpdateSource = read(startupUpdatePath);
const deploySource = read(deployPath);
const rootLauncherSource = read(rootLauncherPath);
const localLauncherSource = read(localLauncherPath);
const rootStopSource = read(rootStopPath);
const localStopSource = read(localStopPath);
const startSource = read(path.join(__dirname, "start-lan-system.js"));
const stopSource = read(path.join(__dirname, "stop-lan-system.ps1"));
const localServerSource = read(path.join(appRoot, "local-server.js"));
const appServerSource = read(path.join(appRoot, "app-server.js"));
const remoteServicesSource = read(path.join(__dirname, "start-remote-services.ps1"));
const onlyOfficeComposeSource = read(path.join(appRoot, "docker-compose.onlyoffice.yml"));

assert.match(bootstrapSource, /https:\/\/nodejs\.org\/dist\/index\.json/u);
assert.match(bootstrapSource, /SHASUMS256/u);
assert.match(bootstrapSource, /Get-FileHash[\s\S]*SHA256/u);
assert.match(bootstrapSource, /desktop\.docker\.com\/win\/main/u);
assert.match(bootstrapSource, /Get-AuthenticodeSignature/u);
assert.match(bootstrapSource, /--user[\s\S]*--accept-license[\s\S]*--backend=wsl-2/u);
assert.match(bootstrapSource, /Start-DockerEngine/u);
assert.match(bootstrapSource, /AIS_BOOTSTRAP_SKIP_INSTALL/u);
assert.match(bootstrapSource, /AIS_BOOTSTRAP_SKIP_DOCKER/u);
assert.match(bootstrapSource, /sync-and-deploy-startup\.ps1/u);
assert.match(bootstrapSource, /stop-lan-system\.ps1[\s\S]*?-KeepDocker/u);
assert.match(startupUpdateSource, /fetch", "--prune", "origin"/u);
assert.match(startupUpdateSource, /merge", "--ff-only"/u);
assert.match(startupUpdateSource, /stash", "push"/u);
assert.match(startupUpdateSource, /deploy-lms\.ps1[\s\S]*?-All/u);
assert.match(startupUpdateSource, /Автоматическая отправка в GitHub отключена/u);
assert.match(startupUpdateSource, /\$previousErrorActionPreference = \$ErrorActionPreference/u);
assert.match(startupUpdateSource, /\$_ -is \[Management\.Automation\.ErrorRecord\]/u);
assert.match(startupUpdateSource, /ErrorText = \$errorText/u);
assert.match(deploySource, /System\.Link\.TargetParsingPath/u);
assert.match(deploySource, /privateTemplatePaths/u);
assert.match(deploySource, /Invoke-FtpTransferWithRetry/u);
assert.match(deploySource, /"--variable", "%AIS_FTP_CREDENTIAL"/u);
assert.match(deploySource, /"--expand-user", "\{\{AIS_FTP_CREDENTIAL\}\}"/u);
assert.match(deploySource, /EnvironmentVariables\["AIS_FTP_CREDENTIAL"\] = \$credentialText/u);
assert.doesNotMatch(deploySource, /RedirectStandardInput = \$true/u);
assert.doesNotMatch(deploySource, /WriteAllText\(\$credentialPath/u);
assert.match(deploySource, /--speed-time", "30"/u);
assert.match(deploySource, /Get-FtpFileSize/u);
assert.match(deploySource, /FTP size verification failed/u);
assert.match(deploySource, /ensuredFtpDirectories/u);
assert.match(deploySource, /Rename-FtpFileIfExists/u);
assert.match(deploySource, /Remove-FtpFileIfExists \$remotePath[\s\S]*?Rename-FtpFile \$previousPath \$fileName/u);
const generatedSafePaths = deploySource.match(/\$generatedSafePaths = @\(([\s\S]*?)\) \| Where-Object/u);
assert.ok(generatedSafePaths, "generated safe-path list was not found");
assert.doesNotMatch(generatedSafePaths[1], /employee-contract-education\.docx/u);
assert.doesNotMatch(generatedSafePaths[1], /employee-contract-general\.docx/u);
assert.match(generatedSafePaths[1], /employee-contract-education-no-stamp\.docx/u);
assert.match(generatedSafePaths[1], /employee-contract-general-no-stamp\.docx/u);
assert.match(rootLauncherSource, /bootstrap-local-system\.ps1/u);
assert.match(localLauncherSource, /bootstrap-local-system\.ps1/u);
assert.doesNotMatch(rootLauncherSource, /Установите Node\.js/u);
assert.doesNotMatch(localLauncherSource, /Установите Node\.js/u);
assert.match(rootStopSource, /stop-lan-system\.ps1/u);
assert.match(localStopSource, /stop-lan-system\.ps1/u);
assert.match(startSource, /port:\s*19081/u);
assert.match(startSource, /AIS_APP_SERVER_ORIGIN:\s*"http:\/\/127\.0\.0\.1:19081"/u);
assert.match(startSource, /AIS_DOCKER_PATH/u);
assert.match(startSource, /isAisServiceHealthy/u);
assert.match(startSource, /runtimeRoot[\s\S]*?\.runtime/u);
assert.match(startSource, /gatewaySecretPath = path\.join\(runtimeRoot, "tunnel-secret\.txt"\)/u);
assert.match(startSource, /existingSystemRuntimeMatches/u);
assert.match(startSource, /isExpectedNodeServiceProcess\(launcherPid,[\s\S]*?start-lan-system\.js/u);
assert.match(startSource, /onlyOfficeContainerSecretMatches/u);
assert.match(startSource, /stopExpectedNodeService/u);
assert.match(startSource, /payload\.runtimeSecrets\?\.gateway/u);
assert.match(startSource, /payload\.runtimeSecrets\?\.documentConverter/u);
assert.match(appServerSource, /LOCAL_ONLYOFFICE_JWT_SECRET_PATH/u);
assert.match(appServerSource, /await readLocalOnlyOfficeJwtSecret\(\)[\s\S]*?process\.env\.ONLYOFFICE_JWT_SECRET/u);
assert.match(appServerSource, /runtimeSecrets[\s\S]*?gateway:[\s\S]*?documentConverter:/u);
assert.match(appServerSource, /await getOnlyOfficeConverterSettings\(\)/u);
assert.match(remoteServicesSource, /onlyOfficeSecretPath[\s\S]*?onlyoffice-jwt-secret\.txt/u);
assert.match(remoteServicesSource, /Test-ApplicationRuntime/u);
assert.match(remoteServicesSource, /Test-OnlyOfficeContainerSecret/u);
assert.match(remoteServicesSource, /ONLYOFFICE_JWT_SECRET = \$OnlyOfficeSecret/u);
assert.match(onlyOfficeComposeSource, /JWT_SECRET: "\$\{ONLYOFFICE_JWT_SECRET:\?Set ONLYOFFICE_JWT_SECRET\}"/u);
assert.match(stopSource, /@\(8081, 19081\)/u);
assert.match(stopSource, /\$candidates\s*=\s*@\(\s*@\([\s\S]*?Where-Object/u);
assert.match(localServerSource, /AIS_APP_SERVER_ORIGIN \|\| "http:\/\/127\.0\.0\.1:19081"/u);

if (process.platform === "win32") {
  const invokeGitFunctionMatch = startupUpdateSource.match(
    /function Invoke-Git \{[\s\S]*?\r?\n\}/u
  );
  assert.ok(invokeGitFunctionMatch, "Invoke-Git was not found in sync-and-deploy-startup.ps1");
  const gitFixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ais-startup-git-"));
  const fakeGitPath = path.join(gitFixtureRoot, "fake-git.cmd");
  fs.writeFileSync(fakeGitPath, [
    "@echo off",
    "setlocal",
    "set \"mode=\"",
    "for %%A in (%*) do set \"mode=%%~A\"",
    "if /I \"%mode%\"==\"fail\" (",
    "  1>&2 echo fatal: simulated Git failure",
    "  exit /b 17",
    ")",
    "echo stdout-value",
    "1>&2 echo warning: simulated line-ending warning",
    "exit /b 0",
    ""
  ].join("\r\n"));
  try {
    const quotePowerShellLiteral = (value) => String(value).replace(/'/gu, "''");
    const invokeGitProbeScript = `$ErrorActionPreference = "Stop"
$script:gitPath = '${quotePowerShellLiteral(fakeGitPath)}'
$repositoryRoot = '${quotePowerShellLiteral(repositoryRoot)}'
${invokeGitFunctionMatch[0]}
$success = Invoke-Git -Arguments @("success")
if ($success.Code -ne 0 -or $success.Text -ne "stdout-value") {
  throw "Successful Git stdout was not preserved: <$($success.Text)> code=$($success.Code)"
}
if ($success.ErrorText -notmatch "simulated line-ending warning") {
  throw "Successful Git stderr warning was not captured separately."
}
if ($ErrorActionPreference -ne "Stop") {
  throw "Invoke-Git did not restore ErrorActionPreference."
}
$allowedFailure = Invoke-Git -Arguments @("fail") -AllowFailure
if ($allowedFailure.Code -ne 17 -or $allowedFailure.ErrorText -notmatch "simulated Git failure") {
  throw "Allowed Git failure was not returned correctly."
}
$failureMessage = ""
try {
  Invoke-Git -Arguments @("fail") | Out-Null
} catch {
  $failureMessage = $_.Exception.Message
}
if ($failureMessage -notmatch "кодом 17" -or $failureMessage -notmatch "simulated Git failure") {
  throw "Real Git failure was not reported with exit code and stderr: <$failureMessage>"
}`;
    const invokeGitProbe = spawnSync("powershell.exe", [
      "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass",
      "-EncodedCommand", Buffer.from(invokeGitProbeScript, "utf16le").toString("base64")
    ], {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 30000
    });
    assert.equal(invokeGitProbe.status, 0, `${invokeGitProbe.stdout}\n${invokeGitProbe.stderr}`);
  } finally {
    fs.rmSync(gitFixtureRoot, { recursive: true, force: true });
  }

  const dockerResolverMatch = stopSource.match(/function Find-DockerCli \{[\s\S]*?\r?\n\}/u);
  assert.ok(dockerResolverMatch, "Find-DockerCli was not found in stop-lan-system.ps1");
  const dockerFixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ais-docker-path-"));
  const dockerFixturePath = path.join(dockerFixtureRoot, "docker.exe");
  fs.writeFileSync(dockerFixturePath, "");
  try {
    const resolverProbeScript = `${dockerResolverMatch[0]}
$resolved = @(Find-DockerCli)
if ($resolved.Count -ne 1 -or
    -not (Test-Path -LiteralPath ([string]$resolved[0]) -PathType Leaf) -or
    [regex]::Matches([string]$resolved[0], 'docker\.exe', 'IgnoreCase').Count -ne 1) {
  throw "Docker CLI path resolution is invalid: <$($resolved -join '|')>"
}`;
    const resolverProbe = spawnSync("powershell.exe", [
      "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass",
      "-EncodedCommand", Buffer.from(resolverProbeScript, "utf16le").toString("base64")
    ], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        AIS_DOCKER_PATH: dockerFixturePath,
        ProgramFiles: dockerFixtureRoot,
        LOCALAPPDATA: dockerFixtureRoot,
        Path: `${dockerFixtureRoot};${process.env.Path || ""}`
      },
      encoding: "utf8",
      timeout: 30000
    });
    assert.equal(resolverProbe.status, 0, `${resolverProbe.stdout}\n${resolverProbe.stderr}`);
  } finally {
    fs.rmSync(dockerFixtureRoot, { recursive: true, force: true });
  }

  const environment = {
    ...process.env,
    AIS_NODE_PATH: process.execPath,
    AIS_BOOTSTRAP_SKIP_INSTALL: "1",
    AIS_BOOTSTRAP_SKIP_DOCKER: "1"
  };
  const validation = spawnSync("powershell.exe", [
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", bootstrapPath,
    "-Action", "Validate",
    "-LauncherArguments", "--skip-docker"
  ], { cwd: repositoryRoot, env: environment, encoding: "utf8", timeout: 30000 });
  assert.equal(validation.status, 0, `${validation.stdout}\n${validation.stderr}`);
  assert.match(validation.stdout, /Node\.js v\d+/u);
  assert.match(validation.stdout, /Конфигурация проверена/u);
  assert.match(validation.stdout, /Установка и запуск служб не выполнялись/u);

  const launcherValidation = spawnSync("cmd.exe", [
    "/d", "/c", rootLauncherPath, "--skip-docker"
  ], {
    cwd: repositoryRoot,
    env: { ...environment, AIS_LAUNCHER_VALIDATE_ONLY: "1" },
    encoding: "utf8",
    timeout: 30000
  });
  assert.equal(launcherValidation.status, 0, `${launcherValidation.stdout}\n${launcherValidation.stderr}`);
  assert.match(launcherValidation.stdout, /Сценарий запуска и окружение проверены/u);
}

console.log("local bootstrap tests: OK");

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(appRoot, "..");
const bootstrapPath = path.join(__dirname, "bootstrap-local-system.ps1");
const rootLauncherPath = path.join(repositoryRoot, "ЗАПУСТИТЬ АИС.bat");
const localLauncherPath = path.join(appRoot, "ЗАПУСТИТЬ АИС В ЛОКАЛЬНОЙ СЕТИ.cmd");
const rootStopPath = path.join(repositoryRoot, "ОСТАНОВИТЬ АИС.cmd");
const localStopPath = path.join(appRoot, "ОСТАНОВИТЬ АИС.cmd");

const read = (filePath) => fs.readFileSync(filePath, "utf8");
const bootstrapSource = read(bootstrapPath);
const rootLauncherSource = read(rootLauncherPath);
const localLauncherSource = read(localLauncherPath);
const rootStopSource = read(rootStopPath);
const localStopSource = read(localStopPath);
const startSource = read(path.join(__dirname, "start-lan-system.js"));
const stopSource = read(path.join(__dirname, "stop-lan-system.ps1"));
const localServerSource = read(path.join(appRoot, "local-server.js"));

assert.match(bootstrapSource, /https:\/\/nodejs\.org\/dist\/index\.json/u);
assert.match(bootstrapSource, /SHASUMS256/u);
assert.match(bootstrapSource, /Get-FileHash[\s\S]*SHA256/u);
assert.match(bootstrapSource, /desktop\.docker\.com\/win\/main/u);
assert.match(bootstrapSource, /Get-AuthenticodeSignature/u);
assert.match(bootstrapSource, /--user[\s\S]*--accept-license[\s\S]*--backend=wsl-2/u);
assert.match(bootstrapSource, /Start-DockerEngine/u);
assert.match(bootstrapSource, /AIS_BOOTSTRAP_SKIP_INSTALL/u);
assert.match(bootstrapSource, /AIS_BOOTSTRAP_SKIP_DOCKER/u);
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
assert.match(stopSource, /@\(8081, 19081\)/u);
assert.match(localServerSource, /AIS_APP_SERVER_ORIGIN \|\| "http:\/\/127\.0\.0\.1:19081"/u);

if (process.platform === "win32") {
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

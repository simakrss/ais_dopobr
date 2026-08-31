"use strict";

const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { execFileSync, spawn } = require("child_process");

const eventTimestampFormatter = new Intl.DateTimeFormat("ru-RU", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function enableTimestampedConsole() {
  for (const method of ["log", "warn", "error"]) {
    const write = console[method].bind(console);
    console[method] = (...values) => {
      const output = [...values];
      if (typeof output[0] === "string" && output[0].startsWith("\n")) {
        write("");
        output[0] = output[0].slice(1);
      }
      write(`[${eventTimestampFormatter.format(new Date()).replace(",", "")}]`, ...output);
    };
  }
}

enableTimestampedConsole();

const appRoot = path.resolve(__dirname, "..");
const logRoot = path.join(appRoot, "tmp", "lan-system");
const runtimeRoot = path.join(appRoot, ".runtime");
const statusPath = path.join(logRoot, "status.json");
const launcherFallbackLockPath = path.join(logRoot, "launcher.lock");
const launcherMutexName = "Global\\AisDopobrWeb.Launcher";
const secretPath = path.join(logRoot, "onlyoffice-jwt-secret.txt");
const gatewaySecretPath = path.join(runtimeRoot, "tunnel-secret.txt");
const legacyGatewaySecretPath = path.join(logRoot, "local-service-gateway-secret.txt");
const composePath = path.join(appRoot, "docker-compose.onlyoffice.yml");
const remoteServicesScriptPath = path.join(__dirname, "start-remote-services.ps1");
const argumentsLower = new Set(process.argv.slice(2).map((value) => value.toLowerCase()));
const skipDocker = argumentsLower.has("--skip-docker") || argumentsLower.has("-skipdocker");
const runOnce = argumentsLower.has("--once");
const openBrowser = argumentsLower.has("--open-browser");
const serviceMode = process.env.AIS_SERVICE_MODE === "1";
const localBrowserUrl = "http://127.0.0.1:8081/";
const managedChildren = new Map();
const activeServerOperations = new Set();
let shuttingDown = false;
let monitorBusy = false;
let requestedExitCode = 0;
let shutdownPromise = null;
let launcherMutexProcess = null;
let launcherMutexReleaseRequested = false;
let launcherFallbackLockDescriptor = null;

class ShutdownRequestedError extends Error {
  constructor(message) {
    super(message);
    this.name = "ShutdownRequestedError";
    this.code = "AIS_SHUTDOWN_REQUESTED";
  }
}

const serverDefinitions = [
  {
    key: "appServer",
    name: "Application server",
    scriptName: "app-server.js",
    host: "127.0.0.1",
    port: 19081,
    startupTimeoutMilliseconds: 180000,
    environment: {},
  },
  {
    key: "localServer",
    name: "LAN web server",
    scriptName: "local-server.js",
    host: "0.0.0.0",
    port: 8081,
    startupTimeoutMilliseconds: 60000,
    environment: { AIS_APP_SERVER_ORIGIN: "http://127.0.0.1:19081" },
  },
];

function ensureDirectories() {
  fs.mkdirSync(logRoot, { recursive: true });
  fs.mkdirSync(runtimeRoot, { recursive: true });
}

function inspectNodeProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return { status: "missing", pid: 0 };
  try {
    const output = execFileSync("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    for (const line of output.split(/\r?\n/u)) {
      const match = line.match(/^"([^"]+)","(\d+)"/u);
      if (!match || Number(match[2]) !== pid) continue;
      return {
        status: match[1].toLowerCase() === "node.exe" ? "node" : "other",
        pid,
      };
    }
    return { status: "missing", pid };
  } catch (_error) {
    return { status: "unknown", pid };
  }
}

function inspectProcessCommandLine(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return { status: "missing", commandLine: "" };
  try {
    const commandLine = execFileSync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-Command",
        `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`,
      ],
      { encoding: "utf8", timeout: 7000, windowsHide: true },
    ).trim();
    if (!commandLine) {
      const processState = inspectNodeProcess(pid);
      return processState.status === "missing"
        ? { status: "missing", commandLine: "" }
        : { status: "unknown", commandLine: "" };
    }
    return { status: "known", commandLine };
  } catch (_error) {
    return { status: "unknown", commandLine: "" };
  }
}

function inspectExpectedNodeServiceProcess(pid, scriptName) {
  const processState = inspectNodeProcess(pid);
  if (processState.status !== "node") return processState;
  const commandState = inspectProcessCommandLine(pid);
  if (commandState.status !== "known") return { status: commandState.status, pid };
  const commandLine = commandState.commandLine.replace(/\//g, "\\").toLowerCase();
  const expectedPath = path.join(appRoot, scriptName).replace(/\//g, "\\").toLowerCase();
  return {
    status: commandLine.includes("node") && commandLine.includes(expectedPath)
      ? "expected"
      : "other",
    pid,
  };
}

function processExists(pid) {
  if (pid === process.pid) return false;
  return inspectNodeProcess(pid).status === "node";
}

function isExpectedNodeServiceProcess(pid, scriptName) {
  if (pid === process.pid) return false;
  return inspectExpectedNodeServiceProcess(pid, scriptName).status === "expected";
}

function buildLauncherMutexScript(mutexName = launcherMutexName) {
  const escapedMutexName = String(mutexName).replace(/'/g, "''");
  return `$ErrorActionPreference = "Stop"
$mutex = New-Object Threading.Mutex($false, '${escapedMutexName}')
$ownsMutex = $false
try {
  try {
    $ownsMutex = $mutex.WaitOne(0)
  } catch [Threading.AbandonedMutexException] {
    $ownsMutex = $true
  }
  if (-not $ownsMutex) {
    [Console]::Out.WriteLine("BUSY")
    [Console]::Out.Flush()
    exit 2
  }
  [Console]::Out.WriteLine("ACQUIRED")
  [Console]::Out.Flush()
  [void][Console]::In.ReadLine()
} finally {
  if ($ownsMutex) {
    try { $mutex.ReleaseMutex() } catch [ApplicationException] { }
  }
  $mutex.Dispose()
}`;
}

function acquireWindowsLauncherMutex(timeoutMilliseconds = 15000) {
  launcherMutexReleaseRequested = false;
  const encodedCommand = Buffer.from(
    buildLauncherMutexScript(),
    "utf16le",
  ).toString("base64");
  const child = spawn(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedCommand],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  return new Promise((resolve, reject) => {
    let settled = false;
    let acquired = false;
    let output = "";
    let errorOutput = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch (_error) { }
      reject(new Error("Timed out while acquiring the machine-wide AIS launcher mutex."));
    }, timeoutMilliseconds);
    const finish = (result, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const inspectOutput = () => {
      if (settled) return;
      if (output.includes("ACQUIRED")) {
        acquired = true;
        launcherMutexProcess = child;
        finish({ acquired: true, ownerPid: 0 });
      } else if (output.includes("BUSY")) {
        try { child.stdin.end(); } catch (_error) { }
        finish({ acquired: false, ownerPid: 0 });
      }
    };
    child.stdout.on("data", (chunk) => {
      output = `${output}${chunk}`.slice(-4096);
      inspectOutput();
    });
    child.stderr.on("data", (chunk) => {
      errorOutput = `${errorOutput}${chunk}`.slice(-4096);
    });
    child.once("error", (error) => {
      finish(null, error);
    });
    child.once("exit", (code, signal) => {
      if (launcherMutexProcess === child) launcherMutexProcess = null;
      if (!settled) {
        inspectOutput();
        if (!settled) {
          if (code === 2 || output.includes("BUSY")) {
            finish({ acquired: false, ownerPid: 0 });
          } else {
            finish(
              null,
              new Error(
                `AIS launcher mutex helper exited before acquisition `
                + `(code ${code ?? "-"}, signal ${signal ?? "-"}). ${errorOutput.trim()}`,
              ),
            );
          }
        }
      } else if (acquired && !launcherMutexReleaseRequested && !shuttingDown) {
        console.error("Machine-wide AIS launcher mutex was lost unexpectedly.");
        shutdown(1);
      }
    });
  });
}

function acquireFallbackLauncherLock() {
  let descriptor;
  try {
    descriptor = fs.openSync(launcherFallbackLockPath, "wx");
    fs.writeFileSync(descriptor, `${JSON.stringify({
      pid: process.pid,
      createdAt: new Date().toISOString(),
    })}\n`, "utf8");
    fs.fsyncSync(descriptor);
    launcherFallbackLockDescriptor = descriptor;
    return { acquired: true, ownerPid: process.pid };
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch (_closeError) { }
      try { fs.rmSync(launcherFallbackLockPath, { force: true }); } catch (_removeError) { }
    }
    if (error?.code === "EEXIST") return { acquired: false, ownerPid: 0 };
    throw error;
  }
}

async function acquireLauncherGuard() {
  if (process.platform === "win32") return acquireWindowsLauncherMutex();
  return acquireFallbackLauncherLock();
}

async function releaseLauncherGuard() {
  if (process.platform !== "win32") {
    const descriptor = launcherFallbackLockDescriptor;
    launcherFallbackLockDescriptor = null;
    if (descriptor === null) return;
    try {
      fs.rmSync(launcherFallbackLockPath, { force: true });
    } finally {
      fs.closeSync(descriptor);
    }
    return;
  }

  const child = launcherMutexProcess;
  if (!child) return;
  launcherMutexReleaseRequested = true;
  try { child.stdin.end(); } catch (_error) { }
  if (await waitForChildExit(child, 5000)) return;
  try { child.kill(); } catch (_error) { }
  if (await waitForChildExit(child, 5000)) return;
  try { child.kill("SIGKILL"); } catch (_error) { }
  if (!(await waitForChildExit(child, 5000))) {
    throw new Error("Machine-wide AIS launcher mutex helper could not be stopped.");
  }
}

function releaseLauncherGuardOnExit() {
  launcherMutexReleaseRequested = true;
  const child = launcherMutexProcess;
  if (child && !childHasExited(child)) {
    try { child.stdin.end(); } catch (_error) { }
    try { child.kill(); } catch (_error) { }
  }
  const descriptor = launcherFallbackLockDescriptor;
  launcherFallbackLockDescriptor = null;
  if (descriptor !== null) {
    try { fs.rmSync(launcherFallbackLockPath, { force: true }); } catch (_error) { }
    try { fs.closeSync(descriptor); } catch (_error) { }
  }
}

function readLauncherStatus() {
  try {
    const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    return status && typeof status === "object" ? status : null;
  } catch (_error) {
    return null;
  }
}

function readOfflineStateStatus() {
  const cachePath = path.join(appRoot, "storage", "shared-application-state.json");
  const pendingPath = path.join(appRoot, "storage", "shared-application-state-pending.json");
  let revision = 0;
  let updatedAt = "";
  let pendingCount = 0;
  try {
    const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    revision = Math.max(0, Number(cache?.revision) || 0);
    updatedAt = String(cache?.updatedAt || "");
  } catch (_error) {
    // The first online startup will create the autonomous cache.
  }
  try {
    const pending = JSON.parse(fs.readFileSync(pendingPath, "utf8"));
    pendingCount = Array.isArray(pending?.operations) ? pending.operations.length : 0;
  } catch (_error) {
    // No queued changes means synchronization is complete.
  }
  return {
    ready: revision > 0,
    revision,
    updatedAt,
    pendingCount,
  };
}

function printExistingSystemStatus(status) {
  console.log("\n[AIS] Система уже запущена");
  console.log(`Процесс запуска: ${status.launcherPid}`);
  console.log(`Этот компьютер: ${status.localUrl || localBrowserUrl}`);
  for (const url of status.lanUrls || []) console.log(`Локальная сеть: ${url}`);
  console.log("Для перезапуска сначала используйте файл «ОСТАНОВИТЬ АИС.cmd».");
}

function openLocalBrowser() {
  if (!openBrowser) return;
  if (process.platform !== "win32") {
    console.warn(`Автоматическое открытие браузера недоступно; откройте ${localBrowserUrl}`);
    return;
  }
  try {
    const browserLauncher = spawn(
      "cmd.exe",
      ["/d", "/c", "start", "", localBrowserUrl],
      { cwd: appRoot, detached: true, stdio: "ignore", windowsHide: true },
    );
    browserLauncher.once("error", (error) => {
      console.warn(`Не удалось автоматически открыть браузер: ${error.message}`);
    });
    browserLauncher.unref();
    console.log(`Открывается локальная АИС: ${localBrowserUrl}`);
  } catch (error) {
    console.warn(`Не удалось автоматически открыть браузер: ${error.message}`);
  }
}

function getOnlyOfficeSecret() {
  if (process.env.ONLYOFFICE_JWT_SECRET) {
    return process.env.ONLYOFFICE_JWT_SECRET.trim();
  }
  try {
    const current = fs.readFileSync(secretPath, "utf8").trim();
    if (current) return current;
  } catch (_error) {
    // The secret is created on the first local launch.
  }
  const secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(secretPath, `${secret}\n`, "utf8");
  return secret;
}

function getLocalServiceGatewaySecret() {
  const configured = String(process.env.AIS_GATEWAY_SHARED_SECRET || "").trim();
  let secret = configured.length >= 48 ? configured : "";
  for (const candidatePath of [gatewaySecretPath, legacyGatewaySecretPath]) {
    if (secret) break;
    try {
      const current = fs.readFileSync(candidatePath, "utf8").trim();
      if (current.length >= 48) secret = current;
    } catch (_error) {
      // The first local gateway launch creates a shared secret.
    }
  }
  if (!secret) secret = crypto.randomBytes(48).toString("base64url");
  fs.writeFileSync(gatewaySecretPath, `${secret}\n`, "utf8");
  fs.writeFileSync(legacyGatewaySecretPath, `${secret}\n`, "utf8");
  return secret;
}

function runtimeSecretFingerprint(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex").slice(0, 16);
}

function listeningPid(port) {
  try {
    const output = execFileSync("netstat.exe", ["-ano", "-p", "tcp"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    for (const line of output.split(/\r?\n/)) {
      const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
      if (match && Number(match[1]) === port) return Number(match[2]);
    }
  } catch (_error) {
    return null;
  }
  return 0;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isPortOpen(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(700);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function waitForOwnedPort(host, port, child, timeoutMilliseconds = 12000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (shuttingDown) return false;
    if (child.exitCode !== null || child.signalCode !== null) return false;
    if (await isPortOpen(host, port)) {
      const ownerPid = listeningPid(port);
      if (ownerPid === child.pid) return true;
      if (ownerPid > 0) return false;
    }
    await wait(300);
  }
  return false;
}

async function inspectListeningPort(host, port, attempts = 3) {
  const totalAttempts = Math.max(1, Math.floor(Number(attempts) || 1));
  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    const ownerPid = listeningPid(port);
    if (ownerPid > 0) return { open: true, pid: ownerPid };
    if (ownerPid === 0 && !(await isPortOpen(host, port))) {
      return { open: false, pid: 0 };
    }
    if (attempt + 1 < totalAttempts) await wait(300);
  }
  return { open: true, pid: 0 };
}

function childHasExited(child) {
  return !child || child.exitCode !== null || child.signalCode !== null;
}

function waitForChildExit(child, timeoutMilliseconds) {
  if (childHasExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      child.off("exit", onExit);
    };
    const onExit = () => {
      cleanup();
      resolve(true);
    };
    child.once("exit", onExit);
    timer = setTimeout(() => {
      cleanup();
      resolve(childHasExited(child));
    }, timeoutMilliseconds);
  });
}

async function stopManagedChild(child, graceMilliseconds = 5000) {
  if (childHasExited(child)) return true;
  try {
    child.kill();
  } catch (_error) {
    // A concurrent exit is observed by waitForChildExit below.
  }
  if (await waitForChildExit(child, graceMilliseconds)) return true;

  try {
    // ChildProcess.kill uses the process handle on Windows, so a reused numeric PID
    // cannot redirect this force-stop to an unrelated process.
    child.kill("SIGKILL");
  } catch (_error) {
    // A concurrent exit is observed below.
  }
  return waitForChildExit(child, 10000);
}

async function isAisServiceHealthy(port, commonEnvironment = null) {
  try {
    const gatewaySecret = String(commonEnvironment?.AIS_GATEWAY_SHARED_SECRET || "");
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      cache: "no-store",
      ...(gatewaySecret ? { headers: { "X-AIS-Gateway-Token": gatewaySecret } } : {}),
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return false;
    const payload = await response.json();
    if (payload?.ok !== true || !["mysql", "yandex-disk"].includes(String(payload.storage || ""))) {
      return false;
    }
    if (!commonEnvironment) return true;
    return payload.runtimeSecrets?.gateway
        === runtimeSecretFingerprint(commonEnvironment.AIS_GATEWAY_SHARED_SECRET)
      && payload.runtimeSecrets?.documentConverter
        === runtimeSecretFingerprint(commonEnvironment.ONLYOFFICE_JWT_SECRET);
  } catch (_error) {
    return false;
  }
}

async function isAisServiceHealthyWithRetry(
  port,
  commonEnvironment,
  attempts = 3,
  delayMilliseconds = 500,
) {
  const totalAttempts = Math.max(1, Math.floor(Number(attempts) || 1));
  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    if (await isAisServiceHealthy(port, commonEnvironment)) return true;
    if (attempt + 1 < totalAttempts) await wait(delayMilliseconds);
  }
  return false;
}

function processCommandLine(pid) {
  // Compatibility boundary for focused tests; safety callers preserve tri-state.
  const result = inspectProcessCommandLine(pid);
  return result.status === "known" ? result.commandLine : "";
}

function buildExpectedProcessStopScript(pid, expectedPath) {
  const escapedExpectedPath = String(expectedPath).replace(/'/g, "''");
  return `$ErrorActionPreference = "Stop"
$target = [Diagnostics.Process]::GetProcessById(${Number(pid)})
$targetStartedAt = $target.StartTime.ToUniversalTime()
$cim = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}" -ErrorAction Stop
if (-not $cim) { throw "Target process disappeared before identity verification." }
$cimStartedAt = ([DateTime]$cim.CreationDate).ToUniversalTime()
if ([Math]::Abs(($cimStartedAt - $targetStartedAt).TotalMilliseconds) -gt 100) {
  throw "Target PID was reused before identity verification."
}
$commandLine = [string]$cim.CommandLine
if ($target.ProcessName -ine "node" -or $commandLine.IndexOf(
  '${escapedExpectedPath}',
  [StringComparison]::OrdinalIgnoreCase
) -lt 0) {
  throw "Target process identity does not match the expected AIS script."
}
$target.Kill()
if (-not $target.WaitForExit(10000)) { throw "Target process did not stop." }`;
}

async function stopExpectedNodeService(pid, scriptName) {
  if (pid === process.pid) {
    throw new Error("Супервизор отказался останавливать собственный процесс по устаревшему PID.");
  }
  const processState = inspectExpectedNodeServiceProcess(pid, scriptName);
  if (processState.status === "unknown") {
    throw new Error(
      `Не удалось надёжно проверить процесс ${pid}; автоматический перезапуск отменён.`,
    );
  }
  if (processState.status !== "expected") {
    throw new Error(`Процесс ${pid} не принадлежит службе АИС ${scriptName}; автоматический перезапуск отменён.`);
  }
  const expectedPath = path.join(appRoot, scriptName).replace(/\//g, "\\");
  const encodedCommand = Buffer.from(
    buildExpectedProcessStopScript(pid, expectedPath),
    "utf16le",
  ).toString("base64");
  try {
    execFileSync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedCommand],
      { timeout: 20000, windowsHide: true, stdio: "ignore" },
    );
  } catch (_error) {
    throw new Error(
      `Процесс ${pid} изменился или не завершился; автоматический перезапуск отменён.`,
    );
  }
}

function onlyOfficeContainerSecretMatches(commonEnvironment) {
  if (skipDocker) return true;
  try {
    const dockerPath = process.env.AIS_DOCKER_PATH || "docker.exe";
    const output = execFileSync(
      dockerPath,
      ["inspect", "ais-onlyoffice", "--format", "{{range .Config.Env}}{{println .}}{{end}}"],
      { encoding: "utf8", timeout: 7000, windowsHide: true },
    );
    const configured = output.split(/\r?\n/u)
      .find((line) => line.startsWith("JWT_SECRET="))
      ?.slice("JWT_SECRET=".length) || "";
    return runtimeSecretFingerprint(configured)
      === runtimeSecretFingerprint(commonEnvironment.ONLYOFFICE_JWT_SECRET);
  } catch (_error) {
    return false;
  }
}

async function existingSystemRuntimeMatches(status, commonEnvironment) {
  const launcherPid = Number(status?.launcherPid);
  return processExists(launcherPid)
    && isExpectedNodeServiceProcess(launcherPid, path.join("scripts", "start-lan-system.js"))
    && onlyOfficeContainerSecretMatches(commonEnvironment)
    && await isAisServiceHealthy(19081, commonEnvironment)
    && await isAisServiceHealthy(8081, commonEnvironment);
}

async function startServer(definition, commonEnvironment) {
  if (typeof shuttingDown !== "undefined" && shuttingDown) {
    throw new ShutdownRequestedError(
      `${definition.name}: запуск отменён из-за остановки супервизора.`,
    );
  }
  let trackedChild = managedChildren.get(definition.key);
  if (trackedChild && childHasExited(trackedChild)) {
    if (managedChildren.get(definition.key) === trackedChild) {
      managedChildren.delete(definition.key);
    }
    trackedChild = null;
  }

  const portState = await inspectListeningPort("127.0.0.1", definition.port);
  if (portState.open && portState.pid === 0) {
    throw new Error(
      `Порт ${definition.port} отвечает, но его владелец не определён; повторный запуск отменён.`,
    );
  }
  if (trackedChild && portState.pid !== trackedChild.pid) {
    const stopped = await stopManagedChild(trackedChild);
    if (!stopped) {
      throw new Error(
        `${definition.name}: управляемый процесс ${trackedChild.pid} не завершился; повторный запуск отменён.`,
      );
    }
    if (managedChildren.get(definition.key) === trackedChild) {
      managedChildren.delete(definition.key);
    }
  }

  const existingPid = portState.pid;
  if (existingPid) {
    let runtimeMatches = await isAisServiceHealthy(definition.port, commonEnvironment);
    if (!runtimeMatches && !(await isAisServiceHealthy(definition.port))) {
      throw new Error(
        `Порт ${definition.port} занят другим приложением (PID ${existingPid}). `
        + `Освободите порт и повторите запуск АИС.`,
      );
    }
    if (!runtimeMatches) {
      // A CPU-heavy XLSB parse can delay the authenticated health request beyond its
      // timeout while the immediately following anonymous probe succeeds. Confirm the
      // runtime-secret mismatch before terminating a valid in-flight application server.
      runtimeMatches = await isAisServiceHealthyWithRetry(
        definition.port,
        commonEnvironment,
      );
    }
    if (runtimeMatches && trackedChild && existingPid === trackedChild.pid) {
      console.log(`${definition.name} is already running (PID ${existingPid}, port ${definition.port}).`);
      return existingPid;
    }
    if (runtimeMatches) {
      console.log(
        `${definition.name}: найден исправный процесс без активного супервизора `
        + `(PID ${existingPid}); выполняется безопасный перезапуск.`,
      );
    } else {
      console.log(`${definition.name}: обнаружены несовместимые служебные ключи, выполняется безопасный перезапуск.`);
    }
    await stopExpectedNodeService(existingPid, definition.scriptName);
    const portDeadline = Date.now() + 10000;
    while (await isPortOpen("127.0.0.1", definition.port)) {
      if (Date.now() >= portDeadline) throw new Error(`Порт ${definition.port} не освободился после остановки службы.`);
      await wait(200);
    }
  }

  const stdoutPath = path.join(logRoot, `${definition.scriptName}.stdout.log`);
  const stderrPath = path.join(logRoot, `${definition.scriptName}.stderr.log`);
  if (typeof shuttingDown !== "undefined" && shuttingDown) {
    throw new ShutdownRequestedError(
      `${definition.name}: запуск отменён из-за остановки супервизора.`,
    );
  }
  const stdoutHandle = fs.openSync(stdoutPath, "a");
  const stderrHandle = fs.openSync(stderrPath, "a");
  let child;
  try {
    child = spawn(process.execPath, [path.join(appRoot, definition.scriptName)], {
      cwd: appRoot,
      detached: false,
      windowsHide: true,
      env: {
        ...process.env,
        ...commonEnvironment,
        ...definition.environment,
        HOST: definition.host,
        PORT: String(definition.port),
      },
      stdio: ["ignore", stdoutHandle, stderrHandle],
    });
  } finally {
    fs.closeSync(stdoutHandle);
    fs.closeSync(stderrHandle);
  }

  managedChildren.set(definition.key, child);
  child.once("exit", (code, signal) => {
    if (managedChildren.get(definition.key) === child) {
      managedChildren.delete(definition.key);
    }
    if (!shuttingDown) {
      console.error(`${definition.name} stopped (code ${code ?? "-"}, signal ${signal ?? "-"}).`);
    }
  });

  if (!(
    await waitForOwnedPort(
      "127.0.0.1",
      definition.port,
      child,
      definition.startupTimeoutMilliseconds,
    )
  )) {
    const stopped = await stopManagedChild(child);
    if (!stopped) {
      throw new Error(
        `${definition.name} did not open port ${definition.port}, and its managed process `
        + `${child.pid} could not be stopped. See ${stderrPath}`,
      );
    }
    throw new Error(`${definition.name} did not open port ${definition.port}. See ${stderrPath}`);
  }
  console.log(`${definition.name} started (PID ${child.pid}, port ${definition.port}).`);
  return child.pid;
}

function startTrackedServer(definition, commonEnvironment) {
  if (shuttingDown) {
    return Promise.reject(
      new ShutdownRequestedError(
        `${definition.name}: запуск отменён из-за остановки супервизора.`,
      ),
    );
  }
  let trackedOperation;
  const operation = startServer(definition, commonEnvironment);
  trackedOperation = operation.finally(() => {
    activeServerOperations.delete(trackedOperation);
  });
  activeServerOperations.add(trackedOperation);
  return trackedOperation;
}

function startDocumentServices(commonEnvironment) {
  if (skipDocker) {
    console.log("OCR and OnlyOffice launch was skipped by command-line option.");
    return "skipped";
  }
  const dockerPath = process.env.AIS_DOCKER_PATH || "docker.exe";
  try {
    execFileSync(dockerPath, ["info", "--format", "{{.ServerVersion}}"], {
      encoding: "utf8",
      timeout: 6000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (_error) {
    console.log("Docker Desktop не готов. Основная АИС продолжит работу без OCR и преобразования документов.");
    return "unavailable";
  }

  try {
    console.log("Starting OCR and OnlyOffice containers...");
    try {
      console.log("Checking the local OCR image for source updates...");
      execFileSync(
        dockerPath,
        ["compose", "-f", composePath, "build", "ocr"],
        {
          cwd: appRoot,
          env: { ...process.env, ...commonEnvironment },
          timeout: 300000,
          windowsHide: true,
          stdio: "inherit",
        },
      );
    } catch (_error) {
      console.log("The OCR image could not be refreshed; the existing local image will be used.");
    }
    try {
      execFileSync(
        dockerPath,
        ["compose", "-f", composePath, "up", "-d", "--no-build"],
        {
          cwd: appRoot,
          env: { ...process.env, ...commonEnvironment },
          timeout: 120000,
          windowsHide: true,
          stdio: "inherit",
        },
      );
      ensureOnlyOfficeDocumentFonts(dockerPath);
      console.log("OCR and OnlyOffice containers are running from local images.");
      return "running";
    } catch (_error) {
      console.log("Local Docker images need to be prepared. Starting one-time build...");
    }
    execFileSync(
      dockerPath,
      ["compose", "-f", composePath, "up", "-d", "--build"],
      {
        cwd: appRoot,
        env: { ...process.env, ...commonEnvironment },
        timeout: 300000,
        windowsHide: true,
        stdio: "inherit",
      },
    );
    ensureOnlyOfficeDocumentFonts(dockerPath);
    console.log("OCR and OnlyOffice containers are running.");
    return "running";
  } catch (error) {
    console.error(`OCR/PDF could not be started: ${error.message}`);
    console.log("The main AIS servers will continue without Docker services.");
    return "unavailable";
  }
}

function startRemoteServicesSupervisor() {
  if (runOnce) return "skipped";
  if (process.platform !== "win32" || !fs.existsSync(remoteServicesScriptPath)) {
    console.warn("Сценарий внешнего туннеля не найден; удалённое формирование документов недоступно.");
    return "unavailable";
  }
  try {
    const output = execFileSync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        remoteServicesScriptPath,
        "-ParentProcessId",
        String(process.pid),
        "-CheckIntervalSeconds",
        "5",
      ],
      {
        cwd: appRoot,
        encoding: "utf8",
        timeout: 20000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const message = String(output || "").trim();
    console.log(message || "Супервизор внешнего туннеля запущен.");
    return "starting";
  } catch (error) {
    const details = String(error?.stderr || error?.message || "").trim();
    console.warn(`Не удалось запустить супервизор внешнего туннеля: ${details}`);
    return "unavailable";
  }
}

function ensureOnlyOfficeDocumentFonts(dockerPath = process.env.AIS_DOCKER_PATH || "docker.exe") {
  const fontCachePath = "/var/www/onlyoffice/documentserver/server/FileConverter/bin/AllFonts.js";
  const requiredFontCheck = ["Calibri", "Cambria", "Lucida Sans", "Times New Roman"]
    .map((fontName) => `grep -Fq '${fontName}' '${fontCachePath}'`)
    .join(" && ");
  try {
    execFileSync(
      dockerPath,
      ["exec", "ais-onlyoffice", "bash", "-lc", requiredFontCheck],
      {
        timeout: 15000,
        windowsHide: true,
        stdio: "ignore",
      },
    );
    console.log("ONLYOFFICE document fonts are ready.");
    return;
  } catch (_error) {
    console.log("Updating ONLYOFFICE document fonts from Windows...");
  }
  try {
    execFileSync(
      dockerPath,
      [
        "exec",
        "ais-onlyoffice",
        "bash",
        "-lc",
        "fc-cache -f && /usr/bin/documentserver-generate-allfonts.sh",
      ],
      {
        timeout: 300000,
        windowsHide: true,
        stdio: "inherit",
      },
    );
    execFileSync(
      dockerPath,
      ["exec", "ais-onlyoffice", "bash", "-lc", requiredFontCheck],
      {
        timeout: 15000,
        windowsHide: true,
        stdio: "ignore",
      },
    );
    console.log("ONLYOFFICE document fonts were updated.");
  } catch (error) {
    console.warn(`ONLYOFFICE document fonts could not be fully updated: ${error.message}`);
  }
}

function lanUrls() {
  const urls = [];
  for (const [adapterName, addresses] of Object.entries(os.networkInterfaces())) {
    if (/docker|wsl|vethernet|loopback|virtual/i.test(adapterName)) continue;
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal && !address.address.startsWith("169.254.")) {
        urls.push(`http://${address.address}:8081/`);
      }
    }
  }
  return [...new Set(urls)];
}

function deploymentWatcherStatus() {
  try {
    execFileSync("schtasks.exe", ["/Query", "/TN", "WebAisLmsAutoDeploy"], {
      timeout: 4000,
      windowsHide: true,
      stdio: "ignore",
    });
    return "scheduled-task";
  } catch (_error) {
    return "not-configured";
  }
}

function writeStatus(values) {
  const temporaryPath = `${statusPath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(values, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryPath, statusPath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

async function ensureServers(commonEnvironment, status) {
  for (const definition of serverDefinitions) {
    status[`${definition.key}Pid`] = await startTrackedServer(definition, commonEnvironment);
  }
}

async function waitForActiveServerOperations() {
  while (activeServerOperations.size > 0) {
    await Promise.allSettled([...activeServerOperations]);
  }
}

async function drainManagedChildren() {
  for (;;) {
    const children = [...managedChildren.entries()];
    if (children.length === 0) return;
    const stopResults = await Promise.all(children.map(async ([key, child]) => {
      try {
        return { key, child, stopped: await stopManagedChild(child) };
      } catch (error) {
        console.error(`Managed AIS process ${child.pid} stop failed: ${error.message}`);
        return { key, child, stopped: false };
      }
    }));
    let retryRequired = false;
    for (const result of stopResults) {
      if (result.stopped) {
        if (managedChildren.get(result.key) === result.child) {
          managedChildren.delete(result.key);
        }
      } else {
        retryRequired = true;
        requestedExitCode = Math.max(requestedExitCode, 1);
        console.error(`Managed AIS process ${result.child.pid} is still running; stop will be retried.`);
      }
    }
    if (retryRequired) await wait(1000);
  }
}

async function performShutdown() {
  console.log("\nStopping AIS servers started by this window...");
  await waitForActiveServerOperations();
  await drainManagedChildren();
  for (;;) {
    try {
      await releaseLauncherGuard();
      break;
    } catch (error) {
      requestedExitCode = Math.max(requestedExitCode, 1);
      console.error(`${error.message} Mutex release will be retried.`);
      await wait(1000);
    }
  }
  process.exit(requestedExitCode);
}

function shutdown(exitCode = 0) {
  const normalizedExitCode = Math.max(0, Math.floor(Number(exitCode) || 0));
  requestedExitCode = Math.max(requestedExitCode, normalizedExitCode);
  process.exitCode = Math.max(Number(process.exitCode) || 0, requestedExitCode);
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  shutdownPromise = performShutdown();
  return shutdownPromise;
}

async function main() {
  ensureDirectories();
  const launcherLock = await acquireLauncherGuard();
  if (!launcherLock.acquired) {
    const ownerSuffix = launcherLock.ownerPid > 0 ? ` (PID ${launcherLock.ownerPid})` : "";
    console.log(`\n[AIS] Другой процесс запуска уже выполняется${ownerSuffix}.`);
    return;
  }
  const commonEnvironment = {
    ONLYOFFICE_JWT_SECRET: getOnlyOfficeSecret(),
    AIS_TRUST_GATEWAY: "1",
    AIS_GATEWAY_SHARED_SECRET: getLocalServiceGatewaySecret(),
    AIS_TUNNEL_ONLY: "1"
  };
  const previousStatus = readLauncherStatus();
  if (previousStatus && processExists(Number(previousStatus.launcherPid))) {
    if (await existingSystemRuntimeMatches(previousStatus, commonEnvironment)) {
      printExistingSystemStatus(previousStatus);
      openLocalBrowser();
      await releaseLauncherGuard();
      return;
    }
    const previousLauncherPid = Number(previousStatus.launcherPid);
    if (isExpectedNodeServiceProcess(previousLauncherPid, path.join("scripts", "start-lan-system.js"))) {
      console.log("\n[AIS] Обнаружен запущенный экземпляр с устаревшими служебными ключами. Выполняется восстановление.");
      await stopExpectedNodeService(previousLauncherPid, path.join("scripts", "start-lan-system.js"));
    } else {
      console.log("\n[AIS] Файл состояния устарел; запуск будет продолжен без остановки постороннего процесса.");
      fs.rmSync(statusPath, { force: true });
    }
  }
  const offlineState = readOfflineStateStatus();
  const status = {
    startedAt: new Date().toISOString(),
    computerName: os.hostname(),
    launcherPid: process.pid,
    appServerPid: 0,
    localServerPid: 0,
    localUrl: localBrowserUrl,
    lanUrls: lanUrls(),
    internetUrl: "https://edu-plus.ru/lms/",
    documentServices: "unknown",
    remoteDocumentServices: "unknown",
    deployWatcher: deploymentWatcherStatus(),
    logDirectory: logRoot,
    offlineReady: offlineState.ready,
    sharedStateRevision: offlineState.revision,
    pendingChangeCount: offlineState.pendingCount,
  };

  console.log("\n[AIS] Starting document services");
  status.documentServices = startDocumentServices(commonEnvironment);

  console.log("\n[AIS] Starting main servers");
  await ensureServers(commonEnvironment, status);
  if (shuttingDown) {
    throw new ShutdownRequestedError(
      "Запуск внешнего туннеля отменён из-за остановки супервизора.",
    );
  }
  console.log("\n[AIS] Starting secure external tunnel");
  status.remoteDocumentServices = startRemoteServicesSupervisor();
  writeStatus(status);

  console.log("\n[AIS] System is ready");
  console.log(`This computer: ${localBrowserUrl}`);
  for (const url of status.lanUrls) console.log(`Local network: ${url}`);
  console.log("Internet version: https://edu-plus.ru/lms/");
  console.log(`Logs: ${logRoot}`);
  if (offlineState.ready) {
    console.log(`Автономная копия готова (ревизия ${offlineState.revision}).`);
  } else {
    console.log("Автономная копия ещё не создана: для первого запуска требуется подключение к общей базе.");
  }
  if (offlineState.pendingCount) {
    console.log(`Ожидают выгрузки в MySQL: ${offlineState.pendingCount}.`);
  } else {
    console.log("Очередь автономных изменений пуста.");
  }
  if (status.deployWatcher === "scheduled-task") {
    console.log("Automatic publication to edu-plus.ru/lms is enabled.");
  } else {
    console.log("Automatic publication task is not configured on this computer.");
  }
  if (serviceMode) {
    console.log("Фоновый супервизор продолжает работу через службу Windows.");
  } else {
    console.log("Не закрывайте это окно: в нём работает супервизор серверов АИС.");
    openLocalBrowser();
  }

  if (runOnce) {
    console.log("One-time startup check completed.");
    return;
  }

  setInterval(async () => {
    if (shuttingDown || monitorBusy) return;
    monitorBusy = true;
    try {
      await ensureServers(commonEnvironment, status);
      writeStatus(status);
    } catch (error) {
      if (error?.code !== "AIS_SHUTDOWN_REQUESTED") {
        console.error(`Server monitor: ${error.message}`);
      }
    } finally {
      monitorBusy = false;
    }
  }, 5000);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("exit", releaseLauncherGuardOnExit);
process.on("uncaughtException", (error) => {
  console.error(error.stack || error.message);
  shutdown(1);
});
process.on("unhandledRejection", (error) => {
  console.error(error && (error.stack || error.message) ? error.stack || error.message : error);
  shutdown(1);
});

main().catch((error) => {
  if (error?.code === "AIS_SHUTDOWN_REQUESTED" && shuttingDown) return;
  console.error(`AIS startup failed: ${error.stack || error.message}`);
  shutdown(1);
});

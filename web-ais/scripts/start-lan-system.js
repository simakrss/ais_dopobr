"use strict";

const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { execFileSync, spawn } = require("child_process");

const appRoot = path.resolve(__dirname, "..");
const logRoot = path.join(appRoot, "tmp", "lan-system");
const statusPath = path.join(logRoot, "status.json");
const secretPath = path.join(logRoot, "onlyoffice-jwt-secret.txt");
const composePath = path.join(appRoot, "docker-compose.onlyoffice.yml");
const argumentsLower = new Set(process.argv.slice(2).map((value) => value.toLowerCase()));
const skipDocker = argumentsLower.has("--skip-docker") || argumentsLower.has("-skipdocker");
const runOnce = argumentsLower.has("--once");
const managedChildren = new Map();
let shuttingDown = false;
let monitorBusy = false;

const serverDefinitions = [
  {
    key: "appServer",
    name: "Application server",
    scriptName: "app-server.js",
    host: "127.0.0.1",
    port: 8080,
    environment: {},
  },
  {
    key: "localServer",
    name: "LAN web server",
    scriptName: "local-server.js",
    host: "0.0.0.0",
    port: 8081,
    environment: { AIS_APP_SERVER_ORIGIN: "http://127.0.0.1:8080" },
  },
];

function ensureDirectories() {
  fs.mkdirSync(logRoot, { recursive: true });
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    const output = execFileSync("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: false,
    });
    return output.toLowerCase().includes("node.exe");
  } catch (_error) {
    return false;
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
  console.log(`Этот компьютер: ${status.localUrl || "http://localhost:8081/"}`);
  for (const url of status.lanUrls || []) console.log(`Локальная сеть: ${url}`);
  console.log("Для перезапуска сначала используйте файл «ОСТАНОВИТЬ АИС.cmd».");
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

function listeningPid(port) {
  try {
    const output = execFileSync("netstat.exe", ["-ano", "-p", "tcp"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: false,
    });
    for (const line of output.split(/\r?\n/)) {
      const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
      if (match && Number(match[1]) === port) return Number(match[2]);
    }
  } catch (_error) {
    return 0;
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

async function waitForPort(host, port, timeoutMilliseconds = 12000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await isPortOpen(host, port)) return true;
    await wait(300);
  }
  return false;
}

async function startServer(definition, commonEnvironment) {
  const existingPid = listeningPid(definition.port);
  if (existingPid) {
    console.log(`${definition.name} is already running (PID ${existingPid}, port ${definition.port}).`);
    return existingPid;
  }

  const stdoutPath = path.join(logRoot, `${definition.scriptName}.stdout.log`);
  const stderrPath = path.join(logRoot, `${definition.scriptName}.stderr.log`);
  const stdoutHandle = fs.openSync(stdoutPath, "a");
  const stderrHandle = fs.openSync(stderrPath, "a");
  let child;
  try {
    child = spawn(process.execPath, [path.join(appRoot, definition.scriptName)], {
      cwd: appRoot,
      detached: false,
      windowsHide: false,
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
    managedChildren.delete(definition.key);
    if (!shuttingDown) {
      console.error(`${definition.name} stopped (code ${code ?? "-"}, signal ${signal ?? "-"}).`);
    }
  });

  if (!(await waitForPort("127.0.0.1", definition.port))) {
    throw new Error(`${definition.name} did not open port ${definition.port}. See ${stderrPath}`);
  }
  console.log(`${definition.name} started (PID ${child.pid}, port ${definition.port}).`);
  return child.pid;
}

function startDocumentServices(commonEnvironment) {
  if (skipDocker) {
    console.log("OCR and OnlyOffice launch was skipped by command-line option.");
    return "skipped";
  }
  try {
    execFileSync("docker.exe", ["info", "--format", "{{.ServerVersion}}"], {
      encoding: "utf8",
      timeout: 6000,
      windowsHide: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (_error) {
    console.log("Docker Desktop is not ready. The main AIS servers will continue without OCR/PDF.");
    return "unavailable";
  }

  try {
    console.log("Starting OCR and OnlyOffice containers...");
    try {
      execFileSync(
        "docker.exe",
        ["compose", "-f", composePath, "up", "-d", "--no-build"],
        {
          cwd: appRoot,
          env: { ...process.env, ...commonEnvironment },
          timeout: 120000,
          windowsHide: false,
          stdio: "inherit",
        },
      );
      console.log("OCR and OnlyOffice containers are running from local images.");
      return "running";
    } catch (_error) {
      console.log("Local Docker images need to be prepared. Starting one-time build...");
    }
    execFileSync(
      "docker.exe",
      ["compose", "-f", composePath, "up", "-d", "--build"],
      {
        cwd: appRoot,
        env: { ...process.env, ...commonEnvironment },
        timeout: 300000,
        windowsHide: false,
        stdio: "inherit",
      },
    );
    console.log("OCR and OnlyOffice containers are running.");
    return "running";
  } catch (error) {
    console.error(`OCR/PDF could not be started: ${error.message}`);
    console.log("The main AIS servers will continue without Docker services.");
    return "unavailable";
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
      windowsHide: false,
      stdio: "ignore",
    });
    return "scheduled-task";
  } catch (_error) {
    return "not-configured";
  }
}

function writeStatus(values) {
  fs.writeFileSync(statusPath, `${JSON.stringify(values, null, 2)}\n`, "utf8");
}

async function ensureServers(commonEnvironment, status) {
  for (const definition of serverDefinitions) {
    if (!listeningPid(definition.port)) {
      status[`${definition.key}Pid`] = await startServer(definition, commonEnvironment);
    } else if (!status[`${definition.key}Pid`]) {
      status[`${definition.key}Pid`] = listeningPid(definition.port);
    }
  }
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\nStopping AIS servers started by this window...");
  for (const child of managedChildren.values()) {
    try {
      child.kill();
    } catch (_error) {
      // The child may already be stopped.
    }
  }
  await wait(500);
  process.exit(exitCode);
}

async function main() {
  ensureDirectories();
  const previousStatus = readLauncherStatus();
  if (previousStatus && processExists(Number(previousStatus.launcherPid))) {
    printExistingSystemStatus(previousStatus);
    return;
  }
  const commonEnvironment = { ONLYOFFICE_JWT_SECRET: getOnlyOfficeSecret() };
  const offlineState = readOfflineStateStatus();
  const status = {
    startedAt: new Date().toISOString(),
    computerName: os.hostname(),
    launcherPid: process.pid,
    appServerPid: 0,
    localServerPid: 0,
    localUrl: "http://localhost:8081/",
    lanUrls: lanUrls(),
    internetUrl: "https://edu-plus.ru/lms/",
    documentServices: "unknown",
    deployWatcher: deploymentWatcherStatus(),
    logDirectory: logRoot,
    offlineReady: offlineState.ready,
    sharedStateRevision: offlineState.revision,
    pendingChangeCount: offlineState.pendingCount,
  };

  console.log("\n[AIS] Starting main servers");
  for (const definition of serverDefinitions) {
    status[`${definition.key}Pid`] = await startServer(definition, commonEnvironment);
  }

  console.log("\n[AIS] Starting document services");
  status.documentServices = startDocumentServices(commonEnvironment);
  writeStatus(status);

  console.log("\n[AIS] System is ready");
  console.log("This computer: http://localhost:8081/");
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
  console.log("Keep this window open; it is the transparent AIS server supervisor.");

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
      console.error(`Server monitor: ${error.message}`);
    } finally {
      monitorBusy = false;
    }
  }, 5000);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("uncaughtException", (error) => {
  console.error(error.stack || error.message);
  shutdown(1);
});
process.on("unhandledRejection", (error) => {
  console.error(error && (error.stack || error.message) ? error.stack || error.message : error);
  shutdown(1);
});

main().catch((error) => {
  console.error(`AIS startup failed: ${error.stack || error.message}`);
  shutdown(1);
});

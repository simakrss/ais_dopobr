"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const appRoot = path.resolve(__dirname, "..");
const statusPath = path.join(appRoot, "tmp", "lan-system", "status.json");
const keepDocker = process.argv.slice(2).some((value) => value.toLowerCase() === "--keep-docker");

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
    // The port is already free or netstat is unavailable.
  }
  return 0;
}

function stopProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;
  try {
    const output = execFileSync("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: false,
    });
    if (!output.toLowerCase().includes("node.exe")) return;
    execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      timeout: 10000,
      windowsHide: false,
      stdio: "ignore",
    });
    console.log(`Stopped Node.js process ${pid}.`);
  } catch (_error) {
    // It is safe to continue if the process is already stopped.
  }
}

let status = {};
try {
  status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
} catch (_error) {
  // No active launcher status was found.
}

stopProcess(Number(status.launcherPid));
stopProcess(Number(status.localServerPid));
stopProcess(Number(status.appServerPid));
stopProcess(listeningPid(8081));
stopProcess(listeningPid(8080));

if (!keepDocker) {
  try {
    execFileSync("docker.exe", ["stop", "ais-onlyoffice", "ais-ocr"], {
      timeout: 30000,
      windowsHide: false,
      stdio: "ignore",
    });
    console.log("OCR and OnlyOffice containers stopped.");
  } catch (_error) {
    // Docker may be unavailable or the containers may already be stopped.
  }
}

try {
  fs.unlinkSync(statusPath);
} catch (_error) {
  // The status file may already be absent.
}
console.log("Local AIS is stopped. Automatic internet publication remains enabled.");

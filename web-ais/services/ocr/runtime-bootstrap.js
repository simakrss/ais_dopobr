"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const MODEL_FILES = ["ch_PP-OCRv5_det_mobile.onnx", "ch_ppocr_mobile_v2.0_cls_mobile.onnx", "cyrillic_PP-OCRv5_rec_mobile.onnx"];

function createOcrRuntimeBootstrap({ root = __dirname, env = process.env, platform = process.platform, hostname = os.hostname(), spawnProcess = spawn, now = Date.now, logger = console } = {}) {
  const basePython = String(env.OCR_PYTHON_BINARY || (platform === "win32" ? "python" : "/usr/bin/python3")).trim();
  // A shared installation directory must not reuse another computer's Python environment.
  const machine = crypto.createHash("sha256").update([hostname, platform, process.arch, basePython, root].join("\n")).digest("hex").slice(0, 20);
  const runtimeRoot = path.join(root, "runtime", "neural", machine);
  const statePath = path.join(runtimeRoot, "state.json");
  const managedPython = path.join(runtimeRoot, "venv", platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const fingerprint = crypto.createHash("sha256");
  for (const name of ["requirements.txt", "server.py", "ensure_runtime.py"]) fingerprint.update(fs.readFileSync(path.join(root, name)));
  const revision = fingerprint.digest("hex");

  function readState() {
    try { return JSON.parse(fs.readFileSync(statePath, "utf8")); } catch { return {}; }
  }

  function ready(state = readState()) {
    if (state.revision !== revision || state.status !== "ready") return false;
    if (!["base", "managed"].includes(state.mode)) return false;
    const modelRoot = state.mode === "managed" ? path.join(runtimeRoot, "models") : (env.OCR_MODEL_DIR || path.join(root, "models"));
    return (state.mode === "base" || fs.existsSync(managedPython))
      && MODEL_FILES.every(name => {
        try { return fs.statSync(path.join(modelRoot, name)).size > 0; } catch { return false; }
      });
  }

  function launchSettings() {
    const state = readState();
    if (ready(state) && state.mode === "managed") {
      return { python: managedPython, env: { OCR_MODEL_DIR: path.join(runtimeRoot, "models") } };
    }
    return { python: basePython, env: {} };
  }

  function status() {
    const state = readState();
    if (ready(state)) return { status: "ready" };
    if (state.revision !== revision) return { status: "pending" };
    return { status: state.status || "pending", ...(state.error ? { error: state.error } : {}) };
  }

  function start({ force = false } = {}) {
    if (env.AIS_BOOTSTRAP_SKIP_INSTALL === "1") return "disabled";
    const state = readState();
    const age = now() - Number(state.updatedAt || 0);
    if (state.revision === revision && age >= 0) {
      if (["checking", "installing"].includes(state.status) && age < 45 * 60 * 1000) return state.status;
      if (state.status === "failed" && age < 5 * 60 * 1000) return "failed";
      if (!force && ready(state) && age < 24 * 60 * 60 * 1000) return "ready";
    }
    const recordStartFailure = () => {
      try {
        const failure = { revision, status: "failed", updatedAt: now(), error: "Не удалось запустить установку OCR. Проверьте Python и права записи в служебную папку." };
        const temporary = path.join(runtimeRoot, `state-${process.pid}.tmp`);
        fs.writeFileSync(temporary, JSON.stringify(failure), { mode: 0o600 });
        fs.renameSync(temporary, statePath);
      } catch { /* A read-only installation must not prevent the main AIS from starting. */ }
    };
    let log;
    try {
      fs.mkdirSync(runtimeRoot, { recursive: true });
      log = fs.openSync(path.join(runtimeRoot, "install.log"), "w", 0o600);
      const child = spawnProcess(basePython, [path.join(root, "ensure_runtime.py"), "--runtime-root", runtimeRoot, "--revision", revision], {
        cwd: root, env: {
          ...env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8",
          PATH: `${path.join(root, "runtime", "bin")}${path.delimiter}${env.PATH || ""}`,
          LD_LIBRARY_PATH: `${path.join(root, "runtime", "lib")}${path.delimiter}${env.LD_LIBRARY_PATH || ""}`
        }, detached: true,
        windowsHide: true, stdio: ["ignore", log, log]
      });
      child.on("error", () => {
        recordStartFailure();
        logger.warn("[OCR] Не удалось запустить автоматическую установку. Проверьте наличие Python и журнал OCR.");
      });
      child.unref();
      return "starting";
    } catch {
      recordStartFailure();
      logger.warn("[OCR] Не удалось подготовить дополнительный движок. Проверьте права записи в служебную папку OCR.");
      return "failed";
    } finally {
      if (log !== undefined) fs.closeSync(log);
    }
  }
  return { start, launchSettings, status, runtimeRoot, revision };
}

module.exports = { createOcrRuntimeBootstrap, MODEL_FILES };

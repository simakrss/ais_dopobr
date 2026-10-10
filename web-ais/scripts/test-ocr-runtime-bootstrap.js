"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { createOcrRuntimeBootstrap, MODEL_FILES } = require("../services/ocr/runtime-bootstrap");
const sourceRoot = path.resolve(__dirname, "../services/ocr");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ais-ocr-bootstrap-test-"));
try {
  for (const name of ["requirements.txt", "server.py", "ensure_runtime.py"]) fs.copyFileSync(path.join(sourceRoot, name), path.join(root, name));
  const calls = [];
  const spawnProcess = (...args) => { calls.push(args); const child = new EventEmitter(); child.unref = () => {}; return child; };
  const env = { OCR_PYTHON_BINARY: "test-python" };
  const now = () => 2_000_000_000_000;
  const manager = createOcrRuntimeBootstrap({ root, env, hostname: "machine-one", spawnProcess, now });
  assert.equal(manager.start(), "starting");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "test-python");
  assert.equal(calls[0][2].windowsHide, true);
  assert.equal(calls[0][2].detached, true);
  assert.equal(calls[0][2].stdio[0], "ignore", "No documents are passed to the installer");
  const writeState = value => fs.writeFileSync(path.join(manager.runtimeRoot, "state.json"), JSON.stringify({ revision: manager.revision, updatedAt: now(), ...value }));
  writeState({ status: "installing" });
  assert.equal(manager.start(), "installing");
  assert.equal(calls.length, 1);
  writeState({ status: "failed", error: "Installation failed" });
  assert.equal(manager.start(), "failed");
  assert.equal(manager.launchSettings().python, "test-python");
  writeState({ status: "failed", updatedAt: now() - 301000 });
  assert.equal(manager.start(), "starting", "Retry a failed installation after cooldown");
  const python = path.join(manager.runtimeRoot, "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  fs.mkdirSync(path.dirname(python), { recursive: true }); fs.writeFileSync(python, "fixture");
  const models = path.join(manager.runtimeRoot, "models");
  fs.mkdirSync(models);
  for (const name of MODEL_FILES) fs.writeFileSync(path.join(models, name), "fixture");
  writeState({ status: "ready", mode: "managed" });
  assert.deepEqual(manager.status(), { status: "ready" });
  assert.equal(manager.start(), "ready");
  assert.equal(manager.launchSettings().python, python);
  assert.equal(manager.launchSettings().env.OCR_MODEL_DIR, models);
  assert.equal(manager.start({ force: true }), "starting", "Long-running server rechecks on each startup");
  fs.writeFileSync(path.join(models, MODEL_FILES[0]), "");
  assert.equal(manager.launchSettings().python, "test-python", "Truncated/missing models are not ready");
  assert.equal(manager.start(), "starting");
  const other = createOcrRuntimeBootstrap({ root, env, hostname: "machine-two", spawnProcess, now });
  assert.notEqual(other.runtimeRoot, manager.runtimeRoot);
  const disabled = createOcrRuntimeBootstrap({ root, env: { ...env, AIS_BOOTSTRAP_SKIP_INSTALL: "1" }, spawnProcess });
  assert.equal(disabled.start(), "disabled");
  fs.appendFileSync(path.join(root, "requirements.txt"), "\n# new revision\n");
  assert.notEqual(createOcrRuntimeBootstrap({ root, env }).revision, manager.revision);

  const launcher = fs.readFileSync(path.join(__dirname, "start-lan-system.js"), "utf8");
  const main = launcher.slice(launcher.indexOf("async function main()"));
  assert.ok(main.indexOf("await ensureServers(commonEnvironment, status)") < main.indexOf("status.documentServices = startDocumentServices(commonEnvironment)"), "Large OCR downloads must not block starting the main servers");
  const block = launcher.slice(launcher.indexOf("function verifyOcrContainer("), launcher.indexOf("function startRemoteServicesSupervisor("));
  const execute = failures => {
    const commands = [];
    const context = vm.createContext({ skipDocker: false, process: { env: {} }, appRoot: "app", composePath: "compose", console: { log() {}, error() {} }, ensureOnlyOfficeDocumentFonts() {},
      execFileSync(_exe, args) { commands.push(args); if (args[0] === "exec" && failures-- > 0) throw new Error("missing engine"); }
    });
    vm.runInContext(block, context);
    return { result: context.startDocumentServices({}), commands };
  };
  assert.equal(execute(0).result, "running");
  const repaired = execute(1);
  assert.equal(repaired.result, "running");
  assert.ok(repaired.commands.some(args => args.includes("--force-recreate") && args.at(-1) === "ocr"));
  assert.equal(execute(5).result, "unavailable", "Never report a Tesseract-only container as fully installed");
  console.log("OCR bootstrap: per-machine isolation, startup checks, hidden background install, cooldown, damaged models and Docker repair: OK");
} finally {
  assert.ok(fs.realpathSync(root).startsWith(fs.realpathSync(os.tmpdir()) + path.sep));
  fs.rmSync(root, { recursive: true, force: true });
}

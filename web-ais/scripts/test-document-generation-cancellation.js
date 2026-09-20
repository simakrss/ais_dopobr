"use strict";
// Isolated data, mock conversions/mail, and a private temporary directory only.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const vm = require("node:vm");
const { AsyncLocalStorage } = require("node:async_hooks");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n/g, "\n");
const server = fs.readFileSync(path.join(root, "app-server.js"), "utf8").replace(/\r\n/g, "\n");
function extract(source, name, indent = "") {
  const match = source.match(new RegExp(`^${indent}(?:async )?function ${name}\\([\\s\\S]*?^${indent}}`, "m"));
  assert.ok(match, name); return match[0];
}
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function until(predicate) { for (let i = 0; i < 100 && !predicate(); i++) await tick(); assert.ok(predicate(), "Expected async stage"); }
const clientHelpers = app.slice(app.indexOf("  const activeDocumentGenerationTasks"), app.indexOf("  function showDocumentGenerationNotice"));

function clientFixture(phase) {
  const calls = [], hold = deferred(), reached = deferred();
  const controls = { status: {}, cancel: { addEventListener: (_event, callback) => { controls.cancel.click = callback; } } };
  const indicator = { hidden: true, dataset: {}, setAttribute() {},
    querySelector: (selector) => selector.includes("data-cancel-") ? controls.cancel : controls.status };
  let mounted = false;
  const button = { disabled: false, isConnected: false, classList: { contains: () => false, add() {}, remove() {} },
    getAttribute: () => null, setAttribute() {}, removeAttribute() {} };
  const waitPhase = async (name, value) => {
    if (phase !== name) return value;
    reached.resolve(); await hold.promise; return value;
  };
  const c = vm.createContext({ AbortController, crypto, Map, Set, Error, Promise, queueMicrotask,
    state: { modal: { id: "fake-student" } },
    window: { setTimeout, clearTimeout, AIS_DOCUMENT_WORKFLOW: { getGenerationDateValues: () => ({}) } },
    document: { querySelector: () => mounted ? indicator : null, createElement: () => indicator,
      body: { appendChild() { mounted = true; } } },
    isChecked: Boolean, normalizeDocumentGenerationFormat: () => "pdf", evaluateContractTemplateFields: () => ({}),
    collectContractTemplateSourceValues: () => ({}), ensureGeneratedDocumentFileName: () => "Тест.pdf",
    applyContractTemplateMarkers: (value) => value, getAdditionalDocumentStorageRequests: () => [],
    prepareStudentDocumentEmailRequest: () => phase === "attachment" ? { recipient: "test@example.test", recipientDescription: "Тест" } : null,
    getEffectiveLocalDocumentsMode: () => false,
    resolveDocumentProcessingOrigin: () => waitPhase("origin", "https://example.test"),
    prepareStudentDocumentStorageRequest: () => waitPhase("storage", {}),
    prepareDocumentStorageRequestForEmail: (value) => value,
    documentProcessingApiUrl: (url, origin) => origin + url,
    fetch: async (url, options) => {
      calls.push({ action: "request", url, options });
      if (url.includes("abort-generation") || url.endsWith("/cancel")) return { ok: true };
      if (phase === "conversion") {
        reached.resolve();
        return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
      }
      return { ok: true, headers: { get: () => null }, blob: async () => {
        if (phase === "transfer") {
          reached.resolve();
          return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
        }
        return "synthetic-pdf";
      } };
    },
    getGeneratedDocumentResponseDetails: () => ({ fileName: "Тест.pdf", outputFormat: "pdf" }),
    finishStudentDocumentGeneration: async () => { calls.push({ action: "finish" }); return {}; },
    createStudentDocumentEmailAttachment: () => waitPhase("attachment", {}),
    sendServerEmail: async () => { calls.push({ action: "email" }); return true; },
    addAudit: () => calls.push({ action: "audit" }),
    showDocumentGenerationNotice: (message) => calls.push({ action: "notice", message }),
    alert: (message) => assert.fail(message)
  });
  vm.runInContext(clientHelpers + ["cancelGeneratedDocumentPreview", "downloadStudentDocumentFromTemplate"].map((name) => extract(app, name, "  ")).join("\n"), c);
  const template = { title: "Тест", templatePath: "fixture.docx", documentKind: "education", fields: [] };
  return { c, calls, controls, indicator, hold, reached, button,
    run: () => c.downloadStudentDocumentFromTemplate(template, {}, button, "Ошибка", { skipEmail: phase !== "attachment" }) };
}

async function clientTests() {
  for (const phase of ["origin", "storage", "conversion", "transfer", "attachment"]) {
    const f = clientFixture(phase);
    const operation = f.run();
    await f.reached.promise;
    assert.equal(f.button.disabled, true);
    assert.equal(f.indicator.hidden, false);
    f.controls.cancel.click();
    const result = await operation;
    assert.equal(result.cancelled, true, phase);
    assert.equal(result.generated, false, phase);
    assert.equal(f.button.disabled, false, "Restore the generating button");
    assert.equal(f.indicator.hidden, true);
    assert.equal(f.calls.filter((call) => call.action === "email").length, 0, "No email after cancellation");
    if (phase !== "attachment") assert.equal(f.calls.filter((call) => call.action === "finish").length, 0);
    if (["conversion", "transfer", "attachment"].includes(phase)) {
      const cancel = f.calls.find((call) => call.url?.includes("abort-generation"));
      assert.ok(cancel, "Notify the backend even if a gateway buffers the request");
      const generation = f.calls.find((call) => call.url?.endsWith("student-document"));
      assert.equal(JSON.parse(cancel.options.body).generationId, generation.options.headers["X-Document-Generation-Id"]);
    }
    f.hold.resolve(); await tick();
    assert.equal(f.calls.filter((call) => call.action === "email").length, 0, "Late completion cannot resume cancelled work");
  }
  const f = clientFixture("none");
  assert.equal((await f.run()).generated, true, "Normal generation remains available");
  const parent = f.c.beginDocumentGeneration("Пакет");
  const child = f.c.beginDocumentGeneration("Документ", { signal: f.c.getDocumentGenerationSignal(parent) });
  f.c.getDocumentGenerationSignal(parent).addEventListener("abort", () => f.calls.push({ action: "parent-cancel" }));
  f.c.cancelActiveDocumentGenerations();
  assert.equal(f.c.getDocumentGenerationSignal(child).aborted, true);
  f.c.endDocumentGeneration(child); f.c.endDocumentGeneration(parent);
  const next = f.c.beginDocumentGeneration("Повтор");
  assert.equal(f.c.getDocumentGenerationSignal(next).aborted, false, "A fresh generation is not cancelled by an old request");
  f.c.endDocumentGeneration(next);

  // Stop the entire mixed-operation queue after a cancelled document, not just one student.
  const q = vm.createContext({ getStudentBulkOperationLabel: (operation) => operation.type,
    mergeStudentBulkOperationResult: (result, _operation, current) => { result.success += current.success || 0; } });
  vm.runInContext(extract(app, "executeStudentBulkOperationPlan", "  "), q);
  const executed = [];
  const { result } = await q.executeStudentBulkOperationPlan([{ type: "document" }, { type: "message" }], ["test"], {
    getRecords: () => [{ id: "test" }], runOperation: async (operation) => { executed.push(operation.type); return { cancelled: true }; }
  });
  assert.deepEqual(executed, ["document"]); assert.equal(result.cancelled, true); assert.equal(result.failed, 0);
}

function serverFixture(temp) {
  const c = vm.createContext({ AsyncLocalStorage, AbortController, crypto, path, fs: fsp, fsSync: fs,
    STORAGE_ROOT: temp, setInterval, clearInterval, setTimeout, clearTimeout, Buffer, process,
    readJsonBody: async (req) => req.body,
    sendJson: (res, status, payload) => { res.status = status; res.payload = payload; },
    sendError: (res, status, message) => { res.status = status; res.message = message; }
  });
  vm.runInContext("const documentGenerationContext = new AsyncLocalStorage(); const documentGenerationControllers = new Map();\n" +
    ["generatedDocumentPreviewOwner", "documentGenerationCancelledError", "throwIfDocumentGenerationCancelled",
      "documentGenerationCancellationPath", "runCancellableDocumentRequest", "handleDocumentGenerationCancel"]
      .map((name) => extract(server, name)).join("\n"), c);
  return c;
}
function request(id, body) { return Object.assign(new EventEmitter(), { headers: { "x-document-generation-id": id }, body }); }
const owner = { id: "fake-user", authSessionKey: "fake-session" };
async function serverTests(temp) {
  const c = serverFixture(temp), otherProcess = serverFixture(temp);
  const id = "generation-test-123456789", started = deferred();
  const req = request(id), res = new EventEmitter();
  const operation = c.runCancellableDocumentRequest(req, res, owner, async () => {
    started.resolve();
    await new Promise((resolve) => vm.runInContext("documentGenerationContext.getStore().signal", c).addEventListener("abort", resolve, { once: true }));
    c.throwIfDocumentGenerationCancelled();
    assert.fail("Cancelled operation cannot continue to save");
  });
  await started.promise;
  const foreign = {};
  await otherProcess.handleDocumentGenerationCancel(request("", { generationId: id }), foreign, { ...owner, authSessionKey: "different-session" });
  assert.equal(foreign.status, 200);
  assert.equal(res.status, undefined, "Another session cannot cancel this job");
  await otherProcess.handleDocumentGenerationCancel(request("", { generationId: id }), {}, owner);
  await operation;
  assert.equal(res.status, 499, "CGI cancellation crosses process boundaries");
  assert.equal(req.listenerCount("aborted"), 0);
  assert.equal(res.listenerCount("close"), 0);
  const late = {};
  await c.runCancellableDocumentRequest(request(id), late, owner, () => assert.fail("Cancelled queued/retried request must not start"));
  assert.equal(late.status, 499);
  const invalid = {};
  await c.handleDocumentGenerationCancel(request("", { generationId: "../../escape" }), invalid, owner);
  assert.equal(invalid.status, 400);

  // Owned converter processes only; never kill all Word/LibreOffice processes.
  const children = [], killed = [];
  c.spawn = () => {
    const child = Object.assign(new EventEmitter(), { pid: 100 + children.length, stdout: new PassThrough(), stderr: new PassThrough() });
    children.push(child); return child;
  };
  c.terminateLibreOfficeProcess = async (child) => { killed.push(child.pid); child.emit("close", 1); };
  c.LIBREOFFICE_PDF_CONVERSION_TIMEOUT_MS = 30000;
  c.LIBREOFFICE_PDF_DIAGNOSTIC_LIMIT_BYTES = 2048;
  vm.runInContext(["compactLibreOfficeDiagnostic", "runLibreOfficePdfConversion", "enqueueLibreOfficePdfConversion"].map((name) => extract(server, name)).join("\n") +
    "\nlet libreOfficePdfPendingConversions=0; let libreOfficePdfConversionTail=Promise.resolve(); const LIBREOFFICE_PDF_MAX_PENDING_CONVERSIONS=10; const LIBREOFFICE_PDF_QUEUE_WAIT_TIMEOUT_MS=30000;", c);
  const converterRes = {}, secondRes = {};
  const convert = c.runCancellableDocumentRequest(request("converter-test-1234567"), converterRes, owner, () => c.runLibreOfficePdfConversion("fixture", []));
  const second = c.runCancellableDocumentRequest(request("converter-other-1234567"), secondRes, owner, () => c.runLibreOfficePdfConversion("fixture", []));
  await until(() => children.length === 2);
  await c.handleDocumentGenerationCancel(request("", { generationId: "converter-test-1234567" }), {}, owner);
  await convert;
  assert.equal(converterRes.status, 499); assert.deepEqual(killed, [children[0].pid]);
  children[1].emit("close", 0); await second;
  assert.equal(secondRes.status, undefined);

  const queueHold = deferred(), queueReady = deferred(), queuedRes = {};
  const queueFirst = c.runCancellableDocumentRequest(request("queue-first-123456789"), {}, owner,
    () => c.enqueueLibreOfficePdfConversion(async () => { queueReady.resolve(); await queueHold.promise; }));
  await queueReady.promise;
  const queueSecond = c.runCancellableDocumentRequest(request("queue-second-123456789"), queuedRes, owner,
    () => c.enqueueLibreOfficePdfConversion(() => assert.fail("Cancelled queue entry started a converter")));
  await tick();
  await c.handleDocumentGenerationCancel(request("", { generationId: "queue-second-123456789" }), {}, owner);
  queueHold.resolve(); await queueFirst; await queueSecond;
  assert.equal(queuedRes.status, 499);

  // Native Save As closes only the PowerShell process created by this operation.
  c.buildLocalDocumentSaveDialogLauncher = () => "fixture";
  c.process = { platform: "win32", env: {} };
  vm.runInContext(extract(server, "showLocalDocumentSaveDialog"), c);
  const saveRes = {}, previousChildren = children.length;
  const nativeSave = c.runCancellableDocumentRequest(request("native-save-123456789"), saveRes, owner,
    () => c.showLocalDocumentSaveDialog("C:\\fixture.pdf", "pdf"));
  await until(() => children.length > previousChildren);
  await c.handleDocumentGenerationCancel(request("", { generationId: "native-save-123456789" }), {}, owner);
  await nativeSave; assert.equal(saveRes.status, 499);
  assert.equal(killed.at(-1), children.at(-1).pid);

  // Keep a committed primary file but stop all subsequent copies and success responses.
  const saves = [];
  c.normalizeGeneratedDocumentFormat = (value) => value;
  c.safeDocumentFileName = (value) => value;
  c.generatedDocumentContentType = () => "application/pdf";
  c.sendFile = () => assert.fail("Cancelled save must not return a successful generated file");
  c.saveStudentDocumentLocally = async (_bytes, name) => {
    saves.push(name);
    vm.runInContext("documentGenerationContext.getStore().abort()", c);
    return { saved: true, path: name };
  };
  vm.runInContext(["saveAdditionalGeneratedDocuments", "sendGeneratedDocumentResponse"].map((name) => extract(server, name)).join("\n"), c);
  const saveCopiesRes = {};
  await c.runCancellableDocumentRequest(request("copies-test-123456789"), saveCopiesRes, owner,
    () => c.sendGeneratedDocumentResponse(saveCopiesRes, { bytes: Buffer.from("fixture"), fileName: "primary.pdf", outputFormat: "pdf",
      additionalSaveTargets: [{ fileName: "extra.pdf", outputFormat: "pdf", studentFolder: "fixture", autoSaveLocal: true }] }, { autoSaveLocal: true }));
  assert.equal(saveCopiesRes.status, 499); assert.deepEqual(saves, ["primary.pdf"]);

  c.documentWorkflow = { getGenerationDateValues: () => ({}), getDefinition: () => null };
  c.loadTemplateBytesForRequest = async () => Buffer.from("fixture");
  c.prepareAdditionalDocumentSaveTargets = () => [];
  c.loadContractPhoto = async () => null;
  c.fillDocxMarkers = () => Buffer.from("fixture docx");
  c.convertDocxBytesToPdf = async () => {
    vm.runInContext("documentGenerationContext.getStore().abort()", c);
    throw new Error("Fixture converter was interrupted");
  };
  vm.runInContext(extract(server, "handleContractDocument"), c);
  const fallbackRes = {};
  await c.runCancellableDocumentRequest(request("no-fallback-123456789", { outputFormat: "pdf" }), fallbackRes, owner,
    () => c.handleContractDocument(request("", { outputFormat: "pdf" }), fallbackRes, owner));
  assert.equal(fallbackRes.status, 499, "Cancellation is not a converter failure: never save fallback DOCX");
  assert.deepEqual(saves, ["primary.pdf"]);

  // A close during generation aborts it even without a separate cancel POST.
  const closedRes = new EventEmitter();
  await c.runCancellableDocumentRequest(request("connection-test-1234567"), closedRes, owner, async () => {
    closedRes.emit("close"); c.throwIfDocumentGenerationCancelled();
  });
  assert.equal(closedRes.status, 499);
}

function serveFixture() {
  const http = require("node:http");
  const script = clientHelpers + `
    function showDocumentGenerationNotice(message) { document.getElementById('result').textContent = message; }
    document.getElementById('start').onclick = async function () {
      this.disabled = true;
      const id = beginDocumentGeneration('Тестовый приказ');
      document.getElementById('result').textContent = 'Формирование…';
      try {
        setDocumentGenerationStatus(id, 'Преобразование документа в PDF…');
        await awaitDocumentGenerationStage(id, () => new Promise(() => {}));
      } catch { showDocumentGenerationNotice('Формирование прервано. Файлы не сохранялись.'); }
      finally { endDocumentGeneration(id); this.disabled = false; }
    };
  `;
  const httpServer = http.createServer((req, res) => {
    if (req.url === "/styles.css") { res.setHeader("Content-Type", "text/css"); res.end(fs.readFileSync(path.join(root, "styles.css"))); return; }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><title>Проверка отмены документов</title><body><main class="panel" style="margin:24px;padding:24px"><h1>Отмена формирования</h1><p>Изолированная проверка. Данные слушателей, файлы и почта не используются.</p><button class="primary-button" id="start">Сформировать тестовый документ</button><p id="result" role="status"></p></main><script>${script}</script></body></html>`);
  });
  httpServer.listen(0, "127.0.0.1", () => console.log(`Cancellation UI fixture: http://127.0.0.1:${httpServer.address().port}/`));
}

async function main() {
  const watchdog = setTimeout(() => { console.error("Cancellation tests timed out"); process.exit(1); }, 15000);
  try {
  await clientTests();
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "ais-cancel-test-"));
  try { await serverTests(temp); }
  finally { await fsp.rm(temp, { recursive: true, force: true }); }
  console.log("Document cancellation: client stages, late results, button recovery, batches, CGI markers, session isolation, converter termination and disconnects: OK");
  } finally { clearTimeout(watchdog); }
  if (process.argv.includes("--serve")) serveFixture();
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

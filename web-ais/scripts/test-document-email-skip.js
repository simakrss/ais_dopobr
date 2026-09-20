"use strict";
// Only synthetic documents and recipients; never contacts the application or SMTP.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n?/gu, "\n");
function extract(name) {
  const match = app.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name);
  return match[0];
}
const dialog = extract("showGeneratedDocumentEmailPreview");
const email = {
  subject: "Тестовое письмо", message: "Здравствуйте! Документ во вложении.",
  recipient: "recipient@example.test", recipientDescription: "Тестовый получатель",
  recipientMode: "student"
};
const action = (name) => `[data-action='${name}-generated-document-email-preview']`;

function fixture() {
  const calls = [], abort = new AbortController();
  let mounted = null;
  class Element {
    constructor() {
      this.controls = new Map(); this.events = new Map(); this.dataset = {};
      this.classList = { toggle() {}, contains: () => false, add() {}, remove() {} };
      this.isConnected = true; this.disabled = false;
    }
    querySelector(selector) {
      if (!this.controls.has(selector)) {
        const element = new Element();
        element.value = selector.includes("subject-input") ? email.subject : email.message;
        this.controls.set(selector, element);
      }
      return this.controls.get(selector);
    }
    querySelectorAll(selector) { return [this.querySelector(selector)]; }
    addEventListener(name, handler) { this.events.set(name, handler); }
    removeEventListener(name) { this.events.delete(name); }
    click() { return this.events.get("click")?.({ target: this }); }
    focus() {}
    remove() { if (mounted === this) mounted = null; this.isConnected = false; }
    getAttribute() { return null; }
    setAttribute() {}
    removeAttribute() {}
  }
  const button = new Element();
  const c = vm.createContext({
    HTMLElement: Element, AbortController, queueMicrotask,
    window: { setTimeout, clearTimeout, AIS_DOCUMENT_WORKFLOW: { getGenerationDateValues: () => ({}) } },
    document: {
      activeElement: button, querySelector: () => mounted, createElement: () => new Element(),
      body: { appendChild(element) { mounted = element; } }
    },
    requestAnimationFrame: (fn) => fn(),
    escapeHtml: (value) => String(value), escapeAttr: (value) => String(value),
    documentEmailMessageContainsHtml: () => false,
    buildGeneratedDocumentEmailPreviewHtml: (message) => message,
    normalizeServerEmailSubject: (value) => String(value || "").trim(),
    chooseUnsavedChangesAction: async () => { calls.push("unsaved-dialog"); return "cancel"; },
    state: { modal: { id: "fixture-student" } },
    beginDocumentGeneration: () => "fixture-generation",
    endDocumentGeneration: () => calls.push("end"),
    getDocumentGenerationSignal: () => abort.signal,
    getDocumentGenerationRequestOptions: () => ({ signal: abort.signal }),
    throwIfDocumentGenerationCancelled: () => abort.signal.throwIfAborted(),
    setDocumentGenerationStatus() {},
    awaitDocumentGenerationStage: async (_id, operation) => operation(),
    isChecked: Boolean, normalizeDocumentGenerationFormat: () => "pdf",
    normalizeDocumentEmailDeliveryMode: () => "student",
    getStudentAttestationDocumentUnavailableReason: () => "",
    prepareStudentAttestationDocumentRecord: (record) => record,
    loadStudentProtocolEmailTemplate: async (template) => template,
    evaluateContractTemplateFields: () => ({}), collectContractTemplateSourceValues: () => ({}),
    ensureGeneratedDocumentFileName: () => "Тест.pdf", applyContractTemplateMarkers: (value) => value,
    getAdditionalDocumentStorageRequests: () => [], getEffectiveLocalDocumentsMode: () => true,
    prepareStudentDocumentEmailRequest: () => ({ ...email }),
    resolveDocumentProcessingOrigin: async () => "https://example.test",
    requestGeneratedDocumentPreview: async () => ({ blob: "synthetic-pdf", previewToken: "fixture-token" }),
    showGeneratedDocumentPreview: async () => true,
    cancelGeneratedDocumentPreview: async () => calls.push("cancel-preview"),
    prepareStudentDocumentStorageRequest: async () => ({ promptLocalSave: true }),
    documentProcessingApiUrl: (url) => url,
    fetchWithTimeout: async (url, options, _timeout, _message, consume) => {
      calls.push({ request: url, body: JSON.parse(options.body) });
      return consume({ ok: true, headers: { get: () => null }, blob: async () => "synthetic-pdf" });
    },
    getGeneratedDocumentResponseDetails: () => ({ fileName: "Тест.pdf", outputFormat: "pdf" }),
    finishStudentDocumentGeneration: async () => { calls.push("saved"); return { localSaveResult: { saved: true } }; },
    createStudentDocumentEmailAttachment: async () => { calls.push("attachment"); return {}; },
    sendServerEmail: async (request) => { calls.push({ sent: request }); return true; },
    markStudentContractEmailSent: () => calls.push("sent-status"),
    addAudit: () => calls.push("audit"),
    showDocumentGenerationNotice: (message) => calls.push({ notice: message }),
    alert: (message) => calls.push({ alert: message })
  });
  vm.runInContext([
    dialog, extract("prepareDocumentStorageRequestForEmail"), extract("downloadStudentDocumentFromTemplate")
  ].join("\n"), c);
  return {
    c, calls, button, abort, get modal() { return mounted; },
    run: (kind = "contract") => c.downloadStudentDocumentFromTemplate({
      title: "Тестовый документ", templatePath: "fixture.docx", documentKind: kind,
      previewBeforeGeneration: true
    }, { id: "fixture-student" }, button, "Ошибка")
  };
}

async function waitForDialog(test) {
  for (let i = 0; i < 50 && !test.modal; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(test.modal, "Email preview must open");
}

async function tests() {
  assert.match(dialog, /data-action="skip-generated-document-email-preview"[^>]*>Пропустить</u);
  for (const kind of ["contract", "education", "employeeContract", "studentAttestationProtocol", "workflow"]) {
    const test = fixture();
    const operation = test.run(kind);
    await waitForDialog(test);
    assert.equal(test.calls.includes("saved"), false, "Do not save before the preview decision");
    // Skipping must also work while editing an empty/invalid email; do not ask to apply it.
    const subject = test.modal.querySelector("[data-generated-document-email-subject-input]");
    subject.value = ""; subject.events.get("input")();
    test.modal.querySelector(action("skip")).click();
    const result = await operation;
    assert.equal(result.generated, true, kind);
    assert.equal(result.cancelled, undefined, kind);
    assert.equal(result.emailSkipped, true, kind);
    assert.equal(result.emailed, false, kind);
    assert.equal(result.emailRecipientMode, "off", kind);
    assert.equal(result.storageResult.localSaveResult.saved, true);
    assert.equal(test.calls.filter((call) => call.request?.endsWith("/finalize")).length, 1);
    assert.equal(test.calls.find((call) => call.request).body.previewToken, "fixture-token");
    assert.equal(test.calls.find((call) => call.request).body.promptLocalSave, true);
    for (const call of ["cancel-preview", "attachment", "sent-status", "unsaved-dialog"]) {
      assert.equal(test.calls.includes(call), false, call);
    }
    assert.equal(test.calls.some((call) => call.sent || call.alert), false);
    assert.equal(test.button.disabled, false);
    assert.equal(test.modal, null);
    // The same session can proceed to the next document and still send its email normally.
    const next = test.run();
    await waitForDialog(test);
    test.modal.querySelector(action("confirm")).click();
    const sent = await next;
    assert.equal(sent.emailed, true);
    assert.equal(sent.emailSkipped, false);
    assert.equal(test.calls.filter((call) => call.sent).length, 1);
    assert.equal(test.calls.includes("sent-status"), true);
  }
  for (const decision of ["cancel", "abort"]) {
    const test = fixture(), operation = test.run();
    await waitForDialog(test);
    if (decision === "abort") test.abort.abort();
    else test.modal.querySelector(action("cancel")).click();
    const result = await operation;
    assert.equal(result.cancelled, true);
    assert.equal(result.generated, false);
    assert.equal(test.calls.includes("saved"), false);
    assert.equal(test.calls.some((call) => call.sent), false);
  }
  console.log("Document email skip: real preview/pipeline, save without SMTP/status, next document, close and abort: OK");
}

if (process.argv.includes("--serve")) {
  const http = require("node:http");
  const helpers = ["documentEmailMessageContainsHtml", "buildGeneratedDocumentEmailPreviewHtml"].map(extract).join("\n");
  const page = `<!doctype html><html lang="ru"><meta charset="utf-8"><link rel="stylesheet" href="/styles.css">
    <body><button id="open" class="primary-button">Просмотр тестового письма</button><p id="result"></p>
    <script>const escapeHtml=(v)=>String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    const escapeAttr=escapeHtml; const normalizeServerEmailSubject=(v)=>String(v).trim();
    const chooseUnsavedChangesAction=async()=>"discard";
    ${helpers}\n${dialog}
    document.querySelector("#open").onclick=async()=>{const result=await showGeneratedDocumentEmailPreview(${JSON.stringify(email)}, {title:"Тестовый документ",fileName:"Тест.pdf"});
    document.querySelector("#result").textContent=result?.skipEmail?"Отправка пропущена. Документ можно сохранить.":result?"Отправка подтверждена (тест, письмо не отправляется).":"Операция отменена.";};
    </script></body></html>`;
  http.createServer((req, res) => {
    res.setHeader("Content-Type", req.url === "/styles.css" ? "text/css; charset=utf-8" : "text/html; charset=utf-8");
    res.end(req.url === "/styles.css" ? fs.readFileSync(path.join(root, "styles.css")) : page);
  }).listen(0, "127.0.0.1", function () { console.log(`Fixture: http://127.0.0.1:${this.address().port}/`); });
} else {
  tests().catch((error) => { console.error(error); process.exitCode = 1; });
}

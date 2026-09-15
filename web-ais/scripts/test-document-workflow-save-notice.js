"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const app = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8").replace(/\r\n/g, "\n");

function extract(name) {
  const match = new RegExp(`^  (?:async )?function ${name}\\(`, "m").exec(app);
  assert.ok(match, name);
  const rest = app.slice(match.index + match[0].length);
  const next = /^  (?:async )?function /m.exec(rest);
  assert.ok(next, name);
  return app.slice(match.index, match.index + match[0].length + next.index);
}

async function run(scenario = {}) {
  const events = [], notices = [], alerts = [];
  const headers = new Map(Object.entries(scenario.headers || {"X-Local-Document-Saved": "true"}));
  if (scenario.report !== undefined) headers.set("X-Additional-Documents-Result", encodeURIComponent(JSON.stringify(scenario.report)));
  const storage = scenario.storage || {promptLocalSave: true};
  const blob = new Blob(["test document"], {type: "application/pdf"});
  const context = {
    window: {AIS_DOCUMENT_WORKFLOW: {getGenerationDateValues: () => ({})}},
    state: {},
    isChecked: Boolean,
    beginDocumentGeneration: () => { events.push("start"); return "test-task"; },
    setDocumentGenerationStatus: () => {},
    endDocumentGeneration: () => events.push("end"),
    normalizeDocumentGenerationFormat: value => value || "pdf",
    ensureGeneratedDocumentFileName: value => value,
    applyContractTemplateMarkers: value => value,
    getAdditionalDocumentStorageRequests: () => new Array(scenario.copies || 0).fill({}),
    getEffectiveLocalDocumentsMode: () => true,
    resolveDocumentProcessingOrigin: async () => "test-origin",
    requestGeneratedDocumentPreview: async () => ({previewToken: "test-preview"}),
    showGeneratedDocumentPreview: async () => scenario.confirmPreview !== false,
    cancelGeneratedDocumentPreview: async () => events.push("cancel-preview"),
    prepareStudentDocumentStorageRequest: async () => storage,
    prepareDocumentStorageRequestForEmail: value => value,
    documentProcessingApiUrl: value => value,
    fetchWithTimeout: async (_url, _options, _timeout, _message, consume) => {
      events.push("response");
      if (scenario.error) throw new Error("Тестовая ошибка формирования");
      return consume({
        ok: true,
        headers: {get: name => headers.get(name) ?? null},
        blob: async () => { events.push("blob"); return blob; }
      });
    },
    getGeneratedDocumentResponseDetails: () => ({fileName: "Приказ.pdf", outputFormat: "pdf", conversionFallback: Boolean(scenario.fallback)}),
    showDocumentGenerationNotice: (message, kind) => { events.push("notice:" + kind); notices.push({message, kind}); },
    alert: message => alerts.push(message),
    addAudit: () => events.push("audit"),
    downloadBlob: () => events.push("download"),
    showYandexDocumentSaveWarning: () => {},
    openGeneratedDocumentAfterGeneration: async () => {
      if (scenario.openFailed) context.showDocumentGenerationNotice("Не удалось открыть папку", "warning");
    }
  };
  vm.createContext(context);
  for (const name of ["readLocalDocumentSaveResult", "readYandexDocumentSaveResult", "showDocumentWorkflowSaveSuccess", "finishStudentDocumentGeneration", "downloadStudentDocumentFromTemplate"]) {
    vm.runInContext(extract(name), context);
  }
  const result = await context.downloadStudentDocumentFromTemplate({
    title: "Приказ", templatePath: "test.docx", fileNameTemplate: "Приказ.pdf",
    generationFormat: "pdf", previewBeforeGeneration: scenario.preview === true,
    openAfterGeneration: scenario.openFailed === true
  }, {id: "test"}, null, "Ошибка", {
    fieldValues: {}, sourceValues: {}, skipEmail: true,
    ...(scenario.nonWorkflow ? {} : {workflow: {fields: [], programs: []}})
  });
  assert.equal(events.at(-1), "end", "Generation indicator must finish on every path");
  const successes = notices.filter(notice => notice.kind === "success");
  return {result, events, notices, successes, alerts};
}

async function main() {
  let check = await run();
  assert.equal(check.successes.length, 1);
  assert.equal(check.successes[0].message, "Документ «Приказ.pdf» успешно сформирован и сохранён.");
  assert.ok(check.events.indexOf("blob") < check.events.indexOf("notice:success"), "No success before the final response is read");
  assert.ok(check.result.storageResult.localSaveResult.saved);
  assert.ok(!check.events.includes("download"));

  check = await run({preview: true, copies: 2, report: {saved: 2, failed: [], cancelled: false}, headers: {
    "X-Local-Document-Saved": "true", "X-Local-Document-Path": encodeURIComponent("Y:\\Документы\\Другое имя.pdf")
  }});
  assert.equal(check.successes.length, 1);
  assert.match(check.successes[0].message, /«Другое имя.pdf»/);
  assert.match(check.successes[0].message, /Дополнительные копии сохранены: 2/);

  check = await run({storage: {saveToYandexDisk: true}, headers: {
    "X-Yandex-Disk-Saved": "true", "X-Yandex-Disk-Path": encodeURIComponent("Документы/ИАК.pdf")
  }});
  assert.equal(check.successes.length, 1);
  assert.match(check.successes[0].message, /«ИАК.pdf»/);

  for (const scenario of [
    {preview: true, confirmPreview: false},
    {headers: {"X-Local-Document-Cancelled": "true"}},
    {headers: {"X-Local-Document-Saved": "false", "X-Local-Document-Error": "Папка недоступна"}},
    {headers: {}},
    {storage: {}}, // Browser download alone cannot confirm a saved file.
    {storage: {saveToYandexDisk: true}, headers: {"X-Yandex-Disk-Saved": "false"}},
    {error: true},
    {copies: 1},
    {copies: 1, report: {saved: 0, failed: [{index: 0, error: "Ошибка копии"}]}},
    {copies: 2, report: {saved: 1, failed: []}},
    {copies: 1, report: {saved: 1}},
    {copies: 1, report: {saved: 1, failed: [], cancelled: true}},
    {headers: {"X-Local-Document-Saved": "true", "X-Local-Document-Revealed": "false"}},
    {fallback: true},
    {nonWorkflow: true}
  ]) {
    check = await run(scenario);
    assert.equal(check.successes.length, 0, "False success: " + JSON.stringify(scenario));
  }
  check = await run({openFailed: true});
  assert.equal(check.notices.at(-1).kind, "warning", "Success must not replace a later cloud-folder warning");
  assert.match(extract("showDocumentGenerationNotice"), /escapeHtml\(message\)/, "Filenames in notices must be escaped");
  assert.match(extract("showDocumentGenerationNotice"), /setAttribute\("role", "status"\)/);
  console.log("Workflow save notices: confirmed local/WebDAV saves, selected names, all copies, preview/save cancellation, failures, warnings and browser-download distinction: OK");
}
main().catch(error => { console.error(error); process.exitCode = 1; });

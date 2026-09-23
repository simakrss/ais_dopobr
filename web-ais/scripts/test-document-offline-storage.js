"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const server = fs.readFileSync(path.join(root, "app-server.js"), "utf8");
const workflow = require("../document-workflow.js");
function extract(source, name, indent = "") {
  const start = new RegExp(`^${indent}(?:async )?function ${name}\\(`, "m").exec(source);
  assert.ok(start, name);
  const rest = source.slice(start.index + start[0].length);
  const end = new RegExp(`^${indent}(?:async )?function `, "m").exec(rest);
  assert.ok(end, name);
  return source.slice(start.index, start.index + start[0].length + end.index);
}
function inject(context, source, names, indent = "") {
  vm.createContext(context);
  for (const name of names) vm.runInContext(extract(source, name, indent), context);
  return context;
}
async function main() {
  const state = { data: { meta: { openDocumentsLocally: true, localDocumentsAvailable: true, yandexDiskAutoSave: false } } };
  const originalSettings = JSON.stringify(state);
  const service = { capabilities: { appServerAvailable: false, localDocumentsAvailable: false } };
  const client = inject({
    state, localDocumentServicesState: service,
    downloadsFolderTemplateMarker: "#Загрузки#",
    getDefaultDocumentSaveFolderTemplate: template => template.saveFolderTemplate || "Документы",
    getStudentDocumentStorageFolder: () => "Слушатели/Тест/Документы",
    getContractDocumentsFolder: () => "Сотрудники/Тест/Документы",
  }, app, ["getOpenDocumentsLocally", "isLocalDocumentsAvailable", "getEffectiveLocalDocumentsMode",
    "getStudentDocumentStorageRequest", "getEmployeeDocumentStorageRequest", "prepareDocumentStorageRequestForEmail",
    "readLocalDocumentSaveResult", "readYandexDocumentSaveResult"], "  ");
  assert.equal(client.getEffectiveLocalDocumentsMode(), false, "Unavailable service overrides stale availability, not settings");
  assert.equal(client.getStudentDocumentStorageRequest({name: "Тест"}).saveToYandexDisk, true);
  assert.equal(client.getEmployeeDocumentStorageRequest({name: "Тест"}).saveToYandexDisk, true);
  const stale = { autoSaveLocal: true, promptLocalSave: false, studentFolder: "Сотрудники/Тест/Документы" };
  const rerouted = client.prepareDocumentStorageRequestForEmail(stale, null);
  assert.equal(rerouted.saveToYandexDisk, true);
  assert.equal(rerouted.autoSaveLocal, false);
  assert.equal(stale.autoSaveLocal, true, "Do not mutate the caller's request");
  assert.equal(client.getStudentDocumentStorageRequest({}, {saveFolderTemplate: "#Загрузки#"}).saveToYandexDisk, false);
  service.capabilities = { appServerAvailable: true, localDocumentsAvailable: true };
  assert.equal(client.getEffectiveLocalDocumentsMode(), true, "Automatically recover local mode on the next successful probe");
  assert.equal(client.getStudentDocumentStorageRequest({}).promptLocalSave, true);
  service.capabilities.localDocumentsAvailable = false;
  assert.equal(client.getEmployeeDocumentStorageRequest({}).saveToYandexDisk, true);
  assert.equal(JSON.stringify(state), originalSettings, "Temporary outages never persist settings changes");

  const events = [];
  let available = false, localError = null, cloudError = null, cancelled = false, aborted = false, headers;
  const settings = { openDocumentsLocally: true };
  const ctx = inject({
    Buffer, path, ROOT: root, documentWorkflow: workflow, serverSettings: settings,
    throwIfDocumentGenerationCancelled: () => { if (aborted) throw new Error("cancelled"); },
    getLocalSystemDocumentsAvailability: async () => ({available}),
    normalizeGeneratedDocumentFormat: value => value === "docx" ? "docx" : "pdf",
    safeDocumentFileName: workflow.safeOutputFileName,
    generatedDocumentContentType: value => value === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    saveStudentDocumentLocally: async (bytes, name, body) => {
      events.push(["local", name, bytes.toString(), body.studentFolder]);
      if (localError) throw localError;
      return {saved: true, path: "Y:/" + name};
    },
    promptAndSaveStudentDocumentLocally: async (bytes, name, body) => {
      if (cancelled) return {cancelled: true};
      return ctx.saveStudentDocumentLocally(bytes, name, body);
    },
    uploadStudentDocumentToYandexDisk: async (bytes, name, body) => {
      events.push(["cloud", name, bytes.toString(), body.studentFolder, body.outputFormat]);
      if (cloudError) throw cloudError;
      return "/Документы/" + name;
    },
    sendFile: (_res, _status, _bytes, _name, _type, extra) => { headers = extra; },
    convertDocxBytesToPdf: async () => { throw new Error("No converter"); },
    resolveLocalTemplatePathFromWebDavSource: () => "Y:/template.docx",
    loadLocalTemplateBytes: async () => { events.push(["template-local"]); if (localError) throw localError; return Buffer.from("LOCAL"); },
    loadRemoteTemplateBytes: async url => { events.push(["template-cloud", url]); return Buffer.from("CLOUD"); },
    loadTemplateBytes: async () => Buffer.from("BUNDLED"),
    resolveLocalDocumentsPath: source => "Y:/" + source,
  }, server, ["isUnavailableDocumentPathError", "isLocalDocumentStorageAvailable", "prepareAdditionalDocumentSaveTargets",
    "saveAdditionalGeneratedDocuments", "sendGeneratedDocumentResponse", "loadTemplateBytesForRequest"]);
  const generated = { bytes: Buffer.from("FINAL-DOCX"), editableBytes: Buffer.from("EDITED-DOCX"), outputFormat: "docx", fileName: "Документ.docx" };
  const body = { autoSaveLocal: true, studentFolder: "Слушатели/Тест/Документы" };
  const send = async (request = body, document = generated) => {
    events.length = 0;
    await ctx.sendGeneratedDocumentResponse({}, document, request);
    return events.map(value => value[0]);
  };
  assert.deepEqual(await send(), ["cloud"]);
  assert.equal(headers["X-Yandex-Disk-Saved"], "true");
  assert.equal(client.readYandexDocumentSaveResult({headers: new Headers(headers)}, false).saved, true, "Read backend fallback even if the client requested local storage");
  assert.equal(events[0][3], body.studentFolder);
  available = true;
  assert.deepEqual(await send(), ["local"]);
  assert.equal(headers["X-Yandex-Disk-Saved"], undefined);
  settings.openDocumentsLocally = false;
  assert.deepEqual(await send(), ["cloud"]);
  settings.openDocumentsLocally = true;
  for (const code of ["ENOENT", "EACCES", "EPERM", "ENOTDIR", "ENETUNREACH"]) {
    localError = Object.assign(new Error("Unavailable path"), { code });
    assert.deepEqual(await send(), ["local", "cloud"], code);
  }
  cloudError = new Error("Cloud unavailable");
  await send();
  assert.equal(headers["X-Yandex-Disk-Saved"], "false");
  assert.match(decodeURIComponent(headers["X-Yandex-Disk-Error"]), /Cloud unavailable/);
  cloudError = null;
  localError = new Error("Invalid path");
  assert.deepEqual(await send(), ["local"], "Validation failures must not silently save elsewhere");
  localError = null; cancelled = true;
  assert.deepEqual(await send({promptLocalSave: true, saveToYandexDisk: true}), []);
  assert.equal(headers["X-Local-Document-Cancelled"], "true");
  cancelled = false; aborted = true;
  await assert.rejects(send(), /cancelled/);
  assert.equal(events.length, 0);
  aborted = false;
  assert.deepEqual(await send({useBrowserDownloads: true}), [], "Explicit downloads perform no storage writes");

  const remote = "Документы/Шаблон.docx";
  available = false;
  events.length = 0;
  assert.equal((await ctx.loadTemplateBytesForRequest({preferLocalTemplate: true, templateUrl: remote, templatePath: "old.docx"})).toString(), "CLOUD");
  assert.deepEqual(events, [["template-cloud", remote]]);
  available = true;
  localError = Object.assign(new Error("Missing"), {code: "ENOENT"});
  events.length = 0;
  await ctx.loadTemplateBytesForRequest({preferLocalTemplate: true, templateUrl: remote});
  assert.deepEqual(events, [["template-local"], ["template-cloud", remote]]);
  localError = new Error("Invalid template");
  await assert.rejects(ctx.loadTemplateBytesForRequest({preferLocalTemplate: true, templateUrl: remote}), /Invalid template/);
  localError = null; available = false;
  const definition = workflow.definitions[0];
  events.length = 0;
  await ctx.loadTemplateBytesForRequest({preferLocalTemplate: true, templatePath: definition.templatePath});
  assert.deepEqual(events, [["template-cloud", definition.localTemplateSource]]);
  const extra = {fileName: "Копия.pdf", outputFormat: "pdf", autoSaveLocal: true, studentFolder: "Документы/Копии"};
  await send(body, {...generated, extraHeaders: {"X-Document-Conversion-Fallback": "true"}, additionalSaveTargets: [extra]});
  assert.deepEqual(events.map(value => value[0]), ["cloud", "cloud"]);
  assert.equal(events[1][1], "Копия.docx");
  assert.equal(events[1][2], "EDITED-DOCX", "Use final edited bytes for additional copies");
  assert.equal(JSON.parse(decodeURIComponent(headers["X-Additional-Documents-Result"])).failed.length, 0);

  // Execute the real handler with in-memory storage and a failed PDF converter.
  let stored, response, conversionCalls = 0;
  Object.assign(ctx, {
    readJsonBody: async req => req.body,
    assertGeneratedDocumentPreviewRequestAllowed: async () => {},
    applyCustomDocumentPropertyFormulas: (_bytes, values) => values,
    loadContractPhoto: async () => null,
    fillDocxMarkers: () => Buffer.from("FILLED-DOCX"),
    convertDocxBytesToPdf: async () => { conversionCalls++; throw new Error("PDF unavailable"); },
    registerGeneratedDocumentPreview: async doc => { stored = doc; return "test-token"; },
    cancelGeneratedDocumentPreview: async () => {},
    generatedDocumentRequestBackend: () => "server",
    sendFile: (_res, status, bytes, name, type, extra) => { response = {status, bytes, name, type, extra}; },
    sendError: (_res, _status, message) => { throw new Error(message); },
  });
  vm.runInContext(extract(server, "handleContractDocument"), ctx);
  for (const outputFormat of ["pdf", "docx"]) {
    conversionCalls = 0; events.length = 0;
    await ctx.handleContractDocument({body: {templateUrl: remote, outputFormat, previewOnly: true, fileName: "Тест"}}, {}, {});
    assert.equal(response.status, 200);
    assert.equal(response.name, "Тест.docx");
    assert.equal(response.extra["X-Document-Preview-Token"], "test-token");
    assert.equal(response.extra["X-Document-Editor-Available"], "false");
    assert.equal(stored.bytes.toString(), "FILLED-DOCX");
    assert.equal(conversionCalls, 1, "Do not repeat failed conversion for preview");
    assert.equal(events.length, 0, "Preview never saves a file");
  }
  const previewClient = inject({
    getDocumentGenerationRequestOptions: () => ({}), documentProcessingApiUrl: route => route,
    normalizeDocumentGenerationFormat: value => value === "docx" ? "docx" : "pdf",
    fetchWithTimeout: async (_url, options, _timeout, _message, parse) => {
      assert.equal(JSON.parse(options.body).autoSaveLocal, false);
      return parse(new Response(response.bytes, {headers: {...response.extra, "Content-Type": response.type}}));
    },
  }, app, ["getGeneratedDocumentResponseDetails", "requestGeneratedDocumentPreview"], "  ");
  const preview = await previewClient.requestGeneratedDocumentPreview({fileName: "Тест.pdf", outputFormat: "pdf"}, "server");
  assert.equal(preview.previewAvailable, false);
  assert.equal(preview.editorAvailable, false);
  assert.equal(preview.outputFormat, "docx");
  assert.equal(preview.fileName, "Тест.docx");
  assert.equal(await preview.blob.text(), "FILLED-DOCX");
  console.log("Offline generation/storage: local recovery, cloud saves, cancellation, errors, exact template fallback, copies and DOCX confirmation passed.");
}
function serveFixture() {
  const http = require("node:http");
  const modalSource = extract(app, "showGeneratedDocumentPreview", "  ");
  const fixture = http.createServer((req, res) => {
    if (req.url === "/styles.css") { res.setHeader("Content-Type", "text/css"); res.end(fs.readFileSync(path.join(root, "styles.css"))); return; }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Проверка резервной генерации</title><link rel="stylesheet" href="/styles.css">
      <button id="open">Сформировать без сервера</button><button id="readonly">Только просмотр</button><p id="result" role="status"></p><p id="download"></p><script>
      const normalizeDocumentGenerationFormat = value => value === 'docx' ? 'docx' : 'pdf';
      const escapeHtml = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
      const escapeAttr = escapeHtml;
      const downloadBlob = (name, blob) => { document.getElementById('download').textContent = 'Файл для проверки: '+name+' ('+blob.size+' байт)'; };
      ${modalSource}
      async function openFixture(readOnly) {
        document.getElementById('result').textContent = '';
        const result = await showGeneratedDocumentPreview(new Blob(['test DOCX'], {type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}), {title:'Диплом о переподготовке',fileName:'Диплом_Тест.docx',outputFormat:'docx',previewAvailable:false,editorAvailable:false,readOnly});
        document.getElementById('result').textContent = result ? 'Подтверждено: сохранить на Яндекс Диск' : 'Отменено: сохранения нет';
      }
      document.getElementById('open').onclick=()=>openFixture(false);
      document.getElementById('readonly').onclick=()=>openFixture(true);
      window.addEventListener('error', event => { document.getElementById('result').textContent = 'ERROR: '+event.message; });
      </script></html>`);
  });
  fixture.listen(0, "127.0.0.1", () => console.log(`Fixture: http://127.0.0.1:${fixture.address().port}`));
}
main().then(() => { if (process.argv.includes("--serve")) serveFixture(); }).catch(error => { console.error(error); process.exitCode = 1; });

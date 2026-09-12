"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const workflow = require("../document-workflow.js");
const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n/g, "\n");
const server = fs.readFileSync(path.join(root, "app-server.js"), "utf8").replace(/\r\n/g, "\n");
function extract(source, name, indent = "") {
  const start = new RegExp(`^${indent}(?:async )?function ${name}\\(`, "m").exec(source);
  assert.ok(start, name);
  const rest = source.slice(start.index + start[0].length);
  const end = new RegExp(`^${indent}(?:async )?function `, "m").exec(rest);
  assert.ok(end, name);
  return source.slice(start.index, start.index + start[0].length + end.index);
}
const plain = value => JSON.parse(JSON.stringify(value));
async function main() {
  const dateValues = workflow.getGenerationDateValues(new Date("2026-08-31T21:01:00Z"));
  assert.equal(dateValues["Месяц и год генерации"], "09.2026", "Month rollover uses Moscow time");
  assert.equal(workflow.getGenerationDateValues(new Date("2026-12-31T21:01:00Z"))["Месяц и год генерации"], "01.2027");
  assert.equal(workflow.safeOutputFileName("ПРИКАЗ об утверждении состава ИАК_09.2026.docx", "pdf"), "ПРИКАЗ об утверждении состава ИАК_09.2026.pdf");
  assert.equal(workflow.safeOutputFileName("Приказ о наборе 912-26/НАБОР", "pdf"), "Приказ о наборе 912-26-НАБОР.pdf");
  assert.equal(workflow.safeOutputFileName("CON", "docx"), "_CON.docx");
  assert.ok(!/[\\/]/.test(workflow.safeOutputFileName("../../escape", "pdf")));
  assert.equal(workflow.normalizeAdditionalSaveTargets(new Array(20).fill({})).length, 10);

  let local = true, conversionCalls = 0;
  const saves = [], sent = [];
  const context = {
    Buffer, documentWorkflow: workflow,
    normalizeGeneratedDocumentFormat: value => value === "docx" ? "docx" : "pdf",
    safeDocumentFileName: (value, format) => workflow.safeOutputFileName(value, format),
    generatedDocumentContentType: value => `application/${value}`,
    saveStudentDocumentLocally: async (bytes, name, body) => {
      if (body.studentFolder === "fail") throw new Error("Папка недоступна");
      saves.push({bytes: Buffer.from(bytes), name, body});
      return {saved: true, path: body.studentFolder + "/" + name};
    },
    uploadStudentDocumentToYandexDisk: async (bytes, name, body) => {
      saves.push({bytes: Buffer.from(bytes), name, body, cloud: true});
      return body.studentFolder + "/" + name;
    },
    promptAndSaveStudentDocumentLocally: async () => ({cancelled: true}),
    convertDocxBytesToPdf: async bytes => { conversionCalls++; return Buffer.from("PDF:" + bytes); },
    removeBlankInteriorPdfPages: async bytes => bytes,
    sendFile: (...args) => sent.push(args)
  };
  vm.createContext(context);
  for (const name of ["prepareAdditionalDocumentSaveTargets", "saveAdditionalGeneratedDocuments", "sendGeneratedDocumentResponse"]) {
    vm.runInContext(extract(server, name), context);
  }
  const targetRequest = (definition, overrides = {}) => ({
    fileNameTemplate: definition.additionalSaveTargets[0].fileNameTemplate,
    studentFolder: definition.saveFolderTemplate,
    outputFormat: "pdf", autoSaveLocal: true, ...overrides
  });
  const definition = workflow.definitions[0];
  const targets = context.prepareAdditionalDocumentSaveTargets({additionalSaveTargets: [targetRequest(definition)]}, {
    "Дата документа": "2024-01-01", ...dateValues
  });
  assert.equal(targets[0].fileName, "ПРИКАЗ об утверждении состава ИАК_09.2026.pdf");
  assert.throws(() => context.prepareAdditionalDocumentSaveTargets({additionalSaveTargets: [targetRequest(definition, {studentFolder: ""})]}, dateValues), /папка/);
  assert.throws(() => context.prepareAdditionalDocumentSaveTargets({additionalSaveTargets: new Array(11).fill({})}, {}), /10/);
  const generated = {bytes: Buffer.from("FINAL PDF"), editableBytes: Buffer.from("EDITED DOCX"), fileName: "ПРИКАЗ об утверждении состава ИАК.pdf", outputFormat: "pdf", additionalSaveTargets: targets};
  await context.sendGeneratedDocumentResponse({}, generated, {autoSaveLocal: true, studentFolder: definition.saveFolderTemplate});
  assert.equal(saves.length, 2);
  assert.equal(saves[0].name, "ПРИКАЗ об утверждении состава ИАК.pdf");
  assert.equal(saves[1].name, "ПРИКАЗ об утверждении состава ИАК_09.2026.pdf");
  assert.ok(saves[0].bytes.equals(saves[1].bytes));
  assert.equal(conversionCalls, 0, "Same-format copies reuse final bytes");
  const headers = sent[0].at(-1);
  assert.equal(JSON.parse(decodeURIComponent(headers["X-Additional-Documents-Result"])).saved, 1);

  saves.length = 0;
  const docxTarget = {...targets[0], outputFormat: "docx", fileName: "Редактированная копия.docx"};
  let report = await context.saveAdditionalGeneratedDocuments({...generated, additionalSaveTargets: [docxTarget]}, {}, {});
  assert.equal(report.saved, 1);
  assert.equal(saves[0].bytes.toString(), "EDITED DOCX", "PDF to DOCX uses edited source, not original template");
  saves.length = 0;
  report = await context.saveAdditionalGeneratedDocuments({ ...generated, outputFormat: "docx", bytes: generated.editableBytes,
    additionalSaveTargets: [targets[0], {...targets[0], fileName: "Другая копия.pdf"}] }, {}, {});
  assert.equal(conversionCalls, 1, "Different PDF targets convert once");
  assert.ok(saves.every(save => save.bytes.toString() === "PDF:EDITED DOCX"));
  saves.length = 0;
  report = await context.saveAdditionalGeneratedDocuments({...generated, additionalSaveTargets: [targets[0], targets[0]]}, {}, {});
  assert.equal(saves.length, 1, "Duplicate destinations are saved once");
  assert.equal(report.saved, 2);
  saves.length = 0;
  report = await context.saveAdditionalGeneratedDocuments({...generated, additionalSaveTargets: [{...targets[0], studentFolder: "fail"}, {...docxTarget, autoSaveLocal: false, saveToYandexDisk: true}]}, {}, {});
  assert.equal(report.failed.length, 1);
  assert.equal(report.saved, 1, "A failed copy does not prevent later targets");
  assert.equal(saves[0].cloud, true);
  saves.length = 0;
  await context.sendGeneratedDocumentResponse({}, generated, {promptLocalSave: true});
  assert.equal(saves.length, 0, "Cancelling the primary dialog saves no additional copies");
  context.convertDocxBytesToPdf = async () => { throw new Error("Converter offline"); };
  report = await context.saveAdditionalGeneratedDocuments({...generated, outputFormat: "docx", bytes: generated.editableBytes}, {}, {});
  assert.equal(report.failed.length, 1, "No DOCX is silently saved with a PDF extension");

  const client = {
    window: {AIS_DOCUMENT_WORKFLOW: workflow},
    getEffectiveLocalDocumentsMode: () => local,
    getDefaultDocumentSaveFolderTemplate: value => value.saveFolderTemplate,
    downloadsFolderTemplateMarker: "#Папка Загрузки#",
    getStudentDocumentStorageFolder: (_record, template, values) => workflow.resolveOutputTemplate(template.saveFolderTemplate, values)
  };
  vm.createContext(client);
  vm.runInContext(extract(app, "getAdditionalDocumentStorageRequests", "  "), client);
  let requests = client.getAdditionalDocumentStorageRequests({}, {...definition, saveFolderTemplate: "Другая папка"}, dateValues);
  assert.equal(requests[0].studentFolder, "Другая папка", "Blank extra path follows main settings");
  assert.equal(requests[0].autoSaveLocal, true);
  local = false;
  requests = client.getAdditionalDocumentStorageRequests({}, definition, dateValues);
  assert.equal(requests[0].saveToYandexDisk, true);
  assert.throws(() => client.getAdditionalDocumentStorageRequests({}, {...definition, saveFolderTemplate: "#Папка Загрузки#"}, {}), /папку/);

  // Real disk save routine: exact spaced names, no traversal, no destructive overwrite on collision.
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "ais-multiple-output-test-"));
  const disk = {path, fs: fsp, documentWorkflow: workflow, serverSettings: {openDocumentsLocally: true},
    resolveLocalDocumentsFolder: () => temp,
    getStudentMailboxFileNameCandidate: (name, index) => index ? name.replace(/(\.[^.]+)$/, ` (${index})$1`) : name};
  vm.createContext(disk);
  vm.runInContext(extract(server, "saveStudentDocumentLocally"), disk);
  const written = await disk.saveStudentDocumentLocally(generated.bytes, targets[0].fileName, targets[0]);
  assert.equal(path.basename(written.path), targets[0].fileName);
  assert.ok((await fsp.readFile(written.path)).equals(generated.bytes));
  const reused = await disk.saveStudentDocumentLocally(generated.bytes, targets[0].fileName, targets[0]);
  assert.equal(reused.reused, true);
  const collision = await disk.saveStudentDocumentLocally(Buffer.from("new"), targets[0].fileName, targets[0]);
  assert.notEqual(collision.path, written.path);
  assert.equal((await fsp.readFile(written.path)).toString(), "FINAL PDF");

  // Real preview stores, including the file-based mode used by the published gateway.
  const api = require("../app-server.js");
  const owner = {id: "multiple-output-test", login: "test", authSessionKey: "isolated-test"};
  for (const fileStore of [false, true]) {
    process.env.AIS_TRUST_GATEWAY = fileStore ? "1" : "0";
    process.env.AIS_DISABLE_PREVIEW_CLEANUP_WORKER = "1";
    process.env.AIS_GENERATED_DOCUMENT_PREVIEW_STORAGE_ROOT = path.join(temp, "previews");
    const token = await api.registerGeneratedDocumentPreview({...generated, additionalSaveTargets: [docxTarget]}, owner);
    const preview = await api.takeGeneratedDocumentPreview(token, owner);
    assert.deepEqual(plain(preview.additionalSaveTargets), plain([docxTarget]));
    assert.equal(preview.editableBytes.toString(), "EDITED DOCX");
    saves.length = 0;
    await context.sendGeneratedDocumentResponse({}, preview, {});
    assert.equal(saves[0].bytes.toString(), "EDITED DOCX");
    await api.completeGeneratedDocumentPreview(preview);
  }
  assert.match(server, /Access-Control-Expose-Headers[^\n]*X-Additional-Documents-Result/);
  assert.match(fs.readFileSync(path.join(root, "local-server.js"), "utf8"), /Access-Control-Expose-Headers[^\n]*X-Additional-Documents-Result/);
  console.log("Multiple document outputs: defaults, date/month rollover, names, local/WebDAV, same/mixed formats, final editor bytes, both preview stores, cancellation, partial failures, deduplication and real disk saves: OK");
  // Only the freshly created, OS-owned test directory can be removed.
  assert.equal(path.dirname(temp), os.tmpdir());
  await fsp.rm(temp, {recursive: true, force: true});
}
main().catch(error => { console.error(error); process.exitCode = 1; });

"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const workflow = require("../document-workflow.js");
const root = path.resolve(__dirname, "..");
const serverSource = fs.readFileSync(path.join(root, "app-server.js"), "utf8").replace(/\r\n/g, "\n");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n/g, "\n");
function extract(source, name, indent = "") {
  const match = new RegExp(`^${indent}(?:async )?function ${name}\\(`, "m").exec(source);
  assert.ok(match, name);
  const rest = source.slice(match.index + match[0].length);
  const end = new RegExp(`^${indent}(?:async )?function `, "m").exec(rest);
  assert.ok(end, name);
  return source.slice(match.index, match.index + match[0].length + end.index);
}
async function main() {
  const calls = [];
  const serverContext = {
    path, ROOT: root, documentWorkflow: workflow,
    resolveLocalTemplatePathFromWebDavSource: value => value.startsWith("https://external.example/") ? "" : `local:${value}`,
    resolveLocalDocumentsPath: value => `source:${value}`,
    loadLocalTemplateBytes: async value => { calls.push(value); if (value.includes("missing")) throw new Error("ENOENT"); return Buffer.from(value); },
    loadTemplateBytes: async (...args) => { calls.push(["cloud", ...args]); return Buffer.from("cloud"); }
  };
  vm.createContext(serverContext);
  vm.runInContext(extract(serverSource, "loadTemplateBytesForRequest"), serverContext);
  for (const definition of workflow.definitions) {
    calls.length = 0;
    await serverContext.loadTemplateBytesForRequest({templatePath: definition.templatePath, preferLocalTemplate: true});
    assert.deepEqual(calls, [`source:${definition.localTemplateSource}`]);
  }
  calls.length = 0;
  await serverContext.loadTemplateBytesForRequest({templateUrl: "Документы/custom.docx", templatePath: "old.docx", preferLocalTemplate: true});
  assert.deepEqual(calls, ["local:Документы/custom.docx"]);
  calls.length = 0;
  await assert.rejects(serverContext.loadTemplateBytesForRequest({templateUrl: "missing.docx", templatePath: "old.docx", preferLocalTemplate: true}), /ENOENT/);
  assert.deepEqual(calls, ["local:missing.docx"], "Missing source is not replaced by a stale stored template");
  calls.length = 0;
  await serverContext.loadTemplateBytesForRequest({templatePath: "uploaded.docx", preferLocalTemplate: true});
  assert.deepEqual(calls, ["uploaded.docx"], "Uploaded custom templates keep their chosen source");
  calls.length = 0;
  await serverContext.loadTemplateBytesForRequest({templatePath: workflow.definitions[1].templatePath, preferLocalTemplate: false});
  assert.equal(calls[0][0], "cloud");

  let local = true, available = true, apiOrigin = "http://127.0.0.1:8081";
  const requests = [];
  const appContext = {
    getEffectiveLocalDocumentsMode: () => local,
    photoServerOrigin: () => "https://edu-plus.ru/lms",
    probeLocalDocumentServices: async () => ({appServerAvailable: available, localDocumentsAvailable: available, apiOrigin}),
    localDocumentServicesOrigin: "http://127.0.0.1:8081",
    documentProcessingApiUrl: (pathname, origin) => origin + pathname,
    fetch: async (url, options) => {requests.push({url, body: JSON.parse(options.body), headers: options.headers}); return {ok: true, json: async () => ({markers: ["Список"]})};}
  };
  vm.createContext(appContext);
  vm.runInContext(extract(appSource, "inspectDocumentTemplateSource", "  "), appContext);
  await appContext.inspectDocumentTemplateSource({templatePath: "test.docx"});
  assert.equal(requests[0].url, "http://127.0.0.1:8081/api/documents/template-inspect");
  assert.equal(requests[0].body.preferLocalTemplate, true);
  assert.equal(requests[0].headers["X-Requested-With"], "AIS-Web");
  apiOrigin = "https://edu-plus.ru/lms";
  await appContext.inspectDocumentTemplateSource({templatePath: "test.docx"});
  assert.equal(requests[1].url, "https://edu-plus.ru/lms/api/documents/template-inspect", "Local tunnel is supported");
  assert.equal(requests[1].body.preferLocalTemplate, true);
  available = false;
  await assert.rejects(appContext.inspectDocumentTemplateSource({templatePath: "test.docx"}), /Локальный сервис/);
  assert.equal(requests.length, 2);
  local = false;
  await appContext.inspectDocumentTemplateSource({templatePath: "test.docx"});
  assert.equal(requests[2].body.preferLocalTemplate, false);

  const migrationContext = {
    // Keep the actual factory AND record normalizer in the regression path.
    // Only unrelated email, folder and field-editor services are stubbed.
    createDefaultDocumentTemplate: () => ({id:"contract-default", title:"Договор", fileNameTemplate:"Договор", fields:[], originalFields:[], createdAt:""}),
    contractTemplateSettingDefaults: [],
    postalEnvelopeDocumentTemplateId: "envelope",
    documentOpenAfterGenerationDefaultVersion: "test",
    isDocumentTemplateMarkerFieldMode: mode => mode === "document-markers",
    normalizeDocumentTemplateFieldList: (_document, fields) => JSON.parse(JSON.stringify(fields || [])),
    normalizeDocumentTemplateSource: value => String(value || ""),
    normalizeOrderDocumentFileNameTemplate: value => value.fileNameTemplate,
    getDefaultDocumentSaveFolderTemplate: value => value.saveFolderTemplate || "",
    isChecked: value => value === true || value === "1",
    normalizeDocumentEmailDeliveryMode: value => value || "off",
    getDefaultDocumentEmailSubjectTemplate: () => "",
    getDefaultDocumentEmailMessageTemplate: () => "",
    normalizeDocumentEmailTemplateValues: value => value || {},
    normalizeEducationProgramType: value => value,
    getDefaultDocumentTemplates: () => workflow.definitions.map(definition => migrationContext.createEducationDocumentTemplate({
      ...definition,
      markers: definition.fields.map(field => field.name),
      formulas: Object.fromEntries(definition.fields.map(field => [field.name, field.formula]))
    })),
    educationDocumentTemplateFieldFormulaMap: {},
    studentDocumentsFolderTemplateMarker: "#Папка слушателя#",
    documentPreviewDefaultVersion: "test",
    normalizeDocumentGenerationFormat: value => value === "docx" ? "docx" : "pdf",
    getDefaultDocumentOpenAfterGeneration: () => false,
    trainingExtensionDocumentTemplateId: "extension", trainingReductionDocumentTemplateId: "reduction"
  };
  vm.createContext(migrationContext);
  vm.runInContext(extract(appSource, "createEducationDocumentTemplate", "  "), migrationContext);
  vm.runInContext(extract(appSource, "normalizeDocumentTemplate", "  "), migrationContext);
  vm.runInContext(extract(appSource, "normalizeDocumentTemplates", "  "), migrationContext);
  const recruitment = workflow.definitions[1];
  const defaults = migrationContext.getDefaultDocumentTemplates();
  assert.equal(defaults[1].fileNameTemplateVersion, recruitment.fileNameTemplateVersion, "The real document factory must retain filename migration metadata");
  assert.equal(defaults[1].legacyListFormula, recruitment.legacyListFormula, "The real document factory must retain formula migration metadata");
  const old = {...recruitment, fileNameTemplate: "OLD", fileNameTemplateVersion: "", fields: [{name: "Список", formula: recruitment.legacyListFormula}]};
  const migrated = migrationContext.normalizeDocumentTemplates([old]).find(item => item.id === old.id);
  assert.equal(migrated.fileNameTemplate, recruitment.fileNameTemplate);
  assert.equal(migrated.fields[0].formula, recruitment.fields[0].formula);
  migrated.fileNameTemplate = "Моё имя после обновления";
  migrated.fields[0].formula = "=Моя формула";
  const next = migrationContext.normalizeDocumentTemplates([migrated]).find(item => item.id === old.id);
  assert.equal(next.fileNameTemplate, migrated.fileNameTemplate);
  assert.equal(next.fields[0].formula, migrated.fields[0].formula);
  const snapshotArg = process.argv.indexOf("--snapshot");
  if (snapshotArg >= 0) {
    const snapshotPath = path.resolve(process.argv[snapshotArg + 1]);
    const before = fs.readFileSync(snapshotPath);
    const saved = JSON.parse(before).data.dictionaries.documentTemplates;
    const normalized = migrationContext.normalizeDocumentTemplates(saved);
    const current = normalized.find(item => item.id === recruitment.id);
    assert.equal(current.fileNameTemplate, recruitment.fileNameTemplate);
    assert.equal(normalized.find(item => item.id === workflow.definitions[0].id).fileNameTemplate, workflow.definitions[0].fileNameTemplate);
    for (const key of ["fields", "originalFields"]) {
      assert.equal(current[key].find(field => field.name === "Список").formula, recruitment.fields[0].formula);
    }
    const values = workflow.evaluateLists(current, [{id:"test-free",name:"Бесплатная программа",status:"Набор",type:"ПРО",price:0}]).values;
    assert.match(values["Список"], /\t0\t–$/u, "A migrated saved template uses a dash for zero price");
    assert.equal(JSON.stringify(migrationContext.normalizeDocumentTemplates(JSON.parse(JSON.stringify(normalized)))), JSON.stringify(normalized), "Reloading saved settings is idempotent");
    assert.deepEqual(fs.readFileSync(snapshotPath), before, "Verification must not modify the shared database snapshot");
    console.log("Saved document settings: both filenames, active/original formulas and zero-price commission verified without database writes");
  }
  const fileNameContext = {window: {AIS_DOCUMENT_WORKFLOW: workflow}, normalizeDocumentGenerationFormat: value => value === "docx" ? "docx" : "pdf"};
  vm.createContext(fileNameContext);
  vm.runInContext(extract(appSource, "ensureGeneratedDocumentFileName", "  "), fileNameContext);
  for (const definition of workflow.definitions.slice(0, 2)) {
    assert.equal(fileNameContext.ensureGeneratedDocumentFileName(definition.fileNameTemplate, "pdf"), `${definition.fileNameTemplate}.pdf`);
    assert.equal(fileNameContext.ensureGeneratedDocumentFileName(`${definition.fileNameTemplate}.pdf`, "docx"), `${definition.fileNameTemplate}.docx`);
  }
  assert.equal(fileNameContext.ensureGeneratedDocumentFileName("Произвольный договор"), "Произвольный_договор.pdf");
  console.log("Local template refresh: source selection, no stale fallback, local/tunnel routing, errors and one-time defaults migration: OK");
}
main().catch(error => {console.error(error); process.exitCode = 1;});

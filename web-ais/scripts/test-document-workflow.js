"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const workflow = require("../document-workflow.js");
const server = require("../app-server.js");
const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const programs = [
  {id: "a", name: "Аналитика данных и цифровые инструменты (260 ч)", type: "ППП", status: "Набор", price: 24000, commissionChair: "Иванов Иван Иванович", commissionMember1: "Петров Пётр Петрович", commissionMember2: "Сидорова Анна Петровна", secretary: "Смирнова Елена Ивановна"},
  {id: "b", name: "Безопасность и охрана труда (72 ч)", type: "КПК", status: "Набор", price: 2500, authorSource: "Автор курса"},
  {id: "c", name: "Искусство & дизайн (36 ч)", type: "ДОП", status: "Набор", price: 1500},
  {id: "d", name: "Практический вебинар (2 ч)", type: "ПРО", status: "Набор", price: 0},
  {id: "e", name: "Не включать: архивная программа", type: "ППП", status: "Архив", price: 9999, commissionChair: "Архивный председатель"},
  {id: "f", name: "Без комиссии (260 ч)", type: "ППП", status: "Набор", price: 20000, commissionChair: ""}
];
const sourceValues = {"Дата документа": "2026-09-09", "Номер приказа": "ТЕСТ-017"};
assert.equal(workflow.formatDefaultOrderNumber("2026-09-11", "иак"), "911-26/ИАК");
assert.equal(workflow.formatDefaultOrderNumber("2026-01-05", "НАБОР"), "105-26/НАБОР");
assert.equal(workflow.formatDefaultOrderNumber("2026-11-01", "АТТЕСТАЦИЯ"), "1101-26/АТТЕСТАЦИЯ");
assert.equal(workflow.formatDefaultOrderNumber("2028-02-29", "ИАК"), "229-28/ИАК");
assert.equal(workflow.formatDefaultOrderNumber("2026-02-31", "ИАК"), "");
assert.equal(workflow.formatDefaultOrderNumber("2026-09-11", "два слова"), "");
for (const definition of workflow.definitions.filter(item => item.documentKind !== "workflowCommercialProposal")) {
  assert.match(definition.orderNumberContext, /^[\p{L}\p{N}]+$/u, `Для ${definition.documentKind} нужен однословный контекст номера.`);
}
const docXml = bytes => server.readDocxZipEntries(bytes).find(entry => entry.name === "word/document.xml").content.toString("utf8");
const text = xml => [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(m => m[1]).join(" ").replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
const outputArg = process.argv.indexOf("--samples");
const sampleDir = outputArg >= 0 ? path.resolve(process.argv[outputArg + 1]) : "";
if (sampleDir) fs.mkdirSync(sampleDir, {recursive: true});

for (const definition of workflow.definitions) {
  const lists = workflow.evaluateLists(definition, programs);
  const prepared = server.prepareWorkflowDocumentValues(definition.documentKind, {fields: definition.fields, programs}, sourceValues);
  const bytes = fs.readFileSync(path.join(root, definition.templatePath));
  const result = server.fillDocxMarkers(bytes, prepared.values, {}, null, prepared);
  const xml = docXml(result), visible = text(xml);
  assert.ok(!visible.includes("Архивная программа"));
  assert.ok(!visible.includes("Не включать"));
  assert.ok(!visible.includes("Архивный председатель"));
  assert.ok(!visible.includes("#Список"));
  assert.ok(!xml.includes("&lt;b&gt;"), "Assistant bold headings must be Word formatting, not literal HTML");
  assert.match(visible, /09\.09\.2026/);
  if (definition.documentKind !== "workflowCommercialProposal") assert.match(visible, /ТЕСТ-017/);
  assert.match(visible, /Симак/);
  if (definition.documentKind === "workflowCommissionOrder") {
    assert.equal(lists.programs.length, 1);
    assert.equal((xml.match(/<w:tbl\b/g) || []).length, 1);
    assert.match(visible, /Иванов Иван Иванович/);
    assert.doesNotMatch(visible, /Без комиссии/);
    assert.match(visible, /Смирнова Елена Ивановна/);
  } else if (definition.documentKind === "workflowRecruitmentOrder") {
    assert.equal(lists.programs.length, 5);
    assert.equal((xml.match(/<w:tr\b/g) || []).length, 7, "Letterhead + header + five current programs only");
    assert.match(visible, /09 сентября 2026 года/);
    assert.match(visible, /10%/);
    assert.match(visible, /25%/);
  } else {
    assert.equal(lists.programs.length, 5);
    assert.equal((xml.match(/<w:tr\b/g) || []).length, 11, "Letterhead + four headings + five programs + signature only");
    assert.match(visible, /2500/);
    assert.match(visible, /Искусство & дизайн/);
  }
  // Word images, relationships and layout settings remain unchanged.
  const sourceEntries = server.readDocxZipEntries(bytes), resultEntries = server.readDocxZipEntries(result);
  for (const original of sourceEntries.filter(entry => /^word\/media\//.test(entry.name))) {
    assert.deepEqual(resultEntries.find(entry => entry.name === original.name)?.content, original.content);
  }
  assert.equal((xml.match(/<w:sectPr\b/g) || []).length, (docXml(bytes).match(/<w:sectPr\b/g) || []).length);
  const empty = server.prepareWorkflowDocumentValues(definition.documentKind, {fields: definition.fields, programs: []}, sourceValues);
  const emptyXml = docXml(server.fillDocxMarkers(bytes, empty.values, {}, null, empty));
  assert.match(text(emptyXml), /Нет программ по условиям отбора/);
  assert.ok((emptyXml.match(/<w:tr\b/g) || []).length <= 10, "Empty queries must not retain cached Word rows");
  assert.doesNotMatch(emptyXml, /w:instr="[^\"]*SUBJECT/);
  if (sampleDir) {
    fs.writeFileSync(path.join(sampleDir, `${definition.id}.docx`), result);
    fs.writeFileSync(path.join(sampleDir, `${definition.id}.xml`), xml);
  }
}

const recruitment = workflow.definitions[1];
assert.equal(workflow.definitions[0].fileNameTemplate, "ПРИКАЗ об утверждении состава ИАК");
assert.equal(recruitment.fileNameTemplate, "Действующий приказ о наборе");
const recruitmentInspection = server.inspectDocxTemplate(fs.readFileSync(path.join(root, recruitment.templatePath)));
const inspectedRecruitmentFields = recruitment.fields.map(field => ({...field, formula: recruitmentInspection.properties.find(item => item.name === field.name)?.formula || field.formula}));
assert.equal(workflow.evaluateLists(recruitment, programs).values["Список"], workflow.evaluateLists({...recruitment, fields: inspectedRecruitmentFields}, programs).values["Список"], "Bundled defaults match the current source Word formula");
assert.match(workflow.evaluateLists(recruitment, programs).values["Список"], /Практический вебинар[^\t]*\t0\t–/u);
const generatedRecruitment = server.prepareWorkflowDocumentValues(
  recruitment.documentKind,
  {fields: recruitment.fields, programs},
  {"Дата документа": "2026-09-11"}
);
assert.equal(generatedRecruitment.values["Номер приказа"], "911-26/НАБОР");
const edited = {...recruitment, fields: recruitment.fields.map(field => field.name === "Список" ? {...field, formula: field.formula.replace("Стоимость,", "Стоимость * 2,").replace("WHERE [Условие отбора]", "WHERE [Тип]='КПК'")} : field)};
const editedValues = server.prepareWorkflowDocumentValues(edited.documentKind, {fields: edited.fields, programs}, sourceValues).values;
assert.match(editedValues["Список"], /\t5000\t10%/);
assert.doesNotMatch(editedValues["Список"], /Аналитика/);
const changedCommission = workflow.evaluateLists(workflow.definitions[0], programs.map(p => ({...p, commissionChair: "Новый председатель"})));
assert.match(changedCommission.values["Список"], /Новый председатель/);
assert.throws(() => workflow.compileQuery("DELETE FROM [Реестр программ$]"), /SELECT/);
assert.throws(() => workflow.compileQuery("SELECT Стоимость FROM [Слушатели$]"), /только лист/);
assert.throws(() => workflow.compileQuery("SELECT Shell('cmd') FROM [Реестр программ$]"), /не поддерживается/);
assert.throws(() => workflow.compileQuery("SELECT Стоимость FROM [Реестр программ$]; SELECT Стоимость FROM [Реестр программ$]"), /Не поддерживается/);
assert.throws(() => server.prepareWorkflowDocumentValues(recruitment.documentKind, {fields: [], programs}, sourceValues), /поля/);
assert.throws(() => server.prepareWorkflowDocumentValues(recruitment.documentKind, {fields: recruitment.fields.filter(f => f.name !== "Список"), programs}, sourceValues), /обязательное поле/);

function functionSource(name) {
  const start = app.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const end = app.indexOf("\n  function ", start + 12);
  return app.slice(start, end);
}
const identity = value => value;
const context = {
  window: {AIS_DOCUMENT_WORKFLOW: workflow}, state: {data: {collections: {programs, commissionSets: []}}},
  getDocumentTemplates: () => workflow.definitions.map(d => ({...d, generationFormat: "pdf"})),
  getProgramRows: () => programs, resolveProgramCommissionRecord: p => ({...p, commissionChair: p.commissionChair}),
  todayIso: () => "2026-09-09", escapeHtml: identity, escapeAttr: identity,
  normalizeContractTemplateDocumentFields: identity, getDocumentEmailPropertiesFromInspection: () => ({subject: {}, message: {}, templateValues: {}}),
  mergeDocumentTemplateFieldsFromInspection: () => [], normalizeDocumentEmailTemplateValues: identity,
  getDocumentTemplateInspectionSignature: () => "test", validateContractTemplateFormulaGraph: () => ""
};
vm.createContext(context);
for (const name of ["getWorkflowDocuments", "getWorkflowPrograms", "syncDocumentWorkflowDefaultOrderNumber", "getDocumentWorkflowDraft", "renderDocumentWorkflow", "applyDocumentTemplateInspection"]) vm.runInContext(functionSource(name), context);
context.state.documentWorkflowDraft = {documentId: workflow.definitions[0].id, date: "2026-09-11", orderNo: "", generatedOrderNo: "", format: "pdf"};
assert.match(context.renderDocumentWorkflow(), /value="911-26\/ИАК"/);
context.state.documentWorkflowDraft = {documentId: workflow.definitions[1].id, date: "2026-09-11", orderNo: "911-26/ИАК", generatedOrderNo: "911-26/ИАК", format: "pdf"};
assert.match(context.renderDocumentWorkflow(), /value="911-26\/НАБОР"/);
context.state.documentWorkflowDraft = {documentId: workflow.definitions[0].id, date: "2026-09-12", orderNo: "911-26/ИАК", generatedOrderNo: "911-26/ИАК", format: "pdf"};
assert.match(context.renderDocumentWorkflow(), /value="912-26\/ИАК"/);
context.state.documentWorkflowDraft = {documentId: workflow.definitions[0].id, date: "2026-09-12", orderNo: "РУЧНОЙ-7", generatedOrderNo: "911-26/ИАК", format: "pdf"};
assert.match(context.renderDocumentWorkflow(), /value="РУЧНОЙ-7"/);
context.state.documentWorkflowDraft = {documentId: workflow.definitions[0].id, date: "2026-09-12", orderNo: "911-26/ИАК", generatedOrderNo: "911-26/ИАК", orderNoIsManual: true, format: "pdf"};
assert.match(context.renderDocumentWorkflow(), /value="911-26\/ИАК"/);
for (const definition of workflow.definitions) {
  context.state.documentWorkflowDraft = {documentId: definition.id, date: "2026-09-09", orderNo: "ТЕСТ-017"};
  const html = context.renderDocumentWorkflow();
  assert.match(html, /Документооборот/);
  assert.ok(html.includes(definition.title));
  assert.equal(html.includes('name="orderNo"'), definition.documentKind !== "workflowCommercialProposal");
  const modified = definition.fields.map(field => ({...field, formula: field.formula.replace("Стоимость,", "Стоимость * 2,")}));
  const inspected = context.applyDocumentTemplateInspection(definition, {}, modified);
  assert.equal(inspected.fields.length, definition.fields.length);
  assert.equal(inspected.fields[0].formula, modified[0].formula, "Re-inspection must retain edited SQL formulas");
  assert.equal(inspected.originalFields[0].formula, definition.fields[0].formula);
}
const reloaded = context.applyDocumentTemplateInspection(recruitment, recruitmentInspection, recruitment.fields.map(field => ({...field, formula: field.name === "Список" ? recruitment.legacyListFormula : field.formula})), {reloadWorkflowFormulas: true});
assert.equal(reloaded.fields.find(field => field.name === "Список").formula, recruitmentInspection.properties[0].formula);
assert.ok(reloaded.fields.some(field => field.name === "Дата начала набора"), "Refresh keeps workflow date parameters absent from Word");
assert.match(app, /state\.view === "documentWorkflow"\) return renderDocumentWorkflow\(\)/);
assert.match(app, /bindDocumentWorkflowEvents\(\)/);
assert.match(app, /options\.skipEmail \? null : prepareStudentDocumentEmailRequest/);
assert.match(app, /workflow: \{ fields: template\.fields, programs \}/);
const bootstrap = fs.readFileSync(path.join(root, "auth-bootstrap.js"), "utf8");
assert.ok(bootstrap.indexOf('loadScript("document-workflow.js")') < bootstrap.indexOf('loadScript("app.js")'));
async function testDocumentEndpoint() {
  const {Readable} = require("node:stream");
  for (const definition of workflow.definitions) {
    const request = {templatePath: definition.templatePath, documentKind: definition.documentKind,
      workflow: {fields: definition.fields, programs, fileNameTemplate: definition.fileNameTemplate},
      sourceValues, fieldValues: {"Список": "STALE CLIENT VALUE"}, useCustomDocumentProperties: true, outputFormat: "docx", useBrowserDownloads: true};
    let status = 0, headers = {}, bytes;
    await server.handleContractDocument(Readable.from([Buffer.from(JSON.stringify(request))]), {
      writeHead(code, values) {status = code; headers = values;}, end(value) {bytes = value;}
    }, {});
    assert.equal(status, 200, Buffer.isBuffer(bytes) && bytes[0] === 123 ? bytes.toString() : `Endpoint failed: ${definition.id}`);
    assert.equal(headers["X-Generated-Document-Format"], "docx");
    const outputName = decodeURIComponent(headers["X-Generated-Document-File-Name"]);
    if (definition.documentKind === "workflowCommercialProposal") assert.ok(outputName.includes("09.09.2026"));
    else assert.equal(outputName, `${definition.fileNameTemplate}.docx`);
    assert.doesNotMatch(text(docXml(bytes)), /STALE CLIENT VALUE/);
  }
  assert.throws(() => server.prepareWorkflowDocumentValues(recruitment.documentKind, {fields: recruitment.fields, programs}, {...sourceValues, "Дата документа": "2026-02-31"}), /корректную дату/);
  console.log("Document workflow: SQL, filters, edited formulas, DOCX lists/tables, dates, source media, empty data, UI/inspection and generation endpoint checks passed.");
}
testDocumentEndpoint().catch(error => {console.error(error); process.exitCode = 1;});

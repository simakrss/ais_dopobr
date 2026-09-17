"use strict";
// Synthetic students only. Optional reference-template check writes only into --output-dir.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const server = require("../app-server");
const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").replace(/\r\n/g, "\n");
function extract(name) {
  const match = source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name); return match[0];
}
const defs = JSON.parse(source.match(/const studentAttestationDocumentTemplateDefinitions = (\[[\s\S]*?^  ]);/m)[1]);
const state = { data: { collections: {
  programs: [{id: "p", name: "Тестовая программа (72 ч)", type: "КПК", commissionSetId: "c", commissionChair: "Устаревший состав", gradeReportUrl: "https://example.test/report", qualification: "Тестовая квалификация"}],
  commissionSets: [{id: "c", commissionChair: "Петров Петр Петрович, председатель", commissionMember1: "Иванов Иван Иванович, член комиссии", commissionMember2: "Сидорова Анна Петровна, член комиссии", secretary: "Иванова Ирина Ивановна, секретарь"}],
  contracts: [{name: "Петров Петр Петрович", email: "chair@example.test"}],
  trainingPlans: []
} } };
const plan = [
  { discipline: "Тестовая дисциплина", attestation: "Зачёт" },
  { discipline: "Практическая подготовка", attestation: "Практикум" },
  { discipline: "Итоговая аттестация", attestation: "Экзамен" }
];
const c = vm.createContext({ state, getEducationDocumentTrainingPlanRows: () => plan,
  PROGRAM_COMMISSION_FIELD_KEYS: ["commissionChair", "commissionMember1", "commissionMember2", "secretary"],
  normalizeProgramCommissionValue: (value) => String(value || "").trim(),
  splitFullName: (value) => {const [surname, firstName, patronymic] = value.split(/\s+/); return {surname, firstName, patronymic};},
  getEducationDocumentButtonTitle: () => "Документ", buildStudentDocumentGenerationTooltip: () => "Конверт",
  escapeAttr: (value) => String(value).replace(/"/g, "&quot;"), escapeMultilineAttr: (value) => value,
  renderOrdersSdoIcon: () => "", studentAttestationDocumentTemplateDefinitions: defs,
  contractTemplateFieldDefaults: []
});
vm.runInContext([
  "normalizeProgramName", "getStudentContextProgram", "getProgramCommissionSetById",
  "applyProgramCommissionSetToProgram", "resolveProgramCommissionRecord", "normalizeEmployeeActPersonName",
  "formatEmployeeContractShortName", "getStudentAttestationDocumentUnavailableReason",
  "formatStudentGradeSheetDisciplines", "prepareStudentAttestationDocumentRecord", "renderEducationDocumentActions",
  "isGetSqlQueryFormula", "evaluateContractTemplateField", "getContractFormulaDocumentReferences",
  "normalizeContractTemplateField", "normalizeContractTemplateDocumentFields", "findContractTemplateFormulaCycle", "validateContractTemplateFormulaGraph"
].map(extract).join("\n"), c);
const student = Object.freeze({ id: "test", uid: "999999", group: "ТЕСТ-09", name: "Тестов Иван Иванович", programId: "p", program: "Тестовая программа (72 ч)", finalGrade: "Отлично", protocolNo: "ТЕСТ-1", startDate: "2026-09-01", endDate: "2026-09-17", expulsionDate: "2026-09-17" });
for (const type of ["КПК", "ППП", "ДОП", "ПРО"]) {
  state.data.collections.programs[0].type = type;
  assert.equal(Boolean(c.getStudentAttestationDocumentUnavailableReason(student, "studentGradeSheet")), type === "ПРО");
  assert.equal(c.getStudentAttestationDocumentUnavailableReason(student, "studentAttestationProtocol"), "");
}
for (const commission of ["", "deleted"]) {
  state.data.collections.programs[0].commissionSetId = commission;
  assert.ok(c.getStudentAttestationDocumentUnavailableReason(student, "studentAttestationProtocol"));
}
assert.ok(c.getStudentAttestationDocumentUnavailableReason({...student, programId:"missing"}, "studentGradeSheet"));
assert.equal(c.getStudentAttestationDocumentUnavailableReason(student, "education"), "");
state.data.collections.programs[0].type = "КПК";
state.data.collections.programs[0].commissionSetId = "c";
const html = c.renderEducationDocumentActions(student);
assert.equal((html.match(/<button /g) || []).length, 4);
assert.ok(html.indexOf(">Ведомость</span>") < html.indexOf(">Протокол</span>"));
const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
assert.match(css, /\.education-document-actions\s*\{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\) max-content;/);
const prepared = c.prepareStudentAttestationDocumentRecord(student, "studentAttestationProtocol");
const extra = prepared.workflowSourceValues;
assert.equal(extra["Председатель"], "Петров Петр Петрович, председатель", "Use the current linked commission, not cached program fields");
assert.equal(extra["Председатель_ФИО"], "Петров П.П.");
assert.equal(extra["ИО"], "Петр Петрович");
assert.equal(extra["Email"], "chair@example.test");
assert.equal(extra["Ссылка"], "https://example.test/report");
assert.equal(extra["Перечень дисциплин"], "Тестовая дисциплина\tЗачтено\nПрактическая подготовка\tПрактикум\nИтоговая аттестация\tОтлично");
assert.equal(c.prepareStudentAttestationDocumentRecord(student, "education"), student);
assert.equal(student.workflowSourceValues, undefined, "Card data is not mutated");
assert.equal(c.prepareStudentAttestationDocumentRecord({...student, group:"ТЕСТ-09"}, "studentGradeSheet").workflowSourceValues["Номер группы"], "ТЕСТ-09");
assert.equal(c.prepareStudentAttestationDocumentRecord(student, "studentGradeSheet").workflowSourceValues.uid, "999999");
assert.match(extract("downloadStudentDocumentFromTemplate"), /getStudentAttestationDocumentUnavailableReason/);
assert.match(extract("downloadStudentDocumentFromTemplate"), /skipPhoto: true/);
assert.match(extract("evaluateContractTemplateField"), /return record.workflowSourceValues\[fieldName\]/);
for (const def of defs) {
  const fields = def.markers.map((name) => ({name, formula:def.formulas[name], position:def.fieldPositions[name]}));
  assert.equal(c.validateContractTemplateFormulaGraph(fields), "");
  const scoped = c.prepareStudentAttestationDocumentRecord(student, def.documentKind);
  for (const field of fields.filter((f) => c.isGetSqlQueryFormula(f.formula))) {
    assert.equal(c.evaluateContractTemplateField(field, scoped, {}), scoped.workflowSourceValues[field.name], `Frontend SQL source: ${field.name}`);
  }
  assert.equal(def.saveFolderTemplate, "#Папка документов слушателя#");
  assert.equal(def.generationFormat, "pdf");
  assert.equal(def.useCustomDocumentProperties, "1");
  assert.ok(def.templateUrl.startsWith("АИС Допобразование/Документы/"));
}
// A minimal Assistant table verifies replacement of ALL cached sample rows.
const customXml = '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Перечень дисциплин"><vt:lpwstr>=[Перечень дисциплин]</vt:lpwstr></property></Properties>';
const cell = (value) => `<w:tc><w:tcPr/><w:p><w:r><w:t>${value}</w:t></w:r></w:p></w:tc>`;
const doc = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tr>${cell("№")}${cell("Дисциплина")}${cell("Оценка")}</w:tr><w:tr>${cell("1")}${cell("#Перечень дисциплин#")}${cell("старый балл")}</w:tr><w:tr>${cell("2")}${cell("Старая дисциплина")}${cell("старый балл")}</w:tr></w:tbl></w:body></w:document>`;
const bytes = server.buildDocxZip([{name:"word/document.xml", content:Buffer.from(doc)}, {name:"docProps/custom.xml",content:Buffer.from(customXml)}]);
function mainXml(result) { return server.readDocxZipEntries(result).find((e) => e.name === "word/document.xml").content.toString(); }
const generated = mainXml(server.fillDocxMarkers(bytes, {"Перечень дисциплин": extra["Перечень дисциплин"]}));
assert.equal((generated.match(/<w:tr\b/g) || []).length, 4);
assert.doesNotMatch(generated, /Старая дисциплина|старый балл/);
assert.match(generated, /Отлично/);
const empty = mainXml(server.fillDocxMarkers(bytes, {"Перечень дисциплин": ""}));
assert.doesNotMatch(empty, /Старая дисциплина|старый балл|Нет программ/);
// Optional read-only reference-template QA; artifacts stay outside the real students' folders.
const args = process.argv.slice(2);
const templateRoot = args[args.indexOf("--templates-root") + 1];
const outputDir = args[args.indexOf("--output-dir") + 1];
if (args.includes("--templates-root")) {
  assert.ok(args.includes("--output-dir") && outputDir);
  fs.mkdirSync(outputDir, {recursive: true});
  for (const def of defs) {
    const original = fs.readFileSync(path.join(templateRoot, def.fileName));
    const inspection = server.inspectDocxTemplate(original);
    for (const field of inspection.properties) {
      assert.equal(def.fieldPositions[field.name], field.fieldNumber);
      assert.equal(def.formulas[field.name], field.formula.replace(/\n{2,}/g, "\n"));
    }
    const data = c.prepareStudentAttestationDocumentRecord(student, def.documentKind);
    const sources = {"ФИО":student.name, "Прогр обуч факт":student.program, "Номер группы":"ТЕСТ-09", "Дата начала обучения":"01.09.2026", "Дата окончания обучения":"17.09.2026", "Дата приказа Отчисл Док Обр":"17.09.2026", "Номер протокола":"ТЕСТ-1", "uid":"999999", "Оценка ИА":"Отлично", "ФИО_несклон":"", ...data.workflowSourceValues};
    const values = server.applyCustomDocumentPropertyFormulas(original, {...sources}, sources);
    values["ПутьСохр"] = "";
    const result = server.fillDocxMarkers(original, values, {}, new Set(inspection.properties.map((f) => f.name)));
    const xml = mainXml(result);
    assert.match(xml, /Тестов Иван Иванович/);
    assert.match(xml, /Тестовая программа/);
    if (def.documentKind === "studentGradeSheet") {
      assert.equal((xml.match(/<w:tr\b/g) || []).length, 5, "Letterhead row, header row and three disciplines");
      assert.doesNotMatch(xml, /Костюк|SUP|Модуль 1\. Введение/);
      assert.match(xml, /Тестовая дисциплина/);
      assert.match(xml, /Отлично/);
    } else {
      assert.match(xml, /Петров Петр Петрович/);
      assert.match(xml, /ТЕСТ-1/);
      assert.match(xml, /Отлично/);
    }
    const originalImages = server.readDocxZipEntries(original).filter((e) => e.name.startsWith("word/media/"));
    const resultEntries = server.readDocxZipEntries(result);
    for (const item of originalImages) assert.deepEqual(resultEntries.find((e) => e.name === item.name)?.content, item.content, "Keep template signatures and artwork");
    fs.writeFileSync(path.join(outputDir, `${def.documentKind}.docx`), result);
    console.log(`${def.documentKind}: reference formulas/fields, cached rows and ${originalImages.length} images verified`);
  }
}
console.log("Student attestation documents: OK");
if (args.includes("--serve")) {
  const script = `
    const state=${JSON.stringify(state)}, student=${JSON.stringify(student)};
    state.data.dictionaries={paymentSettings:[{key:"incomeTaxRate",value:"13"}]};
    const studentAttestationDocumentTemplateDefinitions=${JSON.stringify(defs)};
    function getEducationDocumentButtonTitle(){return "Документ об образовании";}
    function buildStudentDocumentGenerationTooltip(){return "Конверт";}
    function escapeAttr(value){return String(value).replace(/"/g,"&quot;");}
    function escapeMultilineAttr(value){return escapeAttr(value);}
    function renderOrdersSdoIcon(){return "";}
    ${["normalizeProgramName", "getStudentContextProgram", "getProgramCommissionSetById", "getStudentAttestationDocumentUnavailableReason", "renderEducationDocumentActions", "getEmployeeNetPayment", "normalizePaymentRateValue", "normalizePaymentConstantNumber"].map(extract).join("\n")}
    function paint(){
      const p=state.data.collections.programs[0];
      p.type=document.querySelector('#type').value;
      p.commissionSetId=document.querySelector('#commission').checked?'c':'';
      state.data.dictionaries.paymentSettings[0].value=document.querySelector('#tax').value;
      document.querySelector('#buttons').innerHTML=renderEducationDocumentActions(student);
      document.querySelector('#net').textContent=getEmployeeNetPayment(10000).toLocaleString('ru-RU')+' ₽';
      document.querySelectorAll('[data-action="open-student-attestation-document"]').forEach(button=>button.onclick=()=>{
        const unavailable=getStudentAttestationDocumentUnavailableReason(student,button.dataset.documentContextKind);
        if(!unavailable)document.querySelector('#result').textContent=button.textContent.trim()+' — папка документов слушателя';
      });
    }
    document.querySelectorAll('input,select').forEach(input=>input.addEventListener('input',paint));paint();
  `;
  const http = require("node:http");
  const fixture = http.createServer((req, res) => {
    if (req.url === "/styles.css") { res.setHeader("Content-Type", "text/css"); return res.end(css); }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<!doctype html><html lang="ru"><title>Ведомость и протокол — проверка</title><link rel="stylesheet" href="/styles.css"><body style="padding:24px;background:#fff"><main style="max-width:640px"><h2>Проверка на вымышленных данных</h2><label>Вид программы <select id="type"><option>КПК</option><option>ППП</option><option>ДОП</option><option>ПРО</option></select></label><label><input id="commission" type="checkbox" checked>Комиссия выбрана</label><section style="width:285px;padding:10px;border:1px solid #bcc;margin:20px 0"><h3>Итоги</h3><div id="buttons"></div></section><label>Ставка подоходного налога, %<input id="tax" type="number" min="0" max="100" step="0.01" value="13"></label><table style="width:100%"><thead><tr><th>Сотрудник</th><th>К зачислению</th><th>Выплата</th></tr></thead><tbody><tr><td>Тестовый сотрудник</td><td id="net"></td><td>10 000 ₽</td></tr></tbody></table><output id="result"></output></main><script>${script}</script></body></html>`);
  });
  fixture.listen(0, "127.0.0.1", () => console.log(`Attestation UI fixture: http://127.0.0.1:${fixture.address().port}/`));
}

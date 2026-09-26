"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const appSource = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8").replace(/\r\n/g, "\n");
function extract(name) {
  const start = appSource.search(new RegExp(`^  (?:async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, `Missing function: ${name}`);
  const tail = appSource.slice(start);
  const end = tail.search(/\n  (?:async )?function /);
  return end < 0 ? tail : tail.slice(0, end);
}
const helperSource = ["inferPersonGender", "fillMissingPersonGender", "bindPersonGenderAutofill", "normalizeStudentGender", "renderStudentGenderField"].map(extract).join("\n");
const escape = value => String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const context = vm.createContext({
  Event, state: {data: {collections: {students: [], contracts: []}}, modal: {}},
  escapeHtml: escape, escapeAttr: escape
});
vm.runInContext(helperSource, context);
const infer = context.inferPersonGender;
for (const name of ["Иванов Иван Иванович", "Иванов Никита", "Ким Илья", "Ким Лука", "Ким Кузьма", "ЛИ ФЁДОР", "  Иванов\u00a0Артём   Сергеевич  ", "Иванов Неизвестное Петрович", "Алиев Рашад Эльхан оглы", "Петров Ян-Юрий"]) {
  assert.equal(infer(name), "Мужской", name);
}
for (const name of ["Шведова Юлия Николаевна", "Копылова Дарья Анатольевна", "Ким Любовь", "Ли Нинель", "Иванова Неизвестное Ильинична", "Алиева Фидан Эльхан кызы", "Петрова Анна–Мария", "Мария"]) {
  assert.equal(infer(name), "Женский", name);
}
for (const name of ["", " ", "Иванова", "Ким Саша", "Ким Женя", "Роман Саша", "Иванов И. И.", "John Smith", "Иванов123 Иван", "ООО Иван Мария", "ИП Иванов Иван Иванович", "Иванов Иван Петровна", "Ким неизвестное"]) {
  assert.equal(infer(name), "", `Ambiguous/non-person name: ${name}`);
}
const femaleRecord = {name: "Ким Любовь"};
assert.equal(context.fillMissingPersonGender(femaleRecord).gender, "Женский");
assert.equal(context.fillMissingPersonGender(femaleRecord).genderSource, "auto");
assert.equal(femaleRecord.gender, undefined, "Inference must not mutate input");
for (const gender of ["Мужской", "М", "Ж", "не указан"]) {
  const record = {...femaleRecord, gender};
  assert.equal(context.fillMissingPersonGender(record), record, "Keep explicit imported gender");
}
const cleared = {...femaleRecord, gender: "", genderSource: "manual"};
assert.equal(context.fillMissingPersonGender(cleared), cleared, "Respect deliberate clearing");
assert.match(context.renderStudentGenderField({gender: "ж"}), /value="Женский" selected/);

class Control extends EventTarget {
  constructor(value = "") { super(); this.value = value; }
  enter(value, event = "input") { this.value = value; this.dispatchEvent(new Event(event)); }
}
function formFor(config, draft = {}) {
  context.state.modal = {draft};
  return {dataset: {config}, elements: {name: new Control(draft.name || ""), gender: new Control(draft.gender || "")}};
}
for (const config of ["students", "contracts"]) {
  const form = formFor(config);
  context.bindPersonGenderAutofill(form);
  const {name, gender} = form.elements;
  name.enter("Петров Никита");
  assert.equal(gender.value, "Мужской", `${config}: typing`);
  name.enter("Ким Любовь", "change");
  assert.equal(gender.value, "Женский", `${config}: paste/autocomplete`);
  assert.equal(form.dataset.genderSource, "auto");
  name.enter("");
  assert.equal(gender.value, "", `${config}: clear obsolete inferred value`);
  name.enter("Шведова Юлия Николаевна");
  gender.enter("Мужской", "change");
  name.enter("Ким Любовь");
  assert.equal(gender.value, "Мужской", `${config}: keep manual choice`);
  gender.enter("");
  name.enter("Иванов Иван Иванович");
  assert.equal(gender.value, "", `${config}: keep manual clearing`);
  assert.equal(form.dataset.genderSource, "manual");

  const old = formFor(config, {gender: "Женский"});
  context.bindPersonGenderAutofill(old);
  old.elements.name.enter("Петров Иван");
  assert.equal(old.elements.gender.value, "Женский", "Existing value without provenance is explicit");

  const auto = formFor(config, {gender: "Женский", genderSource: "auto"});
  context.bindPersonGenderAutofill(auto);
  context.bindPersonGenderAutofill(auto);
  auto.elements.name.enter("Петров Иван");
  assert.equal(auto.elements.gender.value, "Мужской", "Auto value can change after reopening; no double binding");
  auto.elements.name.readOnly = true;
  auto.elements.name.enter("Ким Любовь");
  assert.equal(auto.elements.gender.value, "Мужской", "Locked card stays unchanged");
}
const irrelevant = formFor("programs");
context.bindPersonGenderAutofill(irrelevant);
irrelevant.elements.name.enter("Ким Любовь");
assert.equal(irrelevant.elements.gender.value, "");

// Execute the real draft collectors, including tab switches where fields are absent.
let currentForm;
Object.assign(context, {
  document: {getElementById: () => currentForm},
  FormData: class {
    constructor(form) {this.data = new Map(Object.entries(form.elements).map(([key, control]) => [key, control.value]));}
    has(key) {return this.data.has(key);}
    get(key) {return this.data.get(key);}
    forEach(fn) {this.data.forEach(fn);}
  },
  studentAllFields: ["name", "gender"].map(key => ({key})),
  configs: {contracts: {fields: ["name", "gender"].map(key => ({key}))}},
  normalizePreferredMessenger: value => value || "", normalizePersonPhotoCardPath: value => value || "",
  collectStudentDirectExpenses: () => [], clearUnchangedGeneratedCommunicationMessages: () => {},
  getNextUid: () => "test", findProgramByName: () => null, calculateStudentFinance: value => value,
  getEmployeePaymentCollections: () => context.state.data.collections,
  clearUnchangedGeneratedEmployeeCommunicationMessages: () => {}, buildContractPortalCredentials: () => "",
  normalizeContractRecord: value => ({...value}), getEmployeePaymentAccounting: () => ({})
});
vm.runInContext(["collectStudentFormDraft", "collectContractFormDraft"].map(extract).join("\n"), context);
for (const config of ["students", "contracts"]) {
  currentForm = formFor(config);
  context.bindPersonGenderAutofill(currentForm);
  currentForm.elements.name.enter("Ким Любовь");
  const collect = config === "students" ? context.collectStudentFormDraft : context.collectContractFormDraft;
  let draft = collect();
  assert.equal(draft.gender, "Женский");
  assert.equal(draft.genderSource, "auto");
  currentForm.elements.gender.enter("");
  draft = collect();
  assert.equal(draft.genderSource, "manual");
  context.state.modal.draft = draft;
  currentForm = {dataset: {config}, elements: {}};
  draft = collect();
  assert.equal(draft.gender, "");
  assert.equal(draft.genderSource, "manual", "Tab switch preserves manual clearing");
}

// Shop/application import: infer after personal data reuse, but trust explicit source values.
Object.assign(context, {
  getStudentApplicationProgram: () => null, getStudentApplicationFinancialTerms: () => ({}), todayIso: () => "2026-09-15",
  makeId: () => "fixture", getStudentApplicationProgramTitle: () => "", getStudentApplicationInferredProgramType: () => "",
  getApplicationSourceAgent: () => "", getCurrentUserLogin: () => "", getStudentApplicationSourceKey: () => "",
  reuseExistingStudentPersonalData: value => value, resolveProStudentAdditionalStatus: () => "",
  applyStudentEventTemplateDefaults: value => value, addAutomaticStudentExpenses: record => ({record})
});
vm.runInContext(extract("createStudentFromApplication"), context);
assert.equal(context.createStudentFromApplication({name: "Ким Любовь"}, 1).gender, "Женский");
assert.equal(context.createStudentFromApplication({name: "Ким Любовь", gender: "М"}, 1).gender, "Мужской");
context.reuseExistingStudentPersonalData = value => ({...value, name: "Петров Иван Иванович"});
assert.equal(context.createStudentFromApplication({name: "Петров И."}, 1).gender, "Мужской");
context.reuseExistingStudentPersonalData = value => ({...value, gender: "", genderSource: "manual"});
assert.equal(context.createStudentFromApplication({name: "Ким Любовь"}, 1).gender, "");

Object.assign(context, {
  getStudentApplicationExistingPersonalRecords: () => [{gender: "", genderSource: "manual"}, {gender: "Женский", genderSource: "auto"}],
  hasReusableStudentPersonalValue: value => value !== undefined && value !== null && String(value).trim() !== "",
  STUDENT_APPLICATION_REUSABLE_DOCUMENT_FIELDS: [], STUDENT_APPLICATION_REUSABLE_SDO_FIELDS: [],
  STUDENT_APPLICATION_REUSABLE_PERSONAL_FIELDS: ["gender", "genderSource"],
  getLatestStudentApplicationCredentialSource: () => null, getMostCompleteExistingPersonName: () => ""
});
vm.runInContext(extract("reuseExistingStudentPersonalData"), context);
assert.equal(context.createStudentFromApplication({name: "Ким Любовь"}, 1).gender, "", "Reuse must preserve a manual blank without mixing it with gender from another record");
assert.equal(context.createStudentFromApplication({name: "Ким Любовь", gender: "Ж"}, 1).gender, "Женский", "Explicit application value wins over reused values");

// Student -> employee import and explicit selection preservation.
let employeeDraft = {};
Object.assign(context, {
  collectContractFormDraft: () => employeeDraft, getContractStudentDuplicate: () => null,
  closeContractStudentPicker: () => {}, render: () => {}
});
vm.runInContext(extract("applyStudentToContract"), context);
context.state.data.collections.students = [{id: "test-student", name: "Ким Любовь"}];
context.applyStudentToContract("test-student");
assert.equal(context.state.modal.draft.gender, "Женский");
context.state.data.collections.students[0].gender = "Мужской";
context.applyStudentToContract("test-student");
assert.equal(context.state.modal.draft.gender, "Мужской");
employeeDraft = {gender: "", genderSource: "manual"};
context.applyStudentToContract("test-student");
assert.equal(context.state.modal.draft.gender, "");
employeeDraft = {gender: "Мужской", genderSource: "auto"};
delete context.state.data.collections.students[0].gender;
context.applyStudentToContract("test-student");
assert.equal(context.state.modal.draft.gender, "Женский", "Imported name replaces previous auto value");
employeeDraft = {gender: "Мужской"};
context.applyStudentToContract("test-student");
assert.equal(context.state.modal.draft.gender, "Мужской", "Keep legacy explicit employee gender");

// Keep workbook read/verification unmodified: infer only when accepting imported records.
const databaseImport = extract("importStudentsFromDatabase");
assert.match(databaseImport, /fillMissingPersonGender\(normalizeStudentRecord\(studentFields\)\)/);
assert.match(databaseImport, /fillMissingPersonGender\(normalizeContractRecord\(record\)\)/);
assert.doesNotMatch(extract("normalizeStudentRecord"), /inferPersonGender|fillMissingPersonGender/);
assert.match(extract("saveFormRecord"), /values\.genderSource = formElement\.dataset\.genderSource/);
assert.match(extract("saveFormRecord"), /fillMissingPersonGender\(values\)/);
assert.match(appSource, /bindPersonGenderAutofill\(document\.querySelector\("#recordForm"\)\)/);
console.log("PASS: gender inference, both cards, manual overrides, tab drafts and imports");

if (process.argv.includes("--serve")) {
  // Isolated browser fixture: production helpers + styles; no access to real application data.
  const http = require("node:http");
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"><title>Проверка автозаполнения пола</title>
  <body><main style="max-width:820px;margin:30px auto;padding:24px;background:white"><h1>Проверка автозаполнения пола</h1><p>Изолированная проверка, реальные записи не изменяются.</p>
  <button id="student">Слушатель</button> <button id="employee">Сотрудник</button> <button id="reopen">Переключить вкладку и вернуться</button><div id="card"></div><output id="result" aria-live="polite"></output></main>
  <script>const state={data:{collections:{students:[],contracts:[]}},modal:{draft:{}}};
  const escapeHtml=${escape.toString()};const escapeAttr=escapeHtml;${helperSource}
  let config="students";let draft={};
  function draw(){state.modal.draft=draft;document.getElementById("card").innerHTML='<h2>'+(config==="students"?"Слушатель":"Сотрудник")+'</h2><form id="recordForm" data-config="'+config+'"><div class="form-grid contract-form-grid"><label class="wide"><span>ФИО</span><input name="name" value="'+escapeAttr(draft.name||"")+'"></label>'+renderStudentGenderField(draft)+'</div></form>';const form=document.getElementById("recordForm");bindPersonGenderAutofill(form);for(const event of ["input","change"])form.addEventListener(event,()=>{draft={name:form.elements.name.value,gender:form.elements.gender.value,genderSource:form.dataset.genderSource};document.getElementById("result").textContent="Пол: "+(draft.gender||"не указан")+"; выбор: "+(draft.genderSource==="manual"?"ручной":"автоматический");});}
  document.getElementById("student").onclick=()=>{config="students";draft={};draw();};document.getElementById("employee").onclick=()=>{config="contracts";draft={};draw();};document.getElementById("reopen").onclick=draw;draw();</script></body></html>`;
  http.createServer((req, res) => {
    res.setHeader("Content-Type", req.url === "/styles.css" ? "text/css; charset=utf-8" : "text/html; charset=utf-8");
    res.end(req.url === "/styles.css" ? fs.readFileSync(path.join(__dirname, "../styles.css")) : html);
  }).listen(18987, "127.0.0.1", () => console.log("QA fixture: http://127.0.0.1:18987/"));
}

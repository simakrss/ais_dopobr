"use strict";
// Synthetic records and forms only. No database writes, imports or network requests.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const app = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8").replace(/\r\n?/g, "\n");
const extract = name => {
  const match = app.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name); return match[0];
};
const constants = ["STUDENT_LEARNING_ADDITIONAL_STATUS", "STUDENT_EXPELLED_ADDITIONAL_STATUS", "PRO_STUDENT_ADDITIONAL_STATUS", "PRO_STUDENT_ARCHIVE_ADDITIONAL_STATUS"]
  .map(name => app.match(new RegExp(`^  const ${name} = [^;]+;`, "m"))[0]).join("\n");
const helpers = ["normalizeEducationProgramType", "isStudentExpelledStatus", "resolveProStudentAdditionalStatus", "resolveStudentAdditionalStatusAfterMainStatusChange"].map(extract).join("\n");
const expected = type => type === "ПРО" ? "Вебинары. Архив" : "Отчисленные";
const context = vm.createContext({});
vm.runInContext(constants + "\n" + helpers, context);
for (const status of ["Отчислен", "Отчисленные", "  ОТЧИСЛЕННЫЕ  "]) {
  for (const type of ["КПК", "ППП", "ДОП", "ПРО"]) {
    const record = { status, additionalStatus: "На зачисление (документы отправлены)", educationType: type };
    const before = JSON.stringify(record);
    assert.equal(context.resolveStudentAdditionalStatusAfterMainStatusChange(record), expected(type));
    assert.equal(context.resolveStudentAdditionalStatusAfterMainStatusChange(record, type.toLowerCase()), expected(type));
    assert.equal(JSON.stringify(record), before, "Resolver never mutates input records");
  }
}
for (const status of ["На зачисление", "Не отчислен", "Отчисление запланировано", ""]) {
  assert.equal(context.resolveStudentAdditionalStatusAfterMainStatusChange({status, additionalStatus:"Ручной"}, "КПК"), "Ручной");
}
assert.equal(context.resolveStudentAdditionalStatusAfterMainStatusChange({status:"Отчислен", additionalStatus:"Ручной"}, "Неизвестный тип"), "Ручной");
for (const [type, short] of [["Повышение квалификации", "КПК"], ["Профессиональная переподготовка", "ППП"], ["Дополнительные общеобразовательные программы", "ДОП"]]) {
  assert.equal(context.resolveStudentAdditionalStatusAfterMainStatusChange({status:"Отчисленные"}, type), expected(short));
}
assert.match(app, /studentAdditionalStatuses:\s*\[[\s\S]*?STUDENT_EXPELLED_ADDITIONAL_STATUS/);
assert.match(app, /data\.dictionaries\.studentAdditionalStatuses = unique\(\[[\s\S]*?STUDENT_EXPELLED_ADDITIONAL_STATUS/);
assert.match(app, /previousStatus !== nextStatus\) \{\s*values\.additionalStatus = resolveStudentAdditionalStatusAfterMainStatusChange/);

async function importAndBulkChecks() {
  let program = {name:"Тестовая программа", type:"КПК"};
  const calls = [];
  const c = vm.createContext({
    getStudentApplicationProgram: () => program,
    getStudentApplicationFinancialTerms: () => ({paymentAmount:0,contractAmount:1000}),
    todayIso: () => "2026-09-28", makeId: () => "fixture", getStudentApplicationProgramTitle: () => "Тестовая программа",
    getStudentApplicationInferredProgramType: () => "ДОП", getApplicationSourceAgent: () => "", getCurrentUserLogin: () => "tester", getStudentApplicationSourceKey: () => "fixture-key",
    reuseExistingStudentPersonalData: record => ({...record,additionalStatus:"Обучающиеся"}),
    normalizeStudentGender: value => value, fillMissingPersonGender: record => record,
    calculateStudentFinance: record => record, applyStudentEventTemplateDefaults: record => record, addAutomaticStudentExpenses: record => ({record}),
    configs: { students:{collection:"students",title:"Слушатели"}, contracts:{collection:"contracts",title:"Сотрудники"} },
    getSelected: () => ["a","b"], document: { getElementById: () => ({value:"Отчисленные"}) },
    pollSharedRecordLocks: async () => {}, getRecordLock: () => null, recordLockEntityType: value => value,
    alert: () => {throw Error("Unexpected alert");}, findProgramByName: name => name === "registry-pro" ? {type:"ПРО"} : null,
    persist: () => calls.push("persist"), flushSharedApplicationState: async () => {calls.push("flush");return true;},
    addAudit: (...args) => calls.push(args), render: () => calls.push("render"), state: {data:{collections:{}}}
  });
  vm.runInContext(constants + "\n" + helpers + "\n" + extract("createStudentFromApplication") + "\n" + extract("bulkSetStatus"), c);
  for (const status of ["Отчислен", "Отчисленные"]) for (const type of ["КПК", "ППП", "ДОП", "ПРО"]) {
    program.type = type;
    const row = c.createStudentFromApplication({name:"Тестовый слушатель"}, 1, status);
    assert.equal(row.additionalStatus, expected(type));
    assert.equal(row.status, status);
  }
  program.type = "ПРО";
  assert.equal(c.createStudentFromApplication({name:"Тест"}, 1, "На зачисление").additionalStatus, "Вебинары");
  program = null;
  assert.equal(c.createStudentFromApplication({name:"Тест"}, 1, "Отчисленные").additionalStatus, "Отчисленные", "Fallback education type during import");
  c.state.data.collections.students = [
    {id:"a",status:"Учится",educationType:"КПК",additionalStatus:"Обучающиеся",notes:"Сохранить"},
    {id:"b",status:"Отчисленные",program:"registry-pro",educationType:"КПК",additionalStatus:"Вебинары"},
    {id:"other",status:"Учится",educationType:"ДОП",additionalStatus:"Обучающиеся"}
  ];
  await c.bulkSetStatus("students");
  assert.equal(c.state.data.collections.students[0].additionalStatus,"Отчисленные");
  assert.equal(c.state.data.collections.students[0].notes,"Сохранить");
  assert.equal(c.state.data.collections.students[1].additionalStatus,"Вебинары. Архив");
  assert.equal(c.state.data.collections.students[2].status,"Учится");
  assert.equal(c.state.data.collections.students[2].additionalStatus,"Обучающиеся");
  assert.match(calls[0][2], /«Отчисленные»: 1/);
  assert.match(calls[0][2], /«Вебинары\. Архив»: 1/);
  assert.deepEqual(calls.slice(1), ["persist","flush","render"]);
  const before = JSON.stringify(c.state.data.collections.students);
  c.getRecordLock = () => ({ownedByClient:false});
  c.formatRecordLockMessage = () => "locked";
  c.alert = () => calls.push("locked");
  await c.bulkSetStatus("students");
  assert.equal(JSON.stringify(c.state.data.collections.students),before);
  c.getRecordLock = () => null;
  c.state.data.collections.contracts = [{id:"a",educationType:"КПК",additionalStatus:"Сохранить"}];
  await c.bulkSetStatus("contracts");
  assert.equal(c.state.data.collections.contracts[0].additionalStatus,"Сохранить", "Student rules never affect employees");
}

async function browserChecks() {
  const {chromium} = require(process.env.PLAYWRIGHT_MODULE || "playwright");
  const browser = await chromium.launch({headless:true, ...(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {})});
  try {
    const page = await browser.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setContent('<form id="recordForm" data-config="students"><select name="status"><option>Учится</option><option>Отчислен</option><option>Отчисленные</option></select><select name="program"><option>КПК</option><option>ППП</option><option>ДОП</option><option>ПРО</option></select><input name="educationType" value="ПРО"><select name="additionalStatus"><option>Обучающиеся</option></select></form>');
    await page.addScriptTag({content: `
      const findProgramByName = value => ({type:value});
      ${constants}\n${helpers}\n${extract("syncProStudentAdditionalStatusControl")}
      window.inputEvents = 0;
      const recordForm = document.getElementById("recordForm");
      recordForm.elements.additionalStatus.addEventListener("input", () => inputEvents++);
      recordForm.addEventListener("change", event => {
        const targetName = event.target.name;
        if (["status", "program", "educationType"].includes(targetName)) syncProStudentAdditionalStatusControl(recordForm,{mainStatusChanged:targetName === "status"});
      });
    `});
    for (const status of ["Отчислен","Отчисленные"]) {
      for (const type of ["КПК","ППП","ДОП","ПРО"]) {
        await page.selectOption('[name="status"]', "Учится");
        await page.selectOption('[name="program"]', type);
        await page.selectOption('[name="status"]', status);
        assert.equal(await page.inputValue('[name="additionalStatus"]'), expected(type));
      }
    }
    await page.selectOption('[name="program"]', "КПК");
    assert.equal(await page.inputValue('[name="additionalStatus"]'), "Отчисленные", "Changing program of expelled student updates the archive group");
    assert.equal(await page.locator('[name="additionalStatus"] option').count(), 3, "No duplicate choices");
    assert.ok(await page.evaluate(() => inputEvents > 0), "Notify normal form dirty-state/formula listeners");
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
}
(async () => {
  await importAndBulkChecks();
  await browserChecks();
  console.log("PASS: expulsion aliases, all four program types, dictionary options, import, both bulk semantics, selected-only changes, registry priority, locks, audit/persistence and real browser form events");
})().catch(error => {console.error(error);process.exitCode=1;});

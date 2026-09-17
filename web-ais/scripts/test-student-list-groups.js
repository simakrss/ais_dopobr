"use strict";
// Pure/isolated UI fixture; never reads student storage or calls production APIs.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n/g, "\n");
const names = ["normalizeProgramName", "normalizeEducationProgramType", "getStudentContextProgram",
  "getStudentListGroups", "getStudentTableGroups", "getStudentCollapsedGroups", "getExpandedStudentGroupRows", "getStudentGroupPageEntries",
  "renderStudentGroupRow", "toggleStudentListGroup", "selectStudentListGroup", "bindStudentListGroups",
  "getTablePageSize", "getTablePagination", "getCurrentTablePageRows", "setTablePageForRow", "renderTablePagination",
  "isSingleLineTableValue", "getSingleLineTableColumnMinWidth", "renderTable",
  "getSelected", "setSelected", "toggleRowSelection", "toggleAllSelection"];
function extract(name) {
  const match = source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name);
  return match[0];
}
const functions = names.map(extract).join("\n");
const programs = [
  { id: "z", name: "Язык науки", shortName: "Язык", type: "ПРО" },
  { id: "a", name: "Автор статьи", type: "ПРО" },
  { id: "k", name: "Повышение квалификации", type: "КПК" },
  { id: "p", name: "Переподготовка", type: "ППП" },
  { id: "d", name: "Общеобразовательная программа", type: "ДОП" }
];
const rows = Array.from({ length: 65 }, (_, i) => ({
  id: `s${i}`, name: `Тестовый слушатель ${String(i + 1).padStart(2, "0")}`,
  programId: i < 55 ? "a" : i < 60 ? "z" : ["k", "p", "d", "missing", "k"][i - 60],
  program: i < 55 ? "Автор статьи" : i < 60 ? "Язык науки" : "Учебная программа",
  status: "На зачисление", applicationDate: "16.09.2026", phone: "+79000000000"
}));
const setup = `
var rows = ${JSON.stringify(rows)}, programs = ${JSON.stringify(programs)};
var state = {view:"students", data:{collections:{programs,students:rows}}, tableSettings:{}, tablePages:{}, selected:{}, sort:{}};
var configs = {students:{collection:"students", fields:[{key:"name",label:"ФИО"},{key:"program",label:"Программа"},{key:"applicationDate",label:"Дата",type:"date"},{key:"phone",label:"Телефон",type:"tel"}]}};
var TABLE_PAGE_SIZE_OPTIONS=[50,100,250],DEFAULT_TABLE_PAGE_SIZE=50;
var filter="", rendered=0, persisted=0;
function render(){rendered++;}
function persistTableSettings(){persisted++;}
function getVisibleRows(){return rows.filter(row => !filter || row.name.includes(filter));}
function unique(items){return [...new Set(items)];}
function escapeHtml(value){return String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
var escapeAttr=escapeHtml;
function getTableFields(config){return config.fields;}
function renderTableValueFilterChips(){return "";}
function getRecordLock(){return null;}
function recordLockEntityType(id){return id;}
function isStudentTrainingDeadlinePassed(){return false;}
function getTableCellValue(config,row,key){return row[key];}
function valueForDisplay(key,value){return String(value ?? "—");}
function columnDataAttrs(){return "";}
function columnStyleAttr(){return "";}
function tableValueFilterDataAttrs(){return "";}
`;
const context = vm.createContext({ console });
vm.runInContext(setup + functions, context);
const plain = (value) => JSON.parse(JSON.stringify(value));
const ids = (items) => Array.from(items, (row) => row.id);
const groups = context.getStudentListGroups(context.rows);
assert.deepEqual(Array.from(groups, g => g.key), ["pro", "other", "unknown"]);
assert.deepEqual(Array.from(groups[0].children, g => g.label), ["Автор статьи", "Язык науки"]);
assert.deepEqual(Array.from(groups, g => g.rows.length), [60, 4, 1]);
assert.equal(context.getExpandedStudentGroupRows(groups, new Set()).length, 65);
assert.equal(context.getExpandedStudentGroupRows(groups, new Set(["pro"])).length, 5);
assert.equal(context.getExpandedStudentGroupRows(groups, new Set(["pro:id:a"])).length, 10);
assert.deepEqual(plain(context.rows), rows, "Grouping must not mutate rows");

let html = context.renderTable(context.configs.students, context.rows, "students");
assert.equal((html.match(/data-webinar-student-id=/g) || []).length, 50);
assert.match(html, /Автор статьи/);
assert.match(html, /aria-expanded="true"/);
assert.match(html, /Показано 1–50 из 65/);
context.selectStudentListGroup("pro:id:a", true);
assert.equal(context.getSelected("students").length, 55, "Group selection includes later pages");
context.toggleRowSelection("students", "s0", false);
html = context.renderTable(context.configs.students, context.rows, "students");
assert.match(html, /data-student-group="pro:id:a"[^>]*data-indeterminate="true"/);
context.toggleStudentListGroup("pro");
assert.equal(context.getSelected("students").length, 54, "Collapse preserves selection");
html = context.renderTable(context.configs.students, context.rows, "students");
assert.equal((html.match(/data-webinar-student-id=/g) || []).length, 5);
assert.match(html, /data-student-group="pro"[^>]*aria-expanded="false"/);
context.selectStudentListGroup("pro", true);
assert.equal(context.getSelected("students").length, 60, "Collapsed parent selects all children");
context.selectStudentListGroup("other", true);
context.filter = "01";
context.selectStudentListGroup("pro", false);
assert.equal(context.getSelected("students").length, 63, "Only filtered members are deselected");
assert.ok(context.getSelected("students").includes("s60"), "Unrelated selection is preserved");
context.filter = "";
context.toggleAllSelection("students", false);
assert.equal(context.getSelected("students").length, 0);
context.toggleStudentListGroup("other");
context.toggleStudentListGroup("unknown");
html = context.renderTable(context.configs.students, context.rows, "students");
assert.equal((html.match(/data-webinar-student-id=/g) || []).length, 0);
assert.equal((html.match(/data-action="toggle-student-group"/g) || []).length, 3, "All-collapsed table keeps headings");
context.setTablePageForRow("students", "s56");
assert.equal(context.getStudentCollapsedGroups().has("pro"), false);
assert.equal(context.state.tablePages.students, 2);
html = context.renderTable(context.configs.students, context.rows, "students");
assert.match(html, /data-webinar-student-id="s56"/);
assert.match(html, /Показано 51–60 из 60/);
context.toggleStudentListGroup("pro:id:z");
context.setTablePageForRow("students", "s56");
assert.equal(context.getStudentCollapsedGroups().has("pro:id:z"), false, "Returning to record expands ancestors");
context.toggleStudentListGroup("pro:id:a");
context.setTablePageForRow("students", "s56");
assert.equal(context.state.tablePages.students, 1, "Page position counts only expanded students");

// Current filters, not the whole registry, determine whether to group.
context.filter = "61";
const collapsedBefore = JSON.stringify(context.state.tableSettings.students.collapsedGroups);
html = context.renderTable(context.configs.students, context.getVisibleRows(), "students");
assert.doesNotMatch(html, /student-list-group|toggle-student-group/);
assert.match(html, /data-webinar-student-id="s60"/);
context.setTablePageForRow("students", "s60");
assert.equal(JSON.stringify(context.state.tableSettings.students.collapsedGroups), collapsedBefore);
assert.equal(context.getStudentTableGroups([]), null);
const savedRows = context.rows;
context.rows = Array.from({length: 65}, (_, i) => ({id:`k${i}`,name:`КПК ${i}`,programId:"k"}));
context.filter = "";
context.setTablePageForRow("students", "k64");
assert.equal(context.state.tablePages.students, 2);
html = context.renderTable(context.configs.students, context.rows, "students");
assert.doesNotMatch(html, /student-list-group/);
assert.match(html, /data-webinar-student-id="k64"/);
context.toggleAllSelection("students", true);
assert.equal(context.getSelected("students").length, 65);
context.toggleAllSelection("students", false);
context.rows = savedRows;

const special = context.getStudentListGroups([
  { id: "r1", program: "Язык" },
  { id: "r2", programId: "k", educationType: "ПРО", program: "Язык науки" },
  { id: "r3", programId: "stale", program: "Язык науки" },
  { id: "r4", program: "Архивный вебинар", educationType: "ПРО" },
  { id: "r5", educationType: "ИТ" }
]);
assert.deepEqual(Array.from(special, g => g.rows.length), [2, 1, 2], "Registry identity wins over stale row labels/types");
const duplicates = context.getStudentListGroups([
  { id: "x", programId: "x" }, { id: "y", programId: "y" }, { id: "ambiguous", program: "Одинаковое" }
], [{ id: "x", name: "Одинаковое", type: "ПРО" }, { id: "y", name: "Одинаковое", type: "КПК" }]);
assert.deepEqual(Array.from(duplicates, g => g.rows.length), [1, 1, 1], "Ambiguous names cannot silently select a program");
const sameTitles = context.getStudentListGroups([{ id: "1", programId: "1" }, { id: "2", programId: "2" }],
  [{ id: "1", name: "Одинаковое", type: "ПРО" }, { id: "2", name: "Одинаковое", type: "ПРО" }]);
assert.equal(sameTitles[0].children.length, 2);
const escaped = context.renderStudentGroupRow({group:{key:'x"',label:'<img src=x onerror=alert(1)>',rows:[{id:"1"}]},collapsed:false},4,[]);
assert.doesNotMatch(escaped, /<img/);
assert.match(escaped, /&lt;img/);
assert.equal(context.renderTable(context.configs.students, [], "students").includes("Записей нет"), true);
context.state.tablePages = {};
context.getProgramTrainingPlanHoursSummary = () => ({});
const otherTable = context.renderTable({collection:"programs",fields:[{key:"name",label:"Название"}]},[{id:"p1",name:"Курс"}],"programs");
assert.doesNotMatch(otherTable, /student-list-group/);
// DOM binding: indeterminate is a property, not a supported HTML attribute.
const listeners = {};
const checkbox = {dataset:{indeterminate:"true",studentGroup:"pro"},checked:true,addEventListener:(name,fn)=>{listeners[name]=fn;}};
context.document = {querySelectorAll:selector=>selector.includes("select-student-group")?[checkbox]:[]};
context.bindStudentListGroups();
assert.equal(checkbox.indeterminate, true);
listeners.change();
assert.equal(context.getSelected("students").length, 60);
console.log("PASS: student grouping, sorting, pagination, filtered/nested selection, persistence, return-to-row, escaping and DOM bindings");

if (process.argv.includes("--serve")) {
  const http = require("node:http");
  const browserScript = setup + functions + `
    state.tableSettings=JSON.parse(localStorage.getItem("group-fixture-settings")||"{}");
    persistTableSettings=()=>localStorage.setItem("group-fixture-settings",JSON.stringify(state.tableSettings));
    render=()=>{
      document.querySelector("#selected").textContent="Выбрано: "+getSelected("students").length;
      document.querySelector("#table").innerHTML=renderTable(configs.students,getVisibleRows(),"students");
      bindStudentListGroups();
      document.querySelectorAll('[data-action="toggle-row-selection"]').forEach(el=>el.onchange=()=>toggleRowSelection("students",el.dataset.id,el.checked));
      document.querySelectorAll('[data-action="toggle-all-selection"]').forEach(el=>el.onchange=()=>toggleAllSelection("students",el.checked));
      document.querySelectorAll('[data-action="table-page"]').forEach(el=>el.onclick=()=>{state.tablePages.students=Number(el.dataset.page);render();});
      document.querySelector('[data-action="table-page-size"]')?.addEventListener('change',event=>{state.tableSettings.students={...state.tableSettings.students,pageSize:Number(event.target.value)};render();});
    };
    document.querySelector('#filter').oninput=event=>{filter=event.target.value;state.tablePages.students=1;render();};
    render();
  `;
  const server = http.createServer((req,res)=>{
    if (req.url === "/styles.css") {res.setHeader("Content-Type","text/css");return res.end(fs.readFileSync(path.join(root,"styles.css")));}
    if (req.url === "/fixture.js") {res.setHeader("Content-Type","text/javascript");return res.end(browserScript);}
    res.setHeader("Content-Type","text/html; charset=utf-8");
    res.end('<!doctype html><html lang="ru"><title>Группировка слушателей — тест</title><link rel="stylesheet" href="styles.css"><body style="padding:16px"><h2>Слушатели — тестовые данные</h2><label>Поиск <input id="filter"></label><p id="selected"></p><section id="table" class="collection-register"></section><script src="fixture.js"></script></body></html>');
  });
  server.listen(0,"127.0.0.1",()=>console.log(`Groups UI fixture: http://127.0.0.1:${server.address().port}/`));
}

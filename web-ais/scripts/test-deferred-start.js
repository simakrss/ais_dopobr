"use strict";
// Synthetic students only: no production data, API requests or persistent writes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n/g, "\n");
function extract(name) {
  const match = source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name);
  return match[0];
}
const names = ["isStudentAwaitingEnrollment", "isStudentDeferredStart", "getDeferredStartSummary",
  "renderDeferredStartDashboardTile", "openDeferredStartStudents", "refreshDashboardCalendarDay",
  "calculateDaysUntilDate", "parseTableSortDate", "todayIso", "dateRu",
  "normalizeProgramName", "normalizeEducationProgramType", "getStudentContextProgram", "getStudentListGroups",
  "getStudentTableGroups", "getRegistryCollapsedGroups", "saveRegistryGroupExpansion", "getStudentCollapsedGroups",
  "renderStudentGroupRow", "toggleStudentListGroup", "selectStudentListGroup", "bindStudentListGroups"];
const functions = names.map(extract).join("\n");
const students = [
  { id: "five", name: "Тестовый слушатель — через 5 дней", startDate: "2026-09-27" },
  { id: "six", name: "Тестовый слушатель — через 6 дней", startDate: "2026-09-28" },
  { id: "today", name: "Тестовый слушатель — сегодня", startDate: "22.09.2026" },
  { id: "past", name: "Тестовый слушатель — старт наступил", startDate: "2026-09-21" },
  { id: "empty", name: "Без даты", startDate: "" },
  { id: "bad", name: "Некорректная дата", startDate: "не дата" },
  { id: "normal", name: "Обычная заявка", startDate: "2026-09-25", additionalStatus: "Документы отправлены" },
  { id: "learning", name: "Уже учится", startDate: "2026-09-25", status: "Учится" }
].map((student) => ({ status: "На зачисление", additionalStatus: "На зачисление (отложенный старт)", educationType: "КПК", program: "Тестовая программа", ...student }));
const setup = `
var state={view:'dashboard',modal:null,data:{collections:{students:${JSON.stringify(students)},programs:[]}},tableSettings:{},tablePages:{},selected:{students:[]}};
var configs={students:{collection:'students'}};
var denied=false,rendered=0,persisted=0,cleared=[],statusHistory=[];
function canAccessView(){return !denied;}
function pushStudentStatusHistory(status){statusHistory.push(status);}
function clearTableValueFilter(id){cleared.push(id);}
function getStudentStatusTableSort(){return {key:'applicationDate',dir:'asc'};}
function persistTableSettings(){persisted++;}
function render(){rendered++;}
function unique(items){return [...new Set(items)];}
function getVisibleRows(){return state.data.collections.students.filter(isStudentAwaitingEnrollment);}
function getSelected(){return state.selected.students;}
function setSelected(config,ids){state.selected[config]=ids;}
function escapeHtml(value){return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
var escapeAttr=escapeHtml;
`;
let now = new Date(2026, 8, 22, 23, 59).getTime();
class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } }
let overlay = false;
const tileRow = { dataset: { dashboardCalendarDate: "2026-09-22" } };
const document = { visibilityState: "visible", querySelector: (selector) => selector === ".modal-backdrop" ? (overlay ? {} : null) : tileRow };
const c = vm.createContext({ Date: ClockDate, document });
vm.runInContext(setup + functions, c);
const plain = (value) => JSON.parse(JSON.stringify(value));
assert.deepEqual(plain(c.getDeferredStartSummary()), { enrollmentCount: 7, deferredCount: 6, dueCount: 3, upcomingCount: 1, startedCount: 2 });
let html = c.renderDeferredStartDashboardTile();
assert.match(html, /<strong>3<\/strong>/);
assert.match(html, /Всего на зачисление: <b>7<\/b>/);
assert.match(html, /Старт уже наступил: 2/);
assert.match(html, /data-action="open-deferred-start-students"/);
assert.equal(c.isStudentDeferredStart({ status: " НА ЗАЧИСЛЕНИЕ ", additionalStatus: " отложённый\u00a0 старт " }), true);
assert.equal(c.isStudentDeferredStart({ status: "На зачисление", additionalStatus: "На зачисление (отложенный старт)" }), true);
assert.equal(c.isStudentDeferredStart({ status: "Учится", additionalStatus: "Отложенный старт" }), false);
assert.equal(c.isStudentDeferredStart({ status: "На зачисление", additionalStatus: "Не отложенный старт" }), false);
const originalRows = c.state.data.collections.students;
for (const id of ["six", "empty", "bad", "normal", "learning"]) {
  c.state.data.collections.students = originalRows.filter((student) => student.id === id);
  assert.equal(c.renderDeferredStartDashboardTile(), "", id + " does not trigger a tile");
}
c.state.data.collections.students = [];
assert.equal(c.renderDeferredStartDashboardTile(), "");
c.state.data.collections.students = originalRows;
now = new Date(2026, 8, 23, 0, 1).getTime();
assert.equal(c.getDeferredStartSummary().dueCount, 4, "The sixth day becomes the fifth at midnight");
for (const [year, month, day, target] of [[2026, 11, 29, "2027-01-03"], [2028, 1, 25, "01.03.2028"], [2026, 8, 30, "2026-10-05"]]) {
  now = new Date(year, month, day, 23, 59).getTime();
  assert.equal(c.calculateDaysUntilDate(target), 5, "Calendar days, not elapsed 24-hour periods");
}
now = new Date(2026, 8, 22, 12).getTime();
c.state.search = "old query";
c.state.studentListFilters = { programs: ["unrelated"], dateFrom: "2026-10-01" };
c.state.studentImportedViewIds = ["hidden"];
c.state.studentProgramTypeFilter = ["ПРО"];
c.state.selected.students = ["normal"];
c.state.tableSettings.students = { collapsedGroups: ["deferred-start", "other"], widths: { name: 100 } };
c.openDeferredStartStudents();
assert.equal(c.state.view, "students");
assert.equal(c.state.statusFilter, "На зачисление");
assert.equal(c.state.search, "");
assert.deepEqual(plain(c.state.studentListFilters), { programs: [], dateField: "", datePeriod: "", dateFrom: "", dateTo: "" });
assert.equal(c.state.studentImportedViewIds.length, 0);
assert.equal(c.state.studentProgramTypeFilter.length, 0);
assert.equal(c.getStudentCollapsedGroups().has("deferred-start"), false);
assert.equal(c.getStudentCollapsedGroups().has("other"), true);
assert.deepEqual(plain(c.state.selected.students), ["normal"], "Opening the group must not change selection");
assert.equal(c.state.tableSettings.students.widths.name, 100);
assert.deepEqual(plain(c.cleared), ["students"]);
const beforeDenied = JSON.stringify(c.state);
c.denied = true;
c.openDeferredStartStudents();
assert.equal(JSON.stringify(c.state), beforeDenied);
c.denied = false;
c.state.view = "dashboard";
let renderCount = c.rendered;
c.refreshDashboardCalendarDay();
assert.equal(c.rendered, renderCount, "No gratuitous render during the same day");
tileRow.dataset.dashboardCalendarDate = "2026-09-21";
c.state.modal = {};
c.refreshDashboardCalendarDay();
assert.equal(c.rendered, renderCount, "Do not interrupt a card");
c.state.modal = null;
overlay = true;
c.refreshDashboardCalendarDay();
assert.equal(c.rendered, renderCount, "Do not interrupt a dialog");
overlay = false;
document.visibilityState = "hidden";
c.refreshDashboardCalendarDay();
assert.equal(c.rendered, renderCount);
document.visibilityState = "visible";
c.refreshDashboardCalendarDay();
assert.equal(c.rendered, renderCount + 1);
assert.match(source, /setInterval\(refreshDashboardCalendarDay, 60000\)/);
assert.match(source, /\[data-action='open-deferred-start-students'\].*addEventListener\("click", openDeferredStartStudents\)/);
console.log("Deferred starts: status/group eligibility, five-day boundary, missing dates, total counts, leap/year boundaries, navigation and daily refresh: OK");

if (process.argv.includes("--serve")) {
  const start = source.indexOf('      <div class="dashboard-document-tasks ');
  const end = source.indexOf('      <section class="panel">', start);
  const browserScript = setup + functions + `
    calculateDaysUntilDate=value=>{const date=parseTableSortDate(value);return date===null?'':Math.round((date-Date.UTC(2026,8,22))/86400000);};
    function renderTasks(){
      const deferredStartDashboardTile=renderDeferredStartDashboardTile();
      const attestationDashboardTile='<button class="panel dashboard-attestation-tile"><span class="eyebrow">Ведомости и протоколы</span><strong>4</strong><small>Ведомости КПК / ППП: 2<br>Протоколы ППП: 2</small></button>';
      const pendingIssuedDocuments=Array(6).fill({}),frdoWidgetTone='',frdoDeadlineDays=30,overdueIssuedDocumentsCount=0,frdoDeadlineLabel='До ближайшего срока: 28 дн.',frdoDaysIndicatorLabel='Осталось дней: 28';
      return \`${source.slice(start, end)}\`;
    }
    render=()=>{
      const host=document.querySelector('#fixture');
      if(state.view==='dashboard'){
        host.innerHTML=renderTasks();
        host.querySelector('[data-action="open-deferred-start-students"]')?.addEventListener('click',openDeferredStartStudents);
      }else{
        const groups=getStudentTableGroups(getVisibleRows()),collapsed=getStudentCollapsedGroups(groups);
        host.innerHTML='<h2>На зачисление</h2><p>Выбрано: '+getSelected('students').length+'</p><table class="data-table"><thead><tr><th></th><th>Слушатель</th><th>Начало обучения</th></tr></thead><tbody>'+groups.map(group=>renderStudentGroupRow({group,collapsed:collapsed.has(group.key)},2,getSelected('students'))+(collapsed.has(group.key)?'':group.rows.map(row=>'<tr><td></td><td>'+escapeHtml(row.name)+'</td><td>'+escapeHtml(row.startDate||'—')+'</td></tr>').join(''))).join('')+'</tbody></table>';
        bindStudentListGroups();
      }
    };
    document.querySelector('#dashboard').onclick=()=>{state.view='dashboard';render();};
    document.querySelector('#narrow').onclick=()=>{const host=document.querySelector('#fixture');host.style.maxWidth=host.style.maxWidth?'':'720px';};
    render();
  `;
  const http = require("node:http");
  const server = http.createServer((req, res) => {
    if (req.url === "/styles.css") { res.setHeader("Content-Type", "text/css"); return res.end(fs.readFileSync(path.join(root, "styles.css"))); }
    if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(browserScript); }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end('<!doctype html><html lang="ru"><title>Отложенный старт — тест</title><link rel="stylesheet" href="styles.css"><body style="padding:16px"><h2>Тест: 22 сентября 2026, вымышленные данные</h2><button id="dashboard">Рабочий стол</button><button id="narrow">Узкая область</button><div id="fixture" style="margin-top:16px"></div><script src="fixture.js"></script></body></html>');
  });
  server.listen(0, "127.0.0.1", () => console.log('Deferred start fixture: http://127.0.0.1:' + server.address().port + '/'));
}

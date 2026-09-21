"use strict";
// Isolated tests/optional browser fixture; never read or change production records.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n/g, "\n");
const names = [
  "normalizeEmployeeActPersonName", "parseTableSortDate", "getEmployeeContractGroups",
  "getEmployeeContractCollapsedGroups", "getExpandedEmployeeContractRows", "getEmployeeContractPageEntries",
  "renderEmployeeContractGroupRow", "toggleEmployeeContractGroup", "selectEmployeeContractGroup", "bindEmployeeContractGroups",
  "getTablePageSize", "getTablePagination", "getCurrentTablePageRows", "setTablePageForRow", "renderTablePagination",
  "isSingleLineTableValue", "getSingleLineTableColumnMinWidth", "renderTable",
  "getSelected", "setSelected", "toggleRowSelection", "toggleAllSelection",
  "getContractNavigationRows", "getContractCardNavigation", "getContractNavigationTarget"
];
const functions = names.map(name => {
  const match = source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name);
  return match[0];
}).join("\n");
const employee = "Иванов Иван Иванович";
const key = "employee:иванов иван иванович";
const sample = [
  {id: "old", name: employee, contractDate: "05.09.2024", contractNo: "101"},
  {id: "single", name: "Петров Пётр Петрович", contractDate: "2026-09-20", contractNo: "102"},
  {id: "new", name: " Иванов  Иван Иванович ", contractDate: "2026-09-21", contractNo: "103"},
  {id: "recent", name: "ИВАНОВ ИВАН ИВАНОВИЧ", contractDate: "18.09.2026", contractNo: "104"},
  {id: "invalid", name: employee, contractDate: "не дата", contractNo: "105"},
  {id: "unnamed1", name: "", contractDate: "", contractNo: "106"},
  {id: "unnamed2", name: " ", contractDate: "2026-01-01", contractNo: "107"}
];
const setup = `
var rows=${JSON.stringify(sample)};
var state={view:"contracts",data:{collections:{contracts:rows}},tableSettings:{},tablePages:{},selected:{},sort:{}};
var configs={contracts:{collection:"contracts",fields:[{key:"name",label:"ФИО"},{key:"contractNo",label:"Договор"},{key:"contractDate",label:"Дата договора",type:"date"}]}};
var TABLE_PAGE_SIZE_OPTIONS=[50,100,250],DEFAULT_TABLE_PAGE_SIZE=50;
var filter="", filterIds=null, persisted=0, rendered=0;
function render(){rendered++;}
function persistTableSettings(){persisted++;}
function getVisibleRows(){return rows.filter(row=>(!filter||[row.name,row.contractNo].join(" ").toLowerCase().includes(filter.toLowerCase()))&&(!filterIds||filterIds.includes(row.id)));}
function unique(items){return [...new Set(items)];}
function escapeHtml(value){return String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
var escapeAttr=escapeHtml;
function getTableFields(config){return config.fields;}
function renderTableValueFilterChips(){return "";}
function getRecordLock(){return null;}
function recordLockEntityType(id){return id;}
function isChecked(value){return Boolean(value);}
function getTableCellValue(config,row,key){return row[key];}
function valueForDisplay(key,value){return String(value??"—");}
function columnDataAttrs(){return "";}
function columnStyleAttr(){return "";}
function tableValueFilterDataAttrs(){return "";}
`;
const context = vm.createContext({console});
vm.runInContext(setup + functions, context);
const ids = rows => Array.from(rows, row => row.id);
const render = () => context.renderTable(context.configs.contracts, context.getVisibleRows(), "contracts");
const renderedIds = html => [...html.matchAll(/data-action="edit" data-config="contracts" data-id="([^"]+)"/g)].map(match => match[1]);
const snapshot = JSON.stringify(context.rows);
const groups = context.getEmployeeContractGroups(context.rows);
assert.equal(groups.length, 4, "Blank employee names are not combined");
assert.deepEqual(ids(groups[0].rows), ["new", "recent", "old", "invalid"], "ISO/Russian dates descend; missing or invalid dates go last");
assert.equal(JSON.stringify(context.rows), snapshot, "Grouping must not mutate records or source order");
assert.deepEqual(ids(context.getEmployeeContractGroups([{id:"a",name:employee,contractDate:""},{id:"b",name:employee,contractDate:"2026-01-01"},{id:"c",name:employee,contractDate:"2026-01-01"}])[0].rows), ["b","c","a"], "Equal dates keep stable order");
let html = render();
assert.equal((html.match(/data-action="toggle-employee-contract-group"/g) || []).length, 1);
assert.match(html, /Договоров: 4/);
assert.deepEqual(renderedIds(html), ["new", "recent", "old", "invalid", "single", "unnamed1", "unnamed2"]);
assert.deepEqual(ids(context.getContractNavigationRows()), renderedIds(html), "Card navigation follows grouped table order");
assert.equal(context.getContractNavigationTarget("new", 1).id, "recent");
assert.equal(context.getContractNavigationTarget("new", -1), null);
assert.equal(context.getContractCardNavigation({id:"recent"}).index, 1);
context.toggleRowSelection("contracts", "new", true);
assert.match(render(), /data-employee-contract-group="employee:иванов иван иванович"[^>]*data-indeterminate="true"/);
context.selectEmployeeContractGroup(key, true);
assert.equal(context.getSelected("contracts").length, 4);
context.state.tableSettings.contracts = {pageSize:50,customColumns:["name"]};
context.toggleEmployeeContractGroup(key);
assert.deepEqual(renderedIds(render()), ["single", "unnamed1", "unnamed2"]);
assert.equal(context.getSelected("contracts").length, 4, "Collapsing preserves selection");
assert.equal(context.state.tableSettings.contracts.customColumns[0], "name", "Other table preferences survive");
assert.ok(context.persisted > 0);
assert.match(render(), /aria-expanded="false"/);
context.filter = "101";
html = render();
assert.doesNotMatch(html, /employee-contract-group/, "One filtered contract has no group, even if its group was collapsed");
assert.deepEqual(renderedIds(html), ["old"]);
context.selectEmployeeContractGroup(key, false);
assert.deepEqual(ids(context.getSelected("contracts").map(id => ({id}))).sort(), ["invalid","new","recent"], "Group action respects filters");
context.filter = "";
context.setTablePageForRow("contracts", "recent");
assert.equal(context.getEmployeeContractCollapsedGroups().has(key), false, "Returning to a card expands its group");
assert.ok(renderedIds(render()).includes("recent"));
context.filterIds = [];
assert.match(render(), /Записей нет/);
context.filterIds = null;
const escaped = context.renderEmployeeContractGroupRow({group:{key:'x"',label:'<img src=x>',rows:[{id:"x"},{id:"y"}]},collapsed:false},3,[]);
assert.doesNotMatch(escaped, /<img/);
assert.match(escaped, /&lt;img/);
assert.match(escaped, /colspan="3"/);

// Multiple pages: all selection paths must use the same grouping/date order.
const many = Array.from({length:55}, (_, i) => ({id:`a${i}`, name:employee,contractNo:`A${i}`,contractDate:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10)}));
context.rows = [...many.slice(0,5),{id:"solo",name:"Один договор",contractDate:"2025-01-01"},...many.slice(5),
  ...Array.from({length:3},(_,i)=>({id:`b${i}`,name:"Другой сотрудник",contractDate:`2026-09-0${i+1}`}))];
context.state.data.collections.contracts = context.rows;
context.state.selected = {};
context.state.tableSettings = {};
context.state.tablePages = {};
assert.deepEqual(renderedIds(render()), Array.from({length:50},(_,i)=>`a${54-i}`));
context.toggleAllSelection("contracts", true);
assert.deepEqual(Array.from(context.getSelected("contracts")), renderedIds(render()), "Select-page selects exactly rendered rows");
context.state.tablePages.contracts=2;
assert.match(render(), /Показано 51–59 из 59/);
assert.deepEqual(renderedIds(render()), ["a4","a3","a2","a1","a0","solo","b2","b1","b0"]);
assert.equal((render().match(/data-action="toggle-employee-contract-group"/g)||[]).length, 2, "Split group repeats its heading on next page");
context.selectEmployeeContractGroup(key, true);
assert.equal(context.getSelected("contracts").length, 55, "Group selection spans pages");
context.toggleEmployeeContractGroup(key);
assert.deepEqual(renderedIds(render()), ["solo","b2","b1","b0"]);
context.toggleAllSelection("contracts", true);
assert.equal(context.getSelected("contracts").length, 59);
context.toggleAllSelection("contracts", false);
assert.equal(context.getSelected("contracts").length, 55, "Select-page excludes collapsed contracts");
context.selectEmployeeContractGroup(key, false);
assert.equal(context.getSelected("contracts").length, 0, "Collapsed group can be deselected");
context.toggleEmployeeContractGroup("employee:другой сотрудник");
assert.deepEqual(renderedIds(render()), ["solo"]);
context.setTablePageForRow("contracts", "a0");
assert.equal(context.state.tablePages.contracts, 2);
assert.ok(renderedIds(render()).includes("a0"));
assert.equal(context.getEmployeeContractCollapsedGroups().has("employee:другой сотрудник"), true, "Other collapsed groups stay collapsed");
context.filterIds = ["a0","a1"];
context.selectEmployeeContractGroup(key, true);
assert.deepEqual(Array.from(context.getSelected("contracts")).sort(), ["a0","a1"]);
context.filterIds = ["solo"];
assert.doesNotMatch(render(), /employee-contract-group/);
context.filterIds = [];
assert.equal(context.getContractNavigationRows().length, 59, "Existing navigation fallback is retained");
context.filterIds = null;
context.rows = context.rows.filter(row=>row.id!=="solo");
context.toggleEmployeeContractGroup(key);
html = render();
assert.equal(renderedIds(html).length, 0);
assert.equal((html.match(/data-action="toggle-employee-contract-group"/g)||[]).length, 2, "All-collapsed list keeps reopen controls");

const listeners = {};
const checkbox = {dataset:{indeterminate:"true",employeeContractGroup:key},checked:true,addEventListener:(event,fn)=>{listeners[event]=fn;}};
context.document = {querySelectorAll:selector=>selector.includes("select-employee-contract-group")?[checkbox]:[]};
context.bindEmployeeContractGroups();
assert.equal(checkbox.indeterminate, true);
listeners.change();
assert.equal(context.getSelected("contracts").length, 55);
assert.match(source, /bindStudentListGroups\(\);\s*bindEmployeeContractGroups\(\);/u);
console.log("PASS: employee groups, singletons, date order, normalization, empty names, pagination, selection, collapse persistence, filtering, navigation, escaping and DOM bindings");

if (process.argv.includes("--serve")) {
  const browserScript = setup + functions + `
    state.tableSettings=JSON.parse(localStorage.getItem("employee-group-fixture-settings")||"{}");
    persistTableSettings=()=>localStorage.setItem("employee-group-fixture-settings",JSON.stringify(state.tableSettings));
    render=()=>{
      document.querySelector('#selected').textContent='Выбрано договоров: '+getSelected('contracts').length;
      document.querySelector('#table').innerHTML=renderTable(configs.contracts,getVisibleRows(),'contracts');
      bindEmployeeContractGroups();
      document.querySelectorAll('[data-action="toggle-row-selection"]').forEach(el=>el.onchange=()=>toggleRowSelection('contracts',el.dataset.id,el.checked));
      document.querySelector('[data-action="toggle-all-selection"]')?.addEventListener('change',event=>toggleAllSelection('contracts',event.target.checked));
      document.querySelectorAll('[data-action="edit"]').forEach(el=>el.onclick=()=>{const row=rows.find(row=>row.id===el.dataset.id);document.querySelector('#card').textContent='Открыт договор '+row.contractNo+' от '+row.contractDate;});
    };
    document.querySelector('#filter').oninput=event=>{filter=event.target.value;state.tablePages.contracts=1;render();};
    render();
  `;
  const server=require("node:http").createServer((request,response)=>{
    response.setHeader("Cache-Control","no-store");
    if(request.url==="/styles.css"){response.setHeader("Content-Type","text/css");return response.end(fs.readFileSync(path.join(root,"styles.css")));}
    if(request.url==="/fixture.js"){response.setHeader("Content-Type","text/javascript");return response.end(browserScript);}
    response.setHeader("Content-Type","text/html; charset=utf-8");
    response.end('<!doctype html><html lang="ru"><title>Группировка договоров — тест</title><link rel="stylesheet" href="styles.css"><body style="padding:16px"><h2>Сотрудники — тестовые данные</h2><label>Поиск <input id="filter"></label><p id="selected"></p><section id="table" class="collection-register"></section><p id="card"></p><script src="fixture.js"></script></body></html>');
  });
  server.listen(0,"127.0.0.1",()=>console.log(`Employee groups UI fixture: http://127.0.0.1:${server.address().port}/`));
}

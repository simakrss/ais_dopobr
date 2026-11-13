"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.resolve(__dirname, ".."), source = fs.readFileSync(path.join(root, "app.js"), "utf8");
function extract(name) { const match = source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`, "m")); assert.ok(match, name); return match[0]; }
const currentDate = "2026-11-13", daysAgo = days => new Date(Date.parse(currentDate + "T00:00:00Z") - days * 86400000).toISOString().slice(0,10);
const rows = [
  { id: "overdue", counterparty: "Просроченный", bkExpenseNo: "101", date: daysAgo(76), paid: currentDate, amount: 100, section: "Организации", workType: "Аренда" },
  { id: "today", counterparty: "Сегодня", bkExpenseNo: "102", date: daysAgo(75), amount: 200, section: "Физлица", workType: "Услуги" },
  { id: "tomorrow", counterparty: "Завтра", bkExpenseNo: 103, date: daysAgo(74), amount: 300, section: "Организации", workType: "Услуги" },
  { id: "undated", counterparty: "Нет даты", bkExpenseNo: "104", date: "", amount: 400, section: "Организации" },
  { id: "personal", counterparty: "Личная", bkExpenseNo: "  ЛИЧНАЯ  КАРТА ", date: daysAgo(100), section: "Организации", workType: "Аренда" },
  { id: "empty", counterparty: "Без номера", bkExpenseNo: "", date: daysAgo(100), section: "Организации" },
  ...[true, "+", "Да", 1].map((value, i) => ({ id: `closed-${i}`, bkExpenseNo: "200", date: daysAgo(100), accountingClosed: value, section: "Организации" }))
];
const state = { view: "generalExpenses", data: { collections: { generalExpenses: rows } }, search: "", statusFilter: "Все", sort: { key: "" },
  generalExpenseNumberFilter: [], generalExpenseSectionFilter: [], generalExpenseWorkTypeFilter: [], tablePages: {}, tableValueFilters: {} };
const config = { collection: "generalExpenses", fields: [] }, escapeHtml = text => String(text ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const context = vm.createContext({ state, configs: { generalExpenses: config }, GENERAL_EXPENSE_SECTIONS: ["Организации", "Физлица"],
  getRowsForConfig: () => rows, getTableConfigId: () => "generalExpenses", getStudentListSelectedPrograms: () => [],
  getRegistryRowSearchText: row => JSON.stringify(row).toLowerCase(), normalizeEducationProgramType: value => value || "", findProgramByName: () => null,
  normalizeContractSection: value => value || "", normalizeGeneralExpenseSection: value => value || "Организации", filterRowsByTableValueFilters: value => value,
  getGeneralExpenseDuplicateIds: () => [], todayIso: () => currentDate, canAccessView: () => true, escapeHtml, escapeAttr: escapeHtml });
const names = ["isGeneralExpensePersonalCard", "isChecked", "parseTableSortDate", "getGeneralExpenseNumberGroup", "matchesGeneralExpenseNumberFilter", "formatGeneralExpenseMultiFilterLabel", "renderGeneralExpenseNumberFilter", "getVisibleRows", "getGeneralExpenseAccountingRows", "renderGeneralExpenseAccountingDashboardTile", "getGeneralExpenseDuplicateFilterSignature", "renderStudentLayoutRemarks"];
vm.runInContext(names.map(extract).join("\n"), context);
const ids = value => Array.from(value, row => row.id);
state.generalExpenseNumberFilter = ["personal"];
assert.deepEqual(ids(context.getVisibleRows(config)), ["personal"]);
state.generalExpenseNumberFilter = ["business"]; state.generalExpenseWorkTypeFilter = ["Услуги"]; state.generalExpenseSectionFilter = ["Организации"];
assert.deepEqual(ids(context.getVisibleRows(config)), ["tomorrow"]);
state.generalExpenseWorkTypeFilter = []; state.generalExpenseSectionFilter = []; state.search = "Просроченный".toLowerCase();
assert.deepEqual(ids(context.getVisibleRows(config)), ["overdue"]);
state.search = ""; state.generalExpenseNumberFilter = [];
assert.equal(context.getVisibleRows(config).length, rows.length);
const pending = context.getGeneralExpenseAccountingRows();
assert.deepEqual(Array.from(pending, item => item.record.id), ["overdue", "today", "tomorrow", "undated"]);
assert.deepEqual(Array.from(pending, item => item.remainingDays), [-1, 0, 1, null]);
assert.equal(pending[0].dueDate, daysAgo(1)); assert.equal(pending[0].overdue, true, "deadline uses expense date, not paid date");
assert.match(context.renderGeneralExpenseAccountingDashboardTile(), /<strong>4<\/strong>/);
assert.match(context.renderGeneralExpenseAccountingDashboardTile(), /Просрочено: 1/);
const before = context.getGeneralExpenseDuplicateFilterSignature(); state.generalExpenseNumberFilter = ["business"];
assert.notEqual(context.getGeneralExpenseDuplicateFilterSignature(), before, "changing the filter clears the duplicate-row exception");
const markup = context.renderGeneralExpenseNumberFilter(); assert.equal((markup.match(/type="checkbox"/g) || []).length, 2);
assert.ok(markup.includes('Личная карта') && markup.includes('Бизнес-карта (все номера)'));
const malicious = { studentLayoutRemarks: { comment: '<img src=x onerror="window.injected=true">\nНовая строка', name: '<script>x</script>', createdAt: '2026-11-13T09:00:00Z' } };
const remarks = context.renderStudentLayoutRemarks(malicious); assert.ok(remarks.includes('&lt;img')); assert.ok(!remarks.includes('<script>'));
context.canAccessView = () => false; assert.equal(context.renderGeneralExpenseAccountingDashboardTile(), ""); context.canAccessView = () => true;
rows.forEach(row => { row.accountingClosed = true; }); assert.equal(context.renderGeneralExpenseAccountingDashboardTile(), "");
console.log('PASS: card-number filters compose with section/work/search; pending accounting excludes closed/personal/empty numbers; 74/75/76-day deadlines, missing dates, permissions, hidden zero tile and escaped student remarks');

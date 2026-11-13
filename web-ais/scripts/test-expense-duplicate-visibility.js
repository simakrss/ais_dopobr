"use strict";
// Production filtering, duplication and focus handlers in isolated fixtures; no API/database.
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

function checkGeneralExpenses() {
  const original = { id: "old", date: "2026-09-01", paid: "", section: "Физлица", workType: "Услуги", name: "Сотрудник" };
  const rows = [original, ...Array.from({ length: 150 }, (_, i) => ({ ...original, id: `old-${i}` }))];
  const state = {
    view: "generalExpenses", search: "Сотрудник", statusFilter: "Все", sort: { key: "date", dir: "asc" },
    generalExpenseSectionFilter: ["Физлица"], generalExpenseWorkTypeFilter: ["Услуги"],
    tableValueFilters: { generalExpenses: { paid: "unpaid" } }, tablePages: { generalExpenses: 4 },
    selected: { generalExpenses: ["old"] }, data: { collections: { generalExpenses: rows } }
  };
  const config = { collection: "generalExpenses", fields: [{ key: "date", type: "date" }] };
  let id = 0, focused = 0, scrolled = 0;
  const c = vm.createContext({
    state, configs: { generalExpenses: config }, clone: structuredClone, todayIso: () => "2026-11-02",
    makeId: () => `copy-${++id}`, normalizeGeneralExpenseRecord: value => value,
    getSelected: key => state.selected[key], getRowsByIds: (_key, ids) => state.data.collections.generalExpenses.filter(row => ids.includes(row.id)),
    confirm: () => true, addAudit() {}, persist() {}, render() {}, showDocumentGenerationNotice() {},
    requestAnimationFrame: fn => fn(), CSS: { escape: String },
    document: { querySelector: () => ({ focus: () => focused++, scrollIntoView: () => scrolled++ }) },
    getTableConfigId: () => "generalExpenses", getRowsForConfig: () => state.data.collections.generalExpenses,
    getStudentListSelectedPrograms: () => [], GENERAL_EXPENSE_SECTIONS: ["Физлица"],
    getRegistryRowSearchText: row => JSON.stringify(row).toLowerCase(), parseTableSortDate: Date.parse,
    normalizeContractSection: () => "", normalizeGeneralExpenseSection: value => value,
    filterRowsByTableValueFilters: input => input.filter(row => !row.paid),
    getTableCellValue: (_config, row, key) => row[key]
  });
  vm.runInContext(["getGeneralExpenseDuplicateFilterSignature", "getGeneralExpenseDuplicateIds",
    "getVisibleRows", "createGeneralExpenseDuplicate", "bulkDuplicateGeneralExpenses"].map(extract).join("\n"), c);
  const filtersBefore = JSON.stringify([state.search, state.sort, state.tableValueFilters]);
  c.bulkDuplicateGeneralExpenses();
  let visible = c.getVisibleRows(config);
  assert.equal(visible[0].id, "copy-1", "The newly paid copy precedes 151 unpaid rows despite ascending date sort and page 4");
  assert.equal(visible.filter(row => row.id === "copy-1").length, 1);
  assert.equal(state.tablePages.generalExpenses, 1);
  assert.deepEqual(Array.from(state.selected.generalExpenses), ["copy-1"]);
  assert.equal(focused, 1); assert.equal(scrolled, 1);
  assert.equal(JSON.stringify([state.search, state.sort, state.tableValueFilters]), filtersBefore);
  visible[0].name = "Отредактировано вне поискового запроса";
  visible[0].section = "Организации";
  visible[0].workType = "Аренда";
  assert.equal(c.getVisibleRows(config)[0].id, "copy-1", "Editing cannot hide the new copy");
  state.search = "Сотруд";
  assert.ok(!c.getVisibleRows(config).some(row => row.id === "copy-1"), "Changing a filter ends the exception");
  state.search = "Сотрудник";
  assert.ok(!c.getVisibleRows(config).some(row => row.id === "copy-1"), "The exception must not reappear later");
  assert.equal(original.paid, "");
}

async function checkEmployeeExpenses() {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    for (const viewport of [{ width: 1100, height: 650 }, { width: 390, height: 600 }]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.setContent(`<style>
        .scroller { height: 220px; overflow: auto; } td { height: 32px; }
        input { width: 110px; } input[type=checkbox] { width: 20px; }
      </style><section data-employee-payment-accounting>
        <span data-employee-payment-selected-count></span><span data-employee-payment-filter-count></span>
        <div class="scroller"><table class="data-table employee-payment-table"><tbody></tbody></table></div>
      </section>`);
      await page.addStyleTag({ content: fs.readFileSync(path.join(root, "styles.css"), "utf8") });
      await page.addScriptTag({ content: `
        const state = { modal: { id: "employee", draft: { id: "employee" } },
          employeePaymentFilters: { payment: "payable", comment: "Иван", source: "", act: "", description: "" } };
        const collections = { contracts: [{ id: "employee" }], generalExpenses: [], directExpenses: [] };
        let counter = 0, renders = 0;
        const original = { id: "original", date: "2026-01-01", paid: "", amount: 350, comment: "Иван", recommendation: true };
        const getEmployeePaymentCollections = () => collections;
        const getEmployeePaymentFilters = () => state.employeePaymentFilters;
        const getEmployeePaymentSort = () => ({ key: "" });
        const getEmployeePaymentAccountingDraft = () => state.modal.draft;
        const getEmployeePaymentAccounting = () => ({ amount: 0, paid: 0, agencyAmount: 0, balance: 0,
          directEntries: collections.directExpenses.map(expense => ({ expense })),
          generalEntries: collections.generalExpenses.map(expense => ({ expense })) });
        const findEmployeePaymentSourceRecord = (type, id) => collections[type === "direct" ? "directExpenses" : "generalExpenses"].find(row => row.id === id);
        const getDirectExpenseEntriesFromCollections = () => collections.directExpenses.map(expense => ({ expense }));
        const normalizeEmployeePaymentSourceRow = (_type, value) => value;
        const normalizeGeneralExpenseRecord = value => value;
        const normalizeContractRecord = value => value;
        const clone = structuredClone;
        const todayIso = () => "2026-11-02";
        const makeId = () => "copy-" + (++counter);
        const money = String, formatContractDate = String, escapeAttr = String;
        const getEmployeePaymentDefaultSourceLabel = String;
        const getEmployeePaymentDisplayComment = (value, details) => [value, details].filter(Boolean).join(" ");
        const getEmployeePaymentActCheckboxState = () => ({});
        const getEmployeePaymentRowStatus = row => row.paid ? "Оплачено" : "К выплате";
        const getEmployeePaymentSourceValues = () => ({ description: "Услуга" });
        const getEmployeePaymentEditorAuditRecord = (_type, value) => value;
        const getEmployeePaymentAuditFields = () => [];
        const buildAuditChanges = () => [];
        const addEmployeePaymentAudit = () => {};
        const scheduleEmployeePaymentAccountingPersist = () => {};
        const showDocumentGenerationNotice = () => {};
        const syncEmployeePaymentOrderFromTable = () => {};
        const bindComboFieldEvents = () => {}, bindMoneyInputStepControls = () => {}, syncEmployeePaymentActCheckboxes = () => {};
        const employeePaymentTableConfig = {}, EMPLOYEE_PAYMENT_TABLE_CONFIG_ID = "payment";
        const getTableFields = () => [{ key: "fixture" }];
        const renderEmployeePaymentTableCell = (_column, row) => '<td><input type="checkbox" data-action="select-employee-payment-row">'
          + '<button data-action="duplicate-employee-payment-row">Копия</button></td>'
          + '<td><input data-employee-payment-field="amount" value="' + row.amount + '"></td>'
          + '<td><input data-employee-payment-field="paid" value="' + (row.paid || '') + '"></td>'
          + '<td><input data-employee-payment-field="comment" value="' + row.comment + '"></td>';
        const refreshEmployeePaymentFilterOptions = () => {};
        const syncEmployeePaymentSummaryUi = () => {};
        const render = () => { renders++; renderRows(); };
        const renderRows = () => {
          document.querySelector('tbody').innerHTML = [
            ...collections.directExpenses.map(row => ({ ...row, sourceType: "direct", sourceId: row.id })),
            ...collections.generalExpenses.map(row => ({ ...row, sourceType: "general", sourceId: row.id }))
          ].map(row => renderEmployeePaymentAccountingRow(row, getTableFields(), getEmployeePaymentFilters(), getEmployeePaymentSort())).join('');
        };
        document.querySelector('section').addEventListener('click', event => duplicateEmployeePaymentAccountingRow(event));
      ` + ["getEmployeePaymentDuplicateKey", "employeePaymentFiltersAreActive", "normalizeEmployeePaymentFilterText",
        "getEmployeePaymentStatusFilterValue", "getEmployeePaymentStatusFilterValues", "employeePaymentRowMatchesFilters",
        "renderEmployeePaymentAccountingRow", "getEmployeePaymentDomRowFilterModel", "getSelectedEmployeePaymentRows",
        "syncEmployeePaymentSelectionUi", "applyEmployeePaymentFiltersToDom", "createGeneralExpenseDuplicate",
        "duplicateEmployeePaymentAccountingRow", "insertEmployeePaymentDuplicateRow", "commitEmployeePaymentAccountingChange"
      ].map(extract).join("\n") });
      for (const sourceType of ["direct", "general"]) {
        await page.evaluate(type => {
          state.modal = { id: "employee", draft: { id: "employee" } };
          state.employeePaymentFilters.comment = "Иван";
          collections.directExpenses = []; collections.generalExpenses = [];
          collections[type === "direct" ? "directExpenses" : "generalExpenses"] = [
            ...Array.from({ length: 50 }, (_, i) => ({ ...original, id: `before-${i}` })), { ...original }
          ];
          renderRows();
          document.querySelector('[data-action="select-employee-payment-row"]').checked = true;
        }, sourceType);
        await page.locator('[data-payment-source-id="original"] [data-action="duplicate-employee-payment-row"]').click();
        await page.waitForFunction(() => document.activeElement?.matches('[data-payment-source-id^="copy-"] [data-employee-payment-field="amount"]'));
        const copy = page.locator('[data-payment-source-id^="copy-"]');
        assert.equal(await copy.count(), 1);
        assert.equal(await copy.isVisible(), true);
        assert.match(await copy.getAttribute("class"), /is-duplicated-expense/);
        assert.equal(await page.locator('[data-employee-payment-selected-count]').textContent(), "1");
        assert.equal(await copy.locator('[type="checkbox"]').isChecked(), true);
        assert.equal(await page.locator('[data-payment-source-id="before-0"] [type="checkbox"]').isChecked(), false);
        const inViewport = await copy.locator('[data-employee-payment-field="amount"]').evaluate(input => {
          const rect = input.getBoundingClientRect(), scroller = input.closest('.scroller').getBoundingClientRect();
          return rect.top >= scroller.top && rect.bottom <= scroller.bottom && rect.right <= scroller.right;
        });
        assert.equal(inViewport, true, "New editable field is scrolled into view vertically and horizontally");
        assert.equal(await page.evaluate(() => renders), 0, "No full-card redraw for duplication");
        await copy.locator('[data-employee-payment-field="comment"]').fill("Изменённый комментарий");
        await page.evaluate(() => applyEmployeePaymentFiltersToDom());
        assert.equal(await copy.isVisible(), true, "Filter refresh after editing preserves the copy");
        await page.evaluate(() => renderRows());
        assert.equal(await copy.isVisible(), true, "A later full redraw also preserves visibility");
        await page.evaluate(() => { state.employeePaymentFilters.comment = "Пётр"; applyEmployeePaymentFiltersToDom(); });
        assert.equal(await copy.isVisible(), false, "Explicit filter change restores normal filtering");
        await page.evaluate(() => { state.employeePaymentFilters.comment = "Иван"; applyEmployeePaymentFiltersToDom(); });
        assert.equal(await copy.isVisible(), false, "Returning to old filters must not revive the exception");
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
}

checkGeneralExpenses();
checkEmployeeExpenses().then(() => console.log("Expense duplicate visibility: OK; filtered/sorted/paged general expenses; direct/general employee copies; selection, focus, scrolling, edits and filter reset on desktop/mobile."))
  .catch(error => { console.error(error); process.exitCode = 1; });

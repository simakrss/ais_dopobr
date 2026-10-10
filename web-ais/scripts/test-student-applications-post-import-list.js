"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n?/g, "\n");

function extractFunction(name) {
  const match = new RegExp(`^  (?:async )?function ${name}\\(`, "m").exec(appSource);
  assert.ok(match, `Missing function: ${name}`);
  const remaining = appSource.slice(match.index + match[0].length);
  const end = /\n  (?:async )?function /m.exec(remaining);
  assert.ok(end, `Missing end of function: ${name}`);
  return appSource.slice(match.index, match.index + match[0].length + end.index);
}

function createHarness(options = {}) {
  const existing = [
    {id: "waiting-a", name: "Алексеева Анна", status: "На зачисление", program: "Первая программа", educationType: "ППП", applicationDate: "2026-06-01"},
    {id: "waiting-b", name: "Борисов Борис", status: "На зачисление", program: "Другая программа", educationType: "ДОП", applicationDate: "2026-08-01"},
    {id: "studying", name: "Учится сейчас", status: "Учится", program: "Первая программа", educationType: "КПК"},
    {id: "expelled", name: "Отчислен ранее", status: "Отчислен", program: "Первая программа"}
  ];
  const rows = options.rows || [{id: "application-a", name: "Новый слушатель"}];
  const state = {
    data: {collections: {students: existing}, dictionaries: {agents: [], managers: []}},
    studentApplicationsImport: {selected: rows.map(row => row.id), rows, importedLookup: {}, filters: {status: options.status || ""}, open: true, importing: false},
    view: "students", search: "Борисов", statusFilter: "Все", studentProgramTypeFilter: ["ДОП"],
    studentImportedViewIds: ["waiting-b"],
    studentListFilters: {programs: ["Другая программа"], program: "Старый фильтр", dateField: "applicationDate", dateFrom: "2026-08-01", dateTo: "2026-08-02", datePeriod: "custom"},
    studentListProgramQuery: "Другая", tableValueFilters: {students: {name: {value: "Борисов Борис"}}, programs: {status: {value: "Набор"}}},
    selected: {students: ["waiting-b"]}, sort: {key: "name", dir: "desc"}, tablePages: {students: 8}, tableOptions: {},
    programRegistryTypeFilter: [], contractSectionFilter: [], generalExpenseSectionFilter: [], generalExpenseWorkTypeFilter: []
  };
  const calls = {persist: 0, render: 0, created: [], alerts: [], visible: []};
  const studentConfig = {collection: "students", fields: [{key: "name"}], defaultSort: {key: "name", dir: "asc"}};
  const context = {
    state, configs: {students: studentConfig}, CONTRACT_SECTIONS: [], GENERAL_EXPENSE_SECTIONS: [], registryRowSearchTextCache: new WeakMap(),
    unique: values => [...new Set(values)],
    alert: message => calls.alerts.push(message), confirm: () => options.confirm !== false,
    getStudentApplicationsSingleProgramFilterId: () => "",
    getStudentApplicationProgram: () => ({id: "program-test"}),
    buildStudentApplicationsImportLookup: () => ({}),
    getNextUid: () => 100, getCurrentUserLogin: () => "test-manager",
    createStudentFromApplication(row, uid, status) {
      const record = {id: `new-${uid}`, name: row.name, status, program: "Новая программа", educationType: "КПК", applicationDate: "2026-09-09"};
      calls.created.push(record);
      return record;
    },
    async ensureStudentDocumentFolders() { if (options.folderError) throw new Error("Тестовая ошибка папок"); },
    refreshStudentApplicationsImportDialog() {}, addAudit() {},
    persist() { calls.persist++; },
    render() { calls.render++; calls.visible = context.getVisibleRows(studentConfig).map(row => row.id); },
    getTableConfigId: config => config.collection,
    getRowsForConfig: () => state.data.collections.students,
    findProgramByName: () => null,
    normalizeEducationProgramType: value => value,
    normalizeContractSection: () => "", normalizeGeneralExpenseSection: () => "",
    getTableCellValue: (_config, row, key) => row[key],
    getTableValueFilterDisplayValue: (_id, key, row) => row[key],
    filterRowsByTableValueFilters: (items, configId, valueForRow) => items.filter(row => Object.entries(state.tableValueFilters[configId] || {}).every(([key, filter]) => valueForRow(row, key) === filter.value))
  };
  vm.createContext(context);
  for (const name of ["addSelectedStudentApplications", "clearTableValueFilter", "getVisibleRows", "getStudentListSelectedPrograms", "parseTableSortDate", "getRegistryRowSearchText", "getDefaultTableSort", "getStudentStatusTableSort"]) vm.runInContext(extractFunction(name), context);
  return {context, state, calls};
}

async function run() {
  const single = createHarness();
  assert.deepEqual(Array.from(single.context.getVisibleRows(single.context.configs.students), row => row.id), ["waiting-b"], "Fixture must reproduce the one-row view");
  await single.context.addSelectedStudentApplications();
  assert.deepEqual(Array.from(single.calls.visible).sort(), ["new-100", "waiting-a", "waiting-b"], "After a single import, show all students awaiting enrollment, including existing ones");
  assert.equal(single.state.statusFilter, "На зачисление");
  assert.equal(single.state.search, "");
  assert.equal(single.state.studentImportedViewIds.length, 0);
  assert.equal(single.state.studentProgramTypeFilter.length, 0);
  assert.equal(single.state.studentListFilters.programs.length, 0);
  assert.equal(single.state.studentListFilters.program, undefined);
  assert.equal(single.state.studentListFilters.dateField, "");
  assert.equal(single.state.studentListFilters.dateFrom, "");
  assert.equal(single.state.studentListFilters.dateTo, "");
  assert.equal(single.state.studentListProgramQuery, "");
  assert.equal(single.state.tableValueFilters.students, undefined);
  assert.equal(single.state.tableValueFilters.programs.status.value, "Набор", "Filters of other registries must be preserved");
  assert.equal(single.state.tablePages.students, 1);
  assert.equal(single.state.selected.students.length, 0);
  assert.equal(single.state.lastEditedRow.id, "new-100");
  assert.equal(single.state.studentApplicationsImport.open, false);
  assert.equal(single.calls.persist, 1);
  assert.equal(single.calls.render, 1);

  const batch = createHarness({rows: [{id: "a", name: "Первый новый"}, {id: "b", name: "Второй новый"}, {id: "empty", name: " "}]});
  await batch.context.addSelectedStudentApplications();
  assert.deepEqual(Array.from(batch.calls.visible).sort(), ["new-100", "new-101", "waiting-a", "waiting-b"]);
  assert.equal(batch.calls.created.length, 2, "Nameless applications must still be skipped");

  const otherStatus = createHarness({status: "Учится"});
  await otherStatus.context.addSelectedStudentApplications();
  assert.deepEqual(Array.from(otherStatus.calls.visible).sort(), ["new-100", "studying"], "Explicit import status must remain respected, without restricting the list to new records");

  for (const options of [{confirm: false}, {folderError: true}, {rows: []}, {rows: [{id: "empty", name: " "}]}]) {
    const unsuccessful = createHarness(options);
    const beforeFilters = JSON.stringify(unsuccessful.state.studentListFilters);
    await unsuccessful.context.addSelectedStudentApplications();
    assert.equal(unsuccessful.state.data.collections.students.length, 4);
    assert.equal(unsuccessful.state.statusFilter, "Все");
    assert.equal(JSON.stringify(unsuccessful.state.studentListFilters), beforeFilters);
    assert.deepEqual(unsuccessful.state.studentImportedViewIds, ["waiting-b"]);
    assert.equal(unsuccessful.calls.persist, 0);
  }
  console.log("Post-import student list: single/batch imports, all existing enrollment records, filter reset, selected status, cancellation and failure checks passed.");
}
run().catch(error => {console.error(error); process.exitCode = 1;});

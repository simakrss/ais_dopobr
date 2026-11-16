"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8").replace(/\r\n/g, "\n");
function definition(name) {
  const start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf("\n  function ", start + 1);
  assert.ok(start >= 0 && end > start, name);
  return source.slice(start, end);
}
function client(students) {
  const state = { data: { collections: { students } }, issuedDocumentFilters: { frdo: "pending" }, issuedDocumentSort: { key: "issueDate", dir: "asc" } };
  const dependencies = {
    state, FRDO_UPLOAD_RESERVE_DAYS: 5, ISSUED_DOCUMENT_TABLE_CONFIG_ID: "issuedDocuments",
    getProgramRows: () => [], findProgramInRows: () => null, findProgramByName: () => null,
    normalizeEducationProgramType: value => value, getIssuedDocumentDeadlineDays: () => 30,
    dateRu: value => value, filterRowsByTableValueFilters: rows => rows
  };
  const functions = ["getMoscowCalendarDateKey", "normalizeContractCalendarDateKey", "parseTableSortDate", "isFrdoProgramType",
    "normalizeIssuedDocumentFilterText", "getIssuedDocumentProgramType", "isIssuedDocumentDateValue", "isIssuedDocumentFutureDated",
    "getIssuedDocumentFrdoDetails", "getIssuedDocumentElapsedDays", "getIssuedDocumentPlannedFrdoDate", "getIssuedDocumentDeadlineTone",
    "getIssuedDocumentRows", "isIssuedDocumentFrdoExportEligible", "getIssuedDocumentsOpeningView", "buildIssuedDocumentFrdoExportRecords",
    "issuedDocumentRowMatchesFilters", "getIssuedDocumentSortValue", "sortIssuedDocumentRows", "getIssuedDocumentTableFilterDisplayValue",
    "getVisibleIssuedDocumentRows", "getVisiblePendingIssuedDocumentStudentRecords"];
  const dashboardStart = source.indexOf("    const pendingIssuedDocuments = getIssuedDocumentRows()");
  const dashboardEnd = source.indexOf("    const pendingIssuedDocumentDays", dashboardStart);
  return new Function(...Object.keys(dependencies), functions.map(definition).join("\n") + `
    return { state, getIssuedDocumentRows, getVisibleIssuedDocumentRows, getVisiblePendingIssuedDocumentStudentRecords,
      getIssuedDocumentsOpeningView, buildIssuedDocumentFrdoExportRecords, isIssuedDocumentFrdoExportEligible,
      dashboardCount() { ${source.slice(dashboardStart, dashboardEnd)} return pendingIssuedDocuments.length; } };
  `)(...Object.values(dependencies));
}
async function main() {
  const RealDate = Date;
  let now = "2026-11-16T20:59:59Z"; // 23:59:59 Moscow; independent of host timezone.
  global.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return RealDate.parse(now); }
  };
  try {
    const server = require("../app-server.js");
    const student = (id, diplomaIssueDate, extra = {}) => ({ id, name: id, diplomaBlankNo: id, diplomaIssueDate, educationType: "ППП", ...extra });
    const students = [student("past", "2026-11-15"), student("today", "2026-11-16", { educationType: "КПК" }),
      student("tomorrow", "2026-11-17"), student("tomorrow-ru", "17.11.2026"), student("prepared", "2026-12-07"),
      student("exported", "2026-11-15", { frdoDate: "2026-11-16" }), student("not-required", "2026-11-15", { frdoStatus: "Не требуется" }),
      student("dop", "2026-11-15", { educationType: "ДОП" }), student("blank-number", "2026-11-15", { diplomaBlankNo: "" })];
    const original = JSON.stringify(students), ui = client(students);
    const ids = rows => rows.map(row => row.documentNumber).sort();
    assert.deepEqual(ids(ui.getVisibleIssuedDocumentRows()), ["past", "today"]);
    assert.equal(ui.dashboardCount(), 2);
    assert.deepEqual(ids(ui.buildIssuedDocumentFrdoExportRecords()), ["past", "today"]);
    assert.deepEqual(ui.getVisiblePendingIssuedDocumentStudentRecords().map(row => row.id).sort(), ["past", "today"]);
    assert.equal(ui.getIssuedDocumentRows().find(row => row.studentId === "prepared").frdoKey, "not-issued");
    assert.equal(ui.isIssuedDocumentFrdoExportEligible({ frdoKey: "pending", programType: "ППП", documentNumber: "old-client", issueDate: "2026-11-17" }), false);
    const onlyFuture = client([student("prepared", "2026-12-07")]);
    assert.equal(onlyFuture.dashboardCount(), 0);
    assert.equal(onlyFuture.getVisibleIssuedDocumentRows().length, 0);
    assert.equal(onlyFuture.getIssuedDocumentsOpeningView(onlyFuture.getIssuedDocumentRows()).frdo, "exported");
    // All-state registry keeps prepared data available without presenting it as due for export.
    ui.state.issuedDocumentFilters.frdo = "not-issued";
    assert.deepEqual(ids(ui.getVisibleIssuedDocumentRows()), ["prepared", "tomorrow", "tomorrow-ru"]);
    ui.state.issuedDocumentFilters.frdo = "pending";
    const payload = { records: students.map(row => ({ ...row, documentNumber: row.diplomaBlankNo, programType: row.educationType, issueDate: row.diplomaIssueDate })) };
    assert.deepEqual(ids(server.sanitizeFrdoExportPayload(payload)), ["past", "today"]);
    const workbook = await server.buildFrdoExportWorkbook(payload);
    const XLSX = require("../vendor/sheetjs/xlsx.full.min.js");
    const file = XLSX.read(workbook.bytes, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json(file.Sheets["Шаблон"], { header: 1, defval: "" });
    assert.equal(workbook.count, 2);
    assert.equal(rows.length, 3);
    assert.ok(rows.slice(1).every(row => !row.includes("17.11.2026") && !row.includes("07.12.2026")));
    assert.throws(() => server.sanitizeFrdoExportPayload({ records: [payload.records[4]], currentDate: "2099-12-31" }), /будущей датой/);
    let renders = 0;
    const refreshState = { view: "issuedDocuments", issuedDocumentAutoFallback: true, issuedDocumentViewInitialized: true };
    const document = { visibilityState: "visible", querySelector: selector => selector === ".modal-backdrop" ? null
      : { dataset: { issuedDocumentsCalendarDate: "2026-11-16", dashboardCalendarDate: "2026-11-16", frdoCalendarDate: "2026-11-16" } } };
    const refresh = new Function("state", "document", "render", "todayIso", definition("getMoscowCalendarDateKey")
      + definition("refreshDashboardCalendarDay") + "return refreshDashboardCalendarDay;")(
      refreshState, document, () => renders++, () => "2026-11-16");
    refresh(); assert.equal(renders, 0);
    now = "2026-11-16T21:00:00Z"; // Issue date starts: both client and server admit tomorrow's records.
    refresh(); assert.equal(renders, 1); assert.equal(refreshState.issuedDocumentViewInitialized, false);
    refreshState.view = "dashboard"; refresh(); assert.equal(renders, 2, "Moscow midnight refreshes the tile even in another timezone");
    refreshState.modal = {}; refresh(); assert.equal(renders, 2, "Do not disturb an open card");
    assert.deepEqual(ids(ui.getVisibleIssuedDocumentRows()), ["past", "today", "tomorrow", "tomorrow-ru"]);
    assert.equal(ui.dashboardCount(), 4);
    assert.deepEqual(ids(server.sanitizeFrdoExportPayload(payload)), ["past", "today", "tomorrow", "tomorrow-ru"]);
    now = "2026-12-06T21:00:00Z";
    assert.equal(onlyFuture.dashboardCount(), 1);
    assert.equal(onlyFuture.getVisibleIssuedDocumentRows().length, 1);
    assert.equal(JSON.stringify(students), original, "Readiness must not change prepared documents or export marks");
    console.log("FRDO future issue date: list, tile, export workbook and Moscow midnight OK");
  } finally { global.Date = RealDate; }
}
module.exports = { client };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

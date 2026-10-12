"use strict";
// Isolated import queries: no live requests, imports, or shared-state writes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").replace(/\r\n/g, "\n");
function extract(name) {
  const match = source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name); return match[0];
}
function harness() {
  const requests = [], renders = [];
  const c = vm.createContext({
    state: { studentApplicationsImport: { open: false }, tableOptions: "previous" },
    STUDENT_APPLICATIONS_IMPORT_DEFAULT_SORT: { key: "date", direction: "desc" },
    getStudentApplicationsDefaultDates: () => ({ dateFrom: "2026-08-18", dateTo: "2026-09-17" }),
    document: { querySelector: () => null },
    syncStudentApplicationsImportFilters: () => {}, getStudentApplicationsSelectedProgramIds: () => [],
    getProgramRows: () => [], photoApiUrl: (url) => url,
    fetch: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })),
    prepareStudentApplicationRows: async (rows) => rows,
    buildStudentApplicationsImportLookup: () => ({}), getStudentApplicationPreviousMatches: () => [],
    sortStudentApplicationRows: (rows) => rows,
    requestAnimationFrame: (callback) => callback(),
    refreshStudentApplicationsImportDialog: () => renders.push(c.state.studentApplicationsImport.loading)
  });
  vm.runInContext(["openStudentApplicationsImport", "fetchStudentApplications"].map(extract).join("\n"), c);
  return { c, requests, renders };
}
function respond(request, rows) { request.resolve({ ok: true, json: async () => ({ rows }) }); }
async function main() {
  const { c, requests, renders } = harness();
  let pending = c.openStudentApplicationsImport();
  assert.equal(requests.length, 1, "Opening import starts the query immediately");
  assert.deepEqual(renders, [false, true], "Dialog and loading state are rendered");
  assert.equal(c.state.studentApplicationsImport.loading, true);
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.dateFrom, "2026-08-18"); assert.equal(body.dateTo, "2026-09-17");
  assert.equal(requests[0].url, "/api/students/import-applications/query");
  await c.openStudentApplicationsImport(); await c.fetchStudentApplications();
  assert.equal(requests.length, 1, "Repeated clicks must not create duplicate requests");
  respond(requests[0], [{ id: "one" }, { id: "two" }]); await pending;
  assert.equal(c.state.studentApplicationsImport.rows.length, 2);
  assert.equal(c.state.studentApplicationsImport.selected.length, 0, "Fetching never imports/selects applicants");
  assert.equal(c.state.studentApplicationsImport.loading, false);
  pending = c.fetchStudentApplications(); requests[1].reject(new Error("Тестовая ошибка")); await pending;
  assert.equal(c.state.studentApplicationsImport.error, "Тестовая ошибка");
  pending = c.fetchStudentApplications(); respond(requests[2], [{ id: "retry" }]); await pending;
  assert.equal(c.state.studentApplicationsImport.error, "");
  assert.equal(c.state.studentApplicationsImport.rows[0].id, "retry");
  // A closed window's result/failure cannot replace the next window's data or indicator.
  const stale = c.fetchStudentApplications(); c.state.studentApplicationsImport.open = false;
  pending = c.openStudentApplicationsImport(); requests[3].reject(new Error("Old request")); await stale;
  assert.equal(c.state.studentApplicationsImport.loading, true);
  assert.equal(c.state.studentApplicationsImport.error, "");
  respond(requests[4], [{ id: "fresh" }]); await pending;
  assert.equal(c.state.studentApplicationsImport.rows[0].id, "fresh");
  const late = c.fetchStudentApplications(); c.state.studentApplicationsImport.open = false;
  pending = c.openStudentApplicationsImport(); respond(requests[5], [{ id: "stale" }]); await late;
  assert.equal(c.state.studentApplicationsImport.rows.length, 0);
  assert.equal(c.state.studentApplicationsImport.loading, true);
  respond(requests[6], [{ id: "new" }]); await pending;
  assert.equal(c.state.studentApplicationsImport.rows[0].id, "new");
  console.log("Student import automatic query tests passed.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

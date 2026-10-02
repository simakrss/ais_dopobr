"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").replace(/\r\n/g, "\n");
const helperStart = appSource.indexOf("  function getVisiblePendingIssuedDocumentStudentRecords");
const helperEnd = appSource.indexOf("\n\n  function renderIssuedDocumentSortHeader", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "Не найден обработчик отметки документов как выгруженных");

const state = {
  issuedDocumentFilters: { frdo: "pending" },
  issuedDocumentMarkRunning: false,
  data: {
    collections: {
      students: [
        { id: "student-1", name: "Иванов" },
        { id: "student-2", name: "Петров" },
        { id: "student-3", name: "Сидоров" }
      ]
    }
  }
};
const visibleRows = [
  { studentId: "student-1", frdoKey: "pending", programType: "КПК", documentNumber: "1" },
  { studentId: "student-1", frdoKey: "pending", programType: "КПК", documentNumber: "1" },
  { studentId: "student-2", frdoKey: "exported", programType: "КПК", documentNumber: "2" },
  { studentId: "student-3", frdoKey: "pending", programType: "ППП", documentNumber: "3" }
];
const confirmations = [];
const alerts = [];
const runs = [];
const shownResults = [];
let renderCount = 0;
const factory = new Function(
  "state",
  "getVisibleIssuedDocumentRows",
  "isIssuedDocumentFrdoExportEligible",
  "alert",
  "todayIso",
  "confirm",
  "dateRu",
  "runStudentBulkFrdoDate",
  "render",
  "showStudentBulkOperationResult",
  `${appSource.slice(helperStart, helperEnd)}\nreturn { getVisiblePendingIssuedDocumentStudentRecords, markFilteredIssuedDocumentsAsExported };`
);
const helpers = factory(
  state,
  () => visibleRows,
  (row) => row.frdoKey === "pending" && ["КПК", "ППП"].includes(row.programType) && Boolean(row.documentNumber),
  (message) => alerts.push(message),
  () => "2026-08-30",
  (message) => { confirmations.push(message); return true; },
  () => "30.08.2026",
  async (records, date, onProgress) => {
    runs.push({ records, date });
    onProgress(0);
    return { success: records.length, skipped: 0, failed: 0, details: [] };
  },
  () => { renderCount += 1; },
  (result) => shownResults.push(result)
);

assert.deepEqual(
  helpers.getVisiblePendingIssuedDocumentStudentRecords().map((record) => record.id),
  ["student-1", "student-3"],
  "Обновляться должны только уникальные карточки из текущей отфильтрованной выборки"
);

const classes = new Set();
const button = {
  textContent: "Отметить как выгруженные",
  disabled: false,
  isConnected: true,
  classList: {
    add: (name) => classes.add(name),
    remove: (name) => classes.delete(name)
  },
  setAttribute() {},
  removeAttribute() {}
};

(async () => {
  await helpers.markFilteredIssuedDocumentsAsExported(button);
  assert.equal(confirmations.length, 1, "Перед изменением должно выводиться подтверждение");
  assert.match(confirmations[0], /Будет обновлено карточек: 2/u);
  assert.match(confirmations[0], /Дата выгрузки: 30\.08\.2026/u);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].date, "2026-08-30");
  assert.deepEqual(runs[0].records.map((record) => record.id), ["student-1", "student-3"]);
  assert.equal(renderCount, 1);
  assert.equal(shownResults.length, 1);
  assert.equal(button.textContent, "Отметить как выгруженные");
  assert.equal(button.disabled, false);
  assert.equal(classes.has("is-loading"), false);
  assert.deepEqual(alerts, []);
  assert.match(appSource, /class="is-success">Выгружено: <strong>\$\{exportedCount\}<\/strong>/u);
  assert.match(appSource, />Ожидают: <strong>\$\{pendingCount\}<\/strong>/u);
  assert.doesNotMatch(appSource, /(?:Выгружено в|Ожидают) ФРДО:/u);

  state.issuedDocumentFilters.frdo = "exported";
  await helpers.markFilteredIssuedDocumentsAsExported(button);
  assert.equal(runs.length, 1, "Обработчик не должен работать без фильтра «Не выгружено»");

  assert.match(
    appSource,
    /filters\.frdo === "pending" \? `<button class="ghost-button" data-action="mark-issued-documents-exported"/u,
    "Кнопка должна отображаться только при фильтре «Не выгружено»"
  );
  assert.match(
    appSource,
    /data-action='mark-issued-documents-exported'[\s\S]*markFilteredIssuedDocumentsAsExported\(event\.currentTarget\)/u,
    "Не найден обработчик кнопки"
  );
  console.log("issued documents mark exported tests: OK");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

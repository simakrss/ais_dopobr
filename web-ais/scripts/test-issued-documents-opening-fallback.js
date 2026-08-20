"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

const helperStart = appSource.indexOf("  function getIssuedDocumentsOpeningView");
const helperEnd = appSource.indexOf("\n\n  function prepareIssuedDocumentsRegistryOnOpen", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "Не найден выбор режима открытия реестра ФРДО");

const isIssuedDocumentFrdoExportEligible = (row) => (
  row.frdoKey === "pending"
  && ["КПК", "ППП"].includes(row.programType)
  && Boolean(String(row.documentNumber || "").trim())
);
const factory = new Function(
  "isIssuedDocumentFrdoExportEligible",
  `${appSource.slice(helperStart, helperEnd)}\nreturn { getIssuedDocumentsOpeningView };`
);
const { getIssuedDocumentsOpeningView } = factory(isIssuedDocumentFrdoExportEligible);

assert.deepEqual(
  getIssuedDocumentsOpeningView([
    { frdoKey: "pending", programType: "КПК", documentNumber: "123" },
    { frdoKey: "exported", programType: "ППП", documentNumber: "456" }
  ]),
  {
    frdo: "pending",
    sort: { key: "issueDate", dir: "asc" },
    autoFallback: false
  },
  "При наличии документов для ФРДО должен открываться список невыгруженных"
);

assert.deepEqual(
  getIssuedDocumentsOpeningView([
    { frdoKey: "exported", programType: "КПК", documentNumber: "123" },
    { frdoKey: "not-required", programType: "ДОП", documentNumber: "456" }
  ]),
  {
    frdo: "exported",
    sort: { key: "issueDate", dir: "desc" },
    autoFallback: true
  },
  "При отсутствии документов для ФРДО должны показываться выгруженные от новых дат к старым"
);

assert.equal(
  getIssuedDocumentsOpeningView([
    { frdoKey: "pending", programType: "ДОП", documentNumber: "123" },
    { frdoKey: "pending", programType: "КПК", documentNumber: "" }
  ]).frdo,
  "exported",
  "Не подходящие для выгрузки записи не должны блокировать резервный режим"
);

assert.match(appSource, /if \(!state\.issuedDocumentViewInitialized\) prepareIssuedDocumentsRegistryOnOpen\(allRows\)/u);
assert.match(appSource, /state\.issuedDocumentFilters = \{[\s\S]*frdo: openingView\.frdo/u);
assert.match(appSource, /state\.issuedDocumentSort = \{ \.\.\.openingView\.sort \}/u);
assert.match(appSource, /state\.issuedDocumentAutoFallback = openingView\.autoFallback/u);
assert.match(appSource, /if \(state\.view === "issuedDocuments"\) prepareIssuedDocumentsRegistryOnOpen\(\)/u);
assert.match(appSource, /data-action='reset-issued-document-filters'[\s\S]*prepareIssuedDocumentsRegistryOnOpen\(\)/u);
assert.match(appSource, /Документов для выгрузки в ФРДО нет\. Показаны ранее выгруженные документы/u);
assert.match(stylesSource, /\.issued-documents-auto-fallback\s*\{[\s\S]*background:\s*#edf9f5/u);

console.log("issued documents opening fallback tests: OK");

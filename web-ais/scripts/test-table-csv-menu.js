"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").replace(/\r\n/gu, "\n");
const stylesSource = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

const collectionStart = appSource.indexOf("  function renderCollection");
const collectionEnd = appSource.indexOf("\n\n  function getStudentApplicationsDefaultDates", collectionStart);
assert.ok(collectionStart >= 0 && collectionEnd > collectionStart, "Не найден шаблон реестра");
const collectionSource = appSource.slice(collectionStart, collectionEnd);
assert.doesNotMatch(
  collectionSource,
  /data-action="export-csv"/u,
  "Верхняя панель реестра не должна содержать отдельную кнопку CSV"
);

const bulkStart = appSource.indexOf("  function renderBulkToolbar");
const bulkEnd = appSource.indexOf("\n\n  function getRowsForConfig", bulkStart);
assert.ok(bulkStart >= 0 && bulkEnd > bulkStart, "Не найдена панель массовых действий");
const bulkSource = appSource.slice(bulkStart, bulkEnd);
assert.doesNotMatch(bulkSource, /data-action="bulk-export"|csv-button|csv-icon/u);

const optionsStart = appSource.indexOf("  function renderTableOptions");
const optionsEnd = appSource.indexOf("\n\n  function getTableLayoutConfig", optionsStart);
assert.ok(optionsStart >= 0 && optionsEnd > optionsStart, "Не найдено меню опций таблицы");
const optionsSource = appSource.slice(optionsStart, optionsEnd);
assert.match(
  optionsSource,
  /configs\[configId\][\s\S]*data-action="export-csv"[\s\S]*>Экспорт CSV<\/button>/u,
  "Экспорт CSV должен находиться в меню опций стандартных таблиц"
);

assert.doesNotMatch(appSource, /data-action=['"]bulk-export['"]/u);
assert.doesNotMatch(stylesSource, /\.csv-button|\.csv-icon/u);

console.log("table CSV menu tests: OK");

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n?/gu, "\n");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Не найден блок ${startMarker}`);
  return source.slice(start, end);
}

const sitesFeatureBlock = sourceBlock(
  appSource,
  '  const ADVERTISING_SITES_SOURCE = "mysql";',
  "  function renderAdvertisingHistory()"
);
const sitesRenderBlock = sourceBlock(
  appSource,
  "  function renderAdvertisingSites()",
  "  function shouldRetryAdvertisingSitesPreview("
);
const sitesLoadBlock = sourceBlock(
  appSource,
  "  async function loadAdvertisingSitesPreview(",
  "  async function applyAdvertisingSites()"
);
const sitesApplyBlock = sourceBlock(
  appSource,
  "  async function applyAdvertisingSites()",
  "  function renderAdvertisingHistory()"
);

assert.match(sitesFeatureBlock, /const ADVERTISING_SITES_SOURCE = "mysql"/u);
assert.match(sitesFeatureBlock, /const ADVERTISING_SITES_SOURCE_LABEL = "MySQL-база АИС"/u);
assert.doesNotMatch(sitesFeatureBlock, /XLSB|WebDAV|локальн/iu);
assert.doesNotMatch(sitesFeatureBlock, /getStudentDocumentsSource|getStudentDatabaseSourceLabel/u);

assert.match(sitesRenderBlock, /<strong>\$\{ADVERTISING_SITES_SOURCE_LABEL\}<\/strong>/u);
assert.match(sitesRenderBlock, /Прочитано из MySQL-базы АИС/u);
assert.doesNotMatch(sitesRenderBlock, /<select\b|preview\?\.source\.location/iu);

assert.match(sitesLoadBlock, /const source = ADVERTISING_SITES_SOURCE/u);
assert.match(sitesLoadBlock, /\/api\/advertising\/sites\?source=\$\{encodeURIComponent\(source\)\}/u);
assert.doesNotMatch(sitesLoadBlock, /getStudentDocumentsSource|getStudentDatabaseSourceLabel/u);

assert.match(sitesApplyBlock, /const source = ADVERTISING_SITES_SOURCE/u);
assert.match(sitesApplyBlock, /Источник: \$\{ADVERTISING_SITES_SOURCE_LABEL\}/u);
assert.match(sitesApplyBlock, /body: JSON\.stringify\(\{[\s\S]*?source,/u);
assert.doesNotMatch(sitesApplyBlock, /getStudentDocumentsSource|getStudentDatabaseSourceLabel|preview\.source\.label/u);
assert.match(
  appSource,
  /syncBaseline\.criticalHash[\s\S]{0,160}result\.formulaMetadataCriticalHash\s*\|\|\s*result\.criticalHash/u,
  "Расширение программы двумя MySQL-полями должно обновлять baseline критичных данных"
);
assert.match(
  appSource,
  /syncBaseline\.criticalIdentityHash\s*!==\s*result\.criticalIdentityHash/u,
  "Изменившийся identity hash должен обновлять контрольную точку синхронизации"
);

console.log("Advertising sites UI source checks passed.");

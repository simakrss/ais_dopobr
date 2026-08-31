"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");

assert.match(appSource, /mobileRegistryFiltersOpen:\s*\{\}/u);
assert.match(appSource, /function getMainRegistryActiveFilterCount\(view = state\.view\)/u);
assert.match(appSource, /data-action="toggle-mobile-registry-filters"/u);
assert.match(appSource, /class="collection-primary-filters"/u);
assert.match(appSource, /<summary title="Фильтр по виду программы">\s*<span>Вид<\/span>/u);
assert.doesNotMatch(appSource, /<summary title="Фильтр по виду программы">\s*<span>Вид программы<\/span>/u);
assert.match(appSource, /<summary title="Фильтр по типу программы">\s*<span>Вид<\/span>/u);
assert.doesNotMatch(appSource, /<summary title="Фильтр по типу программы">\s*<span>Тип программы<\/span>/u);
assert.match(appSource, /toggleMobileRegistryFilters\(event\.currentTarget\)/u);
assert.match(appSource, /mobile-registry-filters-open[\s\S]{0,500}setMobileRegistryFiltersOpen/u);
assert.match(stylesSource, /\.collection-primary-filters\s*\{\s*display: contents;/u);
assert.match(stylesSource, /button\.mobile-registry-filters-toggle\s*\{\s*display: none;/u);
assert.match(stylesSource, /@media \(min-width: 721px\)[\s\S]*?\.collection-register \.collection-primary-filters > \.search-box\s*\{[\s\S]*?flex:\s*1 1 140px;[\s\S]*?min-width:\s*120px;/u);
assert.match(stylesSource, /\.collection-register \.collection-primary-filters > \.select-control\s*\{[\s\S]*?flex:\s*0 1 160px;/u);
assert.match(stylesSource, /\.collection-register \.collection-primary-filters > \.student-program-type-filter\s*\{[\s\S]*?flex:\s*0 1 184px;/u);
assert.match(stylesSource, /\.collection-register \.collection-toolbar-actions\s*\{[\s\S]*?flex-wrap:\s*nowrap;[\s\S]*?gap:\s*6px;/u);
assert.match(stylesSource, /\.collection-register \.collection-toolbar-actions > button\s*\{[\s\S]*?white-space:\s*nowrap;/u);
assert.match(stylesSource, /\.document-template-toolbar\s*\{[\s\S]*?grid-template-columns:\s*minmax\(260px, 1fr\) max-content;/u);
assert.match(stylesSource, /\.document-template-search\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;/u);
assert.match(stylesSource, /@media \(max-width: 720px\)[\s\S]*button\.mobile-registry-filters-toggle\s*\{\s*display: inline-flex;/u);
assert.match(stylesSource, /\.mobile-registry-filters-toggle strong\s*\{[\s\S]*?margin-left:\s*2px;/u);
assert.match(stylesSource, /:not\(\.mobile-registry-filters-open\)[^\{]*\.collection-primary-filters,[\s\S]{0,180}\.student-list-advanced-filters\s*\{\s*display: none;/u);
assert.match(stylesSource, /\.mobile-registry-filters-open \.collection-primary-filters\s*\{\s*display: grid;/u);
assert.match(appSource, /data-action="open-student-bulk-operations" data-mobile-label="Гр\. операции"/u);
assert.match(stylesSource, /\[data-action="open-student-bulk-operations"\]::after\s*\{[\s\S]*content: attr\(data-mobile-label\);/u);
assert.match(stylesSource, /@media \(min-width: 721px\) and \(max-width: 1180px\)[\s\S]*\.student-list-advanced-filters > button\s*\{[\s\S]*grid-column: 3 \/ 5;/u);

console.log("mobile registry filters checks: OK");

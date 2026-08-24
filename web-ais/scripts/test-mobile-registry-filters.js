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
assert.match(appSource, /toggleMobileRegistryFilters\(event\.currentTarget\)/u);
assert.match(appSource, /mobile-registry-filters-open[\s\S]{0,500}setMobileRegistryFiltersOpen/u);
assert.match(stylesSource, /\.collection-primary-filters\s*\{\s*display: contents;/u);
assert.match(stylesSource, /@media \(max-width: 720px\)[\s\S]*\.mobile-registry-filters-toggle\s*\{\s*display: inline-flex;/u);
assert.match(stylesSource, /:not\(\.mobile-registry-filters-open\)[^\{]*\.collection-primary-filters,[\s\S]{0,180}\.student-list-advanced-filters\s*\{\s*display: none;/u);
assert.match(stylesSource, /\.mobile-registry-filters-open \.collection-primary-filters\s*\{\s*display: grid;/u);

console.log("mobile registry filters checks: OK");

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");

assert.match(stylesSource, /\.data-table th\s*\{[\s\S]*?overflow:\s*hidden;[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/u);
assert.match(stylesSource, /\.data-table th button\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?overflow:\s*hidden;[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;[\s\S]*?overflow-wrap:\s*normal;/u);
assert.match(stylesSource, /\.data-table \.table-head-cell > button\s*\{[\s\S]*?flex:\s*1 1 auto;/u);
assert.match(stylesSource, /\.data-table thead th button > span:first-child\s*\{[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/u);
assert.match(stylesSource, /\.statistics-profitability-column-head \.statistics-table-sort-button > span:first-child\s*\{[\s\S]*?white-space:\s*nowrap;/u);
assert.match(stylesSource, /\.advertising-history-table th\s*\{\s*white-space:\s*nowrap;/u);
assert.match(stylesSource, /\.employee-payment-table thead th\s*\{[\s\S]*?white-space:\s*normal;/u);

console.log("single-line table heading checks: OK");

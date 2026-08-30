"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.resolve(__dirname, "..", "app.js");
const source = fs.readFileSync(appPath, "utf8");
const helperStart = source.indexOf("  function normalizeEmployeePaymentDisplayCommentPart(value = \"\") {");
const helperEnd = source.indexOf("  function getEmployeePaymentOrderField(", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "Employee payment comment helper was not found.");
const factory = new Function(
  "unique",
  `${source.slice(helperStart, helperEnd)}\nreturn { getEmployeePaymentDisplayComment };`
);
const { getEmployeePaymentDisplayComment } = factory((values) => [...new Set(values)]);

assert.equal(getEmployeePaymentDisplayComment("", "слушатель: Савельева С.В. · UID 42"), "Савельева С.В. · UID 42");
assert.equal(getEmployeePaymentDisplayComment("Примечание", "слушатель: Савельева С.В."), "Примечание · Савельева С.В.");
assert.equal(getEmployeePaymentDisplayComment("слушатель: Савельева С.В.", "Савельева С.В."), "Савельева С.В.");
assert.equal(getEmployeePaymentDisplayComment("слушатель: Савельева С.В.", "Савельева С.В. · UID 42"), "Савельева С.В. · UID 42");
assert.equal(getEmployeePaymentDisplayComment("Слушатель : Савельева С.В.·UID 42", ""), "Савельева С.В. · UID 42");
assert.equal(getEmployeePaymentDisplayComment("Оплата слушателя: отдельно", ""), "Оплата слушателя: отдельно");
assert.match(source, /if \(key === "comment"\) \{\s*return getEmployeePaymentDisplayComment\(row\.comment, row\.details\);/u);
assert.match(source, /const commentText = normalizeEmployeePaymentFilterText\(getEmployeePaymentDisplayComment\(row\.comment, row\.details\)\);/u);
assert.match(
  source,
  /\{ key: "comment", label: "Комментарий", className: "employee-payment-comment-column", defaultWidth: 96, minWidth: 32, sortType: "text" \}/u
);
assert.match(source, /return \{ min: Number\(column\.minWidth \|\| column\.defaultWidth\), max: 640 \};/u);
assert.match(source, /clamp\(width \|\| column\.defaultWidth, Number\(column\.minWidth \|\| column\.defaultWidth\), 640\)/u);
assert.match(source, /data-min-width="\$\{column\.minWidth \|\| column\.defaultWidth\}"/u);
assert.match(source, /aria-valuemin="\$\{column\.minWidth \|\| column\.defaultWidth\}"/u);

const stylesPath = path.resolve(__dirname, "..", "styles.css");
const stylesSource = fs.readFileSync(stylesPath, "utf8");
const commentColumnRule = stylesSource.match(/\.employee-payment-comment-column\s*\{([^}]*)\}/u)?.[1] || "";
assert.match(commentColumnRule, /width:\s*96px/u);

const start = source.indexOf("  function renderEmployeePaymentAccounting(record) {");
const end = source.indexOf("  function getEmployeePaymentDomRowFilterModel(row) {", start);
assert.ok(start >= 0 && end > start, "Employee payment table renderer was not found.");

const block = source.slice(start, end);
assert.doesNotMatch(block, /слушатель\s*:/iu);
assert.match(block, /student\?\.name\s*\|\|\s*""/u);
assert.match(block, /student\.name\s*\|\|\s*"Партнёрская программа"/u);

console.log("Employee payment comment checks passed.");

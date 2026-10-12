"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");

assert.match(
  appSource,
  /<select data-employee-payment-filter="payment"[^>]*aria-label="Фильтр по статусу"/u
);
assert.match(
  stylesSource,
  /select\[data-employee-payment-filter="payment"\]\s*\{[^}]*background:\s*#fff2a8;/u
);
assert.doesNotMatch(
  stylesSource,
  /\.employee-payment-column-filter\s*>\s*select\s*\{[^}]*background:\s*#fff2a8;/u,
  "Жёлтая подсветка должна применяться только к фильтру статуса."
);

console.log("Employee payment status filter highlight tests passed.");

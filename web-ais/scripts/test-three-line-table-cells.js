"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").replace(/\r\n/gu, "\n");
const stylesSource = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

assert.match(
  appSource,
  /class="table-cell-clamp" data-table-cell-full-text="\$\{escapeAttr\(displayValue\)\}"/u,
  "Текст стандартной ячейки должен получать ограничитель и полное значение"
);
assert.match(appSource, /\$\{clampedValue\}[\s\S]*record-lock-indicator/u);
assert.match(appSource, /<td \$\{mismatchAttrs\}[\s\S]*>\$\{clampedValue\}<\/td>/u);

const tooltipStart = appSource.indexOf("  function getTableCellTooltipTarget");
const tooltipEnd = appSource.indexOf("\n\n  function getSystemHelpTarget", tooltipStart);
assert.ok(tooltipStart >= 0 && tooltipEnd > tooltipStart, "Не найден обработчик подсказки полной ячейки");
const tooltipSource = appSource.slice(tooltipStart, tooltipEnd);
assert.match(tooltipSource, /scrollHeight > target\.clientHeight \+ 1/u);
assert.match(tooltipSource, /target\.dataset\.tooltip = fullText/u);
assert.match(
  appSource,
  /const tableCell = getTableCellTooltipTarget\(node\);[\s\S]*if \(tableCell\) return tableCell;/u
);

assert.match(
  stylesSource,
  /\.table-cell-clamp\s*\{[\s\S]*max-height:\s*4\.05em;[\s\S]*overflow:\s*hidden;[\s\S]*line-height:\s*1\.35;[\s\S]*-webkit-line-clamp:\s*3;/u,
  "Ячейка должна занимать не более трёх строк"
);

console.log("three-line table cell checks: OK");

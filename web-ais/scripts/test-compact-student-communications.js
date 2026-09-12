"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const stylesSource = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

assert.match(
  stylesSource,
  /\.student-communications-tab\s*\{[\s\S]*?gap:\s*6px;[\s\S]*?padding:\s*6px;[\s\S]*?overflow-x:\s*hidden;/u,
  "Вкладка коммуникаций должна использовать компактные отступы"
);
assert.match(
  stylesSource,
  /\.student-communications-tab \.communication-message-grid\s*\{[\s\S]*?gap:\s*6px;/u
);
assert.match(
  stylesSource,
  /\.student-communications-tab \.communication-message-card\s*\{[\s\S]*?gap:\s*4px;[\s\S]*?padding:\s*6px;/u
);
assert.match(
  stylesSource,
  /\.student-communications-tab \.communication-message-card textarea\s*\{[\s\S]*?min-height:\s*110px;/u
);
assert.match(
  stylesSource,
  /@media \(min-width:\s*721px\)[\s\S]*?\.student-tab-body\s*\{[\s\S]*?overflow-y:\s*auto;/u,
  "Вертикальная прокрутка должна оставаться автоматическим резервом для низких экранов"
);
assert.doesNotMatch(
  stylesSource,
  /\.student-communications-tab\s*\{[^}]*overflow-y:\s*scroll/gu,
  "Полоса прокрутки не должна быть принудительно включена"
);

console.log("compact student communications checks: OK");

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n?/gu, "\n");

function extractBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `Не найдено начало блока: ${startMarker}`);
  assert.ok(end > start, `Не найден конец блока: ${endMarker}`);
  return source.slice(start, end).replace(/^  /gmu, "");
}

const context = { state: { modal: null } };
vm.createContext(context);
vm.runInContext(
  `${extractBetween("  function getProgramCardTitle", "\n  function renderProgramModal")}
this.getProgramCardTitleForTest = getProgramCardTitle;`,
  context
);

assert.equal(
  context.getProgramCardTitleForTest({ name: "  Охрана труда  " }, { id: "program-1" }),
  "Охрана труда",
  "В заголовке существующей карточки должно отображаться название программы без крайних пробелов."
);
assert.equal(
  context.getProgramCardTitleForTest({ name: "Копия — Пожарная безопасность" }, { duplicateSourceId: "source-1" }),
  "Копия — Пожарная безопасность",
  "У дубликата с названием заголовком должно оставаться само название."
);
assert.equal(context.getProgramCardTitleForTest({}, null), "Новая программа");
assert.equal(context.getProgramCardTitleForTest({}, { duplicateSourceId: "source-1" }), "Копия программы");
assert.equal(context.getProgramCardTitleForTest({}, { id: "program-empty" }), "Программа без названия");

const modalSource = extractBetween("  function renderProgramModal", "\n  function getProgramFieldsByTab");
assert.match(modalSource, /const title = getProgramCardTitle\(record\)/u);
assert.match(modalSource, /aria-label="\$\{escapeAttr\(title\)\}"/u);
assert.match(modalSource, /<h2 data-program-card-title>\$\{escapeHtml\(title\)\}<\/h2>/u);
assert.doesNotMatch(modalSource, /<h2>\$\{title\}<\/h2>/u, "Название нельзя выводить без HTML-экранирования.");

const liveTitleSource = extractBetween(
  "  function updateProgramCardTitleFromInput",
  "\n  function populateProgramCommissionPreview"
);
assert.match(liveTitleSource, /heading\.textContent = title/u);
assert.match(liveTitleSource, /modal\.setAttribute\("aria-label", title\)/u);
assert.match(
  source,
  /programForm\?\.querySelector\('\[name="name"\]'\)\?\.addEventListener\("input",[\s\S]*?updateProgramCardTitleFromInput/u,
  "Заголовок должен обновляться сразу при вводе названия."
);

console.log("Program card title tests passed.");

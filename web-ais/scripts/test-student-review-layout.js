"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "app-server.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");

const panelStart = appSource.indexOf("  function renderStudentReviewPanel(record) {");
const panelEnd = appSource.indexOf("  function renderStudentFinancialResult(record) {", panelStart);
assert.ok(panelStart >= 0 && panelEnd > panelStart, "Не найдена панель отзыва слушателя.");
const panelSource = appSource.slice(panelStart, panelEnd);
const actionsSource = panelSource.match(/<div class="student-review-actions">([\s\S]*?)<\/div>/u)?.[1] || "";
const reviewTextIndex = panelSource.indexOf('class="student-review-text"');
const publishedIndex = panelSource.indexOf('class="student-review-published"');

assert.doesNotMatch(actionsSource, /student-review-published/u, "Флажок не должен находиться в строке кнопок.");
assert.ok(reviewTextIndex >= 0 && publishedIndex > reviewTextIndex, "Флажок должен находиться непосредственно под отзывом.");
assert.match(panelSource, /<span>Отзыв размещен на сайте<\/span>/u);
assert.equal((appSource.match(/field\("reviewPublished", "Отзыв размещен на сайте", "checkbox"\)/gu) || []).length, 2);
assert.match(serverSource, /reviewPublished:\s*"Отзыв размещен на сайте"/u);
assert.match(stylesSource, /\.student-review-published\s*\{[\s\S]*?justify-self:\s*start;/u);

console.log("Проверка расположения флажка отзыва пройдена.");

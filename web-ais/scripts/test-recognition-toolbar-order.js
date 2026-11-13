"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8").replace(/\r\n/g, "\n");
const extract = (name) => {
  const start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf("\n\n  function ", start + 1);
  assert.ok(start >= 0 && end > start, `Function ${name} is present`);
  return source.slice(start, end);
};
const escape = value => String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
let documentsSource = "local";
const render = new Function(
  "getContractDocumentsFolder", "getStudentYandexDocumentsFolder",
  "normalizeContractDocumentRecognitionResult", "normalizeStudentDocumentRecognitionResult",
  "getStudentDocumentsSource", "escapeAttr", "formatDateTimeRu",
  ["renderOrdersSdoIcon", "renderStudentMailboxDocumentsButton", "renderStudentDocumentRecognitionToolbar"].map(extract).join("\n")
    + "\nreturn renderStudentDocumentRecognitionToolbar;"
)(() => "Сотрудники/Тест/Документы", () => "Слушатели/Тест/Документы",
  value => value || null, value => value || null, () => documentsSource, escape, () => "13.09.2026, 09:00");

for (const entityType of ["student", "contract"]) {
  for (const saved of [false, true]) {
    for (documentsSource of ["local", "yandex"]) {
      const html = render({ id: "test", documentRecognitionResult: saved ? { recognizedAt: "2026-09-13T06:00:00Z" } : null }, { entityType });
      const buttons = [...html.matchAll(/<button\b[\s\S]*?<\/button>/g)].map(match => match[0]);
      assert.deepEqual(buttons.map(button => button.match(/data-action="([^"]+)"/)[1]), [
        "open-student-mailbox-documents", `recognize-${entityType}-documents`, `show-${entityType}-document-recognition-result`
      ], "The saved recognition result must be the last button for both card types");
      assert.match(buttons[0], new RegExp(`data-mailbox-entity-type="${entityType}"`));
      assert.match(buttons[0], /Загрузить из почты/);
      assert.match(buttons[1], /Распознать из папки/);
      assert.match(buttons[2], /aria-label="Показать результат распознавания"/);
      assert.equal(/\bdisabled\b/.test(buttons[2]), !saved, "Availability still depends on saved results");
      assert.match(buttons[2], saved ? /Показать результат распознавания от 13\.09\.2026, 09:00/ : /Сохранённый результат распознавания отсутствует/);
    }
  }
}
console.log("Recognition toolbar: rightmost result button, both card types, sources, availability and tooltips: OK");

if (process.argv.includes("--serve")) {
  const styles = fs.readFileSync(path.join(__dirname, "../styles.css"), "utf8");
  require("node:http").createServer((request, response) => {
    if (request.url === "/styles.css") {
      response.setHeader("Content-Type", "text/css; charset=utf-8");
      response.end(styles);
      return;
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    const record = { id: "test", name: "Тест", email: "test@example.com", documentRecognitionResult: { recognizedAt: "2026-09-13T06:00:00Z" } };
    const fixtures = [1080, 600].flatMap(width => ["student", "contract"].map(entityType =>
      `<h3>${entityType === "student" ? "Слушатель" : "Сотрудник"} — ${width}px</h3><div class="${entityType}-documents-tab" style="width:${width}px">${render(record, { entityType })}</div>`
    )).join("");
    response.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Проверка панели распознавания</title><link rel="stylesheet" href="/styles.css"><body style="padding:16px;background:white">${fixtures}</body></html>`);
  }).listen(0, "127.0.0.1", function () { console.log(`Fixture: http://127.0.0.1:${this.address().port}/`); });
}

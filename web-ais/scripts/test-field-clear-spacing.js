const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
function extract(name) {
  const start = app.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `Missing ${name}`);
  const end = app.indexOf("\n  function ", start + 1);
  return app.slice(start, end);
}
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const render = vm.runInNewContext(`${extract("renderComboField")}\n${extract("renderIssuerLookupField")}\n({renderComboField, renderIssuerLookupField})`, {
  unique: values => [...new Set(values)], escapeAttr: escapeHtml, escapeHtml,
  getPassportIssuerOptions: () => [], getEducationDocumentIssuerOptions: () => []
});

// The fixture uses production renderers, the full CSS cascade and link highlighter.
// It never loads application state or writes to the shared database.
function browserChecks() {
  const results = document.getElementById("results");
  const lines = [];
  let failed = 0;
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  for (const field of document.querySelectorAll("[data-combo-input]")) {
    const label = field.getAttribute("aria-label");
    const measure = () => {
      const rect = field.getBoundingClientRect();
      const style = getComputedStyle(field);
      const button = field.parentElement.querySelector(".combo-clear").getBoundingClientRect();
      const contentRight = rect.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
      check(button.left - contentRight >= 4, `текст под крестиком (зазор ${Math.round(button.left - contentRight)}px)`);
      check(field.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) > 30, "нет места для ввода");
      const overlay = field.parentElement.querySelector("[data-native-html-link-highlight]");
      if (overlay) {
        const inset = getComputedStyle(overlay).clipPath.match(/^inset\(([^)]+)\)/)[1].split(/\s+/).map(parseFloat);
        check(overlay.getBoundingClientRect().right - inset[1] <= contentRight + 1, "подсветка заходит под крестик");
        check(overlay.querySelectorAll("[data-template-external-url]").length === 1, "нет подсветки ссылки");
      }
    };
    try {
      const initial = field.value;
      measure();
      field.focus();
      field.value = "https://example.test/very-long-program-name/registration/details";
      field.setSelectionRange(field.value.length, field.value.length);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      check(field.selectionStart === field.value.length, "курсор сдвинулся");
      check(field.parentElement.querySelector("[data-native-html-link-highlight]"), "подсветка не создана");
      measure();
      field.setSelectionRange(0, field.value.length);
      field.dispatchEvent(new Event("select", { bubbles: true }));
      measure();
      field.value = initial;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.blur();
      lines.push(`${label}: OK`);
    } catch (error) { failed++; lines.push(`${label}: ${error.message}`); }
  }
  for (const field of document.querySelectorAll(".lookup-field > input")) {
    try {
      const rect = field.getBoundingClientRect();
      for (const button of field.parentElement.querySelectorAll(".lookup-trigger, .lookup-clear")) {
        check(rect.right < button.getBoundingClientRect().left, "кнопка поиска/очистки перекрывает поле");
      }
      lines.push("Справочник: OK");
    } catch (error) { failed++; lines.push(error.message); }
  }
  results.textContent = (failed ? `Ошибок: ${failed}` : "Все проверки пройдены") + "\n" + lines.join("\n");
  results.dataset.status = failed ? "failed" : "passed";
}

function fixture() {
  const cases = [
    ["Обычное поле", "", "form-grid"],
    ["ФИО слушателя", "student-main-tab", "student-name-status-grid"],
    ["Программа слушателя", "student-main-tab", "student-main-program-row"],
    ["Основное слушателя", "student-main-tab", "student-form-grid"],
    ["Документы слушателя", "student-documents-tab", "student-form-grid"],
    ["Сотрудник", "", "contract-form-grid"],
    ["Документы сотрудника", "contract-documents-tab", "contract-form-grid"],
    ["Выплаты сотрудника", "employee-payment-table", "employee-payment-basis-cell"],
    ["Общие расходы", "expense-grid editable-grid", "editable-grid-cell"],
    ["Расходы слушателя", "student-income-tab", "expense-grid editable-grid"],
    ["Распознавание", "student-document-recognition-field-value", "student-document-recognition-field-control"],
    ["Комиссия", "program-commission-source-panel", ""],
    ["Ссылка", "student-main-tab", "student-name-status-grid"]
  ];
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Отступ перед крестиком</title>
    <link rel="stylesheet" href="/styles.css"><style>
    body{display:block;margin:12px;font:14px 'Segoe UI',sans-serif}.qa-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;max-width:1000px}
    .qa-case{min-width:0;border:1px solid #d6e1de;padding:8px}.qa-case h2{font-size:13px;margin:0 0 8px}
    .qa-case .qa-control{display:block;margin:0;padding:0;min-width:0}.qa-case input{width:100%}#results{white-space:pre-wrap;font-size:12px}
    </style></head><body><h1>Отступ перед крестиком</h1><div class="qa-grid">
    ${cases.map(([label, outer, inner], index) => `<section class="qa-case ${outer}"><h2>${label}</h2><div class="qa-control ${inner}">${render.renderComboField({ name: `test${index}`, type: index % 2 ? "search" : "text", value: label === "Ссылка" ? "https://example.test/very-long-program-name/registration/details" : "Длинное название образовательной программы для проверки отступа перед кнопкой очистки", attrs: `aria-label="${label}"` })}</div></section>`).join("")}
    <section class="qa-case student-documents-tab"><h2>Кем выдан</h2><div class="student-issuer-field">${render.renderIssuerLookupField('<label>', { key: "passportIssuer" }, "Очень длинное наименование подразделения, выдавшего документ", "")}</div></section>
    </div><button id="run-checks">Проверить отступы и ссылки</button><pre id="results">Готово к проверке</pre>
    <script src="/field-html-links.js"></script><script>const run = ${browserChecks.toString()}; document.getElementById('run-checks').addEventListener('click', run); window.addEventListener('load', run);</script></body></html>`;
}

assert.match(fixture(), /data-combo-input/);
new vm.Script(`const run = ${browserChecks.toString()};`);
if (process.argv.includes("--serve")) {
  const server = http.createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const file = request.url.split("?")[0].slice(1);
    if (file === "shutdown" && request.method === "POST") {
      response.end("Stopped"); server.close(); return;
    }
    if (["styles.css", "field-html-links.js"].includes(file)) {
      response.setHeader("Content-Type", file.endsWith("css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8");
      response.end(fs.readFileSync(path.join(root, file))); return;
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(fixture());
  });
  server.listen(0, "127.0.0.1", () => console.log(`Preview: http://127.0.0.1:${server.address().port}/`));
  const expiry = setTimeout(() => server.close(), 20 * 60 * 1000);
  expiry.unref();
  server.on("close", () => clearTimeout(expiry));
} else {
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  assert.match(css, /\.combo-input-wrap:has\(> \.combo-clear\) > input\s*\{[^}]*padding-right:\s*var\(--combo-clear-space,\s*40px\) !important;/);
  assert.match(css, /\.employee-payment-basis-cell \.combo-input-wrap\s*\{\s*--combo-clear-space: 27px;/);
  assert.match(css, /\.student-income-tab \.expense-grid \.combo-input-wrap\s*\{\s*--combo-clear-space: 25px;/);
  console.log("Field clear spacing invariant and production-renderer browser fixture: OK");
}

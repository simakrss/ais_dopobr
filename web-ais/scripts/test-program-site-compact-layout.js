"use strict";
// --serve renders the real template/functions with synthetic data on loopback only.
// No authentication, shared records, WordPress calls or real generation actions.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const extract = (source, start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, start);
  return source.slice(a, b);
};
const escape = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
function preview(type = "ПРО", result = false) {
  const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const generator = extract(source, "  async function openProgramSiteGenerator(", "  function renderProgramModal(");
  const className = generator.match(/dialog.className = "([^"]+)"/)[1];
  const markup = generator.match(/dialog.innerHTML = (`[\s\S]*?`);\s*document.body.appendChild\(dialog\)/)[1];
  const fieldsSource = extract(source, 'field("webinarDate",', 'field("qualification",');
  const fields = new Function("field", `return [${fieldsSource}];`)((key, label, fieldType, required, dict, options) => ({key, label, type: fieldType, required, dict, options}));
  const renderField = new Function("state", "escapeAttr", "escapeHtml", `${extract(source, "  function renderField(", "  function renderStudentModal(")} return renderField;`)({modal: {config: "programs"}}, escape, escape);
  const renderGenerator = new Function("configs", "renderField", "escapeAttr", `${extract(source, "  function renderProgramGeneratorFields(", "  function createProgramSiteProgress(")} return renderProgramGeneratorFields;`)({programs: {fields}}, renderField, escape);
  const program = {type, name: "Тестовая образовательная программа: актуальное название статьи как основной критерий конкурентоспособности автора", webinarDate: "2026-09-18", webinarTime: "18:00", webinarJoinUrl: "https://salutejazz.ru/example", siteSampleDate: "2026-09-15"};
  let html = new Function("escapeHtml", "type", "program", "bilingual", `return ${markup};`)(escape, type, program, ["ПРО", "ДОП"].includes(type));
  html = html.replace("<details data-site-parameters>", "<details data-site-parameters open>")
    .replace('<div data-site-parameters-host></div>', `<div data-site-parameters-host>${renderGenerator(program).replace('data-site-generator-fields hidden', 'data-site-generator-fields')}</div>`)
    .replace('required disabled><option value="">Загрузка…</option>', 'required><option value="42">Тестовый лендинг-прототип образовательной программы</option>');
  if (result) html = html.replace('<section data-site-result hidden></section>', '<section data-site-result><h3>Черновики подготовлены</h3><p>ID товара: 123; ID лендинга: 456</p><div class="program-site-actions"><a class="ghost-button compact-button" href="#">Просмотреть лендинг</a><a class="ghost-button compact-button" href="#">Редактировать товар</a></div><p class="muted">Образцы созданы для этой программы.</p><label class="program-site-review"><input type="checkbox"> Проверены все блоки лендинга и образцы документов</label><button class="primary-button" data-site-publish>Опубликовать</button></section>');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Проверка компактной формы ${escape(type)}</title><link rel="stylesheet" href="/styles.css"></head><body><form id="recordForm"></form><dialog class="${className}" aria-label="Тестовая форма генератора">${html}</dialog><script>document.querySelector('dialog').showModal();document.querySelector('[data-site-close]').onclick=()=>document.querySelector('dialog').close();</script></body></html>`;
}
function checks() {
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  assert.match(css, /\.program-site-generator-dialog \.program-site-fields\s*\{[^}]*padding:\s*0;[^}]*gap:\s*7px 10px;/);
  assert.match(css, /\.program-site-generator-dialog \.program-site-body\s*\{[^}]*gap:\s*8px;[^}]*padding:\s*10px 12px;/);
  assert.match(css, /\.program-site-generator-dialog \.program-site-prototype-fields\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 600px\)\s*\{[^}]*\.program-site-generator-dialog \.program-site-prototype-fields\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.program-site-generator-dialog \[data-site-status\]:empty/);
  for (const type of ["ПРО", "ДОП", "КПК", "ППП"]) {
    const html = preview(type, true);
    assert.match(html, /class="modal program-site-dialog program-site-generator-dialog"/);
    assert.match(html, /name="siteProductName"/); assert.match(html, /data-site-template[^>]*required/);
    assert.match(html, /data-site-prepare/); assert.match(html, /data-site-progress/); assert.match(html, /data-site-publish/);
    assert.match(html, /program-site-prototype-fields/);
    if (type !== "ПРО") assert.match(html, /data-site-webinar-only hidden/);
  }
  console.log("PASS: compact scoped grids/spacing, responsive prototype controls, all program types, retained required fields and generation/review controls");
}
if (process.argv.includes("--serve")) {
  const http = require("node:http");
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/shutdown" && req.method === "POST") {res.end("Stopped"); server.close(); clearTimeout(expiry); return;}
    if (url.pathname === "/styles.css") {res.setHeader("Content-Type", "text/css; charset=utf-8"); res.end(fs.readFileSync(path.join(root, "styles.css"))); return;}
    if (url.pathname !== "/") {res.writeHead(404); res.end(); return;}
    const type = ["ПРО", "ДОП", "КПК", "ППП"].includes(url.searchParams.get("type")) ? url.searchParams.get("type") : "ПРО";
    res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(preview(type, url.searchParams.has("result")));
  });
  const expiry = setTimeout(() => server.close(), 20 * 60 * 1000);
  server.listen(0, "127.0.0.1", () => console.log(`Layout fixture: http://127.0.0.1:${server.address().port}/`));
} else checks();

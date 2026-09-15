"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const workflow = require("../document-workflow.js");

function extract(name) {
  const start = app.indexOf(`  function ${name}(`);
  const end = app.indexOf("\n  function ", start + 1);
  assert.ok(start >= 0 && end > start, name);
  return app.slice(start, end);
}

const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

function render(kind = 0, options = {}) {
  const documents = workflow.definitions.map(d => ({ ...d, generationFormat: "pdf" }));
  const programs = Array.from({length: 24}, (_, i) => ({
    type: i % 2 ? "КПК" : "ППП",
    name: `Программа ${i + 1}: Использование электронной информационно-образовательной среды и средств информационно-коммуникационных технологий в образовательном процессе вуза (36 ч)`
  }));
  if (options.longTitle) documents[0].title = 'Документ <проверка> "Название" ' + "ДлинноеНазвание".repeat(20);
  const context = {
    window: { AIS_DOCUMENT_WORKFLOW: { ...workflow, evaluateLists: () => {
      if (options.error) throw new Error('Неверная формула <Список>');
      return {programs: options.empty ? [] : programs};
    }}},
    getWorkflowDocuments: () => options.noTemplates ? [] : documents,
    getWorkflowPrograms: () => programs,
    getDocumentWorkflowDraft: () => ({date: "2026-09-14", documentId: documents[kind].id, format: "pdf"}),
    escapeHtml: escape, escapeAttr: escape
  };
  vm.createContext(context);
  vm.runInContext(extract("syncDocumentWorkflowDefaultOrderNumber") + extract("renderDocumentWorkflow"), context);
  return context.renderDocumentWorkflow();
}

for (let kind = 0; kind < workflow.definitions.length; kind++) {
  const html = render(kind);
  assert.equal((html.match(/data-workflow-document=/g) || []).length, 3);
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1);
  assert.match(html, /class="document-workflow-toolbar"[\s\S]*?class="document-workflow-fields"[\s\S]*?class="document-workflow-actions"/);
  assert.equal(html.includes('name="orderNo"'), kind !== 2);
  assert.match(html, /name="date" type="date" required value="2026-09-14"/);
  assert.match(html, /name="format"/);
  assert.match(html, /<details class="document-workflow-hint"><summary>Источник данных и порядок сохранения<\/summary>/);
  assert.doesNotMatch(html, /<details[^>]*\bopen\b/);
  assert.match(html, /Перед сохранением откроется предпросмотр\. Отправка по почте не выполняется/);
  assert.match(html, /Программы в документе: 24/);
  assert.equal((html.match(/<li title=/g) || []).length, 24, "Full names remain available as tooltips");
  assert.doesNotMatch(html, /type="submit" disabled/);
}
for (const options of [{empty: true}, {error: true}]) {
  const html = render(0, options);
  assert.match(html, /type="submit" disabled/);
  assert.match(html, options.error ? /role="alert">Ошибка формулы: Неверная формула &lt;Список&gt;/ : /Нет программ, соответствующих условиям формулы/);
  assert.ok(html.indexOf("</details>") < html.indexOf('class="document-workflow-programs"'), "Errors and empty states must not be hidden in the explanation");
}
assert.match(render(0, {noTemplates: true}), /Добавьте шаблон/);
assert.match(render(0, {longTitle: true}), /&lt;проверка&gt; &quot;Название&quot;/);

function rule(selector) {
  const start = styles.indexOf(selector + " {");
  assert.ok(start >= 0, selector);
  return styles.slice(start, styles.indexOf("}", start) + 1);
}
assert.match(rule(".document-workflow-layout"), /grid-template-columns: minmax\(0, 1fr\)/);
assert.match(rule(".document-workflow-list"), /flex-wrap: wrap/);
assert.match(rule(".document-workflow-toolbar"), /flex-wrap: wrap/);
assert.match(rule(".document-workflow-choice"), /max-width: 100%/);
assert.match(rule(".document-workflow-choice"), /min-height: 32px/);
assert.match(rule(".document-workflow-programs li"), /text-overflow: ellipsis/);
assert.match(rule(".document-workflow-programs ul"), /overflow: auto/);
assert.match(styles, /@media \(max-width: 480px\)\s*\{\s*\.document-workflow-panel[^}]*\}/);
const bootstrap = fs.readFileSync(path.join(root, "auth-bootstrap.js"), "utf8");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const build = bootstrap.match(/const AUTH_BUILD = "([^"]+)"/)[1];
assert.ok(index.includes(`styles.css?v=${build}`));
assert.ok(index.includes(`const build = "${build}"`));
console.log("Compact document workflow: all templates, controls, collapsed explanation, visible errors, tooltips, responsive rules and cache version: OK");

// Optional read-only visual fixture. Uses the real renderer/CSS and synthetic data;
// never accesses the live database, credentials or document-generation endpoints.
if (process.argv.includes("--serve")) {
  const server = require("node:http").createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/styles.css") {
      res.writeHead(200, {"Content-Type": "text/css; charset=utf-8"});
      return res.end(fs.readFileSync(path.join(root, "styles.css"), "utf8"));
    }
    if (url.pathname !== "/") { res.writeHead(404); return res.end(); }
    const kind = Math.max(0, Math.min(2, Number(url.searchParams.get("kind")) || 0));
    const html = render(kind, Object.fromEntries(["empty", "error", "longTitle"].map(key => [key, url.searchParams.has(key)])));
    res.writeHead(200, {"Content-Type": "text/html; charset=utf-8"});
    res.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Проверка компоновки — Документооборот</title><link rel="stylesheet" href="/styles.css"><body style="margin:0;padding:12px"><main>${html}</main><script>document.querySelector('form')?.addEventListener('submit', e => e.preventDefault());</script></body></html>`);
  });
  server.listen(0, "127.0.0.1", () => console.log(`Visual fixture: http://127.0.0.1:${server.address().port}/`));
}

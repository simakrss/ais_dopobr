"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const start = source.indexOf("  function renderProgramModal(record)");
const headerStart = source.indexOf("<header ", start);
const header = source.slice(headerStart, source.indexOf("</header>", headerStart) + 9);
const escape = value => String(value).replace(/[&<>"']/gu, char => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[char]);
function renderHeader(existing = true) {
  return vm.runInNewContext("`" + header + "`", {
    config: {title: "Образовательные программы"},
    title: "Использование электронной информационно-образовательной среды и средств информационно-коммуникационных технологий в образовательном процессе вуза (36 ч)",
    record: existing ? {id: "test-program"} : {},
    state: {modal: existing ? {id: "test-program"} : {}},
    navigation: {hasPrev: existing, hasNext: existing},
    escapeHtml: escape,
    renderCardRecordLockStatus: () => '<span class="record-lock-badge">Запись заблокирована вами</span>',
    renderOrdersSdoIcon: () => '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M6 6h12v12H6z"/></svg>'
  });
}
for (const existing of [true, false]) {
  const html = renderHeader(existing);
  assert.match(html, /class="program-card-save-actions">\s*<button class="primary-button" type="submit">Сохранить<\/button>\s*<button[^>]*data-action="close-modal"[^>]*type="button"[^>]*>×<\/button>\s*<\/div>/u);
  assert.equal((html.match(/data-action="close-modal"/gu) || []).length, 1, "Only one close button");
  assert.equal((html.match(/data-action="navigate-program-card"/gu) || []).length, 2, "Both navigation buttons remain");
  assert.equal(html.includes('data-action="copy-program-with-training-plan"'), existing);
  assert.ok(html.indexOf('data-action="close-modal"') < html.indexOf('class="student-card-nav program-card-nav"'));
}
assert.match(css, /\.program-card-save-actions\s*\{\s*flex:\s*0 0 auto;\s*flex-wrap:\s*nowrap;/u);
console.log("Program header actions: close immediately after Save, navigation intact, existing/new records — OK");

// Real header and CSS in responsive frames; synthetic data only, no application writes.
if (process.argv.includes("--serve")) {
  const cases = [1248, 800, 601, 600, 390, 320].map(width => ({width, existing: true}));
  cases.push({width: 320, existing: false});
  const server = require("node:http").createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    response.setHeader("Cache-Control", "no-store");
    if (url.pathname === "/styles.css") {
      response.setHeader("Content-Type", "text/css; charset=utf-8");
      response.end(css);
      return;
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    if (url.pathname === "/case") {
      const id = Number(url.searchParams.get("id")), test = cases[id];
      if (!test) { response.statusCode = 404; response.end(); return; }
      response.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css">
        <div class="modal-backdrop"><section class="modal program-modal"><form>${renderHeader(test.existing)}</form></section></div>
        <script>addEventListener('load',()=>{
          const h=document.querySelector('header'), s=h.querySelector('[type=submit]'), c=h.querySelector('[data-action="close-modal"]'), n=h.querySelector('.program-card-nav'), title=h.querySelector('.program-modal-title');
          const a=s.getBoundingClientRect(),b=c.getBoundingClientRect(),t=title.getBoundingClientRect(),nav=n.getBoundingClientRect(),errors=[];
          if(Math.abs(a.top+a.height/2-b.top-b.height/2)>1 || b.left<a.right || b.left-a.right>11) errors.push('close not immediately beside Save');
          if(nav.top<b.bottom) errors.push('navigation overlaps primary actions');
          if(t.right>b.left && t.bottom>b.top) errors.push('title overlaps buttons');
          if(h.scrollWidth>h.clientWidth+1 || b.right>h.getBoundingClientRect().right) errors.push('horizontal overflow');
          parent.postMessage({id:${id},width:innerWidth,existing:${test.existing},errors},location.origin);
        });</script></html>`);
      return;
    }
    response.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Крестик после сохранения — проверка</title><style>body{font:14px Arial}iframe{display:block;border:0;margin-bottom:20px}</style>
      <h1>Карточка программы: кнопки заголовка</h1><pre id="results">Проверка…</pre>
      <script>const results={};addEventListener('message',event=>{if(event.origin!==location.origin || !Number.isInteger(event.data.id))return;results[event.data.id]=event.data;document.getElementById('results').textContent=Object.values(results).map(r=>r.width+' px'+(r.existing?'':' (новая)')+': '+(r.errors.length?r.errors.join('; '):'OK')).join(String.fromCharCode(10))+String.fromCharCode(10)+'Готово: '+Object.keys(results).length+'/${cases.length}';});</script>
      ${cases.map((test,id)=>`<iframe title="Программа ${test.width} ${test.existing ? 'существующая' : 'новая'}" width="${test.width}" height="360" src="/case?id=${id}"></iframe>`).join("")}</html>`);
  });
  server.listen(0, "127.0.0.1", () => console.log(`Program header fixture: http://127.0.0.1:${server.address().port}/`));
}

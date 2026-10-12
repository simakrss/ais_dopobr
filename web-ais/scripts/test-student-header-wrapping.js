const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const rule = (selector) => {
  const start = styles.indexOf(`${selector} {`);
  assert.ok(start >= 0, selector);
  return styles.slice(start, styles.indexOf("}", start));
};
assert.match(rule(".student-modal-title"), /min-width:\s*0;/u);
assert.match(rule(".student-modal-title"), /flex:\s*1 1 0;/u);
assert.match(rule(".student-modal-title"), /grid-template-columns:\s*minmax\(0, 1fr\);/u);
assert.match(rule(".student-modal-title"), /overflow-wrap:\s*anywhere;/u);
assert.match(rule(".student-modal-head .modal-head-actions"), /flex:\s*0 0 auto;/u);

function between(start, end) {
  const offset = app.indexOf(start);
  const limit = app.indexOf(end, offset + start.length);
  assert.ok(offset >= 0 && limit > offset, start);
  return app.slice(offset, limit);
}
const modalSource = between("  function renderStudentModal(record)", "  function renderStudentHeaderStatus");
const header = modalSource.slice(modalSource.indexOf("<header "), modalSource.indexOf("</header>") + 9);
const controls = between("  function renderCardWindowControls()", "  function renderContractModal(record)");
const lockStatus = between("  function renderCardRecordLockStatus(record", "  function renderDocumentTemplateRecordLockStatus");
const escapeHtml = value => String(value).replace(/[&<>"']/gu, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const program = "Использование электронной информационно-образовательной среды и средств информационно-коммуникационных технологий в образовательном процессе вуза (36 ч)";
function renderHeader(longWord = false, minimized = false) {
  const context = vm.createContext({
    title: "Иванова Мария Александровна [1168]",
    programTitle: longWord ? "НазваниеПрограммыБезПробелов".repeat(8) : program,
    record: { id: "test-student" },
    navigation: { hasPrev: true, hasNext: true },
    escapeHtml, escapeAttr: escapeHtml,
    getCardWindowState: () => ({ minimized, fullscreen: false }),
    getCardRecordLock: () => ({ ownedByClient: true }),
    renderStudentHeaderStatus: () => '<select class="student-status student-status-select"><option>Учится</option><option>На зачисление</option></select>',
    renderOrdersSdoIcon: () => '<svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>',
    renderCardContextActions: () => `<div class="student-card-quick-actions">${["Папка", "Данные", "Письмо", "MAX", "Telegram", "WhatsApp"].map(label => `<button class="icon-button student-card-header-action" title="${label}">↗</button>`).join("")}</div>`
  });
  vm.runInContext(controls + lockStatus, context);
  return vm.runInContext("`" + header + "`", context);
}
assert.match(renderHeader(), /student-modal-title/u);
console.log("Student header reserves action width and wraps program text: OK");

// Optional browser fixture uses the real header template and complete stylesheet,
// with synthetic data only. Each iframe gets its own responsive viewport.
if (process.argv.includes("--serve")) {
  const http = require("node:http");
  const cases = [
    { width: 1248 }, { width: 1024 }, { width: 800 }, { width: 721 },
    { width: 720 }, { width: 375 }, { width: 320 },
    { width: 1024, longWord: true }, { width: 375, longWord: true },
    { width: 800, minimized: true }
  ];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    response.setHeader("Cache-Control", "no-store");
    if (url.pathname === "/styles.css") {
      response.setHeader("Content-Type", "text/css; charset=utf-8");
      response.end(fs.readFileSync(path.join(root, "styles.css")));
      return;
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    if (url.pathname === "/case") {
      const index = Number(url.searchParams.get("id"));
      const test = cases[index];
      if (!test) { response.statusCode = 404; response.end(); return; }
      response.end(`<!doctype html><html lang="ru"><meta charset="utf-8">
        <link rel="stylesheet" href="/styles.css"><style>body{margin:0}.modal{width:100%;max-height:none}</style>
        <section class="modal student-modal card-window ${test.minimized ? "is-window-minimized" : ""}"><form>${renderHeader(test.longWord, test.minimized)}</form></section>
        <script>window.addEventListener('load', () => {
          const header = document.querySelector('.student-modal-head');
          const title = header.querySelector('.student-modal-title');
          const actions = header.querySelector('.modal-head-actions');
          const h = header.getBoundingClientRect(), t = title.getBoundingClientRect(), a = actions.getBoundingClientRect();
          const errors = [];
          if (innerWidth > 720 || ${Boolean(test.minimized)}) {
            if (t.right > a.left - 9) errors.push('title overlaps action area');
          } else if (t.bottom > a.top) errors.push('mobile title overlaps actions');
          if (a.right > h.right || a.left < h.left) errors.push('actions outside header');
          if (header.scrollWidth > header.clientWidth + 1) errors.push('header overflows horizontally');
          const paragraph = title.querySelector('p');
          if (getComputedStyle(paragraph).display !== 'none') {
            const range = document.createRange(); range.selectNodeContents(paragraph);
            for (const r of range.getClientRects()) if (r.right > t.right + 1 || r.left < t.left - 1) errors.push('program text outside title');
          }
          parent.postMessage({case: ${index}, width: innerWidth, errors, gap: Math.round(a.left - t.right)}, location.origin);
        });</script></html>`);
      return;
    }
    response.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Проверка заголовка карточки</title>
      <style>body{font:14px Arial;background:#eef3f0;margin:12px}iframe{display:block;border:0;margin:8px 0 20px}pre{white-space:pre-wrap}</style>
      <h1>Перенос названия программы</h1><pre id="results">Проверяется…</pre>
      <script>const results = {}; addEventListener('message', event => {
        if(event.origin !== location.origin || !Number.isInteger(event.data.case)) return;
        results[event.data.case] = event.data;
        document.getElementById('results').textContent = Object.values(results).map(r => r.width + ' px: ' + (r.errors.length ? r.errors.join('; ') : 'OK')).join(String.fromCharCode(10)) + String.fromCharCode(10) + 'Готово: ' + Object.keys(results).length + '/${cases.length}';
      });</script>
      ${cases.map((test, index) => `<div>${test.width} px${test.longWord ? " — длинное слово" : ""}${test.minimized ? " — свёрнутая карточка" : ""}</div><iframe title="Сценарий ${index}" width="${test.width}" height="${test.width > 720 ? 210 : 250}" src="/case?id=${index}"></iframe>`).join("")}</html>`);
  });
  server.listen(0, "127.0.0.1", () => console.log(`Preview: http://127.0.0.1:${server.address().port}/`));
}

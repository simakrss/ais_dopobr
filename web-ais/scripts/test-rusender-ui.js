"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), crypto = require("node:crypto");
const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const block = source.slice(source.indexOf("  const rusenderUi ="), source.indexOf("  function renderAdvertising()"));
const helpers = ["escapeHtml", "escapeAttr"].map(name => source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`, "m"))[0]).join("\n");
const data = { connected: true, templates: { complete: true, items: [{ id: 100, name: "Шаблон статьи ВАК" }] }, campaigns: { complete: true, syncedAt: "2026-10-09T09:00:00Z", items: [{ id: 1, name: "<img src=x onerror=alert(1)>", subject: "Тема", status: "completed", templateId: 100, lists: [{ id: 2, name: "Подписчики" }], stats: { total: 100, open: { count: 30 }, click: { count: 6 }, error: { count: 1 }, unsubscribe: { count: 2 }, complaint: { count: 0 } } }] }, lists: { complete: true, items: [{ id: 2, name: "Подписчики" }] }, senders: { complete: true, items: [{ id: 3, email: "sender@example.invalid", verified: "enabled" }] }, programs: [{ id: "p1", name: "Подготовка статей ВАК", type: "ПРО", hours: "1", status: "Набор" }, { id: "p2", name: "Программа без шаблона", type: "КПК", hours: "72" }], bindings: [{ programId: "p1", templateIds: [100] }], plans: [] };
data.templates.items.push({ id: 200, name: "Письмо № 15 — новые методы преподавания математики" }, { id: 201, name: "Математика — осенняя рассылка" });
data.programs.push({ id: "p3", name: "Современные технологии преподавания математики в условиях реализации ФГОС", type: "КПК", hours: "72", status: "Набор" });
data.recommendations = [{ programId: "p1", templateId: 100, score: 98, reasons: ["Тема / название рассылки", "Текст письма"], ambiguous: false, candidates: [{ templateId: 100, score: 98 }] }, { programId: "p3", templateId: 200, score: 92, reasons: ["Текст письма"], ambiguous: false, candidates: [{ templateId: 200, score: 92 }, { templateId: 201, score: 76 }] }];
data.templateContext = { checked: 3, total: 3, pendingTemplateIds: [] };
const context = vm.createContext({ Date, Intl, URL, AbortController, Uint8Array, crypto: crypto.webcrypto, setTimeout, clearTimeout, state: { view: "advertising", advertising: { tab: "mailings" } }, isAdminUser: () => true, document: { querySelector: () => null }, render: () => {}, authRequest: async () => structuredClone(data) });
vm.runInContext(helpers + "\n" + block + "\nthis.api={rusenderUi,renderRusender,loadRusender,loadRusenderTemplateContext,rusenderRun,startRusenderPlan,rusenderUuid,rusenderTemplateChoice,renderRusenderProgramRow};", context);
(async () => {
  const { api } = context; const ui = api.rusenderUi;
  assert.match(api.renderRusender(), /Подключите API/);
  await api.loadRusender(); assert.equal(ui.busy, false); assert.equal(ui.loaded, true);
  let html = api.renderRusender();
  assert.match(html, /Почтовые рассылки/); assert.match(html, /6 \(6.00%\)/); // CTR by total, not 20% by opens.
  assert.ok(!html.includes("<img src=x")); assert.ok(html.includes("&lt;img"));
  ui.section = "templates"; ui.missingOnly = true;
  html = api.renderRusender(); assert.match(html, /Программа без шаблона/); assert.ok(!html.includes('data-rs-program="p1"'));
  assert.match(html, /★ Рекомендуется/);
  assert.match(html, /Сходство: 92\/100/);
  assert.match(html, /value="200" class="rusender-template-recommended" selected/);
  const recommendedRow = api.renderRusenderProgramRow(ui.data.programs.find(item => item.id === "p3"), "");
  assert.ok(recommendedRow.indexOf('value="200"') < recommendedRow.indexOf('value="201"'));
  ui.data.bindings.push({ programId: "p3", templateIds: [] });
  assert.equal(api.rusenderTemplateChoice("p3").selected.length, 0); // Explicit manual unlink is preserved.
  ui.data.bindings.at(-1).templateIds = [201];
  assert.deepEqual(JSON.parse(JSON.stringify(api.rusenderTemplateChoice("p3").selected)), [201]);
  ui.data.bindings.pop();
  ui.data.recommendations[1].ambiguous = true;
  assert.equal(api.rusenderTemplateChoice("p3").selected.length, 0);
  assert.match(api.renderRusender(), /Несколько шаблонов подходят/);
  ui.data.recommendations[1].ambiguous = false;
  ui.data.recommendations[1].reasons = ['<img src=x onerror=alert(1)>'];
  assert.ok(!api.renderRusender().includes('<img src=x'));
  ui.data = structuredClone(data);
  const requests = [];
  context.authRequest = async (url, options) => { requests.push({ url, options }); return structuredClone(data); };
  ui.data.templateContext.pendingTemplateIds = [100, 200];
  await api.loadRusenderTemplateContext();
  assert.ok(requests.some(item => item.url.endsWith('/template-context')));
  assert.ok(!requests.some(item => /\/plans|\/binding/.test(item.url))); // Recommendations never launch or bind campaigns.
  ui.cancelRequested = true; ui.data.templateContext.pendingTemplateIds = [100];
  await assert.rejects(api.loadRusenderTemplateContext(), /Подбор прерван/);
  ui.cancelRequested = false; ui.data = structuredClone(data);
  api.startRusenderPlan("p1"); html = api.renderRusender(); assert.match(html, /Сохранить план без запуска/); assert.match(html, /Москва, UTC\+3/);
  assert.deepEqual(JSON.parse(JSON.stringify(ui.form.listIds)), []); assert.ok(!html.includes('value="2" selected')); // Recipients never preselected.
  assert.match(api.rusenderUuid(), /^[a-f0-9-]{36}$/);
  context.crypto = { getRandomValues: bytes => crypto.webcrypto.getRandomValues(bytes) };
  assert.match(api.rusenderUuid(), /^[a-f0-9-]{36}$/); // LAN HTTP without randomUUID.
  await api.rusenderRun("Ошибка", async () => { throw Error("Сеть недоступна"); });
  assert.equal(ui.busy, false); assert.equal(ui.error, "Сеть недоступна");
  assert.match(api.renderRusender(), /Сеть недоступна/);
  assert.match(source, /rusenderUi\.busy \|\| rusenderUi\.form \|\| rusenderUi\.preview/);
  assert.match(source, /sort\(\(a, b\) => Number\(b.id === "mailings"\) - Number\(a.id === "mailings"\)\)/);
  // Execute the actual handler with the CGI response surface (no setHeader).
  const server = fs.readFileSync(path.join(__dirname, "../app-server.js"), "utf8");
  const start = server.indexOf('  if (requestUrl.pathname === "/api/advertising/rusender"');
  const handler = server.slice(start, server.indexOf("  const adminOnlyRequest =", start));
  const routeContext = vm.createContext({ req: { method: "GET" }, requestUrl: new URL("https://example.invalid/api/advertising/rusender"), authUser: { role: "admin" }, rusenderService: { snapshot: async () => data }, res: { writeHead(status) { this.status = status; }, end(body) { this.body = body; } }, sendJson(res, status, value) { res.writeHead(status); res.end(JSON.stringify(value)); }, sendError(res, status, error) { res.writeHead(status); res.end(error); } });
  await vm.runInContext(`(async()=>{${handler}})()`, routeContext);
  assert.equal(routeContext.res.status, 200);
  routeContext.authUser.role = "manager";
  await vm.runInContext(`(async()=>{${handler}})()`, routeContext); assert.equal(routeContext.res.status, 403);
  routeContext.req.method = "POST"; routeContext.requestUrl = new URL("https://example.invalid/api/advertising/rusender/template-context");
  await vm.runInContext(`(async()=>{${handler}})()`, routeContext); assert.equal(routeContext.res.status, 403);
  routeContext.authUser.role = "admin"; routeContext.readJsonBody = async () => ({ templateIds: [100] });
  routeContext.rusenderService.templateContext = async body => ({ ok: true, checked: body.templateIds.length });
  await vm.runInContext(`(async()=>{${handler}})()`, routeContext); assert.equal(routeContext.res.status, 200);
  console.log("PASS Rusender UI: real render helpers, escaping, CTR denominator, missing-program filter, explicit recipients, Moscow time, LAN UUID, error cleanup, updater readiness, first tab and CGI/role guards.");
})().catch(error => { console.error(error.stack); process.exitCode = 1; });

if (process.argv.includes("--preview")) {
  const http = require("node:http");
  const body = `<html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/styles.css"><body><main id="test" style="padding:20px"></main><script>${helpers}\n${block}\nconst state={view:'advertising',advertising:{tab:'mailings'}};function isAdminUser(){return true;}async function authRequest(){return ${JSON.stringify(data)};}function render(){document.querySelector('#test').innerHTML=renderRusender();bindRusenderEvents();}rusenderUi.data=${JSON.stringify(data)};rusenderUi.loaded=true;render();</script></body></html>`;
  http.createServer((req, res) => { res.setHeader("Content-Type", req.url === "/styles.css" ? "text/css; charset=utf-8" : "text/html; charset=utf-8"); res.end(req.url === "/styles.css" ? fs.readFileSync(path.join(__dirname, "../styles.css")) : body); }).listen(8876, "127.0.0.1", () => console.log("UI fixture: http://127.0.0.1:8876 (no real API or recipients)"));
}

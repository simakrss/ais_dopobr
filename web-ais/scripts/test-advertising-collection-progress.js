const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n?/gu, "\n");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const functions = new Map([...source.matchAll(
  /^  (?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{[\s\S]*?^  \}/gmu
)].map((match) => [match[1], match[0]]));
const testedFunctions = [
  "formatAdvertisingDuration", "getAdvertisingCollectionElapsed",
  "renderAdvertisingCollectionProgress", "updateAdvertisingCollectionElapsed", "collectAdvertisingEmails"
].map((name) => {
  assert.ok(functions.has(name), name);
  return functions.get(name);
}).join("\n");

function createHarness(result = null) {
  let now = 100000;
  let resolveResponse;
  let rejectResponse;
  const response = new Promise((resolve, reject) => { resolveResponse = resolve; rejectResponse = reject; });
  const timers = new Map();
  let timerId = 0;
  const elapsed = { textContent: "" };
  const context = {
    state: {
      view: "advertising", tablePages: {},
      advertising: {
        loading: false, resultLoading: false, collectionStartedAt: 0,
        selectedSourceIds: ["test"], result, exclusions: {}, history: {}, filters: {}
      }
    },
    Date: { now: () => now },
    isAdminUser: () => true,
    escapeHtml: (value) => String(value),
    formatStatisticsInteger: (value) => String(value),
    photoApiUrl: (value) => value,
    fetchCalls: 0,
    fetch: () => { context.fetchCalls++; return response; },
    setInterval: (fn, delay) => { assert.equal(delay, 1000); timers.set(++timerId, fn); return timerId; },
    clearInterval: (id) => timers.delete(id),
    document: { querySelector: (selector) => selector === "[data-advertising-collection-elapsed]" ? elapsed : null },
    renderCount: 0, html: "",
    render: () => { context.renderCount++; context.html = context.renderAdvertisingCollectionProgress(); },
    persistAdvertisingEmailViewCache: () => Promise.resolve(),
    historyReloads: 0,
    loadAdvertisingEmailHistory: () => context.historyReloads++,
    queueMicrotask: (fn) => fn(), requestAnimationFrame: (fn) => fn()
  };
  vm.createContext(context);
  vm.runInContext(testedFunctions, context);
  return {
    context, timers, elapsed,
    advance(ms) { now += ms; for (const tick of timers.values()) tick(); },
    succeed(payload = { summary: { newUnique: 2, newReady: 1 }, sources: [] }) {
      resolveResponse({ ok: true, json: async () => payload });
    },
    fail(message, status = 500) {
      resolveResponse({ ok: false, status, json: async () => ({ error: message }) });
    },
    reject: rejectResponse
  };
}

async function test() {
  assert.match(source, /collectionStartedAt: 0/u);
  assert.match(functions.get("renderAdvertising"), /\$\{renderAdvertisingCollectionProgress\(\)\}\s*\$\{advertising\.error/u);
  assert.match(styles, /animation: advertising-collection-progress 1\.6s ease-in-out infinite/u);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.advertising-collection-progress-track > span\s*\{\s*animation: none/u);
  assert.match(styles, /\.advertising-heading-actions \.auth-spinner\s*\{\s*display: inline-block/u);

  for (const previous of [null, { rows: [{ email: "saved@example.test" }] }]) {
    const h = createHarness(previous);
    const c = h.context;
    assert.equal(c.renderAdvertisingCollectionProgress(), "");
    const pending = c.collectAdvertisingEmails();
    assert.equal(c.state.advertising.loading, true);
    assert.equal(c.state.advertising.result, previous, "Saved results remain available during collection");
    assert.match(c.html, /role="progressbar"/u);
    assert.doesNotMatch(c.html, /aria-valuenow/u, "Do not invent progress percentages");
    assert.match(c.html, /Прошло:.*0 сек\./u);
    assert.equal(h.timers.size, 1);
    await c.collectAdvertisingEmails();
    assert.equal(c.fetchCalls, 1, "A second click must not create a second request or timer");
    h.advance(65000);
    assert.equal(h.elapsed.textContent, "1 мин. 05 сек.");
    assert.equal(c.renderCount, 1, "Timer must not rerender the table or disturb focus");
    c.state.view = "programs";
    h.advance(1000);
    assert.equal(h.elapsed.textContent, "1 мин. 05 сек.");
    c.state.view = "advertising";
    assert.match(c.renderAdvertisingCollectionProgress(), /1 мин\. 06 сек\./u);
    h.succeed();
    await pending;
    assert.equal(c.state.advertising.loading, false);
    assert.equal(c.state.advertising.collectionStartedAt, 0);
    assert.equal(c.html, "");
    assert.equal(h.timers.size, 0);
    assert.equal(c.historyReloads, 1);
    assert.equal(c.state.advertising.filters.status, "new");
    h.advance(100000);
    const repeated = c.collectAdvertisingEmails();
    assert.match(c.html, /Прошло:.*0 сек\./u, "Elapsed time resets for each run");
    assert.equal(h.timers.size, 1);
    await repeated;
    assert.equal(h.timers.size, 0);
  }

  for (const failure of ["server", "network"]) {
    const previous = { rows: [{ email: "saved@example.test" }] };
    const h = createHarness(previous);
    const pending = h.context.collectAdvertisingEmails();
    h.advance(2000);
    if (failure === "server") h.fail("Источник недоступен");
    else h.reject(new Error("Сеть недоступна"));
    await pending;
    assert.equal(h.timers.size, 0);
    assert.equal(h.context.html, "");
    assert.equal(h.context.state.advertising.collectionStartedAt, 0);
    assert.equal(h.context.state.advertising.result, previous);
    assert.ok(h.context.state.advertising.error);
    assert.equal(h.context.historyReloads, 0);
  }
  const elsewhere = createHarness();
  const pending = elsewhere.context.collectAdvertisingEmails();
  elsewhere.context.state.view = "programs";
  elsewhere.succeed();
  await pending;
  assert.equal(elsewhere.timers.size, 0, "Timer is stopped even after leaving the collector");
  assert.equal(elsewhere.context.renderCount, 1);
  for (const blocked of ["no-sources", "loading-results"]) {
    const h = createHarness();
    if (blocked === "no-sources") h.context.state.advertising.selectedSourceIds = [];
    else h.context.state.advertising.resultLoading = true;
    await h.context.collectAdvertisingEmails();
    assert.equal(h.context.fetchCalls, 0);
    assert.equal(h.timers.size, 0);
  }
  console.log("Advertising collection progress: lifecycle, cached results, timer, errors, retries and accessibility passed.");
}

// Isolated browser fixture: real production progress/collection functions, no external requests.
function serveFixture() {
  const http = require("node:http");
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css">
    <title>Проверка индикатора сбора адресов</title>
    <body><main style="max-width:1000px;margin:24px auto;padding:12px">
    <section class="panel advertising-controls-panel"><div class="advertising-heading"><div>
    <p class="eyebrow">Проверка интерфейса</p><h2>Сборщик email</h2><p>Изолированный тест — источники не опрашиваются.</p></div>
    <div class="advertising-heading-actions" id="collectActions"></div></div><div id="progress"></div>
    <p id="message" role="status"></p></section>
    <section class="panel advertising-results-panel"><h2>Результаты предыдущего поиска</h2><p>saved@example.test</p></section>
    <p><button id="finish" type="button">Завершить тест успешно</button> <button id="fail" type="button">Завершить тест с ошибкой</button></p>
    </main><script>
      const state = {view:"advertising",tablePages:{},advertising:{loading:false,resultLoading:false,collectionStartedAt:0,
        selectedSourceIds:["test"],result:{rows:[{email:"saved@example.test"}]},exclusions:{},history:{},filters:{}}};
      const escapeHtml = value => String(value).replace(/&/g,"&amp;").replace(/</g,"&lt;");
      const isAdminUser = () => true;
      const formatStatisticsInteger = String;
      const photoApiUrl = value => value;
      const persistAdvertisingEmailViewCache = async () => {};
      const loadAdvertisingEmailHistory = () => {};
      let finish;
      const fetch = () => new Promise(resolve => {finish = resolve;});
      ${testedFunctions}
      function render() {
        document.getElementById("progress").innerHTML = renderAdvertisingCollectionProgress();
        document.getElementById("collectActions").innerHTML = '<button class="primary-button" id="collect" type="button" '+(state.advertising.loading?'disabled':'')+'>'+(state.advertising.loading?'<span class="auth-spinner" aria-hidden="true"></span> Сбор адресов…':'Собрать адреса')+'</button>';
        document.getElementById("collect").addEventListener("click", collectAdvertisingEmails);
        document.getElementById("message").textContent = state.advertising.error || state.advertising.notice || "";
      }
      document.getElementById("finish").addEventListener("click", () => finish?.({ok:true,json:async()=>({summary:{newUnique:0,newReady:0},sources:[]})}));
      document.getElementById("fail").addEventListener("click", () => finish?.({ok:false,status:500,json:async()=>({error:"Тестовая ошибка источника"})}));
      render();
    </script></body></html>`;
  http.createServer((req, res) => {
    if (req.url === "/styles.css") {
      res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" }); res.end(styles);
    } else if (req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(html);
    } else { res.writeHead(404); res.end(); }
  }).listen(0, "127.0.0.1", function () {
    console.log(`Progress fixture: http://127.0.0.1:${this.address().port}/`);
  });
}

if (process.argv.includes("--serve")) serveFixture();
else test().catch((error) => { console.error(error); process.exitCode = 1; });

"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {createProgressStore} = require("../program-site-progress");
const pg = require("../program-site-generator");
const id = "11111111-2222-4333-8444-555555555555", id2 = "21111111-2222-4333-8444-555555555555";
async function main() {
  let now = 0;
  const store = createProgressStore({now: () => now, ttlMs: 10000, limit: 1});
  assert.throws(() => store.start("admin", "bad"), /идентификатор/);
  assert.throws(() => store.start("", id), /авторизация/);
  const job = store.start("admin", id);
  assert.deepEqual(store.read("other", id), {status: "waiting"}, "Other user's work is private");
  assert.throws(() => store.start("admin", id), /уже/);
  assert.throws(() => store.start("admin", id2), /много/);
  now = 5000; job.report("Создание товара");
  assert.deepEqual(store.read("admin", id), {status: "running", label: "Создание товара", elapsedMs: 5000});
  job.finish("failed"); job.report("must not overwrite failure");
  assert.equal(store.read("admin", id).label, "Создание товара");
  assert.equal(store.read("admin", id).status, "failed");
  now = 15001; assert.deepEqual(store.read("admin", id), {status: "waiting"});
  store.start("admin", id2).finish("completed"); assert.equal(store.read("admin", id2).status, "completed");

  const phases = [], program = {id: "test", type: "ДОП", name: "Тест", price: 0, hours: 2, landingCode: "test-program"};
  const template = {title: "Прототип", postType: "other-course", fields: {ssylka_na_registraciyu: "https://zifra-plus.ru/checkout/?add-to-cart=12", izobrazhenie_vydavaemogo_dokumenta: 1,
    prevyu_vydavaemogo_dokumenta_1: 1, izobrazhenie_vydavaemogo_dokumenta_2: 2, prevyu_vydavaemogo_dokumenta_2: 2}};
  const images = [{id: 1, language: "ru"}, {id: 2, language: "en"}];
  const certificate = {hash: "a".repeat(64), generate: async report => { report("Изображения страниц"); return images; }};
  const call = async (site, endpoint) => {
    if (endpoint.startsWith("/template")) return template;
    if (endpoint === "/certificate-assets") {assert.match(phases.at(-1), /Загрузка образцов/); return {images};}
    if (endpoint === "/prepare-product") assert.match(phases.at(-1), /zifra-plus/);
    if (endpoint === "/prepare-landing") assert.match(phases.at(-1), /Создание лендинга/);
    return {id: 42, status: "draft"};
  };
  const prepared = await pg.prepare(program, 42, call, certificate, label => phases.push(label));
  assert.ok(phases.includes("Изображения страниц"));
  await pg.publish(program, 42, prepared.hash, async (site, endpoint) => {
    if (endpoint.startsWith("/template")) return template;
    if (endpoint === "/publish") assert.match(phases.at(-1), site === "shop" ? /Публикация товара/ : /Публикация лендинга/);
    return {id: 42, status: "publish", redirectEnabled: true};
  }, certificate, label => phases.push(label));
  await assert.rejects(pg.prepare(program, 42, async (site, endpoint) => {
    if (endpoint === "/prepare-product") throw new Error("Store error");
    return call(site, endpoint);
  }, certificate, label => phases.push(label)), /Store error/);
  assert.match(phases.at(-1), /zifra-plus/, "Failure retains its exact last stage");

  const app = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
  const source = app.slice(app.indexOf("  function createProgramSiteProgress("), app.indexOf("  async function ensureProgramSiteLandingCode("));
  const label = {}, elapsed = {}, bar = {}, box = {isConnected: true, dataset: {}, scrollIntoView(options) {assert.equal(options.block, 'nearest');}, querySelector: s => s === "progress" ? bar : s.includes("-label") ? label : elapsed};
  let timerId = 0; const timers = new Map(); let responseLabel = "Этап сервера";
  const context = {Date, encodeURIComponent, AbortSignal, photoApiUrl: s => s,
    setInterval: callback => {timers.set(++timerId, callback); return timerId;}, clearInterval: id => timers.delete(id),
    fetch: async () => ({ok: true, json: async () => ({label: responseLabel})})};
  vm.createContext(context); vm.runInContext(source, context);
  const ui = context.createProgramSiteProgress({querySelector: () => box});
  ui.start("Начало"); ui.watch(id); await new Promise(resolve => setImmediate(resolve));
  assert.equal(label.textContent, responseLabel); assert.equal(box.hidden, false); assert.equal(bar.hidden, false);
  ui.stop(true); assert.equal(timers.size, 0); assert.equal(bar.hidden, true); assert.match(label.textContent, /Остановлено: Этап сервера/);
  ui.start("Повтор"); ui.watch(id2); ui.local("Сохранение результата"); await new Promise(resolve => setImmediate(resolve));
  assert.equal(label.textContent, "Сохранение результата", "Stale poll cannot overwrite local save phase");
  ui.stop(); assert.equal(label.textContent, "Выполнено"); ui.dispose(); assert.equal(timers.size, 0);
  const gateway = fs.readFileSync(path.join(__dirname, "../gateway.php"), "utf8");
  assert.match(gateway, /\$method === 'GET' && \$path === '\/api\/program-sites\/progress'\) return true/);
  console.log("PASS: scoped/limited progress, expiry, retries, real stage ordering, failed-stage retention, UI timers/cleanup, stale polls and tunnel routing");
}
main().catch(error => {console.error(error); process.exitCode = 1;});

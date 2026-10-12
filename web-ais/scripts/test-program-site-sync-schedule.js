"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const pg = require("../program-site-generator");
const app = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
async function main() {
  const calls = [];
  const context = {AbortSignal, photoApiUrl: value => value, fetch: async (url, options) => {
    calls.push({url, ...options}); return {ok: true, json: async () => ({ok: true})};
  }};
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf("  async function programSiteRequest("), app.indexOf("  function getProgramLandingPreviewUrl(")), context);
  for (const action of ["templates", "health", "preview-sync", "sync", "prepare", "publish", "resolve"]) {
    await context.programSiteRequest(action, {programId: "test"});
    const request = calls.at(-1), reading = ["templates", "health"].includes(action);
    assert.equal(request.method, reading ? "GET" : "POST");
    assert.equal(request.body, reading ? undefined : '{"programId":"test"}');
    assert.equal(request.headers?.["Content-Type"], reading ? undefined : "application/json");
  }
  const program = {id:"test", type:"ПРО", name:"Вебинар", hours:2, price:500, landingCode:"42", webinarDate:"2026-10-25", webinarTime:"19:30"};
  const model = pg.normalizeSyncProgram(program);
  assert.equal(model.date, "2026-10-25"); assert.equal(model.time, "19:30");
  assert.equal(pg.normalizeSyncProgram({...program, type:"КПК"}).date, undefined);
  assert.equal(pg.normalizeSyncProgram({...program, webinarDate:"", webinarTime:""}).date, undefined);
  for (const patch of [{webinarDate:"2026-02-30"}, {webinarDate:""}, {webinarTime:""}, {webinarTime:"24:00"}, {webinarTime:"19:30extra"}]) {
    assert.throws(() => pg.normalizeSyncProgram({...program, ...patch}), /дату и время/);
  }
  const writes = [];
  const call = async (site, endpoint, body) => {
    if (endpoint === "/resolve-site") return {id:42,url:"https://edu-plus.ru/other-course/test/",version:"v1",offers:[{productId:12}]};
    if (endpoint === "/sync-product/12") return {id:12,version:"v1",url:"https://zifra-plus.ru/product/test/"};
    if (endpoint === "/check-sync") return {ok:true};
    if (endpoint === "/sync-existing") { writes.push({site, body}); return {id:site === "edu" ? 42 : 12}; }
    assert.fail(endpoint);
  };
  const plan = await pg.previewSync(program, call, 12);
  const phases = [];
  await pg.synchronize(program, call, 12, plan.hash, 0, phase => phases.push(phase));
  assert.equal(phases.length, 5); assert.match(phases[3], /zifra-plus/); assert.match(phases[4], /edu-plus/);
  assert.equal(writes.length, 2);
  for (const {body} of writes) { assert.equal(body.model.date, model.date); assert.equal(body.model.time, model.time); }
  writes.length = 0;
  for (const patch of [{webinarDate:"2026-10-26"}, {webinarTime:"20:00"}]) await assert.rejects(pg.synchronize({...program,...patch}, call, 12, plan.hash), /изменились/);
  assert.equal(writes.length, 0, "Stale schedule never writes to either site");
  const ui = app.slice(app.indexOf("  async function openProgramSiteSync("), app.indexOf("  function renderProgramGeneratorFields("));
  assert.ok(ui.indexOf("dialog.showModal()") < ui.indexOf("await saveRecordFormBeforeContinuation"), "Progress dialog opens before shared save");
  assert.match(ui, /data-sync-date type="date"/); assert.match(ui, /data-sync-time type="time"/);
  assert.match(ui, /catalogProgress\.start/); assert.match(ui, /progress\.local\("Сохранение результатов/);
  assert.match(ui, /progress\.dispose\(\); catalogProgress\.dispose\(\)/);
  assert.match(ui, /data-sync-catalog-retry/);
  console.log("PASS: GET catalog/health, guarded POST writes, schedule validation/payload/hash, progress before save and retry/disposal");
}
main().catch(error => { console.error(error); process.exitCode = 1; });

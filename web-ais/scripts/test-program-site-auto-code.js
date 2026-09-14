"use strict";
// No real database or site writes: model, signed-client contract and UI save ordering.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const pg = require("../program-site-generator");
const app = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const program = {id: "qa-auto-code", type: "КПК", name: "Основы цифровой грамотности", hours: 72, price: 0};
async function main() {
  assert.equal(pg.landingCodeFromName(program.name), "osnovy-tsifrovoy-gramotnosti");
  assert.equal(pg.landingCodeFromName("Ёж, Йога и Щётка!"), "yozh-yoga-i-schyotka");
  for (const name of ["А", "", "✨!!!", "Программа ".repeat(40), "Café / SQL & C++", "__slug__", "Щ".repeat(100)]) {
    const slug = pg.landingCodeFromName(name);
    assert.match(slug, /^[a-z0-9][a-z0-9_-]{1,79}$/);
    assert.ok(slug.length <= 80);
  }
  for (const type of Object.keys(pg.PROGRAM_TYPES)) {
    const saved = {...program, type, webinarDate: "2026-09-20", webinarTime: "09:00", webinarJoinUrl: "https://jazz.sber.ru/test"};
    const calls = [];
    const call = async (site, endpoint, data) => {
      calls.push({site, endpoint, data});
      assert.equal(site, "edu"); assert.equal(endpoint, "/landing-code");
      assert.equal(data.postType, pg.PROGRAM_TYPES[type].postType);
      assert.match(data.key, /^[a-f0-9]{64}$/);
      return {slug: data.slug};
    };
    const first = await pg.suggestLandingCode(saved, call);
    const retry = await pg.suggestLandingCode({...saved, name: "Изменённое название", landingCode: first.landingCode}, call);
    assert.equal(first.landingCode, retry.landingCode, "Persisted code survives renaming and retries");
    assert.equal(calls[0].data.key, calls[1].data.key);
    assert.equal(saved.landingCode, undefined, "Read-only suggestion must not mutate shared data");
    assert.equal((await pg.suggestLandingCode({...saved, landingCode: "manual_code-12"}, call)).landingCode, "manual_code-12");
    assert.equal((await pg.suggestLandingCode({...saved, landingCode: "Недопустимый код"}, call)).landingCode, first.landingCode);
    await pg.suggestLandingCode({...saved, id: "other-program"}, call);
    assert.notEqual(calls.at(-1).data.key, calls[0].data.key, "Distinct programs have distinct stable collision suffixes");
  }
  assert.equal((await pg.suggestLandingCode(program, async () => ({slug: "existing-owned-draft"}))).landingCode, "existing-owned-draft", "Recover the existing draft address");
  await assert.rejects(pg.suggestLandingCode(program, async () => ({slug: "../bad"})), /не подтвердил/);
  await assert.rejects(pg.suggestLandingCode(program, async () => {throw new Error("offline");}), /offline/);
  await assert.rejects(pg.suggestLandingCode({...program, id: ""}, () => assert.fail("No requests before validation")), /сохраните/);
  await assert.rejects(pg.suggestLandingCode({...program, hours: 0}, () => assert.fail("No requests before validation")), /количество часов/);

  const source = app.slice(app.indexOf("  async function ensureProgramSiteLandingCode("), app.indexOf("  function getDefaultProgramSiteTemplateId("));
  const events = [], input = {value: "", dispatchEvent: event => events.push(event.type)};
  const card = {elements: {landingCode: input}, isConnected: true};
  let saveOk = true, changed = false, connected = true;
  const context = {
    Event: class {constructor(type) {this.type = type;}},
    programSiteRequest: async (action, body) => {
      assert.equal(action, "landing-code"); assert.equal(body.programId, program.id);
      events.push("lookup");
      if (changed) input.value = "user-edited-code";
      card.isConnected = connected;
      return {landingCode: "generated-code"};
    },
    saveRecordFormBeforeContinuation: async (form, options) => {
      assert.equal(form, card); assert.equal(options.flush, true);
      assert.equal(input.value, "generated-code"); events.push("save-and-flush");
      return saveOk ? program.id : "";
    }
  };
  vm.createContext(context); vm.runInContext(source, context);
  assert.equal(await context.ensureProgramSiteLandingCode(card, program.id), "generated-code");
  assert.deepEqual(events, ["lookup", "input", "save-and-flush"]);
  saveOk = false;
  await assert.rejects(context.ensureProgramSiteLandingCode(card, program.id), /Черновики не создавались/);
  changed = true;
  await assert.rejects(context.ensureProgramSiteLandingCode(card, program.id), /изменились/);
  changed = false; connected = false;
  await assert.rejects(context.ensureProgramSiteLandingCode(card, program.id), /изменились/);
  const handler = app.slice(app.indexOf('    prepareButton.addEventListener("click"'), app.indexOf('    const close = () =>', app.indexOf('    prepareButton.addEventListener("click"')));
  assert.ok(handler.indexOf("await saveParameters()") < handler.indexOf("await ensureProgramSiteLandingCode("));
  assert.ok(handler.indexOf("await ensureProgramSiteLandingCode(") < handler.indexOf("setBusy(true)"), "Save while form-associated controls remain enabled");
  assert.ok(handler.indexOf("await ensureProgramSiteLandingCode(") < handler.indexOf('await request("prepare"'), "Persist code before external writes");
  console.log("PASS: automatic transliteration/limits, all program types, stable codes/identity, read-only lookup, draft recovery, invalid/offline refusal, save-before-prepare and concurrent edits");
}
main().catch(error => {console.error(error); process.exitCode = 1;});

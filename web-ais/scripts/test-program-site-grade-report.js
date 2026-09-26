"use strict";
// Execute the actual generator result-save handler without a database or website writes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const app = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const start = app.indexOf("    const storeResult = async (value) => {");
const end = app.indexOf("    const samplesReady =", start);
assert.ok(start > 0 && end > start);
const oldUrl = "https://portal.edu-plus.ru/grade/report/index.php?id=123";
const jazzUrl = "https://salutejazz.ru/calls/meeting?psw=AbCd_123&name=%D0%90#join";
function fixture(type = "ПРО", options = {}) {
  const events = [], persisted = [], flushed = [];
  const program = {id: "test", type, gradeReportUrl: oldUrl, webinarJoinUrl: "https://salutejazz.ru/calls/edited-after-request"};
  const input = {value: oldUrl, dispatchEvent: event => events.push(event)};
  const baseline = [{name: "gradeReportUrl", value: oldUrl}, {name: "name", value: "Сохранённое название"}];
  const card = {elements: options.noControl ? {} : {gradeReportUrl: input}, dataset: {initialSnapshot: JSON.stringify(baseline)}};
  const context = {
    Event, card, programId: program.id,
    state: {data: {collections: {programs: options.deleted ? [] : [program]}}},
    persist: () => persisted.push(structuredClone(program)),
    flushSharedApplicationState: async () => {
      options.duringFlush?.(input);
      if (options.failFlush) return false;
      flushed.push(structuredClone(program)); return true;
    }
  };
  vm.createContext(context);
  vm.runInContext(app.slice(start, end) + "\nglobalThis.store = storeResult;", context);
  return {program, input, card, baseline, events, persisted, flushed, store: context.store};
}
const result = (stage = "prepared", type = "ПРО") => ({ok: true, stage, type, gradeReportUrl: jazzUrl});
async function main() {
  for (const stage of ["prepared", "published"]) {
    const f = fixture();
    await f.store(result(stage));
    assert.equal(f.program.gradeReportUrl, jazzUrl);
    assert.equal(f.input.value, jazzUrl, "Hidden main-tab input must not later overwrite the new URL");
    assert.equal(f.flushed[0].gradeReportUrl, jazzUrl, "Result and link are saved in the same shared-state flush");
    assert.equal(f.persisted[0].sitePublication.stage, stage);
    assert.equal(f.events.length, 1);
    assert.equal(f.events[0].type, "input"); assert.equal(f.events[0].bubbles, true);
    assert.deepEqual(JSON.parse(f.card.dataset.initialSnapshot), [{name: "gradeReportUrl", value: jazzUrl}, f.baseline[1]], "Only the saved link baseline is updated");
    await f.store(result(stage));
    assert.equal(f.events.length, 1, "Retry is idempotent and does not disturb the field cursor");
    assert.equal(f.program.webinarJoinUrl, "https://salutejazz.ru/calls/edited-after-request", "Other program parameters are not overwritten");
  }
  for (const type of ["ДОП", "КПК", "ППП"]) {
    const f = fixture(type);
    await f.store(result("prepared", type));
    await f.store(result("published", "ПРО"));
    assert.equal(f.program.gradeReportUrl, oldUrl, type + ": preserve grade report even with a stale PRO result");
    assert.equal(f.input.value, oldUrl); assert.equal(f.events.length, 0);
  }
  for (const patch of [{ok: false}, {stage: "failed"}, {type: "КПК"}, {gradeReportUrl: ""}, {gradeReportUrl: undefined}, {gradeReportUrl: "javascript:alert(1)"}]) {
    const f = fixture(); await f.store({...result(), ...patch});
    assert.equal(f.program.gradeReportUrl, oldUrl, "Failed/legacy/non-PRO results never clear or replace the link");
  }
  const missingControl = fixture("ПРО", {noControl: true});
  await missingControl.store(result());
  assert.equal(missingControl.flushed[0].gradeReportUrl, jazzUrl, "Save also works when the main-tab control is absent");
  const failed = fixture("ПРО", {failFlush: true});
  await assert.rejects(failed.store(result()), /ещё не сохранены/);
  assert.equal(failed.flushed.length, 0);
  assert.deepEqual(JSON.parse(failed.card.dataset.initialSnapshot), failed.baseline, "Failed save is not marked clean");
  const edited = fixture("ПРО", {duringFlush: input => { input.value = "https://example.com/manual"; }});
  await edited.store(result());
  assert.equal(edited.input.value, "https://example.com/manual");
  assert.deepEqual(JSON.parse(edited.card.dataset.initialSnapshot), edited.baseline, "Edits made during saving remain unsaved");
  const deleted = fixture("ПРО", {deleted: true});
  await assert.rejects(deleted.store(result()), /удалена/);
  assert.equal(deleted.persisted.length, 0);
  console.log("PASS: PRO Jazz grade-report replacement, authoritative URL, hidden fields, shared persistence, retries, non-PRO preservation and failed-save safety");
}
main().catch(error => {console.error(error); process.exitCode = 1;});

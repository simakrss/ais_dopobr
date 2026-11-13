"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n/g, "\n");
function extract(name) {
  const start = new RegExp(`^  (?:async )?function ${name}\\(`, "m").exec(app);
  assert.ok(start, name);
  const rest = app.slice(start.index + start[0].length);
  const end = /^  }/m.exec(rest);
  assert.ok(end, name);
  return app.slice(start.index, start.index + start[0].length + end.index + 3);
}

async function testDialog() {
  let backdrop = null, restored = 0;
  const document = {
    activeElement: {isConnected: true, focus() { restored++; }},
    querySelector: () => backdrop?.isConnected ? backdrop : null,
    body: {appendChild(element) { element.isConnected = true; }},
    createElement() {
      const element = {dataset: {}, handlers: {}, isConnected: false,
        addEventListener(name, handler) { this.handlers[name] = handler; },
        remove() { this.isConnected = false; },
        contains(button) { return this.buttons.includes(button); },
        querySelector(selector) { return this.buttons.find(button => selector.includes(button.dataset.action)); },
        querySelectorAll() { return this.buttons; }
      };
      element.buttons = ["close", "cancel", "confirm"].map(action => ({
        dataset: {action: action + "-record-duplication"},
        closest() { return this; }, focus() { document.activeElement = this; }, isConnected: true
      }));
      backdrop = element;
      return element;
    }
  };
  const context = {document, queueMicrotask};
  vm.createContext(context);
  for (const name of ["escapeHtml", "confirmRecordDuplication"]) vm.runInContext(extract(name), context);
  for (const mode of ["cancel", "close", "escape", "outside", "confirm", "globalEscape"]) {
    const promise = context.confirmRecordDuplication({title: "Программа <тест>", message: '<script>alert("x")</script>'});
    await Promise.resolve();
    const dialog = backdrop;
    assert.equal(document.activeElement.dataset.action, "cancel-record-duplication", "Enter must initially cancel");
    assert.match(dialog.innerHTML, /class="modal unsaved-changes-dialog" role="alertdialog" aria-modal="true"/);
    assert.match(dialog.innerHTML, /class="primary-button"[^>]*>Дублировать</);
    assert.match(dialog.innerHTML, /&lt;script&gt;/);
    assert.doesNotMatch(dialog.innerHTML, /<script>|Подтверждение закрытия/);
    assert.equal(await context.confirmRecordDuplication(), false, "Repeated requests must not schedule another copy");
    assert.equal(backdrop, dialog);
    let prevented = false;
    dialog.buttons[2].focus();
    dialog.handlers.keydown({key: "Tab", preventDefault() { prevented = true; }});
    assert.ok(prevented);
    assert.equal(document.activeElement, dialog.buttons[0]);
    dialog.handlers.keydown({key: "Tab", shiftKey: true, preventDefault() {}});
    assert.equal(document.activeElement, dialog.buttons[2]);
    if (mode === "escape") dialog.handlers.keydown({key: "Escape", preventDefault() {}, stopPropagation() {}});
    else if (mode === "outside") dialog.handlers.click({target: dialog});
    else if (mode === "globalEscape") dialog.cancelRecordDuplicateConfirmation();
    else dialog.handlers.click({target: dialog.buttons.find(button => button.dataset.action.startsWith(mode))});
    assert.equal(await promise, mode === "confirm");
    assert.equal(dialog.isConnected, false);
  }
  assert.ok(restored >= 1);
  const escapeSource = extract("closeTopmostWindowByEscape");
  assert.ok(escapeSource.indexOf("cancelRecordDuplicateConfirmation") < escapeSource.indexOf("cancelUnsavedChangesDialog"));
}

async function testHandler(name, config, scenario = {}) {
  const events = [];
  const source = {id: "source", name: "Тестовая карточка", section: "Действующие"};
  const modal = {config, id: "source", hasDraftChanges: Boolean(scenario.dirty)};
  const state = {modal, data: {collections: {[config]: [source]}}};
  const form = {dataset: {config, id: "source"}};
  const context = {
    state, recordFormSavePending: false, activeRecordLock: {id: "lock"},
    document: {getElementById: () => form}, window: {requestAnimationFrame: () => {}},
    hasUnsavedFormChanges: () => Boolean(scenario.dirty),
    confirmRecordDuplication: async options => {
      events.push("confirm");
      assert.ok(options.message.includes(source.name));
      assert.ok(options.message.includes("после сохранения"));
      if (scenario.changedCard) state.modal = {config, id: "another"};
      return scenario.confirmed !== false;
    },
    chooseUnsavedChangesAction: async () => { events.push("unsaved"); return scenario.decision || "save"; },
    saveRecordFormBeforeContinuation: async () => { events.push("save"); return scenario.saveFails ? "" : "source"; },
    buildStudentDuplicateDraft: () => { events.push("copy"); return {}; },
    buildProgramDuplicateDraft: () => { events.push("copy"); return {name: "Копия"}; },
    getProgramTrainingPlanRows: () => ["plan"],
    buildProgramDuplicateTrainingPlanRows: rows => { assert.equal(rows[0], "plan"); return ["copied-plan"]; },
    buildEmployeeContractDuplicateDraft: () => { events.push("copy"); return {contractNo: "2"}; },
    CONTRACT_SECTIONS: ["Действующие", "Партнерская программа"],
    normalizeContractSection: value => value,
    stopRecordLockHeartbeat: () => events.push("stop-lock"),
    resetStudentCardTransientState: () => events.push("reset"),
    discardEmployeePaymentTransaction: () => events.push("discard-payment"),
    releaseRecordLock: async () => events.push("release-lock"),
    render: () => events.push("render"),
    alert: message => { throw new Error(message); }
  };
  vm.createContext(context);
  vm.runInContext(extract(name), context);
  const original = JSON.stringify(state.data);
  await context[name]();
  const cancelled = scenario.confirmed === false || scenario.changedCard || scenario.decision === "cancel" || scenario.saveFails;
  assert.equal(events.includes("copy"), !cancelled, name + " copy result");
  assert.equal(JSON.stringify(state.data), original, "New cards are drafts; confirmation must not persist them");
  if (cancelled) {
    assert.ok(!events.includes("render") && !events.includes("release-lock"));
    if (!scenario.changedCard) assert.equal(state.modal, modal);
  } else {
    assert.equal(state.modal.id, "");
    assert.equal(state.modal.duplicateSourceId, "source");
    assert.ok(events.indexOf("confirm") < events.indexOf("copy"));
    if (config === "programs") assert.equal(state.modal.duplicateTrainingPlanRows[0], "copied-plan");
  }
  if (scenario.confirmed === false) assert.deepEqual(events, ["confirm"], "Cancel must not save or discard current edits");
  if (events.includes("unsaved")) assert.ok(events.indexOf("confirm") < events.indexOf("unsaved"));
}

async function main() {
  await testDialog();
  for (const [name, config] of [
    ["copyStudentForNewEnrollment", "students"], ["copyProgramWithTrainingPlan", "programs"],
    ["copyEmployeeForNewContract", "contracts"]
  ]) {
    for (const scenario of [{}, {confirmed: false}, {confirmed: false, dirty: true}, {dirty: true},
      {dirty: true, decision: "discard"}, {dirty: true, decision: "cancel"}, {dirty: true, saveFails: true}, {changedCard: true}]) {
      await testHandler(name, config, scenario);
    }
  }
  console.log("Record duplication confirmation: three card types, confirm/cancel/close/Escape, focus trap, repeated clicks, unchanged dirty drafts and stale-card guard: OK");
}

main().then(() => {
  if (!process.argv.includes("--serve")) return;
  const http = require("node:http");
  const server = http.createServer((req, res) => {
    if (req.url === "/styles.css") {
      res.setHeader("Content-Type", "text/css; charset=utf-8");
      res.end(fs.readFileSync(path.join(root, "styles.css"))); return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Проверка подтверждения дублирования</title>
      <link rel="stylesheet" href="/styles.css"><main style="padding:24px"><h1>Тестовая карточка программы</h1>
      <label>Название <input id="name" value="Программа с несохранёнными изменениями"></label>
      <button class="ghost-button" id="duplicate">Дублировать программу</button><output id="result" role="status">Копии не созданы</output></main>
      <script>${extract("escapeHtml")}\n${extract("confirmRecordDuplication")}
      document.getElementById('duplicate').addEventListener('click', async () => {
        const confirmed = await confirmRecordDuplication({title:'Дублировать образовательную программу?', message:'Создать копию программы вместе с учебным планом? Код лендинга сохранится. Новая программа попадёт в базу только после сохранения.'});
        document.getElementById('result').textContent = confirmed ? 'Дублирование подтверждено' : 'Отменено, копии не созданы';
      });</script></html>`);
  });
  server.listen(0, "127.0.0.1", () => console.log(`Fixture: http://127.0.0.1:${server.address().port}/`));
}).catch(error => { console.error(error); process.exitCode = 1; });

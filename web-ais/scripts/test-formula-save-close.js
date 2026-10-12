"use strict";
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { extract } = require("./test-card-field-formulas");

function scenario({ kind = "message", confirmed = true, failure = false, validation = "", delayed = false, config = "students" } = {}) {
  let stored = "Исходная формула", allow = true, resolveSave;
  const calls = { refresh: 0, persist: 0, focus: 0, prompts: 0, flush: 0 };
  const editor = { value: stored, focus() {} };
  const button = { disabled: false };
  const status = { textContent: "" };
  const form = {
    dataset: {}, events: {},
    querySelector(selector) { return selector === "[type='submit']" ? button : selector.includes("reset-data-formulas") ? null : editor; },
    querySelectorAll() { return []; },
    addEventListener(type, handler) { this.events[type] = handler; },
    requestSubmit() { return this.events.submit({ preventDefault() {}, stopPropagation() {} }); }
  };
  const dialog = {
    dataset: {}, isConnected: false,
    querySelector(selector) { return selector === "form" ? form : status; },
    querySelectorAll() { return []; },
    addEventListener() {}, remove() { this.isConnected = false; }
  };
  const card = { dataset: { config }, draft: "Ручные правки", refreshWebinarFormulaField() { calls.refresh++; } };
  const control = { isConnected: true, closest() { return card; }, focus() { calls.focus++; } };
  const binding = { kind, field: "note1", key: "contract", label: "Формула" };
  const context = {
    document: { querySelector() { return dialog.isConnected ? dialog : null; }, createElement() { return dialog; }, body: { appendChild() { dialog.isConnected = true; } } },
    state: { modal: { autoFormulaFields: [] }, data: { dictionaries: { dataFormulas: [] } } },
    sharedStateChangeGeneration: 1, dataFormulaDefaults: [{ key: "contract" }], WEBINAR_MESSAGE_FIELDS: [],
    getCardFieldFormulaBinding: () => binding, getCardFieldFormula: () => stored,
    setCardFieldFormula: (_binding, value) => { stored = value; },
    canAccessView: () => allow, isDatabaseDemoMode: () => false, isSettingsDraftSessionActive: () => false,
    escapeHtml: value => value, escapeAttr: value => value, unique: values => [...new Set(values)],
    renderDataFormulaDictionary: () => "", renderCommunicationTemplateFormulaEditorContent: value => value,
    getCommunicationTemplateFieldDefinitions: () => [], bindDataFormulaConstructor() {}, bindCommunicationTemplateFieldDialogFields() {},
    serializeCommunicationTemplateEditor: item => item.value, validateCardFieldFormula: () => validation,
    addAudit() {}, persist: () => { calls.persist++; }, refreshCardFormulaValues: () => { calls.refresh++; },
    flushSharedApplicationStateThroughGeneration: async () => {
      calls.flush++;
      if (failure) throw Error("Нет соединения");
      if (delayed) return new Promise(resolve => { resolveSave = resolve; });
      return confirmed;
    },
    chooseUnsavedChangesAction: async () => { calls.prompts++; return "cancel"; },
    alert: message => { throw Error(message); }
  };
  vm.createContext(context);
  vm.runInContext(extract("openCardFieldFormulaSettings"), context);
  assert.equal(context.openCardFieldFormulaSettings(control), true);
  editor.value = "Изменённая формула";
  return { dialog, editor, button, status, card, calls, submit: () => form.requestSubmit(), confirm: value => resolveSave(value), deny: () => { allow = false; }, conflict: () => { stored = "Изменено другим пользователем"; }, getStored: () => stored };
}

(async () => {
  for (const [kind, config] of [["message", "students"], ["message", "contracts"], ["field", "contracts"], ["number", "students"], ["webinar", "students"]]) {
    const test = scenario({ kind, config, delayed: true });
    const pending = test.submit();
    assert.equal(test.dialog.isConnected, true, `${kind}: stay open until confirmed`);
    assert.equal(test.button.disabled, true);
    await test.submit();
    assert.equal(test.calls.flush, 1, "Double submit must not save twice");
    test.confirm(true); await pending;
    assert.equal(test.dialog.isConnected, false, `${kind}: close after successful save`);
    assert.equal(test.calls.focus, 1, "Return focus to card field");
    assert.equal(test.calls.refresh, 1);
    assert.equal(test.calls.prompts, 0, "No unsaved prompt for the saved formula");
    assert.equal(test.getStored(), "Изменённая формула");
    assert.equal(test.card.draft, "Ручные правки");
  }
  for (const options of [{ confirmed: false }, { failure: true }, { validation: "Некорректная формула" }]) {
    const test = scenario(options); await test.submit();
    assert.equal(test.dialog.isConnected, true, "Keep editor open on failed/unconfirmed/invalid save");
    assert.equal(test.button.disabled, false);
    assert.ok(test.status.textContent);
    assert.equal(test.editor.value, "Изменённая формула");
  }
  const denied = scenario(); denied.deny(); await denied.submit();
  assert.equal(denied.dialog.isConnected, true); assert.equal(denied.calls.persist, 0);
  const conflict = scenario(); conflict.conflict(); await conflict.submit();
  assert.equal(conflict.dialog.isConnected, true); assert.equal(conflict.calls.persist, 0);
  const newer = scenario({ delayed: true });
  const pending = newer.submit(); newer.editor.value = "Новая правка во время сохранения";
  newer.confirm(true); await pending;
  assert.equal(newer.dialog.isConnected, true, "Never discard edits made during async save");
  assert.equal(newer.calls.prompts, 1);
  assert.equal(newer.editor.value, "Новая правка во время сохранения");
  assert.match(extract("saveCommunicationTemplateField"), /persist\(\);\s*dialog\.remove\(\);/, "Nested field formula already closes after saving");
  console.log("Formula auto-close: student/employee/number/webinar, confirmed save, focus, errors, permissions, conflict and newer edits: OK");
})().catch(error => { console.error(error); process.exitCode = 1; });

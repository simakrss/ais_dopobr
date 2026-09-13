"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const appSource = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8").replace(/\r\n?/g, "\n");

function extractFunction(name) {
  const start = appSource.indexOf(`  function ${name}(`);
  const remaining = appSource.slice(start + 1);
  const next = /\n  (?:async )?function /u.exec(remaining);
  assert.ok(start >= 0 && next, `Missing function ${name}`);
  return appSource.slice(start, start + 1 + next.index).trim();
}

const names = [
  "isCopyableControl", "isContentEditableTextControl", "isFieldEditHistoryControl",
  "getFieldHistoryRadioGroup", "captureFieldControlHistoryValue", "cloneFieldControlHistoryValue",
  "fieldControlHistoryValuesEqual", "initializeFieldControlHistory", "initializeFieldEditHistories",
  "recordFieldControlHistoryChange", "applyFieldControlHistoryValue", "undoFieldControl", "redoFieldControl",
  "getFieldHistoryControlFromEvent", "normalizeDateInputFormat", "isValidCalendarDateParts",
  "parseCalendarDateParts", "formatCalendarDateParts", "formatDateTextInputValue", "formatDateInputClipboardValue",
  "getDateTextInputFormat", "getDateTextCaretOffset", "applyDateTextInputMask", "initializeDateTextInputMasks",
  "initializeNativeDateInputFormats", "handleDateTextInputKeydown", "isNativeDateInputControl",
  "getDateControlCopyValue", "handleDateControlClipboardEvent", "canPasteControlValue", "findPastedSelectOption",
  "normalizePastedInputValue", "pasteTextIntoControl", "todayIso", "handlePersonNoteDateShortcut", "bindFieldEditHistory"
];
const runtime = `let fieldEditHistoryBound = false; const fieldControlHistories = new WeakMap(); let lastKnownClipboardText = "unchanged";\n${names.map(extractFunction).join("\n\n")}`;
const listeners = new Map();
const document = {
  querySelectorAll: () => [],
  addEventListener(type, handler) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(handler);
  }
};
let localNow = [2026, 0, 2, 0, 30];
class LocalDate extends Date {
  constructor(...args) { super(...(args.length ? args : localNow)); }
}
class FakeEvent {
  constructor(type, options = {}) { Object.assign(this, { type, defaultPrevented: false }, options); }
  preventDefault() { this.defaultPrevented = true; }
}
const context = vm.createContext({ document, Date: LocalDate, Event: FakeEvent });
vm.runInContext(runtime, context);
context.bindFieldEditHistory();
context.bindFieldEditHistory();
assert.equal(listeners.get("keydown").length, 1, "Binding stays delegated and does not duplicate on rerender");

class Control {
  constructor(options = {}) {
    Object.assign(this, {
      tagName: "TEXTAREA", name: "note", type: "textarea", value: "До  после",
      selectionStart: 3, selectionEnd: 3, config: "students", inRecordForm: true,
      disabled: false, readOnly: false, ariaDisabled: false, disabledFieldset: false,
      dataset: {}, dispatched: []
    }, options);
  }
  matches(selector) {
    if (selector === ":disabled") return this.disabled || this.disabledFieldset;
    if (selector.includes("input, select, textarea")) return true;
    return false;
  }
  closest(selector) {
    if (selector.includes("#recordForm")) {
      return this.inRecordForm && ["students", "contracts"].includes(this.config) ? {} : null;
    }
    return this.matches(selector) ? this : null;
  }
  getAttribute(name) { return name === "aria-disabled" && this.ariaDisabled ? "true" : null; }
  setRangeText(text, start, end, mode) {
    assert.equal(mode, "end");
    this.value = this.value.slice(0, start) + text + this.value.slice(end);
    this.selectionStart = this.selectionEnd = start + text.length;
  }
  dispatchEvent(event) {
    this.dispatched.push(event.type);
    event.target = this;
    for (const handler of listeners.get(event.type) || []) handler(event);
  }
  focus() { this.focused = true; }
}
function keydown(control, options = {}) {
  const event = new FakeEvent("keydown", { target: control, ctrlKey: true, shiftKey: true, key: "D", code: "KeyD", ...options });
  for (const handler of listeners.get("keydown")) handler(event);
  return event;
}

for (const config of ["students", "contracts"]) {
  for (const shortcut of [
    { code: "KeyD", key: "D" }, { code: "KeyD", key: "В" }, { code: "Digit4", key: "$" },
    { code: "Digit4", key: ";" }, { code: "Digit4", key: "4" },
    { code: "", key: "d" }, { code: "", key: "в" }, { code: "", key: "4" },
    { code: "", key: "$" }, { code: "", key: ";" }
  ]) {
    const control = new Control({ config });
    assert.equal(keydown(control, shortcut).defaultPrevented, true);
    assert.equal(control.value, "До 02.01.2026 после");
    assert.equal(control.selectionStart, 13);
    assert.equal(control.selectionEnd, 13);
    assert.deepEqual(control.dispatched, ["input", "change"], "Dirty tracking, hyperlinks and draft listeners receive the edit");
    assert.equal(control.focused, true);
    assert.equal(keydown(control, { key: "z", code: "KeyZ", shiftKey: false }).defaultPrevented, true);
    assert.equal(control.value, "До  после", "Ctrl+Z removes only the insertion");
    assert.equal(keydown(control, { key: "Z", code: "KeyZ" }).defaultPrevented, true);
    assert.equal(control.value, "До 02.01.2026 после", "Ctrl+Shift+Z restores the insertion");
  }
}
for (const name of ["expenseNotes", "orderNotes", "portalNotes", "reviewNotes", "finalWorkNotes"]) {
  const control = new Control({ name, value: "", selectionStart: 0, selectionEnd: 0 });
  keydown(control);
  assert.equal(control.value, "02.01.2026");
}
const selected = new Control({ value: "До СТАРАЯ ДАТА после", selectionStart: 3, selectionEnd: 14 });
keydown(selected);
assert.equal(selected.value, "До 02.01.2026 после", "Replace only the selected text");
const multiline = new Control({ value: "Первая\nВторая: ", selectionStart: 15, selectionEnd: 15 });
keydown(multiline);
assert.equal(multiline.value, "Первая\nВторая: 02.01.2026");

for (const options of [
  { ctrlKey: false }, { shiftKey: false }, { altKey: true }, { metaKey: true },
  { isComposing: true }, { defaultPrevented: true }, { code: "KeyF", key: "F" },
  { code: "Semicolon", key: ";" }, { code: "Numpad4", key: "4" }, { code: "", key: "x" }
]) {
  const control = new Control();
  const event = keydown(control, options);
  assert.equal(control.value, "До  после");
  assert.equal(event.defaultPrevented, Boolean(options.defaultPrevented), "Leave unrelated shortcuts to the browser");
}
for (const options of [
  { name: "portalMessage" }, { name: "name" }, { name: "note1" }, { config: "programs" },
  { inRecordForm: false }, { tagName: "INPUT", type: "text" }, { disabled: true },
  { readOnly: true }, { ariaDisabled: true }, { disabledFieldset: true }
]) {
  const control = new Control(options);
  assert.equal(keydown(control).defaultPrevented, false);
  assert.equal(control.value, "До  после");
}
assert.equal(keydown(null).defaultPrevented, false);
const repeated = new Control();
keydown(repeated);
assert.equal(keydown(repeated, { repeat: true }).defaultPrevented, true);
assert.equal(repeated.value, "До 02.01.2026 после", "Holding the shortcut does not insert multiple dates");
localNow = [2027, 0, 1, 0, 1];
const nextDay = new Control({ value: "", selectionStart: 0, selectionEnd: 0 });
keydown(nextDay);
assert.equal(nextDay.value, "01.01.2027", "Date is read at keypress time, using local calendar getters");
assert.equal(vm.runInContext("lastKnownClipboardText", context), "unchanged", "Clipboard is not modified");
assert.match(extractFunction("renderStudentSidePanel"), /aria-keyshortcuts="Control\+Shift\+D Control\+Shift\+4"/u);
assert.match(appSource, /renderStudentSidePanel\(record, \{\s*entityType: "contract"/u);
console.log("Person note date shortcuts: EN/RU keys, both cards, selection/caret, undo/redo, event binding, guards and local date: OK");

if (process.argv.includes("--serve")) {
  require("node:http").createServer((request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Проверка горячих клавиш примечаний</title><body>
      <h1>Тестовая карточка — без доступа к рабочей базе</h1>
      <button onclick="document.getElementById('recordForm').dataset.config='students'">Слушатель</button>
      <button onclick="document.getElementById('recordForm').dataset.config='contracts'">Сотрудник</button>
      <form id="recordForm" data-config="students"><label>Примечание<textarea name="note">До СТАРАЯ ДАТА после</textarea></label></form>
      <label>Другое поле<textarea name="other">Не менять</textarea></label>
      <script>${runtime}\nbindFieldEditHistory();</script>
    </body></html>`);
  }).listen(0, "127.0.0.1", function () { console.log(`Fixture: http://127.0.0.1:${this.address().port}/`); });
}

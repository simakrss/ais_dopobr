"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const requestedSource = String(process.env.AIS_TEST_APP_SOURCE || "").trim();
const appPath = requestedSource
  ? path.resolve(process.cwd(), requestedSource)
  : path.resolve(__dirname, "..", "app.js");
const appSource = fs.readFileSync(appPath, "utf8").replace(/\r\n?/gu, "\n");

function extractFunction(name) {
  const plainStart = appSource.indexOf(`  function ${name}(`);
  const asyncStart = appSource.indexOf(`  async function ${name}(`);
  const start = plainStart >= 0 ? plainStart : asyncStart;
  assert.ok(start >= 0, `Не найдена функция ${name}().`);
  const bodyStart = appSource.indexOf(") {", start) + 2;
  assert.ok(bodyStart > start, `Не найдено тело функции ${name}().`);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < appSource.length; index += 1) {
    const char = appSource[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (["\"", "'", "`"].includes(char)) {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return appSource.slice(start, index + 1).replace(/^  /gmu, "");
    }
  }
  throw new Error(`Функция ${name}() не завершена.`);
}

const dependencyFunctionNames = [
  "isValidCalendarDateParts",
  "getDateTextCaretOffset",
  "isNativeDateInputControl"
];
const functionNames = [
  "normalizeDateInputFormat",
  "parseCalendarDateParts",
  "formatCalendarDateParts",
  "formatDateTextInputValue",
  "formatDateInputClipboardValue",
  "getDateTextInputFormat",
  "applyDateTextInputMask",
  "initializeNativeDateInputFormats",
  "handleDateTextInputKeydown",
  "getDateControlCopyValue",
  "handleDateControlClipboardEvent",
  "normalizePastedInputValue",
  "getControlCopyValue"
];

class FakeInput {
  constructor({
    type = "text",
    value = "",
    format = "",
    selectionStart = null,
    selectionEnd = null,
    readOnly = false,
    disabled = false
  } = {}) {
    this.tagName = "INPUT";
    this.type = type;
    this.value = String(value);
    this.dataset = {};
    this.attributes = new Map();
    if (format) this.dataset.dateInputFormat = format;
    this.selectionStart = selectionStart;
    this.selectionEnd = selectionEnd ?? selectionStart;
    this.readOnly = readOnly;
    this.disabled = disabled;
    this.checked = false;
    this.listeners = new Map();
    this.dispatched = [];
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  dispatchEvent(event) {
    this.dispatched.push(event.type);
    (this.listeners.get(event.type) || []).forEach((listener) => listener.call(this, event));
    return true;
  }

  setSelectionRange(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }

  focus() {}

  getAttribute(name) {
    if (name === "data-date-input-format" && Object.hasOwn(this.dataset, "dateInputFormat")) {
      return this.dataset.dateInputFormat;
    }
    if (name === "data-date-copy-format" && Object.hasOwn(this.dataset, "dateCopyFormat")) {
      return this.dataset.dateCopyFormat;
    }
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name) {
    return this.getAttribute(name) !== null;
  }

  setAttribute(name, value) {
    const normalizedValue = String(value);
    this.attributes.set(name, normalizedValue);
    if (name === "data-date-copy-format") this.dataset.dateCopyFormat = normalizedValue;
  }

  closest(selector) {
    return selector.includes("input") || selector.includes("date-input-format") ? this : null;
  }

  matches(selector) {
    if (selector === "[data-date-input-format]") {
      return Object.hasOwn(this.dataset, "dateInputFormat");
    }
    return selector.includes("input");
  }
}

class FakeTextarea extends FakeInput {
  constructor(options = {}) {
    super({ ...options, type: "textarea" });
    this.tagName = "TEXTAREA";
  }
}

function getSelectedControlText(control) {
  if (!["INPUT", "TEXTAREA"].includes(control?.tagName)) return "";
  try {
    const start = control.selectionStart;
    const end = control.selectionEnd;
    if (typeof start !== "number" || typeof end !== "number" || end <= start) return "";
    return String(control.value || "").slice(start, end);
  } catch (error) {
    return "";
  }
}

const context = {
  Array,
  Boolean,
  Date,
  Event: class Event {
    constructor(type, options = {}) {
      this.type = type;
      this.bubbles = options.bubbles === true;
    }
  },
  HTMLInputElement: FakeInput,
  HTMLTextAreaElement: FakeTextarea,
  Math,
  Number,
  Object,
  RegExp,
  String,
  getSelectedControlText,
  getFieldHistoryControlFromEvent: (event) => event?.target || null,
  isContentEditableTextControl: () => false,
  lastKnownClipboardText: "",
  serializeCommunicationTemplateEditor: () => ""
};
vm.createContext(context);
vm.runInContext(
  `${[...dependencyFunctionNames, ...functionNames].map(extractFunction).join("\n\n")}
   this.dateApi = { ${functionNames.join(", ")} };`,
  context
);

const api = context.dateApi;
assert.equal(api.normalizeDateInputFormat("ru"), "ru");
assert.equal(api.normalizeDateInputFormat("iso"), "iso");

const ruParts = api.parseCalendarDateParts("07.09.2026", "ru");
assert.ok(ruParts, "Корректная русская дата должна разбираться.");
assert.equal(Number(ruParts.day), 7);
assert.equal(Number(ruParts.month), 9);
assert.equal(Number(ruParts.year), 2026);
assert.equal(api.formatCalendarDateParts(ruParts, "ru"), "07.09.2026");

const isoParts = api.parseCalendarDateParts("2026-09-07", "iso");
assert.ok(isoParts, "Корректная ISO-дата должна разбираться.");
assert.equal(Number(isoParts.day), 7);
assert.equal(Number(isoParts.month), 9);
assert.equal(Number(isoParts.year), 2026);
assert.equal(api.formatCalendarDateParts(isoParts, "iso"), "2026-09-07");

assert.ok(api.parseCalendarDateParts("29.02.2024", "ru"), "Високосная дата должна приниматься.");
assert.equal(api.parseCalendarDateParts("29.02.2025", "ru"), null);
assert.equal(api.parseCalendarDateParts("31.04.2026", "ru"), null);
assert.equal(api.parseCalendarDateParts("2026-13-01", "iso"), null);

assert.equal(api.formatDateTextInputValue("07092026", "ru"), "07.09.2026");
assert.equal(api.formatDateTextInputValue("0709", "ru"), "07.09.");
assert.equal(api.formatDateTextInputValue("20260907", "iso"), "2026-09-07");
assert.equal(api.formatDateTextInputValue("202609", "iso"), "2026-09-");
assert.equal(api.formatDateInputClipboardValue("2026-09-07", "ru"), "07.09.2026");
assert.equal(api.formatDateInputClipboardValue("07.09.2026", "ru"), "07.09.2026");
assert.equal(api.formatDateInputClipboardValue("2026-09-07", "iso"), "2026-09-07");

const ruControl = new FakeInput({ value: "0709", format: "ru", selectionStart: 4 });
assert.equal(api.getDateTextInputFormat(ruControl), "ru");
api.applyDateTextInputMask(ruControl);
assert.equal(ruControl.value, "07.09.");
assert.equal(ruControl.selectionStart, 6, "Каретка должна учитывать добавленную точку.");
assert.equal(ruControl.selectionEnd, 6);

const isoControl = new FakeInput({ value: "202609", format: "iso", selectionStart: 6 });
assert.equal(api.getDateTextInputFormat(isoControl), "iso");
api.applyDateTextInputMask(isoControl);
assert.equal(isoControl.value, "2026-09-");
assert.equal(isoControl.selectionStart, 8, "Каретка должна учитывать добавленное тире.");

function keyEvent(target, key) {
  let prevented = 0;
  return {
    target,
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    isComposing: false,
    get prevented() { return prevented; },
    preventDefault() { prevented += 1; }
  };
}

const backspaceControl = new FakeInput({
  value: "07.09.2026",
  format: "ru",
  selectionStart: 3
});
const backspaceEvent = keyEvent(backspaceControl, "Backspace");
api.handleDateTextInputKeydown(backspaceEvent);
assert.equal(backspaceEvent.prevented, 1, "Backspace у точки должен обрабатываться маской.");
assert.equal(backspaceControl.value, "07.09.2026");
assert.equal(backspaceControl.selectionStart, 2, "Backspace должен перенести каретку влево от точки.");
assert.equal(backspaceControl.selectionEnd, 2);

const deleteControl = new FakeInput({
  value: "07.09.2026",
  format: "ru",
  selectionStart: 2
});
const deleteEvent = keyEvent(deleteControl, "Delete");
api.handleDateTextInputKeydown(deleteEvent);
assert.equal(deleteEvent.prevented, 1, "Delete у точки должен обрабатываться маской.");
assert.equal(deleteControl.value, "07.09.2026");
assert.equal(deleteControl.selectionStart, 3, "Delete должен перенести каретку вправо от точки.");
assert.equal(deleteControl.selectionEnd, 3);

const ordinaryBackspaceControl = new FakeInput({
  value: "07.09.2026",
  format: "ru",
  selectionStart: 10
});
const ordinaryBackspaceEvent = keyEvent(ordinaryBackspaceControl, "Backspace");
api.handleDateTextInputKeydown(ordinaryBackspaceEvent);
assert.equal(ordinaryBackspaceEvent.prevented, 0, "Вне разделителя браузер должен обрабатывать удаление сам.");

const nativeDate = new FakeInput({ type: "date", value: "2026-09-07" });
api.initializeNativeDateInputFormats({
  querySelectorAll(selector) {
    assert.equal(selector, "input[type='date']");
    return [nativeDate];
  }
});
assert.equal(nativeDate.lang, "ru-RU");
assert.equal(nativeDate.getAttribute("data-date-copy-format"), "ru");
assert.equal(api.getDateControlCopyValue(nativeDate), "07.09.2026");
assert.equal(api.getControlCopyValue(nativeDate), "07.09.2026");

const visibleRuDate = new FakeInput({ value: "07.09.2026", format: "ru" });
assert.equal(api.getDateControlCopyValue(visibleRuDate), null);
assert.equal(api.getControlCopyValue(visibleRuDate), "07.09.2026");

const selectedRuDate = new FakeInput({
  value: "07.09.2026",
  format: "ru",
  selectionStart: 0,
  selectionEnd: 2
});
assert.equal(api.getControlCopyValue(selectedRuDate), "07", "Выделение в текстовой дате должно сохраняться.");

const ordinaryText = new FakeInput({ value: "Обычный текст" });
assert.equal(api.getControlCopyValue(ordinaryText), "Обычный текст");

function clipboardEvent(type, target) {
  const values = new Map();
  let prevented = 0;
  return {
    type,
    target,
    clipboardData: {
      setData(format, value) { values.set(format, String(value)); }
    },
    get copiedText() { return values.get("text/plain") || values.get("text") || ""; },
    get prevented() { return prevented; },
    preventDefault() { prevented += 1; }
  };
}

const nativeCopyEvent = clipboardEvent("copy", nativeDate);
api.handleDateControlClipboardEvent(nativeCopyEvent);
assert.equal(nativeCopyEvent.copiedText, "07.09.2026");
assert.equal(nativeCopyEvent.prevented, 1);
assert.equal(nativeDate.value, "2026-09-07", "Копирование не должно менять внутреннее ISO-значение.");

assert.equal(api.normalizePastedInputValue(nativeDate, "07.09.2026"), "2026-09-07");
assert.equal(api.normalizePastedInputValue(nativeDate, "07092026"), "2026-09-07");
assert.equal(api.normalizePastedInputValue(visibleRuDate, "07092026"), "07.09.2026");
const visibleIsoDate = new FakeInput({ value: "", format: "iso" });
assert.equal(api.normalizePastedInputValue(visibleIsoDate, "20260907"), "2026-09-07");

const recognitionRenderer = extractFunction("renderStudentDocumentRecognitionField");
assert.match(recognitionRenderer, /data-date-input-format="\$\{dateInputFormat\}"/u);
const recognitionFormatSource = extractFunction("getStudentDocumentRecognitionDateInputFormat");
assert.match(recognitionFormatSource, /return "ru"/u);
assert.match(recognitionFormatSource, /return "iso"/u);

const initializationSource = extractFunction("initializeDateTextInputMasks");
assert.match(initializationSource, /input\[data-date-input-format\]/u);
assert.match(initializationSource, /applyDateTextInputMask/u);
const historyBindingSource = extractFunction("bindFieldEditHistory");
assert.match(historyBindingSource, /initializeDateTextInputMasks\(document\)/u);
assert.match(historyBindingSource, /initializeNativeDateInputFormats\(document\)/u);
assert.match(historyBindingSource, /handleDateTextInputKeydown/u);
assert.match(historyBindingSource, /addEventListener\("copy",[\s\S]*?handleDateControlClipboardEvent/u);
assert.doesNotMatch(historyBindingSource, /addEventListener\("cut",[\s\S]*?handleDateControlClipboardEvent/u);
assert.match(historyBindingSource, /addEventListener\("input",[\s\S]*?applyDateTextInputMask[\s\S]*?true\)/u);

console.log("Date input formatting tests passed.");

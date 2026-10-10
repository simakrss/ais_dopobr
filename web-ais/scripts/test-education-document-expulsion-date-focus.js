"use strict";

// Synthetic card state only; no database writes or document generation.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").replace(/\r\n/g, "\n");
function extract(name) {
  const match = source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name);
  return match[0];
}

function fixture(tab = "results", overrides = {}) {
  const record = Object.freeze({
    id: "test-student", program: "Тестовая программа", expulsionDate: "",
    notes: "Несохранённый текст", registrationNo: "123/26-ПК", ...overrides
  });
  const originalDraft = { notes: "Старый текст", retainedField: "Сохранить" };
  const state = { studentCardTab: tab, modal: { draft: { ...originalDraft }, hasDraftChanges: true } };
  const events = [];
  const frames = [];
  let currentForm = { dataset: { config: "students", id: record.id } };
  let visibleInput = null;
  let focused = null;
  function mountDate() {
    const input = {
      name: "expulsionDate",
      value: record.expulsionDate,
      scrollIntoView(options) {
        assert.equal(options.block, "center");
        events.push("scroll");
      },
      focus() {
        assert.equal(state.studentCardTab, "ordersSdo");
        focused = input;
        events.push("focus");
      }
    };
    visibleInput = input;
  }
  if (tab === "ordersSdo") mountDate();
  const context = vm.createContext({
    state,
    document: {
      getElementById(id) { assert.equal(id, "recordForm"); return currentForm; },
      querySelector(selector) { assert.equal(selector, '[name="expulsionDate"]'); return visibleInput; }
    },
    CSS: { escape: (value) => value },
    collectStudentFormDraft: () => ({ ...record }),
    findProgramByName: () => ({ name: record.program, type: "КПК" }),
    alert(message) {
      assert.equal(state.studentCardTab, tab, "Navigation must follow the validation message");
      assert.equal(message, "Заполните дату отчисления. Дата выдачи документа берется из даты отчисления.");
      events.push("alert");
    },
    render() {
      assert.equal(state.studentCardTab, "ordersSdo");
      // Only the active tab exists in the real card. Recreate its form and date input.
      currentForm = { dataset: { config: "students", id: record.id } };
      mountDate();
      events.push("render");
    },
    requestAnimationFrame: (callback) => frames.push(callback),
    getEducationDocumentAutofillValues: () => assert.fail("Do not generate details without a date")
  });
  vm.runInContext([
    "normalizeEducationProgramType", "parseOrdersSdoDate", "getStudentDocumentFieldTab",
    "focusStudentDocumentField", "getEducationDocumentAutofillContext", "autoFillEducationDocument"
  ].map(extract).join("\n"), context);
  return { context, state, record, originalDraft, events, frames,
    get input() { return visibleInput; }, get focused() { return focused; },
    setForm(value) { currentForm = value; }
  };
}

for (const tab of ["results", "main", "documents", "ordersSdo"]) {
  for (const expulsionDate of ["", "not-a-date"]) {
    const f = fixture(tab, { expulsionDate });
    assert.equal(f.context.autoFillEducationDocument(), null);
    assert.equal(f.state.studentCardTab, "ordersSdo");
    assert.equal(f.focused, null, "Focus is deferred until the new tab is rendered");
    assert.equal(f.frames.length, 1);
    f.frames.shift()();
    assert.equal(f.focused, f.input, "Focus the current date input, not the old form");
    assert.equal(f.input.value, expulsionDate, "Do not fill or change the date automatically");
    assert.deepEqual(f.events, tab === "ordersSdo" ? ["alert", "scroll", "focus"] : ["alert", "render", "scroll", "focus"]);
    if (tab !== "ordersSdo") {
      assert.equal(f.state.modal.draft.notes, f.record.notes);
      assert.equal(f.state.modal.draft.registrationNo, f.record.registrationNo);
      assert.equal(f.state.modal.draft.retainedField, f.originalDraft.retainedField);
    }
    assert.equal(f.state.modal.hasDraftChanges, true);
  }
}

for (const dates of [
  { expulsionDate: "2026-09-20" },
  { expulsionOrderDate: "2026-09-20" },
  { expulsionDate: "2026-09-20", expulsionOrderDate: "2026-09-19" }
]) {
  const f = fixture("results", dates);
  const result = f.context.getEducationDocumentAutofillContext();
  assert.equal(result.issueDate, "2026-09-20");
  assert.equal(result.programType, "КПК");
  assert.equal(f.state.studentCardTab, "results", "A valid date does not change tabs");
  assert.deepEqual(f.events, []);
  assert.equal(f.frames.length, 0);
}

for (const form of [null, { dataset: { config: "contracts" } }]) {
  const f = fixture();
  f.setForm(form);
  assert.equal(f.context.getEducationDocumentAutofillContext(), null);
  assert.deepEqual(f.events, []);
}
console.log("Education document expulsion-date focus tests passed.");

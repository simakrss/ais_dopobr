"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");
const stylesSource = fs.readFileSync(path.resolve(__dirname, "..", "styles.css"), "utf8");

function extractBetween(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Не найден блок ${startMarker}`);
  return appSource.slice(start, end).replace(/^  /gmu, "");
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  toggle(name, force) {
    if (force) this.values.add(name);
    else this.values.delete(name);
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement {
  constructor(messenger = "") {
    this.dataset = messenger
      ? { messenger, messengerLabel: `Открыть ${messenger}` }
      : {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = new FakeClassList();
    this.disabled = false;
    this.isConnected = true;
    this.form = null;
    this.title = "";
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  closest(selector) {
    if (selector === "#recordForm") return this.form;
    return null;
  }

  getBoundingClientRect() {
    return { left: 120, top: 80, right: 150, bottom: 110, width: 30, height: 30 };
  }

  focus() {
    fakeDocument.activeElement = this;
  }
}

class FakeMenu extends FakeElement {
  constructor() {
    super();
    this.style = {};
    this.item = null;
    this.className = "";
  }

  set innerHTML(value) {
    assert.match(String(value), />Использовать по умолчанию</u);
    this.item = new FakeElement();
    this.item.dataset.action = "set-preferred-messenger";
  }

  querySelector(selector) {
    return selector === "[data-action='set-preferred-messenger']" ? this.item : null;
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, right: 220, bottom: 42, width: 220, height: 42 };
  }

  remove() {
    this.isConnected = false;
    if (fakeDocument.menu === this) fakeDocument.menu = null;
  }
}

class FakeInput {
  constructor() {
    this.value = "";
    this.events = [];
  }

  dispatchEvent(event) {
    this.events.push(event.type);
    return true;
  }
}

class FakeEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.bubbles = Boolean(options.bubbles);
  }
}

const fakeDocument = {
  menu: null,
  activeElement: null,
  listeners: new Map(),
  body: {
    appendChild(element) {
      element.isConnected = true;
      fakeDocument.menu = element;
    }
  },
  createElement() {
    return new FakeMenu();
  },
  querySelector(selector) {
    return selector === "[data-messenger-preference-menu]" ? this.menu : null;
  },
  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  },
  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }
};

const fakeWindow = {
  innerWidth: 1280,
  innerHeight: 800,
  listeners: new Map(),
  setTimeout(callback) {
    callback();
    return 1;
  },
  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  },
  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }
};

const preferredInput = new FakeInput();
const buttons = ["max", "max", "telegram", "telegram", "whatsapp", "whatsapp"]
  .map((messenger) => new FakeElement(messenger));
const form = {
  dataset: { config: "students" },
  elements: { preferredMessenger: preferredInput },
  querySelectorAll(selector) {
    return selector === "[data-action='open-student-messenger']" ? buttons : [];
  }
};
buttons.forEach((button) => { button.form = form; });

const state = { modal: { draft: { unsavedField: "сохранить" }, hasDraftChanges: false } };
let studentDraftCollections = 0;
let contractDraftCollections = 0;
const context = {
  document: fakeDocument,
  window: fakeWindow,
  Element: FakeElement,
  Event: FakeEvent,
  Number,
  Math,
  state,
  clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
  closeSystemMailboxEmailMenu() {},
  collectStudentFormDraft: () => {
    studentDraftCollections += 1;
    return { unsavedField: "сохранить", preferredMessenger: preferredInput.value };
  },
  collectContractFormDraft: () => {
    contractDraftCollections += 1;
    return { contractDraft: "сохранить", preferredMessenger: preferredInput.value };
  }
};
vm.createContext(context);
vm.runInContext(
  `${extractBetween("  function normalizePreferredMessenger", "  async function openStudentMessenger")}
   ${extractBetween("  function closeMessengerPreferenceMenu", "  async function runSystemMailboxEmailButtonAction")}
   this.normalizePreferredMessenger = normalizePreferredMessenger;
   this.bindMessengerPreferenceMenus = bindMessengerPreferenceMenus;
   this.showMessengerPreferenceMenu = showMessengerPreferenceMenu;`,
  context
);

function createInteractionEvent(overrides = {}) {
  return {
    clientX: 340,
    clientY: 210,
    key: "",
    shiftKey: false,
    prevented: 0,
    stopped: 0,
    preventDefault() { this.prevented += 1; },
    stopPropagation() { this.stopped += 1; },
    ...overrides
  };
}

assert.equal(context.normalizePreferredMessenger(" MAX "), "max");
assert.equal(context.normalizePreferredMessenger("Telegram"), "telegram");
assert.equal(context.normalizePreferredMessenger("WHATSAPP"), "whatsapp");
assert.equal(context.normalizePreferredMessenger("viber"), "");
assert.equal(context.normalizePreferredMessenger(), "");

const root = {
  querySelectorAll(selector) {
    assert.equal(selector, "[data-action='open-student-messenger']");
    return buttons;
  }
};
context.bindMessengerPreferenceMenus(root);
context.bindMessengerPreferenceMenus(root);
buttons.forEach((button) => {
  assert.equal(button.listeners.get("contextmenu")?.length, 1);
  assert.equal(button.listeners.get("keydown")?.length, 1);
});

const telegramButton = buttons[2];
const contextEvent = createInteractionEvent();
telegramButton.listeners.get("contextmenu")[0](contextEvent);
assert.equal(contextEvent.prevented, 1);
assert.equal(contextEvent.stopped, 1);
assert.equal(telegramButton.getAttribute("aria-expanded"), "true");
assert.ok(fakeDocument.menu);
assert.equal(fakeDocument.activeElement, fakeDocument.menu.item);
fakeDocument.menu.item.listeners.get("click")[0]();
assert.equal(preferredInput.value, "telegram");
assert.deepEqual(preferredInput.events, ["input", "change"]);
assert.equal(state.modal.draft.preferredMessenger, "telegram");
assert.equal(state.modal.draft.unsavedField, "сохранить");
assert.equal(state.modal.hasDraftChanges, true);
assert.equal(studentDraftCollections, 1);
assert.equal(contractDraftCollections, 0);
buttons.forEach((button) => {
  const expected = button.dataset.messenger === "telegram";
  assert.equal(button.classList.contains("is-preferred"), expected);
  assert.equal(button.dataset.preferredMessenger, expected ? "true" : "false");
  assert.equal(button.getAttribute("aria-label").includes("Используется по умолчанию"), expected);
});
assert.equal(fakeDocument.menu, null);
assert.equal(fakeDocument.activeElement, telegramButton);

state.modal.hasDraftChanges = false;
telegramButton.listeners.get("contextmenu")[0](createInteractionEvent());
fakeDocument.menu.item.listeners.get("click")[0]();
assert.deepEqual(preferredInput.events, ["input", "change"]);
assert.equal(studentDraftCollections, 1);
assert.equal(state.modal.hasDraftChanges, false);

form.dataset.config = "contracts";
state.modal.draft = { contractDraft: "сохранить" };
const maxButton = buttons[0];
maxButton.listeners.get("contextmenu")[0](createInteractionEvent());
fakeDocument.menu.item.listeners.get("click")[0]();
assert.equal(preferredInput.value, "max");
assert.equal(contractDraftCollections, 1);
assert.equal(state.modal.draft.contractDraft, "сохранить");
assert.equal(state.modal.draft.preferredMessenger, "max");
assert.equal(state.modal.hasDraftChanges, true);
form.dataset.config = "students";

const whatsappButton = buttons[4];
const keyboardEvent = createInteractionEvent({ key: "F10", shiftKey: true });
whatsappButton.listeners.get("keydown")[0](keyboardEvent);
assert.equal(keyboardEvent.prevented, 1);
assert.equal(keyboardEvent.stopped, 1);
assert.equal(fakeDocument.menu.style.left, "120px");
assert.equal(fakeDocument.menu.style.top, "114px");
const escapeEvent = createInteractionEvent({ key: "Escape" });
fakeDocument.menu.listeners.get("keydown")[0](escapeEvent);
assert.equal(escapeEvent.prevented, 1);
assert.equal(fakeDocument.menu, null);
assert.equal(fakeDocument.activeElement, whatsappButton);

whatsappButton.listeners.get("contextmenu")[0](createInteractionEvent());
assert.ok(fakeDocument.menu);
fakeDocument.listeners.get("pointerdown")({ target: { closest: () => null } });
assert.equal(fakeDocument.menu, null);

whatsappButton.disabled = true;
whatsappButton.listeners.get("contextmenu")[0](createInteractionEvent());
assert.equal(fakeDocument.menu, null);
whatsappButton.disabled = false;
whatsappButton.setAttribute("aria-disabled", "true");
whatsappButton.listeners.get("keydown")[0](createInteractionEvent({ key: "ContextMenu" }));
assert.equal(fakeDocument.menu, null);

assert.equal((appSource.match(/name="preferredMessenger" type="hidden"/gu) || []).length, 2);
assert.match(appSource, /renderStudentContactLine[\s\S]{0,900}record\.preferredMessenger/u);
assert.match(appSource, /renderCardContextActions[\s\S]{0,1400}record\.preferredMessenger/u);
assert.match(appSource, /function render\(\)[\s\S]{0,500}closeMessengerPreferenceMenu\(\)/u);
assert.match(appSource, /data-messenger-preference-menu[\s\S]{0,240}closeMessengerPreferenceMenu\(\{ restoreFocus: true \}\)/u);
assert.match(appSource, /bindMessengerPreferenceMenus\(\);/u);
assert.match(appSource, /key:\s*"preferredMessenger",\s*label:\s*"Предпочитаемый мессенджер"/u);
assert.match(appSource, /field === "preferredMessenger"\) return preferredMessengerDisplayName\(value\)/u);
assert.match(appSource, /preferredMessenger:\s*normalizePreferredMessenger\(student\.preferredMessenger\)/u);
assert.match(appSource, /preferredMessenger:\s*normalizePreferredMessenger\(contract\.preferredMessenger\)/u);
assert.match(stylesSource, /\.student-messenger-button\.is-preferred\s*\{[^}]*background:\s*#ffe082[^}]*color:\s*#694d00/u);

console.log("messenger preference context menu tests: OK");

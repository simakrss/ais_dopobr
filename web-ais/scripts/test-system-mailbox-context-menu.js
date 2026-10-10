const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const requestedSource = String(process.env.AIS_TEST_APP_SOURCE || "").trim();
const appPath = requestedSource
  ? path.resolve(process.cwd(), requestedSource)
  : path.resolve(__dirname, "..", "app.js");
const appSource = fs.readFileSync(appPath, "utf8");

function extractBetween(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Не найден блок ${startMarker}`);
  return appSource.slice(start, end).replace(/^  /gmu, "");
}

class FakeElement {
  constructor(action = "") {
    this.dataset = action ? { action } : {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.disabled = false;
    this.isConnected = true;
    this.tabIndex = -1;
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

  getBoundingClientRect() {
    return { left: 120, top: 80, right: 260, bottom: 112, width: 140, height: 32 };
  }

  focus() {
    fakeDocument.activeElement = this;
  }
}

class FakeMenu extends FakeElement {
  constructor() {
    super();
    this.items = [];
    this.style = {};
    this.className = "";
  }

  set innerHTML(value) {
    const modes = [...String(value).matchAll(/data-email-menu-recipient="([^"]+)"/gu)]
      .map((match) => match[1]);
    this.items = modes.map((mode, index) => {
      const item = new FakeElement();
      item.dataset.emailMenuRecipient = mode;
      item.tabIndex = index === 0 ? 0 : -1;
      return item;
    });
  }

  querySelectorAll(selector) {
    return selector === "[data-email-menu-recipient]" ? this.items : [];
  }

  getBoundingClientRect() {
    return { width: 270, height: 72, left: 0, top: 0, right: 270, bottom: 72 };
  }

  remove() {
    this.isConnected = false;
    if (fakeDocument.menu === this) fakeDocument.menu = null;
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
    return selector === "[data-system-mailbox-email-menu]" ? this.menu : null;
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

const calls = [];
const menuContext = {
  document: fakeDocument,
  window: fakeWindow,
  Element: FakeElement,
  Number,
  Array,
  escapeHtml: (value) => String(value),
  clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
  emailPortalAccessMessage: async (event, recipientMode) => {
    calls.push({ action: "student-portal", button: event.currentTarget, recipientMode });
  },
  emailEmployeePortalAccessMessage: async (event, recipientMode) => {
    calls.push({ action: "employee-portal", button: event.currentTarget, recipientMode });
  },
  emailStudentCommunicationMessage: async (messageKey, button, event, recipientMode) => {
    calls.push({ action: "communication", messageKey, button, event, recipientMode });
  }
};
vm.createContext(menuContext);
vm.runInContext(
  `${extractBetween(
    "  const SYSTEM_MAILBOX_EMAIL_BUTTON_SELECTOR",
    "  function bindProgramTypeFilterOutsideClick"
  )}
   this.bindSystemMailboxEmailMenus = bindSystemMailboxEmailMenus;
   this.showSystemMailboxEmailMenu = showSystemMailboxEmailMenu;
   this.closeSystemMailboxEmailMenu = closeSystemMailboxEmailMenu;
   this.SYSTEM_MAILBOX_EMAIL_BUTTON_SELECTOR_VALUE = SYSTEM_MAILBOX_EMAIL_BUTTON_SELECTOR;`,
  menuContext
);

async function main() {
function createContextEvent(overrides = {}) {
  return {
    clientX: 350,
    clientY: 220,
    key: "",
    shiftKey: false,
    prevented: 0,
    stopped: 0,
    preventDefault() { this.prevented += 1; },
    stopPropagation() { this.stopped += 1; },
    ...overrides
  };
}

const studentPortal = new FakeElement("email-portal-access");
studentPortal.dataset.emailRecipientMode = "student";
const employeePortal = new FakeElement("email-employee-portal-access");
employeePortal.dataset.emailRecipientMode = "employee";
const communication = new FakeElement("email-communication-message");
communication.dataset.emailRecipientMode = "student";
communication.dataset.messageKey = "note3";
const root = {
  receivedSelector: "",
  querySelectorAll(selector) {
    this.receivedSelector = selector;
    return [studentPortal, employeePortal, communication];
  }
};

menuContext.bindSystemMailboxEmailMenus(root);
menuContext.bindSystemMailboxEmailMenus(root);
assert.equal(root.receivedSelector, menuContext.SYSTEM_MAILBOX_EMAIL_BUTTON_SELECTOR_VALUE);
assert.deepEqual(
  menuContext.SYSTEM_MAILBOX_EMAIL_BUTTON_SELECTOR_VALUE.split(", ").sort(),
  [
    "[data-action='email-communication-message']",
    "[data-action='email-employee-portal-access']",
    "[data-action='email-portal-access']"
  ]
);
[studentPortal, employeePortal, communication].forEach((button) => {
  assert.equal(button.listeners.get("contextmenu")?.length, 1, "Повторный bind не должен дублировать меню");
  assert.equal(button.listeners.get("keydown")?.length, 1);
});

const openEvent = createContextEvent();
studentPortal.listeners.get("contextmenu")[0](openEvent);
assert.equal(openEvent.prevented, 1);
assert.equal(openEvent.stopped, 1);
assert.equal(studentPortal.getAttribute("aria-expanded"), "true");
assert.ok(fakeDocument.menu);
assert.deepEqual(fakeDocument.menu.items.map((item) => item.dataset.emailMenuRecipient), ["student", "system"]);
assert.equal(fakeDocument.activeElement, fakeDocument.menu.items[0], "Первый пункт должен получать фокус");
await fakeDocument.menu.items[1].listeners.get("click")[0]();
assert.equal(calls.at(-1).action, "student-portal");
assert.equal(calls.at(-1).recipientMode, "system");
assert.equal(studentPortal.getAttribute("aria-expanded"), "false");
assert.equal(fakeDocument.menu, null);

studentPortal.listeners.get("contextmenu")[0](createContextEvent());
await fakeDocument.menu.items[0].listeners.get("click")[0]();
assert.equal(calls.at(-1).action, "student-portal");
assert.equal(calls.at(-1).recipientMode, "student");

employeePortal.listeners.get("contextmenu")[0](createContextEvent());
assert.deepEqual(fakeDocument.menu.items.map((item) => item.dataset.emailMenuRecipient), ["employee", "system"]);
await fakeDocument.menu.items[0].listeners.get("click")[0]();
assert.equal(calls.at(-1).action, "employee-portal");
assert.equal(calls.at(-1).recipientMode, "employee");

employeePortal.listeners.get("contextmenu")[0](createContextEvent());
const employeeSystemItem = fakeDocument.menu.items[1];
const employeeCallsBefore = calls.length;
await employeeSystemItem.listeners.get("click")[0]();
await employeeSystemItem.listeners.get("click")[0]();
assert.equal(calls.length, employeeCallsBefore + 1, "Повторная активация одного пункта не должна отправлять дважды");
assert.equal(calls.at(-1).action, "employee-portal");
assert.equal(calls.at(-1).recipientMode, "system");

const keyboardEvent = createContextEvent({ key: "F10", shiftKey: true });
communication.listeners.get("keydown")[0](keyboardEvent);
assert.equal(keyboardEvent.prevented, 1);
assert.equal(keyboardEvent.stopped, 1);
assert.equal(fakeDocument.menu.style.left, "120px", "Клавиатурное меню должно открываться у кнопки");
assert.equal(fakeDocument.menu.style.top, "116px");
const menu = fakeDocument.menu;
const arrowEvent = createContextEvent({ key: "ArrowDown" });
menu.listeners.get("keydown")[0](arrowEvent);
assert.equal(fakeDocument.activeElement, menu.items[1]);
const homeEvent = createContextEvent({ key: "Home" });
menu.listeners.get("keydown")[0](homeEvent);
assert.equal(fakeDocument.activeElement, menu.items[0]);
const arrowUpEvent = createContextEvent({ key: "ArrowUp" });
menu.listeners.get("keydown")[0](arrowUpEvent);
assert.equal(fakeDocument.activeElement, menu.items[1]);
const endEvent = createContextEvent({ key: "End" });
menu.listeners.get("keydown")[0](endEvent);
assert.equal(fakeDocument.activeElement, menu.items[1]);
const escapeEvent = createContextEvent({ key: "Escape" });
menu.listeners.get("keydown")[0](escapeEvent);
assert.equal(fakeDocument.menu, null);
assert.equal(fakeDocument.activeElement, communication, "Escape должен вернуть фокус кнопке");

communication.listeners.get("contextmenu")[0](createContextEvent());
await fakeDocument.menu.items[1].listeners.get("click")[0]();
assert.equal(calls.at(-1).action, "communication");
assert.equal(calls.at(-1).messageKey, "note3");
assert.equal(calls.at(-1).recipientMode, "system");

communication.listeners.get("contextmenu")[0](createContextEvent());
await fakeDocument.menu.items[0].listeners.get("click")[0]();
assert.equal(calls.at(-1).action, "communication");
assert.equal(calls.at(-1).recipientMode, "student");

communication.listeners.get("keydown")[0](createContextEvent({ key: "ContextMenu" }));
assert.ok(fakeDocument.menu, "Клавиша контекстного меню должна открывать выбор получателя");
const tabEvent = createContextEvent({ key: "Tab" });
fakeDocument.menu.listeners.get("keydown")[0](tabEvent);
assert.equal(tabEvent.prevented, 1);
assert.equal(fakeDocument.menu, null);
assert.equal(fakeDocument.activeElement, communication);

communication.disabled = true;
communication.listeners.get("contextmenu")[0](createContextEvent());
assert.equal(fakeDocument.menu, null, "Для заблокированной кнопки меню не открывается");
communication.disabled = false;
communication.setAttribute("aria-disabled", "true");
communication.listeners.get("keydown")[0](createContextEvent({ key: "ContextMenu" }));
assert.equal(fakeDocument.menu, null, "aria-disabled должен блокировать клавиатурное меню");

const recipientContext = {
  getStudentApplicationsEmailLogin: () => "system@example.test"
};
vm.createContext(recipientContext);
vm.runInContext(
  `${extractBetween("  function resolveServerEmailRecipient", "  async function sendServerEmail")}
   this.resolveServerEmailRecipient = resolveServerEmailRecipient;`,
  recipientContext
);
assert.equal(recipientContext.resolveServerEmailRecipient("person@example.test", null).recipient, "person@example.test");
assert.equal(recipientContext.resolveServerEmailRecipient("person@example.test", { shiftKey: true }).recipient, "system@example.test");
assert.equal(recipientContext.resolveServerEmailRecipient("person@example.test", { shiftKey: true }, "student").recipient, "person@example.test");
assert.equal(recipientContext.resolveServerEmailRecipient("person@example.test", null, "system").recipient, "system@example.test");

const buttonTags = [...appSource.matchAll(/<button\b(?=[^>]*data-action="email-(?:portal-access|employee-portal-access|communication-message)")[^>]*>/gu)]
  .map((match) => match[0]);
assert.equal(buttonTags.length, 4, "Должны быть покрыты четыре места генерации email-кнопок");
buttonTags.forEach((tag) => {
  assert.match(tag, /aria-haspopup="menu"/u);
  assert.match(tag, /aria-expanded="false"/u);
  assert.match(tag, /data-email-recipient-mode="(?:student|employee)"/u);
  assert.match(tag, /Правый щелчок: выбрать получателя/u);
  assert.match(tag, /Shift \+ щелчок: отправить на системный ящик/u);
});
assert.match(buttonTags.find((tag) => /email-employee-portal-access/u.test(tag)), /data-email-recipient-mode="employee"/u);
assert.match(buttonTags.find((tag) => /email-portal-access/u.test(tag)), /data-email-recipient-mode="student"/u);
assert.match(buttonTags.find((tag) => /data-message-key="\$\{item\.key\}"/u.test(tag)), /data-email-recipient-mode="student"/u);
assert.match(buttonTags.find((tag) => /data-message-key="\$\{message\.key\}"/u.test(tag)), /data-email-recipient-mode="employee"/u);

assert.match(appSource, /emailStudentCommunicationMessage\(messageKey, button, event, recipientMode = ""\)/u);
assert.match(appSource, /emailPortalAccessMessage\(event, recipientMode = ""\)/u);
assert.match(appSource, /emailEmployeePortalAccessMessage\(event, recipientMode = ""\)/u);
const emailHandlerSource = extractBetween(
  "  async function emailStudentCommunicationMessage",
  "  const SYSTEM_MAILBOX_EMAIL_BUTTON_SELECTOR"
);
assert.equal(
  [...emailHandlerSource.matchAll(/^\s+recipientMode,\s*$/gmu)].length,
  3,
  "Каждый интерактивный email-handler должен явно передавать выбранного получателя"
);
assert.doesNotMatch(
  emailHandlerSource,
  /confirmText:\s*"Отправить сотруднику письмо/u,
  "Подтверждение не должно противоречить выбору системного ящика"
);
assert.match(appSource, /bindSystemMailboxEmailMenus\(\);/u);
assert.match(appSource, /function render\(\)[\s\S]*?closeSystemMailboxEmailMenu\(\);/u);
assert.match(appSource, /data-system-mailbox-email-menu[\s\S]*?closeSystemMailboxEmailMenu\(\{ restoreFocus: true \}\)/u);

console.log("System mailbox context menu tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

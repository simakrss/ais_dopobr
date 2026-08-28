const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const requestedSource = String(process.env.AIS_TEST_APP_SOURCE || "").trim();
const appPath = requestedSource
  ? path.resolve(process.cwd(), requestedSource)
  : path.resolve(__dirname, "..", "app.js");
const stylesPath = path.resolve(__dirname, "..", "styles.css");
const appSource = fs.readFileSync(appPath, "utf8");
const stylesSource = fs.readFileSync(stylesPath, "utf8");

function extractFunction(name) {
  const start = appSource.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `Не найдена функция ${name}`);
  const bodyStart = appSource.indexOf(") {", start) + 2;
  assert.ok(bodyStart > start, `Не найдено тело функции ${name}`);
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
  throw new Error(`Функция ${name} не завершена`);
}

const studentRenderSource = extractFunction("renderStudentModal");
const contractRenderSource = extractFunction("renderContractModal");
assert.match(studentRenderSource, /class="student-tabs" data-student-tabs/u);
assert.match(contractRenderSource, /class="student-tabs contract-tabs"/u);
const contractTabsIndex = contractRenderSource.indexOf('class="student-tabs contract-tabs"');
const contractMobileActionsIndex = contractRenderSource.indexOf('class="mobile-card-context-actions"');
const contractPaymentPanelIndex = contractRenderSource.indexOf('data-contract-tab-panel="payment"');
const contractPaymentAccountingIndex = contractRenderSource.indexOf("renderEmployeePaymentAccounting(record)");
assert.ok(contractTabsIndex >= 0, "Панель вкладок сотрудника не найдена.");
assert.ok(contractMobileActionsIndex > contractTabsIndex, "Мобильные действия должны располагаться ниже вкладок сотрудника.");
assert.ok(contractPaymentPanelIndex > contractMobileActionsIndex, "Панель оплаты должна располагаться ниже вкладок и мобильных действий.");
assert.ok(contractPaymentAccountingIndex > contractPaymentPanelIndex, "Область учёта выплат должна находиться внутри панели оплаты.");

const stickyRule = stylesSource.match(
  /\.student-modal \.student-tabs\[data-student-tabs\],\s*\.contract-modal \.student-tabs\.contract-tabs\s*\{([^}]*)\}/u
)?.[1] || "";
assert.match(stickyRule, /position:\s*sticky/u);
assert.match(stickyRule, /top:\s*var\(--card-window-sticky-tabs-top,\s*0px\)/u);
assert.match(stickyRule, /z-index:\s*3/u);
assert.match(stickyRule, /background:\s*#fff/u);

const paymentTabsLayoutRule = stylesSource.match(
  /\.contract-modal\.is-payment-tab-active \.student-tabs\.contract-tabs\s*\{([^}]*)\}/u
)?.[1] || "";
assert.match(paymentTabsLayoutRule, /position:\s*static/u);
assert.match(paymentTabsLayoutRule, /top:\s*auto/u);

const headStackingRule = stylesSource.match(
  /\.student-modal-head,\s*\.contract-modal-head\s*\{([^}]*)\}/u
)?.[1] || "";
assert.match(headStackingRule, /z-index:\s*4/u);

const paymentBodyGridRule = stylesSource.match(
  /\.contract-modal\.is-payment-tab-active \.contract-modal-body\s*\{([^}]*)\}/u
)?.[1] || "";
assert.match(paymentBodyGridRule, /grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)/u);

const bindControlsSource = extractFunction("bindCardWindowControls");
assert.match(
  bindControlsSource,
  /bindCardWindowStickyTabs\(cardWindow\);\s*if \(!cardWindow \|\| !dragHandle\) return;/u
);

class FakeStyle {
  constructor() {
    this.values = new Map();
  }

  setProperty(name, value) {
    this.values.set(name, String(value));
  }

  removeProperty(name) {
    this.values.delete(name);
  }

  getPropertyValue(name) {
    return this.values.get(name) || "";
  }
}

function createCard(kind, height = 80) {
  const head = {
    height,
    getBoundingClientRect() {
      return { height: this.height };
    }
  };
  const tabs = {};
  return {
    kind,
    head,
    tabs,
    style: new FakeStyle(),
    matches(selector) {
      return selector === ".student-modal" && this.kind === "student";
    },
    querySelector(selector) {
      if (selector === ":scope > form > .modal-head") return this.head;
      if (selector === "[data-student-tabs]") return this.kind === "student" ? this.tabs : null;
      if (selector === ".contract-tabs") return this.kind === "contract" ? this.tabs : null;
      return null;
    }
  };
}

const observers = [];
class FakeResizeObserver {
  constructor(callback) {
    this.callback = callback;
    this.targets = [];
    this.disconnected = false;
    observers.push(this);
  }

  observe(target) {
    this.targets.push(target);
  }

  disconnect() {
    this.disconnected = true;
  }
}

let computedPosition = "sticky";
const context = {
  Math,
  ResizeObserver: FakeResizeObserver,
  window: { ResizeObserver: FakeResizeObserver },
  getComputedStyle() {
    return { position: computedPosition };
  }
};
vm.createContext(context);
vm.runInContext(
  `let cardWindowStickyTabsResizeObserver = null;
   ${extractFunction("syncCardWindowStickyTabsOffset")}
   ${extractFunction("bindCardWindowStickyTabs")}
   this.syncOffset = syncCardWindowStickyTabsOffset;
   this.bindStickyTabs = bindCardWindowStickyTabs;
   this.getStickyTabsObserver = () => cardWindowStickyTabsResizeObserver;`,
  context
);

const studentCard = createCard("student", 85.2);
context.syncOffset(studentCard);
assert.equal(studentCard.style.getPropertyValue("--card-window-sticky-tabs-top"), "86px");

computedPosition = "relative";
context.syncOffset(studentCard);
assert.equal(studentCard.style.getPropertyValue("--card-window-sticky-tabs-top"), "0px");

computedPosition = "sticky";
context.bindStickyTabs(studentCard);
const firstObserver = context.getStickyTabsObserver();
assert.ok(firstObserver instanceof FakeResizeObserver);
assert.deepEqual(firstObserver.targets, [studentCard, studentCard.head]);
studentCard.head.height = 99.1;
firstObserver.callback();
assert.equal(studentCard.style.getPropertyValue("--card-window-sticky-tabs-top"), "100px");

const contractCard = createCard("contract", 64);
context.bindStickyTabs(contractCard);
const secondObserver = context.getStickyTabsObserver();
assert.equal(firstObserver.disconnected, true);
assert.notEqual(secondObserver, firstObserver);
assert.deepEqual(secondObserver.targets, [contractCard, contractCard.head]);
assert.equal(contractCard.style.getPropertyValue("--card-window-sticky-tabs-top"), "64px");

context.bindStickyTabs(null);
assert.equal(secondObserver.disconnected, true);
assert.equal(context.getStickyTabsObserver(), null);

const incompleteCard = createCard("student", 40);
incompleteCard.tabs = null;
incompleteCard.style.setProperty("--card-window-sticky-tabs-top", "40px");
context.syncOffset(incompleteCard);
assert.equal(incompleteCard.style.getPropertyValue("--card-window-sticky-tabs-top"), "");

console.log("Card tabs sticky tests passed.");

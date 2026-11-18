"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "..", "auth-bootstrap.js"), "utf8");

function extractFunction(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `Не найдена функция ${name}.`);
  const bodyStart = source.indexOf(") {", start) + 2;
  assert.ok(bodyStart > start, `Не найдено тело функции ${name}.`);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
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
      if (depth === 0) return source.slice(start, index + 1).replace(/^  /gmu, "");
    }
  }
  throw new Error(`Функция ${name} не завершена.`);
}

class FakeElement {
  constructor(selectors = []) {
    this.selectors = new Set(selectors);
  }

  matches(selector) {
    return selector.split(",").some((part) => this.selectors.has(part.trim()));
  }
}

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
}

function clickEvent(target, detail = 1) {
  return {
    target,
    detail,
    defaultPrevented: false,
    immediatePropagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.immediatePropagationStopped = true; }
  };
}

const document = new FakeEventTarget();
const window = new FakeEventTarget();
const context = {
  document,
  window,
  Element: FakeElement,
  Math
};
vm.createContext(context);
vm.runInContext(`
  const DISMISSIBLE_MODAL_BACKDROP_SELECTOR = ".modal-backdrop, .partner-modal-backdrop, [data-documents-backdrop]";
  let modalBackdropPointerCandidate = null;
  let confirmedModalBackdropClick = null;
  ${extractFunction("getDismissibleModalBackdrop")}
  ${extractFunction("resetModalBackdropPointerIntent")}
  ${extractFunction("installModalBackdropCloseGuard")}
  installModalBackdropCloseGuard();
`, context);

const backdrop = new FakeElement([".modal-backdrop"]);
const partnerBackdrop = new FakeElement([".partner-modal-backdrop", "[data-documents-backdrop]"]);
const input = new FakeElement(["input"]);

document.dispatch("pointerdown", { target: input, button: 0, isPrimary: true, pointerId: 1, clientX: 20, clientY: 20 });
document.dispatch("pointerup", { target: backdrop, pointerId: 1, clientX: 180, clientY: 80 });
const selectionDragClick = clickEvent(backdrop);
document.dispatch("click", selectionDragClick);
assert.equal(selectionDragClick.defaultPrevented, true, "Выделение из поля не должно закрывать окно через фон.");
assert.equal(selectionDragClick.immediatePropagationStopped, true);

document.dispatch("pointerdown", { target: backdrop, button: 0, isPrimary: true, pointerId: 2, clientX: 40, clientY: 40 });
document.dispatch("pointerup", { target: backdrop, pointerId: 2, clientX: 42, clientY: 42 });
const explicitBackdropClick = clickEvent(backdrop);
document.dispatch("click", explicitBackdropClick);
assert.equal(explicitBackdropClick.defaultPrevented, false, "Обычный короткий щелчок по фону должен закрывать окно.");

document.dispatch("pointerdown", { target: backdrop, button: 0, isPrimary: true, pointerId: 3, clientX: 10, clientY: 10 });
document.dispatch("pointerup", { target: backdrop, pointerId: 3, clientX: 30, clientY: 10 });
const backdropDragClick = clickEvent(backdrop);
document.dispatch("click", backdropDragClick);
assert.equal(backdropDragClick.defaultPrevented, true, "Перетаскивание по фону не должно считаться щелчком закрытия.");

document.dispatch("pointerdown", { target: partnerBackdrop, button: 0, isPrimary: true, pointerId: 4, clientX: 50, clientY: 50 });
window.dispatch("blur", {});
const blurredClick = clickEvent(partnerBackdrop);
document.dispatch("click", blurredClick);
assert.equal(blurredClick.defaultPrevented, true, "Потеря фокуса во время жеста должна отменять закрытие окна.");

const programmaticClick = clickEvent(backdrop, 0);
document.dispatch("click", programmaticClick);
assert.equal(programmaticClick.defaultPrevented, false, "Программное закрытие должно оставаться доступным.");

const ordinaryControlClick = clickEvent(input);
document.dispatch("click", ordinaryControlClick);
assert.equal(ordinaryControlClick.defaultPrevented, false, "Обычные элементы формы не должны блокироваться защитой.");

assert.match(source, /installModalBackdropCloseGuard\(\);\s*initialize\(\)\.catch/u);
console.log("Modal backdrop close guard tests passed.");

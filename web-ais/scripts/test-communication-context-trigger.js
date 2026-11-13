"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
function extract(name) {
  const start = app.indexOf(`  function ${name}(`);
  const next = /\n  (?:async )?function /gu;
  next.lastIndex = start + 1;
  const end = next.exec(app)?.index;
  assert.ok(start >= 0 && end > start, name);
  return app.slice(start, end);
}
assert.match(css, /\.communication-message-menu\s*\{[^}]*display:\s*none;/u);
assert.doesNotMatch(css, /\.communication-message-card:(?:hover|focus-within)\s+\.communication-message-menu/u);
const popupSource = extract("showFieldCopyPopup");
const moveStart = popupSource.indexOf("    const communicationMenu =");
const moveEnd = popupSource.indexOf('    const focusMenuItem =', moveStart);
assert.ok(moveStart > 0 && moveEnd > moveStart);
class Element {
  constructor(action = "") { this.dataset = {action}; this.children = []; this.listeners = {}; this.attributes = {}; }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  dispatch(name, event = {}) { for (const callback of this.listeners[name] || []) callback({target: this, ...event}); }
  setAttribute(name, value) { this.attributes[name] = value; }
  appendChild(child) { if (child.parent) child.parent.children = child.parent.children.filter(item => item !== child); child.parent = this; this.children.push(child); }
  insertBefore(child, before) { this.appendChild(child); this.children.pop(); this.children.splice(this.children.indexOf(before), 0, child); }
  querySelectorAll() { return [...this.children]; }
  querySelector(selector) { return this.children.find(item => selector.includes(`'${item.dataset.action}'`)); }
  contains(target) { return this.children.includes(target); }
  remove() { this.removed = true; }
  focus() { this.focused = true; }
}
for (const entity of ["students", "contracts"]) {
  const sourceMenu = new Element();
  const actions = ["copy", "edit", "restore", "email"].map(action => new Element(`${action}-communication-message`));
  actions.forEach(button => sourceMenu.appendChild(button));
  let clicks = 0;
  actions[1].addEventListener("click", () => clicks++);
  const control = new Element(); control.dataset.communicationMessage = entity === "students" ? "note1" : "message1";
  const card = new Element();
  card.querySelector = selector => selector === ".communication-message-menu" ? sourceMenu : control;
  control.closest = () => card;
  let opened = 0, activePopup;
  const form = {querySelectorAll: selector => selector === ".communication-message-card" ? [card] : [control]};
  const context = vm.createContext({
    document: {getElementById: () => form, querySelector: () => activePopup, removeEventListener() {}},
    bindCardFormulaRecalculation() {}, isCopyableControl: () => true, handleFieldCopyPopupOutside() {},
    showFieldCopyPopup: () => opened++, control
  });
  vm.runInContext(extract("enhanceCopyableFields") + extract("hideFieldCopyPopup"), context);
  context.enhanceCopyableFields(); context.enhanceCopyableFields();
  for (const target of [card, control]) {
    for (const name of ["mouseenter", "pointerover", "focus", "focusin", "click", "input"]) target.dispatch(name);
    assert.equal(opened, 0, `${entity}: hover/focus/typing/left-click must not open a menu`);
  }
  for (const target of [card, control]) {
    let prevented = false, stopped = false;
    target.dispatch("contextmenu", {clientX: 20, clientY: 30, preventDefault() {prevented = true;}, stopPropagation() {stopped = true;}});
    assert.ok(prevented && stopped);
  }
  assert.equal(opened, 2, "Exactly one binding per card/control");
  for (let attempt = 0; attempt < 3; attempt++) {
    const popup = new Element(); activePopup = popup;
    popup.appendChild(new Element("copy-field-value")); popup.appendChild(new Element("paste-field-value"));
    popup.fieldCopyPopupReturnTarget = control;
    context.popup = popup;
    vm.runInContext(`{${popupSource.slice(moveStart, moveEnd)}}`, context);
    assert.deepEqual(popup.children.map(button => button.dataset.action), ["copy-field-value", "edit-communication-message", "restore-communication-message", "email-communication-message", "paste-field-value"]);
    assert.equal(sourceMenu.children.length, 1, "No duplicate copy action");
    assert.equal(actions[1].listeners.focus, undefined, "Reopening does not accumulate focus handlers on moved buttons");
    actions[1].dispatch("click"); popup.dispatch("click", {target: actions[1]});
    assert.equal(popup.removed, true);
    assert.deepEqual(sourceMenu.children, actions, "All original action nodes and their handlers return to the hidden source");
  }
  assert.equal(clicks, 3, "Existing actions still run once after repeated reopen");
}
console.log("Communications: no hover/focus/left-click menu; right-click on both cards, single binding, actions preserved, repeat open/close — OK");

if (process.argv.includes("--serve")) {
  const functions = ["enhanceCopyableFields", "showFieldCopyPopup", "hideFieldCopyPopup", "handleFieldCopyPopupOutside"].map(extract).join("\n");
  const cards = ["Слушатель", "Сотрудник"].map((label, index) => `<article class="communication-message-card"><div class="communication-message-head"><strong>${label}</strong></div><textarea name="note${index}" data-communication-message="note${index}" readonly>Тестовое сообщение. Наведение, фокус и обычный щелчок не открывают меню.</textarea><div class="communication-message-menu" role="menu">${["copy", "edit", "restore", "email"].map((action, i) => `<button type="button" data-action="${action}-communication-message">${["Копировать", "Редактировать", "Восстановить", "Отправить по почте"][i]}</button>`).join("")}</div></article>`).join("");
  const server = require("node:http").createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", request.url === "/styles.css" ? "text/css; charset=utf-8" : "text/html; charset=utf-8");
    if (request.url === "/styles.css") return response.end(css);
    response.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Коммуникации — проверка меню</title><link rel="stylesheet" href="/styles.css"><body style="padding:24px"><h1>Коммуникации — тестовые сообщения</h1><form id="recordForm"><div class="communication-message-grid">${cards}</div></form><p id="result">Ни одного действия не выполнено</p><script>
      const clamp=(v,min,max)=>Math.max(min,Math.min(max,v)), escapeHtml=String, lastKnownClipboardText='';
      const bindCardFormulaRecalculation=()=>{}, isCopyableControl=()=>true, initializeFieldControlHistory=()=>{}, hideStudentDocumentRecognitionFieldMenu=()=>{};
      const isFieldEditHistoryControl=()=>false,getCardFieldFormulaBinding=()=>({}),canUndoFieldControl=()=>false,canRedoFieldControl=()=>false,renderCommunicationActionIcon=()=>'';
      const canPasteControlValue=()=>false,readFieldClipboardText=async()=>'', getControlCopyValue=c=>c.value, copyTextToClipboard=()=>{document.getElementById('result').textContent='Копирование';};
      const openCardFieldFormulaSettings=()=>{document.getElementById('result').textContent='Редактирование формулы';};
      ${functions}
      document.querySelectorAll('.communication-message-menu button').forEach(b=>{const textarea=b.closest('.communication-message-card').querySelector('textarea');b.addEventListener('click',()=>{document.getElementById('result').textContent=b.textContent;if(b.dataset.action==='edit-communication-message'){textarea.readOnly=false;textarea.focus();}});});
      enhanceCopyableFields();
    </script></body></html>`);
  });
  server.listen(0, "127.0.0.1", () => console.log(`Communication menu fixture: http://127.0.0.1:${server.address().port}/`));
}

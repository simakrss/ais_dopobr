"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

function extractFunction(name) {
  const start = appSource.search(new RegExp(`^  (?:async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, name);
  const end = appSource.indexOf("\n  }", start);
  return appSource.slice(start, end + 4);
}

const menuCases = [
  ["data-field-copy-popup", "hideFieldCopyPopup", "handleFieldCopyPopupOutside", "fieldCopyPopupReturnTarget"],
  ["data-student-applications-import-context-menu", "closeStudentApplicationsImportContextMenu", "closeStudentApplicationsImportContextMenuOnOutsidePointer", "studentApplicationsImportContextMenuOpener"],
  ["data-system-mailbox-email-menu", "closeSystemMailboxEmailMenu", "closeSystemMailboxEmailMenuOnOutsidePointer", "systemMailboxEmailOpener"],
  ["data-messenger-preference-menu", "closeMessengerPreferenceMenu", "closeMessengerPreferenceMenuOnOutsidePointer", "messengerPreferenceOpener"],
  ["data-nav-item-menu", "closeNavItemMenu", "closeNavItemMenuOnOutsideClick"],
  ["data-orderable-tab-menu", "closeOrderableTabMenu", "closeOrderableTabMenuOnOutsideClick"],
  ["data-student-document-recognition-field-menu", "hideStudentDocumentRecognitionFieldMenu", "closeStudentDocumentRecognitionFieldMenuOnOutsideClick"],
  ["data-communication-template-field-menu", "hideCommunicationTemplateFieldMenu", "closeCommunicationTemplateFieldMenuOnOutsideClick"],
  ["data-student-document-action-menu", "closeStudentDocumentActionMenu", "closeStudentDocumentActionMenuOnOutsideClick"]
];
const functions = [
  "createAisHistoryState", "writeAisHistoryState", "restoreCancelledAisHistoryNavigation",
  "returnToPreviousAisScreen", "bindStudentStatusHistoryNavigation",
  "closeContextMenuBeforeHistoryNavigation", "handleAisHistoryNavigation",
  ...menuCases.map((entry) => entry[1])
].map(extractFunction).join("\n");
const callbacks = menuCases.map((entry) => entry[2]).concat([
  "closeStudentApplicationsImportContextMenuOnViewportChange",
  "closeSystemMailboxEmailMenuOnViewportChange", "closeMessengerPreferenceMenuOnViewportChange"
]);

function createHarness() {
  const nodes = [];
  const removedListeners = [];
  const calls = { prompt: 0, save: 0, settings: 0, render: 0 };
  const form = { value: "Несохранённый текст", selectionStart: 3, selectionEnd: 9, scrollTop: 72 };
  class Element {
    constructor(attribute) { this.attribute = attribute; this.isConnected = true; this.focusCount = 0; }
    matches(selector) { return selector.split(",").some((part) => part.trim() === `[${this.attribute}]`); }
    getClientRects() { return this.hidden || this.displayNone ? [] : [{}]; }
    remove() { this.isConnected = false; }
    setAttribute(name, value) { this[name] = value; }
    focus() { this.focusCount++; }
  }
  const stack = [null];
  let index = 0;
  let popstate;
  const context = {
    Element, state: { view: "registry", modal: null }, current: { view: "registry", modal: null },
    aisHistoryNavigationBound: false, aisHistoryNavigationRestoring: false,
    aisHistoryNavigationCloseModalRequested: false, aisHistoryNavigationDiscardApproved: false,
    recordFormSavePending: false, documentTemplateSavePending: false, profileClosePending: false,
    isDatabaseDemoMode: () => false,
    sanitizeAisNavigationSnapshotForDemo: (snapshot) => snapshot,
    captureAisNavigationSnapshot: () => ({ ...context.current }),
    getComputedStyle: (node) => ({ visibility: node.visibility || "visible" }),
    document: {
      querySelectorAll: (selector) => nodes.filter((node) => node.isConnected && node.matches(selector)),
      querySelector: (selector) => nodes.find((node) => node.isConnected && node.matches(selector)),
      getElementById: () => form,
      removeEventListener: (...args) => removedListeners.push(args)
    },
    window: {
      location: { href: "http://localhost/test" },
      history: {
        get state() { return stack[index]; },
        pushState(value) { stack.splice(++index); stack.push(value); },
        replaceState(value) { stack[index] = value; },
        async back() { if (index > 0) await popstate({ state: stack[--index] }); }
      },
      addEventListener: (type, fn) => { if (type === "popstate") popstate = fn; },
      removeEventListener: (...args) => removedListeners.push(args)
    },
    hasUnsavedFormChanges: () => Boolean(context.state.modal?.hasDraftChanges),
    chooseUnsavedChangesAction: async () => { calls.prompt++; return "cancel"; },
    saveRecordFormBeforeContinuation: async () => { calls.save++; return "saved"; },
    savePendingSettingsBeforeExit: async () => { calls.settings++; return true; },
    restoreAisNavigationSnapshot: async (snapshot) => { calls.render++; context.current = snapshot; }
  };
  callbacks.forEach((name) => { context[name] = function callback() {}; });
  vm.createContext(context);
  vm.runInContext(functions, context);
  context.bindStudentStatusHistoryNavigation();
  return {
    context, calls, form, stack, removedListeners,
    openMenu(entry, options = {}) {
      const menu = Object.assign(new Element(entry[0]), options);
      if (entry[3]) {
        menu[entry[3]] = new Element("opener");
        if (entry[0] === "data-field-copy-popup") menu.fieldCopyPopupOpener = menu[entry[3]];
      }
      nodes.push(menu);
      return menu;
    },
    openCard() {
      context.current = { view: "registry", modal: { config: "students", id: "qa" } };
      context.state.modal = { hasDraftChanges: true };
      context.writeAisHistoryState(context.current);
    }
  };
}

async function test() {
  for (const entry of menuCases) {
    const h = createHarness();
    h.openCard();
    const menu = h.openMenu(entry);
    const before = JSON.stringify(h.form);
    await h.context.window.history.back();
    assert.equal(menu.isConnected, false, `${entry[0]} must close`);
    assert.equal(h.context.current.modal.id, "qa", "Card must stay open");
    assert.equal(JSON.stringify(h.form), before, "Text, selection and scroll must stay unchanged");
    assert.deepEqual(h.calls, { prompt: 0, save: 0, settings: 0, render: 0 });
    assert.equal(h.stack.length, 3, "Closing menus must not accumulate history entries");
    assert.ok(h.removedListeners.some((args) => args[1] === h.context[entry[2]]), "Real closer cleans up its listener");
    if (entry[3]) assert.equal(menu[entry[3]].focusCount, 1, "Focus returns without scrolling");
    if (entry[0] === "data-field-copy-popup") assert.equal(menu.fieldCopyPopupOpener["aria-expanded"], "false");
    await h.context.window.history.back();
    assert.equal(h.calls.prompt, 1, "Next Back uses the ordinary unsaved-changes guard");
    assert.equal(h.context.current.modal.id, "qa", "Cancelling preserves the card");
    h.context.state.modal.hasDraftChanges = false;
    await h.context.window.history.back();
    assert.equal(h.context.current.modal, null, "Next confirmed navigation returns to registry");
    assert.equal(h.calls.render, 1);
  }

  for (const pending of ["recordFormSavePending", "documentTemplateSavePending", "profileClosePending"]) {
    const h = createHarness();
    h.context[pending] = true;
    h.context.aisHistoryNavigationCloseModalRequested = true;
    h.context.aisHistoryNavigationDiscardApproved = true;
    const menu = h.openMenu(menuCases[0]);
    await h.context.window.history.back();
    assert.equal(menu.isConnected, false, "Menu also closes while saving is pending");
    assert.equal(h.context.aisHistoryNavigationCloseModalRequested, false);
    assert.equal(h.context.aisHistoryNavigationDiscardApproved, false);
    assert.deepEqual(h.calls, { prompt: 0, save: 0, settings: 0, render: 0 });
  }
  const h = createHarness();
  for (let attempt = 0; attempt < 5; attempt++) {
    const lower = h.openMenu(menuCases[0]);
    const upper = h.openMenu(menuCases[1]);
    h.openMenu(menuCases[2], { hidden: true });
    h.openMenu(menuCases[3], { displayNone: true });
    h.openMenu(menuCases[4], { visibility: "hidden" });
    await h.context.window.history.back();
    assert.equal(upper.isConnected, false);
    assert.equal(lower.isConnected, true, "Only the top visible menu closes");
    await h.context.window.history.back();
    assert.equal(lower.isConnected, false);
    assert.equal(h.stack.length, 2, "Initial history guard survives repeated menus");
  }
  await h.context.window.history.back();
  assert.equal(h.calls.render, 1, "Hidden menus do not block normal history navigation");
  console.log("context-menu Back: 9 menu types, real cleanup, focus, unsaved data, repeated Back, pending saves — OK");
}

function serveBrowserFixture() {
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Контекстное меню — проверка Назад</title>
    <style>body{font:16px sans-serif;padding:20px}button,input,select{font:inherit;margin:8px;padding:8px}[role=menu]{padding:20px;background:#dff3f0;border:1px solid teal}#recordForm{height:220px;overflow:auto}</style>
    <h1>Проверка контекстных меню</h1><p id="screen">Реестр</p>
    <button id="card">Открыть карточку</button>
    <form id="recordForm"><label>Примечание <input id="note" value="Несохранённый текст"></label><div style="height:500px"></div></form>
    <label>Меню <select id="kind">${menuCases.map(([attribute]) => `<option>${attribute}</option>`).join("")}</select></label>
    <button id="menu">Открыть меню</button><button id="clean">Отметить сохранённым</button>
    <p id="stats">Запросов сохранения: 0; переходов: 0</p><script>
    let aisHistoryNavigationBound=false, aisHistoryNavigationRestoring=false,
      aisHistoryNavigationCloseModalRequested=false, aisHistoryNavigationDiscardApproved=false;
    let recordFormSavePending=false, documentTemplateSavePending=false, profileClosePending=false;
    const state={modal:null}; let current={view:'registry',modal:null}; let prompts=0,renders=0;
    const isDatabaseDemoMode=()=>false, sanitizeAisNavigationSnapshotForDemo=s=>s,
      captureAisNavigationSnapshot=()=>({...current}), hasUnsavedFormChanges=()=>Boolean(state.modal?.hasDraftChanges);
    function stats(){document.getElementById('stats').textContent='Запросов сохранения: '+prompts+'; переходов: '+renders;}
    async function chooseUnsavedChangesAction(){prompts++;stats();return 'cancel';}
    async function saveRecordFormBeforeContinuation(){throw new Error('Unexpected save');}
    async function savePendingSettingsBeforeExit(){return true;}
    async function restoreAisNavigationSnapshot(s){current=s;renders++;document.getElementById('screen').textContent=s.modal?'Карточка':'Реестр';stats();}
    ${callbacks.map((name) => `function ${name}(){}`).join("\n")}
    ${functions}
    bindStudentStatusHistoryNavigation();
    document.getElementById('card').onclick=()=>{current={view:'registry',modal:{config:'students',id:'qa'}};state.modal={hasDraftChanges:true};writeAisHistoryState(current);document.getElementById('screen').textContent='Карточка';};
    document.getElementById('menu').onclick=()=>{const menu=document.createElement('div');menu.setAttribute(document.getElementById('kind').value,'');menu.setAttribute('role','menu');menu.textContent='Контекстное меню открыто';menu.fieldCopyPopupReturnTarget=document.getElementById('note');menu.fieldCopyPopupOpener=document.getElementById('menu');document.body.append(menu);};
    document.getElementById('clean').onclick=()=>{if(state.modal)state.modal.hasDraftChanges=false;};
    </script></html>`;
  const server = require("node:http").createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
  });
  server.listen(0, "127.0.0.1", () => console.log(`Context-menu fixture: http://127.0.0.1:${server.address().port}/`));
}

test().then(() => { if (process.argv.includes("--serve")) serveBrowserFixture(); }).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

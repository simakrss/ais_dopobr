"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");

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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function readAttribute(tag, name) {
  const match = new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, "u").exec(tag);
  return match ? String(match[1] ?? match[2] ?? "") : "";
}

function visibleText(html) {
  return String(html || "")
    .replace(/<[^>]*>/gu, " ")
    .replace(/&quot;/gu, '"')
    .replace(/&#0?39;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&")
    .replace(/\s+/gu, " ")
    .trim();
}

class FakeControl {
  constructor(action, text = "") {
    this.dataset = { action };
    this.textContent = text;
    this.focusCount = 0;
    this.isConnected = true;
  }

  closest(selector) {
    return selector === "[data-action]" ? this : null;
  }

  focus() {
    this.focusCount += 1;
  }
}

class FakeBackdrop {
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument;
    this.className = "";
    this.dataset = {};
    this.listeners = new Map();
    this.controls = new Map();
    this.isConnected = false;
    this.removed = false;
    this._innerHTML = "";
  }

  set innerHTML(value) {
    this._innerHTML = String(value || "");
    this.controls.clear();
    const pattern = /<button\b([^>]*\bdata-action=(?:"[^"]+"|'[^']+')[^>]*)>([\s\S]*?)<\/button>/gu;
    for (const match of this._innerHTML.matchAll(pattern)) {
      const action = readAttribute(match[1], "data-action");
      this.controls.set(action, new FakeControl(action, visibleText(match[2])));
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  querySelector(selector) {
    const match = /\[data-action=(?:"([^"]+)"|'([^']+)')\]/u.exec(selector);
    if (!match) return null;
    return this.controls.get(String(match[1] ?? match[2] ?? "")) || null;
  }

  contains(element) {
    return [...this.controls.values()].includes(element);
  }

  click(target) {
    const listener = this.listeners.get("click");
    assert.equal(typeof listener, "function", "На диалоге нет обработчика click");
    listener({ target });
  }

  remove() {
    this.removed = true;
    this.isConnected = false;
    this.controls.forEach((control) => { control.isConnected = false; });
    if (this.ownerDocument.currentBackdrop === this) this.ownerDocument.currentBackdrop = null;
  }
}

class FakeDocument {
  constructor() {
    this.currentBackdrop = null;
    this.activeElement = null;
    this.body = {
      appendChild: (element) => {
        element.isConnected = true;
        this.currentBackdrop = element;
      }
    };
  }

  createElement(tagName) {
    assert.equal(tagName, "div");
    return new FakeBackdrop(this);
  }
}

function loadDialog() {
  const document = new FakeDocument();
  const context = {
    document,
    escapeHtml,
    Promise,
    String,
    queueMicrotask(callback) {
      callback();
    }
  };
  vm.createContext(context);
  vm.runInContext(`
    let unsavedChangesDialogSession = null;
    ${extractFunction("chooseUnsavedChangesAction")}
    this.chooseUnsavedChangesAction = chooseUnsavedChangesAction;
  `, context);
  return { document, choose: context.chooseUnsavedChangesAction };
}

function getControl(backdrop, action) {
  const control = backdrop.querySelector(`[data-action='${action}']`);
  assert.ok(control, `Не найдена кнопка ${action}`);
  return control;
}

async function resolveThroughButton(action, expectedDecision) {
  const { document, choose } = loadDialog();
  const previousFocus = new FakeControl("source");
  document.activeElement = previousFocus;
  const resultPromise = choose({
    title: "Проверка черновика",
    message: "Сохранить тестовые изменения?"
  });
  const backdrop = document.currentBackdrop;
  assert.ok(backdrop, "Диалог не добавлен в document.body");
  backdrop.click(getControl(backdrop, action));
  assert.equal(await resultPromise, expectedDecision);
  assert.equal(backdrop.removed, true, "Завершённый диалог должен быть удалён");
  assert.equal(
    previousFocus.focusCount,
    expectedDecision === "cancel" ? 1 : 0,
    "Фокус должен возвращаться только при отмене закрытия"
  );
}

async function main() {
  {
    const { document, choose } = loadDialog();
    const resultPromise = choose();
    const backdrop = document.currentBackdrop;
    assert.ok(backdrop);
    assert.match(backdrop.className, /\bunsaved-changes-dialog-backdrop\b/u);
    assert.equal(Object.hasOwn(backdrop.dataset, "unsavedChangesDialog"), true);
    assert.match(backdrop.innerHTML, /role="alertdialog"/u);
    assert.match(backdrop.innerHTML, /aria-modal="true"/u);
    assert.match(backdrop.innerHTML, /aria-labelledby="unsavedChangesDialogTitle"/u);
    assert.match(backdrop.innerHTML, /aria-describedby="unsavedChangesDialogMessage"/u);
    assert.match(visibleText(backdrop.innerHTML), /Есть несохранённые изменения/u);
    assert.equal(getControl(backdrop, "save-unsaved-changes").textContent, "Сохранить");
    assert.equal(getControl(backdrop, "discard-unsaved-changes").textContent, "Не сохранять");
    assert.equal(getControl(backdrop, "cancel-unsaved-changes").textContent, "×");
    assert.equal(getControl(backdrop, "save-unsaved-changes").focusCount, 1, "По умолчанию фокус должен получать безопасный вариант «Сохранить»");
    backdrop.cancelUnsavedChangesDialog();
    assert.equal(await resultPromise, "cancel");
  }

  await resolveThroughButton("save-unsaved-changes", "save");
  await resolveThroughButton("discard-unsaved-changes", "discard");
  await resolveThroughButton("cancel-unsaved-changes", "cancel");

  {
    const { document, choose } = loadDialog();
    const resultPromise = choose();
    const backdrop = document.currentBackdrop;
    backdrop.click(backdrop);
    assert.equal(await resultPromise, "cancel", "Щелчок по фону должен отменять закрытие исходного окна");
  }

  {
    const { document, choose } = loadDialog();
    const firstPromise = choose({ title: "Первый диалог" });
    const backdrop = document.currentBackdrop;
    const saveButton = getControl(backdrop, "save-unsaved-changes");
    const secondPromise = choose({ title: "Второй диалог" });
    assert.notEqual(secondPromise, firstPromise, "Повторный обработчик не должен получить решение первого и выполнить действие дважды");
    assert.equal(document.currentBackdrop, backdrop);
    assert.equal(saveButton.focusCount, 2, "Повторный запрос должен вернуть фокус в диалог");
    backdrop.click(getControl(backdrop, "discard-unsaved-changes"));
    assert.equal(await firstPromise, "discard");
    assert.equal(await secondPromise, "cancel");
  }

  assert.match(
    appSource,
    /function closeTopmostWindowByEscape\(\)[\s\S]*?\[data-unsaved-changes-dialog\][\s\S]*?cancelUnsavedChangesDialog\?\.\(\)/u,
    "Escape должен выбирать «Отмена», а не закрывать исходное окно"
  );
  assert.match(appSource, /async function saveSettingsBeforeExit\([\s\S]*?chooseUnsavedChangesAction\([\s\S]*?decision === "save"[\s\S]*?decision === "cancel"/u);
  assert.match(appSource, /async function saveAdminSettingsBeforeExit\([\s\S]*?chooseUnsavedChangesAction\([\s\S]*?decision === "save"[\s\S]*?decision === "cancel"/u);
  assert.match(appSource, /async function closeDocumentTemplateSettings\([\s\S]*?chooseUnsavedChangesAction\([\s\S]*?decision === "save"[\s\S]*?decision === "cancel"/u);
  assert.match(appSource, /let profileClosePending = false;/u);
  assert.match(
    appSource,
    /async function closeProfile\([\s\S]*?if \(profileClosePending\) return false;[\s\S]*?profileClosePending = true;[\s\S]*?finally \{[\s\S]*?profileClosePending = false;/u,
    "Повторное закрытие профиля должно блокироваться до завершения сохранения"
  );
  assert.match(
    appSource,
    /async function openStudentEventEditor\([\s\S]*?!editor\.hidden && editor\.dataset\.eventKey === key[\s\S]*?labelInput\.focus\([\s\S]*?return;/u,
    "Повторное открытие той же строки события не должно затирать введённые данные"
  );
  assert.match(
    appSource,
    /async function saveRecordFormBeforeContinuation\([\s\S]*?recordFormSavePending = true;[\s\S]*?finally \{[\s\S]*?recordFormSavePending = false;/u,
    "Сохранение карточки при закрытии должно блокировать повторное закрытие"
  );
  assert.match(appSource, /async function closeModalWithUnsavedCheck\(\) \{[\s\S]*?if \(recordFormSavePending\) return false;/u);
  assert.match(
    appSource,
    /async function saveContractTemplateFields\([\s\S]*?documentTemplateSavePending = true;[\s\S]*?finally \{[\s\S]*?documentTemplateSavePending = false;/u,
    "Сохранение шаблона при закрытии должно блокировать повторное закрытие"
  );
  assert.match(appSource, /async function closeDocumentTemplateSettings\(\) \{[\s\S]*?if \(documentTemplateSavePending\) return false;/u);
  assert.match(
    appSource,
    /async function deleteStudentEvent\([\s\S]*?if \(!await closeStudentEventEditor\(\)\) return;[\s\S]*?row\.remove\(\)/u,
    "Удаление события должно ждать решения по несохранённым изменениям"
  );
  assert.match(
    appSource,
    /pointermove", async \(event\)[\s\S]*?pending\.type === "events"[\s\S]*?await closeStudentEventEditor\(\)[\s\S]*?if \(!editorClosed\)[\s\S]*?clearPending\(\)/u,
    "Перетаскивание события не должно продолжаться за диалогом несохранённых изменений"
  );
  assert.match(
    appSource,
    /function hasUnsavedDocumentTemplateChanges\([\s\S]*?documents: draftDocuments[\s\S]*?documentTemplateEditOriginal\?\.documents[\s\S]*?captureDocumentsSnapshot\(draftDocuments\)[\s\S]*?captureDocumentsSnapshot\(savedDocuments\)/u,
    "Конструктор документов должен проверять изменения всех шаблонов, а не только активного"
  );
  [
    "async function closeProfile",
    "async function showStudentEventInsertDialog",
    "async function closeStudentEventEditor",
    "async function closeDiscountPicker",
    "async function closeDocumentTemplateLinkDialog"
  ].forEach((signature) => {
    assert.ok(appSource.includes(signature), `Не подключена защита закрытия: ${signature}`);
  });
  [
    "Настройки аттестации не сохранены",
    "Константа оплаты не сохранена",
    "Значение поля не сохранено",
    "Поле шаблона не сохранено",
    "Значение справочника не сохранено"
  ].forEach((title) => {
    assert.ok(appSource.includes(title), `Нет диалога для редактора: ${title}`);
  });
  assert.match(appSource, /function saveRecordFormBeforeContinuation\([\s\S]*?initializeRecordFormSnapshot\(formElement\)/u);
  assert.doesNotMatch(appSource, /Есть несохраненные изменения\. Закрыть без сохранения\?/u);
  assert.doesNotMatch(appSource, /Есть несохранённые изменения записи оплаты\. Закрыть без сохранения\?/u);

  assert.match(stylesSource, /\.unsaved-changes-dialog-backdrop\s*\{[^}]*z-index:\s*13000;/su);
  assert.match(stylesSource, /\.unsaved-changes-dialog\s*\{[^}]*width:\s*min\(520px, 100%\);/su);
  assert.match(stylesSource, /@media \(max-width: 520px\)[\s\S]*?\.unsaved-changes-dialog-actions \.primary-button,[\s\S]*?flex:\s*1 1 calc\(50% - 26px\);/u);

  console.log("Unsaved close dialog checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

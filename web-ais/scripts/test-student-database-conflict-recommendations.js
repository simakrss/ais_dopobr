const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");
const serverSource = fs.readFileSync(path.resolve(__dirname, "..", "app-server.js"), "utf8");

function extractBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Не найден блок ${startMarker}`);
  return source.slice(start, end).replace(/^  /gmu, "");
}

function readAttribute(tag, name) {
  const match = new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, "u").exec(tag);
  return match ? String(match[1] ?? match[2] ?? "") : "";
}

function hasBooleanAttribute(tag, name) {
  return new RegExp(`\\b${name}(?:\\s|=|/?>)`, "u").test(tag);
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  toggle(name, enabled) {
    if (enabled) this.values.add(name);
    else this.values.delete(name);
  }
}

class FakeControl {
  constructor({ action = "", bulk = "", conflictChoice = "", value = "", checked = false } = {}) {
    this.dataset = {};
    if (action) this.dataset.action = action;
    if (bulk) this.dataset.conflictBulk = bulk;
    if (conflictChoice) this.dataset.conflictChoice = conflictChoice;
    this.value = value;
    this.checked = checked;
    this.disabled = false;
    this.focused = false;
  }

  focus() {
    this.focused = true;
  }

  closest(selector) {
    if (selector === "[data-conflict-choice]") {
      return this.dataset.conflictChoice ? this : null;
    }
    if (selector === "[data-conflict-bulk]") {
      return this.dataset.conflictBulk ? this : null;
    }
    const actionMatch = /\[data-action=(?:"([^"]+)"|'([^']+)')\]/u.exec(selector);
    if (actionMatch) {
      const requested = String(actionMatch[1] ?? actionMatch[2] ?? "");
      return this.dataset.action === requested ? this : null;
    }
    return null;
  }
}

class FakeRow {
  constructor(id, html) {
    this.dataset = { conflictRow: id };
    this.classList = new FakeClassList();
    this.select = new FakeControl();
    this.radios = [];
    const inputPattern = /<input\b[^>]*\bdata-conflict-choice=(?:"[^"]+"|'[^']+')[^>]*>/gu;
    for (const match of html.matchAll(inputPattern)) {
      const tag = match[0];
      this.radios.push(new FakeControl({
        conflictChoice: readAttribute(tag, "data-conflict-choice"),
        value: readAttribute(tag, "value"),
        checked: hasBooleanAttribute(tag, "checked")
      }));
    }
  }

  querySelector(selector) {
    if (selector === "[data-conflict-select]") return this.select;
    const choiceMatch = /\[data-conflict-choice\]\[value=(?:"([^"]+)"|'([^']+)')\]/u.exec(selector);
    if (choiceMatch) {
      const value = String(choiceMatch[1] ?? choiceMatch[2] ?? "");
      return this.radios.find((radio) => radio.value === value) || null;
    }
    return null;
  }
}

class FakeBackdrop {
  constructor() {
    this.className = "";
    this.listeners = new Map();
    this.rows = [];
    this.removed = false;
    this.selectAll = new FakeControl();
    this.summary = { textContent: "" };
    this.continueButton = new FakeControl({ action: "continue-sync-conflicts" });
    this.cancelButton = new FakeControl({ action: "cancel-sync-conflicts" });
    this._innerHTML = "";
  }

  set innerHTML(value) {
    this._innerHTML = String(value || "");
    this.rows = [];
    const rowPattern = /<tr\b([^>]*\bdata-conflict-row=(?:"([^"]+)"|'([^']+)')[^>]*)>([\s\S]*?)<\/tr>/gu;
    for (const match of this._innerHTML.matchAll(rowPattern)) {
      this.rows.push(new FakeRow(String(match[2] ?? match[3] ?? ""), match[4]));
    }
    const continueTag = this._innerHTML.match(
      /<button\b[^>]*\bdata-action=(?:"continue-sync-conflicts"|'continue-sync-conflicts')[^>]*>/u
    )?.[0] || "";
    this.continueButton.disabled = hasBooleanAttribute(continueTag, "disabled");
  }

  get innerHTML() {
    return this._innerHTML;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  emit(type, target) {
    const listener = this.listeners.get(type);
    assert.equal(typeof listener, "function", `Не назначен обработчик ${type}`);
    listener({ target });
  }

  querySelector(selector) {
    if (selector === "[data-action='continue-sync-conflicts']") return this.continueButton;
    if (selector === "[data-conflict-summary]") return this.summary;
    if (selector === "[data-conflict-select-all]") return this.selectAll;
    const rowMatch = /\[data-conflict-row=(?:"([^"]+)"|'([^']+)')\]/u.exec(selector);
    if (rowMatch) {
      const id = String(rowMatch[1] ?? rowMatch[2] ?? "");
      return this.rows.find((row) => row.dataset.conflictRow === id) || null;
    }
    return null;
  }

  querySelectorAll(selector) {
    if (selector === "[data-conflict-row]") return this.rows;
    if (selector === "[data-conflict-select]") return this.rows.map((row) => row.select);
    if (selector === "[data-conflict-choice]") return this.rows.flatMap((row) => row.radios);
    if (selector === "[data-conflict-choice]:checked") {
      return this.rows.flatMap((row) => row.radios).filter((radio) => radio.checked);
    }
    return [];
  }

  remove() {
    this.removed = true;
  }
}

class FakeDocument {
  constructor() {
    this.currentBackdrop = null;
    this.listeners = new Map();
    this.body = {
      appendChild: (element) => {
        this.currentBackdrop = element;
      }
    };
  }

  createElement(tagName) {
    assert.equal(tagName, "div");
    return new FakeBackdrop();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function visibleText(html) {
  return String(html || "")
    .replace(/<[^>]*>/gu, " ")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&")
    .replace(/\s+/gu, " ")
    .trim();
}

function loadConflictChooser() {
  const document = new FakeDocument();
  const context = {
    document,
    escapeAttr: escapeHtml,
    escapeHtml,
    queueMicrotask(callback) {
      callback();
    }
  };
  vm.createContext(context);
  const chooserBlock = extractBetween(
    appSource,
    "  function getDownloadFileNameFromResponse",
    "  function getStudentDatabaseSyncFailureDetails"
  );
  vm.runInContext(
    `${chooserBlock}\nthis.chooseStudentDatabaseSyncConflictResolutions = chooseStudentDatabaseSyncConflictResolutions;`,
    context
  );
  return {
    document,
    choose: context.chooseStudentDatabaseSyncConflictResolutions
  };
}

function radio(backdrop, conflictId, value) {
  const row = backdrop.rows.find((item) => item.dataset.conflictRow === conflictId);
  assert.ok(row, `Не найдена строка ${conflictId}`);
  const input = row.radios.find((item) => item.value === value);
  assert.ok(input, `Не найден вариант ${value} для ${conflictId}`);
  return input;
}

async function testRecommendedChoices() {
  const webId = "a".repeat(64);
  const excelId = "b".repeat(64);
  const webReason = "После контрольной точки изменено только значение Web.";
  const excelReason = "После контрольной точки изменено только значение XLSB.";
  const { document, choose } = loadConflictChooser();
  const resultPromise = choose([
    {
      id: webId,
      entity: "Слушатели",
      record: "Иванова [101]",
      field: "Примечание",
      web: "Новое примечание",
      excel: "—",
      recommendedSource: "web",
      recommendationReason: webReason
    },
    {
      id: excelId,
      entity: "Слушатели",
      record: "Петрова [102]",
      field: "Доп. статус",
      web: "обучается",
      excel: "на продление",
      recommendedSource: "excel",
      recommendationReason: excelReason
    }
  ], { completeReconciliation: true });

  const backdrop = document.currentBackdrop;
  assert.ok(backdrop, "Диалог конфликтов не добавлен в документ");
  assert.equal(radio(backdrop, webId, "web").checked, true, "Рекомендация Web должна быть отмечена");
  assert.equal(radio(backdrop, webId, "excel").checked, false);
  assert.equal(radio(backdrop, excelId, "excel").checked, true, "Рекомендация XLSB должна быть отмечена");
  assert.equal(radio(backdrop, excelId, "web").checked, false);
  assert.equal(
    backdrop.continueButton.disabled,
    false,
    "Заполненные рекомендациями строки должны разрешать продолжение"
  );
  assert.match(visibleText(backdrop.innerHTML), /Рекомендуется/iu);
  assert.match(visibleText(backdrop.innerHTML), new RegExp(webReason.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(visibleText(backdrop.innerHTML), new RegExp(excelReason.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));

  const recommendedWeb = radio(backdrop, webId, "web");
  const manualExcel = radio(backdrop, webId, "excel");
  recommendedWeb.checked = false;
  manualExcel.checked = true;
  backdrop.emit("change", manualExcel);
  backdrop.emit("click", backdrop.continueButton);
  const result = JSON.parse(JSON.stringify(await resultPromise));
  assert.deepEqual(result, {
    [webId]: "excel",
    [excelId]: "excel"
  }, "Ручной выбор должен заменить рекомендацию в отправляемом результате");
}

async function testManualChoiceWithoutRecommendation() {
  const conflictId = "c".repeat(64);
  const { document, choose } = loadConflictChooser();
  const resultPromise = choose([{
    id: conflictId,
    entity: "Слушатели",
    record: "Сидорова [103]",
    field: "Телефон",
    web: "111",
    excel: "222"
  }]);
  const backdrop = document.currentBackdrop;
  assert.ok(backdrop);
  assert.equal(radio(backdrop, conflictId, "web").checked, false);
  assert.equal(radio(backdrop, conflictId, "excel").checked, false);
  assert.equal(
    backdrop.continueButton.disabled,
    true,
    "Строка без recommendedSource должна требовать ручного выбора"
  );

  const selectedWeb = radio(backdrop, conflictId, "web");
  selectedWeb.checked = true;
  backdrop.emit("change", selectedWeb);
  assert.equal(backdrop.continueButton.disabled, false);
  backdrop.emit("click", backdrop.continueButton);
  assert.deepEqual(JSON.parse(JSON.stringify(await resultPromise)), {
    [conflictId]: "web"
  });
}

function testEventSettingsDirectionIsNotBypassed() {
  const exportBlock = extractBetween(
    serverSource,
    "async function buildStudentDatabaseExport",
    "async function handleStudentDatabaseExport"
  );
  const resolveDirectionIndex = exportBlock.indexOf("resolveStudentDatabaseSyncDirection({");
  assert.ok(resolveDirectionIndex >= 0, "Не найдено определение направления основной синхронизации");
  assert.match(
    exportBlock,
    /resolveStudentDatabaseEventSettingsSyncDirection\s*\(/u,
    "Настройки событий должны использовать согласованную логику направления"
  );

  const beforeDirection = exportBlock.slice(0, resolveDirectionIndex);
  const earlyComparison = /if\s*\(\s*currentWebEventSettingsHash\s*!==\s*currentExcelEventSettingsHash\s*\)\s*\{([\s\S]{0,2000}?)\n\s*\}/u.exec(
    beforeDirection
  );
  if (!earlyComparison) return;
  const comparisonBody = earlyComparison[1];
  const hasEarlyThrow = /\bthrow\b/u.test(comparisonBody);
  const hasCoordinatedResolution = /recommendedSource|recommendationReason|resolveStudentDatabaseEventSettingsSyncDirection|syncConflicts|conflictResolutions/u.test(
    comparisonBody
  );
  assert.ok(
    !hasEarlyThrow || hasCoordinatedResolution,
    "Раннее расхождение currentWebEventSettingsHash не должно безусловно обходить определение направления"
  );
}

function testMergedResultPreflightsServerSettingsBeforeCommit() {
  const exportBlock = extractBetween(
    serverSource,
    "async function buildStudentDatabaseExport",
    "async function handleStudentDatabaseExport"
  );
  const mergedResultVerification = exportBlock.indexOf("if (directionalMergeResult) {");
  const preflight = exportBlock.indexOf(
    "prepareImportedStudentDatabaseServerSettings({",
    mergedResultVerification
  );
  const deferredCommit = exportBlock.indexOf("const savedResult = downloadOnly", preflight);
  assert.ok(mergedResultVerification >= 0, "Не найдена проверка объединённого результата");
  assert.ok(
    preflight > mergedResultVerification && deferredCommit > preflight,
    "Серверные настройки объединённого XLSB должны проверяться до подготовки commit"
  );
  assert.match(
    exportBlock.slice(preflight, deferredCommit),
    /macroSettings:\s*parsedOutputData\.macroSettings[\s\S]*macroSettingsSecret:\s*parsedOutputData\.macroSettingsSecret/u,
    "Preflight должен проверять фактически сформированные настройки XLSB"
  );
}

async function main() {
  await testRecommendedChoices();
  await testManualChoiceWithoutRecommendation();
  testEventSettingsDirectionIsNotBypassed();
  testMergedResultPreflightsServerSettingsBeforeCommit();
  console.log("Student database conflict recommendation tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

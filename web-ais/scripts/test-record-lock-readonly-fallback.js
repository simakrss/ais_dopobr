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

const lockModeSource = extractBetween(
  "  async function acquireRecordLockForCard",
  "  function getRecordLockModalState"
);
const context = {
  String,
  recordLockEntityType: (configId) => `${configId}-rows`,
  recordLockKey: (entityType, entityId) => `${entityType}:${entityId}`,
  activeRecordLock: null,
  acquireRecordLock: async () => true,
  getRecordLock: () => null,
  releaseRecordLock: async () => {}
};
vm.createContext(context);
vm.runInContext(`${lockModeSource}\nthis.acquireRecordLockForCard = acquireRecordLockForCard;`, context);

(async () => {
  let mode = await context.acquireRecordLockForCard("students", "student-1");
  assert.equal(mode.readOnly, false);

  const foreignLock = { entityType: "students-rows", entityId: "student-1", ownerName: "Редактор" };
  const previousLock = { key: "contracts-rows:contract-1" };
  let releasedLock = null;
  context.activeRecordLock = previousLock;
  context.acquireRecordLock = async (_entityType, _entityId, options) => {
    assert.equal(options.readOnlyFallback, true);
    return false;
  };
  context.getRecordLock = () => foreignLock;
  context.releaseRecordLock = async (lock) => {
    releasedLock = lock;
    context.activeRecordLock = null;
  };
  mode = await context.acquireRecordLockForCard("students", "student-1");
  assert.equal(mode.readOnly, true);
  assert.equal(mode.lock, foreignLock);
  assert.equal(releasedLock, previousLock);

  context.activeRecordLock = null;
  context.getRecordLock = () => null;
  assert.equal(await context.acquireRecordLockForCard("students", "student-1"), null);

  const acquireSource = extractBetween(
    "  async function acquireRecordLock(entityType",
    "  async function acquireDocumentTemplateRecordLock"
  );
  assert.match(acquireSource, /При отмене карточка откроется только для просмотра/u);

  [
    extractBetween("  async function restoreAisNavigationSnapshot", "  async function handleAisHistoryNavigation"),
    extractBetween("  async function openFinanceDetailSource", "  function getFinanceDetailStudentNavigationIds"),
    extractBetween("  async function openStudentCardById", "  async function navigateStudentCard"),
    extractBetween("  async function openProgramCardById", "  async function navigateProgramCard"),
    extractBetween("  async function openContractCardById", "  async function navigateContractCard")
  ].forEach((source) => {
    assert.match(source, /acquireRecordLockForCard/u);
    assert.match(source, /getRecordLockModalState/u);
  });

  const bindEventsSource = extractBetween("  function bindEvents()", "  function enhanceDatePlaceholders");
  assert.match(bindEventsSource, /applyRecordFormReadOnlyMode\(\)/u);
  assert.match(bindEventsSource, /const lockMode = await acquireRecordLockForCard/u);

  const readOnlyUiSource = extractBetween(
    "  function isRecordReadOnlyButtonAllowed",
    "  async function requestSharedRecordLocks"
  );
  assert.match(readOnlyUiSource, /Режим просмотра/u);
  assert.match(readOnlyUiSource, /Запись освободилась/u);
  assert.match(readOnlyUiSource, /Перейти к редактированию/u);
  assert.match(readOnlyUiSource, /form\.dataset\.recordReadonly = "true"/u);
  assert.match(readOnlyUiSource, /control\.readOnly = true/u);
  assert.match(readOnlyUiSource, /control\.disabled = true/u);
  assert.match(readOnlyUiSource, /submitButton\.textContent = "Только просмотр"/u);

  const pollingSource = extractBetween(
    "  async function pollSharedRecordLocks",
    "  function stopRecordLockHeartbeat"
  );
  assert.match(pollingSource, /previousReadOnlyLock && !nextReadOnlyLock/u);
  assert.match(pollingSource, /markReadOnlyRecordLockAvailable\(\)/u);
  assert.match(pollingSource, /markReadOnlyRecordLockBusy\(nextReadOnlyLock\)/u);

  assert.match(stylesSource, /#recordForm\[data-record-readonly="true"\][\s\S]*opacity:\s*1/u);
  assert.match(stylesSource, /\.student-modal\s*>\s*form\[data-record-readonly="true"\][\s\S]*grid-template-rows:\s*auto auto minmax\(0, 1fr\)/u);
  assert.match(stylesSource, /\.record-lock-notice\s*\{[\s\S]*position:\s*fixed/u);

  console.log("Record lock read-only fallback tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

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
  window: {
    AIS_DATABASE_DEMO_MODE: false,
    location: { reload: () => { context.demoReloadCalls += 1; } }
  },
  document: {
    getElementById: () => ({
      replaceChildren: () => {},
      style: {}
    })
  },
  demoReloadCalls: 0,
  stopRecordLockHeartbeat: () => {},
  recordLocks: new Map(),
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

  let demoAcquireCalls = 0;
  context.window.AIS_DATABASE_DEMO_MODE = true;
  context.acquireRecordLock = async () => {
    demoAcquireCalls += 1;
    throw new Error("API блокировок не должен вызываться в деморежиме");
  };
  mode = await context.acquireRecordLockForCard("programs", "program-1");
  assert.equal(mode.readOnly, true);
  assert.equal(mode.demoMode, true);
  assert.equal(demoAcquireCalls, 0);
  context.window.AIS_DATABASE_DEMO_MODE = false;

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
  assert.match(acquireSource, /DEMO_MODE_READ_ONLY/u);

  const demoClassNames = new Set();
  let demoAlertCalls = 0;
  const demoAcquireContext = {
    String,
    Boolean,
    window: { AIS_DATABASE_DEMO_MODE: false },
    document: { documentElement: { classList: { add: (value) => demoClassNames.add(value) } } },
    isDatabaseDemoMode: () => false,
    recordLockKey: (entityType, entityId) => `${entityType}:${entityId}`,
    recordLockClientId: "demo-test-client",
    activeRecordLock: null,
    recordLocks: new Map(),
    stopRecordLockHeartbeat: () => {},
    state: { data: { meta: { databaseDemoMode: false } } },
    requestSharedRecordLocks: async () => {
      const error = new Error("Действие недоступно: включён деморежим базы.");
      error.status = 403;
      error.payload = { code: "DEMO_MODE_READ_ONLY", demoModeEnabled: true };
      throw error;
    },
    alert: () => { demoAlertCalls += 1; }
  };
  vm.createContext(demoAcquireContext);
  vm.runInContext(`${acquireSource}\nthis.acquireRecordLock = acquireRecordLock;`, demoAcquireContext);
  const demoLockOptions = { readOnlyFallback: true };
  assert.equal(
    await demoAcquireContext.acquireRecordLock("programs-rows", "program-1", demoLockOptions),
    false
  );
  assert.equal(demoLockOptions.demoModeReadOnly, true);
  assert.equal(demoAcquireContext.window.AIS_DATABASE_DEMO_MODE, true);
  assert.equal(demoLockOptions.demoModeReloadRequired, true);
  assert.equal(demoClassNames.has("is-database-demo-mode"), true);
  assert.equal(demoAlertCalls, 0);

  demoAcquireContext.state.data.meta.databaseDemoMode = true;
  demoAcquireContext.window.AIS_DATABASE_DEMO_MODE = false;
  const sanitizedDemoLockOptions = { readOnlyFallback: true };
  assert.equal(
    await demoAcquireContext.acquireRecordLock("programs-rows", "program-2", sanitizedDemoLockOptions),
    false
  );
  assert.equal(sanitizedDemoLockOptions.demoModeReadOnly, true);
  assert.equal(sanitizedDemoLockOptions.demoModeReloadRequired, false);

  context.acquireRecordLock = async (_entityType, _entityId, options) => {
    options.demoModeReadOnly = true;
    return false;
  };
  mode = await context.acquireRecordLockForCard("programs", "program-2");
  assert.equal(mode.readOnly, true);
  assert.equal(mode.demoMode, true);

  context.acquireRecordLock = async (_entityType, _entityId, options) => {
    options.demoModeReadOnly = true;
    options.demoModeReloadRequired = true;
    return false;
  };
  mode = await context.acquireRecordLockForCard("programs", "program-3");
  assert.equal(mode, null);
  assert.equal(context.demoReloadCalls, 1);

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
  assert.match(pollingSource, /if \(isDatabaseDemoMode\(\)\) \{\s*recordLocks\.clear\(\);\s*return;/u);
  assert.match(pollingSource, /previousReadOnlyLock && !nextReadOnlyLock/u);
  assert.match(pollingSource, /markReadOnlyRecordLockAvailable\(\)/u);
  assert.match(pollingSource, /markReadOnlyRecordLockBusy\(nextReadOnlyLock\)/u);

  const heartbeatSource = extractBetween(
    "  function startRecordLockHeartbeat",
    "  async function releaseRecordLock"
  );
  assert.match(heartbeatSource, /error\.payload\?\.code === "DEMO_MODE_READ_ONLY"/u);
  assert.match(heartbeatSource, /activeRecordLock\?\.key !== lock\.key/u);

  assert.match(stylesSource, /#recordForm\[data-record-readonly="true"\][\s\S]*opacity:\s*1/u);
  assert.match(stylesSource, /\.student-modal\s*>\s*form\[data-record-readonly="true"\][\s\S]*grid-template-rows:\s*auto auto minmax\(0, 1fr\)/u);
  assert.match(stylesSource, /\.record-lock-notice\s*\{[\s\S]*position:\s*fixed/u);

  const ensureSaveSource = extractBetween(
    "  async function ensureRecordLockForSave",
    "  async function saveRecord"
  );
  const ensureSaveContext = { isDatabaseDemoMode: () => true };
  vm.createContext(ensureSaveContext);
  vm.runInContext(`${ensureSaveSource}\nthis.ensureRecordLockForSave = ensureRecordLockForSave;`, ensureSaveContext);
  assert.equal(await ensureSaveContext.ensureRecordLockForSave({}), false);

  console.log("Record lock read-only fallback tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

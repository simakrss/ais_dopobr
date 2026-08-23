const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");

function extractBetween(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Не найден блок ${startMarker}`);
  return appSource.slice(start, end).replace(/^  /gmu, "");
}

const helperContext = {
  isLocalDocumentsAvailable: () => true,
  getStudentDatabaseSourceLabel: (source) => source,
  getStudentDocumentsSource: (alternate = false) => (alternate ? "webdav" : "local")
};
vm.createContext(helperContext);
vm.runInContext(
  `${extractBetween(
    "  function getStudentDatabaseImportTooltip",
    "  function getAutomaticDocumentSaveHint"
  )}
  this.importTooltip = getStudentDatabaseImportTooltip;
  this.importConfirmation = getStudentDatabaseImportConfirmation;
  this.syncConfirmation = getStudentDatabaseSyncConfirmation;
  this.downloadConfirmation = getStudentDatabaseDownloadConfirmation;`,
  helperContext
);

const importConfirmation = helperContext.importConfirmation("с локального компьютера");
assert.match(importConfirmation, /ВНИМАНИЕ:[\s\S]*все текущие данные загружаемых разделов[\s\S]*будут заменены/iu);
assert.match(importConfirmation, /слушатели, договоры, прямые и общие затраты и запасы/iu);
assert.match(importConfirmation, /которых нет в XLSB, будут удалены/iu);
assert.match(importConfirmation, /параметры подключения будут обновлены/iu);
assert.match(importConfirmation, /Журнал действий сохраняется/iu);
assert.match(importConfirmation, /Продолжить загрузку и замену данных\?/u);

const syncConfirmation = helperContext.syncConfirmation("на локальном компьютере");
assert.match(syncConfirmation, /ВНИМАНИЕ:[\s\S]*двусторонняя синхронизация/iu);
assert.match(syncConfirmation, /резервная копия/iu);
assert.match(syncConfirmation, /контрольную сумму XLSB и ревизию Web-базы/iu);
assert.match(
  syncConfirmation,
  /изменилась только одна сторона[\s\S]*считается актуальной[\s\S]*всех синхронизируемых разделов[\s\S]*отсутствующие — удалены/iu
);
assert.match(syncConfirmation, /изменились и Web-база, и XLSB[\s\S]*остановится без перезаписи/iu);
assert.match(syncConfirmation, /запасы, программы, учебные планы, ставки, справочники и параметры/iu);

const downloadConfirmation = helperContext.downloadConfirmation("локальный компьютер");
assert.match(downloadConfirmation, /отдельная экспортная копия АИС Допобразование\.xlsb/iu);
assert.match(downloadConfirmation, /Исходный XLSB не изменяется/iu);
assert.match(downloadConfirmation, /Источник шаблона: локальный компьютер/iu);
assert.match(downloadConfirmation, /Продолжить экспорт\?/u);

assert.match(
  helperContext.importTooltip(),
  /ВНИМАНИЕ:[\s\S]*будут заменены данными из XLSB/iu,
  "Tooltip локального режима должен предупреждать о замене данных"
);
helperContext.isLocalDocumentsAvailable = () => false;
assert.match(
  helperContext.importTooltip(),
  /ВНИМАНИЕ:[\s\S]*будут заменены данными из XLSB/iu,
  "Tooltip WebDAV-режима должен предупреждать о замене данных"
);

async function verifyCancelledOperation({ source, functionName, extraContext = {} }) {
  const confirmations = [];
  let jobCalls = 0;
  const context = {
    state: {
      databaseExport: { running: false, operation: "" },
      databaseImport: { running: false }
    },
    alert: () => assert.fail("При свободной операции alert не должен вызываться"),
    confirm: (message) => {
      confirmations.push(message);
      return false;
    },
    getStudentDocumentsSource: () => "local",
    getStudentDatabaseSourceLabel: helperContext.getStudentDatabaseSourceLabel,
    getStudentDatabaseImportConfirmation: helperContext.importConfirmation,
    getStudentDatabaseSyncConfirmation: helperContext.syncConfirmation,
    getStudentDatabaseDownloadConfirmation: helperContext.downloadConfirmation,
    runStudentDatabaseImport: () => { jobCalls += 1; },
    runStudentDatabaseExport: () => { jobCalls += 1; },
    ...extraContext
  };
  const before = JSON.stringify(context.state);
  vm.createContext(context);
  vm.runInContext(`${source}; this.operation = ${functionName};`, context);
  await context.operation({ shiftKey: false });
  assert.equal(confirmations.length, 1, `${functionName}: подтверждение должно показываться один раз`);
  assert.equal(jobCalls, 0, `${functionName}: после отмены задача не должна запускаться`);
  assert.equal(JSON.stringify(context.state), before, `${functionName}: отмена не должна менять состояние`);
}

(async () => {
  await verifyCancelledOperation({
    source: extractBetween(
      "  async function exportStudentsToDatabase",
      "  async function downloadStudentsDatabase"
    ),
    functionName: "exportStudentsToDatabase"
  });
  await verifyCancelledOperation({
    source: extractBetween(
      "  async function downloadStudentsDatabase",
      "  function mergeImportedPaymentRates"
    ),
    functionName: "downloadStudentsDatabase"
  });
  await verifyCancelledOperation({
    source: extractBetween(
      "  async function importStudentsFromDatabase",
      "  function importJson"
    ),
    functionName: "importStudentsFromDatabase"
  });

  assert.match(
    appSource,
    /aria-describedby="admin-database-replace-warning"[\s\S]*id="admin-database-replace-warning"[\s\S]*при загрузке данные веб-базы будут заменены/iu,
    "В админке должно быть постоянное предупреждение о замене данных"
  );
  assert.match(
    appSource,
    /shouldBootstrapHostedDatabase[\s\S]{0,240}importStudentsFromDatabase\(\{\s*shiftKey:\s*false,\s*skipConfirmation:\s*true\s*\}\)/u,
    "Импорт без подтверждения допустим только для первичного заполнения новой пустой базы"
  );
  assert.match(
    appSource,
    /created\s*&&\s*hostedDatabaseBootstrapCandidate\s*&&\s*!hadLocalStateAtStartup/u,
    "Автоматический bootstrap должен быть ограничен новой базой без локального состояния"
  );

  console.log("Student database confirmation tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

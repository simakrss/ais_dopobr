const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const serverPath = path.resolve(__dirname, "..", "app-server.js");
const clientPath = path.resolve(__dirname, "..", "app.js");
const syncScriptPath = path.resolve(__dirname, "sync-student-database.ps1");
const serverSource = fs.readFileSync(serverPath, "utf8");
const clientSource = fs.readFileSync(clientPath, "utf8");
const syncScriptSource = fs.readFileSync(syncScriptPath, "utf8");
const { sanitizeStudentDatabaseExportPayload } = require(serverPath);

function extractBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, "Не найдено начало блока: " + startMarker);
  assert.ok(end > start, "Не найден конец блока: " + endMarker);
  return source.slice(start, end).replace(/^  /gmu, "");
}

function loadProgramMerge() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    extractBetween(
      clientSource,
      "  function normalizeStudentDatabaseImportIdentityValue",
      "  function mergeImportedStudentAgentPaymentMetadata"
    ),
    context
  );
  Object.assign(context, {
    normalizeProgramName: (value) => String(value || "").trim().toLowerCase(),
    clone: (value) => JSON.parse(JSON.stringify(value)),
    buildLegacyRecordId: () => "new-program",
    parseProgramAuthorPayments: () => []
  });
  vm.runInContext(
    extractBetween(
      clientSource,
      "  function getProgramWorkbookIdentity",
      "  async function importStudentsFromDatabase"
    ) + "\nthis.mergePrograms = mergeImportedProgramPaymentSettings;",
    context
  );
  return context.mergePrograms;
}

const payload = sanitizeStudentDatabaseExportPayload({
  students: [{ id: "student-1", uid: "1", name: "Тест" }],
  contracts: [],
  directExpenses: [],
  generalExpenses: [],
  programs: [{
    id: "program-stable",
    name: "Новое имя в Web",
    xlsbProgramName: "Старое имя в Excel",
    xlsbProgramLandingCode: "old-code",
    xlsbProgramRow: 2,
    shortName: "Новое краткое имя"
  }],
  programDictionaries: {
    frdoProfessionalAreas: ["Образование", " образование ", "Здравоохранение"],
    economicActivities: ["85.42", "85.41"]
  }
});

assert.equal(payload.programColumnMap["Наименование программы"], "name");
assert.ok(payload.programs[0].providedFields.includes("name"));
assert.equal(payload.programs[0].name, "Новое имя в Web");
assert.equal(payload.programDictionariesProvided, true);
assert.deepEqual(payload.programDictionaries, {
  frdoProfessionalAreas: ["Образование", "Здравоохранение"],
  economicActivities: ["85.42", "85.41"]
});
assert.throws(
  () => sanitizeStudentDatabaseExportPayload({
    students: [{ id: "student-1", uid: "1", name: "Тест" }],
    contracts: [],
    directExpenses: [],
    generalExpenses: [],
    programDictionaries: { frdoProfessionalAreas: [] }
  }),
  /economicActivities/u
);

const mergePrograms = loadProgramMerge();
const merged = mergePrograms(
  [{
    id: "program-stable",
    name: "Старое имя в Web",
    xlsbProgramName: "Старое имя в Excel",
    xlsbProgramRow: 2,
    xlsbProgramLandingCode: "old-code",
    webOnly: { keep: true }
  }],
  [{
    id: "program-stable",
    databaseSync: { recordId: "program-stable" },
    name: "Новое имя в Excel",
    xlsbProgramRow: 2,
    xlsbProgramLandingCode: "new-code",
    shortName: "Excel short"
  }],
  50,
  ["name", "shortName"]
);
assert.equal(merged.length, 1);
assert.equal(merged[0].id, "program-stable");
assert.equal(merged[0].name, "Новое имя в Excel");
assert.equal(merged[0].xlsbProgramName, "Новое имя в Excel");
assert.equal(merged[0].xlsbProgramRow, 2);
assert.equal(merged[0].xlsbProgramLandingCode, "new-code");
assert.deepEqual(merged[0].webOnly, { keep: true });

assert.match(syncScriptSource, /function Update-ProgramDictionaries/u);
assert.match(syncScriptSource, /Name = "Деятельность"/u);
assert.match(syncScriptSource, /Name = "ВидыДеятПК1"/u);
assert.match(syncScriptSource, /\$currentRange\.ClearContents\(\)/u);
assert.match(syncScriptSource, /\$definedName\.RefersTo = Get-ExcelRangeReference/u);
assert.match(syncScriptSource, /Название программы в строке \$Row вычисляется формулой/u);
assert.match(syncScriptSource, /function Sort-ProgramRegistryRows/u);
assert.match(syncScriptSource, /programRowsInserted = \$programPromoResult\.InsertedRows/u);
assert.match(
  clientSource,
  /function buildStudentDatabaseExportTrainingPlans\(\)[\s\S]*?programNameById[\s\S]*?programName: currentProgramName/u,
  "Учебный план должен экспортироваться с актуальным названием связанной программы."
);
assert.doesNotMatch(
  syncScriptSource,
  /\$fieldName -in @\("promoMessage1", "promoMessage2", "emailMessageTemplate", "name"\)/u
);

const commitBlock = extractBetween(
  serverSource,
  "async function handleStudentDatabaseExportCommit",
  "\nfunction getStudentExportJob"
);
const saveWorkbookIndex = commitBlock.indexOf("const savedResult = await saveStudentDatabaseSyncResult");
const applySettingsIndex = commitBlock.lastIndexOf(
  "await applyPendingStudentDatabaseServerSettings(job)"
);
assert.ok(applySettingsIndex >= 0, "Серверные настройки должны применяться в commit-фазе.");
assert.ok(
  applySettingsIndex > saveWorkbookIndex,
  "Серверные настройки применяются только после успешного commit примечаний XLSB."
);
assert.match(
  serverSource,
  /const \{[\s\S]*?serverMacroSettingsImport,[\s\S]*?\.\.\.publicResult[\s\S]*?\} = result;/u
);
assert.match(
  serverSource,
  /function buildStudentDatabaseImportResult[\s\S]*?const \{[\s\S]*?macroSettingsSecret,[\s\S]*?\.\.\.publicResult[\s\S]*?\} = result;/u,
  "Пароль не должен попадать в публичный import payload."
);

async function testDeferredBackendSettings() {
  const calls = [];
  const context = {
    process: { env: {} },
    serverSettings: {
      sharedRecordLocksMySqlConnectionString: "",
      sharedRecordLocksMySqlUseApplicationsConnection: false
    },
    normalizeStudentApplicationsSqlQuery: () => "SELECT normalized",
    parseSharedRecordLocksMySqlConnectionString: () => ({}),
    getStudentApplicationsMySqlConnectionString: () => "",
    buildStudentApplicationsMySqlConnectionString: (values) => JSON.stringify(values),
    saveServerSettings: async (patch) => calls.push(patch),
    publicStudentApplicationsMySqlSettings: () => ({
      applicationsMysqlHost: "mysql.example.org",
      applicationsMysqlPort: 3306,
      applicationsMysqlDatabase: "shop",
      applicationsMysqlUser: "reader",
      applicationsMysqlHasPassword: true,
      applicationsMysqlConfigured: true,
      applicationsSqlQuery: "SELECT default"
    })
  };
  vm.createContext(context);
  vm.runInContext(
    extractBetween(
      serverSource,
      "function studentDatabaseSharedStateUsesApplicationsMySqlConnection",
      "\nfunction getStudentDatabaseHumanCommentText"
    )
      + "\nthis.applySettings = applyImportedStudentDatabaseMacroSettings;"
      + "\nthis.applyPendingSettings = applyPendingStudentDatabaseServerSettings;",
    context
  );
  const imported = {
    macroSettings: {
      provided: true,
      applicationsSqlQuery: "SELECT source",
      applicationsMysqlHost: "mysql.example.org",
      applicationsMysqlDatabase: "shop",
      applicationsMysqlUser: "reader"
    },
    macroSettingsSecret: { applicationsMysqlPassword: "top-secret" }
  };
  await context.applySettings(imported);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].studentApplicationsSqlQuery, "SELECT normalized");
  assert.match(calls[0].studentApplicationsMySqlConnectionString, /top-secret/u);
  assert.doesNotMatch(JSON.stringify(imported.macroSettings), /top-secret/u);

  await assert.rejects(
    () => context.applySettings({
      macroSettings: {
        provided: true,
        applicationsMysqlHost: "bad;host",
        applicationsMysqlDatabase: "shop",
        applicationsMysqlUser: "reader"
      },
      macroSettingsSecret: { applicationsMysqlPassword: "secret" }
    }),
    /некорректный сервер MySQL/u
  );
  assert.equal(calls.length, 1, "Некорректные настройки не должны сохраняться.");

  const cleared = {
    macroSettings: {
      provided: true,
      applicationsSqlQuery: "",
      applicationsMysqlHost: "",
      applicationsMysqlDatabase: "",
      applicationsMysqlUser: ""
    },
    macroSettingsSecret: { applicationsMysqlPassword: "" }
  };
  await context.applySettings(cleared);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].studentApplicationsSqlQuery, "");
  assert.equal(
    Object.prototype.hasOwnProperty.call(calls[1], "studentApplicationsMySqlConnectionString"),
    false,
    "Пустые реквизиты XLSB не должны отключать MySQL, используемый общей Web-базой."
  );
  assert.equal(cleared.macroSettings.applicationsSqlQuery, "SELECT default");
  assert.equal(cleared.macroSettings.applicationsMysqlConfigured, true);

  context.serverSettings.sharedRecordLocksMySqlUseApplicationsConnection = true;
  await assert.rejects(
    () => context.applySettings(imported),
    /одновременно используется общей Web-базой/u
  );
  assert.equal(calls.length, 2, "Опасное переключение общей MySQL-базы не должно сохраняться.");
  context.serverSettings.sharedRecordLocksMySqlUseApplicationsConnection = false;

  const pendingJob = {
    result: {
      syncDirection: "excel-to-web",
      importPayload: { macroSettings: { provided: true } }
    },
    pendingServerMacroSettingsImport: {
      macroSettings: {
        provided: true,
        applicationsMysqlHost: "mysql.example.org",
        applicationsMysqlDatabase: "shop",
        applicationsMysqlUser: "reader"
      },
      macroSettingsSecret: { applicationsMysqlPassword: "retry-secret" }
    }
  };
  await context.applyPendingSettings(pendingJob);
  assert.equal(pendingJob.pendingServerMacroSettingsImport, null);
  assert.equal(pendingJob.result.importPayload.macroSettings.applicationsMysqlHasPassword, true);
  assert.doesNotMatch(JSON.stringify(pendingJob.result), /retry-secret/u);
}

const directionalExportSource = extractBetween(
  serverSource,
  "async function buildStudentDatabaseExport",
  "async function handleStudentDatabaseExportStart"
);
const mysqlPreflightIndex = directionalExportSource.indexOf(
  "prepareImportedStudentDatabaseServerSettings({"
);
const annotationIndex = directionalExportSource.indexOf(
  "buildStudentDatabaseSyncAnnotationPayload(sourceData)"
);
assert.ok(
  mysqlPreflightIndex >= 0 && mysqlPreflightIndex < annotationIndex,
  "Настройки MySQL должны проверяться до создания и commit XLSB."
);

testDeferredBackendSettings()
  .then(() => console.log(
    "Program names, dictionaries and backend settings are covered in both sync directions."
  ))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

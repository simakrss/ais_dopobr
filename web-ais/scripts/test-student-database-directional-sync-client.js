const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");

function extractBetween(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, "Не найден блок " + startMarker);
  return appSource.slice(start, end).replace(/^  /gmu, "");
}

function loadImportMergeHelpers() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    extractBetween(
      "  function normalizeStudentDatabaseImportIdentityValue",
      "  function mergeImportedStudentAgentPaymentMetadata"
    )
      + "\nthis.mergeStudents = mergeStudentDatabaseImportedStudents;"
      + "\nthis.mergeRecords = mergeStudentDatabaseImportedRecords;",
    context
  );
  return context;
}

function testBaselineNormalizationAndLatestTimestamp() {
  const context = {
    state: {
      data: {
        collections: {
          audit: [
            { createdAt: "2026-08-20T09:00:00.000Z", entityType: "database" },
            { createdAt: "2026-08-20T08:00:00.000Z", entityType: "students" },
            { createdAt: "2026-08-01T00:00:00.000Z", entityType: "documents" }
          ]
        }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(
    extractBetween("  function normalizeStudentDatabaseSyncBaseline", "  async function readStudentImportResponse")
      + "\nthis.normalizeBaseline = normalizeStudentDatabaseSyncBaseline;"
      + "\nthis.isValidBaseline = isValidStudentDatabaseSyncBaseline;"
      + "\nthis.latestTimestamp = getLatestStudentDatabaseSynchronizationTimestamp;"
      + "\nthis.auditWindow = getStudentDatabaseCriticalAuditWindow;",
    context
  );
  const baseline = context.normalizeBaseline({
    version: 99,
    sourceHash: "A".repeat(64),
    sourceIdentity: "B".repeat(64),
    webRevision: 7,
    synchronizedAt: "2026-08-20T10:00:00.000Z"
  });
  assert.equal(baseline.version, 1);
  assert.equal(baseline.sourceHash, "a".repeat(64));
  assert.equal(baseline.sourceIdentity, "b".repeat(64));
  assert.equal(context.isValidBaseline(baseline), true);
  assert.equal(
    context.latestTimestamp("2026-08-13T10:00:00.000Z", "2026-08-15T12:00:00.000Z"),
    "2026-08-15T12:00:00.000Z"
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.auditWindow())),
    {
      latestCriticalAt: "2026-08-20T08:00:00.000Z",
      oldestAt: "2026-08-01T00:00:00.000Z",
      complete: true
    }
  );
}

function testManualContractAmountOverrideFromAudit() {
  const student = {
    id: "student-db-1166",
    uid: "1166",
    name: "Добрышкина Екатерина Сергеевна",
    contractAmount: 2500
  };
  const context = {
    STUDENT_DATABASE_FIXED_VALUE_OVERRIDE_FIELDS: Object.freeze(["contractAmount"]),
    state: {
      data: {
        collections: {
          audit: [{
            entityType: "students",
            entityId: "student-db-1166",
            action: "Изменена запись",
            source: "web",
            changes: [{ field: "contractAmount", before: "4000", after: "2500" }]
          }]
        }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(
    extractBetween(
      "  function normalizeStudentDatabaseFixedValueOverrides",
      "  function buildStudentDatabaseExportStudents"
    ) + "\nthis.getOverrides = getStudentDatabaseFixedValueOverrides;",
    context
  );
  assert.deepEqual(Array.from(context.getOverrides(student)), ["contractAmount"]);
  assert.deepEqual(Array.from(context.getOverrides({
    ...student,
    contractAmount: 4000,
    databaseFixedValueOverrides: ["contractAmount", "balance"]
  })), ["contractAmount"]);
  assert.match(
    appSource,
    /formData\.has\("contractAmount"\)[\s\S]{0,280}databaseFixedValueOverrides/u
  );
  assert.match(
    appSource,
    /new Set\(\["id", "photoData", "databaseFixedValueOverrides"\]\)/u
  );
}

function buildPreviousStudent() {
  return {
    id: "student-db-42",
    uid: "42",
    name: "Тестова Анна",
    applicationDate: "2026-08-01",
    program: "Курс",
    phone: "+7 900 000-00-00",
    note: "Удалить в Excel",
    photoData: "data:image/jpeg;base64,photo",
    photoUrl: "/photos/42.jpg",
    documentRecognitionResult: { fields: { snils: "123" } },
    history: [{ action: "created" }],
    customWebMetadata: { keep: true },
    directExpenses: [{
      id: "expense-1",
      uid: "42",
      date: "2026-08-02",
      type: "Печать",
      amount: 100,
      note: "Очистить",
      approvalMetadata: { keep: true }
    }]
  };
}

function testManagedFieldClearingAndWebOnlyPreservation() {
  const helpers = loadImportMergeHelpers();
  const previous = buildPreviousStudent();
  const imported = {
    id: "student-db-42",
    uid: "42",
    name: "Тестова Анна",
    applicationDate: "2026-08-01",
    program: "Курс",
    frdoDate: "2026-08-20",
    directExpenses: [{
      id: "expense-1",
      uid: "42",
      date: "2026-08-02",
      type: "Печать",
      amount: 150
    }]
  };
  const merged = helpers.mergeStudents(
    [imported],
    [previous],
    ["uid", "name", "applicationDate", "program", "phone", "note", "frdoDate"],
    ["uid", "date", "type", "amount", "note"]
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].phone, "", "Пустая управляемая ячейка должна очищать Web-поле");
  assert.equal(merged[0].note, "", "Отсутствующее управляемое поле должно стать пустым");
  assert.equal(merged[0].frdoDate, "2026-08-20", "Дата ФРДО должна входить в schema overlay");
  assert.equal(merged[0].photoData, previous.photoData);
  assert.equal(merged[0].photoUrl, previous.photoUrl);
  assert.deepEqual(merged[0].documentRecognitionResult, previous.documentRecognitionResult);
  assert.deepEqual(merged[0].history, previous.history);
  assert.deepEqual(merged[0].customWebMetadata, previous.customWebMetadata);
  assert.equal(merged[0].directExpenses[0].amount, 150);
  assert.equal(merged[0].directExpenses[0].note, "");
  assert.deepEqual(
    merged[0].directExpenses[0].approvalMetadata,
    previous.directExpenses[0].approvalMetadata
  );

  const contract = helpers.mergeRecords(
    [{
      id: "contract-new-row-id",
      section: "ДЕЙСТВУЮЩИЕ ДОГОВОРА",
      name: "Иванов Иван",
      contractNo: "15",
      contractDate: "2026-01-01",
      phone: "+7 999 111-22-33"
    }],
    [{
      id: "contract-stable-web-id",
      section: "ДЕЙСТВУЮЩИЕ ДОГОВОРА",
      name: "Иванов Иван",
      contractNo: "15",
      contractDate: "2026-01-01",
      phone: "старый",
      note: "Очистить",
      webApproval: { keep: true }
    }],
    {
      label: "договора",
      identity: (row) => [row.section, row.name, row.contractNo, row.contractDate],
      managedFields: ["section", "name", "contractNo", "contractDate", "phone", "note"]
    }
  )[0];
  assert.equal(contract.id, "contract-stable-web-id");
  assert.equal(contract.phone, "+7 999 111-22-33");
  assert.equal(contract.note, "");
  assert.deepEqual(contract.webApproval, { keep: true });

  assert.throws(() => helpers.mergeStudents(
    [{ uid: "7", name: "Дубль", applicationDate: "2026-01-01", program: "Курс" }],
    [
      { id: "a", uid: "7", name: "Дубль", applicationDate: "2026-01-01", program: "Курс" },
      { id: "b", uid: "7", name: "Дубль", applicationDate: "2026-01-01", program: "Курс" }
    ],
    ["uid", "name", "applicationDate", "program"],
    ["uid"]
  ), /Конфликт сопоставления слушателя/u);
}

function testExplicitImportDeletionSemantics() {
  const programContext = loadImportMergeHelpers();
  Object.assign(programContext, {
    normalizeProgramName: (value) => String(value || "").trim().toLowerCase(),
    clone: (value) => JSON.parse(JSON.stringify(value)),
    buildLegacyRecordId: () => "new-program",
    parseProgramAuthorPayments: () => []
  });
  vm.runInContext(
    extractBetween("  function getProgramWorkbookIdentity", "  async function importStudentsFromDatabase")
      + "\nthis.mergePrograms = mergeImportedProgramPaymentSettings;",
    programContext
  );
  assert.equal(
    programContext.mergePrograms(
      [{ id: "program-1", name: "Удалённая программа", webOnly: true }],
      [],
      50,
      ["shortName", "price"]
    ).length,
    0,
    "При явной полной загрузке XLSB отсутствующая программа должна удаляться из Web."
  );
  const renamedByStableId = programContext.mergePrograms(
    [{
      id: "program-stable",
      name: "Новое имя",
      xlsbProgramName: "Новое имя",
      xlsbProgramLandingCode: "new"
    }],
    [{
      id: "program-stable",
      databaseSync: { recordId: "program-stable" },
      name: "Старое имя",
      xlsbProgramLandingCode: "old",
      shortName: "Имя из Excel"
    }],
    50,
    ["shortName"]
  );
  assert.equal(renamedByStableId.length, 1);
  assert.equal(renamedByStableId[0].id, "program-stable");
  assert.equal(renamedByStableId[0].shortName, "Имя из Excel");
  const mismatchedStableId = programContext.mergePrograms(
    [{ id: "program-web", name: "Одинаковое имя" }],
    [{
      id: "program-excel",
      databaseSync: { recordId: "program-excel" },
      name: "Одинаковое имя",
      shortName: "Excel"
    }],
    50,
    ["shortName"]
  );
  assert.equal(mismatchedStableId.length, 1);
  assert.equal(
    mismatchedStableId[0].id,
    "program-excel",
    "При наличии AIS_SYNC совпадение имени не должно подменять точный ID."
  );

  const planContext = loadImportMergeHelpers();
  Object.assign(planContext, {
    normalizeTrainingPlanRecord: (value) => ({ ...value }),
    trainingPlanImportKey: (value) => [value.code, value.programName, value.discipline].join("|")
  });
  vm.runInContext(
    extractBetween("  function mergeImportedTrainingPlanRows", "  function normalizeOptionalNumber")
      + "\nthis.mergePlans = mergeImportedTrainingPlanRows;",
    planContext
  );
  assert.equal(
    planContext.mergePlans(
      [{ id: "custom-plan", code: "1", programName: "Курс", discipline: "Удалить" }],
      [],
      ["code", "programName", "discipline"]
    ).length,
    0,
    "Строка учебного плана, удалённая из Excel, не должна восстанавливаться как custom row"
  );
  const movedPlan = planContext.mergePlans(
    [{
      id: "plan-stable",
      programId: "program-old",
      programName: "Старая программа",
      code: "1",
      discipline: "Раздел",
      webApproval: { keep: true }
    }],
    [{
      id: "plan-stable",
      databaseSync: { recordId: "plan-stable" },
      programName: "Новая программа",
      code: "1",
      discipline: "Раздел"
    }],
    ["code", "programName", "discipline"]
  )[0];
  assert.equal(
    movedPlan.programId,
    "",
    "При смене программы в Excel старый programId должен быть сброшен перед сопоставлением."
  );
  assert.deepEqual(movedPlan.webApproval, { keep: true });
  planContext.findProgramInRows = (rows, name) => rows.find((row) => row.name === name) || null;
  vm.runInContext(
    extractBetween(
      "  function linkTrainingPlanRecordsToPrograms",
      "  function mergeImportedTrainingPlanRows"
    ) + "\nthis.linkPlans = linkTrainingPlanRecordsToPrograms;",
    planContext
  );
  const linkedMovedPlan = planContext.linkPlans(
    [movedPlan],
    [
      { id: "program-old", name: "Старая программа" },
      { id: "program-new", name: "Новая программа" }
    ]
  )[0];
  assert.equal(
    linkedMovedPlan.programId,
    "program-new",
    "Stable-ID строка учебного плана должна связаться с программой по новому имени."
  );
}

async function testRealSynchronizationImportPath() {
  const counters = { audit: 0, persist: 0 };
  const previousStudent = buildPreviousStudent();
  const previousTargetStudent = {
    id: "student-db-43",
    uid: "43",
    name: "Новая Получательница",
    applicationDate: "2026-08-03",
    program: "Курс",
    directExpenses: []
  };
  const previousContract = {
    id: "contract-stable-web-id",
    section: "ДЕЙСТВУЮЩИЕ ДОГОВОРА",
    name: "Иванов Иван",
    contractNo: "15",
    contractDate: "2026-01-01",
    note: "Очистить",
    webApproval: { keep: true }
  };
  const context = {
    state: {
      databaseExport: { running: true, operation: "sync" },
      databaseImport: { running: false },
      data: {
        meta: {
          defaultAuthorPaymentPercent: 50,
          studentEventTemplates: [{ key: "old-student-event" }],
          contractEventTemplates: [{ key: "old-contract-event" }],
          applicationsSqlQuery: "SELECT old",
          applicationsMysqlHost: "old.mysql.local",
          applicationsMysqlPort: 3307,
          applicationsMysqlDatabase: "old_database",
          applicationsMysqlUser: "old_user",
          applicationsMysqlHasPassword: true,
          applicationsMysqlConfigured: true
        },
        dictionaries: { paymentSettings: [], managers: [] },
        collections: {
          students: [previousStudent, previousTargetStudent],
          contracts: [previousContract],
          directExpenses: [{
            id: "direct-1",
            uid: "777",
            date: "2026-08-01",
            type: "Конверт",
            amount: 10,
            inventoryId: "inventory-web",
            inventoryLink: "Конверт",
            webApproval: { keep: "global" }
          }, {
            id: "direct-unlinked",
            uid: "778",
            date: "2026-08-02",
            type: "Конверт",
            amount: 10,
            inventoryId: "inventory-web",
            inventoryLink: ""
          }],
          generalExpenses: [],
          inventory: [{
            id: "inventory-web",
            itemType: "Конверт",
            amount: 10,
            balance: 1
          }],
          programs: [],
          trainingPlans: [],
          audit: []
        }
      },
      selected: { students: [], contracts: [], directExpenses: [], generalExpenses: [], inventory: [] },
      tablePages: { students: 1, contracts: 1, directExpenses: 1, generalExpenses: 1, inventory: 1 },
      lastEditedRow: {},
      search: ""
    },
    performance: { now: () => 1000 },
    getStudentDocumentsSource: () => "local",
    getStudentDatabaseImportConfirmation: () => "",
    confirm: () => true,
    alert: () => assert.fail("alert не ожидается"),
    updateDatabaseImportIndicator: () => {},
    finishDatabaseImportIndicator: () => {},
    showDatabaseOperationResult: () => {},
    getCurrentUserLogin: () => "tester",
    normalizeStudentRecord: (row) => ({ ...row }),
    applyMappedAgentToStudentRecord: (row) => row,
    getStudentAgentPaymentImportIdentity: (row) => String(row.uid || row.id || ""),
    mergeImportedStudentAgentPaymentMetadata: (row) => row,
    normalizeGeneralExpenseRecord: (row) => ({ ...row }),
    normalizeContractRecord: (row) => ({ ...row }),
    formatContractDatabaseSectionSummary: () => "ДЕЙСТВУЮЩИЕ ДОГОВОРА: 1",
    normalizePaymentRateValue: (value) => Number(value || 0),
    normalizePaymentSettings: (value) => value || [],
    normalizePaymentPercent: (value, fallback) => Number(value ?? fallback),
    mergeImportedAgentPaymentRates: (value) => value,
    mergeImportedPaymentRates: (value) => value,
    applyGlobalAuthorRateToPrograms: (value) => value,
    mergeImportedProgramPaymentSettings: (value) => value,
    mergeImportedTrainingPlanRows: (value) => value,
    mergeImportedCommunicationTemplateNamedRanges: (value) => ({ ...(value || {}) }),
    normalizeProgramRecord: (value) => ({ ...value }),
    normalizeTrainingPlanRecord: (value) => ({ ...value }),
    linkTrainingPlanRecordsToPrograms: (value) => value,
    PROGRAM_DICTIONARY_FIELDS: {},
    getProgramDictionaryFieldValues: () => [],
    unique: (values) => [...new Set(values)],
    normalizeConfiguredEventTemplates: () => [],
    ensureDataShape: (value) => value,
    normalizeStudentDatabaseSyncBaseline: (value) => value,
    isValidStudentDatabaseSyncBaseline: () => true,
    clone: (value) => JSON.parse(JSON.stringify(value)),
    formatDatabaseOperationDuration: () => "1 сек",
    render: () => {},
    addAudit: () => {
      counters.audit += 1;
      return { action: "sync-audit" };
    },
    persist: () => { counters.persist += 1; }
  };
  vm.createContext(context);
  vm.runInContext(
    extractBetween(
      "  function normalizeStudentDatabaseImportIdentityValue",
      "  function mergeImportedStudentAgentPaymentMetadata"
    )
      + "\n"
      + extractBetween("  async function importStudentsFromDatabase", "  function importJson")
      + "\nthis.operation = importStudentsFromDatabase;",
    context
  );
  const payload = {
    students: [{
      id: "student-db-42",
      uid: "42",
      name: "Тестова Анна",
      applicationDate: "2026-08-01",
      program: "Курс",
      directExpenses: []
    }, {
      id: "student-db-43",
      uid: "43",
      name: "Новая Получательница",
      applicationDate: "2026-08-03",
      program: "Курс",
      directExpenses: [{
        id: "expense-1",
        uid: "43",
        date: "2026-08-02",
        type: "Печать",
        amount: 150,
        note: "Перенесён"
      }, {
        id: "direct-1",
        uid: "43",
        date: "2026-08-01",
        type: "Конверт",
        amount: 10,
        inventoryId: "inventory-excel",
        inventoryLink: "Конверт"
      }]
    }],
    contracts: [{
      id: "contract-new-row-id",
      section: "ДЕЙСТВУЮЩИЕ ДОГОВОРА",
      name: "Иванов Иван",
      contractNo: "15",
      contractDate: "2026-01-01"
    }],
    directExpenses: [{
      id: "direct-unlinked",
      uid: "778",
      date: "2026-08-02",
      type: "Конверт",
      amount: 10,
      inventoryId: "",
      inventoryLink: ""
    }],
    generalExpenses: [],
    inventory: [{
      id: "inventory-excel",
      itemType: "Конверт",
      amount: 10,
      balance: 1
    }],
    programPaymentSettings: [],
    trainingPlans: [],
    paymentRates: {},
    paymentConstants: [],
    agentPaymentRates: {},
    macroSettings: {
      provided: true,
      studentEventTemplates: [],
      contractEventTemplates: [],
      applicationsSqlQuery: "SELECT default",
      applicationsMysqlHost: "old.mysql.local",
      applicationsMysqlPort: 3307,
      applicationsMysqlDatabase: "old_database",
      applicationsMysqlUser: "old_user",
      applicationsMysqlHasPassword: true,
      applicationsMysqlConfigured: true
    },
    studentSectionTitles: ["Вебинары"],
    studentDatabaseSyncFields: ["uid", "name", "applicationDate", "program", "phone", "note"],
    contractDatabaseSyncFields: ["section", "name", "contractNo", "contractDate", "note"],
    directExpenseDatabaseSyncFields: [
      "uid", "date", "type", "amount", "note", "inventoryId", "inventoryLink"
    ],
    generalExpenseDatabaseSyncFields: ["section", "counterparty", "date", "workType", "amount"],
    inventoryDatabaseSyncFields: ["itemType", "amount", "balance"],
    trainingPlanDatabaseSyncFields: ["code", "programName", "discipline"],
    programDatabaseSyncFields: ["shortName"],
    count: 1
  };
  const result = await context.operation({
    synchronizationPayload: payload,
    syncSource: "local",
    sourceLabel: "на локальном компьютере",
    syncBaseline: {
      version: 1,
      sourceHash: "a".repeat(64),
      sourceIdentity: "b".repeat(64),
      webRevision: 8,
      synchronizedAt: "2026-08-20T12:00:00.000Z"
    }
  });
  assert.equal(counters.audit, 1);
  assert.equal(counters.persist, 1);
  assert.deepEqual(result.auditEntry, { action: "sync-audit" });
  assert.equal(context.state.data.collections.students[0].phone, "");
  assert.equal(context.state.data.collections.students[0].note, "");
  assert.equal(context.state.data.collections.students[0].photoData, previousStudent.photoData);
  assert.deepEqual(
    context.state.data.collections.students[0].documentRecognitionResult,
    previousStudent.documentRecognitionResult
  );
  assert.equal(context.state.data.collections.contracts[0].id, previousContract.id);
  assert.equal(context.state.data.collections.contracts[0].note, "");
  assert.deepEqual(context.state.data.collections.contracts[0].webApproval, { keep: true });
  assert.equal(context.state.data.collections.inventory[0].id, "inventory-web");
  const targetStudent = context.state.data.collections.students
    .find((student) => student.id === "student-db-43");
  assert.ok(targetStudent);
  assert.equal(context.state.data.collections.students[0].directExpenses.length, 0);
  assert.equal(targetStudent.directExpenses.length, 2);
  const movedNestedExpense = targetStudent.directExpenses
    .find((expense) => expense.id === "expense-1");
  assert.equal(movedNestedExpense.uid, "43");
  assert.deepEqual(
    movedNestedExpense.approvalMetadata,
    previousStudent.directExpenses[0].approvalMetadata,
    "Web-only metadata должно сохраниться при переносе расхода между слушателями."
  );
  const movedGlobalExpense = targetStudent.directExpenses
    .find((expense) => expense.id === "direct-1");
  assert.deepEqual(
    movedGlobalExpense.webApproval,
    { keep: "global" },
    "Web-only metadata глобального расхода должно сохраниться после привязки к слушателю."
  );
  assert.equal(context.state.data.collections.directExpenses.length, 1);
  assert.equal(
    context.state.data.collections.directExpenses[0].inventoryId,
    "",
    "Совпадение вида затрат с ТМЦ без явной связи не должно восстанавливать inventoryId"
  );
  assert.equal(
    movedGlobalExpense.inventoryId,
    "inventory-web",
    "Связь расхода должна быть переназначена на сохранённый Web ID позиции."
  );
  assert.deepEqual(context.state.data.meta.studentEventTemplates, []);
  assert.deepEqual(context.state.data.meta.contractEventTemplates, []);
  assert.equal(context.state.data.meta.applicationsSqlQuery, "SELECT default");
  assert.equal(context.state.data.meta.applicationsMysqlHost, "old.mysql.local");
  assert.equal(context.state.data.meta.applicationsMysqlPort, 3307);
  assert.equal(context.state.data.meta.applicationsMysqlDatabase, "old_database");
  assert.equal(context.state.data.meta.applicationsMysqlUser, "old_user");
  assert.equal(context.state.data.meta.applicationsMysqlHasPassword, true);
  assert.equal(context.state.data.meta.applicationsMysqlConfigured, true);
}

function makeExportContext(result, { validBaseline = true } = {}) {
  const order = [];
  const baselineCalls = [];
  const operationResults = [];
  const context = {
    state: {
      databaseExport: { running: false, operation: "" },
      databaseImport: { running: false },
      data: {
        meta: {
          studentDatabaseSyncBaseline: validBaseline ? {
            version: 1,
            sourceHash: "a".repeat(64),
            sourceIdentity: "b".repeat(64),
            webRevision: 7,
            synchronizedAt: "2026-08-20T10:00:00.000Z"
          } : {}
        },
        collections: {}
      }
    },
    sharedStateRevision: 7,
    sharedStateConflict: false,
    sharedStateOffline: false,
    sharedStateChangeGeneration: 3,
    performance: { now: () => 1000 },
    alert: () => assert.fail("alert не ожидается"),
    confirm: () => true,
    getStudentDocumentsSource: () => "local",
    getStudentDatabaseSyncConfirmation: () => "confirm",
    getStudentDatabaseWebDavPath: () => "db.xlsb",
    normalizeStudentDatabaseSyncBaseline: (value) => value || {},
    isValidStudentDatabaseSyncBaseline: () => validBaseline,
    getLatestStudentDatabaseSynchronizationTimestamp: () => "",
    getStudentDatabaseCriticalAuditWindow: () => ({
      latestCriticalAt: "2026-08-20T09:00:00.000Z",
      oldestAt: "2026-08-01T00:00:00.000Z",
      complete: false
    }),
    flushSharedApplicationState: async () => true,
    buildStudentDatabaseExportStudents: () => [{ id: "s1" }],
    buildStudentDatabaseExportContracts: () => [{ id: "c1" }],
    buildStudentDatabaseExportDirectExpenses: () => [{ id: "d1" }],
    buildStudentDatabaseExportGeneralExpenses: () => [{ id: "g1" }],
    buildStudentDatabaseExportInventory: () => [{ id: "i1" }],
    buildStudentDatabaseExportTrainingPlans: () => [{ id: "t1" }],
    buildStudentDatabaseExportPrograms: () => [{ id: "p1" }],
    buildStudentDatabaseExportProgramDictionaries: () => ({}),
    buildStudentDatabaseExportCommunicationTemplateFields: () => [{ name: "ПереченьДокументовДПП", formula: "Документы" }],
    buildStudentDatabaseExportPaymentConstants: () => [],
    buildStudentDatabaseExportAgentPaymentRates: () => ({}),
    buildStudentDatabaseExportMacroSettings: () => ({}),
    runStudentDatabaseExport: async (body) => {
      order.push("run");
      context.exportBody = body;
      return { ...result, jobId: result.jobId || "job-1" };
    },
    updateDatabaseExportIndicator: () => {},
    finishDatabaseExportIndicator: () => {},
    showDatabaseOperationResult: (value) => { operationResults.push(value); },
    databaseOperationDetailFields: {
      students: [],
      contracts: [],
      directExpenses: [],
      generalExpenses: [],
      inventory: [],
      programs: [],
      trainingPlans: []
    },
    databaseOperationDetailColumns: () => [],
    buildDatabaseOperationDetailRows: () => [],
    formatDatabaseOperationDuration: () => "1 сек",
    render: () => { order.push("render"); },
    commitStudentDatabaseExport: async () => {
      order.push("commit");
      return context.commitResult;
    },
    buildStudentDatabaseSyncBaseline: (...args) => {
      baselineCalls.push(args);
      return {
        version: 2,
        sourceHash: args[0],
        sourceIdentity: args[1],
        webRevision: args[2],
        synchronizedAt: args[3],
        criticalHash: args[4],
        criticalIdentityHash: args[5]
      };
    },
    importStudentsFromDatabase: async () => {
      order.push("import");
      return { studentCount: 1, auditEntry: { action: "excel-import" } };
    },
    cancelScheduledSharedApplicationStateSave: () => {},
    flushStudentDatabaseSynchronizationState: async () => { order.push("strict-flush"); },
    persist: () => { order.push("persist"); },
    addAudit: () => {
      order.push("audit");
      return { action: "web-export" };
    },
    postAuditEntry: async () => { order.push("post-audit"); },
    flushSharedApplicationStateThroughGeneration: async () => {
      order.push("baseline-flush");
      return true;
    },
    cancelStudentDatabaseSyncReservation: async (jobId, token) => {
      order.push("cancel:" + jobId + ":" + token);
      return true;
    }
  };
  context.order = order;
  context.baselineCalls = baselineCalls;
  context.operationResults = operationResults;
  vm.createContext(context);
  vm.runInContext(
    extractBetween("  async function exportStudentsToDatabase", "  async function downloadStudentsDatabase")
      + "\nthis.operation = exportStudentsToDatabase;",
    context
  );
  return context;
}

async function testDirectionalExportFlows() {
  const unchanged = makeExportContext({
    syncDirection: "unchanged",
    sourceHash: "a".repeat(64),
    sourceIdentity: "b".repeat(64),
    studentCount: 1
  });
  await unchanged.operation({ shiftKey: false });
  assert.deepEqual(unchanged.order.filter((item) => ["persist", "audit", "commit", "baseline-flush"].includes(item)), []);
  assert.equal(unchanged.exportBody.directionalSync, true);
  assert.equal(unchanged.exportBody.inventory.length, 1);
  assert.equal(unchanged.exportBody.trainingPlans.length, 1);
  assert.equal(unchanged.exportBody.currentWebCriticalUpdatedAt, "2026-08-20T09:00:00.000Z");
  assert.equal(unchanged.exportBody.currentWebAuditOldestAt, "2026-08-01T00:00:00.000Z");

  const changedDuringPreparation = makeExportContext({
    syncDirection: "web-to-excel",
    requiresCommit: true,
    sourceHash: "7".repeat(64),
    sourceIdentity: "8".repeat(64),
    studentCount: 1
  });
  changedDuringPreparation.runStudentDatabaseExport = async () => {
    changedDuringPreparation.order.push("run");
    changedDuringPreparation.sharedStateChangeGeneration += 1;
    return {
      syncDirection: "web-to-excel",
      requiresCommit: true,
      jobId: "changed-job",
      sourceHash: "7".repeat(64),
      sourceIdentity: "8".repeat(64),
      studentCount: 1
    };
  };
  await changedDuringPreparation.operation({ shiftKey: false });
  assert.equal(
    changedDuringPreparation.order.includes("commit"),
    false,
    "При изменении Web-данных во время подготовки XLSB commit запрещён"
  );
  assert.equal(changedDuringPreparation.order.includes("persist"), false);

  const initial = makeExportContext({
    syncDirection: "unchanged",
    sourceHash: "c".repeat(64),
    sourceIdentity: "d".repeat(64),
    studentCount: 1
  }, { validBaseline: false });
  await initial.operation({ shiftKey: false });
  assert.equal(initial.order.includes("persist"), true);
  assert.equal(initial.order.includes("baseline-flush"), true);
  assert.equal(initial.order.includes("audit"), false);
  assert.equal(initial.baselineCalls.length, 1);
  assert.match(initial.operationResults.at(-1).summary, /не изменились/iu);

  const excel = makeExportContext({
    syncDirection: "excel-to-web",
    requiresCommit: true,
    importPayload: { students: [] },
    sourceHash: "e".repeat(64),
    sourceIdentity: "f".repeat(64),
    studentCount: 1
  });
  excel.commitResult = {
    committed: true,
    syncCommitToken: "excel-token",
    sourceHash: "7".repeat(64),
    sourceIdentity: "f".repeat(64),
    backupPath: "excel-backup.xlsb"
  };
  await excel.operation({ shiftKey: false });
  assert.ok(excel.order.indexOf("commit") < excel.order.indexOf("import"));
  assert.ok(excel.order.indexOf("import") < excel.order.indexOf("strict-flush"));
  assert.equal(
    excel.baselineCalls[0][0],
    "7".repeat(64),
    "Excel → Web baseline должен хранить hash уже аннотированного XLSB"
  );
  assert.equal(excel.operationResults.at(-1).details[1].value, "excel-backup.xlsb");

  const web = makeExportContext({
    syncDirection: "web-to-excel",
    requiresCommit: true,
    sourceHash: "1".repeat(64),
    sourceIdentity: "2".repeat(64),
    studentCount: 1
  });
  web.commitResult = {
    committed: true,
    syncCommitToken: "web-token",
    sourceHash: "9".repeat(64),
    sourceIdentity: "2".repeat(64),
    backupPath: "backup.xlsb"
  };
  await web.operation({ shiftKey: false });
  assert.ok(web.order.indexOf("commit") < web.order.indexOf("audit"));
  assert.ok(web.order.indexOf("persist") < web.order.indexOf("strict-flush"));
  assert.equal(web.baselineCalls[0][0], "9".repeat(64), "Baseline должен хранить hash сохранённого XLSB");
  assert.equal(web.baselineCalls[0][2], 8);

  const failed = makeExportContext({
    syncDirection: "web-to-excel",
    requiresCommit: true,
    sourceIdentity: "2".repeat(64),
    studentCount: 1
  });
  failed.commitResult = {
    committed: true,
    syncCommitToken: "cancel-me",
    sourceHash: "8".repeat(64),
    sourceIdentity: "2".repeat(64)
  };
  failed.flushStudentDatabaseSynchronizationState = async () => { throw new Error("save failed"); };
  await failed.operation({ shiftKey: false });
  assert.ok(failed.order.includes("cancel:job-1:cancel-me"));

  const unknown = makeExportContext({
    syncDirection: "web-to-excel",
    requiresCommit: true,
    sourceIdentity: "2".repeat(64),
    studentCount: 1
  });
  unknown.commitStudentDatabaseExport = async () => {
    unknown.order.push("commit");
    const error = new Error("response lost");
    error.studentDatabaseCommitState = "unknown";
    throw error;
  };
  await unknown.operation({ shiftKey: false });
  assert.match(unknown.operationResults.at(-1).summary, /Состояние XLSB неизвестно/iu);
  assert.match(unknown.operationResults.at(-1).summary, /повторите синхронизацию/iu);
}

async function testExpiredTokenRetry() {
  const calls = [];
  const context = {
    sharedStateConflict: false,
    sharedStateOffline: false,
    flushSharedApplicationStateThroughGeneration: async (generation, options) => {
      calls.push("flush:" + options.syncCommitToken);
      if (options.syncCommitToken === "old-token") {
        const error = new Error("Срок подтверждения синхронизации XLSB истёк. Повторите синхронизацию.");
        error.status = 409;
        throw error;
      }
      return true;
    },
    commitStudentDatabaseExport: async () => {
      calls.push("commit");
      return { syncCommitToken: "new-token" };
    }
  };
  vm.createContext(context);
  vm.runInContext(
    extractBetween(
      "  function isExpiredStudentDatabaseSyncTokenError",
      "  function buildStudentDatabaseExportStudents"
    )
      + "\nthis.retry = flushStudentDatabaseSynchronizationState;",
    context
  );
  let updatedToken = "";
  await context.retry({
    targetGeneration: 5,
    baseRevision: 7,
    jobId: "job-1",
    syncCommitToken: "old-token",
    onToken: (token) => { updatedToken = token; }
  });
  assert.deepEqual(calls, ["flush:old-token", "commit", "flush:new-token"]);
  assert.equal(updatedToken, "new-token");
}

async function testCommitResponseLossRetry() {
  const loadCommit = (fetchImplementation) => {
    const calls = { bodies: [], delays: [], timeouts: [] };
    const context = {
      photoApiUrl: (value) => value,
      fetch: async (url, options) => {
        calls.bodies.push({ url, body: options.body });
        return fetchImplementation(calls.bodies.length, url, options);
      },
      fetchWithTimeout: async (url, options, timeoutMs, _message, readResponse) => {
        calls.timeouts.push(timeoutMs);
        const response = await context.fetch(url, options);
        return readResponse(response);
      },
      readStudentImportResponse: async (response) => response.payload,
      waitForStudentImportPoll: async (delay) => { calls.delays.push(delay); }
    };
    vm.createContext(context);
    vm.runInContext(
      extractBetween(
        "  function isRetryableStudentDatabaseCommitError",
        "  async function cancelStudentDatabaseSyncReservation"
      ) + "\nthis.commit = commitStudentDatabaseExport;",
      context
    );
    return { context, calls };
  };

  let harness = loadCommit(async (attempt) => {
    if (attempt === 1) throw new TypeError("HTTP response lost");
    if (attempt === 2) {
      const inFlightError = new Error("commit still in progress");
      inFlightError.status = 423;
      throw inFlightError;
    }
    return { payload: { committed: true, syncCommitToken: "same-job-token" } };
  });
  const recovered = await harness.context.commit("job-retry", 17);
  assert.equal(recovered.committed, true);
  assert.equal(harness.calls.bodies.length, 3);
  assert.equal(new Set(harness.calls.bodies.map((call) => call.body)).size, 1);
  assert.deepEqual(JSON.parse(harness.calls.bodies[0].body), {
    id: "job-retry",
    sharedStateRevision: 17
  });
  assert.deepEqual(harness.calls.delays, [400, 800]);
  assert.deepEqual(harness.calls.timeouts, [180000, 180000, 180000]);

  harness = loadCommit(async () => { throw new TypeError("network unavailable"); });
  await assert.rejects(
    () => harness.context.commit("job-unknown", 18),
    (error) => {
      assert.equal(error.studentDatabaseCommitState, "unknown");
      assert.match(error.message, /не подтвердил результат/iu);
      return true;
    }
  );
  assert.equal(harness.calls.bodies.length, 4, "Retry должен быть ограничен четырьмя запросами");
  assert.deepEqual(harness.calls.delays, [400, 800, 1600]);
  assert.deepEqual(harness.calls.timeouts, [180000, 180000, 180000, 180000]);
  assert.equal(new Set(harness.calls.bodies.map((call) => call.body)).size, 1);
}

async function testCommitAndCancellationDeadlines() {
  const calls = { timeouts: [], fetches: 0, retryDelays: [] };
  const context = {
    AbortController,
    window: {
      setTimeout: (callback, timeoutMs) => {
        calls.timeouts.push(timeoutMs);
        queueMicrotask(callback);
        return calls.timeouts.length;
      },
      clearTimeout: () => {}
    },
    photoApiUrl: (value) => value,
    fetch: async (_url, options) => {
      calls.fetches += 1;
      return new Promise((_resolve, reject) => {
        const abort = () => reject(new Error("aborted hanging response"));
        if (options.signal?.aborted) abort();
        else options.signal?.addEventListener("abort", abort, { once: true });
      });
    },
    readStudentImportResponse: async () => {
      assert.fail("Body reader не должен завершиться для зависшего ответа");
    },
    waitForStudentImportPoll: async (delay) => { calls.retryDelays.push(delay); }
  };
  vm.createContext(context);
  vm.runInContext(
    extractBetween(
      "  async function fetchWithTimeout",
      "  function updateDocumentGenerationIndicator"
    )
      + "\n"
      + extractBetween(
        "  function isRetryableStudentDatabaseCommitError",
        "  async function cancelStudentDatabaseSyncReservation"
      )
      + "\nthis.commit = commitStudentDatabaseExport;",
    context
  );
  await assert.rejects(
    () => context.commit("hanging-job", 19),
    (error) => {
      assert.equal(error.studentDatabaseCommitState, "unknown");
      return true;
    }
  );
  assert.equal(calls.fetches, 4);
  assert.deepEqual(calls.timeouts, [180000, 180000, 180000, 180000]);
  assert.deepEqual(calls.retryDelays, [400, 800, 1600]);

  calls.timeouts.length = 0;
  calls.retryDelays.length = 0;
  calls.fetches = 0;
  vm.runInContext(
    extractBetween(
      "  async function cancelStudentDatabaseSyncReservation",
      "  function cancelScheduledSharedApplicationStateSave"
    ) + "\nthis.cancel = cancelStudentDatabaseSyncReservation;",
    context
  );
  assert.equal(await context.cancel("hanging-job", "reservation-token"), false);
  assert.equal(calls.fetches, 1);
  assert.deepEqual(calls.timeouts, [5000]);
}

assert.match(
  appSource,
  /strictRevision\s*\?\s*\{\s*strictRevision:\s*true\s*\}[\s\S]{0,180}syncCommitToken/u,
  "Строгое сохранение должно передавать reservation token в shared-state POST"
);
assert.doesNotMatch(appSource, /studentSyncLedger/u);
assert.deepEqual(
  appSource.match(/studentDatabaseSyncLedger/gu),
  ["studentDatabaseSyncLedger"],
  "Старый row-level ledger допустим только в строке очистки legacy meta"
);
assert.match(appSource, /delete data\.meta\.studentDatabaseSyncLedger/u);
const synchronizationImportSource = extractBetween(
  "  async function importStudentsFromDatabase",
  "  function importJson"
);
assert.match(synchronizationImportSource, /const importAuditEntry = addAudit\(/u);
assert.match(synchronizationImportSource, /auditEntry: importAuditEntry/u);
assert.match(
  appSource,
  /synchronizationPayload:\s*committedResult\.importPayload\s*\|\|\s*result\.importPayload/u,
  "Excel → Web должен применять payload после серверного commit настроек."
);

(async () => {
  testManagedFieldClearingAndWebOnlyPreservation();
  testBaselineNormalizationAndLatestTimestamp();
  testManualContractAmountOverrideFromAudit();
  testExplicitImportDeletionSemantics();
  await testRealSynchronizationImportPath();
  await testDirectionalExportFlows();
  await testExpiredTokenRetry();
  await testCommitResponseLossRetry();
  await testCommitAndCancellationDeadlines();
  console.log("Student database directional client sync tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

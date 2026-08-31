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
  const context = {
    state: { data: { collections: {} } },
    studentDatabaseFixedValuesEqual(left, right) {
      return String(left ?? "") === String(right ?? "");
    },
    getProgramWorkbookIdentity(name, landingCode) {
      const normalizedName = String(name || "").trim().toLocaleLowerCase("ru-RU");
      const normalizedCode = String(landingCode || "").trim().toLocaleLowerCase("ru-RU");
      return normalizedName ? `${normalizedName}\u0000${normalizedCode}` : "";
    }
  };
  vm.createContext(context);
  vm.runInContext(
    extractBetween(
      "  function normalizeStudentDatabaseImportIdentityValue",
      "  function mergeImportedStudentAgentPaymentMetadata"
    )
      + "\nthis.mergeStudents = mergeStudentDatabaseImportedStudents;"
      + "\nthis.mergeRecords = mergeStudentDatabaseImportedRecords;"
      + "\nthis.refreshFormulaMetadata = applyStudentDatabaseFormulaMetadataRefresh;",
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
            {
              createdAt: "2026-08-20T11:00:00.000Z",
              entityType: "students",
              source: "document-generation"
            },
            {
              createdAt: "2026-08-20T12:00:00.000Z",
              entityType: "students",
              source: "ocr"
            },
            {
              createdAt: "2026-08-20T13:00:00.000Z",
              entityType: "students",
              source: "xlsb-sync-local"
            },
            {
              createdAt: "2026-08-20T13:30:00.000Z",
              entityType: "students",
              action: "Добавлены типовые расходы",
              source: "web"
            },
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
  const eventBaseline = context.normalizeBaseline({
    ...baseline,
    criticalHash: "C".repeat(64),
    eventSettingsHash: "D".repeat(64)
  });
  assert.equal(eventBaseline.version, 3);
  assert.equal(eventBaseline.eventSettingsHash, "d".repeat(64));
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
  context.state.data.collections.audit.push({
    createdAt: "2026-08-20T14:00:00.000Z",
    entityType: "students",
    source: "automatic-student-event"
  });
  assert.equal(
    context.auditWindow().latestCriticalAt,
    "2026-08-20T14:00:00.000Z",
    "Реальная автоматическая правка карточки должна считаться критичной"
  );
}

function testManualContractAmountOverrideFromAudit() {
  const student = {
    id: "student-db-1166",
    uid: "1166",
    name: "Добрышкина Екатерина Сергеевна",
    contractAmount: 2500,
    endDate: "2026-09-30"
  };
  const context = {
    STUDENT_DATABASE_FIXED_VALUE_OVERRIDE_FIELDS: Object.freeze([
      "contractAmount",
      "endDate"
    ]),
    state: {
      data: {
        collections: {
          audit: [{
            entityType: "students",
            entityId: "student-db-1166",
            action: "Изменена запись",
            source: "web",
            changes: [
              { field: "contractAmount", before: "4000", after: "2500" },
              { field: "endDate", before: "2026-08-26", after: "2026-09-30" }
            ]
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
  assert.deepEqual(
    Array.from(context.getOverrides(student)),
    ["contractAmount", "endDate"]
  );
  assert.deepEqual(Array.from(context.getOverrides({
    ...student,
    contractAmount: 4000,
    databaseFixedValueOverrides: ["contractAmount", "balance"]
  })), ["contractAmount", "endDate"]);
  assert.match(
    appSource,
    /changedFixedValueFields[\s\S]{0,500}databaseFixedValueOverrides/u
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
    preferredMessenger: "telegram",
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
  previous.databaseFixedValueOverrides = ["endDate"];
  const imported = {
    id: "student-db-42",
    uid: "42",
    name: "Тестова Анна",
    applicationDate: "2026-08-01",
    program: "Курс",
    frdoDate: "2026-08-20",
    databaseSyncFormulaFields: ["endDate"],
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
  assert.equal(merged[0].preferredMessenger, "telegram");
  assert.deepEqual(Array.from(merged[0].databaseSyncFormulaFields), ["endDate"]);
  assert.equal(merged[0].databaseFixedValueOverrides, undefined);
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
      webApproval: { keep: true },
      preferredMessenger: "whatsapp",
      databaseFixedValueOverrides: ["amount"]
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
  assert.equal(contract.preferredMessenger, "whatsapp");
  assert.equal(contract.databaseFixedValueOverrides, undefined);

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
      xlsbProgramLandingCode: "new",
      databaseFixedValueOverrides: ["price"]
    }],
    [{
      id: "program-stable",
      databaseSync: { recordId: "program-stable" },
      name: "Старое имя",
      xlsbProgramLandingCode: "old",
      shortName: "Имя из Excel",
      databaseSyncFormulaFields: ["price"]
    }],
    50,
    ["shortName"]
  );
  assert.equal(renamedByStableId.length, 1);
  assert.equal(renamedByStableId[0].id, "program-stable");
  assert.equal(renamedByStableId[0].shortName, "Имя из Excel");
  assert.deepEqual(Array.from(renamedByStableId[0].databaseSyncFormulaFields), ["price"]);
  assert.equal(renamedByStableId[0].databaseFixedValueOverrides, undefined);
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
      webApproval: { keep: true },
      databaseFixedValueOverrides: ["theoryHours"]
    }],
    [{
      id: "plan-stable",
      databaseSync: { recordId: "plan-stable" },
      programName: "Новая программа",
      code: "1",
      discipline: "Раздел",
      databaseSyncFormulaFields: ["theoryHours"]
    }],
    ["code", "programName", "discipline"]
  )[0];
  assert.equal(
    movedPlan.programId,
    "",
    "При смене программы в Excel старый programId должен быть сброшен перед сопоставлением."
  );
  assert.deepEqual(movedPlan.webApproval, { keep: true });
  assert.deepEqual(Array.from(movedPlan.databaseSyncFormulaFields), ["theoryHours"]);
  assert.equal(movedPlan.databaseFixedValueOverrides, undefined);
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
  const indicatorUpdates = [];
  const sharedStateRequests = [];
  const flushedGenerations = [];
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
    sharedStateReady: true,
    sharedStateConflict: false,
    sharedStateOffline: false,
    sharedStatePendingCount: 0,
    sharedStatePendingPatch: null,
    sharedStateDirty: false,
    sharedStateSavePromise: null,
    sharedStateChangeGeneration: 3,
    performance: { now: () => 1000 },
    alert: () => assert.fail("alert не ожидается"),
    confirm: () => true,
    isSettingsDraftSessionActive: () => false,
    hasUnsavedSettingsChanges: () => false,
    saveSettingsDraftChanges: async () => true,
    waitForStudentImportPoll: async () => {},
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
    flushSharedApplicationState: async () => {
      order.push("active-save");
      context.sharedStateDirty = false;
      context.sharedStatePendingPatch = null;
      context.sharedStateSavePromise = null;
      return true;
    },
    requestSharedApplicationState: async (pathname, options = {}) => {
      order.push("flush-mysql");
      sharedStateRequests.push({ pathname, options });
      return context.authoritativeSharedState || {
        exists: true,
        data: context.state.data,
        revision: context.sharedStateRevision,
        writable: true,
        offline: false,
        pendingCount: 0,
        syncPending: false
      };
    },
    applySharedApplicationState: (payload, options = {}) => {
      order.push("apply-mysql");
      context.appliedSharedStateOptions = options;
      if (!payload?.exists || !payload.data) return false;
      context.state.data = payload.data;
      context.sharedStateRevision = Math.max(0, Number(payload.revision) || 0);
      context.sharedStateConflict = false;
      context.sharedStateOffline = Boolean(payload.offline);
      context.sharedStatePendingCount = Math.max(0, Number(payload.pendingCount) || 0);
      return true;
    },
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
    applyStudentDatabaseFormulaMetadataRefresh: () => 0,
    runStudentDatabaseExport: async (body) => {
      order.push("run");
      context.exportBody = body;
      return { ...result, jobId: result.jobId || "job-1" };
    },
    chooseStudentDatabaseSyncConflictResolutions: async (conflicts, options) => {
      order.push("resolve-conflicts");
      context.receivedConflicts = conflicts;
      context.receivedConflictOptions = options;
      return context.conflictResolutions || null;
    },
    updateDatabaseExportIndicator: (patch) => { indicatorUpdates.push({ ...patch }); },
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
        criticalIdentityHash: args[5],
        eventSettingsHash: args[6]
      };
    },
    importStudentsFromDatabase: async () => {
      order.push("import");
      return { studentCount: 1, auditEntry: { action: "excel-import" } };
    },
    cancelScheduledSharedApplicationStateSave: () => { order.push("cancel-scheduled-save"); },
    flushStudentDatabaseSynchronizationState: async () => { order.push("strict-flush"); },
    persist: () => { order.push("persist"); },
    addAudit: () => {
      order.push("audit");
      return { action: "web-export" };
    },
    postAuditEntry: async () => { order.push("post-audit"); },
    flushSharedApplicationStateThroughGeneration: async (generation, options = {}) => {
      flushedGenerations.push({ generation, options });
      order.push(options.strictRevision === true ? "baseline-flush" : "mysql-generation-flush");
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
  context.indicatorUpdates = indicatorUpdates;
  context.sharedStateRequests = sharedStateRequests;
  context.flushedGenerations = flushedGenerations;
  vm.createContext(context);
  vm.runInContext(
    extractBetween("  function getStudentDatabaseSyncFailureDetails", "  async function downloadStudentsDatabase")
      + "\nthis.operation = exportStudentsToDatabase;"
      + "\nthis.buildSyncFailureItem = buildStudentDatabaseSyncFailureItem;",
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
  assert.equal(unchanged.sharedStateRequests[0].pathname, "flush=1");
  assert.equal(
    unchanged.sharedStateRequests[0].options.sharedStateProgress.message,
    "Передача Web-данных в MySQL"
  );
  assert.ok(unchanged.order.indexOf("mysql-generation-flush") < unchanged.order.indexOf("flush-mysql"));
  assert.ok(unchanged.order.indexOf("flush-mysql") < unchanged.order.indexOf("apply-mysql"));
  assert.ok(unchanged.order.indexOf("apply-mysql") < unchanged.order.indexOf("run"));
  assert.equal(unchanged.appliedSharedStateOptions.renderAfter, false);
  assert.ok(unchanged.indicatorUpdates.some((item) => /\u042dтап 1 из 2/iu.test(item.status || "")));
  assert.ok(unchanged.indicatorUpdates.some((item) => /\u042dтап 2 из 2/iu.test(item.status || "")));

  const recovery = makeExportContext({
    syncDirection: "unchanged",
    sourceHash: "a".repeat(64),
    sourceIdentity: "b".repeat(64),
    studentCount: 1
  });
  recovery.sharedStateChangeGeneration = 0;
  recovery.sharedStateDirty = false;
  recovery.sharedStatePendingPatch = { collections: { students: { upserts: [{ id: "pending" }] } } };
  recovery.sharedStateOffline = true;
  recovery.sharedStatePendingCount = 1;
  const authoritativeData = {
    ...recovery.state.data,
    collections: { students: [{ id: "authoritative-student" }] }
  };
  recovery.authoritativeSharedState = {
    exists: true,
    data: authoritativeData,
    revision: 12,
    writable: true,
    offline: false,
    pendingCount: 0,
    syncPending: false
  };
  recovery.buildStudentDatabaseExportStudents = () => recovery.state.data.collections.students;
  await recovery.operation({ shiftKey: false });
  assert.ok(recovery.order.indexOf("active-save") < recovery.order.indexOf("flush-mysql"));
  assert.equal(recovery.flushedGenerations[0].generation, 0);
  assert.equal(recovery.flushedGenerations[0].options.allowSettingsDraft, true);
  assert.equal(recovery.state.data.collections.students[0].id, "authoritative-student");
  assert.equal(recovery.exportBody.students[0].id, "authoritative-student");
  assert.equal(recovery.exportBody.sharedStateRevision, 12);

  const cachedPending = makeExportContext({ syncDirection: "unchanged" });
  cachedPending.authoritativeSharedState = {
    exists: true,
    data: cachedPending.state.data,
    revision: 8,
    writable: true,
    offline: true,
    pendingCount: 1,
    syncPending: true
  };
  await cachedPending.operation({ shiftKey: false });
  assert.equal(cachedPending.sharedStateRequests.length, 3);
  assert.equal(cachedPending.order.includes("apply-mysql"), false);
  assert.equal(cachedPending.order.includes("run"), false);

  const transientLock = makeExportContext({
    syncDirection: "unchanged",
    sourceHash: "a".repeat(64),
    sourceIdentity: "b".repeat(64),
    studentCount: 1
  });
  let transientLockRequests = 0;
  const transientRetryDelays = [];
  transientLock.waitForStudentImportPoll = async (delay) => { transientRetryDelays.push(delay); };
  transientLock.requestSharedApplicationState = async (pathname, options = {}) => {
    transientLockRequests += 1;
    transientLock.order.push("flush-mysql");
    transientLock.sharedStateRequests.push({ pathname, options });
    if (transientLockRequests === 1) {
      const error = new Error(
        "Передача ожидающих изменений в MySQL временно заблокирована редактируемой записью."
      );
      error.status = 423;
      throw error;
    }
    return {
      exists: true,
      data: transientLock.state.data,
      revision: 8,
      writable: true,
      offline: false,
      pendingCount: 0,
      syncPending: false
    };
  };
  await transientLock.operation({ shiftKey: false });
  assert.equal(transientLockRequests, 2);
  assert.deepEqual(transientRetryDelays, [400]);
  assert.equal(transientLock.order.includes("run"), true);

  const generationRace = makeExportContext({
    syncDirection: "unchanged",
    sourceHash: "a".repeat(64),
    sourceIdentity: "b".repeat(64),
    studentCount: 1
  });
  let generationRaceRequests = 0;
  generationRace.requestSharedApplicationState = async (pathname, options = {}) => {
    generationRaceRequests += 1;
    generationRace.order.push("flush-mysql");
    generationRace.sharedStateRequests.push({ pathname, options });
    if (generationRaceRequests === 1) {
      generationRace.sharedStateChangeGeneration += 1;
      generationRace.sharedStateDirty = true;
      generationRace.sharedStatePendingPatch = { meta: { changedDuringFlush: true } };
    }
    return {
      exists: true,
      data: generationRace.state.data,
      revision: 9,
      writable: true,
      offline: false,
      pendingCount: 0,
      syncPending: false
    };
  };
  await generationRace.operation({ shiftKey: false });
  assert.equal(generationRaceRequests, 2);
  assert.equal(generationRace.order.filter((item) => item === "apply-mysql").length, 1);
  assert.ok(generationRace.order.lastIndexOf("apply-mysql") < generationRace.order.indexOf("run"));
  assert.equal(generationRace.exportBody.sharedStateRevision, 9);

  const settingsDraft = makeExportContext({
    syncDirection: "unchanged",
    sourceHash: "a".repeat(64),
    sourceIdentity: "b".repeat(64),
    studentCount: 1
  });
  let settingsDirty = true;
  settingsDraft.isSettingsDraftSessionActive = () => true;
  settingsDraft.hasUnsavedSettingsChanges = () => settingsDirty;
  settingsDraft.saveSettingsDraftChanges = async (options) => {
    settingsDraft.order.push("save-settings");
    assert.equal(options.renderAfterSave, false);
    settingsDirty = false;
    return true;
  };
  await settingsDraft.operation({ shiftKey: false });
  assert.ok(settingsDraft.order.indexOf("save-settings") < settingsDraft.order.indexOf("flush-mysql"));
  assert.ok(settingsDraft.order.indexOf("apply-mysql") < settingsDraft.order.indexOf("run"));

  const eventBaselineMigration = makeExportContext({
    syncDirection: "unchanged",
    sourceHash: "a".repeat(64),
    sourceIdentity: "b".repeat(64),
    criticalHash: "c".repeat(64),
    eventSettingsHash: "d".repeat(64),
    studentCount: 1
  });
  await eventBaselineMigration.operation({ shiftKey: false });
  assert.equal(eventBaselineMigration.order.includes("persist"), true);
  assert.equal(eventBaselineMigration.order.includes("baseline-flush"), true);
  assert.equal(eventBaselineMigration.baselineCalls[0][6], "d".repeat(64));

  const conflictId = "c".repeat(64);
  const conflictMerge = makeExportContext({ syncDirection: "conflicts" });
  conflictMerge.conflictResolutions = { [conflictId]: "excel" };
  const conflictBodies = [];
  conflictMerge.runStudentDatabaseExport = async (body) => {
    conflictBodies.push(body);
    conflictMerge.order.push("run");
    if (conflictBodies.length === 1) {
      return {
        syncDirection: "conflicts",
        syncConflictCount: 1,
        syncConflicts: [{ id: conflictId, record: "Пащенко", field: "Примечание" }],
        jobId: "conflict-check"
      };
    }
    return {
      syncDirection: "web-to-excel",
      requiresCommit: true,
      sourceHash: "1".repeat(64),
      sourceIdentity: "2".repeat(64),
      studentCount: 1,
      mergedBidirectional: true,
      jobId: "resolved-job"
    };
  };
  conflictMerge.commitResult = {
    committed: true,
    syncCommitToken: "resolved-token",
    sourceHash: "3".repeat(64),
    sourceIdentity: "2".repeat(64)
  };
  await conflictMerge.operation({ shiftKey: false });
  assert.equal(conflictBodies.length, 2);
  assert.deepEqual(
    { ...conflictBodies[1].syncConflictResolutions },
    { [conflictId]: "excel" }
  );
  assert.deepEqual(conflictMerge.receivedConflicts, [
    { id: conflictId, record: "Пащенко", field: "Примечание" }
  ]);
  assert.equal(conflictMerge.receivedConflictOptions.completeReconciliation, false);
  assert.ok(
    conflictMerge.order.indexOf("resolve-conflicts") < conflictMerge.order.indexOf("commit"),
    "XLSB можно сохранять только после выбора пользователя"
  );

  const completeConflictId = "d".repeat(64);
  const completeReconciliation = makeExportContext({ syncDirection: "conflicts" });
  completeReconciliation.conflictResolutions = { [completeConflictId]: "web" };
  const completeReconciliationBodies = [];
  completeReconciliation.runStudentDatabaseExport = async (body) => {
    completeReconciliationBodies.push(body);
    completeReconciliation.order.push("run");
    if (completeReconciliationBodies.length === 1) {
      return {
        syncDirection: "conflicts",
        syncConflictMode: "complete-reconciliation",
        syncConflictComplete: true,
        syncConflictCount: 1,
        syncConflicts: [{
          id: completeConflictId,
          kind: "record-presence",
          entity: "Слушатели",
          record: "Загодарчук Инна Владимировна",
          field: "Наличие записи",
          web: "Сохранить запись",
          excel: "Удалить запись",
          reason: "Запись существует только в Web.",
          destructive: true
        }],
        jobId: "complete-conflict-check"
      };
    }
    return {
      syncDirection: "web-to-excel",
      requiresCommit: true,
      sourceHash: "4".repeat(64),
      sourceIdentity: "5".repeat(64),
      studentCount: 1,
      mergedBidirectional: true,
      jobId: "complete-resolved-job"
    };
  };
  completeReconciliation.commitResult = {
    committed: true,
    syncCommitToken: "complete-resolved-token",
    sourceHash: "6".repeat(64),
    sourceIdentity: "5".repeat(64)
  };
  await completeReconciliation.operation({ shiftKey: false });
  assert.equal(completeReconciliationBodies.length, 2);
  assert.equal(completeReconciliation.receivedConflictOptions.completeReconciliation, true);
  assert.equal(completeReconciliation.receivedConflicts[0].kind, "record-presence");
  assert.equal(completeReconciliation.receivedConflicts[0].web, "Сохранить запись");
  assert.equal(completeReconciliation.receivedConflicts[0].excel, "Удалить запись");
  assert.deepEqual(
    { ...completeReconciliationBodies[1].syncConflictResolutions },
    { [completeConflictId]: "web" }
  );

  const firstChangingConflictId = "e".repeat(64);
  const secondChangingConflictId = "f".repeat(64);
  const changingConflicts = makeExportContext({ syncDirection: "conflicts" });
  const changingConflictBodies = [];
  changingConflicts.chooseStudentDatabaseSyncConflictResolutions = async (conflicts, options) => {
    changingConflicts.order.push("resolve-conflicts");
    changingConflicts.receivedConflicts = conflicts;
    changingConflicts.receivedConflictOptions = options;
    const id = String(conflicts[0]?.id || "");
    return id ? { [id]: id === firstChangingConflictId ? "web" : "excel" } : {};
  };
  changingConflicts.runStudentDatabaseExport = async (body) => {
    changingConflictBodies.push(body);
    changingConflicts.order.push("run");
    if (changingConflictBodies.length === 1) {
      return {
        syncDirection: "conflicts",
        syncConflictCount: 1,
        syncConflicts: [{ id: firstChangingConflictId, record: "Первая запись", field: "Примечание" }],
        jobId: "changing-conflicts-first"
      };
    }
    if (changingConflictBodies.length === 2) {
      return {
        syncDirection: "conflicts",
        syncConflictCount: 1,
        syncConflicts: [{ id: secondChangingConflictId, record: "Вторая запись", field: "Статус" }],
        jobId: "changing-conflicts-second"
      };
    }
    return {
      syncDirection: "web-to-excel",
      requiresCommit: true,
      sourceHash: "7".repeat(64),
      sourceIdentity: "8".repeat(64),
      studentCount: 2,
      mergedBidirectional: true,
      jobId: "changing-conflicts-resolved"
    };
  };
  changingConflicts.commitResult = {
    committed: true,
    syncCommitToken: "changing-conflicts-token",
    sourceHash: "9".repeat(64),
    sourceIdentity: "8".repeat(64)
  };
  await changingConflicts.operation({ shiftKey: false });
  assert.equal(changingConflictBodies.length, 3);
  assert.deepEqual({ ...changingConflictBodies[1].syncConflictResolutions }, {
    [firstChangingConflictId]: "web"
  });
  assert.deepEqual({ ...changingConflictBodies[2].syncConflictResolutions }, {
    [firstChangingConflictId]: "web",
    [secondChangingConflictId]: "excel"
  });

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

  const detailedFailure = makeExportContext({
    syncDirection: "unchanged",
    sourceHash: "4".repeat(64),
    sourceIdentity: "5".repeat(64),
    studentCount: 1
  });
  detailedFailure.runStudentDatabaseExport = async () => {
    const error = new Error("Web и XLSB содержат одновременные изменения.");
    error.payload = {
      status: "failed",
      failureDetails: {
        kind: "student-database-sync-difference-diagnostics",
        diagnosticOnly: true,
        count: 1,
        rows: [{
          id: "conflict-1",
          entity: "Слушатели",
          record: "Пащенко Анна",
          field: "Примечание",
          baseline: "",
          web: "Новое примечание Web",
          excel: "Дополнительный статус XLSB"
        }],
        truncated: false,
        note: "Сравнение выполнено без изменения файла."
      }
    };
    throw error;
  };
  await detailedFailure.operation({ shiftKey: false });
  const detailedFailureResult = detailedFailure.operationResults.at(-1);
  assert.equal(detailedFailureResult.items.length, 1);
  assert.equal(detailedFailureResult.items[0].key, "sync-conflicts");
  assert.equal(detailedFailureResult.items[0].problem, true);
  assert.equal(detailedFailureResult.items[0].value, 1);
  assert.equal(detailedFailureResult.items[0].rows[0].record, "Пащенко Анна");
  assert.equal(detailedFailureResult.items[0].rows[0].web, "Новое примечание Web");
  assert.equal(detailedFailureResult.items[0].rows[0].excel, "Дополнительный статус XLSB");
  assert.equal(
    detailedFailureResult.details.find((item) => item.label === "Состояние XLSB")?.value,
    "Запись в файл не начиналась"
  );

  const alternativeFailureItem = detailedFailure.buildSyncFailureItem({
    payload: {
      failureDetails: {
        syncConflictCount: 1,
        syncConflicts: [{
          section: "Договоры",
          name: "Договор 42",
          fieldName: "amount",
          before: "3 600",
          after: "4 100"
        }]
      }
    }
  });
  assert.equal(alternativeFailureItem.rows[0].entity, "Договоры");
  assert.equal(alternativeFailureItem.rows[0].record, "Договор 42");
  assert.equal(alternativeFailureItem.rows[0].web, "3 600");
  assert.equal(alternativeFailureItem.rows[0].excel, "4 100");

  const compatibleFailureItem = detailedFailure.buildSyncFailureItem({
    payload: {
      syncConflicts: [{
        entity: "Слушатели",
        record: "Пащенко Мария",
        field: "Примечание",
        web: "Web",
        excel: "XLSB"
      }],
      syncConflictsTruncated: true,
      failureDetails: {
        kind: "student-database-sync-conflict-diagnostics",
        rows: []
      }
    }
  });
  assert.equal(compatibleFailureItem.rows.length, 1);
  assert.equal(compatibleFailureItem.rows[0].record, "Пащенко Мария");
  assert.equal(compatibleFailureItem.rowsTruncated, true);

  const emptyDiagnosticItem = detailedFailure.buildSyncFailureItem({
    payload: {
      failureDetails: {
        kind: "student-database-sync-difference-diagnostics",
        diagnosticOnly: true,
        count: 0,
        rows: [],
        note: "Серверный журнал не покрывает контрольную точку."
      }
    }
  });
  assert.equal(emptyDiagnosticItem.key, "sync-conflicts");
  assert.equal(emptyDiagnosticItem.problem, true);
  assert.equal(emptyDiagnosticItem.value, "Не определены");
  assert.equal(emptyDiagnosticItem.rows.length, 0);
  assert.match(emptyDiagnosticItem.note, /не покрывает контрольную точку/iu);
}

function testFormulaMetadataRefreshCopiesOnlyFormulaBackedValues() {
  const helpers = loadImportMergeHelpers();
  helpers.state.data.collections = {
    students: [{
      id: "student-1",
      uid: "1",
      name: "Тестова Анна",
      endDate: "",
      note: "Web note",
      directExpenses: [{
        id: "expense-1",
        uid: "1",
        date: "2026-08-01",
        type: "Почта",
        amount: 100
      }]
    }],
    directExpenses: [],
    programs: [{
      id: "program-1",
      name: "Курс",
      landingCode: "course",
      hours: 36,
      price: 5000,
      databaseSyncFormulaFields: ["price"],
      databaseFixedValueOverrides: ["price"]
    }],
    trainingPlans: [{
      id: "plan-1",
      programName: "Курс",
      discipline: "Раздел",
      code: "1",
      theoryHours: 1
    }]
  };
  const changed = helpers.refreshFormulaMetadata({
    students: [{
      id: "student-1",
      uid: "1",
      name: "Тестова Анна",
      endDate: "2026-09-30",
      note: "Excel note",
      databaseSyncFormulaFields: ["endDate"],
      directExpenses: [{
        id: "expense-1",
        uid: "1",
        date: "2026-08-01",
        type: "Почта",
        amount: 300,
        databaseSyncFormulaFields: ["amount"]
      }]
    }],
    directExpenses: [],
    programPaymentSettings: [{
      id: "program-1",
      name: "Курс",
      landingCode: "course",
      hours: 72,
      price: 7000,
      databaseSyncFormulaFields: ["hours"]
    }],
    trainingPlans: [{
      id: "plan-1",
      programName: "Курс",
      discipline: "Раздел",
      code: "2",
      theoryHours: 4,
      databaseSyncFormulaFields: ["code", "theoryHours"]
    }]
  });
  assert.equal(changed, 4);
  assert.equal(helpers.state.data.collections.students[0].endDate, "2026-09-30");
  assert.equal(helpers.state.data.collections.students[0].note, "Web note");
  assert.equal(helpers.state.data.collections.students[0].directExpenses[0].amount, 300);
  assert.equal(helpers.state.data.collections.programs[0].hours, 72);
  assert.equal(
    helpers.state.data.collections.programs[0].price,
    5000,
    "A value whose output cell is no longer formula-backed must stay unchanged"
  );
  assert.deepEqual(
    Array.from(helpers.state.data.collections.programs[0].databaseFixedValueOverrides),
    ["price"],
    "Metadata refresh must not discard a fixed-value decision"
  );
  assert.equal(helpers.state.data.collections.trainingPlans[0].code, "2");
  assert.equal(helpers.state.data.collections.trainingPlans[0].theoryHours, 4);
  const stateBeforeFailedRefresh = JSON.stringify(helpers.state.data.collections);
  assert.throws(
    () => helpers.refreshFormulaMetadata({
      students: [],
      directExpenses: [],
      trainingPlans: [],
      programPaymentSettings: [
        {
          id: "program-1",
          name: "Курс",
          landingCode: "course",
          hours: 80,
          databaseSyncFormulaFields: ["hours"]
        },
        {
          id: "unmatched-a",
          name: "Дубль",
          price: 100,
          databaseSyncFormulaFields: ["price"]
        },
        {
          id: "unmatched-b",
          name: "Дубль",
          price: 200,
          databaseSyncFormulaFields: ["price"]
        }
      ]
    }),
    /Контрольная точка не изменена/iu
  );
  assert.equal(
    JSON.stringify(helpers.state.data.collections),
    stateBeforeFailedRefresh,
    "A failed metadata refresh must not partially mutate Web records"
  );
}

async function testFailedBackgroundJobPayloadPreserved() {
  const failureDetails = {
    kind: "student-database-sync-difference-diagnostics",
    count: 1,
    rows: [{ record: "Пащенко", field: "Примечание", web: "Web", excel: "XLSB" }]
  };
  const responses = [
    { payload: { id: "failed-job" } },
    {
      payload: {
        id: "failed-job",
        status: "failed",
        statusCode: 409,
        error: "Обнаружены одновременные изменения.",
        failureDetails
      }
    }
  ];
  const context = {
    photoApiUrl: (value) => value,
    fetch: async () => responses.shift(),
    readStudentImportResponse: async (response) => response.payload,
    updateDatabaseExportIndicator: () => {},
    waitForStudentImportPoll: async () => {},
    getDownloadFileNameFromResponse: () => "АИС Допобразование.xlsb"
  };
  vm.createContext(context);
  vm.runInContext(
    extractBetween(
      "  async function runStudentDatabaseExportAttempt",
      "  async function runStudentDatabaseExport(body)"
    ) + "\nthis.runAttempt = runStudentDatabaseExportAttempt;",
    context
  );
  await assert.rejects(
    () => context.runAttempt({ downloadOnly: false }),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.payload.status, "failed");
      assert.equal(error.payload.failureDetails, failureDetails);
      assert.equal(error.failureDetails, failureDetails);
      return true;
    }
  );
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
assert.match(appSource, /function chooseStudentDatabaseSyncConflictResolutions/u);
const conflictChooserSource = extractBetween(
  "  function chooseStudentDatabaseSyncConflictResolutions",
  "  function getStudentDatabaseSyncFailureDetails"
);
assert.match(appSource, /data-conflict-bulk="web-selected"/u);
assert.match(appSource, /data-conflict-bulk="excel-selected"/u);
assert.match(appSource, /data-conflict-bulk="web-all"/u);
assert.match(appSource, /data-conflict-bulk="excel-all"/u);
assert.match(conflictChooserSource, /Перечислены ВСЕ критичные расхождения Web и XLSB/u);
assert.match(conflictChooserSource, /наличие или удаление записей/u);
assert.match(conflictChooserSource, /«Сохранить запись» или «Удалить запись»/u);
assert.match(conflictChooserSource, />XLSB для отмеченных</u);
assert.match(conflictChooserSource, />XLSB для всех</u);
assert.match(conflictChooserSource, /<th>XLSB<\/th>/u);
assert.match(conflictChooserSource, /> XLSB<\/label>/u);
assert.doesNotMatch(conflictChooserSource, />Excel(?:<|\s)/u);
assert.match(conflictChooserSource, /data-conflict-kind=/u);
assert.match(conflictChooserSource, /title="\$\{escapeAttr\(conflict\.reason/u);
assert.match(conflictChooserSource, /continueButton\.disabled = unresolved > 0/u);
assert.match(conflictChooserSource, /if \(choices\.size !== conflicts\.length\) return;/u);
assert.match(appSource, /result\.syncConflictMode === "complete-reconciliation"/u);
assert.match(appSource, /result\.syncConflictComplete === true/u);
assert.match(appSource, /const cumulativeConflictResolutions = \{\}/u);
assert.match(appSource, /Object\.assign\(cumulativeConflictResolutions, resolutions\)/u);
assert.match(
  appSource,
  /syncConflictResolutions:\s*\{\s*\.\.\.cumulativeConflictResolutions\s*\}/u
);
const sharedStatePollSource = extractBetween(
  "  async function pollSharedApplicationState()",
  "  function recordLockKey"
);
assert.match(sharedStatePollSource, /state\.databaseExport\.running/u);
assert.match(sharedStatePollSource, /state\.databaseImport\.running/u);

(async () => {
  testManagedFieldClearingAndWebOnlyPreservation();
  testFormulaMetadataRefreshCopiesOnlyFormulaBackedValues();
  testBaselineNormalizationAndLatestTimestamp();
  testManualContractAmountOverrideFromAudit();
  testExplicitImportDeletionSemantics();
  await testRealSynchronizationImportPath();
  await testDirectionalExportFlows();
  await testFailedBackgroundJobPayloadPreserved();
  await testExpiredTokenRetry();
  await testCommitResponseLossRetry();
  await testCommitAndCancellationDeadlines();
  console.log("Student database directional client sync tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

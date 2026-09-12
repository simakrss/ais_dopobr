const assert = require("node:assert/strict");
const path = require("node:path");

const serverPath = path.resolve(__dirname, "..", "app-server.js");
const { buildStudentDatabaseSynchronizedChanges } = require(serverPath);

function emptyDatabase(overrides = {}) {
  return {
    students: [],
    contracts: [],
    directExpenses: [],
    generalExpenses: [],
    inventoryRows: [],
    programs: [],
    trainingPlans: [],
    ...overrides
  };
}

const before = emptyDatabase({
  students: [{
    id: "student-db-1166",
    uid: "1166",
    name: "Добрышкина Елена Сергеевна",
    status: "Учится",
    program: "Программа повышения квалификации (72 ч)",
    contractAmount: 4000,
    paidAmount: 1000,
    balance: 3000,
    agentAmount: 250,
    portalAccessMessage: "Старый вычисленный результат формулы"
  }],
  directExpenses: [{
    id: "expense-1",
    uid: "1166",
    date: "2026-08-20",
    type: "Почтовое отправление",
    amount: 130,
    note: "Почта России"
  }]
});

const after = emptyDatabase({
  students: [{
    id: "web-student-1166",
    uid: "1166",
    name: "Добрышкина Елена Сергеевна",
    status: "Учится",
    program: "Программа повышения квалификации (72 ч)",
    contractAmount: 2500,
    paidAmount: 2500,
    balance: 0,
    agentAmount: 625,
    portalAccessMessage: "Новый вычисленный результат той же формулы"
  }],
  programs: [{
    id: "program-1",
    name: "Новая образовательная программа",
    landingCode: "9001",
    type: "КПК",
    status: "Набор"
  }]
});

const report = buildStudentDatabaseSynchronizedChanges(before, after);
assert.equal(report.totalCount, 3);
assert.equal(report.rows.length, 3);
assert.equal(report.truncated, false);
assert.deepEqual(report.entityCounts, {
  students: 1,
  directExpenses: 1,
  programs: 1
});

const contractAmountChange = report.rows.find((row) => (
  row.entity === "Слушатели" && row.field === "Сумма по договору (руб)"
));
assert.ok(contractAmountChange, "Изменение суммы договора должно попасть в протокол");
assert.equal(contractAmountChange.record, "Добрышкина Елена Сергеевна [1166]");
assert.equal(contractAmountChange.action, "Изменено");
assert.equal(contractAmountChange.before, "4000");
assert.equal(contractAmountChange.after, "2500");

assert.equal(
  report.rows.some((row) => [
    "Внесено (руб)",
    "Остаток по договору (руб)",
    "АгентСумма",
    "СообщЛогин"
  ]
    .includes(row.field)),
  false,
  "Вычисляемые поля и результаты формул не должны засорять протокол"
);
assert.equal(
  report.rows.find((row) => row.entity === "Прямые затраты")?.action,
  "Удалено"
);
assert.equal(
  report.rows.find((row) => row.entity === "Программы")?.action,
  "Добавлено"
);

const limited = buildStudentDatabaseSynchronizedChanges(before, after, { limit: 2 });
assert.equal(limited.totalCount, 3);
assert.equal(limited.rows.length, 2);
assert.equal(limited.truncated, true);

const unchanged = buildStudentDatabaseSynchronizedChanges(after, after);
assert.equal(unchanged.totalCount, 0);
assert.deepEqual(unchanged.rows, []);

const realChangesBefore = emptyDatabase({
  students: [
    {
      id: "student-db-1166",
      uid: "1166",
      name: "Добрышкина Елена Сергеевна",
      additionalStatus: "Обучающиеся"
    },
    {
      id: "student-db-1171",
      uid: "1171",
      name: "Загодарчук Инна Владимировна",
      additionalStatus: "Обучающиеся"
    },
    {
      id: "student-formula-1",
      uid: "1172",
      name: "Формульное поле",
      contractAmount: 4000,
      databaseSyncFormulaFields: ["contractAmount"]
    }
  ],
  contracts: [{
    id: "contract-1",
    section: "Сотрудники",
    name: "Технический договор",
    contractNo: "1",
    contractDate: "2026-08-01",
    whatsapp: "Сохранённое Web-значение"
  }],
  directExpenses: [{
    id: "expense-formula-1",
    uid: "1166",
    date: "2026-08-28",
    type: "Оплата сотруднику",
    recommendation: "+",
    databaseSyncFormulaFields: ["recommendation"]
  }],
  trainingPlans: [{
    id: "training-plan-formula-1",
    code: "ТП-1",
    programName: "Тестовая программа",
    discipline: "Модуль",
    totalHours: 72
  }],
  studentDatabaseSyncFields: ["uid", "name", "additionalStatus", "contractAmount"],
  contractDatabaseSyncFields: ["section", "name", "contractNo", "contractDate", "whatsapp"],
  directExpenseDatabaseSyncFields: ["uid", "date", "type", "recommendation"],
  trainingPlanDatabaseSyncFields: ["code", "programName", "discipline", "totalHours"]
});
const realChangesAfter = emptyDatabase({
  students: [
    {
      id: "student-db-1166",
      uid: "1166",
      name: "Добрышкина Елена Сергеевна",
      additionalStatus: "Печать документов"
    },
    {
      id: "student-db-1171",
      uid: "1171",
      name: "Загодарчук Инна Владимировна",
      additionalStatus: "Печать документов"
    },
    {
      id: "student-formula-1",
      uid: "1172",
      name: "Формульное поле",
      contractAmount: 4500,
      databaseSyncFormulaFields: ["contractAmount"]
    }
  ],
  contracts: [{
    id: "contract-1",
    section: "Сотрудники",
    name: "Технический договор",
    contractNo: "1",
    contractDate: "2026-08-01",
    whatsapp: ""
  }],
  directExpenses: [{
    id: "expense-formula-1",
    uid: "1166",
    date: "2026-08-28",
    type: "Оплата сотруднику",
    recommendation: "—",
    databaseSyncFormulaFields: ["recommendation"]
  }],
  trainingPlans: [{
    id: "training-plan-formula-1",
    code: "ТП-1",
    programName: "Тестовая программа",
    discipline: "Модуль",
    totalHours: 80
  }],
  studentDatabaseSyncFields: ["uid", "name", "additionalStatus", "contractAmount"],
  contractDatabaseSyncFields: ["section", "name", "contractNo", "contractDate", "whatsapp"],
  directExpenseDatabaseSyncFields: ["uid", "date", "type", "recommendation"],
  trainingPlanDatabaseSyncFields: ["code", "programName", "discipline", "totalHours"]
});
const realChangesReport = buildStudentDatabaseSynchronizedChanges(
  realChangesBefore,
  realChangesAfter
);
assert.equal(realChangesReport.totalCount, 2);
assert.equal(realChangesReport.rows.length, 2);
assert.deepEqual(realChangesReport.entityCounts, { students: 2 });
assert.ok(realChangesReport.rows.every((row) => row.field === "Доп. статус"));
assert.deepEqual(
  realChangesReport.rows.map((row) => row.recordId).sort(),
  ["student-db-1166", "student-db-1171"]
);

const fixedFormulaBefore = emptyDatabase({
  students: [{
    id: "student-fixed-formula-1",
    uid: "1173",
    name: "Зафиксированная формула",
    contractAmount: 4000,
    databaseSyncFormulaFields: ["contractAmount"]
  }]
});
const fixedFormulaAfter = emptyDatabase({
  students: [{
    id: "student-fixed-formula-1",
    uid: "1173",
    name: "Зафиксированная формула",
    contractAmount: 5000
  }]
});
const fixedFormulaReport = buildStudentDatabaseSynchronizedChanges(
  fixedFormulaBefore,
  fixedFormulaAfter
);
assert.equal(fixedFormulaReport.totalCount, 1);
assert.equal(fixedFormulaReport.rows[0].field, "Сумма по договору (руб)");

const schemaFilteredReport = buildStudentDatabaseSynchronizedChanges(
  emptyDatabase({
    students: [{ id: "student-schema-1", uid: "1174", name: "Схема", note: "До" }]
  }),
  emptyDatabase({
    students: [{ id: "student-schema-1", uid: "1174", name: "Схема", note: "После" }],
    studentDatabaseSyncFields: ["uid", "name"]
  })
);
assert.equal(schemaFilteredReport.totalCount, 0);

console.log("student database synchronized change report checks: OK");

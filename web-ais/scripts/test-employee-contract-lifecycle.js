"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

process.env.AIS_SHARED_STATE_LOCAL_ONLY = "1";

const ROOT = path.resolve(__dirname, "..");
const server = require(path.join(ROOT, "app-server.js"));
const {
  buildEmployeeAuthDirectory,
  getEmployeeAuthAccess,
  getMoscowCalendarDateKey,
  isSharedApplicationContractPastEndDate,
  normalizeSharedApplicationData,
  normalizeSharedApplicationContractExpirationRows,
  normalizeSharedApplicationStatePatch,
  sharedApplicationDataNeedsContractExpiration
} = server;

[
  ["getMoscowCalendarDateKey", getMoscowCalendarDateKey],
  ["isSharedApplicationContractPastEndDate", isSharedApplicationContractPastEndDate],
  ["normalizeSharedApplicationData", normalizeSharedApplicationData],
  ["normalizeSharedApplicationContractExpirationRows", normalizeSharedApplicationContractExpirationRows],
  ["normalizeSharedApplicationStatePatch", normalizeSharedApplicationStatePatch],
  ["sharedApplicationDataNeedsContractExpiration", sharedApplicationDataNeedsContractExpiration]
].forEach(([name, helper]) => {
  assert.equal(typeof helper, "function", `Сервер не экспортирует ${name}.`);
});

const ACTIVE_SECTION = "ДЕЙСТВУЮЩИЕ ДОГОВОРА";
const PARTNER_SECTION = "ПАРТНЕРСКАЯ ПРОГРАММА";
const EXPIRED_SECTION = "ИСТЕКШИЕ ДОГОВОРА";
const TODAY = "2026-09-07";

assert.equal(
  getMoscowCalendarDateKey("2026-09-06T20:59:59.999Z"),
  "2026-09-06",
  "До 21:00 UTC московский календарный день ещё не должен переключаться."
);
assert.equal(
  getMoscowCalendarDateKey("2026-09-06T21:00:00.000Z"),
  TODAY,
  "В 00:00 по Москве должен начинаться новый календарный день."
);
assert.equal(getMoscowCalendarDateKey("не дата"), "");

const contractRows = [
  {
    id: "active-past",
    section: ACTIVE_SECTION,
    status: "Действует",
    name: "Истёк вчера",
    endDate: "2026-09-06"
  },
  {
    id: "active-equal",
    section: ACTIVE_SECTION,
    status: "Действует",
    name: "Действует по сегодня",
    endDate: TODAY
  },
  {
    id: "active-future",
    section: ACTIVE_SECTION,
    status: "Действует",
    name: "Будущий срок",
    endDate: "2026-09-08"
  },
  {
    id: "active-invalid",
    section: ACTIVE_SECTION,
    status: "Действует",
    name: "Некорректный срок",
    endDate: "31.02.2026"
  },
  {
    id: "active-ru-past",
    section: ACTIVE_SECTION,
    status: "Действует",
    name: "Русский формат даты",
    endDate: "06.09.2026"
  },
  {
    id: "partner-past",
    section: PARTNER_SECTION,
    status: "Партнерская программа",
    name: "Партнёр с прошлой датой",
    endDate: "2026-09-06"
  },
  {
    id: "already-expired",
    section: EXPIRED_SECTION,
    status: "Истек",
    name: "Уже истёк",
    endDate: "2020-01-01"
  }
];
const contractRowsSnapshot = JSON.parse(JSON.stringify(contractRows));

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

deepFreeze(contractRows);

assert.equal(isSharedApplicationContractPastEndDate(contractRows[0], TODAY), true);
assert.equal(
  isSharedApplicationContractPastEndDate(contractRows[1], TODAY),
  false,
  "Дата «Срок по» включительна: в сам последний день договор ещё действует."
);
assert.equal(isSharedApplicationContractPastEndDate(contractRows[2], TODAY), false);
assert.equal(isSharedApplicationContractPastEndDate(contractRows[3], TODAY), false);
assert.equal(isSharedApplicationContractPastEndDate({
  section: ACTIVE_SECTION,
  status: "Действует",
  endDate: "2026-09-061"
}, TODAY), false, "Повреждённая ISO-дата не должна приводить к автоматическому истечению.");
assert.equal(isSharedApplicationContractPastEndDate(contractRows[4], TODAY), true);
assert.equal(
  isSharedApplicationContractPastEndDate(contractRows[5], TODAY),
  false,
  "Партнёрские карточки не должны автоматически переноситься в истёкшие."
);

const normalizedRows = normalizeSharedApplicationContractExpirationRows(contractRows, TODAY);
const normalizedById = new Map(normalizedRows.map((row) => [row.id, row]));
assert.notStrictEqual(normalizedRows, contractRows, "Изменённая коллекция должна возвращаться новым массивом.");
assert.equal(normalizedById.get("active-past").section, EXPIRED_SECTION);
assert.equal(normalizedById.get("active-past").status, "Истек");
assert.equal(normalizedById.get("active-ru-past").section, EXPIRED_SECTION);
assert.equal(normalizedById.get("active-ru-past").status, "Истек");
for (const id of ["active-equal", "active-future", "active-invalid", "partner-past", "already-expired"]) {
  assert.deepEqual(
    normalizedById.get(id),
    contractRowsSnapshot.find((row) => row.id === id),
    `Договор ${id} не должен изменяться.`
  );
}
assert.deepEqual(contractRows, contractRowsSnapshot, "Нормализация не должна мутировать исходные записи.");
assert.deepEqual(
  normalizeSharedApplicationContractExpirationRows(normalizedRows, TODAY),
  normalizedRows,
  "Повторная нормализация должна быть идемпотентной."
);

const sharedDataBeforeExpiration = {
  meta: { marker: "keep" },
  dictionaries: {},
  collections: { contracts: contractRowsSnapshot }
};
assert.equal(sharedApplicationDataNeedsContractExpiration(sharedDataBeforeExpiration, TODAY), true);
assert.equal(sharedApplicationDataNeedsContractExpiration({
  ...sharedDataBeforeExpiration,
  collections: { contracts: normalizedRows }
}, TODAY), false);
assert.equal(sharedApplicationDataNeedsContractExpiration({
  ...sharedDataBeforeExpiration,
  collections: { contracts: [contractRowsSnapshot.find((row) => row.id === "partner-past")] }
}, TODAY), false);

const normalizedSharedData = normalizeSharedApplicationData({
  meta: {},
  dictionaries: { issuedDocumentSettings: [] },
  collections: {
    contracts: [
      { id: "load-past", section: ACTIVE_SECTION, status: "Действует", endDate: "2000-01-01" },
      { id: "load-partner", section: PARTNER_SECTION, status: "Партнерская программа", endDate: "2000-01-01" }
    ]
  }
});
assert.equal(normalizedSharedData.collections.contracts[0].section, EXPIRED_SECTION);
assert.equal(normalizedSharedData.collections.contracts[1].section, PARTNER_SECTION);

const normalizedReplacePatch = normalizeSharedApplicationStatePatch({
  collections: {
    contracts: {
      replace: [
        { id: "replace-past", section: ACTIVE_SECTION, status: "Действует", endDate: "2000-01-01" }
      ]
    }
  }
});
assert.equal(normalizedReplacePatch.collections.contracts.replace[0].section, EXPIRED_SECTION);
const normalizedUpsertPatch = normalizeSharedApplicationStatePatch({
  collections: {
    contracts: {
      upserts: [
        { id: "upsert-past", section: ACTIVE_SECTION, status: "Действует", endDate: "2000-01-01" }
      ]
    }
  }
});
assert.equal(normalizedUpsertPatch.collections.contracts.upserts[0].section, EXPIRED_SECTION);

assert.deepEqual(getEmployeeAuthAccess(contractRowsSnapshot[0], TODAY), {
  role: "partner",
  status: "blocked"
}, "Просроченный raw-договор не должен оставлять сотруднику активный доступ.");
assert.deepEqual(getEmployeeAuthAccess(contractRowsSnapshot[1], TODAY), {
  role: "manager",
  status: "active"
});
assert.deepEqual(getEmployeeAuthAccess(contractRowsSnapshot[5], TODAY), {
  role: "partner",
  status: "active"
});

const rawPastAuthDirectory = buildEmployeeAuthDirectory([{
  id: "raw-active-past",
  section: ACTIVE_SECTION,
  status: "Действует",
  name: "Иванов Иван Иванович",
  login: "raw.active.past",
  password: "test-password",
  endDate: "2000-01-01"
}]);
assert.equal(rawPastAuthDirectory.employees.length, 1);
assert.equal(
  rawPastAuthDirectory.employees[0].access.status,
  "blocked",
  "Каталог авторизации должен блокировать raw-запись, даже если раздел ещё не сохранён как истёкший."
);
const repeatedLoginDirectory = buildEmployeeAuthDirectory([
  {
    id: "same-login-past",
    section: ACTIVE_SECTION,
    status: "Действует",
    name: "Иванов Иван Иванович",
    login: "same.login",
    password: "test-password",
    endDate: "2000-01-01"
  },
  {
    id: "same-login-current",
    section: ACTIVE_SECTION,
    status: "Действует",
    name: "Иванов Иван Иванович",
    login: "same.login",
    password: "test-password",
    endDate: "2999-01-01"
  }
]);
assert.equal(repeatedLoginDirectory.employees.length, 1);
assert.equal(repeatedLoginDirectory.employees[0].id, "same-login-current");
assert.equal(repeatedLoginDirectory.employees[0].access.status, "active");

const requestedSource = String(process.env.AIS_TEST_APP_SOURCE || "").trim();
const appPath = requestedSource
  ? path.resolve(process.cwd(), requestedSource)
  : path.join(ROOT, "app.js");
const appSource = fs.readFileSync(appPath, "utf8");

function extractFunction(name) {
  const plainStart = appSource.indexOf(`  function ${name}(`);
  const asyncStart = appSource.indexOf(`  async function ${name}(`);
  const start = plainStart >= 0 ? plainStart : asyncStart;
  assert.ok(start >= 0, `Не найдена функция ${name}.`);
  const bodyStart = appSource.indexOf(") {", start) + 2;
  assert.ok(bodyStart > start, `Не найдено тело функции ${name}.`);
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
  throw new Error(`Функция ${name} не завершена.`);
}

assert.match(
  appSource,
  /data-action="copy-employee-new-contract"/u,
  "В сохранённой карточке сотрудника должна быть кнопка нового договора."
);
assert.match(
  appSource,
  /addEventListener\("click", copyEmployeeForNewContract\)/u,
  "Кнопка нового договора должна быть привязана к обработчику."
);
assert.match(
  appSource,
  /canDuplicateEmployeeContract[\s\S]*CONTRACT_SECTIONS\[1\]/u,
  "Команда нового трудового договора не должна повышать партнёрскую учётную запись."
);
assert.match(
  appSource,
  /canDuplicateEmployeeContract = Boolean\(state\.modal\?\.id\)/u,
  "Команда нового договора должна появляться только у сохранённой карточки."
);
const duplicateHandlerSource = extractFunction("copyEmployeeForNewContract");
assert.match(duplicateHandlerSource, /!state\.modal\?\.id/u);
assert.match(duplicateHandlerSource, /id:\s*""/u);
assert.match(duplicateHandlerSource, /buildEmployeeContractDuplicateDraft\(source\)/u);
assert.match(duplicateHandlerSource, /releaseRecordLock\(lock\)/u);
assert.match(duplicateHandlerSource, /contractCardTab\s*=\s*"contract"/u);

const gatewaySource = fs.readFileSync(path.join(ROOT, "gateway.php"), "utf8");
assert.match(gatewaySource, /function gateway_shared_state_ensure_contract_expiration/u);
assert.match(
  gatewaySource,
  /gateway_shared_state_ensure_contract_expiration\(\$pdo\)/u,
  "Опубликованный PHP-шлюз должен запускать перенос истёкших договоров."
);
assert.match(gatewaySource, /gateway_normalize_shared_state_contract_patch\(\$patch\)/u);

const serverSource = fs.readFileSync(path.join(ROOT, "app-server.js"), "utf8");
assert.match(
  serverSource,
  /FOR UPDATE`[\s\S]*?patch = patch \? normalizeSharedApplicationStatePatch\(patch\) : null;[\s\S]*?suppliedData = suppliedData \? normalizeSharedApplicationData\(suppliedData\) : null;/u,
  "Node-шлюз должен повторно применить зависящую от даты нормализацию после блокировки ревизии."
);
assert.match(
  serverSource,
  /String\(user\.authSource \|\| ""\) === "employee"[\s\S]*?await maybeRunAutomaticContractExpiration\(\);[\s\S]*?users = await loadAuthUsers\(\);/u,
  "Node-шлюз должен перепроверять доступ уже открытой сессии сотрудника."
);
assert.match(
  serverSource,
  /await synchronizeStoredAuthUsersWithEmployees\(\);\s*automaticContractExpirationLastCheckedDate = todayKey;/u,
  "После автоматического переноса Node-шлюз должен синхронизировать статусы пользователей."
);
assert.match(
  gatewaySource,
  /ais_employee_contract_checked_date[\s\S]*?gateway_sync_employee_auth_users\(\);[\s\S]*?\$user = ais_auth_current_user\(\);/u,
  "PHP-шлюз должен ежедневно перепроверять уже открытую сессию сотрудника."
);
assert.match(
  gatewaySource,
  /GET' && \$path === '\/api\/auth\/me'\)[\s\S]*?\$user = gateway_require_user\(\);/u,
  "Проверка текущей PHP-сессии должна учитывать истечение договора."
);

const clientExpirationContext = {
  CONTRACT_SECTIONS: [ACTIVE_SECTION, PARTNER_SECTION, EXPIRED_SECTION],
  normalizePreferredMessenger: (value) => String(value || ""),
  normalizePersonPhotoCardPath: (value) => String(value || ""),
  normalizeCitizenshipValue: (value) => String(value || "")
};
vm.createContext(clientExpirationContext);
vm.runInContext(`
  ${extractFunction("normalizeContractSection")}
  ${extractFunction("getMoscowCalendarDateKey")}
  ${extractFunction("normalizeContractCalendarDateKey")}
  ${extractFunction("isContractPastEndDate")}
  ${extractFunction("normalizeContractRecord")}
  this.clientBeforeMoscowMidnight = getMoscowCalendarDateKey(new Date("2026-09-06T20:59:59.999Z"));
  this.clientAtMoscowMidnight = getMoscowCalendarDateKey(new Date("2026-09-06T21:00:00.000Z"));
  this.clientPast = isContractPastEndDate({
    section: CONTRACT_SECTIONS[0],
    status: "Действует",
    endDate: "06.09.2026"
  }, "${TODAY}");
  this.clientEqual = isContractPastEndDate({
    section: CONTRACT_SECTIONS[0],
    status: "Действует",
    endDate: "${TODAY}"
  }, "${TODAY}");
  this.clientInvalid = isContractPastEndDate({
    section: CONTRACT_SECTIONS[0],
    status: "Действует",
    endDate: "31.02.2026"
  }, "${TODAY}");
  this.clientPartner = normalizeContractRecord({
    section: CONTRACT_SECTIONS[1],
    status: "Партнерская программа",
    endDate: "06.09.2026"
  }, "${TODAY}");
  this.clientExpired = normalizeContractRecord({
    section: CONTRACT_SECTIONS[0],
    status: "Действует",
    endDate: "06.09.2026"
  }, "${TODAY}");
`, clientExpirationContext);
assert.equal(clientExpirationContext.clientBeforeMoscowMidnight, "2026-09-06");
assert.equal(clientExpirationContext.clientAtMoscowMidnight, TODAY);
assert.equal(clientExpirationContext.clientPast, true);
assert.equal(clientExpirationContext.clientEqual, false);
assert.equal(clientExpirationContext.clientInvalid, false);
assert.equal(clientExpirationContext.clientPartner.section, PARTNER_SECTION);
assert.equal(clientExpirationContext.clientExpired.section, EXPIRED_SECTION);
assert.equal(clientExpirationContext.clientExpired.status, "Истек");

const duplicateContext = {
  CONTRACT_SECTIONS: [ACTIVE_SECTION, PARTNER_SECTION, EXPIRED_SECTION],
  normalizeContractRecord(record = {}) {
    const section = record.section || ACTIVE_SECTION;
    return {
      ...record,
      section,
      status: section === ACTIVE_SECTION
        ? "Действует"
        : section === PARTNER_SECTION
          ? "Партнерская программа"
          : "Истек"
    };
  }
};
vm.createContext(duplicateContext);
vm.runInContext(`
  ${extractFunction("buildEmployeeContractDuplicateDraft")}
  this.buildEmployeeContractDuplicateDraft = buildEmployeeContractDuplicateDraft;
`, duplicateContext);

const sourceContract = {
  id: "contract-original",
  section: EXPIRED_SECTION,
  status: "Истек",
  name: "Петров Пётр Петрович",
  position: "Преподаватель",
  degree: "кандидат наук",
  academicTitle: "доцент",
  phone: "+7 900 000-00-00",
  email: "employee@example.test",
  telegram: "employee_telegram",
  whatsapp: "+7 900 000-00-00",
  preferredMessenger: "telegram",
  photoPath: "Сотрудники/ПетровПП/Документы/ПетровПП.jpg",
  photoUrl: "data:image/png;base64,dGVzdA==",
  photoData: "dGVzdA==",
  coupon: "PETROV",
  couponId: "coupon-17",
  notificationEmail: "+",
  bank: "Тестовый банк",
  settlementAccount: "40817810000000000001",
  correspondentAccount: "30101810000000000001",
  bic: "044525001",
  citizenship: "Россия",
  birthDate: "1980-05-10",
  identityDocumentType: "Паспорт гражданина РФ",
  identityDocument: "12 34 567890",
  identityIssueDate: "2000-06-01",
  identityDepartmentCode: "770-001",
  identityIssuer: "ОВД",
  courtCertificateDate: "2026-01-11",
  courtCertificateNo: "СП-17",
  fluorographyDate: "2026-02-12",
  employmentCertificateDate: "2026-03-13",
  employmentRecordCopyDate: "2026-04-14",
  educationType: "Высшее образование",
  educationLevel: "Специалитет",
  educationSeries: "ВСГ",
  educationNumber: "1234567",
  educationIssueDate: "2002-06-30",
  educationIssuer: "Тестовый университет",
  educationSpecialty: "Педагогика",
  educationQualification: "Преподаватель",
  address: "г. Москва",
  snils: "123-456-789 00",
  inn: "770000000001",
  login: "employee.login",
  password: "employee-password",
  sourceStudentId: "student-1",
  sourceStudentUid: "1162",
  city: "Москва",
  partnerDirections: "Педагогика",
  additionalInfo: "Постоянные сведения профиля",
  note: "Постоянная заметка о сотруднике",
  contractNo: "17",
  contractDate: "2025-09-01",
  type: "Договор ГПХ",
  startDate: "2025-09-01",
  endDate: "2026-09-01",
  subject: "Старый предмет договора",
  paymentTerms: "Старые условия оплаты",
  accountingRecorded: "+",
  amount: 100000,
  paid: 70000,
  agencyAmount: 5000,
  balance: 25000,
  portalCredentials: "Старое сообщение о доступе",
  message1: "Старое сообщение 1",
  message9: "Старое сообщение 9",
  event_contractSigned_state: "dated",
  event_contractSigned_date: "2025-09-01",
  event_contractSigned_label: "Договор подписан",
  eventOrder: "contractSigned",
  eventCustomKeys: "customEvent",
  eventDeleted: "oldEvent",
  databaseSync: { recordId: "contract-original" },
  databaseSyncSourceRow: 12,
  databaseSyncFormulaFields: ["amount"],
  databaseFixedValueOverrides: ["contractNo"],
  randomCarryOver: "Нельзя переносить неизвестные поля"
};
const sourceContractSnapshot = JSON.parse(JSON.stringify(sourceContract));
deepFreeze(sourceContract);
const duplicateDraft = duplicateContext.buildEmployeeContractDuplicateDraft(sourceContract);
const duplicatePlain = JSON.parse(JSON.stringify(duplicateDraft));

const copiedFields = [
  "name", "position", "degree", "academicTitle",
  "phone", "email", "telegram", "whatsapp", "preferredMessenger", "photoPath", "photoUrl", "photoData",
  "coupon", "couponId", "notificationEmail",
  "bank", "settlementAccount", "correspondentAccount", "bic",
  "citizenship", "birthDate", "identityDocumentType", "identityDocument",
  "identityIssueDate", "identityDepartmentCode", "identityIssuer",
  "courtCertificateDate", "courtCertificateNo", "fluorographyDate",
  "employmentCertificateDate", "employmentRecordCopyDate",
  "educationType", "educationLevel", "educationSeries", "educationNumber",
  "educationIssueDate", "educationIssuer", "educationSpecialty", "educationQualification",
  "address", "snils", "inn", "login", "password", "sourceStudentId", "sourceStudentUid",
  "city", "partnerDirections", "additionalInfo"
];
copiedFields.forEach((key) => {
  assert.deepEqual(duplicatePlain[key], sourceContractSnapshot[key], `Поле ${key} должно переноситься в новый договор.`);
});
assert.equal(duplicatePlain.section, ACTIVE_SECTION);
assert.equal(duplicatePlain.status, "Действует");

for (const key of [
  "id", "contractNo", "contractDate", "type", "startDate", "endDate", "subject", "paymentTerms", "note",
  "portalCredentials", "message1", "message9"
]) {
  assert.equal(String(duplicatePlain[key] ?? ""), "", `Поле ${key} старого договора должно очищаться.`);
}
for (const key of ["amount", "paid", "agencyAmount", "balance"]) {
  assert.equal(Number(duplicatePlain[key] || 0), 0, `Сумма ${key} старого договора не должна наследоваться.`);
}
assert.equal(Boolean(duplicatePlain.accountingRecorded), false);
for (const key of [
  "event_contractSigned_state", "event_contractSigned_date", "event_contractSigned_label",
  "eventOrder", "eventCustomKeys", "eventDeleted",
  "databaseSync", "databaseSyncSourceRow", "databaseSyncFormulaFields", "databaseFixedValueOverrides",
  "randomCarryOver"
]) {
  assert.equal(
    Object.prototype.hasOwnProperty.call(duplicatePlain, key),
    false,
    `Служебное или договорное поле ${key} не должно попадать в allowlist дубликата.`
  );
}
assert.deepEqual(sourceContract, sourceContractSnapshot, "Создание дубликата не должно мутировать исходный договор.");

console.log("Employee contract lifecycle tests passed.");

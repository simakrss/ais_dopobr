"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  DEMO_MODE_MASK_TEXT,
  demoModePhotoToken,
  sanitizeDemoSharedState,
  sanitizeDemoSharedStateMetadata,
  redactDemoAuthUser
} = require("../demo-mode-privacy.js");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const demoIdSecret = "unit-test-demo-mode-id-secret";

const canaries = {
  student: "КАНАРЕЙКА_СЛУШАТЕЛЬ_ИВАНОВ",
  employee: "КАНАРЕЙКА_СОТРУДНИК_ПЕТРОВ",
  address: "КАНАРЕЙКА_АДРЕС_ЛЕНИНА_1",
  passport: "КАНАРЕЙКА_ПАСПОРТ_1234_567890",
  diploma: "КАНАРЕЙКА_ДИПЛОМ_ABC123",
  note: "КАНАРЕЙКА_ПРИМЕЧАНИЕ",
  photoPath: "КАНАРЕЙКА_ФОТО_ПУТЬ",
  source: "Рекомендация КАНАРЕЙКА_ИВАНОВА_И_И",
  tags: "VIP КАНАРЕЙКА_ИВАНОВ_ИВАН_ИВАНОВИЧ",
  commission: "КАНАРЕЙКА_КОМИССИЯ_СИДОРОВ",
  counterparty: "КАНАРЕЙКА_КОНТРАГЕНТ_ПЕТРОВ",
  naturalName: "Иванов Канарейка Иванович"
};
const safeProgramName = "Базовый курс Access + SQL";

const source = {
  config: {
    presenter: canaries.naturalName,
    supportEmail: "presenter-canary@example.test"
  },
  meta: {
    organization: "Учебный центр",
    mysqlHost: "private-db.internal",
    applicationsSqlQuery: `SELECT '${canaries.student}'`,
    studentDatabaseOperationHistory: [{ user: canaries.employee, details: canaries.note }]
  },
  dictionaries: {
    programs: ["Безопасная программа"],
    roles: ["Менеджер", canaries.naturalName, "role-canary@example.test"],
    employees: [canaries.employee],
    managers: { [canaries.employee]: { email: "employee-canary@example.test" } },
    paymentSettings: [{ key: "recipient", value: `Выплата ${canaries.employee}` }],
    documentTemplates: [{ title: canaries.student, templatePath: canaries.photoPath }]
  },
  collections: {
    students: [{
      id: "student-89991234567",
      name: canaries.student,
      fullName: canaries.naturalName,
      phone: "+7 999 123-45-67",
      whatsapp: "",
      email: "student-canary@example.test",
      telegram: "student_canary",
      passportNumber: canaries.passport,
      snils: "123-456-789 01",
      inn: "123456789012",
      registrationAddress: canaries.address,
      educationDocumentNumber: canaries.diploma,
      source: canaries.source,
      tags: [canaries.tags],
      program: safeProgramName,
      status: "Учится",
      applicationDate: "2026-08-31",
      extendedEndDate: "2026-10-01",
      paidAmount: 2500,
      balance: 500,
      secretStatus: "PRIVATE_STATUS_CANARY",
      secretAmount: 123456,
      photoPath: `${canaries.photoPath}/student.jpg`
    }],
    contracts: [{
      id: "employee-89991234567",
      name: canaries.employee,
      email: "employee-canary@example.test",
      identityDocument: canaries.passport,
      address: canaries.address,
      photoData: "data:image/png;base64,UEhPVE8="
    }],
    programs: [{
      id: "program-89991234567",
      name: safeProgramName,
      shortName: "Базовый Access",
      teacher: canaries.employee,
      commissionMember1: canaries.commission,
      secretary: canaries.commission,
      promoMessage1: `Пишите ${canaries.student} по адресу student-canary@example.test или https://t.me/private_canary`
    }],
    generalExpenses: [{
      id: "expense-89991234567",
      section: "Физлица",
      counterparty: canaries.counterparty,
      amount: 1000
    }, {
      id: "expense-89997654321",
      section: "Физлица",
      counterparty: "Базовый",
      amount: 500
    }],
    trainingPlans: [{
      id: "plan-89991234567",
      programId: "program-89991234567",
      programName: safeProgramName,
      discipline: "Введение",
      totalHours: 36
    }],
    audit: [{
      entityLabel: canaries.student,
      details: `${canaries.note}: ${canaries.student}; student-canary@example.test`
    }],
    recycleBin: [{
      id: "trash-1",
      collection: "students",
      label: canaries.student,
      record: { id: "student-2", name: canaries.student, passport: canaries.passport },
      deletedBy: { name: canaries.employee, login: "real-admin" }
    }, {
      id: "trash-2",
      collection: "generalExpenses",
      label: canaries.counterparty,
      record: { id: "expense-2", counterparty: canaries.counterparty }
    }]
  }
};

const original = JSON.stringify(source);
const sanitized = sanitizeDemoSharedState(source, { idSecret: demoIdSecret });
const json = JSON.stringify(sanitized);

assert.equal(JSON.stringify(source), original, "санитайзер не должен изменять исходный снимок");
assert.equal(sanitized.meta.databaseDemoMode, true);
assert.equal(sanitized.collections.students[0].program, safeProgramName);
assert.equal(sanitized.collections.students[0].status, "Учится");
assert.equal(sanitized.collections.students[0].applicationDate, "2026-08-31");
assert.equal(sanitized.collections.students[0].extendedEndDate, "2026-10-01");
assert.equal(sanitized.collections.students[0].paidAmount, 2500);
assert.equal(sanitized.collections.students[0].balance, 500);
assert.equal(sanitized.collections.students[0].secretStatus, DEMO_MODE_MASK_TEXT);
assert.equal(sanitized.collections.students[0].secretAmount, DEMO_MODE_MASK_TEXT);
assert.match(sanitized.collections.students[0].id, /^demo-id-[A-Za-z0-9_-]{24}$/u);
assert.match(sanitized.collections.contracts[0].id, /^demo-id-[A-Za-z0-9_-]{24}$/u);
assert.match(sanitized.collections.programs[0].id, /^demo-id-[A-Za-z0-9_-]{24}$/u);
assert.notEqual(sanitized.collections.students[0].id, "student-89991234567");
assert.notEqual(sanitized.collections.contracts[0].id, "employee-89991234567");
assert.notEqual(sanitized.collections.programs[0].id, "program-89991234567");
assert.equal(new Set(sanitized.collections.generalExpenses.map((row) => row.id)).size, 2);
assert.match(sanitized.collections.trainingPlans[0].id, /^demo-id-[A-Za-z0-9_-]{24}$/u);
assert.equal(
  sanitized.collections.trainingPlans[0].programId,
  sanitized.collections.programs[0].id,
  "связи между записями должны сохраняться после псевдонимизации"
);
assert.equal(sanitized.collections.students[0].source, DEMO_MODE_MASK_TEXT);
assert.deepEqual(sanitized.collections.students[0].tags, []);
assert.equal(sanitized.collections.programs[0].name, safeProgramName);
assert.equal(sanitized.collections.programs[0].shortName, "Базовый Access");
assert.equal(sanitized.collections.programs[0].promoMessage1, DEMO_MODE_MASK_TEXT);
assert.deepEqual(sanitized.collections.audit, []);
assert.deepEqual(sanitized.collections.recycleBin, []);
assert.deepEqual(sanitized.dictionaries.managers, {});
assert.deepEqual(sanitized.dictionaries.paymentSettings, []);
assert.deepEqual(sanitized.dictionaries.documentTemplates, []);
assert.equal(sanitized.dictionaries.roles[0], "Менеджер");
assert.equal(sanitized.dictionaries.roles[1], DEMO_MODE_MASK_TEXT);
assert.equal(sanitized.dictionaries.roles[2], DEMO_MODE_MASK_TEXT);
assert.equal(Object.prototype.hasOwnProperty.call(sanitized.meta, "mysqlHost"), false);
assert.equal(Object.prototype.hasOwnProperty.call(sanitized.meta, "applicationsSqlQuery"), false);
assert.equal(Object.prototype.hasOwnProperty.call(sanitized, "config"), false);
assert.equal(sanitized.collections.students[0].name, DEMO_MODE_MASK_TEXT);
assert.equal(sanitized.collections.students[0].whatsapp, "");
assert.equal(sanitized.collections.contracts[0].name, DEMO_MODE_MASK_TEXT);
assert.equal(
  sanitized.collections.students[0].photoPath,
  `demo-photo:students:${demoModePhotoToken("students", "student-89991234567", demoIdSecret)}`
);
assert.equal(
  sanitized.collections.contracts[0].photoPath,
  `demo-photo:contracts:${demoModePhotoToken("contracts", "employee-89991234567", demoIdSecret)}`
);
assert.notEqual(
  demoModePhotoToken("students", "student-89991234567", demoIdSecret),
  demoModePhotoToken("students", "student-89991234567", "another-demo-id-secret"),
  "токен фото не должен позволять проверять догадки о сыром ID без серверного ключа"
);
assert.equal(sanitized.collections.contracts[0].photoData, "");

for (const canary of Object.values(canaries)) {
  assert.ok(!json.includes(canary), `демо-снимок не должен содержать ${canary}`);
}
for (const privateValue of [
  "+7 999 123-45-67",
  "student-canary@example.test",
  "employee-canary@example.test",
  "123-456-789 01",
  "123456789012",
  "real-admin",
  "student-89991234567",
  "employee-89991234567",
  "program-89991234567",
  "expense-89991234567",
  "plan-89991234567"
]) {
  assert.ok(!json.includes(privateValue), `демо-снимок не должен содержать ${privateValue}`);
}

assert.deepEqual(redactDemoAuthUser({
  id: "u-1",
  login: "real-admin",
  name: canaries.employee,
  email: "admin@example.test",
  phone: "+79991234567",
  role: "admin"
}), {
  id: "demo-user",
  login: "demo",
  name: "Демо-администратор",
  email: "",
  phone: "",
  role: "admin",
  status: "active",
  employeeId: "",
  createdAt: "",
  updatedAt: "",
  lastLoginAt: ""
});

assert.deepEqual(sanitizeDemoSharedStateMetadata({
  revision: 12,
  updatedBy: "real-admin",
  warning: "private warning",
  syncBlockedLock: { ownerName: canaries.employee }
}), {
  exists: true,
  revision: 12,
  updatedAt: "",
  updatedBy: DEMO_MODE_MASK_TEXT,
  version: 0,
  versionTag: "",
  source: "demo",
  offline: false,
  writable: false,
  pendingCount: 0,
  syncPending: false,
  syncBlockedReason: "",
  warning: "Служебное предупреждение скрыто в деморежиме.",
  syncBlockedLock: null
});

const server = read("app-server.js");
const gateway = read("gateway.php");
const bootstrap = read("auth-bootstrap.js");
const app = read("app.js");
const styles = read("styles.css");
const htaccess = read(".htaccess");
const deploy = read("scripts/deploy-lms.ps1");
const demoSettings = read("demo-mode-settings.php");
const sendMail = read("send-mail.php");
const partnerApp = read("partner-app.js");
const indexHtml = read("index.html");
const fieldHtmlLinks = read("field-html-links.js");
const privateDefaultsSource = read("data/private-defaults.js");

const privateDefaultsSandbox = { window: {} };
vm.runInNewContext(privateDefaultsSource, privateDefaultsSandbox, {
  filename: "data/private-defaults.js"
});
const privateDefaults = privateDefaultsSandbox.window.AIS_PRIVATE_DEFAULTS;
const publicClientSource = [app, bootstrap, partnerApp, indexHtml, styles, fieldHtmlLinks].join("\n");
const privateClientValues = new Set([
  privateDefaults?.studentApplicationsEmail?.login,
  privateDefaults?.woocommerceEmailLogin,
  privateDefaults?.representativeName,
  privateDefaults?.contactEmail,
  privateDefaults?.telegramUrl,
  privateDefaults?.maxUrl,
  ...String(privateDefaults?.automaticExpenseRules || "").split(/\r?\n/u),
  privateDefaults?.sourceAgentAssignments
].map((value) => String(value || "").trim()).filter((value) => value.length >= 5));
for (const privateValue of privateClientValues) {
  assert.ok(!publicClientSource.includes(privateValue), `публичный клиент не должен содержать ${privateValue}`);
}

assert.match(server, /databaseDemoModeEnabled:\s*false/u);
assert.match(server, /sanitizeDemoSharedState\(responseData, \{ idSecret: DATABASE_DEMO_ID_SECRET \}\)/u);
assert.match(server, /CLIENT_PRIVATE_DEFAULTS/u);
assert.match(server, /\/api\/client-private-defaults/u);
assert.match(server, /DEMO_MODE_READ_ONLY/u);
assert.match(server, /\/api\/admin\/demo-mode/u);
assert.match(server, /demoToken/u);
assert.match(gateway, /gateway_database_demo_mode_enabled/u);
assert.match(gateway, /is_file\(\$runtimeFile\) \? \$runtimeFile : \$publicDataRoot/u);
assert.match(gateway, /gateway_run_node\(gateway_api_url\(\), \$method, \$authenticatedHeaders, \$body\)/u);
assert.match(gateway, /DEMO_MODE_READ_ONLY/u);
assert.match(bootstrap, /installSafeDatabaseDemoSeed/u);
assert.match(bootstrap, /installPrivateDefaultsFromServer/u);
assert.doesNotMatch(bootstrap, /loadScript\("data\/private-defaults\.js"\)/u);
assert.match(bootstrap, /purgeDatabaseDemoBrowserData/u);
assert.doesNotMatch(bootstrap, /request\.onblocked\s*=\s*resolve/u);
assert.match(bootstrap, /event\.persisted\)[\s\S]*app\.innerHTML = "";[\s\S]*window\.location\.reload\(\);/u);
assert.match(bootstrap, /history\.replaceState\(\{ aisDatabaseDemoMode: true \}/u);
assert.match(bootstrap, /databaseDemoModeEnabled\) \{\s*installSafeDatabaseDemoSeed\(\)/u);
assert.match(app, /data-action="toggle-database-demo-mode"/u);
assert.match(app, /applyDatabaseDemoModePresentation/u);
assert.match(app, /initializeBrowserOfflineStorage\(\) \{\s*if \(isDatabaseDemoMode\(\)\) return;/u);
assert.match(app, /sanitizeAisNavigationSnapshotForDemo/u);
assert.match(app, /demo-photo:\(\?:students\|contracts\)/u);
assert.match(app, /storage\\\/photos\\\//u);
assert.match(app, /studentSourcePhotoUrl\(value\)/u);
assert.match(styles, /\.database-demo-private-value/u);
assert.match(styles, /filter:\s*blur\(4px\)/u);
assert.match(htaccess, /demo-mode-privacy\\\.js/u);
assert.match(htaccess, /RedirectMatch 404.*storage/u);
assert.equal(
  (deploy.match(/"demo-mode-privacy\.js"/gu) || []).length,
  2,
  "модуль обезличивания должен выгружаться и в публичный каталог, и в runtime"
);
assert.match(deploy, /if \(\$relativeFile -eq "data\/private-defaults\.js"\)[\s\S]*"runtime"/u);
assert.match(gateway, /putenv\('AIS_APP_ROOT=' \. __DIR__\)/u);
assert.match(gateway, /putenv\('AIS_DATABASE_DEMO_MODE_PATH=' \. ais_database_demo_mode_flag_path\(\)\)/u);
assert.match(gateway, /putenv\('AIS_DATABASE_DEMO_ID_SECRET=' \. \$internalGatewaySecret\)/u);
assert.match(gateway, /putenv\('AIS_GATEWAY_SHARED_SECRET=' \. \$internalGatewaySecret\)/u);
assert.match(gateway, /\$headers\['x-ais-gateway-token'\] = \$internalGatewaySecret/u);
assert.match(demoSettings, /__DIR__ \. '\/storage\/database-demo-mode\.flag'/u);
assert.match(demoSettings, /__DIR__ \. '\/storage\/database-demo-mode\.secret'/u);
assert.match(demoSettings, /fopen\(\$path, 'x\+b'\)/u);
assert.match(server, /DATABASE_DEMO_MODE_PATH/u);
assert.match(server, /Buffer\.from\(body\.enabled \? "enabled\\n" : "disabled\\n"/u);
assert.match(server, /authVerifyPassword\(currentPassword, admin\.passwordHash\)/u);
assert.match(server, /async function proxyOnlyOfficeWebSocket[\s\S]*isDatabaseDemoModeEnabled\(\)[\s\S]*socket\.destroy\(\)/u);
assert.match(gateway, /gateway_verify_admin_password/u);
assert.match(gateway, /\$demoPhotoTunnelSettings = gateway_tunnel_settings\(\)/u);
assert.match(gateway, /\$demoPhotoHeaders\['x-ais-demo-mode-id-secret'\] = ais_database_demo_mode_id_secret\(\)/u);
assert.match(gateway, /unset\(\$authenticatedHeaders\['x-ais-demo-mode-id-secret'\]\)/u);
assert.match(gateway, /x-ais-demo-mode-reauthenticated/u);
assert.match(sendMail, /ais_database_demo_mode_enabled\(\)/u);
assert.match(sendMail, /DEMO_MODE_READ_ONLY/u);

console.log("database demo mode privacy checks: OK");

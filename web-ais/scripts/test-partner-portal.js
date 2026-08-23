"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.AIS_SHARED_STATE_LOCAL_ONLY = "1";

const {
  selectPartnerEmployee,
  buildPartnerProfile,
  getPartnerDocumentsFolder,
  sanitizePartnerProfileUpdate,
  buildPartnerPaymentData,
  normalizePartnerMaterialsUrl,
  requestHasGatewayIdentity,
  requestHasTrustedGatewayIdentity
} = require("../app-server.js");

const root = path.resolve(__dirname, "..");
const authSource = fs.readFileSync(path.join(root, "auth-bootstrap.js"), "utf8");
const partnerSource = fs.readFileSync(path.join(root, "partner-app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const gatewaySource = fs.readFileSync(path.join(root, "gateway.php"), "utf8");
const deploySource = fs.readFileSync(path.join(root, "scripts", "deploy-lms.ps1"), "utf8");

const contracts = [
  {
    id: "employee-expired",
    name: "Иванов Иван Иванович",
    login: "partner.ivanov",
    password: "test-password",
    section: "ИСТЕКШИЕ ДОГОВОРА",
    endDate: "2025-12-31"
  },
  {
    id: "employee-active",
    name: "Иванов Иван Иванович",
    login: "PARTNER.IVANOV",
    password: "test-password",
    section: "ДЕЙСТВУЮЩИЕ ДОГОВОРА",
    endDate: "2026-12-31",
    email: "partner@example.test",
    telegram: "must-not-be-public",
    note: "must-not-be-public"
  }
];

assert.equal(
  selectPartnerEmployee(contracts, { login: "partner.ivanov", password: "test-password" })?.id,
  "employee-active"
);
assert.equal(selectPartnerEmployee(contracts, { login: "partner.ivanov", password: "wrong" }), null);
assert.equal(selectPartnerEmployee(contracts, { employeeId: "employee-expired" })?.id, "employee-expired");

const profile = buildPartnerProfile({
  ...contracts[1],
  password: "secret-must-not-leak",
  phone: "+7 900 000-00-00",
  identityDocument: "0000 000000",
  section: "ДЕЙСТВУЮЩИЕ ДОГОВОРА"
});
const profileText = JSON.stringify(profile);
assert.doesNotMatch(profileText, /secret-must-not-leak/u);
assert.doesNotMatch(profileText, /must-not-be-public/u);
assert.doesNotMatch(profileText, /section/u);
assert.match(profileText, /••••••••/u);
assert.deepEqual(Object.keys(profile.tabs), ["main", "contract", "documents"]);
assert.equal(profile.tabs.main.find((field) => field.key === "name").editable, true);
assert.equal(profile.tabs.contract.find((field) => field.key === "contractNo").editable, false);
assert.equal(getPartnerDocumentsFolder({ name: "Иванов Иван Иванович" }), "Сотрудники/ИвановИИ/Документы");
assert.equal(getPartnerDocumentsFolder({ photoPath: "Сотрудники/ИвановИИ/Документы/ИвановИИ.jpg" }), "Сотрудники/ИвановИИ/Документы");
assert.deepEqual(sanitizePartnerProfileUpdate({ email: " partner@example.test ", contractNo: "hack" }), {
  email: "partner@example.test"
});
assert.deepEqual(sanitizePartnerProfileUpdate({ password: "" }), {});

const paymentData = buildPartnerPaymentData({
  collections: {
    programs: [{ name: "Авторский курс", author: "Автор курса" }],
    contracts,
    students: [
      {
        id: "student-1",
        name: "Слушатель Первый",
        program: "Авторский курс",
        agent: "Иванов Иван Иванович",
        payment1Amount: 10000,
        payment1Date: "01.08.2026",
        directExpenses: [
          {
            id: "direct-payable",
            date: "02.08.2026",
            note: "Иванов Иван Иванович",
            type: "Подготовка материалов",
            amount: 400,
            recommendation: "+"
          },
          {
            id: "direct-paid",
            date: "01.07.2026",
            paid: "10.07.2026",
            note: "Иванов Иван Иванович",
            type: "Проверка документов",
            amount: 300,
            recommendation: "+"
          }
        ]
      }
    ],
    directExpenses: [],
    generalExpenses: [
      {
        id: "general-payable",
        date: "03.08.2026",
        counterparty: "Иванов Иван Иванович",
        workType: "Общая выплата",
        amount: 200
      }
    ]
  },
  dictionaries: {
    paymentSettings: [
      { key: "agentRateWithAuthor", value: 10 },
      { key: "agentRateWithoutAuthor", value: 25 }
    ]
  }
}, contracts);

assert.equal(paymentData.summary.currentPayable, 1600);
assert.equal(paymentData.summary.totalPaid, 300);
assert.equal(paymentData.rows.filter((row) => row.statusKey === "payable").length, 3);
assert.equal(paymentData.monthly[0].month, "2026-07");
assert.equal(paymentData.monthly[0].amount, 300);
assert.deepEqual(paymentData.groups.map((group) => group.month), ["2026-08", "2026-07"]);

assert.equal(
  normalizePartnerMaterialsUrl("https://disk.yandex.ru/d/9BBGBNBIum252w"),
  "https://disk.yandex.ru/d/9BBGBNBIum252w"
);
assert.throws(() => normalizePartnerMaterialsUrl("http://disk.yandex.ru/d/test"), /HTTPS-ссылку/u);
assert.throws(() => normalizePartnerMaterialsUrl("https://example.test/materials"), /Яндекс-Диска/u);

const previousGatewayEnvironment = {
  trust: process.env.AIS_TRUST_GATEWAY,
  secret: process.env.AIS_GATEWAY_SHARED_SECRET,
  cli: process.env.AIS_OCR_CLI
};
try {
  process.env.AIS_TRUST_GATEWAY = "1";
  delete process.env.AIS_GATEWAY_SHARED_SECRET;
  delete process.env.AIS_OCR_CLI;
  assert.equal(requestHasGatewayIdentity({ headers: {} }), false);
  assert.equal(requestHasTrustedGatewayIdentity({ headers: {} }), false);
  assert.equal(requestHasTrustedGatewayIdentity({ headers: {
    "x-ais-user-id": "partner:employee-active",
    "x-ais-user-role": "partner"
  } }), false);
  process.env.AIS_OCR_CLI = "1";
  assert.equal(requestHasTrustedGatewayIdentity({ headers: {
    "x-ais-user-id": "partner:employee-active",
    "x-ais-user-role": "partner"
  } }), true);
  process.env.AIS_GATEWAY_SHARED_SECRET = "gateway-secret";
  process.env.AIS_OCR_CLI = "1";
  assert.equal(requestHasTrustedGatewayIdentity({ headers: {
    "x-ais-user-id": "partner:employee-active",
    "x-ais-user-role": "partner"
  } }), true);
  delete process.env.AIS_OCR_CLI;
  assert.equal(requestHasTrustedGatewayIdentity({ headers: {
    "x-ais-user-id": "partner:employee-active",
    "x-ais-user-role": "partner",
    "x-ais-gateway-token": "gateway-secret"
  } }), true);
  assert.equal(requestHasTrustedGatewayIdentity({ headers: {
    "x-ais-user-id": "partner:employee-active",
    "x-ais-user-role": "partner"
  } }), false);
} finally {
  if (previousGatewayEnvironment.trust === undefined) delete process.env.AIS_TRUST_GATEWAY;
  else process.env.AIS_TRUST_GATEWAY = previousGatewayEnvironment.trust;
  if (previousGatewayEnvironment.secret === undefined) delete process.env.AIS_GATEWAY_SHARED_SECRET;
  else process.env.AIS_GATEWAY_SHARED_SECRET = previousGatewayEnvironment.secret;
  if (previousGatewayEnvironment.cli === undefined) delete process.env.AIS_OCR_CLI;
  else process.env.AIS_OCR_CLI = previousGatewayEnvironment.cli;
}

assert.match(authSource, /user\?\.role === "partner"[\s\S]*loadScript\("partner-app\.js"\)/u);
assert.match(authSource, /else \{[\s\S]*loadScript\("data\/seed\.js"\)/u);
assert.match(authSource, /previousRole[\s\S]{0,240}nextRole !== previousRole/u);
assert.match(authSource, /data-session-expired-logout[\s\S]{0,420}redirectToLogin\(\)/u);
assert.match(
  gatewaySource,
  /\(string\) \(\$currentUser\['role'\] \?\? ''\) === 'partner'[\s\S]{0,180}!str_starts_with\(\$requestPath, '\/api\/partner\/'\)/u
);
assert.match(
  gatewaySource,
  /function gateway_serve_protected_data[\s\S]{0,240}\$user\['role'\][\s\S]{0,80}'partner'/u
);
assert.match(partnerSource, /data-action="open-payable"/u);
assert.match(partnerSource, /data-feedback-form/u);
assert.match(partnerSource, /data-profile-form/u);
assert.match(partnerSource, /api\/partner\/documents\/list/u);
assert.match(partnerSource, /DOCUMENTS_VIEW_STORAGE_KEY/u);
assert.match(partnerSource, /data-view-mode="tiles"/u);
assert.match(partnerSource, /data-view-mode="table"/u);
assert.doesNotMatch(partnerSource, /onclick="event\.stopPropagation\(\)"/u);
assert.match(partnerSource, /PROFILE_TAB_STORAGE_KEY/u);
assert.match(partnerSource, /data-action="switch-account"/u);
assert.match(partnerSource, /Для кабинета используйте реквизиты СДО партнёра/u);
assert.match(partnerSource, /sessionUser\?\.role === "partner"[\s\S]{0,100}loadPortal\(false\)/u);
assert.match(partnerSource, /title="Экспорт выплат в CSV"[\s\S]{0,120}CSV/u);
assert.match(stylesSource, /\.partner-filters\s*\{[\s\S]{0,180}minmax\(145px, 1\.3fr\)/u);
assert.match(stylesSource, /\.partner-filter-actions > :is\([\s\S]{0,180}min-height: 32px/u);
assert.match(deploySource, /"partner-app\.js"/u);

console.log("partner portal tests: OK");

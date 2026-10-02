"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const serverPath = path.join(root, "app-server.js");
const serverSource = fs.readFileSync(serverPath, "utf8").replace(/\r\n/g, "\n");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n?/gu, "\n");
const authSource = fs.readFileSync(path.join(root, "auth-bootstrap.js"), "utf8").replace(/\r\n?/gu, "\n");
const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8").replace(/\r\n?/gu, "\n");
const supervisorSource = fs.readFileSync(
  path.join(root, "scripts", "start-remote-services.ps1"),
  "utf8"
).replace(/\r\n?/gu, "\n");
const XLSX = require(path.join(root, "vendor", "sheetjs", "xlsx.full.min.js"));
const {
  parseAdvertisingSitesWorkbook,
  normalizeAdvertisingSitesNumber,
  buildAdvertisingSitesConnectionSettings,
  advertisingSitesConnectionIdentityMatches,
  assertAdvertisingSitesConnectionIdentities,
  publicAdvertisingSitesSettings,
  formatAdvertisingSitesSummaryValue,
  buildAdvertisingSitesRowsFromPrograms,
  buildAdvertisingSitesPlan,
  hashAdvertisingSitesSnapshot,
  advertisingSitesSnapshotHashesEqual,
  applyAdvertisingSitesOperations,
  compensateAdvertisingSitesPreImages,
  executeAdvertisingSitesPlanWithPools
} = require(serverPath);

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Не найден блок ${startMarker}`);
  return source.slice(start, end);
}

function programRow(overrides = {}) {
  return {
    rowNumber: 2,
    name: "Программа",
    shortName: "Программа",
    status: "Набор",
    type: "ППП",
    promoSite: "https://example.test/program",
    price: 4000,
    oldPrice: 5000,
    landingBlockNumber: 1,
    landingPostId: 3666,
    shopProductId: 7001,
    ...overrides
  };
}

assert.equal(normalizeAdvertisingSitesNumber("1 250,50"), 1250.5);
assert.equal(normalizeAdvertisingSitesNumber("42", { integer: true, minimum: 1 }), 42);
assert.equal(normalizeAdvertisingSitesNumber("42.5", { integer: true, minimum: 1 }), null);
assert.equal(normalizeAdvertisingSitesNumber("1 OR 1=1", { integer: true, minimum: 1 }), null);
assert.equal(normalizeAdvertisingSitesNumber(Number.MAX_SAFE_INTEGER + 1, { integer: true }), null);
assert.equal(normalizeAdvertisingSitesNumber(1001, { maximum: 1000 }), null);
assert.equal(formatAdvertisingSitesSummaryValue(1, 1000), "1 курс по цене от 1000 руб.");
assert.equal(formatAdvertisingSitesSummaryValue(2, 1000), "2 курса по цене от 1000 руб.");
assert.equal(formatAdvertisingSitesSummaryValue(12, 1000), "12 курсов по цене от 1000 руб.");
assert.throws(
  () => buildAdvertisingSitesPlan(Array.from({ length: 10001 }, (_, index) => ({ rowNumber: index + 2 }))),
  /слишком много строк/iu
);

const fixtureWorkbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(fixtureWorkbook, XLSX.utils.aoa_to_sheet([
  [
    "Наименование программы",
    "Наименование программы (без часов)",
    "Статус",
    "Тип",
    "На промо сайте",
    "Стоимость",
    "Старая цена",
    "№ в лендинге",
    "Код лендинга",
    "Код"
  ],
  ["Тестовая программа", "Тестовая", "Набор", "КПК", "https://example.test", 2000, "", 2, 123, 456]
]), "Реестр программ");
const macroSettingsSecret = "fixture-password-that-must-not-leak";
XLSX.utils.book_append_sheet(fixtureWorkbook, XLSX.utils.aoa_to_sheet([[
  [
    "Лендинг_SQL_сервер=landing.example.test",
    "Лендинг_SQL_база=landing_db",
    "Лендинг_SQL_пользователь=landing_user",
    `Лендинг_SQL_пароль=${macroSettingsSecret}`,
    "Магазин_SQL_сервер=shop.example.test",
    "Магазин_SQL_база=shop_db",
    "Магазин_SQL_пользователь=shop_user",
    `Магазин_SQL_пароль=${macroSettingsSecret}`
  ].join("\n")
]]), "Настройки");
fixtureWorkbook.Workbook = fixtureWorkbook.Workbook || {};
fixtureWorkbook.Workbook.Names = [{ Name: "НастройкиМакросов", Ref: "'Настройки'!$A$1" }];
const parsedFixture = parseAdvertisingSitesWorkbook(XLSX.write(fixtureWorkbook, {
  type: "buffer",
  bookType: "xlsb"
}));
assert.equal(parsedFixture.rows.length, 1);
assert.equal(parsedFixture.rows[0].landingBlockNumber, 2);
assert.equal(parsedFixture.macroSettings.landingMysqlHost, "landing.example.test");
assert.equal(parsedFixture.macroSettings.applicationsMysqlHost, "shop.example.test");
const fixtureConnections = buildAdvertisingSitesConnectionSettings(
  parsedFixture.macroSettings,
  parsedFixture.macroSettingsSecret
);
const publicFixtureSettings = publicAdvertisingSitesSettings(fixtureConnections, "local");
assert.equal(publicFixtureSettings.source, "mysql");
assert.equal(publicFixtureSettings.landing.configured, true);
assert.equal(publicFixtureSettings.shop.configured, true);
assert.equal(publicFixtureSettings.landing.hasPassword, true);
assert.doesNotMatch(JSON.stringify(publicFixtureSettings), new RegExp(macroSettingsSecret, "u"));
assert.equal(Object.prototype.hasOwnProperty.call(publicFixtureSettings.landing, "password"), false);
assert.equal(Object.prototype.hasOwnProperty.call(publicFixtureSettings.shop, "password"), false);
assert.equal(publicAdvertisingSitesSettings(fixtureConnections, "mysql").source, "mysql");

const sharedStateRows = buildAdvertisingSitesRowsFromPrograms([{
  xlsbProgramRow: 17,
  name: "Программа из MySQL",
  shortName: "Программа",
  status: "Набор",
  type: "КПК",
  promoSite: "https://example.test/mysql",
  price: 3200,
  oldPrice: 4000,
  landingPosition: 4,
  landingCode: 4321,
  productId: 8765
}]);
assert.deepEqual(sharedStateRows, [{
  rowNumber: 17,
  name: "Программа из MySQL",
  shortName: "Программа",
  status: "Набор",
  type: "КПК",
  promoSite: "https://example.test/mysql",
  price: 3200,
  oldPrice: 4000,
  landingBlockNumber: 4,
  landingPostId: 4321,
  shopProductId: 8765
}]);
assert.equal(buildAdvertisingSitesPlan(sharedStateRows).summary.ready, 1);
assert.deepEqual(
  buildAdvertisingSitesRowsFromPrograms([
    { xlsbProgramRow: 3, name: "Третья строка" },
    { xlsbProgramRow: 2, name: "Вторая строка" }
  ]).map((row) => row.rowNumber),
  [2, 3],
  "Строки MySQL должны восстанавливать порядок реестра перед построением зависимого от порядка плана"
);
const matchingServerConnections = {
  landing: {
    ...fixtureConnections.landing,
    password: undefined,
    hasPassword: true,
    configured: true,
    valid: true
  },
  shop: {
    ...fixtureConnections.shop,
    password: undefined,
    hasPassword: true,
    configured: true,
    valid: true
  }
};
assert.equal(
  advertisingSitesConnectionIdentityMatches(fixtureConnections.landing, matchingServerConnections.landing),
  true
);
assert.doesNotThrow(() => assertAdvertisingSitesConnectionIdentities(
  fixtureConnections,
  matchingServerConnections
));
assert.throws(
  () => assertAdvertisingSitesConnectionIdentities(fixtureConnections, {
    ...matchingServerConnections,
    shop: { ...matchingServerConnections.shop, database: "unexpected_database" }
  }),
  /не совпадают/iu
);

const ordinaryPlan = buildAdvertisingSitesPlan([
  programRow({ oldPrice: "" }),
  programRow({
    rowNumber: 3,
    name: "Повышение квалификации",
    shortName: "Повышение квалификации",
    type: "КПК",
    price: 1200,
    oldPrice: 1500,
    landingBlockNumber: 2,
    landingPostId: 3667,
    shopProductId: 7002
  }),
  programRow({
    rowNumber: 4,
    name: "Дополнительная программа",
    shortName: "Дополнительная программа",
    type: "ДОП",
    price: 290,
    oldPrice: 500,
    landingBlockNumber: 3,
    landingPostId: 3668,
    shopProductId: 7003
  })
]);
assert.equal(ordinaryPlan.rows.every((row) => row.ready), true);
assert.equal(ordinaryPlan.rows[0].oldPrice, 5000);
assert.equal(ordinaryPlan.rows[0].oldPriceDerived, true);
assert.equal(ordinaryPlan.rows[0].landingCode, 3666);
assert.equal(ordinaryPlan.rows[0].landingPosition, 1);
assert.equal(ordinaryPlan.rows[0].productId, 7001);
assert.equal(ordinaryPlan.summary.totalRows, 3);
assert.equal(ordinaryPlan.summary.ready, 3);
assert.equal(ordinaryPlan.summary.skipped, 0);
assert.equal(ordinaryPlan.categories.length, 3);
assert.equal(ordinaryPlan.summary.courses.professionalRetraining.count, 1);
assert.equal(ordinaryPlan.summary.courses.advancedTraining.minimumPrice, 1200);
assert.equal(ordinaryPlan.summary.courses.additionalPrograms.minimumPrice, 290);
assert.ok(ordinaryPlan.operations.landing.some((operation) => (
  operation.metaKey === "blok_ceny_0_stoimost_kursa" && operation.value === "4000"
)));
assert.ok(ordinaryPlan.operations.landing.some((operation) => (
  operation.metaKey === "blok_ceny_0_staraya_cena" && operation.value === "5000"
)));
assert.ok(ordinaryPlan.operations.landing.some((operation) => (
  operation.metaKey === "blok_ceny_0_ssylka_na_registraciyu"
  && operation.value === "https://zifra-plus.ru/checkout/?add-to-cart=7001"
)));
assert.ok(ordinaryPlan.operations.landing.some((operation) => (
  operation.metaKey === "blok_ceny_0_skidka" && operation.value === "20"
)));
assert.ok(ordinaryPlan.operations.shop.some((operation) => operation.metaKey === "_sale_price"));
assert.ok(ordinaryPlan.operations.shop.some((operation) => operation.metaKey === "_price"));
assert.ok(ordinaryPlan.operations.shop.some((operation) => operation.metaKey === "_regular_price"));
[
  "parametry_glavnoj_stranicy_0_cena_kursov_1",
  "parametry_glavnoj_stranicy_0_cena_kursov_2",
  "parametry_glavnoj_stranicy_0_cena_kursov_3"
].forEach((metaKey) => {
  assert.ok(ordinaryPlan.operations.landing.some((operation) => (
    operation.kind === "summary" && operation.postId === null && operation.metaKey === metaKey
  )));
});

const missingProductPlan = buildAdvertisingSitesPlan([
  programRow({ shopProductId: "" })
]);
assert.equal(missingProductPlan.summary.ready, 1);
assert.equal(missingProductPlan.summary.partialRows, 1);
assert.equal(missingProductPlan.summary.skipped, 0);
assert.equal(missingProductPlan.rows[0].ready, true);
assert.equal(missingProductPlan.rows[0].partial, true);
assert.ok(missingProductPlan.rows[0].skippedReasons.includes("shopProductId"));
assert.match(missingProductPlan.rows[0].reason, /код товара/iu);
assert.equal(missingProductPlan.operations.shop.length, 0);
assert.equal(missingProductPlan.operations.landing.filter((operation) => operation.kind === "program").length, 4);
assert.equal(missingProductPlan.operations.landing.some((operation) => (
  operation.metaKey === "blok_ceny_0_ssylka_na_registraciyu"
)), false);
assert.doesNotMatch(JSON.stringify(missingProductPlan.operations), /add-to-cart=$/u);
assert.match(missingProductPlan.warnings.join(" "), /обновляется только лендинг/iu);

const missingProductDoesNotAmbiguateCheckoutPlan = buildAdvertisingSitesPlan([
  programRow({ rowNumber: 5, landingPostId: 3777, landingBlockNumber: 1, shopProductId: "" }),
  programRow({ rowNumber: 6, landingPostId: 3777, landingBlockNumber: 1, shopProductId: 7301 })
]);
assert.equal(missingProductDoesNotAmbiguateCheckoutPlan.summary.duplicateLandingSlots, 0);
assert.equal(missingProductDoesNotAmbiguateCheckoutPlan.summary.ready, 2);
assert.equal(missingProductDoesNotAmbiguateCheckoutPlan.summary.partialRows, 1);
assert.equal(missingProductDoesNotAmbiguateCheckoutPlan.operations.shop.length, 3);
assert.ok(missingProductDoesNotAmbiguateCheckoutPlan.operations.landing.some((operation) => (
  operation.metaKey === "blok_ceny_0_ssylka_na_registraciyu"
  && operation.value.endsWith("=7301")
)));

const previousWorksheetRowPlan = buildAdvertisingSitesPlan([
  programRow({ rowNumber: 30, landingPostId: 5001, landingBlockNumber: 1, shopProductId: 9001 }),
  programRow({
    rowNumber: 31,
    status: "Архив",
    landingPostId: 5002,
    landingBlockNumber: 2,
    shopProductId: 9002
  }),
  programRow({ rowNumber: 32, landingPostId: 5002, landingBlockNumber: 3, shopProductId: 9003 })
]);
assert.ok(previousWorksheetRowPlan.operations.landing.some((operation) => (
  operation.postId === 5001 && operation.metaKey === "stoimost_kursa"
)));
assert.equal(previousWorksheetRowPlan.operations.landing.some((operation) => (
  operation.postId === 5002 && operation.metaKey === "stoimost_kursa"
)), false);

const duplicateSlotPlan = buildAdvertisingSitesPlan([
  programRow({ rowNumber: 10, name: "Первый", shortName: "Первый", shopProductId: 7101 }),
  programRow({ rowNumber: 11, name: "Второй", shortName: "Второй", shopProductId: 7102 })
]);
assert.equal(duplicateSlotPlan.summary.ready, 2);
assert.equal(duplicateSlotPlan.summary.partialRows, 2);
assert.equal(duplicateSlotPlan.summary.duplicateLandingSlots, 1);
assert.equal(duplicateSlotPlan.rows.every((row) => row.ready && row.partial), true);
assert.equal(duplicateSlotPlan.rows.every((row) => row.skippedReasons.includes("duplicateLandingSlot")), true);
assert.equal(duplicateSlotPlan.operations.shop.length, 6);
assert.equal(duplicateSlotPlan.operations.landing.filter((operation) => operation.kind === "program").length, 4);
assert.equal(duplicateSlotPlan.operations.landing.some((operation) => (
  operation.metaKey === "blok_ceny_0_ssylka_na_registraciyu"
)), false);
assert.match(duplicateSlotPlan.warnings.join(" "), /Повторяющихся позиций лендинга/iu);

const conflictingDuplicateSlotPlan = buildAdvertisingSitesPlan([
  programRow({ rowNumber: 12, name: "Первый", shortName: "Первый", shopProductId: 7201 }),
  programRow({ rowNumber: 13, name: "Второй", shortName: "Второй", price: 4500, shopProductId: 7202 })
]);
assert.equal(conflictingDuplicateSlotPlan.operations.shop.length, 6);
assert.equal(
  conflictingDuplicateSlotPlan.operations.landing.filter((operation) => operation.kind === "program").length,
  0
);
assert.equal(conflictingDuplicateSlotPlan.rows.every((row) => row.ready && row.partial), true);

const conflictingProductPlan = buildAdvertisingSitesPlan([
  programRow({ rowNumber: 20, landingPostId: 4001, landingBlockNumber: 1, shopProductId: 8001 }),
  programRow({ rowNumber: 21, landingPostId: 4002, landingBlockNumber: 1, shopProductId: 8001, price: 4500 })
]);
assert.ok(conflictingProductPlan.summary.conflictingTargets >= 1);
assert.equal(conflictingProductPlan.rows.every((row) => row.ready && row.partial), true);
assert.equal(conflictingProductPlan.operations.shop.length, 0);
assert.ok(conflictingProductPlan.operations.landing.filter((operation) => operation.kind === "program").length > 0);

const sourceHash = "a".repeat(64);
const snapshotHash = hashAdvertisingSitesSnapshot({ source: "mysql", sourceHash, plan: ordinaryPlan });
assert.match(snapshotHash, /^[a-f0-9]{64}$/u);
assert.equal(snapshotHash, hashAdvertisingSitesSnapshot({ source: "mysql", sourceHash, plan: ordinaryPlan }));
assert.equal(snapshotHash, hashAdvertisingSitesSnapshot({ source: "local", sourceHash, plan: ordinaryPlan }));
assert.equal(advertisingSitesSnapshotHashesEqual(snapshotHash, snapshotHash.toUpperCase()), true);
assert.equal(advertisingSitesSnapshotHashesEqual(snapshotHash, "b".repeat(64)), false);

async function testParameterizedUpdates() {
  const calls = [];
  const connection = {
    async execute(sql, parameters) {
      const sqlText = typeof sql === "string" ? sql : sql?.sql;
      calls.push({ sql: sqlText, options: sql, parameters });
      assert.match(sqlText, /\?/u);
      assert.equal(typeof sql === "object" ? sql.timeout : 10000, 10000);
      if (/^SELECT/u.test(sqlText)) return [[{ meta_id: 1, meta_value: "old" }], []];
      assert.match(sqlText, /^UPDATE wp_postmeta SET meta_value = \?/u);
      return [{ affectedRows: 1 }, []];
    }
  };
  const operations = [
    {
      site: "landing",
      postId: 12345,
      metaKey: "blok_ceny_0_stoimost_kursa",
      value: "unique-value-not-in-sql",
      kind: "program",
      rowNumbers: [2]
    },
    {
      site: "landing",
      postId: null,
      metaKey: "parametry_glavnoj_stranicy_0_cena_kursov_1",
      value: "1 курс по цене от 1000 руб.",
      kind: "summary",
      rowNumbers: []
    }
  ];
  const report = await applyAdvertisingSitesOperations(connection, operations);
  assert.equal(report.matched, 2);
  assert.equal(report.changed, 2);
  assert.equal(report.missing, 0);
  assert.deepEqual(report.results[0].rowNumbers, [2]);
  assert.equal(report.results[0].rowCount, 1);
  calls.forEach(({ sql }) => {
    assert.doesNotMatch(sql, /unique-value-not-in-sql/u);
    assert.doesNotMatch(sql, /12345/u);
    assert.doesNotMatch(sql, /1 курс/u);
  });
  assert.ok(calls.some(({ sql, parameters }) => (
    /^UPDATE/u.test(sql) && parameters[0] === "unique-value-not-in-sql" && parameters[1] === 12345
  )));
}

function fakePool(site, options = {}) {
  const state = {
    began: 0,
    committed: 0,
    commitAttempts: 0,
    rolledBack: 0,
    released: 0,
    calls: []
  };
  const connection = {
    async beginTransaction() { state.began += 1; },
    async commit() {
      state.commitAttempts += 1;
      if (options.failCommitAt === state.commitAttempts) throw new Error("fixture commit failure");
      state.committed += 1;
    },
    async rollback() { state.rolledBack += 1; },
    release() { state.released += 1; },
    async execute(sql, parameters) {
      const sqlText = typeof sql === "string" ? sql : sql?.sql;
      state.calls.push({ sql: sqlText, options: sql, parameters });
      if (options.fail && /^UPDATE/u.test(sqlText)) throw new Error("fixture failure");
      if (/^SELECT/u.test(sqlText)) {
        return options.missing ? [[], []] : [[{ meta_id: 1, meta_value: "old" }], []];
      }
      return [{ affectedRows: 1 }, []];
    }
  };
  return {
    state,
    async getConnection() { return connection; },
    site
  };
}

async function testSeparateTransactions() {
  const landing = fakePool("landing");
  const shop = fakePool("shop");
  const report = await executeAdvertisingSitesPlanWithPools(ordinaryPlan, { landing, shop });
  assert.equal(landing.state.began, 1);
  assert.equal(shop.state.began, 1);
  assert.equal(landing.state.committed, 1);
  assert.equal(shop.state.committed, 1);
  assert.equal(landing.state.released, 1);
  assert.equal(shop.state.released, 1);
  assert.ok(report.landing.matched > 0);
  assert.ok(report.shop.matched > 0);
  assert.equal(report.homepage.matched, 3);

  const failingLanding = fakePool("landing");
  const failingShop = fakePool("shop", { fail: true });
  await assert.rejects(
    () => executeAdvertisingSitesPlanWithPools(ordinaryPlan, {
      landing: failingLanding,
      shop: failingShop
    }),
    /fixture failure/u
  );
  assert.equal(failingLanding.state.committed, 0);
  assert.equal(failingShop.state.committed, 0);
  assert.equal(failingLanding.state.rolledBack, 1);
  assert.equal(failingShop.state.rolledBack, 1);
  assert.equal(failingLanding.state.released, 1);
  assert.equal(failingShop.state.released, 1);

  const missingLanding = fakePool("landing", { missing: true });
  const missingShop = fakePool("shop", { missing: true });
  await assert.rejects(
    () => executeAdvertisingSitesPlanWithPools(ordinaryPlan, {
      landing: missingLanding,
      shop: missingShop
    }),
    /не найдено ни одного поля/iu
  );
  assert.equal(missingLanding.state.committed, 0);
  assert.equal(missingShop.state.committed, 0);

  const compensatedLanding = fakePool("landing");
  const compensatedShop = fakePool("shop", { failCommitAt: 1 });
  await assert.rejects(
    () => executeAdvertisingSitesPlanWithPools(ordinaryPlan, {
      landing: compensatedLanding,
      shop: compensatedShop
    }),
    /значения восстановлены/iu
  );
  assert.ok(compensatedLanding.state.calls.some(({ sql }) => /WHERE meta_id = \?/u.test(sql)));
  assert.ok(compensatedShop.state.calls.some(({ sql }) => /WHERE meta_id = \?/u.test(sql)));
  assert.equal(compensatedLanding.state.commitAttempts, 2);
  assert.equal(compensatedShop.state.commitAttempts, 2);
  assert.ok(compensatedLanding.state.released >= 2);
  assert.ok(compensatedShop.state.released >= 2);

  const thirdPartyState = { released: 0, rolledBack: 0 };
  const thirdPartyPool = {
    async getConnection() {
      return {
        async beginTransaction() {},
        async commit() {},
        async rollback() { thirdPartyState.rolledBack += 1; },
        release() { thirdPartyState.released += 1; },
        async execute(sql) {
          const sqlText = typeof sql === "string" ? sql : sql?.sql;
          if (/^UPDATE/u.test(sqlText)) return [{ affectedRows: 0 }, []];
          return [[{ meta_value: "third-party-value" }], []];
        }
      };
    }
  };
  assert.equal(await compensateAdvertisingSitesPreImages(thirdPartyPool, [{
    metaId: "1",
    value: "old",
    appliedValue: "applied"
  }]), false);
  assert.equal(thirdPartyState.rolledBack, 1);
  assert.equal(thirdPartyState.released, 1);
}

const handlerBlock = sourceBlock(
  serverSource,
  "async function handleAdvertisingSites(",
  "function normalizeAgentPaymentWorkbookRate("
);
assert.ok(
  handlerBlock.indexOf('authUser?.role !== "admin"') < handlerBlock.indexOf('req.method === "GET"'),
  "Проверка роли должна предшествовать чтению основной MySQL-базы"
);
assert.match(handlerBlock, /body\?\.confirm !== true/u);
assert.match(handlerBlock, /advertisingSitesUpdateInProgress/u);
assert.match(handlerBlock, /summary\?\.ready/u);
assert.match(handlerBlock, /getAssistantStatisticsMySqlPool\(\)/u);
assert.match(handlerBlock, /getStudentApplicationsMySqlPool\(\)/u);
assert.doesNotMatch(handlerBlock, /\.end\(\)/u);
assert.match(handlerBlock, /action: "Обновление сайтов"/u);
assert.match(handlerBlock, /updatedAt/u);
assert.match(handlerBlock, /report\.missing \|\| preview\.plan\.summary\.partialRows \? "partial"/u);
assert.match(handlerBlock, /categories: preview\.plan\.categories/u);
assert.match(handlerBlock, /connections/u);
assert.match(handlerBlock, /warnings/u);
const adminOnlyBlock = sourceBlock(serverSource, "const adminOnlyRequest = (", "if (adminOnlyRequest");
assert.match(adminOnlyBlock, /"\/api\/advertising\/sites"/u);
assert.match(serverSource, /requestUrl\.pathname === "\/api\/advertising\/sites"[\s\S]*handleAdvertisingSites/u);
const previewBlock = sourceBlock(
  serverSource,
  "async function buildAdvertisingSitesPreview(",
  "async function applyAdvertisingSitesOperations("
);
assert.match(previewBlock, /buildAdvertisingSitesServerConnectionSettings\(\)/u);
assert.match(previewBlock, /readSharedApplicationStateMySqlDocument\(pool\)/u);
assert.match(previewBlock, /buildAdvertisingSitesRowsFromPrograms\(programs\)/u);
assert.match(previewBlock, /connections:\s*\{[\s\S]*landing:\s*publicConnectionIdentity/u);
assert.doesNotMatch(previewBlock, /loadStudentDatabaseBytes|parseAdvertisingSitesWorkbook/u);
assert.doesNotMatch(previewBlock, /mysql\.createPool|password:\s*connection\.password/u);
assert.doesNotMatch(handlerBlock, /searchParams\.get\("source"\)|body\?\.source/u);
assert.match(serverSource, /"№ в лендинге": "landingPosition"/u);
assert.match(serverSource, /"Код": "productId"/u);
assert.match(serverSource, /function getAssistantStatisticsMySqlPool[\s\S]*process\.platform !== "win32"[\s\S]*timeweb/u);
assert.match(serverSource, /function getStudentApplicationsMySqlPool[\s\S]*process\.platform !== "win32"[\s\S]*timeweb/u);
const applyBlock = sourceBlock(
  serverSource,
  "async function applyAdvertisingSitesOperations(",
  "async function executeAdvertisingSitesPlanWithPools("
);
assert.match(applyBlock, /WHERE post_id = \? AND meta_key = \?/u);
assert.match(applyBlock, /WHERE meta_key = \?/u);
assert.doesNotMatch(applyBlock, /\$\{operation\.(?:value|postId|metaKey)\}/u);
assert.match(serverSource, /WHERE meta_id = \? AND BINARY meta_value = BINARY \?/u);

const sitesRenderBlock = sourceBlock(
  appSource,
  "  function renderAdvertisingSites()",
  "  function shouldRetryAdvertisingSitesPreview("
);
assert.doesNotMatch(sitesRenderBlock, /Реестр программ XLSB/iu);
assert.doesNotMatch(sitesRenderBlock, /Цены, скидки и ссылки будут подготовлены/iu);
assert.match(sitesRenderBlock, /<h2>Обновление сайтов<\/h2>/u);
assert.match(sitesRenderBlock, /data-action="refresh-advertising-sites"/u);
assert.match(sitesRenderBlock, /data-action="apply-advertising-sites"/u);

const sitesRetryBlock = sourceBlock(
  appSource,
  "  function shouldRetryAdvertisingSitesPreview(",
  "  async function loadAdvertisingSitesPreview("
);
assert.match(sitesRetryBlock, /\[500, 502, 503, 504\]/u);
assert.match(sitesRetryBlock, /maximumAttempts = 3/u);

async function testAdvertisingSitesPreviewRetry() {
  let calls = 0;
  const retryContext = {
    Number,
    Error,
    window: {
      setTimeout(callback) {
        callback();
        return 1;
      }
    },
    fetch: async () => {
      calls += 1;
      return {
        status: calls < 3 ? 503 : 200,
        arrayBuffer: async () => new ArrayBuffer(0)
      };
    }
  };
  vm.createContext(retryContext);
  vm.runInContext(
    `${sitesRetryBlock}\nthis.fetchAdvertisingSitesPreview = fetchAdvertisingSitesPreview;`,
    retryContext
  );
  const response = await retryContext.fetchAdvertisingSitesPreview("/api/advertising/sites");
  assert.equal(response.status, 200);
  assert.equal(calls, 3);
}

const tunnelOriginBlock = sourceBlock(
  supervisorSource,
  "function Test-ManagedTunnelOrigin(",
  "function Ensure-Containers("
);
assert.match(tunnelOriginBlock, /Test-ApplicationRuntime/u);
assert.match(tunnelOriginBlock, /\$OnlyOfficeSecret 15/u);
assert.doesNotMatch(tunnelOriginBlock, /8082|8083/u);
const managedTunnelLoopBlock = sourceBlock(
  supervisorSource,
  "      if ($ParentProcessId -gt 0) {",
  "      } else {\n        Ensure-Containers"
);
assert.match(managedTunnelLoopBlock, /адрес внешнего туннеля сохранён/u);
assert.doesNotMatch(managedTunnelLoopBlock, /Stop-Process/u);

const authBuild = authSource.match(/const AUTH_BUILD = "([^"]+)";/u)?.[1] || "";
const indexBuild = indexSource.match(/const build = "([^"]+)";/u)?.[1] || "";
const cssBuild = indexSource.match(/styles\.css\?v=([^"']+)/u)?.[1] || "";
assert.ok(authBuild);
assert.equal(indexBuild, authBuild);
assert.equal(cssBuild, authBuild);

Promise.resolve()
  .then(testAdvertisingSitesPreviewRetry)
  .then(testParameterizedUpdates)
  .then(testSeparateTransactions)
  .then(() => console.log("advertising sites checks: OK"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

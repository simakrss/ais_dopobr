const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const serverPath = path.resolve(__dirname, "..", "app-server.js");
const clientPath = path.resolve(__dirname, "..", "app.js");
const serverSource = fs.readFileSync(serverPath, "utf8").replace(/\r\n?/gu, "\n");
const clientSource = fs.readFileSync(clientPath, "utf8").replace(/\r\n?/gu, "\n");
const {
  hashStudentDatabaseCriticalSnapshot,
  hashStudentDatabaseCriticalIdentity,
  getStudentDatabaseEmbeddedSyncTimestamp,
  normalizeStudentDatabaseSyncBaseline,
  resolveStudentDatabaseSyncDirection,
  acquireStudentDatabaseSyncReservation,
  releaseStudentDatabaseSyncReservation,
  getActiveStudentDatabaseSyncReservation
} = require(serverPath);

function extractBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, "Не найдено начало блока: " + startMarker);
  assert.ok(end > start, "Не найден конец блока: " + endMarker);
  return source.slice(start, end).trim();
}

function statusError(statusCode, messagePattern) {
  return (error) => {
    assert.equal(error && error.statusCode, statusCode);
    if (messagePattern) assert.match(String((error && error.message) || ""), messagePattern);
    return true;
  };
}

function hash(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function testCompleteBaselineAndInitialMigrationSafety() {
  const complete = {
    version: 1,
    sourceHash: "a".repeat(64),
    sourceIdentity: "b".repeat(64),
    webRevision: 17,
    synchronizedAt: "2026-08-20T10:00:00.000Z"
  };
  assert.deepEqual(normalizeStudentDatabaseSyncBaseline(complete), {
    ...complete,
    criticalHash: "",
    criticalIdentityHash: ""
  });
  for (const [field, replacement] of [
    ["sourceHash", ""],
    ["sourceIdentity", ""],
    ["webRevision", 0],
    ["synchronizedAt", ""]
  ]) {
    assert.throws(
      () => resolveStudentDatabaseSyncDirection({
        baseline: { ...complete, [field]: replacement },
        currentWebRevision: 17,
        sourceHash: complete.sourceHash,
        sourceIdentity: complete.sourceIdentity
      }),
      statusError(409, /контрольная точка[^.]*неполна/iu),
      "Неполная baseline должна блокироваться: " + field
    );
  }

  const initial = {
    currentWebRevision: 17,
    currentWebUpdatedAt: "2026-08-20T11:00:00.000Z",
    sourceHash: "c".repeat(64),
    sourceIdentity: "d".repeat(64),
    sourceModifiedAt: "2026-08-20T12:00:00.000Z",
    lastSynchronizedAt: "2026-08-20T10:00:00.000Z"
  };
  assert.throws(
    () => resolveStudentDatabaseSyncDirection({ ...initial, currentWebUpdatedAt: "" }),
    statusError(409, /не удалось получить время изменения/iu)
  );
  assert.throws(
    () => resolveStudentDatabaseSyncDirection({ ...initial, sourceModifiedAt: "" }),
    statusError(409, /не удалось получить время изменения/iu)
  );
  assert.throws(
    () => resolveStudentDatabaseSyncDirection({ ...initial, lastSynchronizedAt: "" }),
    statusError(409, /нет достоверной контрольной точки/iu)
  );
  assert.throws(
    () => resolveStudentDatabaseSyncDirection(initial),
    statusError(409, /менялись и Web-база, и файл XLSB/iu)
  );
  assert.throws(
    () => resolveStudentDatabaseSyncDirection({
      ...initial,
      currentWebUpdatedAt: "2026-08-20T09:00:00.000Z",
      sourceModifiedAt: "2026-08-20T09:30:00.000Z"
    }),
    statusError(409, /контрольной суммы[^.]*нет|совпадение данных не доказано/iu),
    "Одни timestamps не доказывают равенство Web и XLSB без content baseline"
  );
}

function buildCriticalData(status = "На зачисление", extraStudent = {}) {
  return {
    students: [{
      id: "web-only-id",
      uid: "1169",
      name: "Колюпанова Ирина Юрьевна",
      applicationDate: "2026-08-20",
      program: "Курс (72 ч)",
      status,
      additionalStatus: status === "Учится" ? "Обучающиеся" : "На зачисление",
      ...extraStudent
    }],
    contracts: [],
    directExpenses: [],
    generalExpenses: [],
    inventoryRows: [],
    programs: [],
    trainingPlans: []
  };
}

function testCriticalDataDirectionAndLegacyMigration() {
  const base = buildCriticalData();
  const excelChanged = buildCriticalData("Учится");
  const webChanged = buildCriticalData("Отчислен");
  const baseHash = hashStudentDatabaseCriticalSnapshot(base);
  const baseIdentity = hashStudentDatabaseCriticalIdentity(base);
  assert.equal(
    getStudentDatabaseEmbeddedSyncTimestamp({
      students: [
        { databaseSync: { syncedAt: "2026-08-24T13:49:46.000Z" } },
        { databaseSync: { syncedAt: "2026-08-24T13:49:46.000Z" } },
        { databaseSync: { syncedAt: "2026-08-23T10:00:00.000Z" } }
      ]
    }),
    "2026-08-24T13:49:46.000Z"
  );
  assert.equal(
    hashStudentDatabaseCriticalSnapshot(buildCriticalData("На зачисление", {
      id: "another-web-id",
      photoData: "data:image/jpeg;base64,ignored",
      portalAccessMessage: "Вычисляемое сообщение"
    })),
    baseHash,
    "Web-only и вычисляемые поля не должны блокировать синхронизацию XLSB"
  );
  assert.equal(hashStudentDatabaseCriticalIdentity(excelChanged), baseIdentity);
  const baseline = {
    version: 2,
    sourceHash: "a".repeat(64),
    sourceIdentity: "b".repeat(64),
    webRevision: 17,
    synchronizedAt: "2026-08-20T10:00:00.000Z",
    criticalHash: baseHash,
    criticalIdentityHash: baseIdentity
  };
  const common = {
    baseline,
    currentWebRevision: 99,
    sourceHash: "f".repeat(64),
    sourceIdentity: baseline.sourceIdentity,
    currentWebCriticalHash: baseHash,
    currentExcelCriticalHash: hashStudentDatabaseCriticalSnapshot(excelChanged),
    currentWebCriticalIdentityHash: baseIdentity,
    currentExcelCriticalIdentityHash: baseIdentity
  };
  assert.equal(resolveStudentDatabaseSyncDirection(common).direction, "excel-to-web");
  assert.equal(
    resolveStudentDatabaseSyncDirection({
      ...common,
      baseline: {
        version: 1,
        sourceHash: "a".repeat(64),
        sourceIdentity: baseline.sourceIdentity,
        webRevision: 17,
        synchronizedAt: baseline.synchronizedAt
      },
      currentWebCriticalHash: baseHash,
      currentExcelCriticalHash: baseHash
    }).direction,
    "unchanged",
    "Общая ревизия и двоичный хеш не должны считать некритичные изменения конфликтом"
  );
  assert.throws(
    () => resolveStudentDatabaseSyncDirection({
      ...common,
      currentWebCriticalHash: hashStudentDatabaseCriticalSnapshot(webChanged)
    }),
    statusError(409, /критичные данные изменились и в Web-базе, и в XLSB/iu)
  );
  const webToExcelAfterStableBinaryDrift = resolveStudentDatabaseSyncDirection({
    ...common,
    currentWebRevision: baseline.webRevision + 2,
    sourceHash: baseline.sourceHash,
    currentWebCriticalHash: hashStudentDatabaseCriticalSnapshot(webChanged)
  });
  assert.equal(
    webToExcelAfterStableBinaryDrift.direction,
    "web-to-excel",
    "Точный sourceHash должен доказать, что XLSB не менялся, несмотря на дрейф формульного cache"
  );
  assert.equal(
    webToExcelAfterStableBinaryDrift.criticalHash,
    hashStudentDatabaseCriticalSnapshot(webChanged),
    "При доказанно неизменном XLSB новая критичная Web-правка должна стать общей baseline"
  );
  assert.equal(
    resolveStudentDatabaseSyncDirection({
      ...common,
      currentWebRevision: baseline.webRevision,
      sourceHash: baseline.sourceHash,
      currentWebCriticalHash: baseHash
    }).direction,
    "unchanged",
    "Дрейф формульного cache не должен запускать импорт при неизменных XLSB и Web"
  );
  assert.throws(
    () => resolveStudentDatabaseSyncDirection({
      ...common,
      sourceHash: baseline.sourceHash,
      sourceIdentity: "e".repeat(64),
      currentWebCriticalHash: hashStudentDatabaseCriticalSnapshot(webChanged)
    }),
    statusError(409, /другой файл или источник XLSB/iu),
    "Совпадение sourceHash не должно обходить проверку идентичности XLSB-источника"
  );
  const normalizedWebDrift = buildCriticalData("На зачисление", {
    note: "Нормализовано при импорте в Web"
  });
  const recoveredDrift = resolveStudentDatabaseSyncDirection({
    ...common,
    currentWebRevision: baseline.webRevision,
    sourceModifiedAt: "2026-08-20T12:00:00.000Z",
    currentWebCriticalUpdatedAt: "2026-08-20T09:00:00.000Z",
    currentWebAuditOldestAt: "2026-08-01T00:00:00.000Z",
    currentWebAuditComplete: false,
    currentWebCriticalHash: hashStudentDatabaseCriticalSnapshot(normalizedWebDrift),
    currentWebCriticalIdentityHash: "c".repeat(64)
  });
  assert.equal(
    recoveredDrift.direction,
    "excel-to-web",
    "Неизменная ревизия Web и стабильные identity должны разрешать изменение только XLSB"
  );
  assert.equal(recoveredDrift.recoveredBaselineDrift, true);
  assert.equal(
    resolveStudentDatabaseSyncDirection({
      ...common,
      currentWebRevision: baseline.webRevision,
      currentWebCriticalHash: hashStudentDatabaseCriticalSnapshot(normalizedWebDrift),
      currentWebCriticalIdentityHash: "c".repeat(64)
    }).direction,
    "excel-to-web",
    "Неизменная Web-ревизия должна быть достаточным доказательством при неполном audit"
  );
  const unchangedDrift = resolveStudentDatabaseSyncDirection({
    ...common,
    currentWebRevision: baseline.webRevision,
    currentWebCriticalHash: hashStudentDatabaseCriticalSnapshot(normalizedWebDrift),
    currentWebCriticalIdentityHash: "c".repeat(64),
    currentExcelCriticalHash: baseHash
  });
  assert.equal(
    unchangedDrift.direction,
    "unchanged",
    "Нормализация Web при прежней ревизии не должна перезаписывать неизменный XLSB"
  );
  assert.equal(unchangedDrift.recoveredBaselineDrift, true);
  assert.equal(
    resolveStudentDatabaseSyncDirection({
      ...common,
      currentWebRevision: baseline.webRevision + 1,
      currentWebCriticalHash: hashStudentDatabaseCriticalSnapshot(normalizedWebDrift),
      currentExcelCriticalHash: baseHash
    }).direction,
    "web-to-excel",
    "Новая ревизия Web должна сохранять обычное направление Web → Excel"
  );
  const recoveredAfterNonCriticalRevision = resolveStudentDatabaseSyncDirection({
    ...common,
    currentWebRevision: baseline.webRevision + 1,
    sourceModifiedAt: "2026-08-20T12:00:00.000Z",
    currentWebCriticalUpdatedAt: "2026-08-20T09:00:00.000Z",
    currentWebAuditOldestAt: "2026-08-01T00:00:00.000Z",
    currentWebAuditComplete: false,
    currentWebCriticalHash: hashStudentDatabaseCriticalSnapshot(normalizedWebDrift)
  });
  assert.equal(
    recoveredAfterNonCriticalRevision.direction,
    "excel-to-web",
    "Покрывающий audit должен разрешать Excel-only после некритичного роста Web-ревизии"
  );
  assert.equal(recoveredAfterNonCriticalRevision.recoveredBaselineDrift, true);
  assert.equal(
    resolveStudentDatabaseSyncDirection({
      ...common,
      currentWebRevision: baseline.webRevision + 1,
      sourceModifiedAt: "2026-08-20T12:00:00.000Z",
      currentWebCriticalUpdatedAt: "2026-08-20T09:00:00.000Z",
      currentWebAuditOldestAt: "2026-08-01T00:00:00.000Z",
      currentWebAuditComplete: false,
      currentWebCriticalHash: hashStudentDatabaseCriticalSnapshot(normalizedWebDrift),
      currentExcelCriticalHash: baseHash
    }).direction,
    "unchanged",
    "Некритичный рост Web-ревизии не должен перезаписывать неизменный XLSB"
  );
  assert.throws(
    () => resolveStudentDatabaseSyncDirection({
      ...common,
      currentWebRevision: baseline.webRevision + 1,
      sourceModifiedAt: "2026-08-20T12:00:00.000Z",
      currentWebCriticalUpdatedAt: "2026-08-20T11:00:00.000Z",
      currentWebAuditOldestAt: "2026-08-01T00:00:00.000Z",
      currentWebAuditComplete: false,
      currentWebCriticalHash: hashStudentDatabaseCriticalSnapshot(normalizedWebDrift)
    }),
    statusError(409, /критичные данные изменились и в Web-базе, и в XLSB/iu),
    "Критичное Web-изменение после baseline должно сохранить блокировку"
  );
  assert.throws(
    () => resolveStudentDatabaseSyncDirection({
      ...common,
      currentWebRevision: baseline.webRevision,
      currentWebCriticalHash: hashStudentDatabaseCriticalSnapshot(normalizedWebDrift),
      currentExcelCriticalIdentityHash: "d".repeat(64)
    }),
    statusError(409, /критичные данные изменились и в Web-базе, и в XLSB/iu),
    "Изменение состава критичных записей Excel не должно восстанавливаться автоматически"
  );
  assert.throws(
    () => resolveStudentDatabaseSyncDirection({
      ...common,
      currentWebRevision: baseline.webRevision,
      sourceIdentity: "e".repeat(64),
      currentWebCriticalHash: hashStudentDatabaseCriticalSnapshot(normalizedWebDrift)
    }),
    statusError(409, /другой файл или источник XLSB/iu),
    "Другой XLSB-источник должен блокироваться до выбора направления"
  );
  assert.equal(
    resolveStudentDatabaseSyncDirection({
      baseline: null,
      currentWebRevision: 99,
      currentWebUpdatedAt: "2026-08-24T14:52:15.000Z",
      sourceHash: "f".repeat(64),
      sourceIdentity: baseline.sourceIdentity,
      sourceModifiedAt: "2026-08-24T14:10:16.000Z",
      sourceEmbeddedSynchronizedAt: "2026-08-24T13:49:46.000Z",
      lastDownloadedAt: "2026-08-24T13:55:13.000Z",
      currentWebCriticalUpdatedAt: "2026-08-24T06:15:53.000Z",
      currentWebAuditOldestAt: "2026-08-11T14:44:52.000Z",
      currentWebAuditComplete: false,
      currentWebCriticalHash: baseHash,
      currentExcelCriticalHash: hashStudentDatabaseCriticalSnapshot(excelChanged),
      currentWebCriticalIdentityHash: baseIdentity,
      currentExcelCriticalIdentityHash: baseIdentity
    }).direction,
    "excel-to-web",
    "Служебное обновление Web после выгрузки не должно скрывать изменение критичных данных Excel"
  );
  assert.throws(
    () => resolveStudentDatabaseSyncDirection({
      baseline: null,
      currentWebRevision: 99,
      currentWebUpdatedAt: "2026-08-24T14:52:15.000Z",
      sourceHash: "f".repeat(64),
      sourceIdentity: baseline.sourceIdentity,
      sourceModifiedAt: "2026-08-24T14:10:16.000Z",
      sourceEmbeddedSynchronizedAt: "2026-08-24T13:49:46.000Z",
      currentWebCriticalUpdatedAt: "2026-08-24T14:00:00.000Z",
      currentWebAuditOldestAt: "2026-08-11T14:44:52.000Z",
      currentWebAuditComplete: false,
      currentWebCriticalHash: baseHash,
      currentExcelCriticalHash: hashStudentDatabaseCriticalSnapshot(excelChanged),
      currentWebCriticalIdentityHash: baseIdentity,
      currentExcelCriticalIdentityHash: baseIdentity
    }),
    statusError(409, /критичные данные менялись и в Web-базе, и в XLSB/iu)
  );
}

function testReservationRevisionAndTtl() {
  assert.throws(
    () => acquireStudentDatabaseSyncReservation("zero-revision", 0),
    statusError(409, /авторитетн.*ревизи/iu)
  );
  const originalNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;
  try {
    const reservation = acquireStudentDatabaseSyncReservation("ttl-job", 23, {
      databasePath: "db.xlsb",
      source: "local",
      sourceHash: "e".repeat(64)
    });
    assert.equal(reservation.expectedRevision, 23);
    assert.deepEqual(reservation.expectedSource, {
      databasePath: "db.xlsb",
      source: "local",
      expectedHash: "e".repeat(64)
    });
    assert.ok(reservation.expiresAt > now);
    assert.equal(getActiveStudentDatabaseSyncReservation().token, reservation.token);
    now = reservation.expiresAt;
    assert.equal(getActiveStudentDatabaseSyncReservation(), null);
  } finally {
    Date.now = originalNow;
    const active = getActiveStudentDatabaseSyncReservation();
    if (active) releaseStudentDatabaseSyncReservation(active.token);
  }
}

async function testAuthoritativeRevisionAssertions() {
  const source = extractBetween(
    serverSource,
    "async function assertSharedApplicationStateRevision",
    "\nfunction countWorksheetFormulaCells"
  );
  const context = {
    metadata: null,
    readAuthoritativeSharedApplicationStateMetadata: async () => context.metadata
  };
  vm.createContext(context);
  vm.runInContext(source + "\nthis.assertRevision = assertSharedApplicationStateRevision;", context);
  await assert.rejects(() => context.assertRevision(0), statusError(409, /авторитетн.*ревизи/iu));
  context.metadata = {
    revision: 9,
    offline: false,
    writable: true,
    pendingCount: 0,
    syncPending: false
  };
  assert.equal((await context.assertRevision(9)).revision, 9);
  await assert.rejects(() => context.assertRevision(8), statusError(409, /изменилась/iu));
  for (const patch of [
    { offline: true },
    { writable: false },
    { pendingCount: 1 },
    { syncPending: true }
  ]) {
    context.metadata = {
      revision: 9,
      offline: false,
      writable: true,
      pendingCount: 0,
      syncPending: false,
      ...patch
    };
    await assert.rejects(
      () => context.assertRevision(9),
      statusError(409, /ещё не завершила сохранение/iu)
    );
  }
}

function createSharedSaveContext(activeReservation, options = {}) {
  const source = extractBetween(
    serverSource,
    "async function saveSharedApplicationState(body, authUser)",
    "\nasync function handleSharedApplicationState"
  );
  const calls = { legacy: 0, released: [], sourceChecks: 0 };
  const context = {
    STUDENT_DATABASE_SYNC_RESERVATION_TTL_MS: 600000,
    process: { env: { AIS_SHARED_STATE_LOCAL_ONLY: "1" } },
    Date,
    getActiveStudentDatabaseSyncReservation: () => activeReservation,
    releaseStudentDatabaseSyncReservation: (token) => calls.released.push(token),
    assertStudentDatabaseSyncReservationSourceUnchanged: async (reservation) => {
      calls.sourceChecks += 1;
      if (typeof options.sourceCheck === "function") await options.sourceCheck(reservation);
    },
    saveLegacySharedApplicationState: async (_body, _authUser, saveOptions) => {
      if (typeof saveOptions?.beforeWrite === "function") await saveOptions.beforeWrite();
      calls.legacy += 1;
      return { conflict: false, locked: false, revision: 12 };
    }
  };
  vm.createContext(context);
  vm.runInContext(source + "\nthis.saveShared = saveSharedApplicationState;", context);
  return { context, calls };
}

async function testStrictReservationTokenAndBaseRevision() {
  let harness = createSharedSaveContext({ token: "expected", expectedRevision: 11, expiresAt: 0 });
  await assert.rejects(
    () => harness.context.saveShared({
      data: {},
      baseRevision: 11,
      strictRevision: true,
      syncCommitToken: "wrong"
    }, {}),
    statusError(423, /заблокирована/iu)
  );
  harness = createSharedSaveContext(null);
  await assert.rejects(
    () => harness.context.saveShared({
      data: {},
      baseRevision: 11,
      strictRevision: true,
      syncCommitToken: "expired"
    }, {}),
    statusError(409, /истёк/iu)
  );
  for (const body of [
    { data: {}, baseRevision: 11, strictRevision: false, syncCommitToken: "token" },
    { data: {}, baseRevision: 10, strictRevision: true, syncCommitToken: "token" }
  ]) {
    harness = createSharedSaveContext({ token: "token", expectedRevision: 11, expiresAt: 0 });
    await assert.rejects(
      () => harness.context.saveShared(body, {}),
      statusError(409, /только в подготовленную ревизию/iu)
    );
  }
  const reservation = { token: "token", expectedRevision: 11, expiresAt: 0 };
  harness = createSharedSaveContext(reservation);
  const result = await harness.context.saveShared({
    data: {},
    baseRevision: 11,
    strictRevision: true,
    syncCommitToken: "token"
  }, {});
  assert.equal(result.revision, 12);
  assert.equal(harness.calls.legacy, 1);
  assert.deepEqual(harness.calls.released, ["token"]);
  assert.ok(reservation.expiresAt > Date.now());

  const changedSourceError = new Error("Файл XLSB изменён после серверной проверки.");
  changedSourceError.statusCode = 409;
  const sourceReservation = {
    token: "source-token",
    expectedRevision: 11,
    expectedSource: {
      databasePath: "db.xlsb",
      source: "local",
      expectedHash: "a".repeat(64)
    },
    expiresAt: 0
  };
  harness = createSharedSaveContext(sourceReservation, {
    sourceCheck: async () => { throw changedSourceError; }
  });
  await assert.rejects(
    () => harness.context.saveShared({
      data: {},
      baseRevision: 11,
      strictRevision: true,
      syncCommitToken: "source-token"
    }, {}),
    statusError(409, /XLSB изменён/iu)
  );
  assert.equal(harness.calls.sourceChecks, 1);
  assert.equal(harness.calls.legacy, 0, "Web-save не должен начаться после изменения XLSB");
  assert.deepEqual(harness.calls.released, ["source-token"]);
}

function createCommitContext(body, job, sourceBytes, options = {}) {
  const source = extractBetween(
    serverSource,
    "async function handleStudentDatabaseExportCommit(req, res)",
    "\nfunction getStudentExportJob"
  );
  const calls = {
    errors: [], json: [], acquired: [], boundSources: [], released: [], revisions: [], reads: 0, saves: 0
  };
  let activeReservation = options.activeReservation || null;
  let currentSourceBytes = sourceBytes;
  const context = {
    STUDENT_DATABASE_SYNC_RESERVATION_TTL_MS: 600000,
    Date,
    studentExportJobs: new Map([[job.id, job]]),
    readJsonBody: async () => body,
    cleanupStudentExportJobs: () => {},
    sendError: (_res, status, message) => calls.errors.push({ status, message }),
    sendJson: (_res, status, payload) => calls.json.push({ status, payload }),
    getActiveStudentDatabaseSyncReservation: () => activeReservation,
    acquireStudentDatabaseSyncReservation: (jobId, revision, sourceDescriptor) => {
      calls.acquired.push({ jobId, revision });
      calls.boundSources.push(sourceDescriptor || null);
      activeReservation = {
        token: "replacement-token",
        jobId,
        expectedRevision: revision,
        expectedSource: sourceDescriptor || null,
        expiresAt: 0
      };
      return activeReservation;
    },
    releaseStudentDatabaseSyncReservation: (token) => {
      calls.released.push(token);
      if (activeReservation?.token === token) activeReservation = null;
    },
    updateStudentDatabaseSyncReservationSource: (reservation, descriptor) => {
      reservation.expectedSource = descriptor;
    },
    assertSharedApplicationStateRevision: async (revision) => calls.revisions.push(revision),
    loadStudentDatabaseBytes: async () => {
      calls.reads += 1;
      return currentSourceBytes;
    },
    hashStudentDatabaseBytes: hash,
    applyPendingStudentDatabaseServerSettings: async () => {},
    saveStudentDatabaseSyncResult: async (_path, _source, _sourceBytes, outputBytes) => {
      calls.saves += 1;
      currentSourceBytes = outputBytes;
      return { source: "local" };
    },
    updateStudentExportJob: () => {}
  };
  vm.createContext(context);
  vm.runInContext(source + "\nthis.commit = handleStudentDatabaseExportCommit;", context);
  return { context, calls };
}

async function testPreparedRevisionAndExpiredTokenRecheck() {
  let job = {
    id: "exact-revision",
    pendingCommit: { preparedWebRevision: 31 },
    result: { preparedWebRevision: 99 }
  };
  let harness = createCommitContext({ id: job.id, sharedStateRevision: 99 }, job, Buffer.from("xlsb"));
  await harness.context.commit({}, {});
  assert.equal(harness.calls.errors[0].status, 409);
  assert.match(harness.calls.errors[0].message, /другой ревизии/iu);
  assert.equal(harness.calls.acquired.length, 0);

  const bytes = Buffer.from("committed-xlsb");
  job = {
    id: "expired-token",
    pendingCommit: null,
    committedSource: {
      databasePath: "db.xlsb",
      source: "local",
      outputHash: hash(bytes),
      preparedWebRevision: 31
    },
    result: { committed: true, preparedWebRevision: 31, syncCommitToken: "expired-token" }
  };
  harness = createCommitContext({ id: job.id, sharedStateRevision: 31 }, job, bytes);
  await harness.context.commit({}, {});
  assert.deepEqual(harness.calls.acquired, [{ jobId: job.id, revision: 31 }]);
  assert.deepEqual(harness.calls.revisions, [31]);
  assert.equal(harness.calls.reads, 1);
  assert.equal(job.result.syncCommitToken, "replacement-token");
  assert.equal(harness.calls.json[0].status, 200);

  const changedJob = {
    id: "expired-token-source-conflict",
    pendingCommit: null,
    committedSource: {
      databasePath: "db.xlsb",
      source: "local",
      outputHash: hash(bytes),
      preparedWebRevision: 31
    },
    result: { committed: true, preparedWebRevision: 31, syncCommitToken: "expired" }
  };
  harness = createCommitContext(
    { id: changedJob.id, sharedStateRevision: 31 },
    changedJob,
    Buffer.from("changed-elsewhere")
  );
  await harness.context.commit({}, {});
  assert.equal(harness.calls.errors[0].status, 409);
  assert.match(harness.calls.errors[0].message, /XLSB изменён/iu);
  assert.deepEqual(harness.calls.released, ["replacement-token"]);
}

async function testCommittedJobIsIdempotentAfterLostResponse() {
  const sourceBytes = Buffer.from("source-xlsb");
  const outputBytes = Buffer.from("saved-xlsb");
  const job = {
    id: "lost-response-job",
    status: "completed",
    pendingCommit: {
      databasePath: "db.xlsb",
      source: "local",
      sourceBytes,
      outputBytes,
      sourceHash: hash(sourceBytes),
      outputHash: hash(outputBytes),
      preparedWebRevision: 44
    },
    result: {
      syncDirection: "web-to-excel",
      requiresCommit: true,
      committed: false,
      preparedWebRevision: 44
    }
  };
  const harness = createCommitContext(
    { id: job.id, sharedStateRevision: 44 },
    job,
    sourceBytes
  );
  await harness.context.commit({}, {});
  assert.equal(job.result.committed, true);
  assert.equal(harness.calls.saves, 1);
  const firstToken = job.result.syncCommitToken;

  await harness.context.commit({}, {});
  assert.equal(harness.calls.saves, 1, "Повтор commit того же job не должен повторно записывать XLSB");
  assert.equal(harness.calls.json.length, 2);
  assert.equal(harness.calls.json[1].payload.committed, true);
  assert.equal(harness.calls.json[1].payload.syncCommitToken, firstToken);
  assert.equal(harness.calls.reads, 2, "Повторный ответ должен заново сверить hash сохранённого XLSB");
}

async function testExcelVerificationBindsSourceToReservation() {
  const sourceBytes = Buffer.from("verified-excel-source");
  const descriptor = {
    databasePath: "db.xlsb",
    source: "local",
    sourceHash: hash(sourceBytes),
    preparedWebRevision: 45
  };
  const job = {
    id: "excel-source-binding",
    status: "completed",
    pendingSourceVerification: descriptor,
    result: {
      syncDirection: "excel-to-web",
      requiresSourceVerification: true,
      sourceVerified: false,
      preparedWebRevision: 45
    }
  };
  const harness = createCommitContext(
    { id: job.id, sharedStateRevision: 45 },
    job,
    sourceBytes
  );
  await harness.context.commit({}, {});
  assert.equal(job.result.sourceVerified, true);
  assert.equal(job.result.syncCommitToken, "replacement-token");
  assert.equal(harness.calls.boundSources.length, 1);
  assert.equal(harness.calls.boundSources[0], descriptor);
  assert.equal(harness.calls.reads, 1);
}

function loadSaveResultFunction(overrides) {
  const source = extractBetween(
    serverSource,
    "async function saveStudentDatabaseSyncResult",
    "\nfunction formatImportBytes"
  );
  const context = {
    fs: fsPromises,
    path,
    crypto,
    hashStudentDatabaseBytes: hash,
    resolveLocalStudentDatabaseFile: (value) => value,
    resolveYandexStudentDatabaseFile: () => "/folder/db.xlsb",
    buildStudentDatabaseBackupFileName: () => "safety-backup.xlsb",
    normalizeWebDavPath: (value) => String(value).replace(/\\/gu, "/").replace(/\/{2,}/gu, "/"),
    loadStudentDatabaseBytes: async (databasePath) => fsPromises.readFile(databasePath),
    readYandexStudentDatabaseEntityTag: async () => "",
    ensureYandexDiskFolder: async () => {},
    requestYandexWebDav: async () => ({ statusCode: 204 }),
    ...(overrides || {})
  };
  vm.createContext(context);
  vm.runInContext(source + "\nthis.saveResult = saveStudentDatabaseSyncResult;", context);
  return context;
}

async function testLocalAtomicSaveAndSourceCas() {
  const temporaryRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ais-sync-safety-"));
  const targetPath = path.join(temporaryRoot, "database.xlsb");
  const sourceBytes = Buffer.from("source workbook");
  const outputBytes = Buffer.from("updated workbook");
  await fsPromises.writeFile(targetPath, sourceBytes);
  const events = [];
  const instrumentedFs = {
    mkdir: (...args) => fsPromises.mkdir(...args),
    writeFile: (...args) => fsPromises.writeFile(...args),
    readFile: async (...args) => {
      events.push("read:" + args[0]);
      return fsPromises.readFile(...args);
    },
    rename: async (...args) => {
      events.push("rename");
      return fsPromises.rename(...args);
    },
    rm: (...args) => fsPromises.rm(...args),
    open: async (...args) => {
      events.push("open-temp");
      const handle = await fsPromises.open(...args);
      return {
        writeFile: async (...writeArgs) => {
          events.push("write-temp");
          return handle.writeFile(...writeArgs);
        },
        sync: async () => {
          events.push("fsync-temp");
          return handle.sync();
        },
        close: () => handle.close()
      };
    }
  };
  try {
    const context = loadSaveResultFunction({ fs: instrumentedFs });
    const result = await context.saveResult(
      targetPath,
      "local",
      sourceBytes,
      outputBytes,
      () => {},
      hash(sourceBytes)
    );
    assert.deepEqual(await fsPromises.readFile(targetPath), outputBytes);
    assert.deepEqual(await fsPromises.readFile(result.backupPath), sourceBytes);
    const openIndex = events.indexOf("open-temp");
    const syncIndex = events.indexOf("fsync-temp");
    const renameIndex = events.indexOf("rename");
    assert.ok(openIndex >= 0 && syncIndex > openIndex && renameIndex > syncIndex);
    assert.ok(
      events.slice(renameIndex + 1).includes("read:" + targetPath),
      "После rename должен проверяться hash записанного файла"
    );
    assert.equal(
      (await fsPromises.readdir(temporaryRoot)).some((name) => name.endsWith(".tmp")),
      false
    );

    const conflictRoot = path.join(temporaryRoot, "conflict");
    const conflictTarget = path.join(conflictRoot, "database.xlsb");
    await fsPromises.mkdir(conflictRoot);
    await fsPromises.writeFile(conflictTarget, sourceBytes);
    let renamed = false;
    const conflictFs = {
      ...instrumentedFs,
      rename: async () => {
        renamed = true;
      },
      open: async (...args) => {
        const handle = await fsPromises.open(...args);
        return {
          writeFile: (...writeArgs) => handle.writeFile(...writeArgs),
          sync: async () => {
            await handle.sync();
            await fsPromises.writeFile(conflictTarget, Buffer.from("concurrent change"));
          },
          close: () => handle.close()
        };
      }
    };
    const conflictContext = loadSaveResultFunction({ fs: conflictFs });
    await assert.rejects(
      () => conflictContext.saveResult(
        conflictTarget,
        "local",
        sourceBytes,
        outputBytes,
        () => {},
        hash(sourceBytes)
      ),
      statusError(409, /изменён непосредственно перед заменой/iu)
    );
    assert.equal(renamed, false);
    assert.deepEqual(await fsPromises.readFile(conflictTarget), Buffer.from("concurrent change"));
    assert.equal(
      (await fsPromises.readdir(conflictRoot)).some((name) => name.endsWith(".tmp")),
      false
    );
  } finally {
    await fsPromises.rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function testWebDavConditionalSaveAndVerification() {
  const sourceBytes = Buffer.from("source workbook");
  const outputBytes = Buffer.from("updated workbook");
  const requests = [];
  let readIndex = 0;
  let context = loadSaveResultFunction({
    readYandexStudentDatabaseEntityTag: async () => "\"etag-42\"",
    loadStudentDatabaseBytes: async () => {
      readIndex += 1;
      return readIndex === 1 ? sourceBytes : outputBytes;
    },
    requestYandexWebDav: async (method, target, options) => {
      requests.push({ method, target, options });
      return { statusCode: 204 };
    }
  });
  await context.saveResult(
    "remote.xlsb",
    "webdav",
    sourceBytes,
    outputBytes,
    () => {},
    hash(sourceBytes)
  );
  const targetPut = requests.find((request) => request.target === "/folder/db.xlsb");
  const backupPut = requests.find((request) => request.target.endsWith("/safety-backup.xlsb"));
  assert.equal(targetPut.options.headers["If-Match"], "\"etag-42\"");
  assert.equal(backupPut.options.headers["If-None-Match"], "*");
  assert.equal(readIndex, 2);

  context = loadSaveResultFunction({
    readYandexStudentDatabaseEntityTag: async () => "\"etag-42\"",
    loadStudentDatabaseBytes: async () => sourceBytes,
    requestYandexWebDav: async (_method, target) => {
      if (target === "/folder/db.xlsb") {
        const error = new Error("Precondition Failed");
        error.statusCode = 412;
        throw error;
      }
      return { statusCode: 204 };
    }
  });
  await assert.rejects(
    () => context.saveResult(
      "remote.xlsb",
      "webdav",
      sourceBytes,
      outputBytes,
      () => {},
      hash(sourceBytes)
    ),
    statusError(409, /изменён другим пользователем/iu)
  );

  readIndex = 0;
  context = loadSaveResultFunction({
    readYandexStudentDatabaseEntityTag: async () => "\"etag-42\"",
    loadStudentDatabaseBytes: async () => {
      readIndex += 1;
      return readIndex === 1 ? sourceBytes : Buffer.from("corrupt upload");
    }
  });
  await assert.rejects(
    () => context.saveResult(
      "remote.xlsb",
      "webdav",
      sourceBytes,
      outputBytes,
      () => {},
      hash(sourceBytes)
    ),
    /Контрольная проверка XLSB на Яндекс-Диске не пройдена/iu
  );
}

function testClientGenerationGuardAndSourceProtocols() {
  const exportSource = extractBetween(
    clientSource,
    "  async function exportStudentsToDatabase(event)",
    "\n  async function downloadStudentsDatabase(event)"
  );
  const flushIndex = exportSource.indexOf("await flushSharedApplicationState()");
  const captureIndex = exportSource.indexOf(
    "const syncPreparedGeneration = sharedStateChangeGeneration"
  );
  const prepareIndex = exportSource.indexOf("await runStudentDatabaseExport(");
  const guardIndex = exportSource.indexOf(
    "sharedStateChangeGeneration !== syncPreparedGeneration"
  );
  const commitIndex = exportSource.indexOf("await commitStudentDatabaseExport(");
  assert.ok(flushIndex >= 0 && captureIndex > flushIndex);
  assert.ok(prepareIndex > captureIndex && guardIndex > prepareIndex);
  assert.ok(commitIndex > guardIndex, "Generation guard должен выполняться до commit");
  assert.match(exportSource, /Web-данные были изменены во время подготовки синхронизации/iu);

  const commitSource = extractBetween(
    serverSource,
    "async function handleStudentDatabaseExportCommit(req, res)",
    "\nfunction getStudentExportJob"
  );
  assert.match(commitSource, /requestedWebRevision\s*!==\s*preparedWebRevision/u);
  assert.doesNotMatch(
    extractBetween(commitSource, "const preparedWebRevision", "const requestedWebRevision"),
    /body\.sharedStateRevision/u
  );
  const existingTokenBranch = extractBetween(
    commitSource,
    "const existingReservation",
    "if (\n      job.result?.syncDirection === \"excel-to-web\""
  );
  const revisionCheck = existingTokenBranch.indexOf("assertSharedApplicationStateRevision");
  const sourceCheck = existingTokenBranch.indexOf("assertPreparedSourceUnchanged");
  const ttlExtension = existingTokenBranch.indexOf("expiresAt = Date.now()");
  assert.ok(revisionCheck >= 0 && sourceCheck > revisionCheck && ttlExtension > sourceCheck);
  assert.match(
    commitSource,
    /acquireStudentDatabaseSyncReservation\(\s*job\.id,\s*preparedWebRevision,\s*pendingVerification\s*\)/u,
    "Excel→Web reservation должна хранить проверенный source descriptor"
  );

  const sharedSaveSource = extractBetween(
    serverSource,
    "async function saveSharedApplicationState(body, authUser)",
    "\nasync function handleSharedApplicationState"
  );
  assert.match(sharedSaveSource, /assertStudentDatabaseSyncReservationSourceUnchanged/u);
  const mysqlSaveSource = extractBetween(
    serverSource,
    "async function saveSharedApplicationStateMySqlOperation",
    "\nasync function queueSharedApplicationStateOfflineOperation"
  );
  const sourceBoundaryCheck = mysqlSaveSource.indexOf("await options.beforeTransaction()");
  const transactionStart = mysqlSaveSource.indexOf("await connection.beginTransaction()");
  assert.ok(
    sourceBoundaryCheck >= 0 && transactionStart > sourceBoundaryCheck,
    "Hash XLSB должен повторно проверяться непосредственно перед MySQL transaction"
  );

  const saveSource = extractBetween(
    serverSource,
    "async function saveStudentDatabaseSyncResult",
    "\nfunction formatImportBytes"
  );
  const localOpen = saveSource.indexOf("fs.open(temporaryPath, \"wx\")");
  const localFsync = saveSource.indexOf("handle.sync()", localOpen);
  const localRename = saveSource.indexOf("fs.rename(temporaryPath, targetPath)", localFsync);
  const localPostRead = saveSource.indexOf(
    "const savedBytes = await fs.readFile(targetPath)",
    localRename
  );
  const localPostHash = saveSource.indexOf("hashStudentDatabaseBytes(savedBytes)", localPostRead);
  assert.ok(localOpen >= 0 && localFsync > localOpen && localRename > localFsync);
  assert.ok(localPostRead > localRename && localPostHash > localPostRead);
  assert.doesNotMatch(saveSource, /fs\.writeFile\(targetPath,\s*outputBytes/u);
  assert.match(saveSource, /"If-Match": expectedWebDavEntityTag/u);
  assert.match(saveSource, /Number\(error\?\.statusCode\) === 412/u);
  assert.match(saveSource, /Контрольная проверка XLSB на Яндекс-Диске не пройдена/iu);
}

async function main() {
  testCompleteBaselineAndInitialMigrationSafety();
  testCriticalDataDirectionAndLegacyMigration();
  testReservationRevisionAndTtl();
  await testAuthoritativeRevisionAssertions();
  await testStrictReservationTokenAndBaseRevision();
  await testPreparedRevisionAndExpiredTokenRecheck();
  await testCommittedJobIsIdempotentAfterLostResponse();
  await testExcelVerificationBindsSourceToReservation();
  await testLocalAtomicSaveAndSourceCas();
  await testWebDavConditionalSaveAndVerification();
  testClientGenerationGuardAndSourceProtocols();
  console.log("Student database synchronization safety tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

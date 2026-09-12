const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appServerSource = fs.readFileSync(path.join(root, "app-server.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const gatewaySource = fs.readFileSync(path.join(root, "gateway.php"), "utf8");
const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
const authSource = fs.readFileSync(path.join(root, "auth-bootstrap.js"), "utf8");

const {
  sharedApplicationStateMirrorNeedsReload,
  sharedApplicationStateCacheMatchesBackend,
  buildSharedApplicationStateMirrorSnapshot
} = require(path.join(root, "app-server.js"));

const cached = {
  schemaVersion: 2,
  revision: 10,
  updatedAt: "2026-08-28T10:00:00.000Z",
  updatedBy: "admin",
  data: { collections: {}, dictionaries: {}, meta: {} }
};

assert.equal(
  sharedApplicationStateMirrorNeedsReload(cached, {
    exists: true,
    revision: 10,
    versionTag: "another-tag-for-the-same-revision"
  }),
  false,
  "Смена технического versionTag не должна перечитывать полную базу."
);
assert.equal(sharedApplicationStateMirrorNeedsReload(cached, { exists: true, revision: 11 }), true);
assert.equal(sharedApplicationStateMirrorNeedsReload(null, { exists: true, revision: 10 }), true);
assert.equal(sharedApplicationStateCacheMatchesBackend({ backendId: "" }), true);
assert.equal(sharedApplicationStateCacheMatchesBackend({ backendId: "not-the-current-backend" }), false);
assert.equal(
  sharedApplicationStateMirrorNeedsReload(
    { ...cached, backendId: "mysql-a" },
    { exists: true, revision: 10, backendId: "mysql-b" }
  ),
  true,
  "Снимок другого MySQL-подключения нельзя использовать при совпавшей ревизии."
);

const online = buildSharedApplicationStateMirrorSnapshot(
  cached,
  { operations: [] },
  { exists: true, revision: 10, source: "mysql", writable: true },
  { metadata: false }
);
assert.equal(online.revision, 10);
assert.equal(online.versionTag, "mysql-10");
assert.equal(online.source, "mysql");
assert.equal(online.offline, false);
assert.equal(online.document, cached);

const backendMetadata = buildSharedApplicationStateMirrorSnapshot(
  { ...cached, backendId: "mysql-a" },
  { operations: [] },
  { exists: true, revision: 10, backendId: "mysql-a", source: "mysql", writable: true },
  { metadata: true }
);
assert.equal(backendMetadata.backendId, "mysql-a");
assert.equal(
  buildSharedApplicationStateMirrorSnapshot(
    null,
    { operations: [] },
    { exists: false, revision: 0, backendId: "mysql-empty" },
    { metadata: true }
  ).backendId,
  "mysql-empty"
);

const pending = buildSharedApplicationStateMirrorSnapshot(
  cached,
  { operations: [{ id: "pending-1" }] },
  { exists: true, revision: 10, source: "mysql", writable: true },
  { metadata: true, forceOffline: true, warning: "MySQL недоступен" }
);
assert.equal(pending.revision, 10);
assert.equal(pending.versionTag, "offline-10-1");
assert.equal(pending.source, "local-queue");
assert.equal(pending.offline, true);
assert.equal(pending.pendingCount, 1);

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Не найден блок ${startMarker}`);
  return source.slice(start, end);
}

const mirrorSource = sourceBetween(
  appServerSource,
  "function refreshSharedApplicationStateMirror()",
  "function startSharedApplicationStateMirror()"
);
assert.match(mirrorSource, /if \(sharedStateMirrorRefreshPromise\) return sharedStateMirrorRefreshPromise/u);
assert.equal(
  (mirrorSource.match(/flushSharedApplicationStateOfflineQueue\(/gu) || []).length,
  1,
  "Один тик зеркала должен проверять автономную очередь только один раз."
);
assert.match(mirrorSource, /sharedApplicationStateMirrorNeedsReload\(cached, metadata\)/u);
assert.match(mirrorSource, /sharedStateMirrorDocument\s*\|\|/u);
assert.match(mirrorSource, /confirmedEmpty/u);
assert.match(mirrorSource, /fallbackCanAdvancePending/u);
const mirrorReadSource = sourceBetween(
  appServerSource,
  "async function readSharedApplicationStateMirrorSnapshot",
  "function sharedRecordLockFromMySqlRow"
);
assert.match(
  mirrorReadSource,
  /expectedRevision\s*&&[\s\S]{0,160}await refreshSharedApplicationStateMirror\(\)/u
);
assert.match(mirrorReadSource, /if \(!sharedStateMirrorInitialized\) await refreshSharedApplicationStateMirror\(\)/u);

const mysqlReadSource = sourceBetween(
  appServerSource,
  "async function readSharedApplicationStateMySqlDocument",
  "function buildSharedApplicationStateMySqlEntries"
);
assert.match(mysqlReadSource, /const maximumAttempts = connection \? 1 : 4/u);
assert.match(mysqlReadSource, /revisionAfter !== revisionBefore/u);
assert.match(appServerSource, /function sharedApplicationStateMySqlBackendId\(\)/u);
assert.match(appServerSource, /backendId: sharedApplicationStateMySqlBackendId\(\)/u);
assert.match(appServerSource, /pending\.backendId = activeBackendId/u);
assert.match(appServerSource, /pendingBackendId !== activeBackendId/u);
assert.ok(
  (mysqlReadSource.match(/FROM ais_shared_state_meta/gu) || []).length >= 2,
  "Полный снимок MySQL должен повторно проверять ревизию после чтения строк."
);

const sharedStateGetSource = sourceBetween(
  appServerSource,
  "async function handleSharedApplicationState",
  "async function handleEnsureStudentDocumentFolders"
);
assert.match(sharedStateGetSource, /readSharedApplicationStateMirrorSnapshot\(\{ metadata: true \}\)/u);
assert.match(sharedStateGetSource, /expectedRevision: requestUrl\.searchParams\.get\("revision"\)/u);
assert.match(sharedStateGetSource, /backendId: String\(result\.document\?\.backendId \|\| result\.backendId \|\| ""\)/u);
assert.match(sharedStateGetSource, /await rememberSharedApplicationStateMirrorSave\(result, operation\)/u);
const getBranchEnd = sharedStateGetSource.indexOf('if (req.method === "POST")');
const getBranch = sharedStateGetSource.slice(0, getBranchEnd);
assert.doesNotMatch(getBranch, /readSharedApplicationStateDocument\(/u);
assert.doesNotMatch(getBranch, /readSharedApplicationStateMetadata\(/u);

const pollSource = sourceBetween(
  appSource,
  "async function pollSharedApplicationState()",
  "function recordLockKey"
);
assert.match(pollSource, /const hasChanged = nextRevision !== sharedStateRevision/u);
assert.match(pollSource, /nextBackendId !== sharedStateBackendId/u);
assert.doesNotMatch(pollSource, /nextVersionTag\s*!==\s*sharedStateVersionTag/u);
assert.match(pollSource, /expectedRevision: nextRevision/u);
const reloadSource = sourceBetween(
  appSource,
  "async function reloadSharedApplicationState",
  "async function pollSharedApplicationState"
);
assert.match(reloadSource, /snapshot=1&revision=/u);

const gatewayRefreshSource = sourceBetween(
  gatewaySource,
  "function gateway_shared_state_snapshot_refresh",
  "function gateway_shared_state_upsert_entry"
);
const gatewayCacheCheck = gatewayRefreshSource.indexOf("gateway_shared_state_snapshot_read_meta()");
const gatewayFullRead = gatewayRefreshSource.indexOf("gateway_shared_state_read_data($pdo)");
assert.ok(gatewayCacheCheck >= 0 && gatewayFullRead > gatewayCacheCheck);
assert.match(gatewayRefreshSource, /if \(!\$includeData\)/u);
assert.match(gatewayRefreshSource, /\$revisionAfter\s*!==\s*\$revisionBefore/u);
assert.match(gatewayRefreshSource, /for \(\$attempt = 0; \$attempt < 4;/u);
const gatewayLockSource = sourceBetween(
  gatewaySource,
  "function gateway_shared_state_snapshot_with_lock",
  "function gateway_shared_state_snapshot_write_json"
);
assert.match(gatewayLockSource, /flock\(\$lock, LOCK_EX\)/u);
assert.match(gatewaySource, /function gateway_shared_state_snapshot_backend_id\(\)/u);
assert.match(gatewaySource, /'backendId' => gateway_shared_state_snapshot_backend_id\(\)/u);
const gatewayPublicMetaSource = sourceBetween(
  gatewaySource,
  "function gateway_shared_state_public_meta",
  "function gateway_shared_state_snapshot_backend_id"
);
assert.match(gatewayPublicMetaSource, /'backendId' => gateway_shared_state_snapshot_backend_id\(\)/u);

const gatewayStoreSource = sourceBetween(
  gatewaySource,
  "function gateway_shared_state_snapshot_store",
  "function gateway_shared_state_snapshot_invalidate"
);
assert.match(gatewayStoreSource, /if \(\$currentRevision > \$revision\)/u);
const gatewayInvalidateSource = sourceBetween(
  gatewaySource,
  "function gateway_shared_state_snapshot_invalidate",
  "function gateway_shared_state_snapshot_cached"
);
assert.match(gatewayInvalidateSource, /if \(\$currentRevision >= \$revision\)/u);
assert.match(gatewayInvalidateSource, /'meta' => \$markerMeta/u);

const gatewayGetSource = sourceBetween(
  gatewaySource,
  "if ($method === 'GET')",
  "if ($method !== 'POST')"
);
assert.match(gatewayGetSource, /gateway_shared_state_snapshot_cached\(\$expectedRevision\)/u);
assert.match(gatewayGetSource, /gateway_shared_state_snapshot_refresh\(\$pdo, !\$metadataOnly\)/u);
assert.doesNotMatch(gatewayGetSource, /gateway_shared_state_read_data\(\$pdo\)/u);
assert.ok(
  (gatewaySource.match(/gateway_shared_state_snapshot_store\(\$savedMeta, \$savedData\)/gu) || []).length >= 2,
  "POST и операции корзины должны сохранять канонически перечитанные данные транзакции."
);
const gatewayPostSource = sourceBetween(
  gatewaySource,
  "function gateway_handle_shared_state",
  "function gateway_trash_error"
);
assert.match(
  gatewayPostSource,
  /\$savedData = gateway_shared_state_read_data\(\$pdo\);[\s\S]{0,120}\$pdo->commit\(\);/u
);
const gatewayTrashSource = sourceBetween(
  gatewaySource,
  "function gateway_handle_trash_route",
  "function gateway_record_lock_identifier"
);
assert.match(
  gatewayTrashSource,
  /\$savedData = gateway_shared_state_read_data\(\$pdo\);[\s\S]{0,80}\$pdo->commit\(\);/u
);
assert.match(
  gatewaySource,
  /\$savedMeta = gateway_shared_state_meta\(\$pdo\);[\s\S]{0,700}\$pdo->commit\(\);/u
);
assert.match(
  gatewaySource,
  /gateway_shared_state_snapshot_invalidate\(\$nextRevision, false, \$savedMeta\)/u
);

const clientInitializeSource = sourceBetween(
  appSource,
  "async function initializeSharedApplicationState()",
  "function scheduleSharedApplicationStateSave"
);
assert.equal(
  (clientInitializeSource.match(/requestSharedApplicationState\(/gu) || []).length,
  1,
  "Первое открытие существующей базы должно выполнять один полный запрос снимка."
);
const serverStartupSource = sourceBetween(
  appServerSource,
  ".then(() => ensureStorage())",
  "server.listen(PORT, HOST"
);
assert.ok(
  serverStartupSource.indexOf("startSharedApplicationStateMirror();")
    < serverStartupSource.indexOf("http.createServer"),
  "Загрузка серверного снимка должна запускаться до открытия HTTP-сервера."
);

const authBuild = /const AUTH_BUILD = "([^"]+)"/u.exec(authSource)?.[1] || "";
assert.ok(authBuild);
assert.match(indexSource, new RegExp(`(?:styles\\.css|auth-bootstrap\\.js)\\?v=${authBuild}`, "u"));

console.log("Shared state startup snapshot tests passed.");

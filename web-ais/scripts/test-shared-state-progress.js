const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
const authBootstrapSource = fs.readFileSync(path.join(root, "auth-bootstrap.js"), "utf8");

assert.match(appSource, /let sharedStateTransferProgress = \{/u);
assert.match(appSource, /function beginSharedStateTransferProgress/u);
assert.match(appSource, /function finishSharedStateTransferProgress/u);
assert.match(appSource, /function failSharedStateTransferProgress/u);
assert.match(appSource, /function readSharedApplicationStateResponse/u);
assert.match(appSource, /response\.body\?\.getReader/u);
assert.match(appSource, /loadedBytes \/ expectedBytes/u);
assert.match(appSource, /Обработка запроса MySQL · \$\{elapsedSeconds\} с/u);
assert.match(appSource, /class="shared-state-progress-value">\$\{percent\}%/u);
assert.match(appSource, /data-shared-state-startup-progress/u);
assert.match(appSource, /operation: "Синхронизация общей MySQL-базы"/u);
assert.match(appSource, /operation: "Обновление общей MySQL-базы"/u);

const pollStart = appSource.indexOf("async function pollSharedApplicationState");
const pollEnd = appSource.indexOf("function recordLockKey", pollStart);
assert.ok(pollStart >= 0 && pollEnd > pollStart);
assert.doesNotMatch(
  appSource.slice(pollStart, pollEnd),
  /metadata=1[\s\S]{0,500}sharedStateProgress/u,
  "Фоновая проверка ревизии не должна показывать индикатор каждую секунду"
);

assert.match(stylesSource, /\.shared-state-pill\.has-progress/u);
assert.match(stylesSource, /\.shared-state-progress-track/u);
assert.match(stylesSource, /@keyframes shared-state-progress-stripes/u);
assert.match(stylesSource, /\.shared-state-startup-progress/u);
const authBuild = /const AUTH_BUILD = "([^"]+)"/u.exec(authBootstrapSource)?.[1] || "";
assert.ok(authBuild, "Не найден идентификатор сборки загрузчика");
assert.match(indexSource, new RegExp(`(?:styles\\.css|auth-bootstrap\\.js)\\?v=${authBuild}`, "u"));

console.log("Shared MySQL state progress tests passed.");

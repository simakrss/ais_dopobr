"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const authSource = fs.readFileSync(path.join(root, "auth-bootstrap.js"), "utf8");
const partnerSource = fs.readFileSync(path.join(root, "partner-app.js"), "utf8");
const phpSource = fs.readFileSync(path.join(root, "auth-lib.php"), "utf8");
const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");

assert.match(authSource, /function redirectToLogin\(\)/u);
assert.match(authSource, /searchParams\.set\("signed-out"/u);
assert.match(authSource, /searchParams\.has\("switch-account"\)/u);
assert.match(authSource, /nativeFetch\(appUrl\("api\/auth\/logout"\)/u);
assert.match(authSource, /Object\.freeze\(\{ request, appUrl, redirectToLogin, renderStartupFailure \}\)/u);
assert.match(authSource, /function renderStartupFailure\(error\)/u);
assert.match(authSource, /initialize\(\)\.catch\(renderStartupFailure\)/u);
assert.match(appSource, /initializeApplication\(\)\.catch/u);
assert.match(indexSource, /data-startup-fallback/u);
assert.match(indexSource, /data-startup-message/u);
assert.match(appSource, /AIS_AUTH_API\?\.redirectToLogin/u);
assert.match(partnerSource, /authApi\.redirectToLogin/u);
assert.match(appSource, /Выйти без сохранения изменений/u);
assert.match(appSource, /clearAdminSettingsDirtyState\(form\)/u);
assert.match(phpSource, /\$cookiePaths = array_values\(array_unique/u);
assert.match(phpSource, /rtrim\(\$basePath, '\/'\)/u);

console.log("authentication logout checks: OK");

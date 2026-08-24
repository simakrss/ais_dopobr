"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const partnerSource = fs.readFileSync(path.join(root, "partner-app.js"), "utf8");

assert.match(appSource, /function captureAisNavigationSnapshot\(\)[\s\S]*?statusFilter:[\s\S]*?tablePage:[\s\S]*?financeDetails:[\s\S]*?modal/u);
assert.match(appSource, /function synchronizeAisBrowserHistory\(\)[\s\S]*?replace: nextKey === currentKey/u);
assert.match(appSource, /function bindStudentStatusHistoryNavigation\(\)[\s\S]*?replace: true, root: true[\s\S]*?writeAisHistoryState\(initialSnapshot\)[\s\S]*?popstate/u);
assert.match(appSource, /if \(!canAccessView\(state\.view\)\) state\.view = "dashboard";\s*synchronizeAisBrowserHistory\(\);/u);
assert.match(appSource, /function closeModalWithUnsavedCheck\(\)[\s\S]*?aisHistoryNavigationCloseModalRequested = true;[\s\S]*?returnToPreviousAisScreen\(\)/u);
assert.match(appSource, /async function saveRecord\(event\)[\s\S]*?aisHistoryNavigationCloseModalRequested = true;[\s\S]*?returnToPreviousAisScreen\(\)/u);
assert.match(appSource, /Есть несохраненные изменения\. Перейти к предыдущему экрану без сохранения\?/u);
assert.doesNotMatch(appSource, /aisStudentStatusNavigation:/u);

assert.match(partnerSource, /function bindPartnerHistoryGuard\(\)[\s\S]*?aisPartnerNavigationRoot: true[\s\S]*?aisPartnerNavigationGuard: true/u);
assert.match(partnerSource, /window\.addEventListener\("popstate",[\s\S]*?aisPartnerNavigationRoot/u);
assert.match(partnerSource, /render\(\);\s*bindPartnerHistoryGuard\(\);/u);

console.log("browser history navigation checks: OK");

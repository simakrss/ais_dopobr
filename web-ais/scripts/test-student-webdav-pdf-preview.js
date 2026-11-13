"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const htaccessSource = fs.readFileSync(path.join(root, ".htaccess"), "utf8");

const managerStart = appSource.indexOf("  async function openStudentWebDavDocumentsManager");
const managerEnd = appSource.indexOf("  function getProgramOperationalDocumentOpenUrl", managerStart);
assert.ok(managerStart >= 0 && managerEnd > managerStart, "Не найден менеджер документов WebDAV");
const managerSource = appSource.slice(managerStart, managerEnd);

assert.match(managerSource, /await fetch\(fileUrl, \{ signal: pdfFetchController.signal \}\)/u);
assert.match(managerSource, /window\.AisPdfPreview\.mount\(previewPdf, pdfBlob,/u);
assert.match(managerSource, /externalControls: true/u);
assert.match(managerSource, /onRender: \(\) => \{[\s\S]*?previewPdf.dataset.previewReady = "true";[\s\S]*?markMediaLoaded\(\)/u);
assert.match(managerSource, /activePdfViewer\?\.setView\(\{ zoom: previewScale, rotation: previewRotation \}\)/u);
assert.match(managerSource, /pdfFetchController\?\.abort\(\)/u);
assert.match(managerSource, /activePdfViewer\?\.destroy\(\)/u);
assert.match(managerSource, /const close = \(\) => \{[\s\S]*releasePdfPreview\(\);[\s\S]*backdrop\.remove\(\);/u);
assert.match(managerSource, /previewRequestToken \+= 1;\s*releasePdfPreview\(\);\s*renderPath\(\);/u);
assert.doesNotMatch(managerSource, /<iframe|#\$\{fragment\}|toolbar=1/u);
assert.match(htaccessSource, /Header always set X-Frame-Options "DENY"/u);

console.log("student WebDAV PDF preview checks: OK");

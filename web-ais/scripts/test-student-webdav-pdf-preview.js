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

assert.match(managerSource, /const response = await fetch\(fileUrl\);/u);
assert.match(managerSource, /URL\.createObjectURL\(new Blob\(\[pdfBlob\], \{ type: "application\/pdf" \}\)\)/u);
assert.match(managerSource, /const nextSource = `\$\{previewPdfObjectUrl\}#\$\{fragment\}`;/u);
assert.match(managerSource, /URL\.revokeObjectURL\(activePreviewObjectUrl\);/u);
assert.match(managerSource, /const close = \(\) => \{[\s\S]*releaseActivePreviewObjectUrl\(\);[\s\S]*backdrop\.remove\(\);/u);
assert.match(managerSource, /previewRequestToken \+= 1;\s*releaseActivePreviewObjectUrl\(\);\s*renderPath\(\);/u);
assert.doesNotMatch(managerSource, /iframe[^>]+src="\$\{escapeAttr\(pdfSource\)\}"/u);
assert.doesNotMatch(managerSource, /const nextSource = `\$\{fileUrl\}#\$\{fragment\}`;/u);
assert.match(htaccessSource, /Header always set X-Frame-Options "DENY"/u);

console.log("student WebDAV PDF preview checks: OK");

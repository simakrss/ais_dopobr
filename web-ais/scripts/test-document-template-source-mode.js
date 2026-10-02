const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.resolve(__dirname, "..", "app.js");
const serverPath = path.resolve(__dirname, "..", "app-server.js");
const localServerPath = path.resolve(__dirname, "..", "local-server.js");
const appSource = fs.readFileSync(appPath, "utf8");
const serverSource = fs.readFileSync(serverPath, "utf8");
const localServerSource = fs.readFileSync(localServerPath, "utf8");

function extractBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Не найден блок ${startMarker}`);
  return source.slice(start, end);
}

const openSource = extractBetween(
  appSource,
  "  async function openActiveDocumentTemplateSource",
  "  function updateActiveDocumentTemplateSource"
);
assert.match(openSource, /getStudentDocumentsSource\(Boolean\(event\?\.shiftKey\)\)/u);
assert.match(openSource, /source !== "local"/u);
assert.match(openSource, /probeLocalDocumentServices\(\)/u);
assert.match(openSource, /capabilities\.appServerAvailable/u);
assert.match(openSource, /template-reveal-local/u);
assert.match(openSource, /if \(cloudUrl\)[\s\S]*openExternalUrl\(cloudUrl\)/u);
assert.doesNotMatch(openSource, /event\?\.shiftKey && getEffectiveLocalDocumentsMode/u);

const tooltipSource = extractBetween(
  appSource,
  "  function getDocumentTemplateSourceOpenTooltip",
  "  function getDocumentTemplateRows"
);
assert.match(tooltipSource, /Обычный щелчок: показать локальный файл/u);
assert.match(tooltipSource, /Shift \+ щелчок: открыть шаблон в облаке/u);
assert.match(tooltipSource, /Локальная папка системы недоступна/u);
assert.match(appSource, /escapeMultilineAttr\(getDocumentTemplateSourceOpenTooltip\(\)\)/u);

const serverHandlerSource = extractBetween(
  serverSource,
  "async function handleRevealLocalDocumentTemplate",
  "function showLocalDocumentSaveDialog"
);
assert.match(serverHandlerSource, /resolveLocalDocumentTemplateFile/u);
assert.doesNotMatch(serverHandlerSource, /serverSettings\.openDocumentsLocally/u);
assert.match(localServerSource, /pathname === "\/api\/documents\/template-reveal-local"/u);

console.log("Document template source mode tests passed.");

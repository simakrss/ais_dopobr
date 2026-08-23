const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const serverPath = path.resolve(__dirname, "..", "app-server.js");
const syncScriptPath = path.resolve(__dirname, "sync-student-database.ps1");
const serverSource = fs.readFileSync(serverPath, "utf8");
const syncScriptSource = fs.readFileSync(syncScriptPath, "utf8");
const { sanitizePowerShellErrorOutput } = require(serverPath);

const cliXml = `#< CLIXML
<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">
  <S S="Error">Ошибка обновления листа &apos;Реестр программ&apos;: поле &lt;СообщПочты&gt;._x000D__x000A_Строка 40.</S>
</Objs>`;

assert.equal(
  sanitizePowerShellErrorOutput(cliXml),
  "Ошибка обновления листа 'Реестр программ': поле <СообщПочты>.\r\nСтрока 40."
);
assert.equal(
  sanitizePowerShellErrorOutput("Обычная ошибка Excel."),
  "Обычная ошибка Excel."
);
assert.match(serverSource, /\$ProgressPreference = 'SilentlyContinue'/u);
assert.match(serverSource, /STUDENT_DATABASE_SYNC_IDLE_TIMEOUT_MS = 20 \* 60 \* 1000/u);
assert.match(serverSource, /STUDENT_DATABASE_SYNC_MAX_TIMEOUT_MS = 60 \* 60 \* 1000/u);
assert.match(serverSource, /AIS_SYNC_EXCEL_PID_PATH/u);
assert.match(syncScriptSource, /\$excel\.Calculation = -4135/u);
assert.match(syncScriptSource, /AIS_SYNC_EXCEL_PID_PATH/u);

console.log("Student database Excel runner checks passed.");

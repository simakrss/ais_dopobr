const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const serverPath = path.resolve(__dirname, "..", "app-server.js");
const clientPath = path.resolve(__dirname, "..", "app.js");
const syncScriptPath = path.resolve(__dirname, "sync-student-database.ps1");
const serverSource = fs.readFileSync(serverPath, "utf8");
const clientSource = fs.readFileSync(clientPath, "utf8");
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
assert.match(serverSource, /STUDENT_EXPORT_JOB_TTL_MS = 2 \* 60 \* 60 \* 1000/u);
assert.match(
  serverSource,
  /function cleanupStudentExportJobs\(\) \{[\s\S]*?STUDENT_EXPORT_JOB_TTL_MS[\s\S]*?job\.status !== "running"/u
);
assert.match(serverSource, /AIS_SYNC_EXCEL_PID_PATH/u);
assert.match(clientSource, /function isMissingStudentDatabaseExportJobError\(error\)/u);
assert.match(clientSource, /const maxAttempts = 2;[\s\S]*?runStudentDatabaseExportAttempt\(body\)/u);
assert.match(clientSource, /Сервер был перезапущен\. Подготовка/u);
assert.match(syncScriptSource, /\$excel\.Calculation = -4135/u);
assert.match(syncScriptSource, /AIS_SYNC_EXCEL_PID_PATH/u);

const workbooksRetryFunctionStart = syncScriptSource.indexOf(
  "function Get-ExcelWorkbooksWithRetry"
);
const workbooksRetryFunctionEnd = syncScriptSource.indexOf(
  "\nfunction Get-ExcelWorksheetWithRetry",
  workbooksRetryFunctionStart
);
assert.ok(
  workbooksRetryFunctionStart >= 0 && workbooksRetryFunctionEnd > workbooksRetryFunctionStart,
  "PowerShell должен ожидать готовности коллекции Excel.Workbooks."
);
const workbooksRetryFunction = syncScriptSource.slice(
  workbooksRetryFunctionStart,
  workbooksRetryFunctionEnd
);
assert.match(workbooksRetryFunction, /\$null -eq \$Excel/u);
assert.match(workbooksRetryFunction, /\$workbooks = \$Excel\.Workbooks/u);
assert.match(workbooksRetryFunction, /\$null -eq \$workbooks/u);
assert.match(workbooksRetryFunction, /\[int\]\$workbooks\.Count/u);
assert.match(workbooksRetryFunction, /return \[pscustomobject\]@\{ Value = \$workbooks \}/u);
assert.doesNotMatch(workbooksRetryFunction, /Write-Output -NoEnumerate|return \$workbooks/u);
assert.match(workbooksRetryFunction, /Release-ComObject \$workbooks/u);
assert.match(workbooksRetryFunction, /Start-Sleep -Milliseconds \$retryDelay/u);
assert.doesNotMatch(workbooksRetryFunction, /\.Open\(/u);

const worksheetRetryFunctionStart = syncScriptSource.indexOf(
  "function Get-ExcelWorksheetWithRetry"
);
const worksheetRetryFunctionEnd = syncScriptSource.indexOf(
  "\nfunction Update-TargetedStudentFieldPatches",
  worksheetRetryFunctionStart
);
assert.ok(
  worksheetRetryFunctionStart >= 0 && worksheetRetryFunctionEnd > worksheetRetryFunctionStart,
  "PowerShell должен ожидать готовности COM-листа после Workbooks.Open."
);
const worksheetRetryFunction = syncScriptSource.slice(
  worksheetRetryFunctionStart,
  worksheetRetryFunctionEnd
);
assert.match(worksheetRetryFunction, /\$null -eq \$Workbook/u);
assert.match(worksheetRetryFunction, /\$null -eq \$worksheets/u);
assert.match(worksheetRetryFunction, /\$null -eq \$worksheet/u);
assert.match(worksheetRetryFunction, /\$worksheet\.UsedRange/u);
assert.match(worksheetRetryFunction, /Start-Sleep -Milliseconds \$retryDelay/u);
assert.match(worksheetRetryFunction, /for \(\$attempt = 1;/u);

const workbookOpenCall = "$workbook = $workbooks.Open($InputPath, 0, $readSyncMetadataOnly)";
const workbookOpenIndex = syncScriptSource.indexOf(workbookOpenCall);
assert.match(syncScriptSource, /\$workbooksHandle = Get-ExcelWorkbooksWithRetry \$excel/u);
assert.match(syncScriptSource, /\$workbooks = \$workbooksHandle\.Value/u);
assert.ok(
  workbookOpenIndex >= 0,
  "Excel workbook должен открываться одним отдельным COM-вызовом."
);
assert.equal(
  syncScriptSource.split(workbookOpenCall).length - 1,
  1,
  "Workbooks.Open нельзя повторять после неоднозначной COM-ошибки."
);
assert.doesNotMatch(syncScriptSource, /\$excel\.Workbooks\.Open\(/u);
assert.match(
  syncScriptSource.slice(workbooksRetryFunctionEnd, workbookOpenIndex + workbookOpenCall.length + 200),
  /Release-ComObject \$workbooks/u
);
const globalReadinessProbeIndex = syncScriptSource.indexOf(
  '$readinessSheet = Get-ExcelWorksheetWithRetry $workbook "База"',
  workbookOpenIndex
);
const readMetadataBranchIndex = syncScriptSource.indexOf(
  "if ($readSyncMetadataOnly)",
  workbookOpenIndex
);
assert.ok(
  globalReadinessProbeIndex > workbookOpenIndex
    && readMetadataBranchIndex > globalReadinessProbeIndex,
  "Read-only worksheet probe должен выполняться сразу после Open во всех режимах."
);
assert.match(
  syncScriptSource.slice(globalReadinessProbeIndex, readMetadataBranchIndex),
  /Release-ComObject \$readinessSheet/u
);

const targetedPatchFunctionStart = syncScriptSource.indexOf(
  "function Update-TargetedStudentFieldPatches"
);
const targetedPatchFunctionEnd = syncScriptSource.indexOf(
  "\nfunction Update-MappedColumn",
  targetedPatchFunctionStart
);
assert.ok(
  targetedPatchFunctionStart >= 0 && targetedPatchFunctionEnd > targetedPatchFunctionStart,
  "В PowerShell должна быть отдельная ограниченная функция точечного обновления слушателя."
);
const targetedPatchFunction = syncScriptSource.slice(
  targetedPatchFunctionStart,
  targetedPatchFunctionEnd
);
assert.match(targetedPatchFunction, /StringComparison\]::Ordinal/u);
assert.match(targetedPatchFunction, /разрешено только поле 'note'/u);
assert.match(targetedPatchFunction, /-not \$targetUids\.Add\(\$uid\)/u);
assert.match(
  targetedPatchFunction,
  /\$matchingRows = @\(\s*if \(\$rowsByUid\.ContainsKey\(\$patch\.Uid\)\)/u
);
assert.match(targetedPatchFunction, /\$matchingRows\.Count -ne 1/u);
assert.match(
  targetedPatchFunction,
  /\$sheet = Get-ExcelWorksheetWithRetry \$Workbook "База"/u
);
assert.doesNotMatch(targetedPatchFunction, /\$Workbook\.Worksheets\.Item\("База"\)/u);

const formulaGuardIndex = targetedPatchFunction.indexOf("$cell.HasFormula");
const expectedValueGuardIndex = targetedPatchFunction.indexOf(
  "$currentValue, $patch.ExpectedValue"
);
const formulaPrefixGuardIndex = targetedPatchFunction.indexOf(
  "$value.TrimStart() -match '^[=+\\-@]'"
);
const writeValueIndex = targetedPatchFunction.indexOf("$cell.Value2 = [string]$patch.Value");
const outputValueGuardIndex = targetedPatchFunction.indexOf(
  "$writtenValue, $patch.Value"
);
assert.ok(formulaGuardIndex >= 0 && expectedValueGuardIndex > formulaGuardIndex);
assert.ok(
  formulaPrefixGuardIndex >= 0 && formulaPrefixGuardIndex < writeValueIndex,
  "PowerShell должен отклонить формулу в note до присваивания Value2."
);
assert.ok(
  writeValueIndex > expectedValueGuardIndex && outputValueGuardIndex > writeValueIndex,
  "PowerShell должен проверить expectedValue до записи и перечитать точное значение после неё."
);

const targetedPatchBranchStart = syncScriptSource.indexOf("if ($targetedStudentFieldPatchOnly)");
const fullStudentUpdateIndex = syncScriptSource.indexOf(
  "$studentResult = Update-StudentSheet",
  targetedPatchBranchStart
);
assert.ok(targetedPatchBranchStart >= 0 && fullStudentUpdateIndex > targetedPatchBranchStart);
const targetedPatchBranch = syncScriptSource.slice(targetedPatchBranchStart, fullStudentUpdateIndex);
assert.match(targetedPatchBranch, /Update-TargetedStudentFieldPatches \$workbook \$payload/u);
assert.match(targetedPatchBranch, /\$workbook\.SaveAs\(\$OutputPath, 50\)/u);
assert.match(targetedPatchBranch, /\$excel\.CalculateBeforeSave = \$false/u);
assert.doesNotMatch(targetedPatchBranch, /\$workbook\.ForceFullCalculation = \$false/u);
assert.match(targetedPatchBranch, /targetedStudentFieldPatchOnly = \$true/u);
assert.match(
  targetedPatchBranch,
  /targetedStudentFieldPatches = \$targetedStudentFieldPatchResult\.Count/u,
  "PowerShell должен вернуть фактическое число точечно записанных примечаний."
);
assert.doesNotMatch(
  targetedPatchBranch,
  /CalculateFullRebuild|Update-StudentSheet|Update-ProgramPromoMessages/u,
  "Точечная ветка не должна запускать длительное массовое обновление книги."
);

assert.match(serverSource, /scriptResult\.targetedStudentFieldPatchOnly !== true/u);
assert.match(serverSource, /!Number\.isInteger\(reportedPatchCount\)/u);
assert.match(
  serverSource,
  /reportedPatchCount !== payload\.targetedStudentFieldPatches\.length/u,
  "Сервер должен требовать точного совпадения заявленного и фактического числа patch."
);
assert.match(
  serverSource,
  /sourceInspection\.formulaFingerprint !== outputInspection\.formulaFingerprint/u,
  "Точечная операция должна сохранять точную карту формул всей книги."
);
assert.match(
  serverSource,
  /sourceInspection\.workbookCellFingerprint !== outputInspection\.workbookCellFingerprint/u,
  "Все ячейки вне целевого note должны совпадать побайтно-нормализованным fingerprint."
);

const buildExportStart = serverSource.indexOf("async function buildStudentDatabaseExport(");
const buildExportEnd = serverSource.indexOf(
  "\nasync function handleStudentDatabaseExport(",
  buildExportStart
);
assert.ok(buildExportStart >= 0 && buildExportEnd > buildExportStart);
const buildExportSource = serverSource.slice(buildExportStart, buildExportEnd);
const targetedSourceGuardIndex = buildExportSource.indexOf(
  "validateTargetedStudentFieldPatchesAgainstSource(payload, sourceDataForExport)"
);
const targetedAuditFallbackIndex = buildExportSource.indexOf(
  "validateTargetedStudentFieldPatchAuditScope(payload, body.syncBaseline"
);
const targetedOutputGuardIndex = buildExportSource.indexOf(
  "validateTargetedStudentFieldPatchesAgainstOutput("
);
assert.ok(
  targetedSourceGuardIndex >= 0
  && targetedAuditFallbackIndex > targetedSourceGuardIndex
  && targetedOutputGuardIndex > targetedAuditFallbackIndex,
  "Audit fallback не должен обходить проверки expectedValue исходного и note сформированного XLSB."
);

assert.match(
  syncScriptSource,
  /\} catch \{\s+\$topLevelErrorMessage = \$_\.Exception\.Message[\s\S]*?\$topLevelScriptStackTrace = \[string\]\$_\.ScriptStackTrace[\s\S]*?throw "\$topLevelErrorMessage`nPowerShell ScriptStackTrace:`n\$topLevelScriptStackTrace"[\s\S]*?\} finally \{/u
);

console.log("Student database Excel runner checks passed.");

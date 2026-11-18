const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const scriptPath = path.resolve(__dirname, "sync-student-database.ps1");
const scriptSource = fs.readFileSync(scriptPath, "utf8");

function extractBetween(startMarker, endMarker) {
  const start = scriptSource.indexOf(startMarker);
  const end = scriptSource.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Не найден блок ${startMarker}`);
  return scriptSource.slice(start, end);
}

const sortSource = extractBetween(
  "function Sort-StudentLearningSectionByDaysUntilEnd",
  "function Update-StudentSheet"
);
assert.match(sortSource, /if \(\$RecordCount -le 1\) \{ return \}/u);
assert.match(sortSource, /-eq "Дней до окончания"/u);
assert.match(sortSource, /\$daysColumn = \$column[\s\S]*?break/u);
assert.match(sortSource, /\$endRow = \$StartRow \+ \$RecordCount - 1/u);
assert.match(
  sortSource,
  /\$sortRange = \$Sheet\.Range\(\$Sheet\.Cells\.Item\(\$StartRow, 1\), \$Sheet\.Cells\.Item\(\$endRow, \$LastColumn\)\)/u,
  "Сортироваться должны целые строки раздела вместе с формулами и примечаниями"
);
assert.match(sortSource, /\[void\]\$Sheet\.Calculate\(\)/u);
assert.match(sortSource, /\$sortFields\.Add\(\$keyRange, 0, 1\)/u);
assert.match(sortSource, /\$sort\.Header = 2/u);
assert.match(sortSource, /\$sort\.Orientation = 1/u);
assert.match(sortSource, /\$sort\.Apply\(\)/u);
assert.ok(
  sortSource.indexOf("$Sheet.Calculate()") < sortSource.indexOf("$sort.Apply()"),
  "Перед сортировкой Excel должен пересчитать колонку дней"
);

const updateSource = extractBetween("function Update-StudentSheet", "function Update-DirectExpenseSheet");
assert.match(updateSource, /ToLowerInvariant\(\) -eq "обучающиеся"/u);
assert.match(updateSource, /Sort-StudentLearningRecordsByEndDate \$recordsBySection\[\$learningRecordsKey\]/u);
assert.match(updateSource, /\$learningRecordCount -gt 1/u);
assert.match(
  updateSource,
  /Sort-StudentLearningSectionByDaysUntilEnd\s*`\s*\$sheet \$header\.Row \$header\.LastColumn \(\[int\]\$learningSection\[0\]\.Row \+ 1\) \$learningRecordCount/u
);
assert.ok(
  updateSource.indexOf("Update-AisSyncMetadataForRows")
    < updateSource.indexOf("Sort-StudentLearningSectionByDaysUntilEnd"),
  "Сортировка должна переносить уже записанные AIS_SYNC и пользовательские примечания вместе со строками"
);
assert.match(updateSource, /Exception\.Message -notmatch "лицензи"/u);

const commentOnlyStart = scriptSource.indexOf('Get-ObjectProperty $payload "syncMetadataOnly"');
const fullWriteStart = scriptSource.indexOf("$studentResult = Update-StudentSheet", commentOnlyStart);
assert.ok(commentOnlyStart >= 0 && fullWriteStart > commentOnlyStart);
const commentOnlySource = scriptSource.slice(commentOnlyStart, fullWriteStart);
assert.match(commentOnlySource, /return/u);
assert.doesNotMatch(commentOnlySource, /Sort-StudentLearningSectionByDaysUntilEnd/u);

const parseCommand = [
  "$errors = $null",
  `[void][Management.Automation.Language.Parser]::ParseFile('${scriptPath.replace(/'/gu, "''")}', [ref]$null, [ref]$errors)`,
  "if ($errors.Count) { $errors | ForEach-Object { Write-Error $_ }; exit 1 }"
].join("; ");
const parsed = spawnSync("powershell.exe", ["-NoProfile", "-Command", parseCommand], {
  encoding: "utf8"
});
assert.equal(parsed.status, 0, parsed.stderr || parsed.stdout || "PowerShell AST parse failed");

console.log("Student database learning days sort tests passed.");

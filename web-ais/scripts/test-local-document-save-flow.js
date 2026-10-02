"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const {buildLocalDocumentSaveDialogLauncher} = require("../app-server.js");
const root = path.resolve(__dirname, "..");
const launcher = buildLocalDocumentSaveDialogLauncher();

assert.match(launcher, /New-Object System.Windows.Forms.SaveFileDialog/u);
assert.match(launcher, /\$dialog.AutoUpgradeEnabled = \$true/u, "Use the modern Explorer dialog");
assert.match(launcher, /CurrentUICulture = .*'ru-RU'/u);
assert.match(launcher, /\$dialog.Title = 'Сохранить как'/u);
assert.match(launcher, /\$dialog.OverwritePrompt = \$true/u, "Windows must confirm replacement");
assert.match(launcher, /\$owner.TopMost = \$true/u);
assert.match(launcher, /\$owner.ShowInTaskbar = \$false/u);
assert.match(launcher, /\$dialog.ShowDialog\(\$owner\) -eq \[System.Windows.Forms.DialogResult\]::OK/u);
assert.match(launcher, /\$dialog.Dispose\(\)/u);
assert.match(launcher, /\$owner.Dispose\(\)/u);
assert.match(launcher, /AIS_SAVE_PATH:/u);
assert.match(launcher, /GetBytes\(\$dialog.FileName\)/u, "Return the exact confirmed native path");
assert.doesNotMatch(launcher, /FolderBrowserDialog|New-AisDialog|Add-AisTextInput|Confirm-AisFileReplacement|#0f766e/u, "Do not replace Explorer with a custom form");
assert.doesNotMatch(launcher, /WriteAllBytes|WriteAllText|Remove-Item|Set-Content/u, "The dialog never writes or deletes user files");
assert.ok(Buffer.from(launcher, "utf16le").toString("base64").length < 30000);
const deployment = fs.readFileSync(path.join(root, "scripts/deploy-lms.ps1"), "utf8");
assert.equal((deployment.match(/"local-document-save-dialog.js"/g) || []).length, 2);

if (process.platform === "win32") {
  const definitionsOnly = launcher.replace(/\r?\nShow-AisDocumentSaveDialog\s*$/u, "");
  assert.notEqual(definitionsOnly, launcher, "Unit tests must never open a live dialog");
  const tests = String.raw`
function Assert-AisTest([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
$script:extensionWarnings = 0
function Show-AisSaveExtensionError([string]$Extension) { $script:extensionWarnings++ }
foreach ($format in @('pdf', 'docx')) {
  $name = 'Приказ о наборе 609-14_09.2026.' + $format
  $initial = [IO.Path]::Combine($env:TEMP, $name)
  $dialog = New-AisDocumentSaveDialog $initial $format.ToUpperInvariant()
  try {
    Assert-AisTest ($dialog -is [Windows.Forms.SaveFileDialog]) 'Not the native save dialog'
    Assert-AisTest $dialog.AutoUpgradeEnabled 'Modern Explorer navigation disabled'
    Assert-AisTest ($dialog.Title -eq 'Сохранить как') 'Save title missing'
    Assert-AisTest ($dialog.InitialDirectory -eq $env:TEMP) 'Initial folder changed'
    Assert-AisTest ($dialog.FileName -eq $name) 'Filename or date suffix changed'
    Assert-AisTest ($dialog.DefaultExt -eq $format) 'Wrong default extension'
    Assert-AisTest ($dialog.Filter.Split('|').Length -eq 2 -and $dialog.Filter.Split('|')[1] -eq ('*.' + $format)) 'Wrong file filter'
    Assert-AisTest ($dialog.FilterIndex -eq 1) 'Wrong filter index'
    Assert-AisTest $dialog.AddExtension 'Automatic extension missing'
    Assert-AisTest $dialog.SupportMultiDottedExtensions 'Dotted filenames unsupported'
    Assert-AisTest $dialog.CheckPathExists 'Missing path validation'
    Assert-AisTest $dialog.ValidateNames 'Missing name validation'
    Assert-AisTest (-not $dialog.CheckFileExists) 'New files cannot be saved'
    Assert-AisTest $dialog.OverwritePrompt 'Replacement confirmation disabled'
    Assert-AisTest $dialog.RestoreDirectory 'Dialog can change process working directory'
    $fileOk = [Windows.Forms.FileDialog].GetMethod('OnFileOk', [Reflection.BindingFlags]'NonPublic,Instance')
    $event = New-Object ComponentModel.CancelEventArgs
    [void]$fileOk.Invoke($dialog, @($event.PSObject.BaseObject))
    Assert-AisTest (-not $event.Cancel) 'Valid path was rejected'
    $dialog.FileName = [IO.Path]::Combine($env:TEMP, ('ПРИКАЗ №609-14.' + $format.ToUpperInvariant()))
    [void]$fileOk.Invoke($dialog, @($event.PSObject.BaseObject))
    Assert-AisTest (-not $event.Cancel) 'Uppercase extension was rejected'
    $invalidPath = [IO.Path]::Combine($env:TEMP, 'wrong-extension.txt')
    $dialog.FileName = $invalidPath
    [void]$fileOk.Invoke($dialog, @($event.PSObject.BaseObject))
    Assert-AisTest $event.Cancel 'Format mismatch accepted'
    Assert-AisTest ($dialog.FileName -eq $invalidPath) 'Do not rewrite the target after overwrite confirmation'
  } finally { $dialog.Dispose() }
}
Assert-AisTest ($script:extensionWarnings -eq 2) 'Format mismatch must explain how to fix the filename'
$rejected = $false
try { [void](New-AisDocumentSaveDialog 'C:\test.exe' 'exe') } catch { $rejected = $true }
Assert-AisTest $rejected 'Unsupported document format accepted'
$unc = New-AisDocumentSaveDialog '\\server\share\Документы\Приказ_09.2026.pdf' 'pdf'
try {
  Assert-AisTest ($unc.InitialDirectory -eq '\\server\share\Документы') 'Network folder damaged'
  Assert-AisTest ($unc.FileName -eq 'Приказ_09.2026.pdf') 'Network filename damaged'
} finally { $unc.Dispose() }
[Console]::WriteLine('Native Explorer save dialog: PDF/DOCX, initial paths, network folders, name validation, overwrite protection and extension guard: OK')
`;
  const powershell = path.join(process.env.SystemRoot || "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
  const result = spawnSync(powershell, ["-NoLogo", "-NoProfile", "-STA", "-NonInteractive", "-Command",
    "[Console]::InputEncoding = [Text.UTF8Encoding]::new($false); & ([ScriptBlock]::Create([Console]::In.ReadToEnd()))"], {
    input: definitionsOnly + "\n" + tests, encoding: "utf8", windowsHide: true, timeout: 30000
  });
  assert.equal(result.status, 0, String(result.stderr || result.error || result.stdout));
  console.log(result.stdout.trim());
}
console.log("Local document save flow checks passed.");

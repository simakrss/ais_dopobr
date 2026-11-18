"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { spawnSync } = require("node:child_process");
if (process.platform !== "win32") { console.log("SKIP: Windows installer resume tests"); process.exit(0); }
const sourcePath = path.join(__dirname, "install-standalone.ps1");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ais-resume-"));
const quote = value => "'" + value.replace(/'/g, "''") + "'";
try {
  const localAppData = path.join(temp, "Установка 'АИС' & документы");
  const fixture = path.join(localAppData, "AisDopobrLocal");
  fs.mkdirSync(fixture, { recursive: true });
  // A harmless stand-in for the signed installer; no services, reboot or real Startup writes.
  const stub = path.join(fixture, "installer.ps1");
  fs.writeFileSync(stub, "\ufeffparam([switch]$Resume)\nif (-not $Resume) { throw 'Resume flag missing' }\n[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'ran.txt'), 'resumed')\nexit 0\n");
  const ps = `
$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
$utf8=New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding=$utf8; $ProgressPreference='SilentlyContinue'
$ast=[Management.Automation.Language.Parser]::ParseFile(${quote(sourcePath)},[ref]$null,[ref]$null)
foreach ($name in @('Quote-Argument','Assert-LocalPath','Assert-ResumeInstallerSignature','Get-InstallationResumeCommand','Clear-InstallationResume','Register-InstallationResume')) {
  $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$false)
  Invoke-Expression $fn.Extent.Text
}
$installBase=${quote(fixture)}
$resumeScriptPath=Join-Path $installBase 'resume-install.ps1'
$resumeLauncherPath=Join-Path $installBase 'resume-launcher.ps1'
$resumeStatePath=Join-Path $installBase 'resume-install.json'
$resumeShortcutPath=[IO.Path]::GetFullPath((Join-Path $installBase 'Startup/АИС — продолжение установки.lnk'))
$powerShell=[IO.Path]::GetFullPath((Join-Path ([Environment]::SystemDirectory) 'WindowsPowerShell/v1.0/powershell.exe'))
$raw=[byte[]](1,2,3,4); $sha=[Security.Cryptography.SHA256]::Create()
try { $publisherPin=[BitConverter]::ToString($sha.ComputeHash($raw)).Replace('-','') } finally { $sha.Dispose() }
$script:signatureStatus='Valid'; $script:certificateBytes=$raw
function Get-AuthenticodeSignature { param($LiteralPath) return [pscustomobject]@{Status=$script:signatureStatus; SignerCertificate=[pscustomobject]@{RawData=$script:certificateBytes}} }
$script:signatureStatus='NotSigned'
try { Register-InstallationResume ${quote(stub)}; throw 'Unsigned installer accepted' } catch { if ($_.Exception.Message -notmatch 'Подпись') { throw } }
if (Test-Path -LiteralPath $resumeShortcutPath) { throw 'Unsigned installer registered Startup' }
$script:signatureStatus='Valid'; $script:certificateBytes=[byte[]](9,9)
try { Register-InstallationResume ${quote(stub)}; throw 'Wrong publisher accepted' } catch { if ($_.Exception.Message -notmatch 'Издатель') { throw } }
$script:certificateBytes=$raw
Register-InstallationResume ${quote(stub)}
if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($resumeScriptPath)) -ne [Convert]::ToBase64String([IO.File]::ReadAllBytes(${quote(stub)}))) { throw 'Cached installer differs' }
$state=Get-Content -LiteralPath $resumeStatePath -Raw | ConvertFrom-Json
if ($state.protocol -ne 1 -or $state.reason -ne 'reboot') { throw 'Pending reboot state missing' }
$unrelated=Join-Path (Split-Path $resumeShortcutPath) 'Other app.lnk'
[IO.File]::WriteAllText($unrelated, 'leave unchanged')
$shell=New-Object -ComObject WScript.Shell
Start-Sleep -Milliseconds 400
$shortcut=$shell.CreateShortcut($resumeShortcutPath)
if ($shortcut.TargetPath -ine $powerShell -or $shortcut.Arguments -notmatch '-WindowStyle Hidden' -or $shortcut.Arguments -notmatch 'resume-launcher.ps1' -or $shortcut.Arguments.Length -gt 500) { throw ('Incorrect startup action: '+$shortcut.TargetPath+' | '+$shortcut.Arguments) }
$arguments=$shortcut.Arguments
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut)
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
# Re-registration from the cached script must work on a second required reboot.
Register-InstallationResume $resumeScriptPath
Clear-InstallationResume
if ((Test-Path -LiteralPath $resumeShortcutPath) -or (Test-Path -LiteralPath $resumeStatePath) -or -not (Test-Path -LiteralPath $unrelated)) { throw 'Cleanup removed unrelated Startup or left our entry' }
Register-InstallationResume ${quote(stub)}
$command=Get-InstallationResumeCommand
$command=$command.Replace("([Environment]::GetFolderPath('LocalApplicationData'))", ${quote("(" + quote(localAppData) + ")")})
$command=$command.Replace("([Environment]::GetFolderPath('Startup'))", ${quote("(" + quote(path.join(fixture, "Startup")) + ")")})
# Execute the saved shortcut arguments, including Cyrillic, spaces, apostrophe and &.
# Replace only the error dialog in this noninteractive test harness.
$command=$command -replace '\\[void\\]\\[Windows.Forms.MessageBox\\]::Show\\([^;]+\\)', 'Write-Output "Resume blocked"'
function Run-Gate([string]$prefix) {
  [IO.File]::WriteAllText($resumeLauncherPath, ("$"+"ProgressPreference='SilentlyContinue'; "+$prefix+$command), (New-Object Text.UTF8Encoding($true)))
  $info=New-Object Diagnostics.ProcessStartInfo
  $info.FileName=$powerShell
  $info.Arguments=$arguments
  $info.UseShellExecute=$false; $info.CreateNoWindow=$true
  $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
  $p=New-Object Diagnostics.Process; $p.StartInfo=$info
  try {
    [void]$p.Start(); $stdout=$p.StandardOutput.ReadToEndAsync(); $stderr=$p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit(10000)) { $p.Kill(); throw 'Resume fixture hung' }
    if ($stderr.GetAwaiter().GetResult()) { throw $stderr.GetAwaiter().GetResult() }
    return $p.ExitCode
  } finally { $p.Dispose() }
}
$valid='function Get-AuthenticodeSignature { param($LiteralPath) [pscustomobject]@{Status="Valid";SignerCertificate=[pscustomobject]@{RawData=[byte[]](1,2,3,4)}} }; '
if ((Run-Gate $valid) -ne 0 -or -not (Test-Path (Join-Path $installBase 'ran.txt'))) { throw 'Signed cached installer did not resume' }
if (Test-Path -LiteralPath $resumeShortcutPath) { throw 'Startup entry must be consumed before execution' }
Remove-Item -LiteralPath (Join-Path $installBase 'ran.txt')
Clear-InstallationResume
# Stale shortcut, absent state: no UI and no installer execution.
if ((Run-Gate '') -ne 0 -or (Test-Path (Join-Path $installBase 'ran.txt'))) { throw 'Completed installation restarted' }
Register-InstallationResume ${quote(stub)}
$invalid='function Get-AuthenticodeSignature { param($LiteralPath) [pscustomobject]@{Status="NotSigned";SignerCertificate=$null} }; '
if ((Run-Gate $invalid) -ne 1 -or (Test-Path (Join-Path $installBase 'ran.txt'))) { throw 'Invalid signature executed' }
if (Test-Path -LiteralPath $resumeShortcutPath) { throw 'Failed resume must not loop on every login' }
Register-InstallationResume ${quote(stub)}
$wrongPublisher='function Get-AuthenticodeSignature { param($LiteralPath) [pscustomobject]@{Status="Valid";SignerCertificate=[pscustomobject]@{RawData=[byte[]](9,9)}} }; '
if ((Run-Gate $wrongPublisher) -ne 1 -or (Test-Path (Join-Path $installBase 'ran.txt'))) { throw 'Wrong publisher executed' }
Clear-InstallationResume
Write-Output 'PASS: resume registration, cached copy, signatures, second reboot, one-shot launch, stale state, safe cleanup and Windows quoting'
`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(ps, "utf16le").toString("base64")], {
    encoding: "utf8", windowsHide: true, timeout: 60000,
  });
  assert.equal(result.status, 0, (result.error?.message || "") + result.stdout + result.stderr);
  console.log(result.stdout.trim());
} finally { fs.rmSync(temp, { recursive: true, force: true }); }

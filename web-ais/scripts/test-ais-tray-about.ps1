[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$trayPath = Join-Path $PSScriptRoot "ais-service-tray.ps1"
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($trayPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors.Message -join "`n") }
foreach ($name in @("Get-AisReleaseInformation", "New-AisAboutForm", "Show-AisAbout")) {
  $definition = $ast.Find({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
  }, $true)
  if (-not $definition) { throw "Missing function: $name" }
  . ([scriptblock]::Create($definition.Extent.Text))
}
function Write-TrayError([string]$Message) { }
function Update-TrayState { }
function Show-TrayMessage { throw "Opening the About window failed." }
function Assert-Equal($Actual, $Expected, [string]$Message) {
  if ($Actual -cne $Expected) { throw "$Message (actual: $Actual; expected: $Expected)" }
}

$resolvedAppRoot = Split-Path -Parent $PSScriptRoot
$serviceName = "AisDopobrWeb"
$localUrl = "http://127.0.0.1:8081/"
$script:statusItem = [pscustomobject]@{ Text = "Состояние: система остановлена" }
$script:stateIcons = @{ running = [Drawing.SystemIcons]::Application }
$script:aboutForm = $null
$script:aboutStatus = $null
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ("ais-tray-about-test-" + [guid]::NewGuid().ToString("N"))
$fixturePath = Join-Path $fixtureRoot "app.js"
$form = $null
try {
  $currentRelease = Get-AisReleaseInformation $resolvedAppRoot
  $appSource = [IO.File]::ReadAllText((Join-Path $resolvedAppRoot "app.js"))
  $expected = [regex]::Match($appSource, 'APPLICATION_RELEASE = Object.freeze\(\{\s*version: "([^"]+)",\s*releasedAt: "([^"]+)"')
  if (-not $expected.Success) { throw "The application release declaration is missing." }
  Assert-Equal $currentRelease.Version $expected.Groups[1].Value "The tray version must match the application"
  Assert-Equal $currentRelease.ReleaseDate ([datetime]::ParseExact($expected.Groups[2].Value, "yyyy-MM-dd", $null).ToString("dd.MM.yyyy")) "The release date must match the application"

  [void][IO.Directory]::CreateDirectory($fixtureRoot)
  [IO.File]::WriteAllText($fixturePath, "const APPLICATION_RELEASE = Object.freeze({ version: '9.8.7', releasedAt: '2026-09-24' });")
  $release = Get-AisReleaseInformation $fixtureRoot
  Assert-Equal $release.Version "9.8.7" "Release metadata must be read from the selected installation"
  Assert-Equal $release.ReleaseDate "24.09.2026" "The date must be formatted for display"
  [IO.File]::WriteAllText($fixturePath, "const APPLICATION_RELEASE = Object.freeze({ version: 'unknown', releasedAt: '2026-99-99' });")
  $release = Get-AisReleaseInformation $fixtureRoot
  Assert-Equal $release.Version "Не определена" "Invalid versions must not appear as valid releases"
  Assert-Equal $release.ReleaseDate "Не определена" "Invalid dates must not break the tray"
  [IO.File]::Delete($fixturePath)
  Assert-Equal (Get-AisReleaseInformation $fixtureRoot).Version "Не определена" "Missing application files must not break the tray"

  $form = New-AisAboutForm
  $form.CreateControl()
  $form.PerformLayout()
  $values = @($form.Controls[0].Controls | Where-Object { $_ -is [Windows.Forms.TextBox] })
  Assert-Equal $values.Count 8 "The About window must contain the system information"
  Assert-Equal (@($values | Where-Object { -not $_.ReadOnly }).Count) 0 "Information fields must be read-only"
  Assert-Equal $values[0].Text $currentRelease.Version "The window must show the installed version"
  Assert-Equal $values[1].Text $currentRelease.ReleaseDate "The window must show the release date"
  Assert-Equal $form.Controls.Find("aboutStatus", $true)[0].Text "система остановлена" "About must work while the service is stopped"
  Assert-Equal $values[5].Text $localUrl "The local address must be shown"
  Assert-Equal $values[7].Text $resolvedAppRoot "The selected installation path must be shown"
  Assert-Equal $form.CancelButton.Text "Закрыть" "Escape must use the Close button"
  $script:aboutForm = $form
  Show-AisAbout
  if (-not [object]::ReferenceEquals($script:aboutForm, $form)) { throw "Repeated opening must reuse the existing window." }
  Write-Host "PASS: tray About metadata, missing/invalid files, form fields and single-instance window."
} finally {
  if ($null -ne $form) { $form.Dispose() }
  if ([IO.File]::Exists($fixturePath)) { [IO.File]::Delete($fixturePath) }
  if ([IO.Directory]::Exists($fixtureRoot)) { [IO.Directory]::Delete($fixtureRoot) }
}

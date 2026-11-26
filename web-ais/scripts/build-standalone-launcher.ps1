[CmdletBinding()]
param(
  [string]$CertificateThumbprint = '65F97E8E8A4FD85B23624BDAA1F97541AC87ECEB',
  [string]$SignTool = 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe',
  [switch]$NoInteractiveSigning
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent $appRoot
$inputs = @('ЗАПУСТИТЬ АИС.bat', 'web-ais/scripts/install-standalone.ps1', 'web-ais/scripts/standalone-package.js', 'web-ais/scripts/bootstrap-local-system.ps1', 'web-ais/scripts/build-standalone-launcher.ps1', 'web-ais/scripts/launcher-signature.ps1')
foreach ($inputFile in $inputs) {
  if (-not (& git -C $repo ls-files -- $inputFile)) { throw "Untracked installer input: $inputFile" }
}
$dirty = & git -C $repo diff HEAD --name-only -- @($inputs)
if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Commit standalone installer inputs before publication.' }
$certificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$CertificateThumbprint"
if (-not $certificate.HasPrivateKey) { throw 'Code Signing key is unavailable.' }
$sha = [Security.Cryptography.SHA256]::Create()
try { $pin = [BitConverter]::ToString($sha.ComputeHash($certificate.RawData)).Replace('-','') } finally { $sha.Dispose() }
$bat = [IO.File]::ReadAllText((Join-Path $repo 'ЗАПУСТИТЬ АИС.bat'))
if (-not $bat.Contains("`$publisherPin = '$pin'")) { throw 'Standalone BAT publisher pin does not match the certificate.' }
$outputRoot = Join-Path $appRoot 'updates\launcher'
[void][IO.Directory]::CreateDirectory($outputRoot)
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'install-standalone.ps1'))
if (-not $source.Contains("`$publisherPin = '$pin'")) { throw 'Resume launcher publisher pin does not match the certificate.' }
$helper = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'standalone-package.js')))
$preparer = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'bootstrap-local-system.ps1')))
if ([regex]::Matches($source, '@@AIS_PACKAGE_INSTALLER_BASE64@@').Count -ne 1) { throw 'Installer helper placeholder mismatch.' }
if ([regex]::Matches($source, '@@AIS_COMPONENT_PREPARER_BASE64@@').Count -ne 1) { throw 'Component preparer placeholder mismatch.' }
$target = Join-Path $outputRoot 'install-ais.ps1'
$content = $source.Replace('@@AIS_PACKAGE_INSTALLER_BASE64@@', $helper).Replace('@@AIS_COMPONENT_PREPARER_BASE64@@', $preparer)
. (Join-Path $PSScriptRoot 'launcher-signature.ps1')
$reused = Test-AisReusableLauncher $target $content $CertificateThumbprint
if (-not $reused) {
  # A fresh publisher checkout can recover the public signed launcher. It is
  # accepted only after publisher, timestamp, signature and source verification.
  $download = Join-Path $outputRoot ([Guid]::NewGuid().ToString('N') + '.ps1')
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri 'https://edu-plus.ru/lms/updates/launcher/install-ais.ps1' -OutFile $download -TimeoutSec 30 | Out-Null
    if (Test-AisReusableLauncher $download $content $CertificateThumbprint) {
      Move-Item -LiteralPath $download -Destination $target -Force
      $reused = $true
    }
  } catch { Write-Host 'No matching verified public launcher is available.' }
  finally { if (Test-Path -LiteralPath $download) { Remove-Item -LiteralPath $download } }
}
if (-not $reused) {
  if ($NoInteractiveSigning) { throw 'AIS_SIGNING_REQUIRED: installer changed; sign it interactively on the publisher computer.' }
  $pending = Join-Path $outputRoot ([Guid]::NewGuid().ToString('N') + '.ps1')
  try {
    [IO.File]::WriteAllText($pending, $content, (New-Object Text.UTF8Encoding($true)))
    & $SignTool sign /sha1 $CertificateThumbprint /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /d 'AIS standalone installer' $pending
    if ($LASTEXITCODE -ne 0 -or -not (Test-AisReusableLauncher $pending $content $CertificateThumbprint)) { throw 'Standalone installer signing failed.' }
    Move-Item -LiteralPath $pending -Destination $target -Force
  } finally { if (Test-Path -LiteralPath $pending) { Remove-Item -LiteralPath $pending } }
} else { Write-Host 'REUSED verified timestamped standalone launcher; PIN is not required.' }
& $SignTool verify /pa /all $target
if ($LASTEXITCODE -ne 0 -or (Get-AuthenticodeSignature -LiteralPath $target).Status -ne 'Valid') { throw 'Standalone installer signature does not verify.' }
[IO.File]::WriteAllText((Join-Path $outputRoot 'start-ais.bat'), $bat.Replace("`r`n", "`n").Replace("`n", "`r`n"), (New-Object Text.UTF8Encoding($false)))
Write-Host 'SIGNED standalone launcher ready. No settings, passwords or database included.'

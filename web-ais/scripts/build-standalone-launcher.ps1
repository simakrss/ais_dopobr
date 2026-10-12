[CmdletBinding()]
param(
  [string]$CertificateThumbprint = '65F97E8E8A4FD85B23624BDAA1F97541AC87ECEB',
  [string]$SignTool = 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent $appRoot
$inputs = @('ЗАПУСТИТЬ АИС.bat', 'web-ais/scripts/install-standalone.ps1', 'web-ais/scripts/standalone-package.js', 'web-ais/scripts/build-standalone-launcher.ps1')
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
$helper = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'standalone-package.js')))
if ([regex]::Matches($source, '@@AIS_PACKAGE_INSTALLER_BASE64@@').Count -ne 1) { throw 'Installer helper placeholder mismatch.' }
$target = Join-Path $outputRoot 'install-ais.ps1'
[IO.File]::WriteAllText($target, $source.Replace('@@AIS_PACKAGE_INSTALLER_BASE64@@', $helper), (New-Object Text.UTF8Encoding($true)))
& $SignTool sign /sha1 $CertificateThumbprint /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /d 'AIS standalone installer' $target
if ($LASTEXITCODE -ne 0) { throw 'Standalone installer signing failed.' }
& $SignTool verify /pa /all $target
if ($LASTEXITCODE -ne 0 -or (Get-AuthenticodeSignature -LiteralPath $target).Status -ne 'Valid') { throw 'Standalone installer signature does not verify.' }
[IO.File]::WriteAllText((Join-Path $outputRoot 'start-ais.bat'), $bat.Replace("`r`n", "`n").Replace("`n", "`r`n"), (New-Object Text.UTF8Encoding($false)))
Write-Host 'SIGNED standalone launcher ready. No settings, passwords or database included.'

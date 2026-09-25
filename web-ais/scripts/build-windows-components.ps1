[CmdletBinding()]
param(
  [string]$CertificateThumbprint = '65F97E8E8A4FD85B23624BDAA1F97541AC87ECEB',
  [string]$WixRoot = (Join-Path $env:LOCALAPPDATA 'AisDopobrPublisher\wix3141'),
  [string]$SignTool = 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe',
  [switch]$AllowUncommittedForTest
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent $appRoot
$utf8 = New-Object Text.UTF8Encoding($false)
$releaseMatch = [regex]::Match([IO.File]::ReadAllText((Join-Path $appRoot 'app.js')), 'APPLICATION_RELEASE\s*=\s*Object.freeze\(\{\s*version:\s*"(\d+\.\d+\.\d+)"')
if (-not $releaseMatch.Success) { throw 'Application version not found.' }
$version = $releaseMatch.Groups[1].Value
$scripts = @('stop-lan-system.ps1','control-ais-service.ps1','ais-service-tray.ps1','show-ais-service-log.ps1','setup-ais-windows-service.ps1','ais-hidden-process.vbs')
$sources = @('app.js','scripts/ais-windows-service.cs','scripts/ais-msi-update.cs','scripts/windows-components.wxs','scripts/build-windows-components.ps1') + @($scripts | ForEach-Object { 'scripts/' + $_ })
if (-not $AllowUncommittedForTest) {
  foreach ($source in $sources) {
    $tracked = & git -C $repo ls-files -- ('web-ais/' + $source)
    if ($LASTEXITCODE -ne 0 -or -not $tracked) { throw "Untracked publisher input: $source" }
  }
  $dirty = & git -C $repo diff HEAD --name-only -- @($sources | ForEach-Object { 'web-ais/' + $_ })
  if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Commit publisher inputs before building a release.' }
}
$cert = Get-Item -LiteralPath "Cert:\CurrentUser\My\$CertificateThumbprint"
if (-not $cert.HasPrivateKey) { throw 'The signing key is unavailable.' }
$sha = [Security.Cryptography.SHA256]::Create()
try { $pin = [BitConverter]::ToString($sha.ComputeHash($cert.RawData)).Replace('-','') } finally { $sha.Dispose() }
$native = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'ais-msi-update.cs'))
if (-not $native.Contains('PublisherSha256 = "' + $pin + '"')) { throw 'Code Signing certificate does not match the pinned publisher.' }
foreach ($tool in @($SignTool,(Join-Path $WixRoot 'candle.exe'),(Join-Path $WixRoot 'light.exe'))) {
  if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) { throw "Required publisher tool not found: $tool" }
}
$inputDigest = [Security.Cryptography.SHA256]::Create()
try {
  $inputHashes = @($sources | Where-Object { $_ -ne 'app.js' } | ForEach-Object { $_ + ':' + (Get-FileHash -LiteralPath (Join-Path $appRoot $_) -Algorithm SHA256).Hash }) -join "`n"
  $inputHash = [BitConverter]::ToString($inputDigest.ComputeHash($utf8.GetBytes($inputHashes))).Replace('-','').ToLowerInvariant()
} finally { $inputDigest.Dispose() }
$destination = Join-Path $appRoot 'updates\windows'
if ($AllowUncommittedForTest) { $destination = Join-Path $appRoot 'tmp\windows-installer-test' }
$previousManifest = Join-Path $destination 'latest.json'
if (Test-Path -LiteralPath $previousManifest) {
  $previous = Get-Content -LiteralPath $previousManifest -Raw | ConvertFrom-Json
  if ($previous.PSObject.Properties['inputHash'] -and $previous.inputHash -eq $inputHash -and
      [version]$previous.version -le [version]$version -and $previous.sha256 -cmatch '^[a-f0-9]{64}$') {
    $previousFile = Join-Path $destination ($previous.sha256 + '.msi')
    if ((Test-Path -LiteralPath $previousFile) -and
        (Get-FileHash -LiteralPath $previousFile -Algorithm SHA256).Hash.ToLowerInvariant() -eq $previous.sha256) {
      & $SignTool verify /pa /all $previousFile
      if ($LASTEXITCODE -ne 0) { throw 'Existing MSI signature no longer verifies.' }
      Write-Host "SIGNED MSI UNCHANGED: $($previous.version)"
      return
    }
  }
  if (-not $AllowUncommittedForTest -and [version]$previous.version -ge [version]$version) { throw 'Changed MSI inputs require a new application version.' }
}
$stage = Join-Path $env:LOCALAPPDATA ('AisDopobrPublisher\build-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($stage)
# Generated build metadata and package payload are outside the repository/data folders.
$metadata = '[assembly:System.Reflection.AssemblyVersion("' + $version + '.0")]' + "`r`n" +
  '[assembly:System.Reflection.AssemblyFileVersion("' + $version + '.0")]'
[IO.File]::WriteAllText((Join-Path $stage 'Version.cs'),$metadata,$utf8)
$exe = Join-Path $stage 'AisDopobrService.exe'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc /nologo /optimize+ /target:winexe /platform:x64 /define:SIGNED_MSI_UPDATES `
  /reference:System.dll /reference:System.Core.dll /reference:System.ServiceProcess.dll /reference:System.Web.Extensions.dll `
  "/out:$exe" (Join-Path $PSScriptRoot 'ais-windows-service.cs') (Join-Path $PSScriptRoot 'ais-msi-update.cs') (Join-Path $stage 'Version.cs')
if ($LASTEXITCODE -ne 0) { throw 'Native service build failed.' }
foreach ($script in $scripts) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $script) -Destination (Join-Path $stage $script) }
function Sign-Payload([string]$File) {
  & $SignTool sign /sha1 $CertificateThumbprint /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /d 'AIS DIGITALIZATION PLUS' $File
  if ($LASTEXITCODE -ne 0) { throw "Signing failed: $File" }
  & $SignTool verify /pa /all $File
  if ($LASTEXITCODE -ne 0) { throw "Signature verification failed: $File" }
}
Sign-Payload $exe
foreach ($script in $scripts) { Sign-Payload (Join-Path $stage $script) }
$wixobj = Join-Path $stage 'components.wixobj'
& (Join-Path $WixRoot 'candle.exe') -nologo -arch x64 "-dVersion=$version" "-dPayload=$stage" -out $wixobj (Join-Path $PSScriptRoot 'windows-components.wxs')
if ($LASTEXITCODE -ne 0) { throw 'MSI authoring compilation failed.' }
$msi = Join-Path $stage 'AIS-Windows-Components.msi'
& (Join-Path $WixRoot 'light.exe') -nologo -out $msi $wixobj
if ($LASTEXITCODE -ne 0) { throw 'MSI validation/link failed.' }
Sign-Payload $msi
$hash = (Get-FileHash -LiteralPath $msi -Algorithm SHA256).Hash.ToLowerInvariant()
[void][IO.Directory]::CreateDirectory($destination)
$descriptor = [ordered]@{ version=$version; sha256=$hash; size=(Get-Item -LiteralPath $msi).Length; publisherSha256=$pin; inputHash=$inputHash }
Copy-Item -LiteralPath $msi -Destination (Join-Path $destination ($hash + '.msi'))
[IO.File]::WriteAllText((Join-Path $destination 'latest.json'),($descriptor | ConvertTo-Json -Compress),$utf8)
Write-Host "SIGNED MSI READY: $version ($hash). Stage: $stage"

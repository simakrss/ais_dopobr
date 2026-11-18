@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "AIS_LAUNCHER_FILE=%~f0"
set "AIS_LAUNCHER_PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if exist "%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe" set "AIS_LAUNCHER_PS=%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
if /i "%AIS_LAUNCHER_VALIDATE_ONLY%"=="1" goto :validate
start "" /b "%AIS_LAUNCHER_PS%" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$s=[IO.File]::ReadAllText($env:AIS_LAUNCHER_FILE,[Text.Encoding]::UTF8); $p=$s -split '(?m)^# AIS_STANDALONE_POWERSHELL\r?$',2; & ([scriptblock]::Create($p[1]))"
exit /b %ERRORLEVEL%
:validate
"%AIS_LAUNCHER_PS%" -NoLogo -NoProfile -NonInteractive -Command "$s=[IO.File]::ReadAllText($env:AIS_LAUNCHER_FILE,[Text.Encoding]::UTF8); $p=$s -split '(?m)^# AIS_STANDALONE_POWERSHELL\r?$',2; & ([scriptblock]::Create($p[1]))"
exit /b %ERRORLEVEL%
# AIS_STANDALONE_POWERSHELL
$ErrorActionPreference = 'Stop'
if ($env:AIS_LAUNCHER_VALIDATE_ONLY -eq '1') { Write-Output 'Standalone launcher: OK (no downloads or installation)'; exit 0 }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$publisherPin = 'FAB72DC25B08084C8E7D2782D65D3ECF0A1D7ABDEB36A91790641D515DA26EC2'
$cache = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'AisDopobrBootstrap'
$temporary = $null
function Test-AisPublisher([string]$File) {
  if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { return $false }
  $signature = Get-AuthenticodeSignature -LiteralPath $File
  if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate) { return $false }
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($sha.ComputeHash($signature.SignerCertificate.RawData)).Replace('-','') -ceq $publisherPin } finally { $sha.Dispose() }
}
try {
  $directory = [IO.Path]::GetFullPath($cache)
  while ($directory) {
    if ((Test-Path -LiteralPath $directory) -and ((Get-Item -LiteralPath $directory -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Папка установщика является ссылкой. Запуск остановлен.' }
    $parent = [IO.Directory]::GetParent($directory)
    $directory = if ($parent) { $parent.FullName } else { '' }
  }
  [void][IO.Directory]::CreateDirectory($cache)
  $installer = Join-Path $cache 'install-ais.ps1'
  $temporary = Join-Path $cache ('download-' + [Guid]::NewGuid().ToString('N') + '.ps1')
  $downloaded = $false
  try {
    Invoke-WebRequest -UseBasicParsing -Uri 'https://edu-plus.ru/lms/updates/launcher/install-ais.ps1' -OutFile $temporary -TimeoutSec 60
    $downloaded = $true
  } catch {
    if (-not (Test-AisPublisher $installer)) { throw 'Не удалось загрузить подписанный установщик. Проверьте интернет и повторите запуск.' }
  }
  if ($downloaded) {
    if (-not (Test-AisPublisher $temporary)) { throw 'Цифровая подпись или издатель установщика не подтверждены. Файл не запущен.' }
    Move-Item -LiteralPath $temporary -Destination $installer -Force
  }
  if (-not (Test-AisPublisher $installer)) { throw 'Подпись установщика не прошла повторную проверку.' }
  & $installer
  exit $LASTEXITCODE
} catch {
  Add-Type -AssemblyName System.Windows.Forms
  [void][Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Запуск АИС', 'OK', 'Error')
  exit 1
} finally {
  if ($temporary -and (Test-Path -LiteralPath $temporary)) { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
}

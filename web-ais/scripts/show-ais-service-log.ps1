[CmdletBinding()]
param(
  [string]$AppRoot = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$utf8 = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

$resolvedAppRoot = if ([string]::IsNullOrWhiteSpace($AppRoot)) {
  Split-Path -Parent $PSScriptRoot
} else {
  $AppRoot
}
$resolvedAppRoot = [IO.Path]::GetFullPath($resolvedAppRoot)
$logDirectory = Join-Path $resolvedAppRoot "tmp\lan-system"
$serviceLog = Join-Path $logDirectory "service-launch.log"

try {
  $Host.UI.RawUI.WindowTitle = "АИС Допобразование — терминал запуска"
} catch {
  # Some hosts do not expose a writable console title.
}

[void][IO.Directory]::CreateDirectory($logDirectory)
if (-not (Test-Path -LiteralPath $serviceLog -PathType Leaf)) {
  [IO.File]::WriteAllText($serviceLog, "", $utf8)
}

Write-Host "АИС Допобразование — журнал службы" -ForegroundColor Cyan
Write-Host "Файл: $serviceLog"
Write-Host "Закрытие этого окна не останавливает службу АИС."
Write-Host "Для завершения просмотра нажмите Ctrl+C или закройте окно." -ForegroundColor DarkGray
Write-Host ""

Get-Content -LiteralPath $serviceLog -Encoding UTF8 -Tail 200 -Wait

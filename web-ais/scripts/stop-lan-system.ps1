[CmdletBinding()]
param(
  [switch]$KeepDocker
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

$appRoot = Split-Path -Parent $PSScriptRoot
$logRoot = Join-Path $appRoot "tmp\lan-system"
$statusPath = Join-Path $logRoot "status.json"
$composePath = Join-Path $appRoot "docker-compose.onlyoffice.yml"

function Stop-ManagedNode([int]$ProcessId, [string]$ScriptName) {
  if ($ProcessId -le 0) { return }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
  if (-not $process) { return }
  if ([string]$process.Name -ne "node.exe" -or [string]$process.CommandLine -notmatch [regex]::Escape($ScriptName)) {
    Write-Warning "PID $ProcessId не принадлежит $ScriptName и не будет остановлен."
    return
  }
  Stop-Process -Id $ProcessId -Force
  Write-Host "$ScriptName остановлен (PID $ProcessId)."
}

if (Test-Path -LiteralPath $statusPath -PathType Leaf) {
  $status = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
  Stop-ManagedNode ([int]$status.localServerPid) "local-server.js"
  Stop-ManagedNode ([int]$status.appServerPid) "app-server.js"
} else {
  foreach ($port in @(8081, 8080)) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $listener) { continue }
    $scriptName = if ($port -eq 8081) { "local-server.js" } else { "app-server.js" }
    Stop-ManagedNode ([int]$listener.OwningProcess) $scriptName
  }
}

if (-not $KeepDocker -and (Get-Command docker.exe -ErrorAction SilentlyContinue)) {
  $containers = @(docker.exe ps -a --format "{{.Names}}" 2>$null)
  $managedContainers = @($containers | Where-Object { $_ -in @("ais-onlyoffice", "ais-ocr") })
  if ($managedContainers.Count) {
    & docker.exe stop $managedContainers | Out-Null
    Write-Host "OCR и OnlyOffice остановлены."
  }
}

if (Test-Path -LiteralPath $statusPath -PathType Leaf) {
  Remove-Item -LiteralPath $statusPath -Force
}
Write-Host "Локальная АИС остановлена. Автопубликация интернет-версии оставлена включённой."

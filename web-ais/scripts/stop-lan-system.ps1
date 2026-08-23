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

function Find-DockerCli {
  $candidates = @(
    $env:AIS_DOCKER_PATH,
    (Join-Path $env:ProgramFiles "Docker\Docker\resources\bin\docker.exe"),
    (Join-Path $env:LOCALAPPDATA "Docker\resources\bin\docker.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin\docker.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Docker\Docker\resources\bin\docker.exe")
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }
  $command = Get-Command docker.exe -ErrorAction SilentlyContinue
  if ($command) { $candidates += $command.Source }
  return @($candidates | Select-Object -Unique) | Select-Object -First 1
}

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
  $launcherPid = if ($status.PSObject.Properties["launcherPid"]) { [int]$status.launcherPid } else { 0 }
  $localServerPid = if ($status.PSObject.Properties["localServerPid"]) { [int]$status.localServerPid } else { 0 }
  $appServerPid = if ($status.PSObject.Properties["appServerPid"]) { [int]$status.appServerPid } else { 0 }
  Stop-ManagedNode $launcherPid "start-lan-system.js"
  Stop-ManagedNode $localServerPid "local-server.js"
  Stop-ManagedNode $appServerPid "app-server.js"
} else {
  foreach ($port in @(8081, 19081)) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $listener) { continue }
    $scriptName = if ($port -eq 8081) { "local-server.js" } else { "app-server.js" }
    Stop-ManagedNode ([int]$listener.OwningProcess) $scriptName
  }
}

if (-not $KeepDocker) {
  $dockerPath = Find-DockerCli
  $containers = if ($dockerPath) { @(& $dockerPath ps -a --format "{{.Names}}" 2>$null) } else { @() }
  $managedContainers = @($containers | Where-Object { $_ -in @("ais-onlyoffice", "ais-ocr") })
  if ($managedContainers.Count) {
    & $dockerPath stop $managedContainers | Out-Null
    Write-Host "OCR и OnlyOffice остановлены."
  }
}

if (Test-Path -LiteralPath $statusPath -PathType Leaf) {
  Remove-Item -LiteralPath $statusPath -Force
}
Write-Host "Локальная АИС остановлена. Автопубликация интернет-версии оставлена включённой."

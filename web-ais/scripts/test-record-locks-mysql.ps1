[CmdletBinding()]
param(
  [int]$Port = 8091,
  [ValidateRange(0, 300)]
  [int]$KeepAliveSeconds = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $PSScriptRoot
$testRoot = Join-Path $appRoot ("tmp\mysql-lock-test-" + [Guid]::NewGuid().ToString("N"))
$stdoutPath = Join-Path $testRoot "stdout.log"
$stderrPath = Join-Path $testRoot "stderr.log"
$process = $null
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null

$oldPort = $env:PORT
$oldHost = $env:HOST
$oldTrust = $env:AIS_TRUST_GATEWAY
try {
  $env:PORT = [string]$Port
  $env:HOST = "127.0.0.1"
  $env:AIS_TRUST_GATEWAY = "1"
  $process = Start-Process -FilePath "C:\Program Files\nodejs\node.exe" `
    -ArgumentList "app-server.js" `
    -WorkingDirectory $appRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru
} finally {
  $env:PORT = $oldPort
  $env:HOST = $oldHost
  $env:AIS_TRUST_GATEWAY = $oldTrust
}

try {
  $deadline = (Get-Date).AddSeconds(20)
  do {
    Start-Sleep -Milliseconds 250
    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  } while (-not $listener -and (Get-Date) -lt $deadline)
  if (-not $listener) { throw "MySQL lock test server did not start." }

  $url = "http://127.0.0.1:$Port/api/shared-state/locks"
  $settings = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/api/settings/system-documents" -TimeoutSec 20
  $managerSettings = Invoke-RestMethod -Method Get `
    -Uri "http://127.0.0.1:$Port/api/settings/system-documents" `
    -Headers @{ "x-ais-user-role" = "manager" } `
    -TimeoutSec 20
  $connectionTest = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/mysql-locks/test" -TimeoutSec 120
  $entityId = "mysql-test-" + [Guid]::NewGuid().ToString("N")
  $bodyA = @{
    action = "acquire"
    entityType = "contracts"
    entityId = $entityId
    clientId = "test-client-a"
  } | ConvertTo-Json -Compress
  $bodyB = @{
    action = "acquire"
    entityType = "contracts"
    entityId = $entityId
    clientId = "test-client-b"
  } | ConvertTo-Json -Compress

  $lockA = Invoke-RestMethod -Method Post -Uri $url -ContentType "application/json" -Body $bodyA -TimeoutSec 20
  $secondStatus = 0
  try {
    Invoke-WebRequest -UseBasicParsing -Method Post -Uri $url -ContentType "application/json" -Body $bodyB -TimeoutSec 20 | Out-Null
  } catch {
    $secondStatus = [int]$_.Exception.Response.StatusCode
  }
  $list = Invoke-RestMethod -Method Get -Uri "$url`?clientId=test-client-a" -TimeoutSec 20

  $releaseA = @{
    action = "release"
    entityType = "contracts"
    entityId = $entityId
    clientId = "test-client-a"
  } | ConvertTo-Json -Compress
  Invoke-RestMethod -Method Post -Uri $url -ContentType "application/json" -Body $releaseA -TimeoutSec 20 | Out-Null
  $lockB = Invoke-RestMethod -Method Post -Uri $url -ContentType "application/json" -Body $bodyB -TimeoutSec 20
  $releaseB = @{
    action = "release"
    entityType = "contracts"
    entityId = $entityId
    clientId = "test-client-b"
  } | ConvertTo-Json -Compress
  Invoke-RestMethod -Method Post -Uri $url -ContentType "application/json" -Body $releaseB -TimeoutSec 20 | Out-Null

  [pscustomobject]@{
    FirstSource = [string]$lockA.source
    SecondStatus = $secondStatus
    ListSource = [string]$list.source
    VisibleLock = [bool]($list.locks | Where-Object { $_.entityId -eq $entityId })
    AcquiredAfterRelease = [bool](-not $lockB.locked)
    TtlMs = [int]$lockA.ttlMs
    SettingsConfigured = [bool]$settings.mysqlConfigured
    SettingsSource = [string]$settings.mysqlSource
    SettingsHasPassword = [bool]$settings.mysqlHasPassword
    AdminResponseContainsSecret = [bool]($settings.PSObject.Properties.Name -contains "mysqlPassword")
    ManagerSeesMysqlSettings = [bool]($managerSettings.PSObject.Properties.Name -contains "mysqlUser")
    ConnectionTestOk = [bool]$connectionTest.ok
    SharedStateRevision = [int]$connectionTest.stateRevision
    SharedStatePendingCount = [int]$connectionTest.pendingCount
    StderrBytes = (Get-Item -LiteralPath $stderrPath).Length
  } | ConvertTo-Json -Compress
  if ($KeepAliveSeconds -gt 0) {
    Start-Sleep -Seconds $KeepAliveSeconds
  }
} finally {
  if ($process -and (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) {
    Stop-Process -Id $process.Id -Force
  }
}

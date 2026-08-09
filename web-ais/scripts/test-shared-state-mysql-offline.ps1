[CmdletBinding()]
param(
  [int]$Port = 8092,
  [ValidateRange(0, 300)]
  [int]$KeepAliveSeconds = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $PSScriptRoot
$testId = "test-" + [Guid]::NewGuid().ToString("N")
$testRoot = Join-Path $appRoot ("tmp\shared-state-mysql-" + $testId)
$cachePath = Join-Path $testRoot "cache.json"
$pendingPath = Join-Path $testRoot "pending.json"
$locksPath = Join-Path $testRoot "locks.json"
$stdoutPath = Join-Path $testRoot "stdout.log"
$stderrPath = Join-Path $testRoot "stderr.log"
$process = $null
$process2 = $null

New-Item -ItemType Directory -Path $testRoot -Force | Out-Null

$environmentNames = @(
  "PORT",
  "HOST",
  "AIS_TRUST_GATEWAY",
  "AIS_SHARED_STATE_KEY",
  "AIS_SHARED_STATE_TEST_MODE",
  "AIS_SHARED_STATE_DISABLE_LEGACY_MIGRATION",
  "AIS_SHARED_STATE_LOCAL_PATH",
  "AIS_SHARED_STATE_PENDING_PATH",
  "AIS_SHARED_RECORD_LOCKS_LOCAL_PATH",
  "AIS_RECORD_LOCKS_MYSQL_CONNECTION_STRING"
)
$oldEnvironment = @{}
foreach ($name in $environmentNames) {
  $oldEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}

function Set-ProcessEnvironment([string]$Name, [AllowNull()][string]$Value) {
  [Environment]::SetEnvironmentVariable($Name, $Value, "Process")
}

function Stop-TestServer {
  if ($script:process -and (Get-Process -Id $script:process.Id -ErrorAction SilentlyContinue)) {
    Stop-Process -Id $script:process.Id -Force
    Wait-Process -Id $script:process.Id -Timeout 10 -ErrorAction SilentlyContinue
  }
  $script:process = $null
}

function Stop-SecondTestServer {
  if ($script:process2 -and (Get-Process -Id $script:process2.Id -ErrorAction SilentlyContinue)) {
    Stop-Process -Id $script:process2.Id -Force
    Wait-Process -Id $script:process2.Id -Timeout 10 -ErrorAction SilentlyContinue
  }
  $script:process2 = $null
}

function Start-TestServer([AllowNull()][string]$ConnectionOverride) {
  Stop-TestServer
  Set-ProcessEnvironment "AIS_RECORD_LOCKS_MYSQL_CONNECTION_STRING" $ConnectionOverride
  $script:process = Start-Process -FilePath "C:\Program Files\nodejs\node.exe" `
    -ArgumentList "app-server.js" `
    -WorkingDirectory $appRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru
  $deadline = (Get-Date).AddSeconds(20)
  do {
    Start-Sleep -Milliseconds 250
    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  } while (-not $listener -and (Get-Date) -lt $deadline)
  if (-not $listener) {
    $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw } else { "" }
    throw "Test server did not open port $Port. $stderr"
  }
}

try {
  Set-ProcessEnvironment "PORT" ([string]$Port)
  Set-ProcessEnvironment "HOST" "127.0.0.1"
  Set-ProcessEnvironment "AIS_TRUST_GATEWAY" "1"
  Set-ProcessEnvironment "AIS_SHARED_STATE_KEY" $testId
  Set-ProcessEnvironment "AIS_SHARED_STATE_TEST_MODE" "1"
  Set-ProcessEnvironment "AIS_SHARED_STATE_DISABLE_LEGACY_MIGRATION" "1"
  Set-ProcessEnvironment "AIS_SHARED_STATE_LOCAL_PATH" $cachePath
  Set-ProcessEnvironment "AIS_SHARED_STATE_PENDING_PATH" $pendingPath
  Set-ProcessEnvironment "AIS_SHARED_RECORD_LOCKS_LOCAL_PATH" $locksPath

  $url = "http://127.0.0.1:$Port/api/shared-state"
  Start-TestServer $oldEnvironment["AIS_RECORD_LOCKS_MYSQL_CONNECTION_STRING"]
  $initial = Invoke-RestMethod -Method Get -Uri $url -TimeoutSec 30
  $data = @{
    meta = @{ organization = "MySQL offline test" }
    dictionaries = @{ statuses = @("New", "Done") }
    collections = @{
      students = @(
        @{ id = "student-1"; name = "Online original" },
        @{ id = "student-2"; name = "Second original" }
      )
      contracts = @()
    }
  }
  $created = Invoke-RestMethod -Method Post -Uri $url -ContentType "application/json" `
    -Body (@{ baseRevision = 0; data = $data; clientId = "test-client-a" } | ConvertTo-Json -Depth 20 -Compress) `
    -TimeoutSec 45
  $onlineLoaded = Invoke-RestMethod -Method Get -Uri $url -TimeoutSec 30
  Stop-TestServer

  $offlineConnection = "Server={127.0.0.1};Port={1};Database={offline};Uid={offline};Pwd={offline}"
  Start-TestServer $offlineConnection
  $offlinePatch = @{
    baseRevision = [int]$created.revision
    clientId = "test-client-a"
    patch = @{
      collections = @{
        students = @{
          upserts = @(@{ id = "student-1"; name = "Changed offline" })
          deletes = @()
        }
      }
    }
  }
  $queued = Invoke-RestMethod -Method Post -Uri $url -ContentType "application/json" `
    -Body ($offlinePatch | ConvertTo-Json -Depth 20 -Compress) -TimeoutSec 45
  $offlineLoaded = Invoke-RestMethod -Method Get -Uri $url -TimeoutSec 30
  $locksUrl = "http://127.0.0.1:$Port/api/shared-state/locks"
  $offlineLock = Invoke-RestMethod -Method Post -Uri $locksUrl -ContentType "application/json" `
    -Body (@{ action = "acquire"; entityType = "students"; entityId = "student-1"; clientId = "offline-lock-client" } | ConvertTo-Json -Compress) `
    -TimeoutSec 30
  Stop-TestServer

  Start-TestServer $oldEnvironment["AIS_RECORD_LOCKS_MYSQL_CONNECTION_STRING"]
  $deadline = (Get-Date).AddSeconds(45)
  do {
    Start-Sleep -Milliseconds 500
    $synchronized = Invoke-RestMethod -Method Get -Uri $url -TimeoutSec 30
  } while (([bool]$synchronized.offline -or [int]$synchronized.pendingCount -gt 0) -and (Get-Date) -lt $deadline)
  if ([bool]$synchronized.offline -or [int]$synchronized.pendingCount -gt 0) {
    throw "Offline queue was not synchronized within 45 seconds."
  }

  $realtimePatch = @{
    baseRevision = [int]$synchronized.revision
    clientId = "test-client-b"
    patch = @{
      collections = @{
        students = @{
          upserts = @(@{ id = "student-2"; name = "Realtime update" })
          deletes = @()
        }
      }
    }
  }
  $realtimeSaved = Invoke-RestMethod -Method Post -Uri $url -ContentType "application/json" `
    -Body ($realtimePatch | ConvertTo-Json -Depth 20 -Compress) -TimeoutSec 45
  $metadata = Invoke-RestMethod -Method Get -Uri "$url`?metadata=1" -TimeoutSec 30
  $realtimeLoaded = Invoke-RestMethod -Method Get -Uri $url -TimeoutSec 30

  $secondPort = $Port + 1
  $secondCachePath = Join-Path $testRoot "cache-second.json"
  $secondPendingPath = Join-Path $testRoot "pending-second.json"
  $secondLocksPath = Join-Path $testRoot "locks-second.json"
  $secondStdoutPath = Join-Path $testRoot "stdout-second.log"
  $secondStderrPath = Join-Path $testRoot "stderr-second.log"
  Set-ProcessEnvironment "PORT" ([string]$secondPort)
  Set-ProcessEnvironment "AIS_SHARED_STATE_LOCAL_PATH" $secondCachePath
  Set-ProcessEnvironment "AIS_SHARED_STATE_PENDING_PATH" $secondPendingPath
  Set-ProcessEnvironment "AIS_SHARED_RECORD_LOCKS_LOCAL_PATH" $secondLocksPath
  $process2 = Start-Process -FilePath "C:\Program Files\nodejs\node.exe" `
    -ArgumentList "app-server.js" `
    -WorkingDirectory $appRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $secondStdoutPath `
    -RedirectStandardError $secondStderrPath `
    -PassThru
  $secondDeadline = (Get-Date).AddSeconds(20)
  do {
    Start-Sleep -Milliseconds 250
    $secondListener = Get-NetTCPConnection -State Listen -LocalPort $secondPort -ErrorAction SilentlyContinue
  } while (-not $secondListener -and (Get-Date) -lt $secondDeadline)
  if (-not $secondListener) { throw "Second test server did not open port $secondPort." }
  $secondServerLoaded = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$secondPort/api/shared-state" -TimeoutSec 30

  $result = [pscustomobject]@{
    TestKey = $testId
    InitialExists = [bool]$initial.exists
    CreatedSource = [string]$created.source
    CreatedRevision = [int]$created.revision
    OnlineFirstStudent = [string]$onlineLoaded.data.collections.students[0].name
    QueuedOffline = [bool]$queued.offline
    OfflinePendingCount = [int]$queued.pendingCount
    OfflineFirstStudent = [string]$offlineLoaded.data.collections.students[0].name
    OfflineLockSource = [string]$offlineLock.source
    SynchronizedSource = [string]$synchronized.source
    SynchronizedPendingCount = [int]$synchronized.pendingCount
    SynchronizedFirstStudent = [string]$synchronized.data.collections.students[0].name
    RealtimeRevision = [int]$realtimeSaved.revision
    MetadataRevision = [int]$metadata.revision
    RealtimeSecondStudent = [string]$realtimeLoaded.data.collections.students[1].name
    SecondServerRevision = [int]$secondServerLoaded.revision
    SecondServerFirstStudent = [string]$secondServerLoaded.data.collections.students[0].name
    SecondServerSecondStudent = [string]$secondServerLoaded.data.collections.students[1].name
    StderrBytes = (Get-Item -LiteralPath $stderrPath).Length
    SecondServerStderrBytes = (Get-Item -LiteralPath $secondStderrPath).Length
  }

  Invoke-RestMethod -Method Delete -Uri $url -TimeoutSec 30 | Out-Null
  $result | ConvertTo-Json -Compress
  if ($KeepAliveSeconds -gt 0) { Start-Sleep -Seconds $KeepAliveSeconds }
} finally {
  Stop-SecondTestServer
  Stop-TestServer
  foreach ($name in $environmentNames) {
    Set-ProcessEnvironment $name $oldEnvironment[$name]
  }
  $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
  $resolvedTmpRoot = [IO.Path]::GetFullPath((Join-Path $appRoot "tmp"))
  if ($resolvedTestRoot.StartsWith($resolvedTmpRoot, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

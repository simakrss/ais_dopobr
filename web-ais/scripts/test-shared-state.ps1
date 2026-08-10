[CmdletBinding()]
param(
  [switch]$WebDavReadOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $PSScriptRoot
$testRoot = Join-Path $appRoot ("tmp\shared-state-test-" + [Guid]::NewGuid().ToString("N"))
$testState = Join-Path $testRoot "state.json"
$testLocks = Join-Path $testRoot "locks.json"
$stdoutPath = Join-Path $testRoot "stdout.log"
$stderrPath = Join-Path $testRoot "stderr.log"
$process = $null
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null

$oldPort = $env:PORT
$oldHost = $env:HOST
$oldTrust = $env:AIS_TRUST_GATEWAY
$oldLocalOnly = $env:AIS_SHARED_STATE_LOCAL_ONLY
$oldLocalPath = $env:AIS_SHARED_STATE_LOCAL_PATH
$oldLocksPath = $env:AIS_SHARED_RECORD_LOCKS_LOCAL_PATH
try {
  $env:PORT = "8090"
  $env:HOST = "127.0.0.1"
  $env:AIS_TRUST_GATEWAY = "1"
  if ($WebDavReadOnly) {
    Remove-Item Env:AIS_SHARED_STATE_LOCAL_ONLY -ErrorAction SilentlyContinue
    Remove-Item Env:AIS_SHARED_STATE_LOCAL_PATH -ErrorAction SilentlyContinue
  } else {
    $env:AIS_SHARED_STATE_LOCAL_ONLY = "1"
    $env:AIS_SHARED_STATE_LOCAL_PATH = $testState
    $env:AIS_SHARED_RECORD_LOCKS_LOCAL_PATH = $testLocks
  }
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
  $env:AIS_SHARED_STATE_LOCAL_ONLY = $oldLocalOnly
  $env:AIS_SHARED_STATE_LOCAL_PATH = $oldLocalPath
  $env:AIS_SHARED_RECORD_LOCKS_LOCAL_PATH = $oldLocksPath
}

try {
  $deadline = (Get-Date).AddSeconds(15)
  do {
    Start-Sleep -Milliseconds 250
    $listener = Get-NetTCPConnection -State Listen -LocalPort 8090 -ErrorAction SilentlyContinue
  } while (-not $listener -and (Get-Date) -lt $deadline)
  if (-not $listener) { throw "Test server did not open port 8090." }

  $url = "http://127.0.0.1:8090/api/shared-state"
  $initial = Invoke-RestMethod -Method Get -Uri $url -TimeoutSec 15
  if ($WebDavReadOnly) {
    [pscustomobject]@{
      Exists = [bool]$initial.exists
      Revision = [int]$initial.revision
      Source = [string]$initial.source
      Offline = [bool]$initial.offline
      VersionTag = [string]$initial.versionTag
    } | ConvertTo-Json -Compress
    return
  }
  $data1 = @{
    meta = @{ organization = "Shared test" }
    dictionaries = @{}
    collections = @{
      students = @(
        @{ id = "student-1"; name = "Student one original" },
        @{ id = "student-2"; name = "Student two original" }
      )
      contracts = @(@{ id = "contract-1"; name = "Contract" })
    }
  }
  $body1 = @{ baseRevision = 0; data = $data1 } | ConvertTo-Json -Depth 12 -Compress
  $created = Invoke-RestMethod -Method Post -Uri $url -ContentType "application/json" -Body $body1 -TimeoutSec 15
  $loaded = Invoke-RestMethod -Method Get -Uri $url -TimeoutSec 15

  $conflictStatus = 0
  try {
    Invoke-WebRequest -UseBasicParsing -Method Post -Uri $url -ContentType "application/json" -Body $body1 -TimeoutSec 15 | Out-Null
  } catch {
    $conflictStatus = [int]$_.Exception.Response.StatusCode
  }

  $data2 = @{
    meta = @{ organization = "Shared test revision 2" }
    dictionaries = @{}
    collections = $data1.collections
  }
  $body2 = @{ baseRevision = 1; data = $data2 } | ConvertTo-Json -Depth 12 -Compress
  $updated = Invoke-RestMethod -Method Post -Uri $url -ContentType "application/json" -Body $body2 -TimeoutSec 15

  $patch1 = @{
    baseRevision = 1
    clientId = "test-client-a"
    patch = @{ collections = @{ students = @{ upserts = @(@{ id = "student-1"; name = "Student one changed" }); deletes = @(); order = @("student-1", "student-2") } } }
  } | ConvertTo-Json -Depth 12 -Compress
  $merged1 = Invoke-RestMethod -Method Post -Uri $url -ContentType "application/json" -Body $patch1 -TimeoutSec 15

  $patch2 = @{
    baseRevision = 2
    clientId = "test-client-b"
    patch = @{ collections = @{ students = @{ upserts = @(@{ id = "student-2"; name = "Student two changed" }); deletes = @(); order = @("student-1", "student-2") } } }
  } | ConvertTo-Json -Depth 12 -Compress
  $merged2 = Invoke-RestMethod -Method Post -Uri $url -ContentType "application/json" -Body $patch2 -TimeoutSec 15
  $mergedLoaded = Invoke-RestMethod -Method Get -Uri $url -TimeoutSec 15

  $locksUrl = "http://127.0.0.1:8090/api/shared-state/locks"
  $lockA = @{ action = "acquire"; entityType = "contracts"; entityId = "contract-1"; clientId = "test-client-a" } | ConvertTo-Json -Compress
  $lockB = @{ action = "acquire"; entityType = "contracts"; entityId = "contract-1"; clientId = "test-client-b" } | ConvertTo-Json -Compress
  $acquired = Invoke-RestMethod -Method Post -Uri $locksUrl -ContentType "application/json" -Body $lockA -TimeoutSec 15
  $secondLockStatus = 0
  try {
    Invoke-WebRequest -UseBasicParsing -Method Post -Uri $locksUrl -ContentType "application/json" -Body $lockB -TimeoutSec 15 | Out-Null
  } catch {
    $secondLockStatus = [int]$_.Exception.Response.StatusCode
  }

  $lockedPatch = @{
    baseRevision = [int]$merged2.revision
    clientId = "test-client-b"
    patch = @{ collections = @{ contracts = @{ upserts = @(@{ id = "contract-1"; name = "Conflicting change" }); deletes = @(); order = @("contract-1") } } }
  } | ConvertTo-Json -Depth 12 -Compress
  $lockedSaveStatus = 0
  try {
    Invoke-WebRequest -UseBasicParsing -Method Post -Uri $url -ContentType "application/json" -Body $lockedPatch -TimeoutSec 15 | Out-Null
  } catch {
    $lockedSaveStatus = [int]$_.Exception.Response.StatusCode
  }

  $takeoverB = @{ action = "takeover"; entityType = "contracts"; entityId = "contract-1"; clientId = "test-client-b" } | ConvertTo-Json -Compress
  $takenOver = Invoke-RestMethod -Method Post -Uri $locksUrl -ContentType "application/json" -Body $takeoverB -TimeoutSec 15
  $firstClientAfterTakeoverStatus = 0
  try {
    Invoke-WebRequest -UseBasicParsing -Method Post -Uri $locksUrl -ContentType "application/json" -Body $lockA -TimeoutSec 15 | Out-Null
  } catch {
    $firstClientAfterTakeoverStatus = [int]$_.Exception.Response.StatusCode
  }
  $listAfterTakeover = Invoke-RestMethod -Method Get -Uri "$locksUrl`?clientId=test-client-b" -TimeoutSec 15
  $releaseB = @{ action = "release"; entityType = "contracts"; entityId = "contract-1"; clientId = "test-client-b" } | ConvertTo-Json -Compress
  Invoke-RestMethod -Method Post -Uri $locksUrl -ContentType "application/json" -Body $releaseB -TimeoutSec 15 | Out-Null
  $metadata = Invoke-RestMethod -Method Get -Uri "$url`?metadata=1" -TimeoutSec 15

  [pscustomobject]@{
    InitialExists = [bool]$initial.exists
    CreatedRevision = [int]$created.revision
    LoadedOrganization = [string]$loaded.data.meta.organization
    ConflictStatus = $conflictStatus
    UpdatedRevision = [int]$updated.revision
    FirstPatchMerged = [bool]$merged1.merged
    SecondPatchMerged = [bool]$merged2.merged
    FirstStudent = [string]$mergedLoaded.data.collections.students[0].name
    SecondStudent = [string]$mergedLoaded.data.collections.students[1].name
    LockOwner = [string]$acquired.lock.ownerLogin
    SecondLockStatus = $secondLockStatus
    LockedSaveStatus = $lockedSaveStatus
    LockTakenOver = [bool]$takenOver.takenOver
    TakeoverOwnerIsCurrentSession = [bool]($listAfterTakeover.locks | Where-Object { $_.entityId -eq "contract-1" -and $_.ownedByClient })
    FirstClientAfterTakeoverStatus = $firstClientAfterTakeoverStatus
    MetadataVersionTag = [string]$metadata.versionTag
    StderrBytes = (Get-Item -LiteralPath $stderrPath).Length
  } | ConvertTo-Json -Compress
} finally {
  if ($process -and (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) {
    Stop-Process -Id $process.Id -Force
  }
  $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
  $resolvedTmpRoot = [IO.Path]::GetFullPath((Join-Path $appRoot "tmp"))
  if ($resolvedTestRoot.StartsWith($resolvedTmpRoot, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
  }
}

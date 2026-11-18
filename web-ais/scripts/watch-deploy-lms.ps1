[CmdletBinding()]
param(
  [ValidateRange(2, 300)]
  [int]$PollSeconds = 4,
  [ValidateRange(2, 300)]
  [int]$DebounceSeconds = 5
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $PSScriptRoot
$deployScript = Join-Path $PSScriptRoot "deploy-lms.ps1"
$logDirectory = Join-Path $appRoot "tmp"
$logPath = Join-Path $logDirectory "deploy-watch.log"
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

$mutex = New-Object Threading.Mutex($false, "Local\WebAisLmsDeployWatcher")
if (-not $mutex.WaitOne(0, $false)) { exit 0 }

function Write-WatchLog([string]$Message) {
  Add-Content -LiteralPath $logPath -Encoding UTF8 -Value "$(Get-Date -Format s) $Message"
}

function Get-DeployablePaths {
  return @(& $deployScript -ListDeployable)
}

function Get-Snapshot {
  $snapshot = @{}
  foreach ($relativePath in @(Get-DeployablePaths)) {
    $localPath = Join-Path $appRoot ($relativePath.Replace("/", [IO.Path]::DirectorySeparatorChar))
    if (-not (Test-Path -LiteralPath $localPath -PathType Leaf)) { continue }
    $item = Get-Item -LiteralPath $localPath
    $snapshot[$relativePath] = "$($item.LastWriteTimeUtc.Ticks):$($item.Length)"
  }
  return $snapshot
}

try {
  $previous = Get-Snapshot
  Write-WatchLog "Watcher started; tracked files: $($previous.Count)."
  while ($true) {
    Start-Sleep -Seconds $PollSeconds
    $current = Get-Snapshot
    $changed = @(
      $current.Keys |
        Where-Object { -not $previous.ContainsKey($_) -or $previous[$_] -ne $current[$_] } |
        Sort-Object
    )
    if (-not $changed.Count) {
      $previous = $current
      continue
    }

    Start-Sleep -Seconds $DebounceSeconds
    $settled = Get-Snapshot
    $changed = @(
      $settled.Keys |
        Where-Object { -not $previous.ContainsKey($_) -or $previous[$_] -ne $settled[$_] } |
        Sort-Object
    )
    if (-not $changed.Count) {
      $previous = $settled
      continue
    }

    try {
      $output = & $deployScript -RelativePath $changed 2>&1 | Out-String
      Write-WatchLog "Published: $($changed -join ', '). $($output.Trim())"
      $previous = $settled
    } catch {
      Write-WatchLog "Publish failed for $($changed -join ', '): $($_.Exception.Message)"
      Start-Sleep -Seconds 15
    }
  }
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}

[CmdletBinding()]
param(
  [switch]$KeepDocker,
  [string]$AppRoot = ""
)

$env:PSModulePath = [IO.Path]::Combine($PSHOME, "Modules")
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

$appRoot = if ([string]::IsNullOrWhiteSpace($AppRoot)) {
  Split-Path -Parent $PSScriptRoot
} else {
  [IO.Path]::GetFullPath($AppRoot)
}
$logRoot = Join-Path $appRoot "tmp\lan-system"
$statusPath = Join-Path $logRoot "status.json"
$commonProgramData = [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData)
$serviceConfigPath = Join-Path $commonProgramData "AisDopobrWeb\service-config.json"
$expectedAppRoots = New-Object Collections.Generic.List[string]
$expectedAppRoots.Add([IO.Path]::GetFullPath($appRoot))
$serviceConfig = $null

if (Test-Path -LiteralPath $serviceConfigPath -PathType Leaf) {
  try {
    $serviceConfig = Get-Content -LiteralPath $serviceConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($propertyName in @("sourceAppRoot", "serviceAppRoot")) {
      if ($serviceConfig.PSObject.Properties[$propertyName]) {
        $candidate = [string]$serviceConfig.$propertyName
        if (-not [string]::IsNullOrWhiteSpace($candidate)) {
          $fullCandidate = [IO.Path]::GetFullPath($candidate)
          if (-not $expectedAppRoots.Contains($fullCandidate)) { $expectedAppRoots.Add($fullCandidate) }
        }
      }
    }
  } catch {
    Write-Warning "Конфигурация службы не прочитана: $($_.Exception.Message)"
  }
}

function Find-DockerCli {
  $candidates = @(
    @(
      $env:AIS_DOCKER_PATH,
      (Join-Path $env:ProgramFiles "Docker\Docker\resources\bin\docker.exe"),
      (Join-Path $env:LOCALAPPDATA "Docker\resources\bin\docker.exe"),
      (Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin\docker.exe"),
      (Join-Path $env:LOCALAPPDATA "Programs\Docker\Docker\resources\bin\docker.exe")
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }
  )
  $command = Get-Command docker.exe -ErrorAction SilentlyContinue
  if ($command) { $candidates += $command.Source }
  return @($candidates | Select-Object -Unique) | Select-Object -First 1
}

function Get-ExpectedScriptPaths([string]$ScriptName) {
  $relativePath = if ($ScriptName -eq "start-lan-system.js") {
    "scripts\start-lan-system.js"
  } else {
    $ScriptName
  }
  return @($expectedAppRoots | ForEach-Object {
    [IO.Path]::GetFullPath([IO.Path]::Combine($_, $relativePath)).Replace("/", "\").ToLowerInvariant()
  } | Select-Object -Unique)
}

function Test-ExpectedNodeProcess($Process, [string]$ScriptName) {
  if (-not $Process -or [string]$Process.Name -ne "node.exe") { return $false }
  $commandLine = ([string]$Process.CommandLine).Replace("/", "\").ToLowerInvariant()
  foreach ($expectedPath in @(Get-ExpectedScriptPaths $ScriptName)) {
    if ($commandLine.IndexOf($expectedPath, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
      return $true
    }
  }
  return $false
}

function Convert-CreationDate($Process) {
  if (-not $Process -or -not $Process.CreationDate) { return $null }
  return ([DateTimeOffset]$Process.CreationDate).ToUniversalTime()
}

function Test-SameProcessAlive([int]$ProcessId, [DateTimeOffset]$ExpectedCreation) {
  $current = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
  if (-not $current) { return $false }
  $currentCreation = Convert-CreationDate $current
  if (-not $currentCreation) { return $true }
  return [Math]::Abs(($currentCreation - $ExpectedCreation).TotalSeconds) -lt 1
}

function Stop-VerifiedProcessTree($Process, [string]$Label) {
  $processId = [int]$Process.ProcessId
  $creation = Convert-CreationDate $Process
  if (-not $creation) { throw "Не удалось определить время запуска PID $processId ($Label)." }

  $taskKillPath = Join-Path ([Environment]::SystemDirectory) "taskkill.exe"
  $killer = Start-Process -FilePath $taskKillPath -ArgumentList @("/PID", "$processId", "/T", "/F") `
    -WindowStyle Hidden -Wait -PassThru
  if ($killer.ExitCode -ne 0 -and (Test-SameProcessAlive $processId $creation)) {
    throw "Не удалось остановить $Label (PID $processId), taskkill завершился с кодом $($killer.ExitCode)."
  }

  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-Date) -lt $deadline -and (Test-SameProcessAlive $processId $creation)) {
    Start-Sleep -Milliseconds 200
  }
  if (Test-SameProcessAlive $processId $creation) {
    throw "$Label (PID $processId) не завершился после taskkill."
  }
  Write-Host "$Label остановлен (PID $processId)."
}

function Stop-ManagedNode(
  [int]$ProcessId,
  [string]$ScriptName,
  [string]$ExpectedStartedAt = ""
) {
  if ($ProcessId -le 0) { return $false }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
  if (-not $process) { return $false }
  if (-not (Test-ExpectedNodeProcess $process $ScriptName)) {
    Write-Warning "PID $ProcessId не принадлежит ожидаемому $ScriptName и не будет остановлен."
    return $false
  }

  if (-not [string]::IsNullOrWhiteSpace($ExpectedStartedAt)) {
    $expectedStart = [DateTimeOffset]::Parse(
      $ExpectedStartedAt,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::RoundtripKind
    ).ToUniversalTime()
    $actualStart = Convert-CreationDate $process
    if (-not $actualStart -or [Math]::Abs(($actualStart - $expectedStart).TotalSeconds) -gt 60) {
      Write-Warning "PID $ProcessId имеет другое время запуска и не будет остановлен."
      return $false
    }
  }

  Stop-VerifiedProcessTree $process $ScriptName
  return $true
}

function Find-ManagedLauncherAncestor($Process) {
  $parentId = if ($Process) { [int]$Process.ParentProcessId } else { 0 }
  $visited = New-Object Collections.Generic.HashSet[int]
  for ($depth = 0; $depth -lt 12 -and $parentId -gt 0; $depth++) {
    if (-not $visited.Add($parentId)) { break }
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$parentId" -ErrorAction SilentlyContinue
    if (-not $parent) { break }
    if (Test-ExpectedNodeProcess $parent "start-lan-system.js") { return $parent }
    $parentId = [int]$parent.ParentProcessId
  }
  return $null
}

function Stop-ListenerAtPort([int]$Port, [string]$ScriptName) {
  $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $listener) { return $false }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$listener.OwningProcess)" -ErrorAction SilentlyContinue
  if (-not (Test-ExpectedNodeProcess $process $ScriptName)) {
    throw "Порт $Port занят посторонним процессом PID $([int]$listener.OwningProcess); автоматическая остановка отменена."
  }
  $launcher = Find-ManagedLauncherAncestor $process
  if ($launcher) {
    Stop-VerifiedProcessTree $launcher "start-lan-system.js"
  } else {
    Stop-VerifiedProcessTree $process $ScriptName
  }
  return $true
}

function Stop-AllManagedNodeProcesses([string]$ScriptName) {
  $stoppedCount = 0
  for ($attempt = 0; $attempt -lt 32; $attempt++) {
    $process = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
      Where-Object { Test-ExpectedNodeProcess $_ $ScriptName } |
      Select-Object -First 1
    if (-not $process) { return $stoppedCount }
    Stop-VerifiedProcessTree $process $ScriptName
    $stoppedCount++
  }
  throw "Не удалось завершить все процессы $ScriptName после 32 попыток."
}

function Remove-PreviewCleanupLease([string]$LeasePath, [string]$ExpectedContents) {
  if (-not (Test-Path -LiteralPath $LeasePath -PathType Leaf)) { return }
  $currentContents = Get-Content -LiteralPath $LeasePath -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
  if ($currentContents -eq $ExpectedContents) {
    Remove-Item -LiteralPath $LeasePath -Force -ErrorAction Stop
  }
}

function Stop-PreviewCleanupWorker([string]$LeasePath) {
  if ([string]::IsNullOrWhiteSpace($LeasePath)) { return $false }
  $accessibleLeasePath = [IO.Path]::GetFullPath($LeasePath)
  if (-not (Test-Path -LiteralPath $accessibleLeasePath -PathType Leaf)) { return $false }

  $leaseContents = Get-Content -LiteralPath $accessibleLeasePath -Raw -Encoding UTF8
  $lease = $leaseContents | ConvertFrom-Json
  $processId = if ($lease.PSObject.Properties["pid"]) { [int]$lease.pid } else { 0 }
  $startedAt = if ($lease.PSObject.Properties["startedAt"]) { [long]$lease.startedAt } else { 0 }
  if ($processId -le 0 -or $startedAt -le 0) {
    throw "Файл блокировки службы очистки предпросмотров повреждён: $accessibleLeasePath"
  }

  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
  if (-not $process) {
    Remove-PreviewCleanupLease $accessibleLeasePath $leaseContents
    return $false
  }

  $leaseStartedAt = [DateTimeOffset]::FromUnixTimeMilliseconds($startedAt).ToUniversalTime()
  $processStartedAt = Convert-CreationDate $process
  $startDeltaSeconds = if ($processStartedAt) {
    [Math]::Abs(($processStartedAt - $leaseStartedAt).TotalSeconds)
  } else {
    [double]::PositiveInfinity
  }
  if (-not (Test-ExpectedNodeProcess $process "app-server.js") -or $startDeltaSeconds -gt 30) {
    throw "PID $processId из блокировки предпросмотров не прошёл безопасную проверку."
  }

  Stop-VerifiedProcessTree $process "служба очистки предпросмотров"
  Remove-PreviewCleanupLease $accessibleLeasePath $leaseContents
  return $true
}

$status = $null
if (Test-Path -LiteralPath $statusPath -PathType Leaf) {
  $status = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $launcherPid = if ($status.PSObject.Properties["launcherPid"]) { [int]$status.launcherPid } else { 0 }
  $localServerPid = if ($status.PSObject.Properties["localServerPid"]) { [int]$status.localServerPid } else { 0 }
  $appServerPid = if ($status.PSObject.Properties["appServerPid"]) { [int]$status.appServerPid } else { 0 }
  $startedAt = if ($status.PSObject.Properties["startedAt"]) { [string]$status.startedAt } else { "" }
  [void](Stop-ManagedNode $launcherPid "start-lan-system.js" $startedAt)
  [void](Stop-ManagedNode $localServerPid "local-server.js")
  [void](Stop-ManagedNode $appServerPid "app-server.js")
}

foreach ($portAndScript in @(
  @{ Port = 8081; Script = "local-server.js" },
  @{ Port = 19081; Script = "app-server.js" }
)) {
  [void](Stop-ListenerAtPort ([int]$portAndScript.Port) ([string]$portAndScript.Script))
}

# A detached preview cleanup worker does not listen on either server port and
# may use a custom storage root. Exact full script paths let us stop every
# remaining process belonging to this AIS copy without trusting a lease path.
foreach ($scriptName in @("start-lan-system.js", "local-server.js", "app-server.js")) {
  [void](Stop-AllManagedNodeProcesses $scriptName)
}

$previewLeasePath = Join-Path $appRoot "storage\generated-document-previews\.cleanup-worker.lock"
for ($attempt = 0; $attempt -lt 3; $attempt++) {
  [void](Stop-PreviewCleanupWorker $previewLeasePath)
  Start-Sleep -Milliseconds 350
}

# A stale launcher without a usable status file can recreate its servers every five seconds.
# Waiting through one monitor cycle turns that condition into an explicit failure instead of
# reporting a successful stop while the UI silently comes back.
Start-Sleep -Seconds 6
foreach ($port in @(8081, 19081)) {
  $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($listener) {
    throw "АИС не остановлена: порт $port снова открыт процессом PID $([int]$listener.OwningProcess)."
  }
}
foreach ($scriptName in @("start-lan-system.js", "local-server.js", "app-server.js")) {
  $remainingProcess = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { Test-ExpectedNodeProcess $_ $scriptName } |
    Select-Object -First 1
  if ($remainingProcess) {
    throw "АИС не остановлена: процесс $scriptName PID $([int]$remainingProcess.ProcessId) продолжает работать."
  }
}
[void](Stop-PreviewCleanupWorker $previewLeasePath)

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

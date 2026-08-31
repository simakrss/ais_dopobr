[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$AppRoot,
  [string]$MappedDrive = "",
  [string]$MappedTarget = ""
)

$env:PSModulePath = [IO.Path]::Combine($PSHOME, "Modules")
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$utf8 = New-Object Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$resolvedAppRoot = [IO.Path]::GetFullPath($AppRoot)
$launcherPath = [IO.Path]::GetFullPath([IO.Path]::Combine($resolvedAppRoot, "scripts\start-lan-system.js"))
$startupUpdatePath = [IO.Path]::GetFullPath([IO.Path]::Combine($resolvedAppRoot, "scripts\sync-and-deploy-startup.ps1"))
$portableNodePath = [IO.Path]::GetFullPath([IO.Path]::Combine($resolvedAppRoot, ".runtime\node\node.exe"))
$workerLogPath = [IO.Path]::GetFullPath([IO.Path]::Combine($resolvedAppRoot, "tmp\lan-system\worker-launch.log"))
$powerShellPath = Join-Path ([Environment]::SystemDirectory) "WindowsPowerShell\v1.0\powershell.exe"
$programDataRoot = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData)) "AisDopobrWeb"
$workerMutexName = "Global\AisDopobrWeb.InteractiveHost"
$protectedControllerPath = Join-Path $programDataRoot "control-ais-service.ps1"
$sourceControllerPath = [IO.Path]::GetFullPath([IO.Path]::Combine($resolvedAppRoot, "scripts\control-ais-service.ps1"))
$controllerPath = if (Test-Path -LiteralPath $sourceControllerPath -PathType Leaf) {
  $sourceControllerPath
} else {
  $protectedControllerPath
}

function Write-ServiceLog([string]$Source, [string]$Message) {
  $logDirectory = Split-Path -Parent $workerLogPath
  if (-not (Test-Path -LiteralPath $logDirectory -PathType Container)) {
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
  }
  $line = "[{0}] [{1}] {2}{3}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"), $Source, $Message, [Environment]::NewLine
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try {
      $stream = New-Object IO.FileStream(
        $workerLogPath,
        [IO.FileMode]::Append,
        [IO.FileAccess]::Write,
        ([IO.FileShare]::Read -bor [IO.FileShare]::Delete)
      )
      try {
        $bytes = $utf8.GetBytes($line)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush()
      } finally {
        $stream.Dispose()
      }
      return
    } catch [IO.IOException] {
      if ($attempt -ge 39) { throw }
      Start-Sleep -Milliseconds 25
    }
  }
}

function Write-ServiceStep([string]$Message) {
  Write-Host "[Служба АИС] $Message"
  Write-ServiceLog "WORKER" $Message
}

function Write-ServiceOutput([string]$Source, $Value) {
  $message = if ($Value -is [Management.Automation.ErrorRecord]) {
    [string]$Value.Exception.Message
  } else {
    [string]$Value
  }
  if ([string]::IsNullOrWhiteSpace($message)) { return }
  Write-Host $message
  Write-ServiceLog $Source $message
}

function Quote-ProcessArgument([string]$Value) {
  if ($null -eq $Value -or $Value.Length -eq 0) { return '""' }
  if ($Value -notmatch '[\s"]') { return $Value }
  $escaped = [regex]::Replace($Value, '(\\*)"', '${1}${1}\"')
  $escaped = [regex]::Replace($escaped, '(\\+)$', '${1}${1}')
  return '"' + $escaped + '"'
}

function Invoke-HiddenPowerShellScript(
  [string]$ScriptPath,
  [string]$LogSource,
  [string[]]$Arguments = @()
) {
  $argumentValues = @(
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", $ScriptPath
  ) + @($Arguments)
  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $powerShellPath
  $startInfo.Arguments = (@($argumentValues) | ForEach-Object {
    Quote-ProcessArgument ([string]$_)
  }) -join " "
  $startInfo.WorkingDirectory = $resolvedAppRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.StandardOutputEncoding = $utf8
  $startInfo.StandardErrorEncoding = $utf8

  $process = New-Object Diagnostics.Process
  $process.StartInfo = $startInfo
  try {
    if (-not $process.Start()) {
      throw "Не удалось запустить фоновый сценарий: $ScriptPath"
    }
    $standardErrorTask = $process.StandardError.ReadToEndAsync()
    $line = $null
    while ($null -ne ($line = $process.StandardOutput.ReadLine())) {
      Write-ServiceOutput $LogSource $line
    }
    $process.WaitForExit()
    $standardError = $standardErrorTask.GetAwaiter().GetResult()
    foreach ($errorLine in @([regex]::Split([string]$standardError, '\r?\n'))) {
      Write-ServiceOutput $LogSource $errorLine
    }
    return [int]$process.ExitCode
  } finally {
    $process.Dispose()
  }
}

function Ensure-AisTrayVisible {
  if (-not (Test-Path -LiteralPath $controllerPath -PathType Leaf)) {
    throw "Не найден контроллер запуска значка АИС: $controllerPath"
  }
  $trayExitCode = Invoke-HiddenPowerShellScript $controllerPath "TRAY" @(
    "-Action", "Tray", "-SourceAppRoot", $resolvedAppRoot
  )
  if ($trayExitCode -ne 0) {
    throw "Контроллер трея завершился с кодом $trayExitCode."
  }
}

function Test-AisServiceRunning {
  $currentService = Get-Service -Name "AisDopobrWeb" -ErrorAction SilentlyContinue
  return $currentService -and [string]$currentService.Status -in @("Running", "StartPending")
}

function Test-NodeRuntime([string]$Candidate) {
  if ([string]::IsNullOrWhiteSpace($Candidate) -or -not (Test-Path -LiteralPath $Candidate -PathType Leaf)) {
    return $null
  }
  try {
    $version = (& $Candidate --version 2>$null | Select-Object -First 1).Trim()
    $match = [regex]::Match($version, '^v(?<major>\d+)\.')
    if (-not $match.Success -or [int]$match.Groups["major"].Value -lt 20) { return $null }
    return [pscustomobject]@{
      Path = [IO.Path]::GetFullPath($Candidate)
      Version = $version
    }
  } catch {
    return $null
  }
}

function Find-NodeRuntime {
  $candidates = New-Object Collections.Generic.List[string]
  foreach ($candidate in @(
    $env:AIS_NODE_PATH,
    $portableNodePath,
    (Join-Path $env:ProgramFiles "nodejs\node.exe"),
    $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} "nodejs\node.exe" } else { $null })
  )) {
    if (-not [string]::IsNullOrWhiteSpace([string]$candidate)) { $candidates.Add([string]$candidate) }
  }
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command) { $candidates.Add($command.Source) }
  $codexRuntimeRoot = Join-Path $env:USERPROFILE ".cache\codex-runtimes"
  if (Test-Path -LiteralPath $codexRuntimeRoot -PathType Container) {
    $bundled = Get-ChildItem -LiteralPath $codexRuntimeRoot -Filter "node.exe" -File -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match '[\\/]dependencies[\\/]node[\\/]bin[\\/]node\.exe$' } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1 -ExpandProperty FullName
    if ($bundled) { $candidates.Add($bundled) }
  }
  foreach ($candidate in @($candidates | Select-Object -Unique)) {
    $runtime = Test-NodeRuntime $candidate
    if ($runtime) { return $runtime }
  }
  throw "Node.js 20 или новее не найден. Запустите установку службы повторно из интерактивного сеанса."
}

function Find-DockerCli {
  $candidates = New-Object Collections.Generic.List[string]
  foreach ($candidate in @(
    $env:AIS_DOCKER_PATH,
    (Join-Path $env:ProgramFiles "Docker\Docker\resources\bin\docker.exe"),
    (Join-Path $env:LOCALAPPDATA "Docker\resources\bin\docker.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin\docker.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Docker\Docker\resources\bin\docker.exe")
  )) {
    if (-not [string]::IsNullOrWhiteSpace([string]$candidate)) { $candidates.Add([string]$candidate) }
  }
  $command = Get-Command docker.exe -ErrorAction SilentlyContinue
  if ($command) { $candidates.Add($command.Source) }
  return @($candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -Unique) |
    Select-Object -First 1
}

function Test-DockerEngine([string]$DockerPath) {
  if ([string]::IsNullOrWhiteSpace($DockerPath)) { return $false }
  try {
    & $DockerPath info --format "{{.ServerVersion}}" *> $null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

function Find-DockerDesktop {
  foreach ($candidate in @(
    (Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"),
    (Join-Path $env:LOCALAPPDATA "Docker\Docker Desktop.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Docker\Docker\Docker Desktop.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\Docker Desktop.exe")
  )) {
    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      return [IO.Path]::GetFullPath($candidate)
    }
  }
  return $null
}

function Wait-DockerEngine([string]$DockerPath, [int]$TimeoutSeconds = 90) {
  if (Test-DockerEngine $DockerPath) { return $true }
  $desktopPath = Find-DockerDesktop
  if (-not $desktopPath) { return $false }
  if (-not (Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue)) {
    Write-ServiceStep "Запуск Docker Desktop в интерактивном сеансе..."
    Start-Process -FilePath $desktopPath -WorkingDirectory (Split-Path -Parent $desktopPath) `
      -WindowStyle Hidden | Out-Null
  } else {
    Write-ServiceStep "Ожидание готовности Docker Desktop..."
  }
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-DockerEngine $DockerPath) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Ensure-ServiceDriveMapping([string]$Drive, [string]$Target) {
  $driveName = ([string]$Drive).Trim().ToUpperInvariant()
  if (-not $driveName -and -not $Target) { return }
  if ($driveName -notmatch '^[A-Z]:$') { throw "Недопустимое имя служебного диска: $Drive" }
  $targetPath = [IO.Path]::GetFullPath($Target)
  if (-not (Test-Path -LiteralPath $targetPath -PathType Container)) {
    throw "Локальная папка для диска $driveName недоступна: $targetPath"
  }
  $targetDrive = [IO.Path]::GetPathRoot($targetPath).TrimEnd('\')
  $logicalDisk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$targetDrive'" -ErrorAction SilentlyContinue
  if (-not $logicalDisk -or [int]$logicalDisk.DriveType -ne 3) {
    throw "Для служебного диска разрешена только локальная папка NTFS: $targetPath"
  }
  $existing = @(& subst.exe 2>$null) | Where-Object { $_ -match "^$([regex]::Escape($driveName))\\:\s*=>\s*" } | Select-Object -First 1
  if ($existing) {
    $existingTarget = ([regex]::Replace([string]$existing, '^\S+\s*=>\s*', '')).Trim()
    if ([IO.Path]::GetFullPath($existingTarget).TrimEnd('\') -ine $targetPath.TrimEnd('\')) {
      throw "Диск $driveName уже сопоставлен с другой папкой: $existingTarget"
    }
  } elseif (Test-Path -LiteralPath "$driveName\" -PathType Container) {
    Write-ServiceStep "Диск $driveName уже доступен в интерактивном сеансе; текущее сопоставление сохранено."
    return
  } else {
    & subst.exe $driveName $targetPath
    if ($LASTEXITCODE -ne 0) { throw "Не удалось создать служебный диск $driveName для $targetPath" }
  }
  if (-not (Test-Path -LiteralPath "$driveName\" -PathType Container)) {
    throw "Служебный диск $driveName создан, но недоступен."
  }
  Write-ServiceStep "Служебный диск $driveName сопоставлен с $targetPath"
}

$workerMutex = New-Object Threading.Mutex($false, $workerMutexName)
$ownsWorkerMutex = $false
try {
  try {
    $ownsWorkerMutex = $workerMutex.WaitOne(0)
  } catch [Threading.AbandonedMutexException] {
    $ownsWorkerMutex = $true
  }
  if (-not $ownsWorkerMutex) {
    Write-ServiceStep "Другой интерактивный рабочий процесс уже выполняет запуск АИС; повторный экземпляр завершён."
    exit 0
  }

  $service = Get-Service -Name "AisDopobrWeb" -ErrorAction SilentlyContinue
  if (-not $service -or [string]$service.Status -notin @("Running", "StartPending")) {
    Write-Host "[Служба АИС] Интерактивный рабочий процесс не запущен: служба АИС остановлена или не установлена."
    exit 0
  }

Ensure-ServiceDriveMapping $MappedDrive $MappedTarget
if (-not (Test-Path -LiteralPath $resolvedAppRoot -PathType Container)) {
  throw "Папка АИС недоступна интерактивному рабочему процессу: $resolvedAppRoot"
}
if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
  throw "Не найден сценарий запуска АИС: $launcherPath"
}
if (-not (Test-Path -LiteralPath $startupUpdatePath -PathType Leaf)) {
  throw "Не найден сценарий синхронизации GitHub и сайта: $startupUpdatePath"
}
Write-ServiceStep "Проверка значка АИС в системном трее..."
try {
  Ensure-AisTrayVisible
  Write-ServiceStep "Значок АИС запущен в системном трее."
} catch {
  Write-ServiceStep "Значок АИС пока не запущен: $($_.Exception.Message)"
}
Write-ServiceStep "Рабочая папка: $resolvedAppRoot"
Write-ServiceStep "Проверка обновлений GitHub и edu-plus.ru/lms..."
try {
  $syncExitCode = Invoke-HiddenPowerShellScript $startupUpdatePath "UPDATE"
  if ($syncExitCode -ne 0) {
    Write-ServiceStep "Синхронизация завершилась с кодом $syncExitCode. Запуск продолжается на локальной версии."
  }
} catch {
  Write-ServiceStep "Синхронизация сейчас недоступна: $($_.Exception.Message). Запуск продолжается на локальной версии."
}
if (-not (Test-AisServiceRunning)) {
  Write-ServiceStep "Служба остановлена во время обновления; запуск серверов отменён."
  exit 0
}

$nodeRuntime = Find-NodeRuntime
$env:AIS_NODE_PATH = $nodeRuntime.Path
$nodeDirectory = Split-Path -Parent $nodeRuntime.Path
if (-not (($env:Path -split ';') -contains $nodeDirectory)) {
  $env:Path = "$nodeDirectory;$env:Path"
}
Write-ServiceStep "Node.js $($nodeRuntime.Version): $($nodeRuntime.Path)"

$launcherArguments = New-Object Collections.Generic.List[string]
$dockerPath = Find-DockerCli
if ($dockerPath -and (Wait-DockerEngine $dockerPath)) {
  $env:AIS_DOCKER_PATH = [IO.Path]::GetFullPath($dockerPath)
  $dockerDirectory = Split-Path -Parent $env:AIS_DOCKER_PATH
  if (-not (($env:Path -split ';') -contains $dockerDirectory)) {
    $env:Path = "$dockerDirectory;$env:Path"
  }
  Write-ServiceStep "Docker доступен; OCR и OnlyOffice будут проверены штатным сценарием."
} else {
  $launcherArguments.Add("--skip-docker")
  Write-ServiceStep "Docker Desktop пока недоступен. Основной сервер запустится сразу; контейнеры с restart=unless-stopped подключатся после запуска Docker."
}

$env:AIS_SERVICE_MODE = "1"
if (-not (Test-AisServiceRunning)) {
  Write-ServiceStep "Служба остановлена во время подготовки Docker; запуск серверов отменён."
  exit 0
}
Write-ServiceStep "Запуск фонового супервизора АИС..."
$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
  & $nodeRuntime.Path $launcherPath @launcherArguments 2>&1 |
    ForEach-Object { Write-ServiceOutput "AIS" $_ }
  $exitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousErrorActionPreference
}
  Write-ServiceStep "Фоновый супервизор завершён с кодом $exitCode."
  exit $exitCode
} finally {
  if ($ownsWorkerMutex) {
    try {
      $workerMutex.ReleaseMutex()
    } catch [ApplicationException] {
      # The process no longer owns the mutex; disposal is still safe.
    }
  }
  $workerMutex.Dispose()
}

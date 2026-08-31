[CmdletBinding()]
param(
  [ValidateSet("Start", "Stop", "Restart", "Status", "Open", "Log", "Tray", "Install", "Uninstall")]
  [string]$Action = "Status",
  [switch]$InstallIfMissing,
  [switch]$OpenBrowser,
  [switch]$ShowTray,
  [switch]$AsJson,
  [switch]$Elevated,
  [string]$InteractiveUser = "",
  [string]$SourceAppRoot = "",
  [ValidateRange(5, 600)]
  [int]$TimeoutSeconds = 600
)

$trustedModulePaths = New-Object Collections.Generic.List[string]
foreach ($modulePath in @(
  [IO.Path]::Combine($PSHOME, "Modules"),
  [IO.Path]::Combine([Environment]::SystemDirectory, "WindowsPowerShell\v1.0\Modules")
)) {
  if (
    -not [string]::IsNullOrWhiteSpace($modulePath) -and
    (Test-Path -LiteralPath $modulePath -PathType Container) -and
    -not $trustedModulePaths.Contains($modulePath)
  ) {
    $trustedModulePaths.Add($modulePath)
  }
}
$env:PSModulePath = @($trustedModulePaths) -join [IO.Path]::PathSeparator
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$utf8 = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

$serviceName = "AisDopobrWeb"
$trayTaskName = "AisDopobrServiceTray"
$workerTaskName = "AisDopobrInteractiveHost"
$commonProgramData = [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData)
$systemDirectory = [Environment]::SystemDirectory
$programDataRoot = [IO.Path]::GetFullPath((Join-Path $commonProgramData "AisDopobrWeb"))
$serviceConfigPath = Join-Path $programDataRoot "service-config.json"
$protectedStopPath = Join-Path $programDataRoot "stop-lan-system.ps1"
$protectedTrayPath = Join-Path $programDataRoot "ais-service-tray.ps1"
$powerShellPath = Join-Path $systemDirectory "WindowsPowerShell\v1.0\powershell.exe"
$runningFromProtectedRoot = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') -ieq $programDataRoot.TrimEnd('\')
$installedConfig = $null
if ($runningFromProtectedRoot -and (Test-Path -LiteralPath $serviceConfigPath -PathType Leaf)) {
  try {
    $installedConfig = Get-Content -LiteralPath $serviceConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    throw "Защищённая конфигурация службы повреждена: $($_.Exception.Message)"
  }
}
$scriptAppRoot = if ($runningFromProtectedRoot -and $installedConfig -and
  $installedConfig.PSObject.Properties["serviceAppRoot"]) {
  [IO.Path]::GetFullPath([string]$installedConfig.serviceAppRoot)
} else {
  Split-Path -Parent $PSScriptRoot
}
$appRoot = if ([string]::IsNullOrWhiteSpace($SourceAppRoot)) {
  $scriptAppRoot
} else {
  [IO.Path]::GetFullPath($SourceAppRoot)
}
$workerLogPath = [IO.Path]::GetFullPath([IO.Path]::Combine($appRoot, "tmp\lan-system\worker-launch.log"))
$trayReadyPath = [IO.Path]::GetFullPath([IO.Path]::Combine($appRoot, "tmp\lan-system\tray-ready.json"))
$installerPath = Join-Path $PSScriptRoot "setup-ais-windows-service.ps1"
$trayPath = if ($runningFromProtectedRoot -and (Test-Path -LiteralPath $protectedTrayPath -PathType Leaf)) {
  $protectedTrayPath
} else {
  Join-Path $PSScriptRoot "ais-service-tray.ps1"
}
$logViewerPath = Join-Path $PSScriptRoot "show-ais-service-log.ps1"
$legacyStopPath = Join-Path $PSScriptRoot "stop-lan-system.ps1"
$localUrl = "http://127.0.0.1:8081/"
$healthUrl = "http://127.0.0.1:8081/api/health"
$interactiveUserName = if ([string]::IsNullOrWhiteSpace($InteractiveUser)) {
  [Security.Principal.WindowsIdentity]::GetCurrent().Name
} else {
  $InteractiveUser.Trim()
}

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Quote-ProcessArgument([string]$Value) {
  if ($null -eq $Value -or $Value.Length -eq 0) { return '""' }
  if ($Value -notmatch '[\s"]') { return $Value }
  $escaped = [regex]::Replace($Value, '(\\*)"', '${1}${1}\"')
  $escaped = [regex]::Replace($escaped, '(\\+)$', '${1}${1}')
  return '"' + $escaped + '"'
}

function Resolve-ElevationSafePath([string]$PathValue) {
  $fullPath = [IO.Path]::GetFullPath($PathValue)
  $root = [IO.Path]::GetPathRoot($fullPath)
  if ([string]::IsNullOrWhiteSpace($root)) { return $fullPath }
  $driveName = $root.TrimEnd('\')
  $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$driveName'" -ErrorAction SilentlyContinue
  if (-not $disk -or [int]$disk.DriveType -ne 4) { return $fullPath }

  $mapping = Get-SmbMapping -LocalPath $driveName -ErrorAction SilentlyContinue | Select-Object -First 1
  $remotePath = if ($mapping) { [string]$mapping.RemotePath } else { [string]$disk.ProviderName }
  $relativePath = $fullPath.Substring($root.Length)
  $remoteMatch = [regex]::Match($remotePath, '^\\\\(?<server>[^\\]+)\\(?<share>[^\\]+)\\?$')
  if ($remoteMatch.Success) {
    $serverName = $remoteMatch.Groups["server"].Value
    $localNames = @($env:COMPUTERNAME, "localhost", ".")
    if ($localNames -contains $serverName) {
      $shareName = $remoteMatch.Groups["share"].Value
      $share = Get-CimInstance Win32_Share -Filter "Name='$($shareName.Replace("'", "''"))'" -ErrorAction SilentlyContinue |
        Select-Object -First 1
      if ($share -and -not [string]::IsNullOrWhiteSpace([string]$share.Path)) {
        return [IO.Path]::GetFullPath((Join-Path ([string]$share.Path) $relativePath))
      }
    }
  }
  return Join-Path $remotePath $relativePath
}

function Get-ControlElevationArguments {
  $arguments = New-Object Collections.Generic.List[string]
  $arguments.Add("-NoLogo")
  $arguments.Add("-NoProfile")
  $arguments.Add("-ExecutionPolicy")
  $arguments.Add("Bypass")
  $arguments.Add("-File")
  $arguments.Add((Resolve-ElevationSafePath $PSCommandPath))
  $arguments.Add("-Action")
  $arguments.Add($Action)
  $arguments.Add("-TimeoutSeconds")
  $arguments.Add([string]$TimeoutSeconds)
  $arguments.Add("-Elevated")
  $arguments.Add("-InteractiveUser")
  $arguments.Add($interactiveUserName)
  $arguments.Add("-SourceAppRoot")
  $arguments.Add($appRoot)
  if ($InstallIfMissing) { $arguments.Add("-InstallIfMissing") }
  if ($OpenBrowser) { $arguments.Add("-OpenBrowser") }
  if ($ShowTray) { $arguments.Add("-ShowTray") }
  if ($AsJson) { $arguments.Add("-AsJson") }
  return @($arguments)
}

function Wait-AisProcessWithProgress(
  [Diagnostics.Process]$Process,
  [string]$OperationName,
  [int]$ProgressIntervalSeconds = 5
) {
  $startedAt = Get-Date
  $nextProgressAt = $startedAt.AddSeconds($ProgressIntervalSeconds)
  try {
    while (-not $Process.HasExited) {
      $now = Get-Date
      if ($now -ge $nextProgressAt) {
        $elapsedSeconds = [Math]::Max(0, [int][Math]::Floor(($now - $startedAt).TotalSeconds))
        Write-Host "[Ожидание] $OperationName — прошло $elapsedSeconds сек."
        $nextProgressAt = $now.AddSeconds($ProgressIntervalSeconds)
      }
      Start-Sleep -Milliseconds 250
      $Process.Refresh()
    }
    return [int]$Process.ExitCode
  } finally {
    $Process.Dispose()
  }
}

function Invoke-ElevatedControl {
  $argumentLine = (Get-ControlElevationArguments | ForEach-Object { Quote-ProcessArgument $_ }) -join " "
  $process = Start-Process -FilePath $powerShellPath -ArgumentList $argumentLine `
    -Verb RunAs -WindowStyle Hidden -PassThru
  $exitCode = Wait-AisProcessWithProgress $process "Выполняется команда с правами администратора"
  exit $exitCode
}

function Get-AisService {
  return Get-Service -Name $serviceName -ErrorAction SilentlyContinue
}

function Test-AisHealth {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 2
    if ($response.StatusCode -ne 200) { return $false }
    $payload = $response.Content | ConvertFrom-Json
    return [bool]$payload.ok
  } catch {
    return $false
  }
}

function Get-AisStartupLogOffset {
  try {
    if (Test-Path -LiteralPath $workerLogPath -PathType Leaf) {
      return [long](Get-Item -LiteralPath $workerLogPath -Force).Length
    }
  } catch { }
  return [long]0
}

function Write-AisStartupLogProgress([ref]$Offset) {
  $stream = $null
  $reader = $null
  $text = ""
  try {
    if (-not (Test-Path -LiteralPath $workerLogPath -PathType Leaf)) { return }
    $stream = [IO.FileStream]::new(
      $workerLogPath,
      [IO.FileMode]::Open,
      [IO.FileAccess]::Read,
      ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
    )
    $position = [long]$Offset.Value
    if ($position -lt 0 -or $position -gt $stream.Length) { $position = 0 }
    [void]$stream.Seek($position, [IO.SeekOrigin]::Begin)
    $reader = [IO.StreamReader]::new($stream, $utf8, $true, 4096, $true)
    $text = $reader.ReadToEnd()
    $Offset.Value = [long]$stream.Position
  } catch {
    return
  } finally {
    if ($null -ne $reader) { try { $reader.Dispose() } catch { } }
    if ($null -ne $stream) { try { $stream.Dispose() } catch { } }
  }

  foreach ($line in @([regex]::Split([string]$text, '\r?\n'))) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $match = [regex]::Match($line, '^\[[^\]]+\]\s+\[(?<source>[^\]]+)\]\s+(?<message>.*)$')
    if (-not $match.Success) {
      Write-Host $line
      continue
    }
    $source = $match.Groups["source"].Value
    $message = $match.Groups["message"].Value
    $message = [regex]::Replace($message, '^\[(?:Обновление|Служба АИС)\]\s*', '')
    $label = switch ($source) {
      "WORKER" { "Запуск" }
      "UPDATE" { "Обновление" }
      "AIS" { "Компоненты" }
      default { $source }
    }
    Write-Host "[$label] $message"
  }
}

function Test-AisPortListener([int]$Port) {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -First 1)
}

function Get-AisManagedNodeProcesses {
  $roots = New-Object Collections.Generic.List[string]
  $roots.Add([IO.Path]::GetFullPath($appRoot))
  if (Test-Path -LiteralPath $serviceConfigPath -PathType Leaf) {
    try {
      $serviceConfig = Get-Content -LiteralPath $serviceConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
      foreach ($propertyName in @("sourceAppRoot", "serviceAppRoot")) {
        if ($serviceConfig.PSObject.Properties[$propertyName]) {
          $candidate = [string]$serviceConfig.$propertyName
          if (-not [string]::IsNullOrWhiteSpace($candidate)) {
            $candidate = [IO.Path]::GetFullPath($candidate)
            if (-not $roots.Contains($candidate)) { $roots.Add($candidate) }
          }
        }
      }
    } catch {
      Write-Warning "Не удалось прочитать конфигурацию службы для проверки процессов: $($_.Exception.Message)"
    }
  }
  $expectedPaths = @($roots | ForEach-Object {
    $rootPath = $_
    @("scripts\start-lan-system.js", "app-server.js", "local-server.js") | ForEach-Object {
      [IO.Path]::GetFullPath([IO.Path]::Combine($rootPath, $_)).Replace("/", "\").ToLowerInvariant()
    }
  } | Select-Object -Unique)
  return @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $commandLine = ([string]$_.CommandLine).Replace("/", "\").ToLowerInvariant()
    @($expectedPaths | Where-Object {
      $commandLine.IndexOf($_, [StringComparison]::OrdinalIgnoreCase) -ge 0
    }).Count -gt 0
  })
}

function Get-AisStopResidue {
  return [pscustomobject]@{
    Ports = @(@(8081, 19081) | Where-Object { Test-AisPortListener $_ })
    Processes = @(Get-AisManagedNodeProcesses)
  }
}

function Invoke-AisProtectedCleanup {
  if (-not (Test-Path -LiteralPath $protectedStopPath -PathType Leaf)) {
    throw "Защищённый сценарий остановки службы не найден: $protectedStopPath"
  }
  $cleanupAppRoot = [IO.Path]::GetFullPath($appRoot)
  if (Test-Path -LiteralPath $serviceConfigPath -PathType Leaf) {
    $serviceConfig = Get-Content -LiteralPath $serviceConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($serviceConfig.PSObject.Properties["serviceAppRoot"]) {
      $configuredRoot = [string]$serviceConfig.serviceAppRoot
      if (-not [string]::IsNullOrWhiteSpace($configuredRoot)) {
        $cleanupAppRoot = [IO.Path]::GetFullPath($configuredRoot)
      }
    }
  }
  & $powerShellPath -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass `
    -File $protectedStopPath -KeepDocker -AppRoot $cleanupAppRoot
  if ($LASTEXITCODE -ne 0) {
    throw "Повторная очистка процессов АИС завершилась с кодом $LASTEXITCODE."
  }
}

function Wait-ServiceState([string]$State, [int]$Timeout = 60) {
  $service = Get-AisService
  if (-not $service) { throw "Служба АИС не установлена." }
  $targetStatus = [Enum]::Parse([System.ServiceProcess.ServiceControllerStatus], $State, $true)
  $service.WaitForStatus($targetStatus, [TimeSpan]::FromSeconds($Timeout))
  $service.Refresh()
  if ([string]$service.Status -ne $State) {
    throw "Служба не перешла в состояние $State за $Timeout сек."
  }
}

function Request-AisWorkerStart {
  if (Test-AisHealth) { return $true }
  $workerTask = Get-ScheduledTask -TaskName $workerTaskName -ErrorAction SilentlyContinue
  if (-not $workerTask) {
    Write-Warning "Не найдена фоновая задача $workerTaskName. Служба установлена неполностью."
    return $false
  }
  if ([string]$workerTask.State -eq "Running") {
    Write-Host "Рабочий процесс АИС уже выполняется."
    return $true
  }
  Write-Host "Запуск рабочего процесса АИС..."
  try {
    Start-ScheduledTask -TaskName $workerTaskName -ErrorAction Stop
    return $true
  } catch {
    Write-Warning "Не удалось немедленно запустить рабочий процесс: $($_.Exception.Message)"
    return $false
  }
}

function Wait-AisHealth([int]$Timeout, [ref]$LogOffset) {
  $startedAt = Get-Date
  $deadline = (Get-Date).AddSeconds($Timeout)
  $nextProgressAt = $startedAt.AddSeconds(5)
  while ((Get-Date) -lt $deadline) {
    Write-AisStartupLogProgress $LogOffset
    if (Test-AisHealth) {
      Write-AisStartupLogProgress $LogOffset
      return $true
    }
    $service = Get-AisService
    if (-not $service) { return $false }
    $service.Refresh()
    if ($service.Status -eq [System.ServiceProcess.ServiceControllerStatus]::Stopped) {
      Write-AisStartupLogProgress $LogOffset
      return $false
    }
    $now = Get-Date
    if ($now -ge $nextProgressAt) {
      $workerTask = Get-ScheduledTask -TaskName $workerTaskName -ErrorAction SilentlyContinue
      $workerState = if ($workerTask) { [string]$workerTask.State } else { "не найдена" }
      $elapsedSeconds = [Math]::Max(0, [int][Math]::Floor(($now - $startedAt).TotalSeconds))
      Write-Host (
        "[Ожидание] Прошло {0} сек. Служба: {1}; рабочий процесс: {2}; локальный сайт ещё запускается." -f
        $elapsedSeconds, [string]$service.Status, $workerState
      )
      $nextProgressAt = $now.AddSeconds(5)
    }
    Start-Sleep -Milliseconds 800
  }
  Write-AisStartupLogProgress $LogOffset
  return $false
}

function Open-AisBrowser {
  Write-Host "Открытие АИС в браузере: $localUrl"
  Start-Process $localUrl | Out-Null
}

function Get-AisTrayProcess([int]$ExpectedProcessId = 0) {
  $expectedTrayPath = [IO.Path]::GetFullPath($trayPath).Replace("/", "\").ToLowerInvariant()
  return @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      ($ExpectedProcessId -le 0 -or [int]$_.ProcessId -eq $ExpectedProcessId) -and
      ([string]$_.CommandLine).Replace("/", "\").ToLowerInvariant().IndexOf(
        $expectedTrayPath,
        [StringComparison]::OrdinalIgnoreCase
      ) -ge 0
    } | Select-Object -First 1)
}

function Test-AisTrayReady([bool]$RequireRunning) {
  if (Test-Path -LiteralPath $trayReadyPath -PathType Leaf) {
    try {
      $marker = Get-Content -LiteralPath $trayReadyPath -Raw -Encoding UTF8 | ConvertFrom-Json
      $trayProcessId = [int]$marker.processId
      $trayProcess = Get-AisTrayProcess $trayProcessId
      if ($trayProcess -and (-not $RequireRunning -or [string]$marker.state -eq "running")) {
        return $true
      }
    } catch { }
  }

  # Compatibility with a tray instance installed before the ready marker existed.
  $legacyProcess = Get-AisTrayProcess
  if (-not $legacyProcess) { return $false }
  try {
    $createdAt = [DateTime]$legacyProcess.CreationDate
    if (((Get-Date) - $createdAt).TotalSeconds -lt 1) { return $false }
  } catch {
    return $false
  }
  return (-not $RequireRunning) -or (Test-AisHealth)
}

function Wait-AisTrayReady([bool]$RequireRunning, [int]$Timeout = 20) {
  $startedAt = Get-Date
  $deadline = (Get-Date).AddSeconds($Timeout)
  $nextProgressAt = $startedAt.AddSeconds(5)
  while ((Get-Date) -lt $deadline) {
    if (Test-AisTrayReady $RequireRunning) { return $true }
    $now = Get-Date
    if ($now -ge $nextProgressAt) {
      $elapsedSeconds = [Math]::Max(0, [int][Math]::Floor(($now - $startedAt).TotalSeconds))
      Write-Host "[Ожидание] Подготовка значка в трее — прошло $elapsedSeconds сек."
      $nextProgressAt = $now.AddSeconds(5)
    }
    Start-Sleep -Milliseconds 200
  }
  return $false
}

function Stop-IncompatibleAisTrayProcesses {
  $expectedTrayPath = [IO.Path]::GetFullPath($trayPath).Replace("/", "\").ToLowerInvariant()
  $readyProcessId = 0
  if (Test-Path -LiteralPath $trayReadyPath -PathType Leaf) {
    try {
      $marker = Get-Content -LiteralPath $trayReadyPath -Raw -Encoding UTF8 | ConvertFrom-Json
      $readyProcessId = [int]$marker.processId
    } catch { }
  }
  $trayProcesses = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      ([string]$_.CommandLine).Replace("/", "\").ToLowerInvariant().IndexOf(
        "ais-service-tray.ps1",
        [StringComparison]::OrdinalIgnoreCase
      ) -ge 0
    })
  foreach ($process in $trayProcesses) {
    $commandLine = ([string]$process.CommandLine).Replace("/", "\").ToLowerInvariant()
    $isCurrent = $commandLine.IndexOf($expectedTrayPath, [StringComparison]::OrdinalIgnoreCase) -ge 0
    if ($isCurrent -and [int]$process.ProcessId -eq $readyProcessId) { continue }
    try {
      Write-Host "Завершение устаревшего процесса значка АИС (PID $($process.ProcessId))..."
      Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop
    } catch {
      Write-Warning "Не удалось завершить устаревший процесс значка: $($_.Exception.Message)"
    }
  }
}

function Start-AisTrayDirect {
  Stop-IncompatibleAisTrayProcesses
  $argumentLine = @(
    "-NoLogo", "-NoProfile", "-STA", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-WindowStyle", "Hidden", "-File", $trayPath, "-AppRoot", $appRoot
  ) | ForEach-Object { Quote-ProcessArgument $_ }
  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $powerShellPath
  $startInfo.Arguments = $argumentLine -join " "
  $startInfo.WorkingDirectory = $appRoot
  # Detach the long-lived tray from redirected controller output streams.
  $startInfo.UseShellExecute = $true
  $startInfo.CreateNoWindow = $true
  $startInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
  $trayProcess = [Diagnostics.Process]::Start($startInfo)
  if ($null -eq $trayProcess) { throw "Не удалось запустить значок АИС в трее." }
  $trayProcess.Dispose()
}

function Start-AisTray([bool]$RequireRunning = $false) {
  if (-not (Test-Path -LiteralPath $trayPath -PathType Leaf)) {
    throw "Не найден контроллер трея: $trayPath"
  }
  Write-Host "Запуск значка АИС в системном трее..."
  $task = Get-ScheduledTask -TaskName $trayTaskName -ErrorAction SilentlyContinue
  $trayStartRequested = $false
  if ($task) {
    try {
      Start-ScheduledTask -TaskName $trayTaskName -ErrorAction Stop
      $trayStartRequested = $true
    } catch {
      Write-Warning "Планировщик не разрешил ручной запуск иконки; запускается защищённая копия в текущем сеансе."
    }
  }
  if ($trayStartRequested -and (Wait-AisTrayReady $RequireRunning 8)) {
    Write-Host "Значок АИС готов в системном трее."
    return
  }
  if ($trayStartRequested) {
    Write-Warning "Задача планировщика не подготовила значок; выполняется прямой запуск актуальной версии."
    Stop-ScheduledTask -TaskName $trayTaskName -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
  }
  Start-AisTrayDirect
  if (-not (Wait-AisTrayReady $RequireRunning)) {
    throw "Значок АИС не появился в системном трее за отведённое время."
  }
  Write-Host "Значок АИС готов в системном трее."
}

function Show-AisLogTerminal {
  if (-not (Test-Path -LiteralPath $logViewerPath -PathType Leaf)) {
    throw "Не найден сценарий просмотра журнала: $logViewerPath"
  }
  $argumentLine = @(
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $logViewerPath, "-AppRoot", $appRoot
  ) | ForEach-Object { Quote-ProcessArgument $_ }
  Start-Process -FilePath $powerShellPath -ArgumentList ($argumentLine -join " ") -WorkingDirectory $appRoot | Out-Null
}

function Install-AisService {
  if ($runningFromProtectedRoot) {
    throw "Для переустановки службы запустите установщик из папки дистрибутива АИС."
  }
  if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
    throw "Не найден установщик службы: $installerPath"
  }
  $elevationInstallerPath = Resolve-ElevationSafePath $installerPath
  $elevationAppRoot = Resolve-ElevationSafePath $scriptAppRoot
  $arguments = @(
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $elevationInstallerPath,
    "-Action", "Install", "-AppRoot", $elevationAppRoot, "-InteractiveAppRoot", $appRoot,
    "-InteractiveUser", $interactiveUserName, "-StartService", "-StartTray"
  )
  if (Test-IsAdministrator) {
    & $powerShellPath @arguments
    if ($LASTEXITCODE -ne 0) { throw "Установка службы завершилась с кодом $LASTEXITCODE." }
  } else {
    $argumentLine = ($arguments | ForEach-Object { Quote-ProcessArgument $_ }) -join " "
    $process = Start-Process -FilePath $powerShellPath -ArgumentList $argumentLine `
      -Verb RunAs -WindowStyle Hidden -PassThru
    $exitCode = Wait-AisProcessWithProgress $process "Установка и настройка службы АИС"
    if ($exitCode -ne 0) { throw "Установка службы завершилась с кодом $exitCode." }
  }
}

function Uninstall-AisService {
  if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
    throw "Не найден защищённый установщик службы: $installerPath"
  }
  $elevationInstallerPath = Resolve-ElevationSafePath $installerPath
  $elevationAppRoot = Resolve-ElevationSafePath $scriptAppRoot
  $arguments = @(
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $elevationInstallerPath,
    "-Action", "Uninstall", "-AppRoot", $elevationAppRoot, "-InteractiveAppRoot", $appRoot,
    "-InteractiveUser", $interactiveUserName
  )
  if (Test-IsAdministrator) {
    & $powerShellPath @arguments
    if ($LASTEXITCODE -ne 0) { throw "Удаление службы завершилось с кодом $LASTEXITCODE." }
  } else {
    $argumentLine = ($arguments | ForEach-Object { Quote-ProcessArgument $_ }) -join " "
    $process = Start-Process -FilePath $powerShellPath -ArgumentList $argumentLine `
      -Verb RunAs -WindowStyle Hidden -PassThru
    $exitCode = Wait-AisProcessWithProgress $process "Удаление службы АИС"
    if ($exitCode -ne 0) { throw "Удаление службы завершилось с кодом $exitCode." }
  }
}

function Start-AisService {
  $startupLogOffset = Get-AisStartupLogOffset
  $service = Get-AisService
  $serviceWasPresent = [bool]$service
  if (-not $service) {
    if (-not $InstallIfMissing) { throw "Служба АИС не установлена. Запустите установщик службы." }
    Install-AisService
    $service = Get-AisService
    if (-not $service) { throw "Служба не появилась после установки." }
  }
  $workerTask = Get-ScheduledTask -TaskName $workerTaskName -ErrorAction SilentlyContinue
  $trayTask = Get-ScheduledTask -TaskName $trayTaskName -ErrorAction SilentlyContinue
  if ((-not $workerTask -or -not $trayTask) -and $serviceWasPresent -and $InstallIfMissing) {
    $missingTasks = @(
      $(if (-not $workerTask) { $workerTaskName }),
      $(if (-not $trayTask) { $trayTaskName })
    ) | Where-Object { $_ }
    Write-Host "Отсутствуют задачи автозапуска: $($missingTasks -join ', '). Выполняется восстановление установки АИС."
    Install-AisService
    $service = Get-AisService
    $workerTask = Get-ScheduledTask -TaskName $workerTaskName -ErrorAction SilentlyContinue
    $trayTask = Get-ScheduledTask -TaskName $trayTaskName -ErrorAction SilentlyContinue
  }
  if (-not $workerTask) {
    throw "Не найдена фоновая задача $workerTaskName. Переустановите службу АИС через этот BAT-файл."
  }
  if (-not $trayTask) {
    Write-Warning "Не найдена задача автозапуска $trayTaskName. Значок будет запущен напрямую в текущем сеансе."
  }
  $service.Refresh()
  if ($service.Status -eq [System.ServiceProcess.ServiceControllerStatus]::StopPending) {
    Wait-ServiceState "Stopped" 90
    $service.Refresh()
  }
  if ($service.Status -eq [System.ServiceProcess.ServiceControllerStatus]::Stopped) {
    Write-Host "Запуск службы АИС..."
    Start-Service -Name $serviceName
  }
  Wait-ServiceState "Running" 60
  [void](Request-AisWorkerStart)
  Write-Host "Служба запущена. Ожидание готовности локального адреса..."
  Write-Host "Ход запуска GitHub, FTP, Docker и серверов будет показан в этом окне."
  if (-not (Wait-AisHealth $TimeoutSeconds ([ref]$startupLogOffset))) {
    throw "Служба работает, но АИС не ответила на $healthUrl за $TimeoutSeconds сек. Откройте окно журнала запуска."
  }
  Write-Host "АИС готова: $localUrl"
}

function Stop-AisService {
  $service = Get-AisService
  if (-not $service) {
    if (Test-Path -LiteralPath $legacyStopPath -PathType Leaf) {
      Write-Host "Служба не установлена; останавливается прежний локальный запуск с сохранением Docker."
      & $powerShellPath -NoLogo -NoProfile -ExecutionPolicy Bypass -File $legacyStopPath -KeepDocker
      if ($LASTEXITCODE -ne 0) { throw "Прежний запуск не удалось остановить." }
    }
    return
  }
  $service.Refresh()
  if ($service.Status -eq [System.ServiceProcess.ServiceControllerStatus]::StartPending) {
    Wait-ServiceState "Running" 120
    $service.Refresh()
  }
  if ($service.Status -eq [System.ServiceProcess.ServiceControllerStatus]::StopPending) {
    Wait-ServiceState "Stopped" 240
    $service.Refresh()
  }
  if ($service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped) {
    Write-Host "Остановка службы АИС..."
    Stop-Service -Name $serviceName
    Wait-ServiceState "Stopped" 240
  }
  Stop-ScheduledTask -TaskName $workerTaskName -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
  $residue = Get-AisStopResidue
  if ($residue.Ports.Count -gt 0 -or $residue.Processes.Count -gt 0) {
    Write-Host "Обнаружены оставшиеся компоненты АИС; выполняется повторная защищённая очистка..."
    Invoke-AisProtectedCleanup
    Start-Sleep -Milliseconds 500
    $residue = Get-AisStopResidue
  }
  if ($residue.Ports.Count -gt 0 -or $residue.Processes.Count -gt 0) {
    $details = New-Object Collections.Generic.List[string]
    if ($residue.Ports.Count -gt 0) { $details.Add("порты $($residue.Ports -join ', ')") }
    if ($residue.Processes.Count -gt 0) {
      $details.Add("процессы PID $(@($residue.Processes.ProcessId) -join ', ')")
    }
    throw "Служба Windows остановлена, но компоненты АИС ещё работают ($($details -join '; ')). Откройте окно журнала запуска."
  }
  Write-Host "Служба остановлена. Контейнеры Docker оставлены работающими."
}

switch ($Action) {
  "Install" {
    Install-AisService
  }
  "Uninstall" {
    Uninstall-AisService
  }
  "Start" {
    Start-AisService
    Start-AisTray $true
    if ($OpenBrowser) { Open-AisBrowser }
  }
  "Stop" {
    Stop-AisService
  }
  "Restart" {
    Stop-AisService
    Start-AisService
    Start-AisTray $true
    if ($OpenBrowser) { Open-AisBrowser }
  }
  "Open" {
    Open-AisBrowser
  }
  "Log" {
    Show-AisLogTerminal
  }
  "Tray" {
    Start-AisTray
  }
  "Status" {
    $service = Get-AisService
    $workerTask = Get-ScheduledTask -TaskName $workerTaskName -ErrorAction SilentlyContinue
    $workerInfo = if ($workerTask) {
      Get-ScheduledTaskInfo -TaskName $workerTaskName -ErrorAction SilentlyContinue
    } else { $null }
    $healthy = Test-AisHealth
    $payload = [ordered]@{
      installed = [bool]$service
      serviceName = $serviceName
      serviceStatus = if ($service) { [string]$service.Status } else { "NotInstalled" }
      workerTaskName = $workerTaskName
      workerTaskState = if ($workerTask) { [string]$workerTask.State } else { "NotInstalled" }
      workerLastResult = if ($workerInfo) { [long]$workerInfo.LastTaskResult } else { $null }
      healthy = $healthy
      localUrl = $localUrl
      state = if (-not $service) {
        "not-installed"
      } elseif ($service.Status -eq [System.ServiceProcess.ServiceControllerStatus]::Running -and $healthy) {
        "running"
      } elseif ($service.Status -in @(
        [System.ServiceProcess.ServiceControllerStatus]::Running,
        [System.ServiceProcess.ServiceControllerStatus]::StartPending,
        [System.ServiceProcess.ServiceControllerStatus]::ContinuePending
      )) {
        "starting"
      } elseif ($service.Status -eq [System.ServiceProcess.ServiceControllerStatus]::Stopped) {
        "stopped"
      } else {
        "attention"
      }
    }
    if ($AsJson) {
      $payload | ConvertTo-Json -Compress
    } else {
      Write-Host "Служба: $($payload.serviceStatus)"
      Write-Host "Локальная АИС: $(if ($healthy) { 'доступна' } else { 'не отвечает' })"
      Write-Host "Адрес: $localUrl"
    }
  }
}

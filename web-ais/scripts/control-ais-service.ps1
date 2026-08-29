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
  [int]$TimeoutSeconds = 240
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$utf8 = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

$serviceName = "AisDopobrWeb"
$trayTaskName = "AisDopobrServiceTray"
$workerTaskName = "AisDopobrInteractiveHost"
$scriptAppRoot = Split-Path -Parent $PSScriptRoot
$appRoot = if ([string]::IsNullOrWhiteSpace($SourceAppRoot)) {
  $scriptAppRoot
} else {
  [IO.Path]::GetFullPath($SourceAppRoot)
}
$installerPath = Join-Path $PSScriptRoot "setup-ais-windows-service.ps1"
$trayPath = Join-Path $PSScriptRoot "ais-service-tray.ps1"
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
  if ($null -eq $Value) { return '""' }
  return '"' + $Value.Replace('"', '\"') + '"'
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

function Invoke-ElevatedControl {
  $argumentLine = (Get-ControlElevationArguments | ForEach-Object { Quote-ProcessArgument $_ }) -join " "
  $process = Start-Process -FilePath "powershell.exe" -ArgumentList $argumentLine `
    -Verb RunAs -Wait -PassThru
  exit $process.ExitCode
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

function Wait-AisHealth([int]$Timeout) {
  $deadline = (Get-Date).AddSeconds($Timeout)
  while ((Get-Date) -lt $deadline) {
    if (Test-AisHealth) { return $true }
    $service = Get-AisService
    if (-not $service) { return $false }
    $service.Refresh()
    if ($service.Status -eq [System.ServiceProcess.ServiceControllerStatus]::Stopped) { return $false }
    Start-Sleep -Milliseconds 800
  }
  return $false
}

function Open-AisBrowser {
  Start-Process $localUrl | Out-Null
}

function Start-AisTray {
  if (-not (Test-Path -LiteralPath $trayPath -PathType Leaf)) {
    throw "Не найден контроллер трея: $trayPath"
  }
  $task = Get-ScheduledTask -TaskName $trayTaskName -ErrorAction SilentlyContinue
  if ($task) {
    Start-ScheduledTask -TaskName $trayTaskName
    return
  }
  $argumentLine = @(
    "-NoLogo", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", $trayPath
  ) | ForEach-Object { Quote-ProcessArgument $_ }
  Start-Process -FilePath "powershell.exe" -ArgumentList ($argumentLine -join " ") -WindowStyle Hidden | Out-Null
}

function Start-AisInteractiveWorker {
  $task = Get-ScheduledTask -TaskName $workerTaskName -ErrorAction SilentlyContinue
  if (-not $task) {
    throw "Интерактивная задача АИС не зарегистрирована. Повторите установку службы."
  }
  Start-ScheduledTask -TaskName $workerTaskName
}

function Show-AisLogTerminal {
  if (-not (Test-Path -LiteralPath $logViewerPath -PathType Leaf)) {
    throw "Не найден сценарий просмотра журнала: $logViewerPath"
  }
  $argumentLine = @(
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $logViewerPath, "-AppRoot", $appRoot
  ) | ForEach-Object { Quote-ProcessArgument $_ }
  Start-Process -FilePath "powershell.exe" -ArgumentList ($argumentLine -join " ") -WorkingDirectory $appRoot | Out-Null
}

function Install-AisService {
  if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
    throw "Не найден установщик службы: $installerPath"
  }
  $arguments = @(
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $installerPath,
    "-Action", "Install", "-AppRoot", $scriptAppRoot, "-InteractiveAppRoot", $appRoot,
    "-InteractiveUser", $interactiveUserName, "-StartService", "-StartTray"
  )
  if (Test-IsAdministrator) {
    & powershell.exe @arguments
    if ($LASTEXITCODE -ne 0) { throw "Установка службы завершилась с кодом $LASTEXITCODE." }
  } else {
    $argumentLine = ($arguments | ForEach-Object { Quote-ProcessArgument $_ }) -join " "
    $process = Start-Process -FilePath "powershell.exe" -ArgumentList $argumentLine -Verb RunAs -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Установка службы завершилась с кодом $($process.ExitCode)." }
  }
}

function Start-AisService {
  $service = Get-AisService
  if (-not $service) {
    if (-not $InstallIfMissing) { throw "Служба АИС не установлена. Запустите установщик службы." }
    Install-AisService
    $service = Get-AisService
    if (-not $service) { throw "Служба не появилась после установки." }
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
  Start-AisInteractiveWorker
  Write-Host "Служба запущена. Ожидание готовности локального адреса..."
  if (-not (Wait-AisHealth $TimeoutSeconds)) {
    throw "Служба работает, но АИС не ответила на $healthUrl за $TimeoutSeconds сек. Откройте окно журнала запуска."
  }
  Write-Host "АИС готова: $localUrl"
}

function Stop-AisService {
  $service = Get-AisService
  if (-not $service) {
    if (Test-Path -LiteralPath $legacyStopPath -PathType Leaf) {
      Write-Host "Служба не установлена; останавливается прежний локальный запуск с сохранением Docker."
      & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $legacyStopPath -KeepDocker
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
  Start-Sleep -Milliseconds 500
  if (Test-AisHealth) {
    throw "Служба Windows остановлена, но локальная АИС продолжает отвечать. Откройте окно журнала запуска."
  }
  Write-Host "Служба остановлена. Контейнеры Docker оставлены работающими."
}

$mutatingActions = @("Start", "Stop", "Restart", "Install", "Uninstall")
if ($mutatingActions -contains $Action -and -not (Test-IsAdministrator)) {
  if ($Elevated) { throw "Повышение прав администратора не получено." }
  Invoke-ElevatedControl
}

switch ($Action) {
  "Install" {
    Install-AisService
  }
  "Uninstall" {
    if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) { throw "Не найден установщик службы." }
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $installerPath -Action Uninstall
    if ($LASTEXITCODE -ne 0) { throw "Удаление службы завершилось с кодом $LASTEXITCODE." }
  }
  "Start" {
    Start-AisService
    if ($ShowTray) { Start-AisTray }
    if ($OpenBrowser) { Open-AisBrowser }
  }
  "Stop" {
    Stop-AisService
  }
  "Restart" {
    Stop-AisService
    Start-AisService
    if ($ShowTray) { Start-AisTray }
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

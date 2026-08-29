[CmdletBinding()]
param(
  [ValidateSet("Install", "Uninstall", "Validate")]
  [string]$Action = "Install",
  [string]$AppRoot = "",
  [string]$InteractiveAppRoot = "",
  [switch]$StartService,
  [switch]$StartTray,
  [switch]$AsJson,
  [switch]$Elevated,
  [string]$InteractiveUser = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$utf8 = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

$serviceName = "AisDopobrWeb"
$serviceDisplayName = "АИС Допобразование"
$trayTaskName = "AisDopobrServiceTray"
$workerTaskName = "AisDopobrInteractiveHost"
$interactiveUserName = if ([string]::IsNullOrWhiteSpace($InteractiveUser)) {
  [Security.Principal.WindowsIdentity]::GetCurrent().Name
} else {
  $InteractiveUser.Trim()
}
$sourceAppRoot = if ([string]::IsNullOrWhiteSpace($AppRoot)) {
  Split-Path -Parent $PSScriptRoot
} else {
  $AppRoot
}
$sourceAppRoot = [IO.Path]::GetFullPath($sourceAppRoot)
$serviceSourcePath = Join-Path $PSScriptRoot "ais-windows-service.cs"
$serviceHostScriptPath = Join-Path $PSScriptRoot "ais-service-host.ps1"
$trayScriptName = "scripts\ais-service-tray.ps1"
$stopScriptName = "scripts\stop-lan-system.ps1"
$programDataRoot = Join-Path $env:ProgramData "AisDopobrWeb"
$serviceExecutablePath = Join-Path $programDataRoot "AisDopobrService.exe"
$serviceConfigPath = Join-Path $programDataRoot "service-config.json"
$serviceStopScriptPath = Join-Path $programDataRoot "stop-lan-system.ps1"
$cscPath = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"

function Write-InstallStep([string]$Message) {
  Write-Host "[Служба АИС] $Message"
}

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Quote-PowerShellLiteral([string]$Value) {
  return "'" + ([string]$Value).Replace("'", "''") + "'"
}

function Invoke-SelfElevated {
  $parts = New-Object Collections.Generic.List[string]
  $parts.Add("& $(Quote-PowerShellLiteral $PSCommandPath)")
  $parts.Add("-Action $(Quote-PowerShellLiteral $Action)")
  $parts.Add("-AppRoot $(Quote-PowerShellLiteral $sourceAppRoot)")
  $parts.Add("-InteractiveUser $(Quote-PowerShellLiteral $interactiveUserName)")
  $parts.Add("-Elevated")
  if ($StartService) { $parts.Add("-StartService") }
  if ($StartTray) { $parts.Add("-StartTray") }
  if ($AsJson) { $parts.Add("-AsJson") }
  $command = $parts -join " "
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
  $process = Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encoded
  ) -Verb RunAs -Wait -PassThru
  exit $process.ExitCode
}

function Get-LocalComputerNames {
  $names = New-Object Collections.Generic.HashSet[string]([StringComparer]::OrdinalIgnoreCase)
  foreach ($name in @(
    $env:COMPUTERNAME,
    [Environment]::MachineName,
    "localhost",
    "127.0.0.1",
    "."
  )) {
    if (-not [string]::IsNullOrWhiteSpace([string]$name)) {
      [void]$names.Add(([string]$name).Split('.')[0])
    }
  }
  # A HashSet is enumerable. The leading comma prevents PowerShell from
  # unrolling it into separate strings when the function returns.
  return ,$names
}

function Resolve-ServicePathInfo([string]$PathValue) {
  $fullPath = [IO.Path]::GetFullPath($PathValue)
  if (-not (Test-Path -LiteralPath $fullPath -PathType Container)) {
    throw "Папка АИС не найдена: $fullPath"
  }
  $root = [IO.Path]::GetPathRoot($fullPath)
  $driveName = $root.TrimEnd('\')
  $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$driveName'" -ErrorAction SilentlyContinue
  if (-not $disk) { throw "Не удалось определить тип диска $driveName" }
  if ([int]$disk.DriveType -ne 4) {
    return [pscustomobject]@{
      SourceAppRoot = $fullPath
      ServiceAppRoot = $fullPath
      MappedDrive = ""
      MappedTarget = ""
      RemotePath = ""
    }
  }

  $mapping = Get-SmbMapping -LocalPath $driveName -ErrorAction SilentlyContinue | Select-Object -First 1
  $remotePath = if ($mapping) { [string]$mapping.RemotePath } else { [string]$disk.ProviderName }
  $remoteMatch = [regex]::Match($remotePath, '^\\\\(?<server>[^\\]+)\\(?<share>[^\\]+)\\?$')
  if (-not $remoteMatch.Success) {
    throw "Не удалось разобрать сетевой путь диска $driveName`: $remotePath"
  }
  $serverName = $remoteMatch.Groups["server"].Value.Split('.')[0]
  if (-not (Get-LocalComputerNames).Contains($serverName)) {
    throw "Диск $driveName подключён к другому компьютеру ($remotePath). Для LocalSystem требуется локальная папка или отдельная учётная запись службы."
  }
  $shareName = $remoteMatch.Groups["share"].Value
  $share = Get-CimInstance Win32_Share -Filter "Name='$($shareName.Replace("'", "''"))'" -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $share -or [string]::IsNullOrWhiteSpace([string]$share.Path)) {
    throw "Локальная папка общей папки $remotePath не найдена."
  }
  $mappedTarget = [IO.Path]::GetFullPath([string]$share.Path)
  $targetDiskName = [IO.Path]::GetPathRoot($mappedTarget).TrimEnd('\')
  $targetDisk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$targetDiskName'" -ErrorAction SilentlyContinue
  if (-not $targetDisk -or [int]$targetDisk.DriveType -ne 3) {
    throw "Общая папка $remotePath не указывает на локальный фиксированный диск."
  }
  $relativePath = $fullPath.Substring($root.Length)
  $serviceAppRoot = [IO.Path]::GetFullPath((Join-Path $mappedTarget $relativePath))
  if (-not (Test-Path -LiteralPath (Join-Path $serviceAppRoot "app-server.js") -PathType Leaf)) {
    throw "Физическая папка АИС не прошла проверку: $serviceAppRoot"
  }
  return [pscustomobject]@{
    SourceAppRoot = $fullPath
    ServiceAppRoot = $serviceAppRoot
    MappedDrive = $driveName.ToUpperInvariant()
    MappedTarget = $mappedTarget
    RemotePath = $remotePath
  }
}

function Get-ServiceBinaryPath([pscustomobject]$PathInfo) {
  $arguments = New-Object Collections.Generic.List[string]
  $arguments.Add('"' + $serviceExecutablePath + '"')
  $arguments.Add("--service")
  $arguments.Add("--app-root")
  $arguments.Add('"' + $PathInfo.ServiceAppRoot + '"')
  $arguments.Add("--stop-script")
  $arguments.Add('"' + $serviceStopScriptPath + '"')
  $arguments.Add("--worker-task")
  $arguments.Add('"' + $workerTaskName + '"')
  if ($PathInfo.MappedDrive) {
    $arguments.Add("--mapped-drive")
    $arguments.Add('"' + $PathInfo.MappedDrive + '"')
    $arguments.Add("--mapped-target")
    $arguments.Add('"' + $PathInfo.MappedTarget + '"')
  }
  return $arguments -join " "
}

function Set-InteractiveAppRoot([pscustomobject]$PathInfo, [string]$InteractiveRoot) {
  if ([string]::IsNullOrWhiteSpace($InteractiveRoot)) { return }
  $interactiveFullPath = [IO.Path]::GetFullPath($InteractiveRoot)
  if ($interactiveFullPath -ieq $PathInfo.SourceAppRoot) { return }
  $interactivePathRoot = [IO.Path]::GetPathRoot($interactiveFullPath)
  if ($interactivePathRoot -notmatch '^[A-Za-z]:\\$') {
    throw "Интерактивный путь должен использовать диск Windows: $interactiveFullPath"
  }
  $relativePath = $interactiveFullPath.Substring($interactivePathRoot.Length)
  if (-not $PathInfo.ServiceAppRoot.EndsWith($relativePath, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Интерактивный и физический пути АИС указывают на разные папки."
  }
  $mappedTargetLength = $PathInfo.ServiceAppRoot.Length - $relativePath.Length
  $mappedTarget = $PathInfo.ServiceAppRoot.Substring(0, $mappedTargetLength).TrimEnd('\')
  if ([string]::IsNullOrWhiteSpace($mappedTarget)) {
    $mappedTarget = [IO.Path]::GetPathRoot($PathInfo.ServiceAppRoot).TrimEnd('\')
  }
  $PathInfo.SourceAppRoot = $interactiveFullPath
  $PathInfo.MappedDrive = $interactivePathRoot.TrimEnd('\').ToUpperInvariant()
  $PathInfo.MappedTarget = $mappedTarget
}

function Stop-ExactLegacyProcesses([pscustomobject]$PathInfo) {
  $stopPath = Join-Path $PathInfo.ServiceAppRoot $stopScriptName
  if (Test-Path -LiteralPath $stopPath -PathType Leaf) {
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $stopPath -KeepDocker
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "Штатная остановка прежнего запуска завершилась с кодом $LASTEXITCODE. Выполняется точная проверка процессов."
    }
  }
  $entryPoints = New-Object Collections.Generic.List[string]
  foreach ($rootPath in @($PathInfo.SourceAppRoot, $PathInfo.ServiceAppRoot) | Select-Object -Unique) {
    foreach ($relative in @("scripts\start-lan-system.js", "app-server.js", "local-server.js")) {
      $entryPoints.Add([IO.Path]::GetFullPath((Join-Path $rootPath $relative)))
    }
  }
  $managed = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $commandLine = [string]$_.CommandLine
    $entryPoints | Where-Object {
      $commandLine.IndexOf([string]$_, [StringComparison]::OrdinalIgnoreCase) -ge 0
    } | Select-Object -First 1
  })
  foreach ($process in $managed) {
    Write-InstallStep "Останавливается оставшийся процесс АИС PID $($process.ProcessId)."
    Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop
  }
}

function Remove-ExistingService {
  $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if (-not $service) { return }
  $service.Refresh()
  if ($service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped) {
    Stop-Service -Name $serviceName -ErrorAction Stop
    $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(240))
  }
  $service.Dispose()
  & sc.exe delete $serviceName | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Не удалось удалить прежнюю регистрацию службы $serviceName." }
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline -and (Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction SilentlyContinue)) {
    Start-Sleep -Milliseconds 300
  }
  if (Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction SilentlyContinue) {
    throw "Прежняя служба помечена на удаление. Перезагрузите Windows и повторите установку."
  }
}

function Protect-ProgramDataRoot {
  New-Item -ItemType Directory -Path $programDataRoot -Force | Out-Null
  $systemRule = "*S-1-5-18:(OI)(CI)F"
  $administratorsRule = "*S-1-5-32-544:(OI)(CI)F"
  & icacls.exe $programDataRoot /inheritance:r /grant:r $systemRule $administratorsRule | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Не удалось защитить служебную папку $programDataRoot."
  }
}

function Install-ProtectedStopScript([pscustomobject]$PathInfo) {
  $sourceStopScript = Join-Path $PathInfo.ServiceAppRoot $stopScriptName
  if (-not (Test-Path -LiteralPath $sourceStopScript -PathType Leaf)) {
    throw "Не найден сценарий остановки АИС: $sourceStopScript"
  }
  Copy-Item -LiteralPath $sourceStopScript -Destination $serviceStopScriptPath -Force
  if (-not (Test-Path -LiteralPath $serviceStopScriptPath -PathType Leaf)) {
    throw "Защищённая копия сценария остановки не создана: $serviceStopScriptPath"
  }
}

function Compile-ServiceHost {
  if (-not (Test-Path -LiteralPath $cscPath -PathType Leaf)) {
    throw "Не найден штатный компилятор .NET Framework: $cscPath"
  }
  if (-not (Test-Path -LiteralPath $serviceSourcePath -PathType Leaf)) {
    throw "Не найден исходный код службы: $serviceSourcePath"
  }
  New-Item -ItemType Directory -Path $programDataRoot -Force | Out-Null
  $temporaryOutput = Join-Path $programDataRoot ("AisDopobrService-{0}.exe" -f [Guid]::NewGuid().ToString("N"))
  try {
    & $cscPath /nologo /optimize+ /target:winexe /platform:anycpu `
      /reference:System.dll /reference:System.Core.dll /reference:System.ServiceProcess.dll `
      "/out:$temporaryOutput" $serviceSourcePath
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $temporaryOutput -PathType Leaf)) {
      throw "Компиляция службы завершилась с кодом $LASTEXITCODE."
    }
    Move-Item -LiteralPath $temporaryOutput -Destination $serviceExecutablePath -Force
  } finally {
    Remove-Item -LiteralPath $temporaryOutput -Force -ErrorAction SilentlyContinue
  }
}

function Register-TrayTask([pscustomobject]$PathInfo) {
  $trayPath = Join-Path $PathInfo.ServiceAppRoot $trayScriptName
  if (-not (Test-Path -LiteralPath $trayPath -PathType Leaf)) {
    throw "Не найден контроллер трея: $trayPath"
  }
  $powerShellPath = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
  $argumentLine = "-NoLogo -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$trayPath`" -AppRoot `"$($PathInfo.ServiceAppRoot)`""
  $taskAction = New-ScheduledTaskAction -Execute $powerShellPath -Argument $argumentLine -WorkingDirectory $PathInfo.ServiceAppRoot
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $interactiveUserName
  $principal = New-ScheduledTaskPrincipal -UserId $interactiveUserName -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $trayTaskName -Action $taskAction -Trigger $trigger `
    -Principal $principal -Settings $settings -Description "Иконка управления службой АИС Допобразование" -Force | Out-Null
}

function Register-WorkerTask([pscustomobject]$PathInfo) {
  $workerPath = Join-Path $PathInfo.ServiceAppRoot "scripts\ais-service-host.ps1"
  if (-not (Test-Path -LiteralPath $workerPath -PathType Leaf)) {
    throw "Не найден интерактивный рабочий сценарий: $workerPath"
  }
  $powerShellPath = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
  $argumentParts = New-Object Collections.Generic.List[string]
  foreach ($part in @(
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
    "-File", ('"' + $workerPath + '"'), "-AppRoot", ('"' + $PathInfo.SourceAppRoot + '"')
  )) { $argumentParts.Add([string]$part) }
  if ($PathInfo.MappedDrive) {
    $argumentParts.Add("-MappedDrive")
    $argumentParts.Add('"' + $PathInfo.MappedDrive + '"')
    $argumentParts.Add("-MappedTarget")
    $argumentParts.Add('"' + $PathInfo.MappedTarget + '"')
  }
  $taskAction = New-ScheduledTaskAction -Execute $powerShellPath `
    -Argument ($argumentParts -join " ") -WorkingDirectory $PathInfo.ServiceAppRoot
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $interactiveUserName
  $principal = New-ScheduledTaskPrincipal -UserId $interactiveUserName -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $workerTaskName -Action $taskAction -Trigger $trigger `
    -Principal $principal -Settings $settings `
    -Description "Интерактивный сервер АИС: Excel, диалоги файлов и локальные документы" -Force | Out-Null
}

function Remove-AisScheduledTasks {
  foreach ($taskName in @($workerTaskName, $trayTaskName)) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  }
}

if ($env:AIS_SERVICE_TEST_MODE -eq "1" -and $Action -ne "Validate") {
  throw "В тестовом режиме запрещены изменения Windows SCM и планировщика."
}

if ($Action -in @("Install", "Uninstall") -and -not (Test-IsAdministrator)) {
  if ($Elevated) { throw "Повышение прав администратора не получено." }
  Invoke-SelfElevated
}

if ($Action -eq "Uninstall") {
  Write-InstallStep "Удаление службы и автозапуска иконки..."
  Remove-ExistingService
  Remove-AisScheduledTasks
  if (Test-Path -LiteralPath $programDataRoot -PathType Container) {
    Remove-Item -LiteralPath $programDataRoot -Recurse -Force
  }
  Write-InstallStep "Служба удалена. Данные АИС, журналы и контейнеры Docker сохранены."
  exit 0
}

$pathInfo = Resolve-ServicePathInfo $sourceAppRoot
Set-InteractiveAppRoot $pathInfo $InteractiveAppRoot
$validation = [ordered]@{
  serviceName = $serviceName
  sourceAppRoot = $pathInfo.SourceAppRoot
  serviceAppRoot = $pathInfo.ServiceAppRoot
  mappedDrive = $pathInfo.MappedDrive
  mappedTarget = $pathInfo.MappedTarget
  serviceSource = $serviceSourcePath
  protectedStopScript = $serviceStopScriptPath
  serviceHostScript = Join-Path $pathInfo.ServiceAppRoot "scripts\ais-service-host.ps1"
  compiler = $cscPath
  trayTaskName = $trayTaskName
  workerTaskName = $workerTaskName
  interactiveUser = $interactiveUserName
}
foreach ($requiredPath in @(
  $validation.serviceSource,
  $validation.serviceHostScript,
  (Join-Path $pathInfo.ServiceAppRoot $trayScriptName),
  (Join-Path $pathInfo.ServiceAppRoot $stopScriptName),
  $cscPath
)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw "Не найден обязательный файл службы: $requiredPath"
  }
}

if ($Action -eq "Validate") {
  if ($AsJson) { $validation | ConvertTo-Json -Compress }
  else {
    Write-InstallStep "Конфигурация службы проверена."
    Write-Host "Папка пользователя: $($pathInfo.SourceAppRoot)"
    Write-Host "Папка службы: $($pathInfo.ServiceAppRoot)"
    if ($pathInfo.MappedDrive) {
      Write-Host "Служебный диск: $($pathInfo.MappedDrive) -> $($pathInfo.MappedTarget)"
    }
  }
  exit 0
}

Write-InstallStep "Подготовка интерактивного окружения Node.js/Git/FTP..."
$bootstrapPath = Join-Path $pathInfo.SourceAppRoot "scripts\bootstrap-local-system.ps1"
& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $bootstrapPath `
  -Action Validate -LauncherArguments "--skip-docker"
if ($LASTEXITCODE -ne 0) { throw "Проверка окружения АИС завершилась с кодом $LASTEXITCODE." }

Write-InstallStep "Остановка прежнего консольного экземпляра с сохранением Docker..."
Remove-ExistingService
Stop-ExactLegacyProcesses $pathInfo
Remove-AisScheduledTasks

Write-InstallStep "Защита служебных файлов от изменения обычными пользователями..."
Protect-ProgramDataRoot
Install-ProtectedStopScript $pathInfo
Write-InstallStep "Компиляция штатного хоста Windows-службы..."
Compile-ServiceHost
$binaryPath = Get-ServiceBinaryPath $pathInfo
New-Service -Name $serviceName -BinaryPathName $binaryPath -DisplayName $serviceDisplayName `
  -StartupType Automatic -DependsOn "Tcpip" | Out-Null
& sc.exe config $serviceName start= delayed-auto | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Не удалось включить отложенный автозапуск службы." }
& sc.exe failure $serviceName reset= 86400 actions= restart/5000/restart/15000/restart/60000 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Не удалось настроить автоматическое восстановление службы." }
& sc.exe failureflag $serviceName 1 | Out-Null
& sc.exe description $serviceName "АИС Допобразование: локальный API, веб-сервер и супервизор процессов" | Out-Null

Write-InstallStep "Регистрация интерактивного сервера для Excel и локальных окон..."
Register-WorkerTask $pathInfo
Write-InstallStep "Регистрация иконки управления при входе пользователя..."
Register-TrayTask $pathInfo
$configuration = [ordered]@{
  schemaVersion = 2
  installedAt = (Get-Date).ToUniversalTime().ToString("o")
  installedBy = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  serviceName = $serviceName
  trayTaskName = $trayTaskName
  workerTaskName = $workerTaskName
  interactiveUser = $interactiveUserName
  sourceAppRoot = $pathInfo.SourceAppRoot
  serviceAppRoot = $pathInfo.ServiceAppRoot
  protectedStopScript = $serviceStopScriptPath
  mappedDrive = $pathInfo.MappedDrive
  mappedTarget = $pathInfo.MappedTarget
  binaryPath = $binaryPath
}
$configuration | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $serviceConfigPath -Encoding UTF8

if ($StartService) {
  Write-InstallStep "Запуск службы..."
  Start-Service -Name $serviceName
  (Get-Service -Name $serviceName).WaitForStatus(
    [System.ServiceProcess.ServiceControllerStatus]::Running,
    [TimeSpan]::FromSeconds(60)
  )
}
if ($StartTray) {
  Start-ScheduledTask -TaskName $trayTaskName
}
Write-InstallStep "Служба установлена. Автозапуск Windows и иконка в трее настроены."

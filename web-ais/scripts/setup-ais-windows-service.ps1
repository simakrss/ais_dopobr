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

$env:PSModulePath = [IO.Path]::Combine($PSHOME, "Modules")
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$utf8 = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

$serviceName = "AisDopobrWeb"
$serviceDisplayName = "АИС Допобразование"
$trayTaskName = "AisDopobrServiceTray"
$workerTaskName = "AisDopobrInteractiveHost"
$commonProgramData = [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData)
$systemDirectory = [Environment]::SystemDirectory
$windowsDirectory = [IO.Directory]::GetParent($systemDirectory).FullName
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
$programDataRoot = Join-Path $commonProgramData "AisDopobrWeb"
$serviceExecutablePath = Join-Path $programDataRoot "AisDopobrService.exe"
$serviceConfigPath = Join-Path $programDataRoot "service-config.json"
$serviceStopScriptPath = Join-Path $programDataRoot "stop-lan-system.ps1"
$serviceControllerPath = Join-Path $programDataRoot "control-ais-service.ps1"
$serviceTrayPath = Join-Path $programDataRoot "ais-service-tray.ps1"
$serviceLogViewerPath = Join-Path $programDataRoot "show-ais-service-log.ps1"
$serviceInstallerPath = Join-Path $programDataRoot "setup-ais-windows-service.ps1"
$serviceSourceCopyPath = Join-Path $programDataRoot "ais-windows-service.cs"
$cscPath = Join-Path $windowsDirectory "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$powerShellPath = Join-Path $systemDirectory "WindowsPowerShell\v1.0\powershell.exe"
$scPath = Join-Path $systemDirectory "sc.exe"
$icaclsPath = Join-Path $systemDirectory "icacls.exe"

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

function Quote-WindowsArgument([string]$Value) {
  if ($null -eq $Value -or $Value.Length -eq 0) { return '""' }
  if ($Value -notmatch '[\s"]') { return $Value }
  $escaped = [regex]::Replace($Value, '(\\*)"', '${1}${1}\"')
  $escaped = [regex]::Replace($escaped, '(\\+)$', '${1}${1}')
  return '"' + $escaped + '"'
}

function Invoke-SelfElevated {
  $elevationScriptPath = $PSCommandPath
  $elevationAppRoot = $sourceAppRoot
  $elevationInteractiveRoot = $InteractiveAppRoot
  $pathInfo = Resolve-ServicePathInfo $sourceAppRoot
  if ($pathInfo.MappedDrive) {
    $relativeScriptPath = $PSCommandPath.Substring($pathInfo.SourceAppRoot.Length).TrimStart('\')
    $elevationScriptPath = [IO.Path]::GetFullPath([IO.Path]::Combine($pathInfo.ServiceAppRoot, $relativeScriptPath))
    $elevationAppRoot = $pathInfo.ServiceAppRoot
    if ([string]::IsNullOrWhiteSpace($elevationInteractiveRoot)) {
      $elevationInteractiveRoot = $pathInfo.SourceAppRoot
    }
  }
  $parts = New-Object Collections.Generic.List[string]
  $parts.Add("& $(Quote-PowerShellLiteral $elevationScriptPath)")
  $parts.Add("-Action $(Quote-PowerShellLiteral $Action)")
  $parts.Add("-AppRoot $(Quote-PowerShellLiteral $elevationAppRoot)")
  if (-not [string]::IsNullOrWhiteSpace($elevationInteractiveRoot)) {
    $parts.Add("-InteractiveAppRoot $(Quote-PowerShellLiteral $elevationInteractiveRoot)")
  }
  $parts.Add("-InteractiveUser $(Quote-PowerShellLiteral $interactiveUserName)")
  $parts.Add("-Elevated")
  if ($StartService) { $parts.Add("-StartService") }
  if ($StartTray) { $parts.Add("-StartTray") }
  if ($AsJson) { $parts.Add("-AsJson") }
  $command = $parts -join " "
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
  $process = Start-Process -FilePath $powerShellPath -ArgumentList @(
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
  $arguments.Add((Quote-WindowsArgument $serviceExecutablePath))
  $arguments.Add("--service")
  $arguments.Add("--app-root")
  $arguments.Add((Quote-WindowsArgument $PathInfo.ServiceAppRoot))
  $arguments.Add("--stop-script")
  $arguments.Add((Quote-WindowsArgument $serviceStopScriptPath))
  $arguments.Add("--worker-task")
  $arguments.Add((Quote-WindowsArgument $workerTaskName))
  if ($PathInfo.MappedDrive) {
    $arguments.Add("--mapped-drive")
    $arguments.Add((Quote-WindowsArgument $PathInfo.MappedDrive))
    $arguments.Add("--mapped-target")
    $arguments.Add((Quote-WindowsArgument $PathInfo.MappedTarget))
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
  $mappedTarget = $PathInfo.ServiceAppRoot.Substring(0, $mappedTargetLength)
  $mappedTargetRoot = [IO.Path]::GetPathRoot($mappedTarget)
  $mappedTarget = if ($mappedTarget.TrimEnd('\').Length -eq 2 -and $mappedTarget[1] -eq ':') {
    $mappedTargetRoot
  } else {
    $mappedTarget.TrimEnd('\')
  }
  $PathInfo.SourceAppRoot = $interactiveFullPath
  $PathInfo.MappedDrive = $interactivePathRoot.TrimEnd('\').ToUpperInvariant()
  $PathInfo.MappedTarget = $mappedTarget
}

function Stop-ExactLegacyProcesses([pscustomobject]$PathInfo) {
  $entryPoints = New-Object Collections.Generic.List[string]
  foreach ($rootPath in @($PathInfo.SourceAppRoot, $PathInfo.ServiceAppRoot) | Select-Object -Unique) {
    foreach ($relative in @("scripts\start-lan-system.js", "app-server.js", "local-server.js")) {
      $entryPoints.Add([IO.Path]::GetFullPath([IO.Path]::Combine($rootPath, $relative)))
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
  Start-Sleep -Milliseconds 500
  $remainingManaged = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $commandLine = [string]$_.CommandLine
    $entryPoints | Where-Object {
      $commandLine.IndexOf([string]$_, [StringComparison]::OrdinalIgnoreCase) -ge 0
    } | Select-Object -First 1
  })
  $remainingPorts = @(@(8081, 19081) | Where-Object {
    Get-NetTCPConnection -State Listen -LocalPort $_ -ErrorAction SilentlyContinue | Select-Object -First 1
  })
  if ($remainingManaged.Count -gt 0 -or $remainingPorts.Count -gt 0) {
    throw "Остановка прежнего экземпляра АИС не подтверждена; установка или удаление отменены."
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
  & $scPath delete $serviceName | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Не удалось удалить прежнюю регистрацию службы $serviceName." }
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline -and (Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction SilentlyContinue)) {
    Start-Sleep -Milliseconds 300
  }
  if (Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction SilentlyContinue) {
    throw "Прежняя служба помечена на удаление. Перезагрузите Windows и повторите установку."
  }
}

function Assert-ProtectedServiceDirectory([string]$DirectoryPath) {
  $item = Get-Item -LiteralPath $DirectoryPath -Force
  if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Служебная папка не прошла проверку типа: $DirectoryPath"
  }
  $verified = Get-Acl -LiteralPath $DirectoryPath
  $interactiveSid = (New-Object Security.Principal.NTAccount($interactiveUserName)).Translate(
    [Security.Principal.SecurityIdentifier]
  ).Value
  $allowedSids = @("S-1-5-18", "S-1-5-32-544", $interactiveSid)
  $ownerSid = (New-Object Security.Principal.NTAccount($verified.Owner)).Translate(
    [Security.Principal.SecurityIdentifier]
  ).Value
  $rules = @($verified.Access)
  $invalidRules = @($rules | Where-Object {
    $ruleSid = $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    $hasExpectedRights = if ($ruleSid -eq $interactiveSid) {
      $writeMask = [Security.AccessControl.FileSystemRights]::WriteData -bor
        [Security.AccessControl.FileSystemRights]::AppendData -bor
        [Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
        [Security.AccessControl.FileSystemRights]::WriteAttributes -bor
        [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [Security.AccessControl.FileSystemRights]::Delete -bor
        [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [Security.AccessControl.FileSystemRights]::TakeOwnership
      ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::ReadAndExecute) -eq
        [Security.AccessControl.FileSystemRights]::ReadAndExecute -and
        ($_.FileSystemRights -band $writeMask) -eq 0
    } else {
      ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq
        [Security.AccessControl.FileSystemRights]::FullControl
    }
    $ruleSid -notin $allowedSids -or
      $_.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
      -not $hasExpectedRights -or
      ($_.InheritanceFlags -band [Security.AccessControl.InheritanceFlags]::ContainerInherit) -eq 0 -or
      ($_.InheritanceFlags -band [Security.AccessControl.InheritanceFlags]::ObjectInherit) -eq 0
  })
  $actualSids = @($rules | ForEach-Object {
    $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
  } | Select-Object -Unique)
  if (
    -not $verified.AreAccessRulesProtected -or
    $ownerSid -ne "S-1-5-32-544" -or
    $invalidRules.Count -gt 0 -or
    $rules.Count -ne 3 -or
    @($allowedSids | Where-Object { $_ -notin $actualSids }).Count -gt 0
  ) {
    throw "Защищённые права служебной папки не прошли проверку: $DirectoryPath"
  }
}

function Protect-ProgramDataRoot {
  $expectedRoot = [IO.Path]::GetFullPath((Join-Path $commonProgramData "AisDopobrWeb"))
  $programDataParent = [IO.Path]::GetFullPath($commonProgramData).TrimEnd('\')
  if (
    [IO.Path]::GetFullPath($programDataRoot) -ine $expectedRoot -or
    [IO.Directory]::GetParent($expectedRoot).FullName.TrimEnd('\') -ine $programDataParent
  ) {
    throw "Отказ от очистки неожиданной служебной папки: $programDataRoot"
  }

  # Prepare an unpredictable, already protected staging directory first. The
  # final Directory.Move is atomic and fails if another process creates the
  # well-known target during replacement, so elevated writes never follow a
  # user-supplied junction at that path.
  $stagingPath = [IO.Path]::GetFullPath((Join-Path $commonProgramData (
    "AisDopobrWeb.install-{0}" -f [Guid]::NewGuid().ToString("N")
  )))
  if ([IO.Directory]::GetParent($stagingPath).FullName.TrimEnd('\') -ine $programDataParent) {
    throw "Отказ от создания временной служебной папки за пределами ProgramData."
  }
  $systemSid = New-Object Security.Principal.SecurityIdentifier("S-1-5-18")
  $administratorsSid = New-Object Security.Principal.SecurityIdentifier("S-1-5-32-544")
  $interactiveSid = (New-Object Security.Principal.NTAccount($interactiveUserName)).Translate(
    [Security.Principal.SecurityIdentifier]
  )
  $inheritanceFlags = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
    [Security.AccessControl.InheritanceFlags]::ObjectInherit
  $security = New-Object Security.AccessControl.DirectorySecurity
  $security.SetOwner($administratorsSid)
  $security.SetAccessRuleProtection($true, $false)
  foreach ($ownerSid in @($systemSid, $administratorsSid)) {
    $security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
      $ownerSid,
      [Security.AccessControl.FileSystemRights]::FullControl,
      $inheritanceFlags,
      [Security.AccessControl.PropagationFlags]::None,
      [Security.AccessControl.AccessControlType]::Allow
    ))
  }
  $security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
    $interactiveSid,
    [Security.AccessControl.FileSystemRights]::ReadAndExecute,
    $inheritanceFlags,
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Allow
  ))
  [IO.Directory]::CreateDirectory($stagingPath, $security) | Out-Null
  Assert-ProtectedServiceDirectory $stagingPath
  if (@([IO.Directory]::EnumerateFileSystemEntries($stagingPath)).Count -ne 0) {
    throw "Временная служебная папка неожиданно содержит файлы: $stagingPath"
  }

  $archivePath = $null
  if (Test-Path -LiteralPath $programDataRoot) {
    $existingRoot = Get-Item -LiteralPath $programDataRoot -Force
    if (-not $existingRoot.PSIsContainer) {
      throw "Служебный путь занят файлом и не будет изменён: $programDataRoot"
    }
    if (($existingRoot.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Служебная папка является ссылкой или точкой повторной обработки; установка остановлена: $programDataRoot"
    }
    $archiveName = "AisDopobrWeb.previous-{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss-fff")
    $archivePath = [IO.Path]::GetFullPath((Join-Path $commonProgramData $archiveName))
    if ([IO.Directory]::GetParent($archivePath).FullName.TrimEnd('\') -ine $programDataParent) {
      throw "Отказ от переноса служебной папки за пределы ProgramData."
    }
    [IO.Directory]::Move($programDataRoot, $archivePath)
  }
  try {
    [IO.Directory]::Move($stagingPath, $programDataRoot)
  } catch {
    if (Test-Path -LiteralPath $stagingPath -PathType Container) {
      $leftoverItem = Get-Item -LiteralPath $stagingPath -Force
      if (($leftoverItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) {
        [IO.Directory]::Delete($stagingPath, $false)
      }
    }
    throw "Не удалось атомарно создать защищённую служебную папку; установка остановлена: $($_.Exception.Message)"
  }
  Assert-ProtectedServiceDirectory $programDataRoot
  if ($archivePath) {
    Write-InstallStep "Предыдущие файлы службы перемещены в $archivePath"
  }
}

function Grant-InteractiveAppAccess([pscustomobject]$PathInfo) {
  $account = New-Object Security.Principal.NTAccount($interactiveUserName)
  $userSid = $account.Translate([Security.Principal.SecurityIdentifier]).Value
  $repositoryRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PathInfo.ServiceAppRoot)).TrimEnd('\')
  $volumeRoot = [IO.Path]::GetPathRoot($repositoryRoot).TrimEnd('\')
  $gitConfigPath = [IO.Path]::GetFullPath([IO.Path]::Combine($repositoryRoot, ".git\config"))
  $gitHeadPath = [IO.Path]::GetFullPath([IO.Path]::Combine($repositoryRoot, ".git\HEAD"))
  $gitObjectsPath = [IO.Path]::GetFullPath([IO.Path]::Combine($repositoryRoot, ".git\objects"))
  if (
    $repositoryRoot -ieq $volumeRoot -or
    -not (Test-Path -LiteralPath $gitConfigPath -PathType Leaf) -or
    -not (Test-Path -LiteralPath $gitHeadPath -PathType Leaf) -or
    -not (Test-Path -LiteralPath $gitObjectsPath -PathType Container)
  ) {
    throw "Родительская папка АИС не прошла проверку как корень Git-репозитория: $repositoryRoot"
  }
  $userAccessRule = "*$($userSid):(OI)(CI)M"
  $systemAccessRule = "*S-1-5-18:(OI)(CI)M"
  # Applying inheritable ACEs only to the two trusted roots avoids traversing a
  # user-writable tree with elevated privileges. Windows propagates the ACEs to
  # existing inheriting children; the checks below fail closed if inheritance is disabled.
  & $icaclsPath $repositoryRoot /grant:r $userAccessRule /Q | Out-Null
  $userGrantExitCode = $LASTEXITCODE
  & $icaclsPath $PathInfo.ServiceAppRoot /grant:r $systemAccessRule /Q | Out-Null
  $systemGrantExitCode = $LASTEXITCODE
  if ($userGrantExitCode -ne 0 -or $systemGrantExitCode -ne 0) {
    throw "Не удалось выдать пользователю $interactiveUserName права на рабочую папку АИС."
  }

  $checks = @(
    @{ Path = $repositoryRoot; Sid = $userSid },
    @{ Path = $gitConfigPath; Sid = $userSid },
    @{ Path = (Join-Path $PathInfo.ServiceAppRoot "app-server.js"); Sid = $userSid },
    @{ Path = $PathInfo.ServiceAppRoot; Sid = "S-1-5-18" },
    @{ Path = (Join-Path $PathInfo.ServiceAppRoot "app-server.js"); Sid = "S-1-5-18" }
  )
  foreach ($check in $checks) {
    if (-not (Test-Path -LiteralPath $check.Path)) {
      throw "Не найден файл для проверки прав АИС: $($check.Path)"
    }
    $acl = Get-Acl -LiteralPath $check.Path
    $matchingRule = @($acl.Access | Where-Object {
      $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -eq $check.Sid -and
      $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
      ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Modify) -eq
        [Security.AccessControl.FileSystemRights]::Modify
    }) | Select-Object -First 1
    $deniedRule = @($acl.Access | Where-Object {
      $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -eq $check.Sid -and
      $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Deny -and
      ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Modify) -ne 0
    }) | Select-Object -First 1
    if (-not $matchingRule -or $deniedRule) {
      throw "Права на $($check.Path) не прошли проверку для SID $($check.Sid)."
    }
  }
}

function Install-ProtectedStopScript([pscustomobject]$PathInfo) {
  $protectedFiles = @(
    @{ Source = [IO.Path]::Combine($PathInfo.ServiceAppRoot, "scripts\stop-lan-system.ps1"); Destination = $serviceStopScriptPath },
    @{ Source = [IO.Path]::Combine($PathInfo.ServiceAppRoot, "scripts\control-ais-service.ps1"); Destination = $serviceControllerPath },
    @{ Source = [IO.Path]::Combine($PathInfo.ServiceAppRoot, "scripts\ais-service-tray.ps1"); Destination = $serviceTrayPath },
    @{ Source = [IO.Path]::Combine($PathInfo.ServiceAppRoot, "scripts\show-ais-service-log.ps1"); Destination = $serviceLogViewerPath },
    @{ Source = [IO.Path]::Combine($PathInfo.ServiceAppRoot, "scripts\setup-ais-windows-service.ps1"); Destination = $serviceInstallerPath },
    @{ Source = [IO.Path]::Combine($PathInfo.ServiceAppRoot, "scripts\ais-windows-service.cs"); Destination = $serviceSourceCopyPath }
  )
  foreach ($file in $protectedFiles) {
    $sourcePath = [IO.Path]::GetFullPath([string]$file.Source)
    $destinationPath = [IO.Path]::GetFullPath([string]$file.Destination)
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
      throw "Не найден обязательный файл управления службой: $sourcePath"
    }
    Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
    if (-not (Test-Path -LiteralPath $destinationPath -PathType Leaf)) {
      throw "Защищённая копия файла службы не создана: $destinationPath"
    }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $sourcePath).Hash -ne
      (Get-FileHash -Algorithm SHA256 -LiteralPath $destinationPath).Hash) {
      throw "Защищённая копия файла службы не прошла проверку: $destinationPath"
    }
  }
}

function Test-InteractiveServiceControlSddl([string]$Sddl, [string]$UserSid) {
  try {
    $descriptor = New-Object Security.AccessControl.CommonSecurityDescriptor($false, $false, $Sddl)
    foreach ($ace in $descriptor.DiscretionaryAcl) {
      if (
        $ace.SecurityIdentifier.Value -eq $UserSid -and
        $ace.AceQualifier -eq [Security.AccessControl.AceQualifier]::AccessAllowed -and
        [int]$ace.AccessMask -eq 0xB4
      ) {
        return $true
      }
    }
  } catch {
    return $false
  }
  return $false
}

function Grant-InteractiveServiceControl {
  $interactiveSid = (New-Object Security.Principal.NTAccount($interactiveUserName)).Translate(
    [Security.Principal.SecurityIdentifier]
  ).Value
  $controlAce = "(A;;LCRPWPLO;;;$interactiveSid)"
  $sddl = @(& $scPath sdshow $serviceName 2>$null | Where-Object { [string]$_ -match '^D:' } |
    Select-Object -First 1)
  if ($LASTEXITCODE -ne 0 -or $sddl.Count -ne 1) {
    throw "Не удалось прочитать права службы $serviceName."
  }
  $serviceSddl = [string]$sddl[0]
  if (-not (Test-InteractiveServiceControlSddl $serviceSddl $interactiveSid)) {
    $saclIndex = $serviceSddl.IndexOf("S:", [StringComparison]::Ordinal)
    $serviceSddl = if ($saclIndex -ge 0) {
      $serviceSddl.Insert($saclIndex, $controlAce)
    } else {
      $serviceSddl + $controlAce
    }
    & $scPath sdset $serviceName $serviceSddl | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Не удалось выдать права управления службой пользователю $interactiveUserName." }
  }
  $verifiedSddl = @(& $scPath sdshow $serviceName 2>$null | Where-Object { [string]$_ -match '^D:' } |
    Select-Object -First 1)
  if ($LASTEXITCODE -ne 0 -or $verifiedSddl.Count -ne 1 -or
    -not (Test-InteractiveServiceControlSddl ([string]$verifiedSddl[0]) $interactiveSid)) {
    throw "Права запуска и остановки службы не прошли проверку для $interactiveUserName."
  }
}

function Compile-ServiceHost {
  if (-not (Test-Path -LiteralPath $cscPath -PathType Leaf)) {
    throw "Не найден штатный компилятор .NET Framework: $cscPath"
  }
  if (-not (Test-Path -LiteralPath $serviceSourceCopyPath -PathType Leaf)) {
    throw "Не найдена защищённая копия исходного кода службы: $serviceSourceCopyPath"
  }
  New-Item -ItemType Directory -Path $programDataRoot -Force | Out-Null
  $temporaryOutput = Join-Path $programDataRoot ("AisDopobrService-{0}.exe" -f [Guid]::NewGuid().ToString("N"))
  try {
    & $cscPath /nologo /optimize+ /target:winexe /platform:anycpu `
      /reference:System.dll /reference:System.Core.dll /reference:System.ServiceProcess.dll `
      "/out:$temporaryOutput" $serviceSourceCopyPath
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $temporaryOutput -PathType Leaf)) {
      throw "Компиляция службы завершилась с кодом $LASTEXITCODE."
    }
    Move-Item -LiteralPath $temporaryOutput -Destination $serviceExecutablePath -Force
  } finally {
    Remove-Item -LiteralPath $temporaryOutput -Force -ErrorAction SilentlyContinue
  }
}

function Register-TrayTask([pscustomobject]$PathInfo) {
  $trayPath = $serviceTrayPath
  if (-not (Test-Path -LiteralPath $trayPath -PathType Leaf)) {
    throw "Не найден контроллер трея: $trayPath"
  }
  $argumentLine = (@(
    "-NoLogo", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
    "-File", $trayPath, "-AppRoot", $PathInfo.ServiceAppRoot
  ) | ForEach-Object { Quote-WindowsArgument ([string]$_) }) -join " "
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
  $argumentValues = New-Object Collections.Generic.List[string]
  foreach ($part in @(
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
    "-File", $workerPath, "-AppRoot", $PathInfo.SourceAppRoot
  )) { $argumentValues.Add([string]$part) }
  if ($PathInfo.MappedDrive) {
    $argumentValues.Add("-MappedDrive")
    $argumentValues.Add([string]$PathInfo.MappedDrive)
    $argumentValues.Add("-MappedTarget")
    $argumentValues.Add([string]$PathInfo.MappedTarget)
  }
  $argumentLine = @($argumentValues | ForEach-Object { Quote-WindowsArgument ([string]$_) }) -join " "
  $taskAction = New-ScheduledTaskAction -Execute $powerShellPath `
    -Argument $argumentLine -WorkingDirectory $PathInfo.ServiceAppRoot
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

$pathInfo = Resolve-ServicePathInfo $sourceAppRoot
Set-InteractiveAppRoot $pathInfo $InteractiveAppRoot

if ($Action -eq "Uninstall") {
  Write-InstallStep "Удаление службы и автозапуска иконки..."
  Remove-ExistingService
  Stop-ScheduledTask -TaskName $workerTaskName -ErrorAction SilentlyContinue
  Write-InstallStep "Проверка и очистка оставшихся процессов АИС с сохранением Docker..."
  Stop-ExactLegacyProcesses $pathInfo
  Remove-AisScheduledTasks
  if (Test-Path -LiteralPath $programDataRoot) {
    $expectedRoot = [IO.Path]::GetFullPath((Join-Path $commonProgramData "AisDopobrWeb"))
    $programDataParent = [IO.Path]::GetFullPath($commonProgramData).TrimEnd('\')
    $existingRoot = Get-Item -LiteralPath $programDataRoot -Force
    if (
      [IO.Path]::GetFullPath($programDataRoot) -ine $expectedRoot -or
      -not $existingRoot.PSIsContainer -or
      ($existingRoot.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
    ) {
      throw "Служебная папка не прошла безопасную проверку и оставлена без изменений: $programDataRoot"
    }
    $archivePath = [IO.Path]::GetFullPath((Join-Path $commonProgramData (
      "AisDopobrWeb.uninstalled-{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss-fff")
    )))
    if ([IO.Directory]::GetParent($archivePath).FullName.TrimEnd('\') -ine $programDataParent) {
      throw "Отказ от переноса служебной папки за пределы ProgramData."
    }
    [IO.Directory]::Move($programDataRoot, $archivePath)
    Write-InstallStep "Файлы удалённой службы сохранены для восстановления: $archivePath"
  }
  Write-InstallStep "Служба удалена. Данные АИС, журналы и контейнеры Docker сохранены."
  exit 0
}

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
$bootstrapPath = Join-Path $pathInfo.ServiceAppRoot "scripts\bootstrap-local-system.ps1"
& $powerShellPath -NoLogo -NoProfile -ExecutionPolicy Bypass -File $bootstrapPath `
  -Action Validate -LauncherArguments "--skip-docker"
if ($LASTEXITCODE -ne 0) { throw "Проверка окружения АИС завершилась с кодом $LASTEXITCODE." }

Write-InstallStep "Остановка прежнего консольного экземпляра с сохранением Docker..."
Remove-ExistingService
Stop-ScheduledTask -TaskName $workerTaskName -ErrorAction SilentlyContinue
Stop-ExactLegacyProcesses $pathInfo
Remove-AisScheduledTasks

Write-InstallStep "Защита служебных файлов от изменения обычными пользователями..."
Protect-ProgramDataRoot
Write-InstallStep "Настройка рабочей папки для интерактивного пользователя..."
Grant-InteractiveAppAccess $pathInfo
Install-ProtectedStopScript $pathInfo
Write-InstallStep "Компиляция штатного хоста Windows-службы..."
Compile-ServiceHost
$binaryPath = Get-ServiceBinaryPath $pathInfo
New-Service -Name $serviceName -BinaryPathName $binaryPath -DisplayName $serviceDisplayName `
  -StartupType Automatic -DependsOn "Tcpip" | Out-Null
& $scPath config $serviceName start= delayed-auto | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Не удалось включить отложенный автозапуск службы." }
& $scPath failure $serviceName reset= 86400 actions= restart/5000/restart/15000/restart/60000 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Не удалось настроить автоматическое восстановление службы." }
& $scPath failureflag $serviceName 1 | Out-Null
& $scPath description $serviceName "АИС Допобразование: локальный API, веб-сервер и супервизор процессов" | Out-Null
Grant-InteractiveServiceControl

Write-InstallStep "Регистрация интерактивного сервера для Excel и локальных окон..."
Register-WorkerTask $pathInfo
Write-InstallStep "Регистрация иконки управления при входе пользователя..."
Register-TrayTask $pathInfo
$configuration = [ordered]@{
  schemaVersion = 3
  installedAt = (Get-Date).ToUniversalTime().ToString("o")
  installedBy = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  serviceName = $serviceName
  trayTaskName = $trayTaskName
  workerTaskName = $workerTaskName
  interactiveUser = $interactiveUserName
  sourceAppRoot = $pathInfo.SourceAppRoot
  serviceAppRoot = $pathInfo.ServiceAppRoot
  protectedStopScript = $serviceStopScriptPath
  protectedController = $serviceControllerPath
  protectedTray = $serviceTrayPath
  protectedInstaller = $serviceInstallerPath
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

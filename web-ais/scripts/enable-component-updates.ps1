[CmdletBinding()]
param([string]$AppRoot = "", [switch]$Elevated, [string]$NodePath = "")
$ErrorActionPreference = "Stop"
try {
if (-not $AppRoot) { $AppRoot = Split-Path -Parent $PSScriptRoot }
if (-not $NodePath) {
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($nodeCommand) { $NodePath = $nodeCommand.Source }
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$admin = ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  $arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -AppRoot "{1}" -NodePath "{2}" -Elevated' -f $PSCommandPath, $AppRoot, $NodePath
  $process = Start-Process powershell.exe -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -PassThru -Wait
  exit $process.ExitCode
}
$target = Join-Path $env:ProgramData 'AisDopobrWeb'
$config = Get-Content -LiteralPath (Join-Path $target 'service-config.json') -Raw | ConvertFrom-Json
if ([IO.Path]::GetFullPath($AppRoot).TrimEnd('\') -ine [IO.Path]::GetFullPath($config.serviceAppRoot).TrimEnd('\')) {
  throw 'Папка не совпадает с установленной службой. Используйте её служебную папку.'
}
# ProgramData is protected by the original service installer. Do not loosen ACLs.
$item = Get-Item -LiteralPath $target -Force
if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Ссылка вместо защищённой папки.' }
$acl = Get-Acl -LiteralPath $target
foreach ($rule in $acl.Access) {
  $ruleSid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
  if ($rule.AccessControlType -eq 'Allow' -and $ruleSid -notin @('S-1-5-18','S-1-5-32-544') -and
      ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Write) -ne 0) {
    throw 'Защищённая папка разрешает запись обычным пользователям. Восстановите установку службы.'
  }
}
$node = Join-Path $AppRoot '.runtime/node/node.exe'
if (-not (Test-Path -LiteralPath $node)) { $node = $NodePath }
if (-not $node -or -not (Test-Path -LiteralPath $node)) { throw 'Не найден Node.js. Запустите установщик из работающей АИС.' }
Copy-Item -LiteralPath $node -Destination (Join-Path $target 'update-node.exe') -Force
Copy-Item -LiteralPath (Join-Path $AppRoot 'windows-update-service.js') -Destination (Join-Path $target 'windows-update-service.js') -Force
$action = New-ScheduledTaskAction -Execute (Join-Path $target 'update-node.exe') -Argument ('"{0}"' -f (Join-Path $target 'windows-update-service.js')) -WorkingDirectory $target
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$trigger = New-ScheduledTaskTrigger -AtStartup
Register-ScheduledTask -TaskName 'AisDopobrComponentUpdate' -Action $action -Principal $principal -Settings $settings -Trigger $trigger -Force | Out-Null
$account = New-Object Security.Principal.NTAccount($config.interactiveUser)
$sid = $account.Translate([Security.Principal.SecurityIdentifier]).Value
$scheduler = New-Object -ComObject 'Schedule.Service'
$scheduler.Connect()
$task = $scheduler.GetFolder('\').GetTask('AisDopobrComponentUpdate')
# The interactive user can request a signed update, but cannot edit its command.
$task.SetSecurityDescriptor("D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGX;;;$sid)", 0)
Write-Host 'Автоматическое обновление защищённых компонентов включено.'
} catch {
  if ($Elevated) {
    $log = Join-Path $env:ProgramData 'AisDopobrWeb/component-setup-error.log'
    [IO.File]::WriteAllText($log, $_.Exception.ToString(), [Text.UTF8Encoding]::new($true))
  }
  throw
}

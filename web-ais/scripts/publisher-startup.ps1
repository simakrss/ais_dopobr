function Resolve-AisPublisherStartupPath([string]$PathValue) {
  $full = [IO.Path]::GetFullPath($PathValue)
  $root = [IO.Path]::GetPathRoot($full)
  if ($root -match '^[A-Za-z]:\\$') {
    $disk = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $root.Substring(0,2) + "'")
    if ($disk -and $disk.DriveType -eq 4) {
      $full = ([string]$disk.ProviderName).TrimEnd('\') + '\' + $full.Substring($root.Length)
    } elseif (-not $disk -or $disk.DriveType -ne 3) { throw 'Startup publisher paths must be on a fixed local disk.' }
  }
  if ($full.StartsWith('\\')) {
    $match = [regex]::Match($full, '^[\\]+([^\\]+)\\+([^\\]+)(?:\\+(.*))?$')
    if (-not $match.Success -or $match.Groups[1].Value -notin @($env:COMPUTERNAME,'localhost','127.0.0.1','.')) {
      throw 'Startup publisher cannot depend on a remote share. Use a fixed local path.'
    }
    $share = Get-SmbShare -Name $match.Groups[2].Value -ErrorAction Stop
    $base = [IO.Path]::GetFullPath([string]$share.Path).TrimEnd('\')
    $full = [IO.Path]::GetFullPath((Join-Path $base $match.Groups[3].Value))
    if ($full -ine $base -and -not $full.StartsWith($base+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Publisher path is outside the local share.' }
  }
  $item = Get-Item -LiteralPath $full -ErrorAction Stop
  if ($item.Attributes -band [IO.FileAttributes]::Encrypted) { throw 'Startup publisher cannot read EFS-encrypted files without an interactive logon.' }
  return $item.FullName
}

function New-AisPublisherTaskDefinition([string]$User, [string]$PowerShell, [string]$Launcher, [string]$WorkingDirectory, [switch]$AtStartup) {
  $action = New-ScheduledTaskAction -Execute $PowerShell -Argument ('-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $Launcher + '"') -WorkingDirectory $WorkingDirectory
  $activation = if ($AtStartup) {
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $trigger.Delay = 'PT1M'
    $trigger
  } else { New-ScheduledTaskTrigger -AtLogOn -User $User }
  $triggers = @($activation, (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 3)))
  $logonType = if ($AtStartup) { 'S4U' } else { 'Interactive' }
  $principal = New-ScheduledTaskPrincipal -UserId $User -LogonType $logonType -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -RunOnlyIfNetworkAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
  return New-ScheduledTask -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Description 'Publish AIS releases from the approved GitHub branch. Verified signatures only; no stored PIN or Windows password.'
}

function Test-AisPublisherBackgroundContext([string]$User, [string]$PowerShell, [string]$Node, [string]$Script, [string]$Config, [string]$WorkingDirectory) {
  $id = [Guid]::NewGuid().ToString('N')
  $name = 'AisDopobrCentralPublisherCheck-' + $id
  $launcher = Join-Path $WorkingDirectory ($id+'.ps1')
  $quote = { param($Value) "'" + ([string]$Value).Replace("'", "''") + "'" }
  $body = '& ' + (& $quote $Node) + ' ' + (& $quote $Script) + ' --config ' + (& $quote $Config) + ' --verify-dependencies' + "`r`nexit `$LASTEXITCODE`r`n"
  [IO.File]::WriteAllText($launcher,$body,(New-Object Text.UTF8Encoding($true)))
  $action = New-ScheduledTaskAction -Execute $PowerShell -Argument ('-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$launcher+'"') -WorkingDirectory $WorkingDirectory
  $principal = New-ScheduledTaskPrincipal -UserId $User -LogonType S4U -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 3) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  $started = [DateTime]::UtcNow
  try {
    Register-ScheduledTask -TaskName $name -Action $action -Principal $principal -Settings $settings | Out-Null
    Start-ScheduledTask -TaskName $name
    $deadline = [DateTime]::UtcNow.AddSeconds(150)
    do {
      Start-Sleep -Seconds 1
      $task = Get-ScheduledTask -TaskName $name
      $info = Get-ScheduledTaskInfo -TaskName $name
      if ($task.State -ne 'Running' -and $info.LastRunTime.ToUniversalTime() -ge $started.AddSeconds(-2)) { break }
    } while ([DateTime]::UtcNow -lt $deadline)
    if ($task.State -eq 'Running') { Stop-ScheduledTask -TaskName $name; throw 'Background dependency check timed out; publication task was not changed.' }
    if ($info.LastTaskResult -ne 0) { throw ('Background dependency check failed, task result '+$info.LastTaskResult+'. See status.json; publication task was not changed.') }
    $proofFile = Get-Item -LiteralPath (Join-Path $WorkingDirectory 'background-verification.json') -ErrorAction Stop
    $proof = Get-Content -LiteralPath $proofFile.FullName -Raw | ConvertFrom-Json
    if ($proofFile.LastWriteTimeUtc -lt $started -or $proof.sessionId -ne 0 -or $proof.interactive -or -not $proof.ftpConnection -or -not $proof.packageSigning -or -not $proof.installerSignature) {
      throw 'No successful verification in non-interactive session 0; publication task was not changed.'
    }
    Write-Host 'Background session 0 verified: GitHub, FTP, existing package key and signed installer.'
  } finally {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $name -Confirm:$false }
    if (Test-Path -LiteralPath $launcher) { Remove-Item -LiteralPath $launcher }
  }
}

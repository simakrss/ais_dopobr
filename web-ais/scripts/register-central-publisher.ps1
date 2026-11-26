[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Checkout,
  [Parameter(Mandatory=$true)][string]$ProfileDirectory,
  [Parameter(Mandatory=$true)][string]$SigningKeyPath,
  [Parameter(Mandatory=$true)][string]$LocalRoot,
  [Parameter(Mandatory=$true)][string]$NodePath,
  [string]$Branch = 'codex/harden-static-serving'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'AisDopobrPublisher\central-publisher'
$checkoutPath = (Resolve-Path -LiteralPath $Checkout).Path
if ((Split-Path -Leaf $checkoutPath) -ne 'central-checkout') { throw 'Use a dedicated central-checkout directory.' }
$scriptPath = Join-Path $checkoutPath 'web-ais\scripts\central-publisher.js'
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) { throw 'Commit and fetch the publisher scripts first.' }
$git = (Get-Command git.exe).Source
$powershell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$config = [ordered]@{
  repository = 'https://github.com/simakrss/ais_dopobr.git'; branch = $Branch
  checkout = $checkoutPath; git = $git; node = (Resolve-Path -LiteralPath $NodePath).Path; powershell = $powershell
  profileDirectory = (Resolve-Path -LiteralPath $ProfileDirectory).Path
  signingKeyPath = (Resolve-Path -LiteralPath $SigningKeyPath).Path
  localRoot = (Resolve-Path -LiteralPath $LocalRoot).Path; stateDirectory = $root
}
$name = 'AisDopobrCentralPublisher'
$launcher = Join-Path $root 'run.ps1'
$existing = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
if ($existing -and @($existing.Actions | Where-Object { $_.Arguments -notlike ('*' + $launcher + '*') }).Count) { throw 'An unrelated task already uses the publisher task name.' }
[void][IO.Directory]::CreateDirectory($root)
$configPath = Join-Path $root 'config.json'
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
# Validate remote, candidate and local installation before enabling future publications.
& $config.node $scriptPath --config $configPath --check-only
if ($LASTEXITCODE -ne 0) { throw 'Publisher preflight failed; no task was registered.' }
function Quote-Literal([string]$Value) { return "'" + $Value.Replace("'", "''") + "'" }
$body = '$ErrorActionPreference = ''Stop''' + "`r`n" +
  '& ' + (Quote-Literal $config.node) + ' ' + (Quote-Literal $scriptPath) + ' --config ' + (Quote-Literal $configPath) + "`r`n" +
  'exit $LASTEXITCODE' + "`r`n"
[IO.File]::WriteAllText($launcher, $body, (New-Object Text.UTF8Encoding($true)))
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $powershell -Argument ('-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '"') -WorkingDirectory $root
$triggers = @(
  (New-ScheduledTaskTrigger -AtLogOn -User $user),
  (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 3))
)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Description 'Publish new AIS versions from the approved GitHub branch using verified signatures; never request or store a PIN.' -Force | Out-Null
Start-ScheduledTask -TaskName $name
Write-Host "Central publisher registered: $name. Checks every 3 minutes while $user is logged on."

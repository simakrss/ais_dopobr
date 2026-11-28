[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Checkout,
  [Parameter(Mandatory=$true)][string]$ProfileDirectory,
  [Parameter(Mandatory=$true)][string]$SigningKeyPath,
  [Parameter(Mandatory=$true)][string]$LocalRoot,
  [Parameter(Mandatory=$true)][string]$NodePath,
  [string]$Branch = 'codex/harden-static-serving',
  [ValidatePattern('^(?:vh[0-9]+\.timeweb\.ru)?$')][string]$FtpServer = '',
  [switch]$AtStartup
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'publisher-startup.ps1')
if ($AtStartup -and -not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Creating a startup task requires one administrator confirmation. Run registration as administrator.'
}
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
  startupMode = [bool]$AtStartup
  ftpServer = $FtpServer
}
if ($AtStartup) {
  foreach ($key in @('checkout','git','node','powershell','profileDirectory','signingKeyPath','localRoot','stateDirectory')) {
    if ($key -eq 'stateDirectory') { [void][IO.Directory]::CreateDirectory($config[$key]) }
    $config[$key] = Resolve-AisPublisherStartupPath $config[$key]
  }
  $scriptPath = Join-Path $config.checkout 'web-ais\scripts\central-publisher.js'
}
$name = 'AisDopobrCentralPublisher'
$launcher = Join-Path $root 'run.ps1'
$existing = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
if ($existing -and @($existing.Actions | Where-Object { $_.Arguments -notlike ('*' + $launcher + '*') }).Count) { throw 'An unrelated task already uses the publisher task name.' }
if ($existing -and $existing.State -eq 'Running') { throw 'Publisher is running; wait for its current operation before registration.' }
[void][IO.Directory]::CreateDirectory($root)
$configPath = Join-Path $root 'config.json'
if (Test-Path -LiteralPath $configPath) { Copy-Item -LiteralPath $configPath -Destination (Join-Path $root ('config-before-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmss')+'.json')) }
if ($existing) { Export-ScheduledTask -TaskName $name | Set-Content -LiteralPath (Join-Path $root ('task-before-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmss')+'.xml')) -Encoding Unicode }
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
if ($AtStartup) {
  if ($existing) { Disable-ScheduledTask -TaskName $name | Out-Null }
  try { Test-AisPublisherBackgroundContext -User $user -PowerShell $powershell -Node $config.node -Script $scriptPath -Config $configPath -WorkingDirectory $root }
  finally { if ($existing -and $existing.Settings.Enabled) { Enable-ScheduledTask -TaskName $name | Out-Null } }
}
$definition = New-AisPublisherTaskDefinition -User $user -PowerShell $powershell -Launcher $launcher -WorkingDirectory $root -AtStartup:$AtStartup
Register-ScheduledTask -TaskName $name -InputObject $definition -Force | Out-Null
Start-ScheduledTask -TaskName $name
if ($AtStartup) { Write-Host "Central publisher registered: $name. Starts after Windows boot without sign-in; checks every 3 minutes." }
else { Write-Host "Central publisher registered: $name. Checks every 3 minutes while $user is logged on." }

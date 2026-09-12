[CmdletBinding()]
param(
  [ValidateSet("Install", "Uninstall", "Validate")]
  [string]$Action = "Install",
  [string]$AppRoot = "",
  [string]$InteractiveAppRoot = "",
  [string]$InteractiveUser = "",
  [switch]$StartService,
  [switch]$StartTray,
  [switch]$Elevated,
  [switch]$AsJson
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$setupPath = Join-Path $PSScriptRoot "setup-ais-windows-service.ps1"
if (-not (Test-Path -LiteralPath $setupPath -PathType Leaf)) {
  throw "Не найден актуальный установщик службы: $setupPath"
}

$forwarded = @{
  Action = $Action
  AppRoot = $AppRoot
  InteractiveAppRoot = $InteractiveAppRoot
  InteractiveUser = $InteractiveUser
  StartService = $StartService
  StartTray = $StartTray
  Elevated = $Elevated
  AsJson = $AsJson
}
& $setupPath @forwarded

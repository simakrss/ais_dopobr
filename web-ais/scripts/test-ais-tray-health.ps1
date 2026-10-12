[CmdletBinding()]
param()

# Execute only the health/state functions with in-memory tasks and fake UI/service.
# No service control, notifications, network requests or temporary files.
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms

$trayPath = Join-Path $PSScriptRoot "ais-service-tray.ps1"
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($trayPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors.Message -join "`n") }
foreach ($name in @("Register-HealthProbeResult", "Complete-HealthProbe", "Update-HealthProbe", "Set-TrayVisual", "Update-TrayState")) {
  $definition = $ast.Find({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
  }, $true)
  if (-not $definition) { throw "Missing function: $name" }
  . ([scriptblock]::Create($definition.Extent.Text))
}

function Assert-Equal($Actual, $Expected, [string]$Message) {
  if ($Actual -cne $Expected) { throw "$Message (actual: $Actual; expected: $Expected)" }
}
function Get-Service { param($Name, $ErrorAction) return [pscustomobject]@{ Status = $script:testServiceState } }
function Write-TrayError([string]$Message) { throw $Message }
function Write-TrayReadyMarker([string]$State, [string]$ServiceStatus) { $script:markerState = $State }
function Show-TrayMessage([string]$Title, [string]$Message, $Icon) { [void]$script:messages.Add($Message) }

function Reset-TestState {
  $script:testServiceState = "Running"
  $script:lastHealth = $false
  $script:healthFailures = 0
  $script:healthSuccesses = 0
  $script:healthUnavailable = $false
  $script:healthTask = $null
  $script:lastVisualState = $null
  $script:markerState = ""
  $script:aboutStatus = $null
  $script:messages = New-Object 'Collections.Generic.List[string]'
  $script:notifyIcon = [pscustomobject]@{ Icon = $null; Text = "" }
  $script:stateIcons = @{ running = "green"; pending = "pending"; stopped = "gray"; missing = "missing" }
  $script:statusItem = [pscustomobject]@{ Text = "" }
  $script:startItem = [pscustomobject]@{ Enabled = $false }
  $script:stopItem = [pscustomobject]@{ Enabled = $false }
  $script:restartItem = [pscustomobject]@{ Enabled = $false }
  $script:exitItem = [pscustomobject]@{ Enabled = $false }
  $script:throwOnRequest = $false
  $script:requestCount = 0
  $script:cancelCount = 0
  $script:lastRequest = $null
  $script:httpClient = New-Object psobject
  $script:httpClient | Add-Member ScriptMethod GetStringAsync {
    param($Uri)
    $script:requestCount++
    if ($script:throwOnRequest) { throw "Simulated synchronous HTTP failure" }
    $script:lastRequest = New-Object 'Threading.Tasks.TaskCompletionSource[string]'
    return $script:lastRequest.Task
  }
  $script:httpClient | Add-Member ScriptMethod CancelPendingRequests { $script:cancelCount++ }
}

function Complete-TestProbe([string]$Result) {
  $completion = New-Object 'Threading.Tasks.TaskCompletionSource[string]'
  if ($Result -eq "timeout") {
    $completion.SetException([TimeoutException]::new("Simulated timeout"))
  } else {
    $completion.SetResult($Result)
  }
  $script:healthTask = $completion.Task
  Update-TrayState
}

$serviceName = "AisDopobrWeb"
$healthUrl = "http://127.0.0.1:8081/api/health"
$source = [IO.File]::ReadAllText($trayPath)
if ($source -notmatch '\$script:httpClient.Timeout = \[TimeSpan\]::FromSeconds\(5\)') {
  throw "The asynchronous health timeout must allow a 5-second response"
}

Reset-TestState
Complete-TestProbe '{"ok":true}'
Assert-Equal $script:lastHealth $true "First successful startup probe is accepted immediately"
Assert-Equal $script:messages.Count 0 "Do not announce initial healthy state"
for ($cycle = 0; $cycle -lt 10; $cycle++) {
  Complete-TestProbe "timeout"
  Complete-TestProbe '{"ok":false}'
  Assert-Equal $script:markerState "running" "Two failures must not change the confirmed running state"
  Complete-TestProbe '{"ok":true}'
}
Assert-Equal $script:messages.Count 0 "Intermittent failures must not spam the tray"
Assert-Equal $script:healthFailures 0 "Success resets consecutive failures"
Assert-Equal $script:exitItem.Enabled $false "Exit remains disabled while the service runs"

Complete-TestProbe "timeout"
Complete-TestProbe "malformed health response"
Complete-TestProbe "timeout"
Assert-Equal $script:markerState "pending" "Three failures confirm unavailability"
Assert-Equal $script:healthUnavailable $true "Outage is latched until recovery"
Assert-Equal $script:messages.Count 1 "Announce a confirmed outage only once"
if ($script:statusItem.Text -notmatch 'сервер не отвечает') { throw "Do not mislabel an outage as a restart" }
for ($i = 0; $i -lt 5; $i++) { Complete-TestProbe "timeout" }
Assert-Equal $script:messages.Count 1 "Continued unavailability must not repeat notifications"
Complete-TestProbe '{"ok":true}'
Assert-Equal $script:markerState "pending" "One success is not stable recovery"
Assert-Equal $script:messages.Count 1 "Do not announce startup during recovery"
Complete-TestProbe "timeout"
Complete-TestProbe '{"ok":true}'
Assert-Equal $script:markerState "pending" "Recovery requires consecutive successful probes"
Complete-TestProbe '{"ok":true}'
Assert-Equal $script:markerState "running" "Two successes restore the running state"
Assert-Equal $script:messages.Count 2 "Announce recovery only once"
Complete-TestProbe '{"ok":true}'
Assert-Equal $script:messages.Count 2 "Stable health is quiet"

# In-flight HTTP must not block the UI, count as failure, or spawn extra requests.
Reset-TestState
Update-TrayState
for ($i = 0; $i -lt 20; $i++) { Update-TrayState }
Assert-Equal $script:requestCount 1 "Only one HTTP probe may be in flight"
Assert-Equal $script:healthFailures 0 "A pending task is not a failed request"
$script:lastRequest.SetResult('{"ok":true}')
Update-TrayState
Assert-Equal $script:markerState "running" "A slow successful request is accepted"
Assert-Equal $script:requestCount 2 "Start the next probe only after completing the previous one"

# Service stop is immediate and must invalidate late replies from the old instance.
$oldRequest = $script:lastRequest
$script:testServiceState = "Stopped"
Update-TrayState
Assert-Equal $script:markerState "stopped" "A real service stop is never delayed by HTTP hysteresis"
Assert-Equal $script:lastHealth $false "Stopped services cannot retain a healthy result"
Assert-Equal $script:healthTask $null "Drop the old in-flight task"
Assert-Equal $script:cancelCount 1 "Cancel the old instance request"
Assert-Equal $script:exitItem.Enabled $true "Exit becomes available after a real stop"
Assert-Equal $script:healthFailures 0 "Reset the previous outage counters"
$script:testServiceState = "StartPending"
Update-TrayState
Assert-Equal $script:markerState "pending" "A real service start is shown immediately"
Assert-Equal $script:requestCount 2 "Do not query a service until it is Running"
$script:testServiceState = "Running"
Update-TrayState
$oldRequest.SetResult('{"ok":true}')
Update-TrayState
Assert-Equal $script:lastHealth $false "Ignore success from a previous service instance"
$script:lastRequest.SetResult('{"ok":true}')
Update-TrayState
Assert-Equal $script:markerState "running" "The new instance must provide its own healthy response"
$script:testServiceState = "StopPending"
Update-TrayState
Assert-Equal $script:markerState "pending" "A real service stop-in-progress is shown immediately"
Assert-Equal $script:exitItem.Enabled $false "Exit is not allowed while the service is stopping"

Reset-TestState
Complete-TestProbe '{"ok":true}'
$script:healthTask = $null
$script:throwOnRequest = $true
Update-TrayState
Update-TrayState
Assert-Equal $script:markerState "running" "Synchronous request errors use the same failure threshold"
Update-TrayState
Assert-Equal $script:markerState "pending" "Three synchronous failures confirm the outage"
Assert-Equal $script:messages.Count 1 "Synchronous failures generate only one outage notification"

Write-Host "PASS: 5s timeout, isolated failures, confirmed outage, stable recovery, notification deduplication, async single-flight, immediate service states and stale-result cancellation."

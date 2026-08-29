[CmdletBinding()]
param(
  [string]$AppRoot = ""
)

$env:PSModulePath = [IO.Path]::Combine($PSHOME, "Modules")
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$utf8 = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

$serviceName = "AisDopobrWeb"
$localUrl = "http://127.0.0.1:8081/"
$healthUrl = "http://127.0.0.1:8081/api/health"
$powerShellPath = Join-Path ([Environment]::SystemDirectory) "WindowsPowerShell\v1.0\powershell.exe"
$controlScript = Join-Path $PSScriptRoot "control-ais-service.ps1"
$logViewerScript = Join-Path $PSScriptRoot "show-ais-service-log.ps1"
$resolvedAppRoot = if ([string]::IsNullOrWhiteSpace($AppRoot)) {
  Split-Path -Parent $PSScriptRoot
} else {
  $AppRoot
}
$resolvedAppRoot = [IO.Path]::GetFullPath($resolvedAppRoot)
$logDirectory = Join-Path $resolvedAppRoot "tmp\lan-system"

function Quote-ProcessArgument([string]$Value) {
  if ($null -eq $Value -or $Value.Length -eq 0) { return '""' }
  if ($Value -notmatch '[\s"]') { return $Value }
  $escaped = [regex]::Replace($Value, '(\\*)"', '${1}${1}\"')
  $escaped = [regex]::Replace($escaped, '(\\+)$', '${1}${1}')
  return '"' + $escaped + '"'
}

if ([Threading.Thread]::CurrentThread.ApartmentState -ne [Threading.ApartmentState]::STA) {
  $relaunchArguments = @(
    "-NoLogo", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
    "-File", $PSCommandPath, "-AppRoot", $resolvedAppRoot
  ) | ForEach-Object { Quote-ProcessArgument $_ }
  Start-Process -FilePath $powerShellPath -ArgumentList ($relaunchArguments -join " ") -WindowStyle Hidden | Out-Null
  exit 0
}

$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$mutexName = "Local\AisDopobrServiceTray_$($currentSid.Replace('-', '_'))"
$createdNew = $false
$trayMutex = [Threading.Mutex]::new($true, $mutexName, [ref]$createdNew)
if (-not $createdNew) {
  $trayMutex.Dispose()
  exit 0
}

$script:ownsMutex = $true
$script:cleanupStarted = $false
$script:notifyIcon = $null
$script:contextMenu = $null
$script:applicationContext = $null
$script:pollTimer = $null
$script:httpHandler = $null
$script:httpClient = $null
$script:healthTask = $null
$script:lastHealth = $false
$script:lastVisualState = $null
$script:stateIcons = @{}
$script:statusItem = $null
$script:startItem = $null
$script:stopItem = $null
$script:restartItem = $null

function Write-TrayError([string]$Message) {
  try {
    [void][IO.Directory]::CreateDirectory($logDirectory)
    $line = "[{0}] {1}{2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message, [Environment]::NewLine
    [IO.File]::AppendAllText((Join-Path $logDirectory "tray-error.log"), $line, $utf8)
  } catch {
    # The tray must stay available even if its diagnostic log cannot be written.
  }
}

function New-StateIcon([Drawing.Color]$Color) {
  $bitmap = New-Object Drawing.Bitmap 32, 32
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $fillBrush = New-Object Drawing.SolidBrush $Color
  $borderPen = New-Object Drawing.Pen ([Drawing.Color]::FromArgb(225, 255, 255, 255)), 2
  $shadowPen = New-Object Drawing.Pen ([Drawing.Color]::FromArgb(110, 15, 23, 42)), 1
  $highlightBrush = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(225, 255, 255, 255))
  $iconHandle = [IntPtr]::Zero
  try {
    $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([Drawing.Color]::Transparent)
    $graphics.FillEllipse($fillBrush, 3, 3, 26, 26)
    $graphics.DrawEllipse($shadowPen, 3, 3, 26, 26)
    $graphics.DrawEllipse($borderPen, 6, 6, 20, 20)
    $graphics.FillEllipse($highlightBrush, 12, 12, 8, 8)
    $iconHandle = $bitmap.GetHicon()
    $temporaryIcon = [Drawing.Icon]::FromHandle($iconHandle)
    return [Drawing.Icon]$temporaryIcon.Clone()
  } finally {
    if ($iconHandle -ne [IntPtr]::Zero) {
      [void][AisDopobr.Tray.NativeMethods]::DestroyIcon($iconHandle)
    }
    $highlightBrush.Dispose()
    $shadowPen.Dispose()
    $borderPen.Dispose()
    $fillBrush.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function Show-TrayMessage(
  [string]$Title,
  [string]$Message,
  [Windows.Forms.ToolTipIcon]$Icon = [Windows.Forms.ToolTipIcon]::Info
) {
  if ($null -eq $script:notifyIcon -or -not $script:notifyIcon.Visible) { return }
  try {
    $script:notifyIcon.ShowBalloonTip(2500, $Title, $Message, $Icon)
  } catch {
    Write-TrayError $_.Exception.Message
  }
}

function Start-DetachedPowerShell(
  [string]$ScriptPath,
  [string[]]$Arguments,
  [bool]$Hidden
) {
  if (-not (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) {
    throw "Не найден сценарий: $ScriptPath"
  }
  $processArguments = New-Object Collections.Generic.List[string]
  $processArguments.Add("-NoLogo")
  $processArguments.Add("-NoProfile")
  $processArguments.Add("-ExecutionPolicy")
  $processArguments.Add("Bypass")
  if ($Hidden) {
    $processArguments.Add("-WindowStyle")
    $processArguments.Add("Hidden")
  }
  $processArguments.Add("-File")
  $processArguments.Add($ScriptPath)
  foreach ($argument in $Arguments) { $processArguments.Add($argument) }

  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $powerShellPath
  $startInfo.Arguments = (@($processArguments) | ForEach-Object { Quote-ProcessArgument $_ }) -join " "
  $startInfo.WorkingDirectory = $resolvedAppRoot
  $startInfo.UseShellExecute = $true
  $startInfo.WindowStyle = if ($Hidden) {
    [Diagnostics.ProcessWindowStyle]::Hidden
  } else {
    [Diagnostics.ProcessWindowStyle]::Normal
  }
  [Diagnostics.Process]::Start($startInfo) | Out-Null
}

function Invoke-ControlAction([string]$Action) {
  try {
    $arguments = New-Object Collections.Generic.List[string]
    $arguments.Add("-Action")
    $arguments.Add($Action)
    Start-DetachedPowerShell -ScriptPath $controlScript -Arguments @($arguments) -Hidden $true
    Show-TrayMessage "АИС Допобразование" "Команда «$Action» отправлена."
  } catch {
    Write-TrayError $_.Exception.ToString()
    Show-TrayMessage "Ошибка управления АИС" $_.Exception.Message ([Windows.Forms.ToolTipIcon]::Error)
  }
}

function Open-Ais {
  try {
    Start-Process $localUrl | Out-Null
  } catch {
    Write-TrayError $_.Exception.ToString()
    Show-TrayMessage "Не удалось открыть АИС" $_.Exception.Message ([Windows.Forms.ToolTipIcon]::Error)
  }
}

function Open-LogTerminal {
  try {
    Start-DetachedPowerShell -ScriptPath $logViewerScript -Arguments @("-AppRoot", $resolvedAppRoot) -Hidden $false
  } catch {
    Write-TrayError $_.Exception.ToString()
    Show-TrayMessage "Не удалось открыть журнал" $_.Exception.Message ([Windows.Forms.ToolTipIcon]::Error)
  }
}

function Open-LogDirectory {
  try {
    [void][IO.Directory]::CreateDirectory($logDirectory)
    Start-Process -FilePath "explorer.exe" -ArgumentList (Quote-ProcessArgument $logDirectory) | Out-Null
  } catch {
    Write-TrayError $_.Exception.ToString()
    Show-TrayMessage "Не удалось открыть папку журналов" $_.Exception.Message ([Windows.Forms.ToolTipIcon]::Error)
  }
}

function Complete-HealthProbe {
  if ($null -eq $script:healthTask -or -not $script:healthTask.IsCompleted) { return }
  try {
    $responseText = $script:healthTask.GetAwaiter().GetResult()
    $script:lastHealth = [bool]($responseText -match '"ok"\s*:\s*true')
  } catch {
    $script:lastHealth = $false
  } finally {
    try { $script:healthTask.Dispose() } catch { }
    $script:healthTask = $null
  }
}

function Update-HealthProbe([bool]$ServiceIsRunning) {
  Complete-HealthProbe
  if (-not $ServiceIsRunning) {
    $script:lastHealth = $false
    if ($null -ne $script:healthTask) {
      try { $script:httpClient.CancelPendingRequests() } catch { }
    }
    return
  }
  if ($null -eq $script:healthTask) {
    try {
      $script:healthTask = $script:httpClient.GetStringAsync([Uri]$healthUrl)
    } catch {
      $script:lastHealth = $false
      $script:healthTask = $null
    }
  }
}

function Set-TrayVisual(
  [string]$State,
  [string]$StatusText,
  [string]$ToolTip,
  [bool]$Installed,
  [string]$ServiceStatus
) {
  $script:notifyIcon.Icon = $script:stateIcons[$State]
  $script:notifyIcon.Text = $ToolTip
  $script:statusItem.Text = "Состояние: $StatusText"

  $isPending = $ServiceStatus -in @("StartPending", "StopPending", "ContinuePending", "PausePending")
  $script:startItem.Enabled = (-not $isPending) -and ((-not $Installed) -or $ServiceStatus -eq "Stopped")
  $script:stopItem.Enabled = $Installed -and (-not $isPending) -and $ServiceStatus -ne "Stopped"
  $script:restartItem.Enabled = $Installed -and (-not $isPending)

  $visualState = "$State|$StatusText"
  if ($null -ne $script:lastVisualState -and $script:lastVisualState -ne $visualState) {
    $balloonIcon = switch ($State) {
      "running" { [Windows.Forms.ToolTipIcon]::Info }
      "pending" { [Windows.Forms.ToolTipIcon]::Warning }
      "stopped" { [Windows.Forms.ToolTipIcon]::Warning }
      default { [Windows.Forms.ToolTipIcon]::Error }
    }
    Show-TrayMessage "АИС Допобразование" $StatusText $balloonIcon
  }
  $script:lastVisualState = $visualState
}

function Update-TrayState {
  try {
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($null -eq $service) {
      Update-HealthProbe $false
      Set-TrayVisual "missing" "служба не установлена" "АИС: служба не установлена" $false "NotInstalled"
      return
    }

    $serviceStatus = [string]$service.Status
    $isRunning = $serviceStatus -eq "Running"
    Update-HealthProbe $isRunning

    if ($isRunning -and $script:lastHealth) {
      Set-TrayVisual "running" "система работает" "АИС: система работает" $true $serviceStatus
    } elseif ($isRunning) {
      Set-TrayVisual "pending" "служба работает, интерфейс запускается" "АИС: интерфейс запускается" $true $serviceStatus
    } elseif ($serviceStatus -in @("StartPending", "ContinuePending")) {
      Set-TrayVisual "pending" "служба запускается" "АИС: служба запускается" $true $serviceStatus
    } elseif ($serviceStatus -eq "StopPending") {
      Set-TrayVisual "pending" "служба останавливается" "АИС: служба останавливается" $true $serviceStatus
    } elseif ($serviceStatus -eq "Stopped") {
      Set-TrayVisual "stopped" "система остановлена" "АИС: система остановлена" $true $serviceStatus
    } else {
      Set-TrayVisual "stopped" "состояние службы: $serviceStatus" "АИС: требуется проверка" $true $serviceStatus
    }
  } catch {
    Write-TrayError $_.Exception.ToString()
    if ($null -ne $script:notifyIcon) {
      Set-TrayVisual "missing" "ошибка проверки состояния" "АИС: ошибка проверки" $false "Unknown"
    }
  }
}

function Stop-TrayResources {
  if ($script:cleanupStarted) { return }
  $script:cleanupStarted = $true

  if ($null -ne $script:pollTimer) {
    try { $script:pollTimer.Stop() } catch { }
    try { $script:pollTimer.Dispose() } catch { }
  }
  if ($null -ne $script:httpClient) {
    try { $script:httpClient.CancelPendingRequests() } catch { }
    try { $script:httpClient.Dispose() } catch { }
  }
  if ($null -ne $script:httpHandler) {
    try { $script:httpHandler.Dispose() } catch { }
  }
  if ($null -ne $script:notifyIcon) {
    try { $script:notifyIcon.Visible = $false } catch { }
    try { $script:notifyIcon.Dispose() } catch { }
  }
  if ($null -ne $script:contextMenu) {
    try { $script:contextMenu.Dispose() } catch { }
  }
  foreach ($icon in @($script:stateIcons.Values)) {
    if ($null -ne $icon) {
      try { $icon.Dispose() } catch { }
    }
  }
  if ($null -ne $script:applicationContext) {
    try { $script:applicationContext.Dispose() } catch { }
  }
  if ($script:ownsMutex) {
    try { $trayMutex.ReleaseMutex() } catch { }
    $script:ownsMutex = $false
  }
  try { $trayMutex.Dispose() } catch { }
}

try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  Add-Type -AssemblyName System.Net.Http
  if (-not ("AisDopobr.Tray.NativeMethods" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace AisDopobr.Tray
{
    public static class NativeMethods
    {
        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool DestroyIcon(IntPtr handle);
    }
}
"@
  }

  [void][IO.Directory]::CreateDirectory($logDirectory)
  [Windows.Forms.Application]::EnableVisualStyles()
  [Windows.Forms.Application]::SetCompatibleTextRenderingDefault($false)

  $script:stateIcons = @{
    running = New-StateIcon ([Drawing.Color]::FromArgb(22, 163, 74))
    pending = New-StateIcon ([Drawing.Color]::FromArgb(245, 158, 11))
    stopped = New-StateIcon ([Drawing.Color]::FromArgb(220, 38, 38))
    missing = New-StateIcon ([Drawing.Color]::FromArgb(100, 116, 139))
  }

  $script:contextMenu = New-Object Windows.Forms.ContextMenuStrip
  $script:statusItem = New-Object Windows.Forms.ToolStripMenuItem "Состояние: проверка..."
  $script:statusItem.Enabled = $false
  $openItem = New-Object Windows.Forms.ToolStripMenuItem "Открыть АИС"
  $script:startItem = New-Object Windows.Forms.ToolStripMenuItem "Запустить"
  $script:stopItem = New-Object Windows.Forms.ToolStripMenuItem "Остановить"
  $script:restartItem = New-Object Windows.Forms.ToolStripMenuItem "Перезапустить"
  $terminalItem = New-Object Windows.Forms.ToolStripMenuItem "Окно терминала запуска"
  $folderItem = New-Object Windows.Forms.ToolStripMenuItem "Открыть папку журналов"
  $exitItem = New-Object Windows.Forms.ToolStripMenuItem "Выход из трея"

  $openItem.add_Click({ Open-Ais })
  $script:startItem.add_Click({ Invoke-ControlAction "Start" })
  $script:stopItem.add_Click({ Invoke-ControlAction "Stop" })
  $script:restartItem.add_Click({ Invoke-ControlAction "Restart" })
  $terminalItem.add_Click({ Open-LogTerminal })
  $folderItem.add_Click({ Open-LogDirectory })
  $exitItem.add_Click({
    $script:notifyIcon.Visible = $false
    $script:applicationContext.ExitThread()
  })

  [void]$script:contextMenu.Items.Add($script:statusItem)
  [void]$script:contextMenu.Items.Add($openItem)
  [void]$script:contextMenu.Items.Add((New-Object Windows.Forms.ToolStripSeparator))
  [void]$script:contextMenu.Items.Add($script:startItem)
  [void]$script:contextMenu.Items.Add($script:stopItem)
  [void]$script:contextMenu.Items.Add($script:restartItem)
  [void]$script:contextMenu.Items.Add((New-Object Windows.Forms.ToolStripSeparator))
  [void]$script:contextMenu.Items.Add($terminalItem)
  [void]$script:contextMenu.Items.Add($folderItem)
  [void]$script:contextMenu.Items.Add((New-Object Windows.Forms.ToolStripSeparator))
  [void]$script:contextMenu.Items.Add($exitItem)

  $script:notifyIcon = New-Object Windows.Forms.NotifyIcon
  $script:notifyIcon.ContextMenuStrip = $script:contextMenu
  $script:notifyIcon.Icon = $script:stateIcons.missing
  $script:notifyIcon.Text = "АИС: проверка состояния"
  $script:notifyIcon.Visible = $true
  $script:notifyIcon.add_MouseDoubleClick({
    param($sender, $eventArgs)
    if ($eventArgs.Button -eq [Windows.Forms.MouseButtons]::Left) {
      Open-Ais
    }
  })

  $script:httpHandler = New-Object Net.Http.HttpClientHandler
  $script:httpHandler.UseProxy = $false
  $script:httpClient = New-Object Net.Http.HttpClient $script:httpHandler
  $script:httpClient.Timeout = [TimeSpan]::FromMilliseconds(1400)

  $script:applicationContext = New-Object Windows.Forms.ApplicationContext
  $script:pollTimer = New-Object Windows.Forms.Timer
  $script:pollTimer.Interval = 1800
  $script:pollTimer.add_Tick({ Update-TrayState })
  Update-TrayState
  $script:pollTimer.Start()

  [Windows.Forms.Application]::Run($script:applicationContext)
} catch {
  Write-TrayError $_.Exception.ToString()
  try {
    [Windows.Forms.MessageBox]::Show(
      "Не удалось запустить значок АИС в системном трее.`r`n`r`n$($_.Exception.Message)",
      "АИС Допобразование",
      [Windows.Forms.MessageBoxButtons]::OK,
      [Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
  } catch { }
  exit 1
} finally {
  Stop-TrayResources
}

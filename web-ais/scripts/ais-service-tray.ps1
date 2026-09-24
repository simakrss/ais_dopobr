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
$wscriptPath = Join-Path ([Environment]::SystemDirectory) "wscript.exe"
$controlScript = Join-Path $PSScriptRoot "control-ais-service.ps1"
$logViewerScript = Join-Path $PSScriptRoot "show-ais-service-log.ps1"
$hiddenProcessPath = Join-Path $PSScriptRoot "ais-hidden-process.vbs"
$resolvedAppRoot = if ([string]::IsNullOrWhiteSpace($AppRoot)) {
  Split-Path -Parent $PSScriptRoot
} else {
  $AppRoot
}
$resolvedAppRoot = [IO.Path]::GetFullPath($resolvedAppRoot)
$logDirectory = Join-Path $resolvedAppRoot "tmp\lan-system"
$faviconPath = Join-Path $resolvedAppRoot "favicon.ico"
$trayReadyPath = Join-Path $logDirectory "tray-ready.json"

function Quote-ProcessArgument([string]$Value) {
  if ($null -eq $Value -or $Value.Length -eq 0) { return '""' }
  if ($Value -notmatch '[\s"]') { return $Value }
  $escaped = [regex]::Replace($Value, '(\\*)"', '${1}${1}\"')
  $escaped = [regex]::Replace($escaped, '(\\+)$', '${1}${1}')
  return '"' + $escaped + '"'
}

function Start-HiddenPowerShell([string[]]$Arguments) {
  if (-not (Test-Path -LiteralPath $hiddenProcessPath -PathType Leaf)) {
    throw "Не найден безоконный хост: $hiddenProcessPath"
  }
  $launcherArguments = @(
    "//B", "//NoLogo", $hiddenProcessPath, $resolvedAppRoot, $powerShellPath
  ) + @($Arguments)
  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $wscriptPath
  $startInfo.Arguments = (@($launcherArguments) | ForEach-Object {
    Quote-ProcessArgument ([string]$_)
  }) -join " "
  $startInfo.WorkingDirectory = $resolvedAppRoot
  $startInfo.UseShellExecute = $true
  $startInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
  $process = [Diagnostics.Process]::Start($startInfo)
  if ($null -eq $process) { throw "Не удалось запустить скрытый процесс PowerShell." }
  return $process
}

if ([Threading.Thread]::CurrentThread.ApartmentState -ne [Threading.ApartmentState]::STA) {
  $relaunchArguments = @(
    "-NoLogo", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
    "-File", $PSCommandPath, "-AppRoot", $resolvedAppRoot
  )
  $relaunchProcess = Start-HiddenPowerShell $relaunchArguments
  $relaunchProcess.Dispose()
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
$script:lastReadyMarkerState = $null
$script:stateIcons = @{}
$script:statusItem = $null
$script:startItem = $null
$script:stopItem = $null
$script:restartItem = $null
$script:exitItem = $null
$script:aboutForm = $null
$script:aboutStatus = $null

function Write-TrayError([string]$Message) {
  try {
    [void][IO.Directory]::CreateDirectory($logDirectory)
    $line = "[{0}] {1}{2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message, [Environment]::NewLine
    [IO.File]::AppendAllText((Join-Path $logDirectory "tray-error.log"), $line, $utf8)
  } catch {
    # The tray must stay available even if its diagnostic log cannot be written.
  }
}

function Write-TrayReadyMarker([string]$State, [string]$ServiceStatus) {
  $markerState = "$State|$ServiceStatus"
  if ($script:lastReadyMarkerState -eq $markerState) { return }
  try {
    [void][IO.Directory]::CreateDirectory($logDirectory)
    $document = [ordered]@{
      schemaVersion = 1
      processId = $PID
      state = $State
      serviceStatus = $ServiceStatus
      readyAt = (Get-Date).ToUniversalTime().ToString("o")
    }
    [IO.File]::WriteAllText(
      $trayReadyPath,
      (($document | ConvertTo-Json -Compress) + [Environment]::NewLine),
      $utf8
    )
    $script:lastReadyMarkerState = $markerState
  } catch {
    Write-TrayError "Не удалось обновить маркер готовности трея: $($_.Exception.Message)"
  }
}

function Remove-TrayReadyMarker {
  try {
    if (-not (Test-Path -LiteralPath $trayReadyPath -PathType Leaf)) { return }
    $marker = Get-Content -LiteralPath $trayReadyPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([int]$marker.processId -eq $PID) {
      [IO.File]::Delete($trayReadyPath)
    }
  } catch {
    # A stale marker is ignored and replaced by the next tray instance.
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

function New-FaviconStateIcon([string]$Path, [bool]$Grayscale) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Не найден значок АИС: $Path"
  }
  $source = $null
  $bitmap = $null
  $graphics = $null
  $iconHandle = [IntPtr]::Zero
  try {
    $source = [Drawing.Image]::FromFile($Path)
    $bitmap = [Drawing.Bitmap]::new(32, 32, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $graphics.Clear([Drawing.Color]::Transparent)
    $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
    $graphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.DrawImage($source, [Drawing.Rectangle]::new(0, 0, 32, 32))
    $graphics.Dispose()
    $graphics = $null

    if ($Grayscale) {
      for ($x = 0; $x -lt $bitmap.Width; $x += 1) {
        for ($y = 0; $y -lt $bitmap.Height; $y += 1) {
          $pixel = $bitmap.GetPixel($x, $y)
          if ($pixel.A -eq 0) { continue }
          $luminance = [Math]::Max(0, [Math]::Min(255, [int][Math]::Round(
            (0.299 * $pixel.R) + (0.587 * $pixel.G) + (0.114 * $pixel.B)
          )))
          $bitmap.SetPixel($x, $y, [Drawing.Color]::FromArgb(
            $pixel.A, $luminance, $luminance, $luminance
          ))
        }
      }
    }

    $iconHandle = $bitmap.GetHicon()
    $temporaryIcon = [Drawing.Icon]::FromHandle($iconHandle)
    return [Drawing.Icon]$temporaryIcon.Clone()
  } finally {
    if ($iconHandle -ne [IntPtr]::Zero) {
      [void][AisDopobr.Tray.NativeMethods]::DestroyIcon($iconHandle)
    }
    if ($null -ne $graphics) { $graphics.Dispose() }
    if ($null -ne $bitmap) { $bitmap.Dispose() }
    if ($null -ne $source) { $source.Dispose() }
  }
}

function New-AisStateIcon([bool]$Grayscale, [Drawing.Color]$FallbackColor) {
  try {
    return New-FaviconStateIcon -Path $faviconPath -Grayscale $Grayscale
  } catch {
    Write-TrayError "Не удалось подготовить favicon для трея: $($_.Exception.Message)"
    return New-StateIcon $FallbackColor
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
    $processArguments.Add("-NonInteractive")
    $processArguments.Add("-WindowStyle")
    $processArguments.Add("Hidden")
  }
  $processArguments.Add("-File")
  $processArguments.Add($ScriptPath)
  foreach ($argument in $Arguments) { $processArguments.Add($argument) }

  if ($Hidden) {
    $process = Start-HiddenPowerShell @($processArguments)
    $process.Dispose()
    return
  }

  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $powerShellPath
  $startInfo.Arguments = (@($processArguments) | ForEach-Object { Quote-ProcessArgument $_ }) -join " "
  $startInfo.WorkingDirectory = $resolvedAppRoot
  $startInfo.UseShellExecute = $true
  $startInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Normal
  [Diagnostics.Process]::Start($startInfo) | Out-Null
}

function Invoke-ControlAction([string]$Action) {
  try {
    if ($null -ne $script:exitItem) {
      $script:exitItem.Enabled = $false
    }
    $arguments = New-Object Collections.Generic.List[string]
    $arguments.Add("-Action")
    $arguments.Add($Action)
    Start-DetachedPowerShell -ScriptPath $controlScript -Arguments @($arguments) -Hidden $true
    Show-TrayMessage "АИС Допобразование" "Команда «$Action» отправлена."
  } catch {
    Write-TrayError $_.Exception.ToString()
    Update-TrayState
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

function Get-AisReleaseInformation([string]$Root) {
  $release = [ordered]@{ Version = "Не определена"; ReleaseDate = "Не определена" }
  try {
    # Read the same release declaration as the web interface, without executing JavaScript.
    $source = [IO.File]::ReadAllText((Join-Path $Root "app.js"), [Text.Encoding]::UTF8)
    $declaration = [regex]::Match($source, '(?s)\bconst\s+APPLICATION_RELEASE\s*=\s*Object\.freeze\(\s*\{(?<body>.*?)\}\s*\)')
    if ($declaration.Success) {
      $body = $declaration.Groups["body"].Value
      $version = [regex]::Match($body, 'version\s*:\s*["''](?<value>\d+\.\d+\.\d+)["'']')
      if ($version.Success) { $release.Version = $version.Groups["value"].Value }
      $date = [regex]::Match($body, 'releasedAt\s*:\s*["''](?<value>\d{4}-\d{2}-\d{2})["'']')
      $parsedDate = [datetime]::MinValue
      if ($date.Success -and [datetime]::TryParseExact(
        $date.Groups["value"].Value, "yyyy-MM-dd", [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::None, [ref]$parsedDate
      )) {
        $release.ReleaseDate = $parsedDate.ToString("dd.MM.yyyy")
      }
    }
  } catch {
    Write-TrayError "Не удалось прочитать сведения о версии АИС: $($_.Exception.Message)"
  }
  return [pscustomobject]$release
}

function New-AisAboutForm {
  $release = Get-AisReleaseInformation $resolvedAppRoot
  $form = New-Object Windows.Forms.Form
  $form.Text = "О системе — АИС Допобразование"
  $form.Font = [Drawing.Font]::new("Segoe UI", 10)
  $form.AutoScaleMode = [Windows.Forms.AutoScaleMode]::Dpi
  $form.FormBorderStyle = [Windows.Forms.FormBorderStyle]::FixedDialog
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.StartPosition = [Windows.Forms.FormStartPosition]::CenterScreen
  $form.AutoSize = $true
  $form.AutoSizeMode = [Windows.Forms.AutoSizeMode]::GrowAndShrink
  $form.Padding = [Windows.Forms.Padding]::new(20)
  $form.BackColor = [Drawing.Color]::White
  $form.Icon = $script:stateIcons.running

  $layout = New-Object Windows.Forms.TableLayoutPanel
  $layout.AutoSize = $true
  $layout.Dock = [Windows.Forms.DockStyle]::Fill
  $layout.ColumnCount = 2
  [void]$layout.ColumnStyles.Add([Windows.Forms.ColumnStyle]::new([Windows.Forms.SizeType]::Absolute, 160))
  [void]$layout.ColumnStyles.Add([Windows.Forms.ColumnStyle]::new([Windows.Forms.SizeType]::Absolute, 420))
  $form.Controls.Add($layout)

  $title = New-Object Windows.Forms.Label
  $title.Text = "АИС Допобразование"
  $title.Font = [Drawing.Font]::new("Segoe UI", 15, [Drawing.FontStyle]::Bold)
  $title.AutoSize = $true
  $title.Margin = [Windows.Forms.Padding]::new(0, 0, 0, 18)
  $layout.Controls.Add($title, 0, 0)
  $layout.SetColumnSpan($title, 2)

  $rows = [ordered]@{
    "Версия" = $release.Version
    "Дата выпуска" = $release.ReleaseDate
    "Состояние" = $script:statusItem.Text -replace '^Состояние:\s*', ''
    "Служба Windows" = $serviceName
    "Компьютер" = [Environment]::MachineName
    "Локальный адрес" = $localUrl
    "Сайт" = "https://edu-plus.ru/lms/"
    "Папка установки" = $resolvedAppRoot
  }
  $rowIndex = 1
  foreach ($entry in $rows.GetEnumerator()) {
    $label = New-Object Windows.Forms.Label
    $label.Text = $entry.Key
    $label.AutoSize = $true
    $label.Margin = [Windows.Forms.Padding]::new(0, 4, 12, 8)
    $layout.Controls.Add($label, 0, $rowIndex)

    $value = New-Object Windows.Forms.TextBox
    $value.Text = [string]$entry.Value
    $value.ReadOnly = $true
    $value.BorderStyle = [Windows.Forms.BorderStyle]::None
    $value.BackColor = $form.BackColor
    $value.Dock = [Windows.Forms.DockStyle]::Fill
    $value.Margin = [Windows.Forms.Padding]::new(0, 4, 0, 8)
    if ($entry.Key -eq "Папка установки") {
      $value.Multiline = $true
      $value.Height = 60
    }
    if ($entry.Key -eq "Состояние") { $value.Name = "aboutStatus" }
    $layout.Controls.Add($value, 1, $rowIndex)
    $rowIndex += 1
  }

  $closeButton = New-Object Windows.Forms.Button
  $closeButton.Text = "Закрыть"
  $closeButton.AutoSize = $true
  $closeButton.Padding = [Windows.Forms.Padding]::new(12, 4, 12, 4)
  $closeButton.Margin = [Windows.Forms.Padding]::new(0, 12, 0, 0)
  $closeButton.Anchor = [Windows.Forms.AnchorStyles]::Right
  $closeButton.add_Click({ param($sender, $eventArgs) $sender.FindForm().Close() })
  $layout.Controls.Add($closeButton, 1, $rowIndex)
  $form.AcceptButton = $closeButton
  $form.CancelButton = $closeButton
  return $form
}

function Show-AisAbout {
  try {
    if ($null -ne $script:aboutForm -and -not $script:aboutForm.IsDisposed) {
      $script:aboutForm.Activate()
      return
    }
    Update-TrayState
    $script:aboutForm = New-AisAboutForm
    $script:aboutStatus = $script:aboutForm.Controls.Find("aboutStatus", $true)[0]
    $script:aboutForm.add_FormClosed({
      $script:aboutStatus = $null
      $script:aboutForm = $null
    })
    $script:aboutForm.Show()
    $script:aboutForm.Activate()
  } catch {
    Write-TrayError $_.Exception.ToString()
    Show-TrayMessage "Не удалось открыть сведения о системе" $_.Exception.Message ([Windows.Forms.ToolTipIcon]::Error)
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
  if ($null -ne $script:aboutStatus -and -not $script:aboutStatus.IsDisposed) {
    $script:aboutStatus.Text = $StatusText
  }

  $isPending = $ServiceStatus -in @("StartPending", "StopPending", "ContinuePending", "PausePending")
  $script:startItem.Enabled = (-not $isPending) -and ((-not $Installed) -or $ServiceStatus -eq "Stopped")
  $script:stopItem.Enabled = $Installed -and (-not $isPending) -and $ServiceStatus -ne "Stopped"
  $script:restartItem.Enabled = $Installed -and (-not $isPending)
  if ($null -ne $script:exitItem) {
    $script:exitItem.Enabled = $Installed -and $ServiceStatus -eq "Stopped"
  }
  Write-TrayReadyMarker $State $ServiceStatus

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
  Remove-TrayReadyMarker
  if ($null -ne $script:aboutForm) {
    try { $script:aboutForm.Close() } catch { }
  }

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
    running = New-AisStateIcon $false ([Drawing.Color]::FromArgb(22, 163, 74))
    pending = New-AisStateIcon $true ([Drawing.Color]::FromArgb(100, 116, 139))
    stopped = New-AisStateIcon $true ([Drawing.Color]::FromArgb(100, 116, 139))
    missing = New-AisStateIcon $true ([Drawing.Color]::FromArgb(100, 116, 139))
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
  $aboutItem = New-Object Windows.Forms.ToolStripMenuItem "О системе"
  $script:exitItem = New-Object Windows.Forms.ToolStripMenuItem "Выход"
  $script:exitItem.Enabled = $false

  $openItem.add_Click({ Open-Ais })
  $script:startItem.add_Click({ Invoke-ControlAction "Start" })
  $script:stopItem.add_Click({ Invoke-ControlAction "Stop" })
  $script:restartItem.add_Click({ Invoke-ControlAction "Restart" })
  $terminalItem.add_Click({ Open-LogTerminal })
  $folderItem.add_Click({ Open-LogDirectory })
  $aboutItem.add_Click({ Show-AisAbout })
  $script:exitItem.add_Click({
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($null -eq $service -or [string]$service.Status -ne "Stopped") {
      Update-TrayState
      return
    }
    $script:notifyIcon.Visible = $false
    $script:applicationContext.ExitThread()
  })
  $script:contextMenu.add_Opening({ Update-TrayState })

  [void]$script:contextMenu.Items.Add($script:statusItem)
  [void]$script:contextMenu.Items.Add($openItem)
  [void]$script:contextMenu.Items.Add((New-Object Windows.Forms.ToolStripSeparator))
  [void]$script:contextMenu.Items.Add($script:startItem)
  [void]$script:contextMenu.Items.Add($script:stopItem)
  [void]$script:contextMenu.Items.Add($script:restartItem)
  [void]$script:contextMenu.Items.Add((New-Object Windows.Forms.ToolStripSeparator))
  [void]$script:contextMenu.Items.Add($terminalItem)
  [void]$script:contextMenu.Items.Add($folderItem)
  [void]$script:contextMenu.Items.Add($aboutItem)
  [void]$script:contextMenu.Items.Add((New-Object Windows.Forms.ToolStripSeparator))
  [void]$script:contextMenu.Items.Add($script:exitItem)

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

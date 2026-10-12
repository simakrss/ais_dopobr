[CmdletBinding()]
param([switch]$ValidateOnly)

# This source is published ONLY after Authenticode signing. The BAT pins its publisher.
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$utf8 = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$cloudUrl = "https://edu-plus.ru/lms/"
$installBase = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'AisDopobrLocal'
$appRoot = Join-Path $installBase 'web-ais'
$powerShell = Join-Path ([Environment]::SystemDirectory) 'WindowsPowerShell\v1.0\powershell.exe'
$packageInstaller = '@@AIS_PACKAGE_INSTALLER_BASE64@@'
if ($ValidateOnly) {
  Write-Output "Standalone installer syntax and configuration: OK"
  exit 0
}
if (-not [Environment]::Is64BitOperatingSystem) { throw 'Нужна 64-битная Windows. Общая АИС доступна на https://edu-plus.ru/lms/.' }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$mutex = New-Object Threading.Mutex($false, 'Local\AisDopobrStandaloneLauncher')
$ownsMutex = $false
try { $ownsMutex = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
if (-not $ownsMutex) { Start-Process $cloudUrl; $mutex.Dispose(); exit 0 }

$form = New-Object Windows.Forms.Form
$form.Text = 'Подготовка и запуск АИС'
$form.Size = New-Object Drawing.Size(680, 430)
$form.StartPosition = 'CenterScreen'
$form.MinimumSize = $form.Size
$label = New-Object Windows.Forms.Label
$label.SetBounds(18, 16, 625, 48)
$label.Text = 'Проверка компьютера…'
$bar = New-Object Windows.Forms.ProgressBar
$bar.SetBounds(18, 70, 625, 18)
$bar.Style = 'Marquee'
$log = New-Object Windows.Forms.TextBox
$log.SetBounds(18, 104, 625, 224)
$log.Multiline = $true; $log.ReadOnly = $true; $log.ScrollBars = 'Vertical'
$open = New-Object Windows.Forms.Button
$open.SetBounds(18, 342, 200, 32); $open.Text = 'Открыть общую АИС'
$open.Add_Click({ Start-Process $cloudUrl })
$close = New-Object Windows.Forms.Button
$close.SetBounds(523, 342, 120, 32); $close.Text = 'Закрыть'; $close.Enabled = $false
$close.Add_Click({ $form.Close() })
$form.Controls.AddRange(@($label, $bar, $log, $open, $close))
$script:working = $true
$script:exiting = $false
$script:worker = $null
$form.Add_FormClosing({ param($sender, $event) if ($script:working) { $event.Cancel = $true; $form.Hide() } })
$clock = [Diagnostics.Stopwatch]::StartNew()
$script:tray = $null

function Update-Ui {
  $form.Text = 'Подготовка АИС · ' + $clock.Elapsed.ToString('hh\:mm\:ss')
  [Windows.Forms.Application]::DoEvents()
}
function Step([string]$Text) {
  $label.Text = $Text
  if ($log.TextLength -gt 30000) { $log.Text = $log.Text.Substring($log.TextLength - 15000) }
  $log.AppendText($Text + "`r`n")
  Update-Ui
}
function Quote-Argument([string]$Value) {
  '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '${1}${1}\"'), '(\\+)$', '${1}${1}') + '"'
}
function Assert-LocalPath([string]$PathValue) {
  $current = [IO.Path]::GetFullPath($PathValue)
  while ($current) {
    if (Test-Path -LiteralPath $current) {
      if (((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Папка установки не должна быть ссылкой.' }
    }
    $parent = [IO.Directory]::GetParent($current)
    $current = if ($parent) { $parent.FullName } else { '' }
  }
}
function Download([string]$Url, [string]$Target, [long]$MaxBytes) {
  $request = [Net.HttpWebRequest]::Create($Url)
  $request.Timeout = 30000; $request.ReadWriteTimeout = 30000
  $response = $request.GetResponse()
  try {
    if ($response.ResponseUri.Scheme -ne 'https' -or $response.ContentLength -gt $MaxBytes) { throw 'Недопустимый ответ сервера установки.' }
    $inputStream = $response.GetResponseStream()
    $output = [IO.File]::Open($Target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
      $buffer = New-Object byte[] 65536
      while (($count = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
        if ($output.Length + $count -gt $MaxBytes) { throw 'Превышен размер загрузки.' }
        $output.Write($buffer, 0, $count)
        $label.Text = 'Скачивание: ' + [Math]::Round($output.Length / 1MB, 1) + ' МБ'
        Update-Ui
      }
    } finally { $output.Dispose(); $inputStream.Dispose() }
  } finally { $response.Dispose() }
}
function Run-Process([string]$File, [string[]]$Arguments, [string]$WorkingDirectory = $installBase) {
  $info = New-Object Diagnostics.ProcessStartInfo
  $info.FileName = $File; $info.Arguments = ($Arguments | ForEach-Object { Quote-Argument $_ }) -join ' '
  $info.WorkingDirectory = $WorkingDirectory
  $info.UseShellExecute = $false; $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
  $info.StandardOutputEncoding = $utf8; $info.StandardErrorEncoding = $utf8
  $process = New-Object Diagnostics.Process; $process.StartInfo = $info
  try {
    [void]$process.Start()
    $out = $process.StandardOutput.ReadLineAsync(); $err = $process.StandardError.ReadLineAsync()
    while (-not $process.HasExited -or $null -ne $out -or $null -ne $err) {
      if ($null -ne $out -and $out.IsCompleted) {
        $line = $out.GetAwaiter().GetResult()
        if ($null -eq $line) { $out = $null } else { Step $line; $out = $process.StandardOutput.ReadLineAsync() }
      }
      if ($null -ne $err -and $err.IsCompleted) {
        $line = $err.GetAwaiter().GetResult()
        if ($null -eq $line) { $err = $null } else { Step $line; $err = $process.StandardError.ReadLineAsync() }
      }
      Update-Ui
      Start-Sleep -Milliseconds 50
    }
    return [int]$process.ExitCode
  } finally { $process.Dispose() }
}
function Get-Node {
  $nodeRoot = Join-Path $installBase 'node'
  $node = Join-Path $nodeRoot 'node.exe'
  Assert-LocalPath $nodeRoot
  if (Test-Path -LiteralPath $node) {
    $version = & $node --version
    if ($LASTEXITCODE -eq 0 -and $version -match '^v(2[4-9]|[3-9]\d)\.') { return $node }
    throw 'Сохранённая среда Node.js повреждена или устарела. Установка остановлена без изменения файлов.'
  }
  Step 'Скачивание переносимого Node.js LTS с официального сайта…'
  $platform = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'win-arm64' } else { 'win-x64' }
  $releases = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing -TimeoutSec 30
  $release = $releases | Where-Object { $_.version -match '^v24\.\d+\.\d+$' -and $_.lts -is [string] -and $_.files -contains "$platform-zip" } | Select-Object -First 1
  if (-not $release) { throw 'Не найдена поддерживаемая LTS-версия Node.js.' }
  $name = "node-$($release.version)-$platform.zip"
  $url = "https://nodejs.org/dist/$($release.version)/"
  $sums = (Invoke-WebRequest -UseBasicParsing -Uri ($url + 'SHASUMS256.txt') -TimeoutSec 30).Content
  $match = [regex]::Match($sums, '(?m)^([a-fA-F0-9]{64})\s+\*?' + [regex]::Escape($name) + '\r?$')
  if (-not $match.Success) { throw 'Нет контрольной суммы Node.js.' }
  $stage = Join-Path $installBase ('node-install-' + [Guid]::NewGuid().ToString('N'))
  [void][IO.Directory]::CreateDirectory($stage)
  $zip = Join-Path $stage $name
  Download ($url + $name) $zip 100MB
  if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ine $match.Groups[1].Value) { throw 'Контрольная сумма Node.js не совпала. Файл не запущен.' }
  Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $stage 'extracted')
  $source = Join-Path $stage ('extracted\node-' + $release.version + '-' + $platform)
  $signature = Get-AuthenticodeSignature -LiteralPath (Join-Path $source 'node.exe')
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(OpenJS Foundation|Node\.js Foundation)') { throw 'Цифровая подпись Node.js не подтверждена.' }
  Assert-LocalPath $nodeRoot
  [IO.Directory]::Move($source, $nodeRoot)
  return $node
}
function Get-LocalHealth {
  try { return Invoke-RestMethod -Uri 'http://127.0.0.1:8081/api/local-document-services/health' -TimeoutSec 4 -UseBasicParsing } catch { return $null }
}
function Find-ExistingRoot {
  $configPath = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'AisDopobrWeb\service-config.json'
  if (Test-Path -LiteralPath $configPath) {
    $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($property in @('sourceAppRoot', 'serviceAppRoot')) {
      $candidate = if ($config.PSObject.Properties[$property]) { [string]$config.$property } else { '' }
      if ($candidate -and (Test-Path -LiteralPath (Join-Path $candidate 'scripts\bootstrap-local-system.ps1'))) { return [string]$candidate }
    }
  }
  if (Test-Path -LiteralPath (Join-Path $appRoot '.runtime\standalone-install.json')) { return $appRoot }
  return ''
}
function Import-DockerPath {
  # Environment changes in the preparation child do not reach this process.
  $command = Get-Command docker.exe -ErrorAction SilentlyContinue
  $candidates = @(
    $env:AIS_DOCKER_PATH,
    $(if ($command) { $command.Source }),
    (Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe'),
    (Join-Path $env:LOCALAPPDATA 'Docker\resources\bin\docker.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Docker\Docker\resources\bin\docker.exe')
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { $env:AIS_DOCKER_PATH = $candidate; return }
  }
  throw 'После подготовки не найден Docker CLI. Повторите запуск BAT.'
}
function Test-LocalPortBusy([int]$Port) {
  $client = New-Object Net.Sockets.TcpClient
  try {
    $pending = $client.ConnectAsync('127.0.0.1', $Port)
    [void]$pending.Wait(1000)
    return $client.Connected
  } catch { return $false } finally { $client.Dispose() }
}
function Start-LocalWorker([string]$Node, [string]$Root) {
  $runtime = Join-Path $Root '.runtime'
  $arguments = @((Join-Path $Root 'scripts\start-lan-system.js'), '--cloud-client')
  $script:worker = Start-Process -FilePath $Node -ArgumentList (($arguments | ForEach-Object { Quote-Argument $_ }) -join ' ') `
    -WorkingDirectory $Root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $runtime 'standalone-start.log') -RedirectStandardError (Join-Path $runtime 'standalone-error.log')
}
function Add-ClientTray {
  $script:tray = New-Object Windows.Forms.NotifyIcon
  $script:tray.Icon = [Drawing.SystemIcons]::Application
  $script:tray.Text = 'АИС · локальные документы'
  $menu = New-Object Windows.Forms.ContextMenuStrip
  [void]$menu.Items.Add('Открыть АИС', $null, { Start-Process $cloudUrl })
  [void]$menu.Items.Add('Подготовка и состояние', $null, { $form.Show(); $form.Activate() })
  [void]$menu.Items.Add('Остановить локальную АИС', $null, {
    if ([Windows.Forms.MessageBox]::Show('Остановить локальные средства? Завершите работу с документами перед остановкой.', 'АИС', 'YesNo', 'Question') -ne 'Yes') { return }
    $script:working = $true
    $code = Run-Process $powerShell @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $appRoot 'scripts\stop-lan-system.ps1'), '-KeepDocker', '-AppRoot', $appRoot) $appRoot
    $script:working = $false
    if ($code -eq 0) { $script:exiting = $true; $script:tray.Visible = $false; [Windows.Forms.Application]::Exit() }
    else { Step 'Не удалось подтвердить остановку. Проверьте журнал.'; $form.Show() }
  })
  $script:tray.ContextMenuStrip = $menu
  $script:tray.Add_DoubleClick({ Start-Process $cloudUrl })
  $script:tray.Visible = $true
}

$exitCode = 0
try {
  $form.Show(); Update-Ui
  $health = Get-LocalHealth
  if ($health -and $health.appServerAvailable -and $health.ocrAvailable -and $health.documentEditingAvailable) {
    Start-Process $cloudUrl
  } else {
    Assert-LocalPath $installBase
    [void][IO.Directory]::CreateDirectory($installBase)
    $node = Get-Node
    $env:AIS_NODE_PATH = $node
    $existing = Find-ExistingRoot
    $registeredService = Get-Service -Name 'AisDopobrWeb' -ErrorAction SilentlyContinue
    if ($registeredService -and -not $existing) { throw 'Найдена служба АИС, но папка её установки недоступна. Восстановите доступ к ней. Второй сервер не запущен.' }
    if ($health -and $health.appServerAvailable -and -not $existing) { throw 'АИС уже работает, но её папка не определена. Второй сервер не запущен. Откройте общую АИС или запустите подготовку из имеющегося дистрибутива.' }
    if (-not ($health -and $health.appServerAvailable) -and -not $registeredService -and ((Test-LocalPortBusy 8081) -or (Test-LocalPortBusy 19081))) { throw 'Локальный адрес занят или АИС ещё запускается. Подождите и повторите BAT. Работающий процесс не остановлен.' }
    if ($existing) { $appRoot = $existing } else {
      if ($packageInstaller -like '@@*') { throw 'Установщик не подготовлен издателем.' }
      Step 'Загрузка подписанного пакета АИС. База данных и пароли не загружаются.'
      $helperPath = Join-Path $installBase ('package-' + [Guid]::NewGuid().ToString('N') + '.js')
      [IO.File]::WriteAllBytes($helperPath, [Convert]::FromBase64String($packageInstaller))
      try { $code = Run-Process $node @($helperPath, $appRoot) } finally { Remove-Item -LiteralPath $helperPath -Force }
      if ($code -ne 0) { throw 'Не удалось установить проверенный пакет АИС.' }
    }
    Step 'Подготовка Docker и WSL. При необходимости Windows запросит разрешение администратора.'
    Step 'Установка Docker означает принятие условий https://www.docker.com/legal/docker-subscription-service-agreement/ .'
    $code = Run-Process $powerShell @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $appRoot 'scripts\bootstrap-local-system.ps1'), '-Action', 'Prepare') $appRoot
    if ($code -eq 3010) { throw 'WSL установлен. Сохраните работу, перезагрузите компьютер и снова запустите BAT. Пока можно работать в общей АИС через сайт.' }
    if ($code -ne 0) { throw 'Локальные компоненты пока не готовы: причина указана выше. Устраните её и повторите запуск. Общая АИС доступна по кнопке ниже.' }
    Import-DockerPath
    if ($registeredService -and -not ($health -and $health.appServerAvailable)) {
      Step 'Запуск уже установленной службы АИС без переустановки…'
      $code = Run-Process $powerShell @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $appRoot 'scripts\control-ais-service.ps1'), '-Action', 'Start', '-ShowTray', '-SourceAppRoot', $appRoot) $appRoot
      if ($code -ne 0) { throw 'Не удалось запустить существующую службу. Причина указана выше; второй сервер не запущен.' }
      $health = Get-LocalHealth
      if (-not ($health -and $health.appServerAvailable)) { throw 'Существующая служба ещё не ответила. Повторите запуск позже; второй сервер не запущен.' }
    }
    if ($health -and $health.appServerAvailable) {
      Step 'Подготовка редактора, PDF и распознавания документов в существующей АИС…'
      $code = Run-Process $node @((Join-Path $appRoot 'scripts\start-lan-system.js'), '--refresh-document-services') $appRoot
      if ($code -ne 0) { throw 'Локальные средства обработки документов пока не готовы. Подробности приведены выше.' }
    } else { Start-LocalWorker $node $appRoot; Add-ClientTray }
    Step 'Первый запуск: скачивание редактора, PDF-компонентов и моделей распознавания. Можно уже открыть общую АИС.'
    $deadline = (Get-Date).AddMinutes(35)
    $ready = $false
    while ((Get-Date) -lt $deadline) {
      $health = Get-LocalHealth
      if ($health -and $health.appServerAvailable -and $health.ocrAvailable -and $health.documentEditingAvailable) { $ready = $true; break }
      if ($script:worker -and $script:worker.HasExited) { throw 'Локальный процесс завершился. Проверьте .runtime/standalone-error.log и повторите запуск.' }
      $outputPath = Join-Path $appRoot '.runtime\standalone-start.log'
      if (Test-Path -LiteralPath $outputPath) {
        $lines = @(Get-Content -LiteralPath $outputPath -Tail 10 -Encoding UTF8 -ErrorAction SilentlyContinue)
        if ($lines.Count) { $log.Text = $lines -join "`r`n" }
      }
      Update-Ui
      Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw 'Подготовка не завершена за 35 минут. Проверьте интернет и журнал в папке .runtime. Уже запущенные компоненты не удалены; повторный запуск продолжит подготовку.' }
    Step 'АИС готова. Документы обрабатываются локально; база остаётся на сайте.'
    Start-Process $cloudUrl
  }
} catch {
  $exitCode = 1
  $form.Show()
  Step ('Ошибка: ' + $_.Exception.Message)
} finally {
  $script:working = $false; $close.Enabled = $true; $bar.Style = 'Blocks'; $bar.Value = 100
}
if ($script:tray) {
  # Closing the progress form keeps only the user-owned tray and document worker.
  $form.Add_FormClosing({ param($sender, $event) if (-not $script:exiting) { $event.Cancel = $true; $form.Hide() } })
  if ($exitCode -eq 0) { $form.Hide() }
  [Windows.Forms.Application]::Run()
  $script:tray.Dispose()
} elseif ($exitCode -ne 0) {
  while (-not $form.IsDisposed) { Update-Ui; Start-Sleep -Milliseconds 100 }
}
$form.Dispose()
if ($ownsMutex) { $mutex.ReleaseMutex() }
$mutex.Dispose()
exit $exitCode

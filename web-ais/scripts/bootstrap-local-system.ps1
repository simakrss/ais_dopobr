[CmdletBinding()]
param(
  [ValidateSet("Start", "Validate", "Prepare", "PrepareWsl")]
  [string]$Action = "Start",
  [string]$LauncherArguments = "",
  [string]$PreparationRoot = "",
  [ValidatePattern('^[a-f0-9]{32}$')]
  [string]$WslRequestId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$utf8 = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$appRoot = Split-Path -Parent $PSScriptRoot
if ($PreparationRoot) {
  if ($Action -notin @('Prepare', 'PrepareWsl')) { throw 'PreparationRoot is only valid for component preparation.' }
  $appRoot = [IO.Path]::GetFullPath($PreparationRoot)
}
$runtimeRoot = Join-Path $appRoot ".runtime"
$downloadRoot = Join-Path $runtimeRoot "downloads"
$portableNodeRoot = Join-Path $runtimeRoot "node"
$launcherPath = Join-Path $appRoot "scripts/start-lan-system.js"
$startupUpdatePath = Join-Path $appRoot "scripts/sync-and-deploy-startup.ps1"
$stopScriptPath = Join-Path $appRoot "scripts/stop-lan-system.ps1"
$minimumNodeMajor = 20
$validateOnly = $Action -eq "Validate" -or $env:AIS_LAUNCHER_VALIDATE_ONLY -eq "1"
$skipInstall = $env:AIS_BOOTSTRAP_SKIP_INSTALL -eq "1"
$dockerRestartRequired = $false

function Write-Step([string]$Message) {
  Write-Host "[Подготовка] $Message"
}

function Convert-LauncherArguments([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return @() }
  $result = New-Object Collections.Generic.List[string]
  $matches = [regex]::Matches($Value, '"([^"\\]*(?:\\.[^"\\]*)*)"|''([^'']*)''|(\S+)')
  foreach ($match in $matches) {
    if ($match.Groups[1].Success) {
      $result.Add($match.Groups[1].Value.Replace('\"', '"'))
    } elseif ($match.Groups[2].Success) {
      $result.Add($match.Groups[2].Value)
    } else {
      $result.Add($match.Groups[3].Value)
    }
  }
  return @($result)
}

$forwardedArguments = @(Convert-LauncherArguments $LauncherArguments)
$skipDocker = $env:AIS_BOOTSTRAP_SKIP_DOCKER -eq "1" -or @(
  $forwardedArguments | Where-Object { $_ -ieq "--skip-docker" }
).Count -gt 0

function Test-NodeCandidate([string]$Candidate) {
  if ([string]::IsNullOrWhiteSpace($Candidate) -or -not (Test-Path -LiteralPath $Candidate -PathType Leaf)) {
    return $null
  }
  try {
    $version = (& $Candidate --version 2>$null | Select-Object -First 1).Trim()
    $match = [regex]::Match($version, '^v(?<major>\d+)\.')
    if (-not $match.Success -or [int]$match.Groups["major"].Value -lt $minimumNodeMajor) {
      return $null
    }
    return [pscustomobject]@{ Path = [IO.Path]::GetFullPath($Candidate); Version = $version }
  } catch {
    return $null
  }
}

function Find-NodeRuntime {
  $candidates = New-Object Collections.Generic.List[string]
  foreach ($candidate in @(
    $env:AIS_NODE_PATH,
    (Join-Path $portableNodeRoot "node.exe"),
    (Join-Path $env:ProgramFiles "nodejs\node.exe"),
    $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} "nodejs\node.exe" } else { $null })
  )) {
    if (-not [string]::IsNullOrWhiteSpace([string]$candidate)) { $candidates.Add([string]$candidate) }
  }
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command) { $candidates.Add($command.Source) }
  $codexRuntimeRoot = Join-Path $env:USERPROFILE ".cache\codex-runtimes"
  if (Test-Path -LiteralPath $codexRuntimeRoot -PathType Container) {
    $bundled = Get-ChildItem -LiteralPath $codexRuntimeRoot -Filter "node.exe" -File -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match '[\\/]dependencies[\\/]node[\\/]bin[\\/]node\.exe$' } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1 -ExpandProperty FullName
    if ($bundled) { $candidates.Add($bundled) }
  }
  foreach ($candidate in @($candidates | Select-Object -Unique)) {
    $runtime = Test-NodeCandidate $candidate
    if ($runtime) { return $runtime }
  }
  return $null
}

function Invoke-VerifiedDownload([string]$Url, [string]$Destination) {
  $parent = Split-Path -Parent $Destination
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  $temporary = "$Destination.part"
  Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $temporary -TimeoutSec 1800
  } catch {
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if (-not $curl) { throw }
    & $curl.Source --fail --location --retry 3 --connect-timeout 20 --max-time 1800 --output $temporary $Url
    if ($LASTEXITCODE -ne 0) { throw "Не удалось скачать $Url" }
  }
  Move-Item -LiteralPath $temporary -Destination $Destination -Force
}

function Assert-ManagedRuntimePath([string]$TargetPath) {
  $root = [IO.Path]::GetFullPath($runtimeRoot).TrimEnd('\') + '\'
  $target = [IO.Path]::GetFullPath($TargetPath)
  if (-not $target.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Операция с файлом за пределами служебной папки АИС заблокирована: $target"
  }
}

function Remove-ManagedRuntimeItem([string]$TargetPath) {
  Assert-ManagedRuntimePath $TargetPath
  if (Test-Path -LiteralPath $TargetPath) {
    Remove-Item -LiteralPath $TargetPath -Recurse -Force
  }
}

function Install-PortableNode {
  if ($skipInstall) { throw "Node.js не найден, а автоматическая установка отключена." }
  Write-Step "Node.js не найден. Устанавливается переносимая LTS-версия в папку АИС."
  New-Item -ItemType Directory -Path $runtimeRoot, $downloadRoot -Force | Out-Null
  $architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
  $platform = if ($architecture -eq "arm64") { "win-arm64" } else { "win-x64" }
  $index = Invoke-RestMethod -UseBasicParsing -Uri "https://nodejs.org/dist/index.json"
  $release = @($index | Where-Object {
    $_.lts -is [string] -and $_.lts -and @($_.files) -contains "$platform-zip"
  } | Select-Object -First 1)
  if (-not $release.Count) { throw "На сервере Node.js не найдена подходящая LTS-версия для Windows." }
  $version = [string]$release[0].version
  $archiveName = "node-$version-$platform.zip"
  $baseUrl = "https://nodejs.org/dist/$version"
  $archivePath = Join-Path $downloadRoot $archiveName
  $checksumsPath = Join-Path $downloadRoot "SHASUMS256-$version.txt"
  if (-not (Test-Path -LiteralPath $checksumsPath -PathType Leaf)) {
    Invoke-VerifiedDownload "$baseUrl/SHASUMS256.txt" $checksumsPath
  }
  $archivePattern = "^(?<hash>[a-fA-F0-9]{64})\s+\*?$([regex]::Escape($archiveName))$"
  $checksumLine = Get-Content -LiteralPath $checksumsPath -Encoding UTF8 |
    Where-Object { $_ -match $archivePattern } |
    Select-Object -First 1
  if (-not $checksumLine) { throw "Не удалось получить контрольную сумму архива Node.js." }
  $expectedHash = [regex]::Match($checksumLine, '^[a-fA-F0-9]{64}').Value.ToLowerInvariant()
  $archiveValid = $false
  if (Test-Path -LiteralPath $archivePath -PathType Leaf) {
    $archiveValid = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -eq $expectedHash
  }
  if (-not $archiveValid) {
    Write-Step "Скачивание Node.js $version..."
    Invoke-VerifiedDownload "$baseUrl/$archiveName" $archivePath
    $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHash) {
      Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
      throw "Контрольная сумма Node.js не совпала. Установка остановлена."
    }
  }
  $extractRoot = Join-Path $runtimeRoot ("node-install-" + [Guid]::NewGuid().ToString("N"))
  try {
    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot -Force
    $sourceRoot = Get-ChildItem -LiteralPath $extractRoot -Directory | Select-Object -First 1 -ExpandProperty FullName
    if (-not $sourceRoot -or -not (Test-Path -LiteralPath (Join-Path $sourceRoot "node.exe") -PathType Leaf)) {
      throw "Архив Node.js имеет неожиданную структуру."
    }
    Remove-ManagedRuntimeItem $portableNodeRoot
    Move-Item -LiteralPath $sourceRoot -Destination $portableNodeRoot
  } finally {
    Remove-ManagedRuntimeItem $extractRoot
  }
  $runtime = Test-NodeCandidate (Join-Path $portableNodeRoot "node.exe")
  if (-not $runtime) { throw "Установленная копия Node.js не запускается." }
  Write-Step "Node.js $($runtime.Version) установлен."
  return $runtime
}

function Find-DockerCli {
  $candidates = New-Object Collections.Generic.List[string]
  foreach ($candidate in @(
    $env:AIS_DOCKER_PATH,
    (Join-Path $env:ProgramFiles "Docker\Docker\resources\bin\docker.exe"),
    (Join-Path $env:LOCALAPPDATA "Docker\resources\bin\docker.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin\docker.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Docker\Docker\resources\bin\docker.exe")
  )) {
    if (-not [string]::IsNullOrWhiteSpace([string]$candidate)) { $candidates.Add([string]$candidate) }
  }
  $command = Get-Command docker.exe -ErrorAction SilentlyContinue
  if ($command) { $candidates.Add($command.Source) }
  return @($candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -Unique) |
    Select-Object -First 1
}

function Find-DockerDesktop {
  return @(
    (Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"),
    (Join-Path $env:LOCALAPPDATA "Docker\Docker Desktop.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\Docker Desktop.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Docker\Docker\Docker Desktop.exe")
  ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}

function Test-DockerEngine([string]$DockerPath) {
  if ([string]::IsNullOrWhiteSpace($DockerPath)) { return $false }
  try {
    $probe = Invoke-BootstrapProbe $DockerPath 'info --format "{{.ServerVersion}}"' 10000
    return $probe.Code -eq 0 -and -not [string]::IsNullOrWhiteSpace($probe.Text)
  } catch {
    return $false
  }
}

function Invoke-BootstrapProbe([string]$FilePath, [string]$Arguments, [int]$TimeoutMilliseconds = 15000, [string]$LogPath = '') {
  $info = New-Object Diagnostics.ProcessStartInfo
  $info.FileName = $FilePath
  $info.Arguments = $Arguments
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  if ([IO.Path]::GetFileName($FilePath) -ieq 'wsl.exe') {
    # WSL emits UTF-16 to redirected pipes; removing NULs corrupts Cyrillic.
    $info.StandardOutputEncoding = [Text.Encoding]::Unicode
    $info.StandardErrorEncoding = [Text.Encoding]::Unicode
  }
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $info
  try {
    [void]$process.Start()
    $output = $process.StandardOutput.ReadToEndAsync()
    $errors = $process.StandardError.ReadToEndAsync()
    $deadline = (Get-Date).AddMilliseconds($TimeoutMilliseconds)
    $nextProgress = (Get-Date).AddSeconds(10)
    while (-not $process.WaitForExit(1000) -and (Get-Date) -lt $deadline) {
      if ($LogPath -and (Get-Date) -ge $nextProgress) {
        Write-WslLog $LogPath "Выполняется wsl $Arguments…"
        $nextProgress = (Get-Date).AddSeconds(10)
      }
    }
    if (-not $process.HasExited) {
      # Only the diagnostic child created here is terminated, never Docker Desktop.
      try { $process.Kill() } catch { }
      return [pscustomobject]@{ Code = -1; Text = "Превышено время проверки" }
    }
    $text = @($output.GetAwaiter().GetResult(), $errors.GetAwaiter().GetResult()) -join "`r`n"
    return [pscustomobject]@{ Code = $process.ExitCode; Text = $text.Replace([string][char]0, '').Trim() }
  } finally { $process.Dispose() }
}

function Test-WslReady {
  $wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
  if (-not $wsl) { return $false }
  try {
    $probe = Invoke-BootstrapProbe $wsl.Source "--version"
    $version = [regex]::Match($probe.Text, '\b\d+\.\d+\.\d+(?:\.\d+)?\b')
    if ($probe.Code -ne 0 -or -not $version.Success -or [version]$version.Value -lt [version]"2.1.5") { return $false }
    $feature = Get-CimInstance Win32_OptionalFeature -Filter "Name='VirtualMachinePlatform'" -ErrorAction Stop
    return $feature -and [int]$feature.InstallState -eq 1
  } catch {
    return $false
  }
}

function Test-DockerInstallerSignature([string]$InstallerPath) {
  if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) { return $false }
  try {
    $signature = Get-AuthenticodeSignature -LiteralPath $InstallerPath
    $subject = if ($signature.SignerCertificate) {
      [string]$signature.SignerCertificate.Subject
    } else {
      ""
    }
    return $signature.Status -eq "Valid" -and $subject -match "Docker"
  } catch {
    return $false
  }
}

function Write-WslLog([string]$LogPath, [string]$Message) {
  [IO.File]::AppendAllText($LogPath, $Message + "`r`n", (New-Object Text.UTF8Encoding($false)))
}

function Invoke-WslSetup([string]$LogPath) {
  # Only this function runs elevated. Never reboot Windows automatically.
  $restart = $false
  foreach ($name in @('VirtualMachinePlatform', 'Microsoft-Windows-Subsystem-Linux')) {
    $feature = Get-WindowsOptionalFeature -Online -FeatureName $name -ErrorAction Stop
    Write-WslLog $LogPath "$name : $($feature.State)"
    if ([string]$feature.State -match 'Pending') { $restart = $true; continue }
    if ([string]$feature.State -ne 'Enabled') {
      Write-WslLog $LogPath "Включение компонента Windows: $name…"
      $result = Enable-WindowsOptionalFeature -Online -FeatureName $name -All -NoRestart -ErrorAction Stop
      if ($result.RestartNeeded) { $restart = $true }
    }
  }
  if ($restart) {
    Write-WslLog $LogPath 'Компоненты Windows включены. Сохраните работу, перезагрузите Windows и снова запустите BAT — установка продолжится.'
    return 3010
  }
  if (Test-WslReady) { return 0 }
  $wsl = Get-Command wsl.exe -ErrorAction Stop
  $help = Invoke-BootstrapProbe $wsl.Source '--help'
  $version = Invoke-BootstrapProbe $wsl.Source '--version'
  $operation = if ($version.Code -eq 0) { '--update' } else { '--install --no-distribution' }
  # Inbox WSL on a fresh Windows 11 can lack --web-download.
  $arguments = $operation
  if ($help.Text -match '--web-download') { $arguments += ' --web-download' }
  Write-WslLog $LogPath "Запуск wsl $arguments"
  $result = Invoke-BootstrapProbe $wsl.Source $arguments 1200000 $LogPath
  Write-WslLog $LogPath ("Код WSL: $($result.Code)`r`n" + $result.Text)
  if ($result.Code -eq 3010) { return 3010 }
  # Retry through Windows' normal download channel if web-download failed.
  if ($result.Code -ne 0 -and $arguments -ne $operation) {
    Write-WslLog $LogPath "Повтор через стандартный канал Microsoft: wsl $operation"
    $result = Invoke-BootstrapProbe $wsl.Source $operation 1200000 $LogPath
    Write-WslLog $LogPath ("Код WSL: $($result.Code)`r`n" + $result.Text)
    if ($result.Code -eq 3010) { return 3010 }
  }
  if (Test-WslReady) { return 0 }
  if ($result.Code -ne 0) { throw "WSL не установлен (код $($result.Code)). $($result.Text)" }
  # An inbox install may succeed but leave the old WSL package in place.
  $result = Invoke-BootstrapProbe $wsl.Source '--update' 1200000 $LogPath
  Write-WslLog $LogPath ("Обновление WSL, код $($result.Code)`r`n" + $result.Text)
  if ($result.Code -eq 3010) { return 3010 }
  if (Test-WslReady) { return 0 }
  throw "WSL пока не готов (код $($result.Code)). Нужна версия 2.1.5 или новее. $($result.Text)"
}

function Invoke-ElevatedWslSetup {
  [void][IO.Directory]::CreateDirectory($runtimeRoot)
  $id = [Guid]::NewGuid().ToString('N')
  $logPath = Join-Path $runtimeRoot "wsl-setup-$id.log"
  $resultPath = Join-Path $runtimeRoot "wsl-setup-$id.json"
  Write-Step "Журнал подготовки WSL: $logPath"
  $powershell = Join-Path ([Environment]::SystemDirectory) 'WindowsPowerShell\v1.0\powershell.exe'
  # Fixed action, no command text from the environment or downloaded responses.
  $arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -Action PrepareWsl -PreparationRoot "' + $appRoot.TrimEnd('\') + '" -WslRequestId ' + $id
  $process = Start-Process -FilePath $powershell -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -PassThru
  try {
    $offset = 0
    do {
      if (Test-Path -LiteralPath $logPath) {
        $text = [IO.File]::ReadAllText($logPath, [Text.Encoding]::UTF8)
        if ($text.Length -gt $offset) { Write-Host $text.Substring($offset).TrimEnd(); $offset = $text.Length }
      }
    } while (-not $process.WaitForExit(1000))
    if (Test-Path -LiteralPath $logPath) {
      $text = [IO.File]::ReadAllText($logPath, [Text.Encoding]::UTF8)
      if ($text.Length -gt $offset) { Write-Host $text.Substring($offset).TrimEnd() }
    }
    if (-not (Test-Path -LiteralPath $resultPath)) { throw "Подготовка WSL прервана (код $($process.ExitCode)). Журнал: $logPath" }
    $result = Get-Content -LiteralPath $resultPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($result.Code -notin @(0, 3010)) { throw "$($result.Message) Журнал: $logPath" }
    return [int]$result.Code
  } finally { $process.Dispose() }
}

function Test-WslRestartPending {
  $marker = Join-Path $runtimeRoot 'wsl-restart-required.json'
  if (-not (Test-Path -LiteralPath $marker)) { return $false }
  $state = Get-Content -LiteralPath $marker -Raw -Encoding UTF8 | ConvertFrom-Json
  $boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')
  return $state.boot -eq $boot
}

function Install-WslPrerequisite {
  if (Test-WslRestartPending) {
    $script:dockerRestartRequired = $true
    Write-Step 'Windows ещё не перезагружена после включения компонентов WSL. Сохраните работу, перезагрузите компьютер и повторите BAT.'
    return $false
  }
  if (Test-WslReady) { return $true }
  if ($skipInstall) { return $false }
  Write-Step "Для Docker требуется WSL 2. Windows запросит разрешение администратора."
  try {
    $code = Invoke-ElevatedWslSetup
    if ($code -eq 3010) {
      $script:dockerRestartRequired = $true
      $boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')
      [IO.File]::WriteAllText((Join-Path $runtimeRoot 'wsl-restart-required.json'), (@{boot=$boot} | ConvertTo-Json -Compress), $utf8)
      Write-Step "Для продолжения установки требуется перезагрузка Windows. После неё снова запустите BAT."
      return $false
    }
    if (-not (Test-WslReady)) { throw 'WSL установлен, но проверка готовности не пройдена. Проверьте журнал подготовки.' }
    return $true
  } catch {
    if ($_.Exception.ToString() -match '1223|canceled by the user|отменена пользователем') {
      throw 'Разрешение администратора отменено. Запустите BAT повторно и подтвердите запрос Windows на подготовку WSL.'
    }
    throw
  }
}

function Install-DockerDesktop {
  if ($skipInstall) { throw "Docker Desktop не найден, а автоматическая установка отключена." }
  Assert-DockerComputerSupported
  if (-not (Install-WslPrerequisite)) {
    throw "WSL 2 ещё не готов. Перезагрузите Windows после установки WSL и снова запустите АИС."
  }
  New-Item -ItemType Directory -Path $downloadRoot -Force | Out-Null
  $architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
  $dockerArchitecture = if ($architecture -eq "arm64") { "arm64" } else { "amd64" }
  $installerPath = Join-Path $downloadRoot "Docker Desktop Installer.exe"
  $installerUrl = "https://desktop.docker.com/win/main/$dockerArchitecture/Docker%20Desktop%20Installer.exe"
  $signatureValid = Test-DockerInstallerSignature $installerPath
  if (-not $signatureValid) {
    Write-Step "Скачивание официального установщика Docker Desktop..."
    Invoke-VerifiedDownload $installerUrl $installerPath
    if (-not (Test-DockerInstallerSignature $installerPath)) {
      Remove-Item -LiteralPath $installerPath -Force -ErrorAction SilentlyContinue
      throw "Цифровая подпись установщика Docker Desktop не прошла проверку."
    }
  }
  Write-Step "Установка Docker Desktop для текущего пользователя..."
  $process = Start-Process -FilePath $installerPath -ArgumentList @(
    "install", "--user", "--quiet", "--accept-license", "--backend=wsl-2", "--no-windows-containers"
  ) -WindowStyle Hidden -Wait -PassThru
  if ($process.ExitCode -notin @(0, 3010)) {
    throw "Установщик Docker Desktop завершился с кодом $($process.ExitCode)."
  }
  if ($process.ExitCode -eq 3010) { $script:dockerRestartRequired = $true }
  $dockerPath = Find-DockerCli
  if (-not $dockerPath) { throw "Docker Desktop установлен, но docker.exe не найден." }
  Write-Step "Docker Desktop установлен."
  return $dockerPath
}

function Start-DockerEngine([string]$DockerPath) {
  if (Test-DockerEngine $DockerPath) { return $true }
  $service = Get-Service -Name "com.docker.service" -ErrorAction SilentlyContinue
  if ($service -and $service.Status -ne "Running") {
    try { Start-Service -Name $service.Name -ErrorAction Stop } catch { }
  }
  $desktopPath = Find-DockerDesktop
  if (-not $desktopPath) { throw "Программа Docker Desktop не найдена после установки." }
  $desktopRunning = Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue
  if (-not $desktopRunning) {
    Write-Step "Запуск Docker Desktop..."
    Start-Process -FilePath $desktopPath -WorkingDirectory (Split-Path -Parent $desktopPath) `
      -WindowStyle Hidden | Out-Null
  } else {
    Write-Step "Ожидание готовности Docker Desktop..."
  }
  $deadline = (Get-Date).AddMinutes(3)
  $nextProgress = Get-Date
  while ((Get-Date) -lt $deadline) {
    if (Test-DockerEngine $DockerPath) { return $true }
    if ((Get-Date) -ge $nextProgress) {
      Write-Host "[Подготовка] Docker загружается, подождите..."
      $nextProgress = (Get-Date).AddSeconds(10)
    }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Ensure-DockerReady {
  if ($skipDocker) {
    Write-Step "Запуск Docker пропущен параметром --skip-docker."
    return $null
  }
  $dockerPath = Find-DockerCli
  if (-not $dockerPath) { $dockerPath = Install-DockerDesktop }
  elseif (-not (Test-DockerEngine $dockerPath)) {
    Assert-DockerComputerSupported
    if (-not (Install-WslPrerequisite)) { throw "WSL 2 ещё не готов. Проверьте сообщения выше и повторите запуск после подготовки Windows." }
  }
  if ($dockerRestartRequired) { throw "Сохраните работу, перезагрузите Windows и снова запустите АИС." }
  $env:AIS_DOCKER_PATH = [IO.Path]::GetFullPath($dockerPath)
  $dockerDirectory = Split-Path -Parent $env:AIS_DOCKER_PATH
  if (-not (($env:Path -split ';') -contains $dockerDirectory)) {
    $env:Path = "$dockerDirectory;$env:Path"
  }
  if (-not (Start-DockerEngine $env:AIS_DOCKER_PATH)) {
    $suffix = if ($dockerRestartRequired) { " Перезагрузите Windows и запустите АИС снова." } else { "" }
    throw "Docker Desktop не перешёл в рабочее состояние за 3 минуты.$suffix"
  }
  $compose = Invoke-BootstrapProbe $env:AIS_DOCKER_PATH "compose version"
  if ($compose.Code -ne 0) { throw "В установленном Docker отсутствует команда Compose. Обновите Docker Desktop официальным установщиком." }
  Write-Step "Docker Desktop готов."
  return $env:AIS_DOCKER_PATH
}

function Assert-DockerComputerSupported {
  $os = Get-CimInstance Win32_OperatingSystem
  $build = [int]$os.BuildNumber
  if ([int]$os.ProductType -ne 1 -or $build -lt 19045 -or ($build -ge 22000 -and $build -lt 22631)) {
    throw "Для локальной обработки документов нужна поддерживаемая 64-битная Windows 10 22H2 / Windows 11 23H2 или новее. Docker Desktop не поддерживает Windows Server. Общая АИС доступна через сайт."
  }
  $system = Get-CimInstance Win32_ComputerSystem
  if ($system.TotalPhysicalMemory -lt 7.5GB) { throw "Для локальных Docker-компонентов требуется не менее 8 ГБ оперативной памяти. Общая АИС доступна через сайт." }
  $processor = Get-CimInstance Win32_Processor | Select-Object -First 1
  if (-not $system.HypervisorPresent -and $processor.VirtualizationFirmwareEnabled -eq $false) {
    throw "В BIOS/UEFI выключена виртуализация. Включите Intel VT-x / AMD-V и повторите запуск. Общая АИС доступна через сайт."
  }
}

if ($Action -eq 'PrepareWsl') {
  if (-not $WslRequestId) { throw 'WslRequestId is required.' }
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'WSL preparation requires administrator approval.' }
  [void][IO.Directory]::CreateDirectory($runtimeRoot)
  $logPath = Join-Path $runtimeRoot "wsl-setup-$WslRequestId.log"
  $resultPath = Join-Path $runtimeRoot "wsl-setup-$WslRequestId.json"
  $code = 10; $message = ''
  try { $code = Invoke-WslSetup $logPath } catch { $message = $_.Exception.Message; Write-WslLog $logPath $message }
  [IO.File]::WriteAllText($resultPath, (@{ Code = $code; Message = $message } | ConvertTo-Json -Compress), $utf8)
  exit $code
}

if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
  throw "Не найден сценарий запуска АИС: $launcherPath"
}
if (-not (Test-Path -LiteralPath $startupUpdatePath -PathType Leaf)) {
  throw "Не найден сценарий синхронизации и публикации: $startupUpdatePath"
}
if (-not (Test-Path -LiteralPath $stopScriptPath -PathType Leaf)) {
  throw "Не найден сценарий перезапуска АИС: $stopScriptPath"
}

$nodeRuntime = Find-NodeRuntime
if (-not $nodeRuntime) {
  if ($validateOnly) { throw "Node.js 20 или новее не найден. Режим проверки не устанавливает компоненты." }
  $nodeRuntime = Install-PortableNode
}
$env:AIS_NODE_PATH = $nodeRuntime.Path
$nodeDirectory = Split-Path -Parent $nodeRuntime.Path
if (-not (($env:Path -split ';') -contains $nodeDirectory)) { $env:Path = "$nodeDirectory;$env:Path" }
Write-Step "Node.js $($nodeRuntime.Version) готов: $($nodeRuntime.Path)"

if ($validateOnly) {
  & $nodeRuntime.Path --check $launcherPath
  if ($LASTEXITCODE -ne 0) { throw "Сценарий запуска АИС содержит синтаксическую ошибку." }
  # Runtime validation must also work on clients without publisher FTP/Git access.
  $tokens = $null; $parseErrors = $null
  [void][Management.Automation.Language.Parser]::ParseFile($startupUpdatePath, [ref]$tokens, [ref]$parseErrors)
  if ($parseErrors.Count) { throw "Сценарий подготовки содержит синтаксическую ошибку." }
  Write-Step "Сценарий запуска и окружение проверены. Установка и запуск служб не выполнялись."
  exit 0
}

if ($Action -eq "Prepare") {
  try {
    [void](Ensure-DockerReady)
    Write-Step "Компоненты готовы. OCR и редактор документов будут загружены при первом запуске."
    exit 0
  } catch {
    Write-Step $_.Exception.Message
    if ($dockerRestartRequired) { exit 3010 }
    exit 10
  }
}

Write-Step "Синхронизация с GitHub и обновление edu-plus.ru/lms..."
& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $startupUpdatePath
if ($LASTEXITCODE -ne 0) {
  Write-Warning "Обновить GitHub/FTP сейчас не удалось. Локальная АИС продолжит запуск на последней доступной версии."
}

$dockerFailure = ""
try {
  [void](Ensure-DockerReady)
} catch {
  $dockerFailure = $_.Exception.Message
  Write-Warning "$dockerFailure Основная АИС будет запущена без OCR и преобразования документов."
  if (-not $skipDocker) { $forwardedArguments += "--skip-docker" }
}

Write-Step "Перезапуск локальных серверов на актуальной версии..."
& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $stopScriptPath -KeepDocker
if ($LASTEXITCODE -ne 0) {
  Write-Warning "Штатная остановка предыдущей копии АИС завершилась с ошибкой; запуск продолжен."
}

Write-Step "Запуск серверов АИС..."
& $nodeRuntime.Path $launcherPath @forwardedArguments
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0 -and $dockerFailure) {
  Write-Warning "Дополнительная диагностика Docker: $dockerFailure"
}
exit $exitCode

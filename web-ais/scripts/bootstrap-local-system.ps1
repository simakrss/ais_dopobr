[CmdletBinding()]
param(
  [ValidateSet("Start", "Validate")]
  [string]$Action = "Start",
  [string]$LauncherArguments = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$utf8 = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$appRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $appRoot ".runtime"
$downloadRoot = Join-Path $runtimeRoot "downloads"
$portableNodeRoot = Join-Path $runtimeRoot "node"
$launcherPath = Join-Path $PSScriptRoot "start-lan-system.js"
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
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $temporary
  } catch {
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if (-not $curl) { throw }
    & $curl.Source --fail --location --retry 3 --connect-timeout 20 --output $temporary $Url
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
    $output = & $DockerPath info --format "{{.ServerVersion}}" 2>$null
    return $LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace(($output | Out-String))
  } catch {
    return $false
  }
}

function Test-WslReady {
  $wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
  if (-not $wsl) { return $false }
  try {
    & $wsl.Source --version *> $null
    return $LASTEXITCODE -eq 0
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

function Install-WslPrerequisite {
  if (Test-WslReady) { return $true }
  if ($skipInstall) { return $false }
  $wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
  if (-not $wsl) {
    Write-Warning "Компонент WSL отсутствует. Docker Desktop может потребовать его ручной установки."
    return $false
  }
  Write-Step "Для Docker требуется WSL 2. Windows запросит разрешение администратора."
  try {
    $process = Start-Process -FilePath $wsl.Source -ArgumentList @(
      "--install", "--no-distribution", "--web-download"
    ) -Verb RunAs -Wait -PassThru
    if ($process.ExitCode -notin @(0, 3010)) {
      Write-Warning "Установка WSL завершилась с кодом $($process.ExitCode)."
      return $false
    }
    if ($process.ExitCode -eq 3010 -or -not (Test-WslReady)) {
      $script:dockerRestartRequired = $true
      Write-Warning "Компоненты WSL установлены. Для Docker может потребоваться перезагрузка Windows."
      return $false
    }
    return $true
  } catch {
    Write-Warning "Не удалось установить WSL автоматически: $($_.Exception.Message)"
    return $false
  }
}

function Install-DockerDesktop {
  if ($skipInstall) { throw "Docker Desktop не найден, а автоматическая установка отключена." }
  [void](Install-WslPrerequisite)
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
  $env:AIS_DOCKER_PATH = [IO.Path]::GetFullPath($dockerPath)
  $dockerDirectory = Split-Path -Parent $env:AIS_DOCKER_PATH
  if (-not (($env:Path -split ';') -contains $dockerDirectory)) {
    $env:Path = "$dockerDirectory;$env:Path"
  }
  if (-not (Start-DockerEngine $env:AIS_DOCKER_PATH)) {
    $suffix = if ($dockerRestartRequired) { " Перезагрузите Windows и запустите АИС снова." } else { "" }
    throw "Docker Desktop не перешёл в рабочее состояние за 3 минуты.$suffix"
  }
  & $env:AIS_DOCKER_PATH compose version *> $null
  if ($LASTEXITCODE -ne 0) { throw "В установленном Docker отсутствует команда Compose." }
  Write-Step "Docker Desktop готов."
  return $env:AIS_DOCKER_PATH
}

if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
  throw "Не найден сценарий запуска АИС: $launcherPath"
}

$nodeRuntime = Find-NodeRuntime
if (-not $nodeRuntime) { $nodeRuntime = Install-PortableNode }
$env:AIS_NODE_PATH = $nodeRuntime.Path
$nodeDirectory = Split-Path -Parent $nodeRuntime.Path
if (-not (($env:Path -split ';') -contains $nodeDirectory)) { $env:Path = "$nodeDirectory;$env:Path" }
Write-Step "Node.js $($nodeRuntime.Version) готов: $($nodeRuntime.Path)"

if ($validateOnly) {
  & $nodeRuntime.Path --check $launcherPath
  if ($LASTEXITCODE -ne 0) { throw "Сценарий запуска АИС содержит синтаксическую ошибку." }
  Write-Step "Сценарий запуска и окружение проверены. Установка и запуск служб не выполнялись."
  exit 0
}

$dockerFailure = ""
try {
  [void](Ensure-DockerReady)
} catch {
  $dockerFailure = $_.Exception.Message
  Write-Warning "$dockerFailure Основная АИС будет запущена без OCR и преобразования документов."
  if (-not $skipDocker) { $forwardedArguments += "--skip-docker" }
}

Write-Step "Запуск серверов АИС..."
& $nodeRuntime.Path $launcherPath @forwardedArguments
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0 -and $dockerFailure) {
  Write-Warning "Дополнительная диагностика Docker: $dockerFailure"
}
exit $exitCode

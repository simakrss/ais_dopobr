[CmdletBinding()]
param(
  [switch]$Supervisor,
  [ValidateRange(10, 300)]
  [int]$CheckIntervalSeconds = 20
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$utf8 = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

$scriptPath = $MyInvocation.MyCommand.Path
$appRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $appRoot ".runtime"
$logRoot = Join-Path $appRoot "tmp"
$cloudflaredPath = Join-Path $runtimeRoot "cloudflared.exe"
$secretPath = Join-Path $runtimeRoot "tunnel-secret.txt"
$onlyOfficeSecretPath = Join-Path $appRoot "tmp\lan-system\onlyoffice-jwt-secret.txt"
$runtimeConfigPath = Join-Path $runtimeRoot "tunnel-runtime.json"
$deployScriptPath = Join-Path $PSScriptRoot "deploy-lms.ps1"
$appPort = 19081
$localPort = 8081

if (-not $Supervisor) {
  $shellPath = (Get-Process -Id $PID).Path
  $process = Start-Process -FilePath $shellPath -ArgumentList @(
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", "`"$scriptPath`"", "-Supervisor",
    "-CheckIntervalSeconds", $CheckIntervalSeconds
  ) -WindowStyle Hidden -PassThru
  Write-Host "Службы АИС запускаются в фоновом режиме (PID $($process.Id))."
  exit 0
}

New-Item -ItemType Directory -Path $runtimeRoot, $logRoot -Force | Out-Null
$mutex = New-Object Threading.Mutex($false, "Local\AisDopobrazovanieRemoteServices")
if (-not $mutex.WaitOne(0, $false)) { exit 0 }

function Write-ServiceLog([string]$Message) {
  Add-Content -LiteralPath (Join-Path $logRoot "remote-services.log") -Encoding UTF8 `
    -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
}

function Get-NodePath {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $root = Join-Path $env:USERPROFILE ".cache\codex-runtimes"
  $candidates = @(
    Get-ChildItem -LiteralPath $root -Filter "node.exe" -File -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match "[\\/]dependencies[\\/]node[\\/]bin[\\/]node\.exe$" } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -ExpandProperty FullName
  )
  if (-not $candidates.Count) { throw "Node.js не найден." }
  return $candidates[0]
}

function Get-DockerPath {
  $command = Get-Command docker.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $candidate = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
  if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
  throw "Docker не найден."
}

function Test-Health([string]$Url, [int]$TimeoutSeconds = 5) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec $TimeoutSeconds
    return [int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 300
  } catch {
    return $false
  }
}

function Test-ApplicationHealth([string]$Url, [int]$TimeoutSeconds = 5) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec $TimeoutSeconds
    $payload = $response.Content | ConvertFrom-Json
    $storage = [string]$payload.storage
    return [int]$response.StatusCode -eq 200 `
      -and $payload.ok -eq $true `
      -and (@("mysql", "yandex-disk") -contains $storage)
  } catch {
    return $false
  }
}

function Get-SecretFingerprint([string]$Value) {
  $bytes = [Text.Encoding]::UTF8.GetBytes([string]$Value)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "").Substring(0, 16).ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function Get-OnlyOfficeSecret {
  $configured = [string]$env:ONLYOFFICE_JWT_SECRET
  if ($configured.Trim().Length -ge 32) { return $configured.Trim() }
  if (Test-Path -LiteralPath $onlyOfficeSecretPath -PathType Leaf) {
    $existing = (Get-Content -Raw -LiteralPath $onlyOfficeSecretPath).Trim()
    if ($existing.Length -ge 32) { return $existing }
  }
  New-Item -ItemType Directory -Path (Split-Path -Parent $onlyOfficeSecretPath) -Force | Out-Null
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $secret = ([BitConverter]::ToString($bytes)).Replace("-", "").ToLowerInvariant()
  [IO.File]::WriteAllText($onlyOfficeSecretPath, "$secret`n", $utf8)
  return $secret
}

function Test-ApplicationRuntime(
  [string]$Url,
  [string]$GatewaySecret,
  [string]$OnlyOfficeSecret,
  [int]$TimeoutSeconds = 5
) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec $TimeoutSeconds -Headers @{
      "X-AIS-Gateway-Token" = $GatewaySecret
    }
    $payload = $response.Content | ConvertFrom-Json
    return [int]$response.StatusCode -eq 200 `
      -and $payload.ok -eq $true `
      -and (@("mysql", "yandex-disk") -contains [string]$payload.storage) `
      -and [string]$payload.runtimeSecrets.gateway -eq (Get-SecretFingerprint $GatewaySecret) `
      -and [string]$payload.runtimeSecrets.documentConverter -eq (Get-SecretFingerprint $OnlyOfficeSecret)
  } catch {
    return $false
  }
}

function Stop-AisNodeServiceAtPort([int]$Port, [string]$EntryPoint) {
  $connection = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $connection) { return }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)"
  $expected = [IO.Path]::GetFullPath($EntryPoint).ToLowerInvariant()
  $commandLine = ([string]$process.CommandLine).Replace("/", "\").ToLowerInvariant()
  if (-not $commandLine.Contains($expected.Replace("/", "\"))) {
    throw "Порт $Port занят процессом, который не относится к АИС. Автоматический перезапуск отменён."
  }
  Stop-Process -Id $connection.OwningProcess -Force
  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 200
  }
}

function Test-TunnelHealth([string]$Url, [int]$TimeoutSeconds = 10) {
  try {
    $uri = [Uri]$Url
    $addresses = @(
      Resolve-DnsName -Name $uri.DnsSafeHost -Type A -Server 1.1.1.1 -ErrorAction Stop |
        Where-Object { $_.IPAddress } |
        Select-Object -ExpandProperty IPAddress
    )
    foreach ($address in $addresses) {
      $output = & curl.exe --silent --show-error --fail --max-time $TimeoutSeconds `
        --resolve "$($uri.DnsSafeHost):443:$address" $Url 2>$null
      if ($LASTEXITCODE -ne 0) { continue }
      $payload = $output | ConvertFrom-Json
      $storage = [string]$payload.storage
      if ($payload.ok -eq $true -and (@("mysql", "yandex-disk") -contains $storage)) {
        return $true
      }
    }
  } catch {
    return $false
  }
  return $false
}

function Start-NodeService(
  [string]$Name,
  [string]$EntryPoint,
  [hashtable]$EnvironmentVariables
) {
  $stdoutPath = Join-Path $logRoot "$Name.stdout.log"
  $stderrPath = Join-Path $logRoot "$Name.stderr.log"
  $previousValues = @{}
  foreach ($entry in $EnvironmentVariables.GetEnumerator()) {
    $previousValues[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key, "Process")
    [Environment]::SetEnvironmentVariable($entry.Key, [string]$entry.Value, "Process")
  }
  try {
    $process = Start-Process -FilePath (Get-NodePath) -ArgumentList @("`"$EntryPoint`"") `
      -WorkingDirectory $appRoot -WindowStyle Hidden `
      -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
  } finally {
    foreach ($entry in $previousValues.GetEnumerator()) {
      [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
    }
  }
  Write-ServiceLog "$Name запущен (PID $($process.Id))."
}

function Get-TunnelSecret {
  if (Test-Path -LiteralPath $secretPath -PathType Leaf) {
    $existing = (Get-Content -Raw -LiteralPath $secretPath).Trim()
    if ($existing.Length -ge 48) { return $existing }
  }
  $bytes = New-Object byte[] 48
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $secret = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
  [IO.File]::WriteAllText($secretPath, $secret, $utf8)
  return $secret
}

function Test-OnlyOfficeContainerSecret([string]$OnlyOfficeSecret) {
  try {
    $environment = & (Get-DockerPath) inspect ais-onlyoffice --format '{{range .Config.Env}}{{println .}}{{end}}'
    if ($LASTEXITCODE -ne 0) { return $false }
    $configured = [string](@($environment | Where-Object { $_ -like "JWT_SECRET=*" } | Select-Object -First 1) -replace '^JWT_SECRET=', '')
    return (Get-SecretFingerprint $configured) -eq (Get-SecretFingerprint $OnlyOfficeSecret)
  } catch {
    return $false
  }
}

function Ensure-Containers([string]$OnlyOfficeSecret) {
  $servicesHealthy = (Test-Health "http://127.0.0.1:8082/healthcheck") `
    -and (Test-Health "http://127.0.0.1:8083/health") `
    -and (Test-OnlyOfficeContainerSecret $OnlyOfficeSecret)
  if ($servicesHealthy) { return }
  $composePath = Join-Path $appRoot "docker-compose.onlyoffice.yml"
  $previousSecret = [Environment]::GetEnvironmentVariable("ONLYOFFICE_JWT_SECRET", "Process")
  [Environment]::SetEnvironmentVariable("ONLYOFFICE_JWT_SECRET", $OnlyOfficeSecret, "Process")
  try {
    $output = & (Get-DockerPath) compose -f $composePath up -d --build 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
      throw "Не удалось запустить OCR и ONLYOFFICE: $($output.Trim())"
    }
  } finally {
    [Environment]::SetEnvironmentVariable("ONLYOFFICE_JWT_SECRET", $previousSecret, "Process")
  }
  Write-ServiceLog "Контейнеры OCR и ONLYOFFICE запущены."
}

function Ensure-ApplicationServers([string]$Secret, [string]$OnlyOfficeSecret) {
  $appEntryPoint = Join-Path $appRoot "app-server.js"
  if (-not (Test-ApplicationRuntime "http://127.0.0.1:$appPort/api/health" $Secret $OnlyOfficeSecret)) {
    if (Test-ApplicationHealth "http://127.0.0.1:$appPort/api/health") {
      Write-ServiceLog "API использует устаревшие служебные ключи; выполняется перезапуск."
      Stop-AisNodeServiceAtPort $appPort $appEntryPoint
    }
    Start-NodeService "app-server-$appPort" (Join-Path $appRoot "app-server.js") @{
      PORT = $appPort
      AIS_TRUST_GATEWAY = "1"
      AIS_GATEWAY_SHARED_SECRET = $Secret
      AIS_TUNNEL_ONLY = "1"
      ONLYOFFICE_SOURCE_URL = "http://host.docker.internal:$appPort"
      ONLYOFFICE_JWT_SECRET = $OnlyOfficeSecret
    }
    $deadline = (Get-Date).AddSeconds(20)
    while (-not (Test-ApplicationHealth "http://127.0.0.1:$appPort/api/health") -and (Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 500
    }
    if (-not (Test-ApplicationHealth "http://127.0.0.1:$appPort/api/health")) {
      throw "Сервер приложения не запустился на порту $appPort."
    }
  }
  $localEntryPoint = Join-Path $appRoot "local-server.js"
  if (-not (Test-ApplicationRuntime "http://127.0.0.1:$localPort/api/health" $Secret $OnlyOfficeSecret)) {
    if (Test-ApplicationHealth "http://127.0.0.1:$localPort/api/health") {
      Write-ServiceLog "Локальный шлюз использует устаревшие служебные ключи; выполняется перезапуск."
      Stop-AisNodeServiceAtPort $localPort $localEntryPoint
    }
    Start-NodeService "local-server-$localPort" (Join-Path $appRoot "local-server.js") @{
      PORT = $localPort
      HOST = "127.0.0.1"
      AIS_APP_SERVER_ORIGIN = "http://127.0.0.1:$appPort"
      AIS_GATEWAY_SHARED_SECRET = $Secret
    }
    $deadline = (Get-Date).AddSeconds(20)
    while (-not (Test-ApplicationHealth "http://127.0.0.1:$localPort/api/health") -and (Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 500
    }
    if (-not (Test-ApplicationHealth "http://127.0.0.1:$localPort/api/health")) {
      throw "Локальный сервер не запустился на порту $localPort."
    }
  }
}

function Get-CloudflaredPath {
  if (Test-Path -LiteralPath $cloudflaredPath -PathType Leaf) { return $cloudflaredPath }
  $command = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  throw "cloudflared не найден. Установите официальный выпуск Cloudflare в $cloudflaredPath."
}

function Publish-TunnelRuntime([string]$BaseUrl, [string]$Secret) {
  $payload = [ordered]@{
    version = 1
    enabled = $true
    baseUrl = $BaseUrl
    secret = $Secret
    updatedAt = (Get-Date).ToUniversalTime().ToString("o")
  }
  [IO.File]::WriteAllText(
    $runtimeConfigPath,
    (($payload | ConvertTo-Json -Depth 4) + "`n"),
    $utf8
  )
  $output = & $deployScriptPath -TunnelRuntime 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    throw "Не удалось опубликовать адрес туннеля: $($output.Trim())"
  }
  Write-ServiceLog "Адрес туннеля опубликован на edu-plus.ru/lms."
}

function Start-QuickTunnel {
  $stdoutPath = Join-Path $logRoot "cloudflared.stdout.log"
  $stderrPath = Join-Path $logRoot "cloudflared.stderr.log"
  Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
  $process = Start-Process -FilePath (Get-CloudflaredPath) -ArgumentList @(
    "tunnel", "--no-autoupdate", "--protocol", "http2", "--url", "http://127.0.0.1:$appPort"
  ) -WorkingDirectory $runtimeRoot -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
  $deadline = (Get-Date).AddSeconds(75)
  do {
    Start-Sleep -Milliseconds 500
    if ($process.HasExited) {
      $details = Get-Content -Raw -LiteralPath $stderrPath -ErrorAction SilentlyContinue
      throw "cloudflared завершился при запуске. $details"
    }
    $text = @(
      Get-Content -Raw -LiteralPath $stdoutPath -ErrorAction SilentlyContinue
      Get-Content -Raw -LiteralPath $stderrPath -ErrorAction SilentlyContinue
    ) -join "`n"
    $match = [regex]::Match($text, "https://[a-z0-9-]+\.trycloudflare\.com", "IgnoreCase")
    if ($match.Success) {
      $url = $match.Value.ToLowerInvariant()
      $readyDeadline = (Get-Date).AddSeconds(45)
      do {
        if (Test-TunnelHealth "$url/api/health" 10) {
          Write-ServiceLog "Cloudflare Tunnel запущен (PID $($process.Id), $url)."
          return [pscustomobject]@{ Process = $process; Url = $url }
        }
        Start-Sleep -Seconds 2
      } while ((Get-Date) -lt $readyDeadline -and -not $process.HasExited)
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      throw "Туннель создан, но внешний адрес не отвечает."
    }
  } while ((Get-Date) -lt $deadline)
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  throw "cloudflared не выдал адрес туннеля за 75 секунд."
}

$secret = Get-TunnelSecret
$onlyOfficeSecret = Get-OnlyOfficeSecret
$tunnel = $null
$failedHealthChecks = 0
$lastPublishedAt = [DateTime]::MinValue

try {
  Write-ServiceLog "Супервизор локальных сервисов запущен."
  while ($true) {
    try {
      Ensure-Containers $onlyOfficeSecret
      Ensure-ApplicationServers $secret $onlyOfficeSecret
      if ($null -eq $tunnel -or $tunnel.Process.HasExited) {
        $tunnel = Start-QuickTunnel
        Publish-TunnelRuntime $tunnel.Url $secret
        $lastPublishedAt = Get-Date
        $failedHealthChecks = 0
      } elseif (Test-TunnelHealth "$($tunnel.Url)/api/health" 10) {
        $failedHealthChecks = 0
        if (((Get-Date) - $lastPublishedAt).TotalHours -ge 6) {
          Publish-TunnelRuntime $tunnel.Url $secret
          $lastPublishedAt = Get-Date
        }
      } else {
        $failedHealthChecks += 1
        if ($failedHealthChecks -ge 3) {
          Write-ServiceLog "Туннель перестал отвечать; выполняется переподключение."
          Stop-Process -Id $tunnel.Process.Id -Force -ErrorAction SilentlyContinue
          $tunnel = $null
        }
      }
    } catch {
      Write-ServiceLog "Ошибка: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds $CheckIntervalSeconds
  }
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}

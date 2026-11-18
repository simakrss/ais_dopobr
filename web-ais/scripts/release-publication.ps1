# Shared release preparation and ordering for deploy-lms.ps1. Loading this file does not publish anything.
function Resolve-AisReleaseSigningKey(
  [string]$RequestedPath,
  [string]$LocalDataRoot = [Environment]::GetFolderPath('LocalApplicationData')
) {
  if ($RequestedPath) {
    $target = [IO.Path]::GetFullPath($RequestedPath)
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw 'Ключ подписи пакета не найден. Проверьте -SigningKeyPath.' }
    return $target
  }
  $candidates = @(Join-Path $LocalDataRoot 'AisDopobrPublisher/local-update-signing-private.pem')
  # The desktop publisher may have created its existing key in the app's redirected LocalAppData.
  $packages = Join-Path $LocalDataRoot 'Packages'
  if (Test-Path -LiteralPath $packages -PathType Container) {
    $candidates += @(Get-ChildItem -LiteralPath $packages -Directory -Filter 'OpenAI.Codex_*' | Sort-Object Name | ForEach-Object {
      Join-Path $_.FullName 'LocalCache/Local/AisDopobrPublisher/local-update-signing-private.pem'
    })
  }
  $found = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
  if (-not $found) { throw 'Публикация остановлена: нужен существующий ключ подписи пакета. Укажите -SigningKeyPath.' }
  return [IO.Path]::GetFullPath($found)
}

function New-AisBootstrapArchive([string]$AppRoot, $Release) {
  if ([string]$Release.version -cnotmatch '^\d+\.\d+\.\d+$') { throw 'Некорректная версия пакета.' }
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $relative = "updates/install-$($Release.version).zip"
  $target = Join-Path $AppRoot $relative
  $manifest = Join-Path $AppRoot 'updates/latest.json'
  $files = @($Release.files)
  if ($Release.PSObject.Properties['components']) { $files += @($Release.components) }
  if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
    $temporary = "$target.$([Guid]::NewGuid().ToString('N')).tmp"
    try {
      $archive = [IO.Compression.ZipFile]::Open($temporary, [IO.Compression.ZipArchiveMode]::Create)
      try {
        foreach ($file in $files) {
          if ([string]$file.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Некорректный файл подписанного пакета.' }
          $payload = Join-Path $AppRoot "updates/files/$($file.sha256).bin"
          [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $payload, $file.path, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $manifest, 'update-manifest.json', [IO.Compression.CompressionLevel]::Optimal) | Out-Null
      } finally { $archive.Dispose() }
      Move-Item -LiteralPath $temporary -Destination $target
    } finally {
      if (Test-Path -LiteralPath $temporary -PathType Leaf) { Remove-Item -LiteralPath $temporary }
    }
  }
  # Reused versioned ZIPs must agree with the signed manifest too.
  $archive = [IO.Compression.ZipFile]::OpenRead($target)
  try {
    $reader = [IO.StreamReader]::new($archive.GetEntry('update-manifest.json').Open())
    try { $packed = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    $expected = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
    if ($packed.payload -cne $expected.payload -or $packed.signature -cne $expected.signature -or $archive.Entries.Count -ne ($files.Count + 1)) {
      throw 'Архив установки не соответствует подписанному манифесту.'
    }
    foreach ($file in $files) {
      $entry = $archive.GetEntry($file.path)
      if (-not $entry -or $entry.Length -ne $file.size) { throw "Повреждён файл архива установки: $($file.path)" }
      $stream = $entry.Open(); $sha = [Security.Cryptography.SHA256]::Create()
      try { $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
      finally { $stream.Dispose(); $sha.Dispose() }
      if ($hash -cne $file.sha256) { throw "Контрольная сумма архива установки не совпала: $($file.path)" }
    }
  } finally { $archive.Dispose() }
  return $relative
}

function New-AisSignedRelease([string]$AppRoot, [string]$SigningKeyPath, [switch]$WindowsComponents) {
  $key = Resolve-AisReleaseSigningKey $SigningKeyPath
  $scripts = Join-Path $AppRoot 'scripts'
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  $nodePath = if ($nodeCommand) { $nodeCommand.Source } else {
    Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
  }
  & $nodePath (Join-Path $scripts 'build-local-update.js') --signing-key-path $key | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Не удалось подготовить подписанный пакет локального обновления.' }
  $envelope = Get-Content -LiteralPath (Join-Path $AppRoot 'updates/latest.json') -Raw | ConvertFrom-Json
  $release = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($envelope.payload)) | ConvertFrom-Json
  $files = @($release.files)
  if ($release.PSObject.Properties['components']) { $files += @($release.components) }
  $bootstrap = New-AisBootstrapArchive $AppRoot $release

  # Both signatures are mandatory, before the first site or release file is uploaded.
  & (Join-Path $scripts 'build-standalone-launcher.ps1') | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Не удалось подписать установщик для новых компьютеров.' }
  $nativePublisherReady = (Test-Path -LiteralPath 'Cert:\CurrentUser\My\65F97E8E8A4FD85B23624BDAA1F97541AC87ECEB') -and
    (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'AisDopobrPublisher\wix3141\candle.exe'))
  $windowsRelative = ''
  if ($WindowsComponents -or $nativePublisherReady) {
    & (Join-Path $scripts 'build-windows-components.ps1') | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Signed MSI build failed.' }
    $windowsRelease = Get-Content -LiteralPath (Join-Path $AppRoot 'updates/windows/latest.json') -Raw | ConvertFrom-Json
    if ([version]$windowsRelease.version -gt [version]$release.version -or $windowsRelease.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Windows release descriptor mismatch.' }
    $windowsRelative = "updates/windows/$($windowsRelease.sha256).msi"
    $windowsFile = Join-Path $AppRoot $windowsRelative
    if ((Get-Item -LiteralPath $windowsFile).Length -ne $windowsRelease.size -or
        (Get-FileHash -LiteralPath $windowsFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $windowsRelease.sha256 -or
        (Get-AuthenticodeSignature -LiteralPath $windowsFile).Status -ne 'Valid') { throw 'Signed MSI verification failed.' }
  }
  return [pscustomobject]@{ Version = $release.version; Files = $files; Bootstrap = $bootstrap; WindowsRelative = $windowsRelative }
}

function Publish-AisSignedRelease($Release, [string]$RemoteRoot) {
  foreach ($file in $Release.Files) {
    if ([string]$file.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Некорректный файл подписанного пакета.' }
    $relative = "updates/files/$($file.sha256).bin"
    Publish-FileTarget $relative "$RemoteRoot/$relative" 'signed update payload'
  }
  Publish-FileTarget $Release.Bootstrap "$RemoteRoot/$($Release.Bootstrap)" 'first-time local update package'
  if ($Release.WindowsRelative) {
    Publish-FileTarget $Release.WindowsRelative "$RemoteRoot/$($Release.WindowsRelative)" 'Authenticode signed Windows Installer'
    Publish-FileTarget 'updates/windows/latest.json' "$RemoteRoot/updates/windows/latest.json" 'Windows component descriptor'
  }
  foreach ($launcherFile in @('updates/launcher/install-ais.ps1', 'updates/launcher/start-ais.bat')) {
    Publish-FileTarget $launcherFile "$RemoteRoot/$launcherFile" 'standalone launcher'
  }
  # This is the activation point: both installers must already be available.
  Publish-FileTarget 'updates/latest.json' "$RemoteRoot/updates/latest.json" 'signed update manifest'
}

[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string[]]$RelativePath = @(),
  [switch]$All,
  [switch]$ListDeployable
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$utf8 = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

$appRoot = Split-Path -Parent $PSScriptRoot
$repositoryRoot = Split-Path -Parent $appRoot
$shortcutPath = Get-ChildItem -LiteralPath $repositoryRoot -Filter "*.lnk" -File |
  Where-Object { $_.Name -like "*vh458.timeweb.ru*" } |
  Select-Object -First 1 -ExpandProperty FullName
$remoteRoot = "/edu-plus.ru/public_html/lms"
$runtimeAppRoot = "/edu-plus.ru/lms-runtime/app"
$runtimeMirrorFiles = @(
  "app-server.js",
  "audit-lib.php",
  "auth-lib.php",
  "data/frdo-export-template.xlsx",
  "services/ocr/server.py",
  "server-cli.js",
  "scripts/sync-student-database.ps1",
  "student-import-worker.js",
  "vendor/mysql2-bundle.cjs",
  "vendor/qrcode-runtime/node_modules/qrcode-generator/qrcode.js"
)

function Normalize-RelativePath([string]$PathValue) {
  $value = [string]$PathValue
  $value = $value.Trim().Replace("\", "/")
  if ($value.StartsWith("web-ais/", [StringComparison]::OrdinalIgnoreCase)) {
    $value = $value.Substring("web-ais/".Length)
  }
  return $value.TrimStart("/")
}

function Test-DeployablePath([string]$PathValue) {
  $path = Normalize-RelativePath $PathValue
  $exactFiles = @(
    ".htaccess",
    "app-server.js",
    "app.js",
    "audit-lib.php",
    "auth-bootstrap.js",
    "auth-lib.php",
    "favicon.ico",
    "gateway.php",
    "index.html",
    "send-mail.php",
    "services/ocr/server.py",
    "server-cli.js",
    "student-import-worker.js",
    "styles.css",
    "scripts/generate-program-payment-registry.js",
    "scripts/query-student-applications.ps1",
    "scripts/sync-student-database.ps1"
  )
  if ($exactFiles -contains $path) { return $true }
  return $path.StartsWith("data/", [StringComparison]::OrdinalIgnoreCase) `
    -or $path.StartsWith("vendor/", [StringComparison]::OrdinalIgnoreCase) `
    -or $path.StartsWith("storage/document-templates/", [StringComparison]::OrdinalIgnoreCase)
}

function Get-TrackedDeployablePaths {
  $tracked = @(& git -c core.quotepath=false -C $repositoryRoot ls-files -- web-ais)
  if ($LASTEXITCODE -ne 0) { throw "Could not read the Git tracked-file list." }
  $generatedSafePaths = @(
    "vendor/mysql2-bundle.cjs",
    "storage/document-templates/employee-contract-education.docx",
    "storage/document-templates/employee-contract-education-no-stamp.docx",
    "storage/document-templates/employee-contract-general.docx",
    "storage/document-templates/employee-contract-general-no-stamp.docx"
  ) | Where-Object {
    Test-Path -LiteralPath (Join-Path $appRoot ($_.Replace("/", [IO.Path]::DirectorySeparatorChar))) -PathType Leaf
  }
  return @(
    @($tracked | ForEach-Object { Normalize-RelativePath $_ }) + $generatedSafePaths |
      Where-Object { Test-DeployablePath $_ } |
      Sort-Object -Unique
  )
}

$trackedDeployable = @(Get-TrackedDeployablePaths)
if ($ListDeployable) {
  $trackedDeployable
  exit 0
}

if ($All) {
  $pathsToDeploy = $trackedDeployable
} else {
  $requested = @($RelativePath | ForEach-Object { Normalize-RelativePath $_ } | Where-Object { $_ })
  if (-not $requested.Count) { throw "Specify -RelativePath or -All." }
  $pathsToDeploy = @(
    $requested |
      Where-Object { $trackedDeployable -contains $_ } |
      Sort-Object -Unique
  )
  $skipped = @($requested | Where-Object { $trackedDeployable -notcontains $_ } | Sort-Object -Unique)
  foreach ($path in $skipped) {
    Write-Warning "Skipped untracked or non-deployable file: $path"
  }
}

if (-not $pathsToDeploy.Count) { throw "No safe tracked files were selected for deployment." }
if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) {
  throw "FTP shortcut was not found."
}

function Get-FtpProfile {
  $bytes = [IO.File]::ReadAllBytes($shortcutPath)
  $ascii = [Text.Encoding]::GetEncoding(28591).GetString($bytes)
  $strings = @(
    [regex]::Matches($ascii, "[\x20-\x7E]{3,}") |
      ForEach-Object { $_.Value.Trim() } |
      Where-Object { $_ }
  )
  $server = $strings |
    Where-Object { $_ -match "^[A-Za-z0-9.-]+\.timeweb\.ru$" } |
    Select-Object -First 1
  $userIndex = -1
  for ($index = 0; $index -lt $strings.Count; $index += 1) {
    if ($strings[$index] -match "^cl\d+_[A-Za-z0-9_]+$") {
      $userIndex = $index
      break
    }
  }
  if (-not $server -or $userIndex -lt 0 -or $userIndex + 1 -ge $strings.Count) {
    throw "Could not read the FTP profile from the shortcut."
  }
  return [pscustomobject]@{
    Server = $server
    Credential = New-Object Net.NetworkCredential($strings[$userIndex], $strings[$userIndex + 1])
  }
}

$ftpProfile = Get-FtpProfile

function New-FtpRequest([string]$RemotePath, [string]$Method) {
  $normalized = "/" + $RemotePath.TrimStart("/")
  $uri = "ftp://$($ftpProfile.Server)$normalized"
  $request = [Net.FtpWebRequest]::Create($uri)
  $request.Method = $Method
  $request.Credentials = $ftpProfile.Credential
  $request.UsePassive = $true
  $request.UseBinary = $true
  $request.KeepAlive = $false
  $request.Timeout = 120000
  $request.ReadWriteTimeout = 120000
  return $request
}

function Close-FtpResponse($Response) {
  if ($null -ne $Response) { $Response.Dispose() }
}

function Test-FtpFile([string]$RemotePath) {
  try {
    $response = (New-FtpRequest $RemotePath ([Net.WebRequestMethods+Ftp]::GetFileSize)).GetResponse()
    Close-FtpResponse $response
    return $true
  } catch [Net.WebException] {
    $response = $_.Exception.Response
    if ($null -ne $response -and [int]$response.StatusCode -eq 550) {
      Close-FtpResponse $response
      return $false
    }
    throw
  }
}

function Ensure-FtpDirectory([string]$RemoteDirectory) {
  $segments = @($RemoteDirectory.Trim("/").Split("/") | Where-Object { $_ })
  $current = ""
  foreach ($segment in $segments) {
    $current += "/$segment"
    try {
      $response = (New-FtpRequest $current ([Net.WebRequestMethods+Ftp]::MakeDirectory)).GetResponse()
      Close-FtpResponse $response
    } catch [Net.WebException] {
      $response = $_.Exception.Response
      if ($null -eq $response -or [int]$response.StatusCode -ne 550) { throw }
      Close-FtpResponse $response
    }
  }
}

function Remove-FtpFileIfExists([string]$RemotePath) {
  if (-not (Test-FtpFile $RemotePath)) { return }
  $response = (New-FtpRequest $RemotePath ([Net.WebRequestMethods+Ftp]::DeleteFile)).GetResponse()
  Close-FtpResponse $response
}

function Rename-FtpFile([string]$RemotePath, [string]$NewName) {
  $request = New-FtpRequest $RemotePath ([Net.WebRequestMethods+Ftp]::Rename)
  $request.RenameTo = $NewName
  $response = $request.GetResponse()
  Close-FtpResponse $response
}

function Send-FtpFile([string]$LocalPath, [string]$RemotePath) {
  $bytes = [IO.File]::ReadAllBytes($LocalPath)
  $request = New-FtpRequest $RemotePath ([Net.WebRequestMethods+Ftp]::UploadFile)
  $request.ContentLength = $bytes.Length
  $stream = $request.GetRequestStream()
  try {
    $stream.Write($bytes, 0, $bytes.Length)
  } finally {
    $stream.Dispose()
  }
  $response = $request.GetResponse()
  Close-FtpResponse $response
}

function Receive-FtpFile([string]$RemotePath) {
  $response = (New-FtpRequest $RemotePath ([Net.WebRequestMethods+Ftp]::DownloadFile)).GetResponse()
  $inputStream = $response.GetResponseStream()
  $memory = New-Object IO.MemoryStream
  try {
    $inputStream.CopyTo($memory)
    return $memory.ToArray()
  } finally {
    $memory.Dispose()
    $inputStream.Dispose()
    Close-FtpResponse $response
  }
}

function Get-Sha256([byte[]]$Bytes) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace("-", "").ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function Publish-FileTarget(
  [string]$RelativeFile,
  [string]$RemotePath,
  [string]$Target
) {
  $localPath = Join-Path $appRoot ($RelativeFile.Replace("/", [IO.Path]::DirectorySeparatorChar))
  if (-not (Test-Path -LiteralPath $localPath -PathType Leaf)) {
    throw "Local file is missing; automatic remote deletion is disabled: $RelativeFile"
  }
  $remoteDirectory = $remotePath.Substring(0, $remotePath.LastIndexOf("/"))
  $fileName = $remotePath.Substring($remotePath.LastIndexOf("/") + 1)
  $temporaryName = "$fileName.codex-upload-$([Guid]::NewGuid().ToString('N'))"
  $previousName = "$fileName.codex-prev"
  $temporaryPath = "$remoteDirectory/$temporaryName"
  $previousPath = "$remoteDirectory/$previousName"
  $hadPrevious = $false

  Ensure-FtpDirectory $remoteDirectory
  Send-FtpFile $localPath $temporaryPath
  Remove-FtpFileIfExists $previousPath

  if (Test-FtpFile $remotePath) {
    Rename-FtpFile $remotePath $previousName
    $hadPrevious = $true
  }

  try {
    Rename-FtpFile $temporaryPath $fileName
  } catch {
    Remove-FtpFileIfExists $temporaryPath
    if ($hadPrevious -and -not (Test-FtpFile $remotePath)) {
      Rename-FtpFile $previousPath $fileName
    }
    throw
  }

  $localBytes = [IO.File]::ReadAllBytes($localPath)
  $remoteBytes = Receive-FtpFile $remotePath
  $localHash = Get-Sha256 $localBytes
  $remoteHash = Get-Sha256 $remoteBytes
  if ($localHash -ne $remoteHash) {
    if ($hadPrevious) {
      Remove-FtpFileIfExists $remotePath
      Rename-FtpFile $previousPath $fileName
    }
    throw "SHA-256 verification failed for $RelativeFile"
  }

  Remove-FtpFileIfExists $previousPath
  return [pscustomobject]@{
    File = $RelativeFile
    Target = $Target
    Bytes = $localBytes.Length
    Sha256 = $localHash.Substring(0, 12)
    Status = "uploaded"
  }
}

$results = foreach ($relativeFile in $pathsToDeploy) {
  Publish-FileTarget $relativeFile "$remoteRoot/$relativeFile" "public"
  $mirrorToRuntime = ($runtimeMirrorFiles -contains $relativeFile) -or `
    $relativeFile.StartsWith("storage/document-templates/employee-contract-", [StringComparison]::OrdinalIgnoreCase)
  if ($mirrorToRuntime) {
    Publish-FileTarget $relativeFile "$runtimeAppRoot/$relativeFile" "runtime"
  }
}

$results | Format-Table -AutoSize

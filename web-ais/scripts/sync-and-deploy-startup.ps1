[CmdletBinding()]
param(
  [ValidateSet("Run", "Validate")]
  [string]$Action = "Run",
  [switch]$SkipGit,
  [switch]$SkipDeployment
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$utf8 = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$appRoot = Split-Path -Parent $PSScriptRoot
$repositoryRoot = Split-Path -Parent $appRoot
$deployScriptPath = Join-Path $PSScriptRoot "deploy-lms.ps1"
$logRoot = Join-Path $appRoot ".runtime\logs"
$logPath = Join-Path $logRoot "startup-update.log"
$script:gitPath = $null

function Write-Update([string]$Message) {
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host "[Обновление] $Message"
  if (-not (Test-Path -LiteralPath $logRoot -PathType Container)) {
    New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
  }
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

function Find-Git {
  $command = Get-Command git.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $candidate = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe"
  if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
  throw "Git не найден."
}

function Invoke-Git {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,
    [switch]$AllowFailure
  )
  # Windows PowerShell 5.1 turns every native stderr line into an ErrorRecord.
  # With the script-wide Stop preference even a harmless Git warning would
  # terminate this function before LASTEXITCODE could be checked.
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $rawLines = @(
      & $script:gitPath -c core.quotepath=false -c safe.directory=* -C $repositoryRoot @Arguments 2>&1
    )
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  $lines = @(
    $rawLines |
      Where-Object { $_ -isnot [Management.Automation.ErrorRecord] } |
      ForEach-Object { [string]$_ }
  )
  $errorLines = @(
    $rawLines |
      Where-Object { $_ -is [Management.Automation.ErrorRecord] } |
      ForEach-Object {
        $message = [string]$_.Exception.Message
        if ([string]::IsNullOrWhiteSpace($message)) { [string]$_ } else { $message }
      }
  )
  $text = ($lines -join "`n").Trim()
  $errorText = ($errorLines -join "`n").Trim()
  if ($code -ne 0 -and -not $AllowFailure) {
    $combinedText = @($text, $errorText) |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    $detailsText = ($combinedText -join "`n").Trim()
    $details = if ($detailsText) { " $detailsText" } else { "" }
    throw "Git завершился с кодом $code.$details"
  }
  return [pscustomobject]@{
    Code = $code
    Text = $text
    Lines = $lines
    ErrorText = $errorText
    ErrorLines = $errorLines
  }
}

function Get-UpstreamBranch {
  $result = Invoke-Git -Arguments @("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}") -AllowFailure
  if ($result.Code -ne 0 -or [string]::IsNullOrWhiteSpace($result.Text)) {
    throw "Для текущей ветки не настроена upstream-ветка GitHub."
  }
  return $result.Text.Trim()
}

function Save-TrackedWorktreeChanges {
  $status = Invoke-Git -Arguments @("status", "--porcelain", "--untracked-files=no")
  if ([string]::IsNullOrWhiteSpace($status.Text)) { return }
  $message = "automatic pre-launch backup {0}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
  Invoke-Git -Arguments @("stash", "push", "-m", $message) | Out-Null
  $stash = Invoke-Git -Arguments @("stash", "list", "-1", "--format=%gd")
  Write-Update "Незакоммиченные отслеживаемые изменения сохранены в $($stash.Text)."
}

function Save-UntrackedUpdateCollisions([string]$Upstream) {
  $remoteChanges = @((Invoke-Git -Arguments @("diff", "--name-only", "HEAD..$Upstream", "--")).Lines |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  if (-not $remoteChanges.Count) { return }
  $untracked = @((Invoke-Git -Arguments @("ls-files", "--others", "--exclude-standard")).Lines |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  if (-not $untracked.Count) { return }

  $collisions = New-Object Collections.Generic.List[string]
  foreach ($localPath in $untracked) {
    foreach ($remotePath in $remoteChanges) {
      if (
        $localPath -ieq $remotePath -or
        $localPath.StartsWith("$remotePath/", [StringComparison]::OrdinalIgnoreCase) -or
        $remotePath.StartsWith("$localPath/", [StringComparison]::OrdinalIgnoreCase)
      ) {
        $collisions.Add($localPath)
        break
      }
    }
  }
  $uniqueCollisions = @($collisions | Sort-Object -Unique)
  if (-not $uniqueCollisions.Count) { return }

  $message = "automatic pre-launch untracked backup {0}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
  $arguments = @("stash", "push", "--include-untracked", "-m", $message, "--") + $uniqueCollisions
  Invoke-Git -Arguments $arguments | Out-Null
  $stash = Invoke-Git -Arguments @("stash", "list", "-1", "--format=%gd")
  Write-Update "Пересекающиеся с обновлением новые файлы сохранены в $($stash.Text)."
}

function Test-RepositoryAndDeploymentConfiguration {
  if (-not (Test-Path -LiteralPath $deployScriptPath -PathType Leaf)) {
    throw "Не найден сценарий публикации: $deployScriptPath"
  }
  $inside = Invoke-Git -Arguments @("rev-parse", "--is-inside-work-tree")
  if ($inside.Text -ne "true") { throw "Папка АИС не является рабочей копией Git." }
  $branch = (Invoke-Git -Arguments @("branch", "--show-current")).Text
  if ([string]::IsNullOrWhiteSpace($branch)) { throw "Git находится в detached HEAD; автоматическое обновление остановлено." }
  $upstream = Get-UpstreamBranch

  $profileOutput = & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass `
    -File $deployScriptPath -ValidateProfile 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Проверка FTP-профиля завершилась ошибкой: $($profileOutput -join ' ')"
  }
  $deployable = @(& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass `
    -File $deployScriptPath -ListDeployable 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "Не удалось проверить список публикации: $($deployable -join ' ')"
  }
  if ($deployable -contains "storage/document-templates/employee-contract-education.docx" -or
      $deployable -contains "storage/document-templates/employee-contract-general.docx") {
    throw "Приватные шаблоны с печатями обнаружены в списке публикации."
  }
  Write-Update "Конфигурация проверена: ветка $branch, upstream $upstream, файлов к публикации: $($deployable.Count)."
}

function Sync-Repository {
  Write-Update "Получение изменений из GitHub..."
  Invoke-Git -Arguments @("fetch", "--prune", "origin") | Out-Null

  $branch = (Invoke-Git -Arguments @("branch", "--show-current")).Text
  if ([string]::IsNullOrWhiteSpace($branch)) { throw "Git находится в detached HEAD; автоматическое обновление остановлено." }
  $upstream = Get-UpstreamBranch
  Save-TrackedWorktreeChanges

  $counts = (Invoke-Git -Arguments @("rev-list", "--left-right", "--count", "HEAD...$upstream")).Text
  $match = [regex]::Match($counts, "^(?<ahead>\d+)\s+(?<behind>\d+)$")
  if (-not $match.Success) { throw "Не удалось сравнить локальную и upstream-ветки Git." }
  $ahead = [int]$match.Groups["ahead"].Value
  $behind = [int]$match.Groups["behind"].Value
  if ($ahead -gt 0) {
    throw "Локальная ветка опережает $upstream на $ahead коммит(ов). Автоматическая отправка в GitHub отключена."
  }
  if ($behind -gt 0) {
    Save-UntrackedUpdateCollisions $upstream
    Invoke-Git -Arguments @("merge", "--ff-only", $upstream) | Out-Null
    Write-Update "Рабочая копия обновлена из $upstream на $behind коммит(ов)."
  } else {
    Write-Update "Рабочая копия уже соответствует $upstream."
  }

  $head = (Invoke-Git -Arguments @("rev-parse", "--short=12", "HEAD")).Text
  Write-Update "Активная версия Git: $head."
}

$script:gitPath = Find-Git

if ($Action -eq "Validate") {
  Test-RepositoryAndDeploymentConfiguration
  Write-Update "Проверка завершена без загрузки из GitHub и без FTP-публикации."
  exit 0
}

if (-not $SkipGit) {
  Sync-Repository
} else {
  Write-Update "Синхронизация GitHub пропущена параметром -SkipGit."
}

if (-not $SkipDeployment) {
  Write-Update "Публикация безопасного набора файлов на edu-plus.ru/lms..."
  & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $deployScriptPath -All
  if ($LASTEXITCODE -ne 0) { throw "FTP-публикация завершилась с кодом $LASTEXITCODE." }
  Write-Update "FTP-публикация и проверка размеров файлов завершены."
} else {
  Write-Update "FTP-публикация пропущена параметром -SkipDeployment."
}

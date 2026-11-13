param(
  [string]$WorkbookPath = "Y:\АИС Допобразование\АИС Допобразование.xlsb"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$sourcePath = (Resolve-Path -LiteralPath $WorkbookPath).Path
$sourceHashBefore = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
$temporaryDirectory = [IO.Path]::Combine(
  [IO.Path]::GetTempPath(),
  "ais-program-promo-test-$([guid]::NewGuid().ToString('N'))"
)
$temporaryWorkbook = [IO.Path]::Combine($temporaryDirectory, "program-promo-test.xlsb")
$syncScriptPath = if ($PSScriptRoot) {
  Join-Path $PSScriptRoot "sync-student-database.ps1"
} else {
  (Resolve-Path ".\web-ais\scripts\sync-student-database.ps1").Path
}
$appServerPath = Join-Path (Split-Path (Split-Path $syncScriptPath -Parent) -Parent) "app-server.js"
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodeExecutable = if ($nodeCommand) {
  $nodeCommand.Source
} else {
  Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
}
if (-not (Test-Path -LiteralPath $nodeExecutable -PathType Leaf)) {
  throw "Для проверки обратного импорта не найден Node.js."
}

$excel = $null
$workbooks = $null
$workbook = $null
$sheet = $null
$nameCell = $null
$codeCell = $null
$firstMessageCell = $null
$secondMessageCell = $null
$emailMessageCell = $null
$firstComment = $null
$secondComment = $null
$emailComment = $null

function Find-TestProgramRow {
  param(
    [object]$Sheet,
    [int]$StartRow,
    [int]$EndRow,
    [int]$LandingCodeColumn,
    [string]$ProgramName,
    [string]$LandingCode
  )
  for ($row = $StartRow; $row -le $EndRow; $row += 1) {
      $nameCell = $null
      $codeCell = $null
      try {
        $nameCell = $Sheet.Cells.Item($row, 1)
        $codeCell = $Sheet.Cells.Item($row, $LandingCodeColumn)
        if (
          (Normalize-Header $nameCell.Value2) -eq (Normalize-Header $ProgramName) `
          -and (Normalize-Header $codeCell.Value2) -eq (Normalize-Header $LandingCode)
        ) {
          return $row
        }
      } finally {
        Release-ComObject $nameCell
        Release-ComObject $codeCell
      }
  }
  throw "После сортировки не найдена тестовая программа «$ProgramName»."
}

try {
  [void](New-Item -ItemType Directory -Path $temporaryDirectory)
  Copy-Item -LiteralPath $sourcePath -Destination $temporaryWorkbook

  $scriptText = [IO.File]::ReadAllText($syncScriptPath, [Text.Encoding]::UTF8)
  $functionText = [regex]::Split($scriptText, "\r?\n\`$excel = \`$null\r?\n", 2)[0]
  . ([ScriptBlock]::Create($functionText)) `
    -InputPath $temporaryWorkbook `
    -OutputPath $temporaryWorkbook `
    -PayloadPath $temporaryWorkbook

  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.EnableEvents = $false
  $excel.AskToUpdateLinks = $false
  $excel.AutomationSecurity = 3
  Start-Sleep -Milliseconds 500
  $workbooks = $excel.Workbooks
  $workbook = $workbooks.Open($temporaryWorkbook, 0, $false)
  Release-ComObject $workbooks
  $workbooks = $null
  $sheet = $workbook.Worksheets.Item("Реестр программ")
  $targetRow = 34
  $header = Find-HeaderRow $sheet @("Наименование программы", "Промосообщение1", "Промосообщение2", "СообщПочты")
  $columns = @(Get-MappedColumns $sheet $header.Row $header.LastColumn ([pscustomobject]@{
    "Код лендинга" = "landingCode"
    "Промосообщение1" = "promoMessage1"
    "Промосообщение2" = "promoMessage2"
    "СообщПочты" = "emailMessageTemplate"
  }))
  $landingCodeColumn = Find-MappedColumn $columns "landingCode"
  $promoMessage1Column = Find-MappedColumn $columns "promoMessage1"
  $promoMessage2Column = Find-MappedColumn $columns "promoMessage2"
  $emailMessageTemplateColumn = Find-MappedColumn $columns "emailMessageTemplate"
  $nameCell = $sheet.Cells.Item($targetRow, 1)
  $codeCell = $sheet.Cells.Item($targetRow, $landingCodeColumn)
  $firstMessageCell = $sheet.Cells.Item($targetRow, $promoMessage1Column)
  $secondMessageCell = $sheet.Cells.Item($targetRow, $promoMessage2Column)
  $emailMessageCell = $sheet.Cells.Item($targetRow, $emailMessageTemplateColumn)
  $originalFirstValue = [string]$firstMessageCell.Value2
  $secondComment = $secondMessageCell.Comment
  $originalSecondValue = [string]$secondMessageCell.Value2
  $originalSecondMessage = if ($null -ne $secondComment) { [string]$secondComment.Text() } else { "" }
  $originalSecondMessage = $originalSecondMessage.Replace("`r`n", "`n").Replace("`r", "`n")
  Release-ComObject $secondComment
  $secondComment = $null
  $programName = [string]$nameCell.Value2
  $landingCode = [string]$codeCell.Value2
  $programSyncMetadata = Get-AisSyncCellMetadata $nameCell "programs"
  $programId = if ($null -ne $programSyncMetadata) {
    ([string](Get-ObjectProperty $programSyncMetadata "recordId")).Trim()
  } else {
    ""
  }
  $message = "Тестовая строка 1`nhttps://example.test/promo?q=1&x=2`nТестовая строка 3"
  $emailMessage = "#ФИО#, здравствуйте!`nДокумент: #Документ#`nhttps://example.test/education"
  $programColumnMap = [pscustomobject]@{
    "Статус" = "status"
    "Код лендинга" = "landingCode"
    "Промосообщение1" = "promoMessage1"
    "Промосообщение2" = "promoMessage2"
    "СообщПочты" = "emailMessageTemplate"
  }
  $payload = [pscustomobject]@{
    programPromoMessagesProvided = $true
    programColumnMap = $programColumnMap
    programs = @([pscustomobject]@{
      id = $programId
      name = $programName
      landingCode = $landingCode
      xlsbProgramName = $programName
      xlsbProgramLandingCode = $landingCode
      xlsbProgramRow = $targetRow
      promoMessage1Provided = $true
      promoMessage2Provided = $false
      emailMessageTemplateProvided = $true
      promoMessage1 = $message
      promoMessage2 = ""
      emailMessageTemplate = $emailMessage
    })
  }

  $result = Update-ProgramPromoMessages $workbook $payload
  foreach ($value in @($nameCell, $codeCell, $firstMessageCell, $secondMessageCell, $emailMessageCell)) {
    Release-ComObject $value
  }
  Release-ComObject $sheet
  $sheet = $workbook.Worksheets.Item("Реестр программ")
  $header = Find-HeaderRow $sheet @("Наименование программы", "Промосообщение1", "Промосообщение2", "СообщПочты")
  $targetRow = Find-TestProgramRow `
    $sheet `
    ([int]$header.Row + 1) `
    ([int]$header.LastRow) `
    $landingCodeColumn `
    $programName `
    $landingCode
  $nameCell = $sheet.Cells.Item($targetRow, 1)
  $codeCell = $sheet.Cells.Item($targetRow, $landingCodeColumn)
  $firstMessageCell = $sheet.Cells.Item($targetRow, $promoMessage1Column)
  $secondMessageCell = $sheet.Cells.Item($targetRow, $promoMessage2Column)
  $emailMessageCell = $sheet.Cells.Item($targetRow, $emailMessageTemplateColumn)
  $workbook.Save()
  $firstComment = $firstMessageCell.Comment
  $secondComment = $secondMessageCell.Comment
  $emailComment = $emailMessageCell.Comment
  $actualMessage = if ($null -ne $firstComment) { [string]$firstComment.Text() } else { "" }
  $actualMessage = $actualMessage.Replace("`r`n", "`n").Replace("`r", "`n")
  $preservedSecondMessage = if ($null -ne $secondComment) { [string]$secondComment.Text() } else { "" }
  $preservedSecondMessage = $preservedSecondMessage.Replace("`r`n", "`n").Replace("`r", "`n")
  $actualEmailMessage = if ($null -ne $emailComment) { [string]$emailComment.Text() } else { "" }
  $actualEmailMessage = $actualEmailMessage.Replace("`r`n", "`n").Replace("`r", "`n")

  if ($result.Count -ne 1 -or $result.Skipped -ne 0) {
    throw "Тестовая программа не сопоставлена: обновлено $($result.Count), пропущено $($result.Skipped)."
  }

  if ([string]$firstMessageCell.Value2 -ne $originalFirstValue) {
    throw "Содержимое ячейки первого промосообщения было изменено."
  }
  if ($actualMessage -ne $message) {
    throw "Текст примечания первого промосообщения отличается от исходного. Ожидалось: [$message]. Получено: [$actualMessage]."
  }
  if (
    [string]$secondMessageCell.Value2 -ne $originalSecondValue `
    -or $preservedSecondMessage -ne $originalSecondMessage
  ) {
    throw "Неизменяемое второе промосообщение было затронуто частичной синхронизацией."
  }
  if ([string]$emailMessageCell.Value2 -ne "Сообщ" -or $actualEmailMessage -ne $emailMessage) {
    throw "Почтовое сообщение программы, примечание или маркер «Сообщ» сохранены неверно."
  }
  if ($result.Count -ne 1 -or $result.Messages -ne 1 -or $result.EmailMessages -ne 1 -or $result.Skipped -ne 0) {
    throw "Некорректная статистика обновления промосообщений."
  }

  Release-ComObject $firstComment
  Release-ComObject $secondComment
  $firstComment = $null
  $secondComment = $null
  $clearPayload = [pscustomobject]@{
    programPromoMessagesProvided = $true
    programColumnMap = $programColumnMap
    programs = @([pscustomobject]@{
      id = $programId
      name = $programName
      landingCode = $landingCode
      xlsbProgramName = $programName
      xlsbProgramLandingCode = $landingCode
      xlsbProgramRow = $targetRow
      promoMessage1Provided = $false
      promoMessage2Provided = $true
      promoMessage1 = ""
      promoMessage2 = ""
    })
  }
  $clearResult = Update-ProgramPromoMessages $workbook $clearPayload
  $workbook.Save()
  $firstComment = $firstMessageCell.Comment
  $secondComment = $secondMessageCell.Comment
  $preservedFirstMessage = if ($null -ne $firstComment) { [string]$firstComment.Text() } else { "" }
  $preservedFirstMessage = $preservedFirstMessage.Replace("`r`n", "`n").Replace("`r", "`n")
  if ([string]$firstMessageCell.Value2 -ne $originalFirstValue -or $preservedFirstMessage -ne $message) {
    throw "Первое промосообщение было затронуто очисткой второго поля."
  }
  if ([string]$secondMessageCell.Value2 -ne $originalSecondValue -or $null -ne $secondComment) {
    throw "Примечание второго промосообщения не очищено либо содержимое ячейки было изменено."
  }
  if ($clearResult.Count -ne 1 -or $clearResult.Messages -ne 0 -or $clearResult.Skipped -ne 0) {
    throw "Некорректная статистика очистки второго промосообщения."
  }
  $savedFirstCellValue = [string]$firstMessageCell.Value2

  foreach ($value in @($firstComment, $secondComment, $emailComment, $nameCell, $codeCell, $firstMessageCell, $secondMessageCell, $emailMessageCell, $sheet)) {
    Release-ComObject $value
  }
  $firstComment = $null
  $secondComment = $null
  $emailComment = $null
  $nameCell = $null
  $codeCell = $null
  $firstMessageCell = $null
  $secondMessageCell = $null
  $emailMessageCell = $null
  $sheet = $null
  $workbook.Close($false)
  Release-ComObject $workbook
  $workbook = $null
  $excel.Quit()
  Release-ComObject $excel
  $excel = $null
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()

  $verifyScript = @'
const fs = require("fs");
const { parseStudentDatabaseWorkbook } = require(process.argv[2]);
const result = parseStudentDatabaseWorkbook(fs.readFileSync(process.argv[3]));
const row = (result.programPaymentSettings || [])
  .find((item) => Number(item.xlsbProgramRow) === Number(process.argv[4]));
if (!row) throw new Error("Program row was not imported from the saved workbook.");
process.stdout.write(JSON.stringify({
  promoMessage1: String(row.promoMessage1 || ""),
  promoMessage2: String(row.promoMessage2 || ""),
  emailMessageTemplate: String(row.emailMessageTemplate || "")
}));
'@
  $verifyScriptPath = Join-Path $temporaryDirectory "verify-program-promo.js"
  [IO.File]::WriteAllText($verifyScriptPath, $verifyScript, [Text.UTF8Encoding]::new($false))
  $verificationOutput = @(& $nodeExecutable $verifyScriptPath $appServerPath $temporaryWorkbook ([string]$targetRow))
  if ($LASTEXITCODE -ne 0) {
    throw "Не удалось повторно прочитать сохранённую временную XLSB."
  }
  $verification = $verificationOutput[-1] | ConvertFrom-Json
  if (
    [string]$verification.promoMessage1 -ne $message `
    -or [string]$verification.promoMessage2 `
    -or [string]$verification.emailMessageTemplate -ne $emailMessage
  ) {
    throw "Повторный импорт сохранённой временной XLSB вернул неверные промосообщения."
  }

  [pscustomobject]@{
    updatedPrograms = $result.Count
    writtenMessages = $result.Messages
    writtenEmailMessages = $result.EmailMessages
    skippedPrograms = $result.Skipped
    preservedCellValue = $savedFirstCellValue
    commentLength = $actualMessage.Length
    adjacentMessagePreserved = $true
    emptyMessageCleared = $true
    savedWorkbookReimported = $true
  } | ConvertTo-Json -Compress
} finally {
  foreach ($value in @(
    $firstComment,
    $secondComment,
    $emailComment,
    $nameCell,
    $codeCell,
    $firstMessageCell,
    $secondMessageCell,
    $emailMessageCell,
    $workbooks,
    $sheet
  )) {
    if ($null -ne $value -and [Runtime.InteropServices.Marshal]::IsComObject($value)) {
      try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($value) } catch {}
    }
  }
  if ($null -ne $workbook) {
    try { $workbook.Close($false) } catch {}
    try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbook) } catch {}
  }
  if ($null -ne $excel) {
    try { $excel.Quit() } catch {}
    try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) } catch {}
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()

  $resolvedTemporaryDirectory = [IO.Path]::GetFullPath($temporaryDirectory)
  $resolvedSystemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  $safeTemporaryDirectory = $resolvedTemporaryDirectory.StartsWith(
    $resolvedSystemTemp,
    [StringComparison]::OrdinalIgnoreCase
  ) -and [IO.Path]::GetFileName($resolvedTemporaryDirectory).StartsWith("ais-program-promo-test-")
  if ($safeTemporaryDirectory -and (Test-Path -LiteralPath $resolvedTemporaryDirectory)) {
    Remove-Item -LiteralPath $resolvedTemporaryDirectory -Recurse -Force
  }
}

$sourceHashAfter = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
if ($sourceHashBefore -ne $sourceHashAfter) {
  throw "Исходная XLSB была изменена во время теста."
}
Write-Output "Исходная XLSB не изменена."

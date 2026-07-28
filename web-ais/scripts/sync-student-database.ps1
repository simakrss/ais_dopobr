param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath,

  [Parameter(Mandatory = $true)]
  [string]$PayloadPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Release-ComObject {
  param([object]$Value)
  if ($null -ne $Value -and [Runtime.InteropServices.Marshal]::IsComObject($Value)) {
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($Value)
  }
}

function Write-SyncProgress {
  param(
    [int]$Progress,
    [string]$Message
  )
  $json = [pscustomobject]@{
    type = "progress"
    progress = [Math]::Max(0, [Math]::Min(100, $Progress))
    message = $Message
  } | ConvertTo-Json -Compress
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

function Normalize-Header {
  param([object]$Value)
  return ([string]$Value).Trim() -replace "\s+", " "
}

function Convert-Uid {
  param([object]$Value)
  if ($null -eq $Value) { return "" }
  if ($Value -is [double] -or $Value -is [float] -or $Value -is [decimal]) {
    return ([Convert]::ToString($Value, [Globalization.CultureInfo]::InvariantCulture) -replace "\.0+$", "").Trim()
  }
  return ([string]$Value -replace "\.0+$", "").Trim()
}

function Get-ObjectProperty {
  param(
    [object]$Record,
    [string]$Name
  )
  if ($null -eq $Record) { return $null }
  $property = $Record.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Get-MatrixValue {
  param(
    [object]$Matrix,
    [int]$Row,
    [int]$Column
  )
  if ($Matrix -isnot [Array]) {
    if ($Row -eq 1 -and $Column -eq 1) { return $Matrix }
    return $null
  }
  return $Matrix.GetValue(
    $Matrix.GetLowerBound(0) + $Row - 1,
    $Matrix.GetLowerBound(1) + $Column - 1
  )
}

function Convert-DateToExcelSerial {
  param([object]$Value)
  $text = ([string]$Value).Trim()
  if (-not $text) { return $null }
  $date = [datetime]::MinValue
  if ([datetime]::TryParseExact(
    $text,
    "yyyy-MM-dd",
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::None,
    [ref]$date
  )) {
    return $date.ToOADate()
  }
  if ([datetime]::TryParse($text, [Globalization.CultureInfo]::GetCultureInfo("ru-RU"), [Globalization.DateTimeStyles]::None, [ref]$date)) {
    return $date.ToOADate()
  }
  return $null
}

function Convert-CellValue {
  param(
    [object]$Value,
    [string]$FieldName,
    [Collections.Generic.HashSet[string]]$DateFields,
    [Collections.Generic.HashSet[string]]$NumberFields
  )
  if ($null -eq $Value) { return $null }
  if ($DateFields.Contains($FieldName)) {
    return Convert-DateToExcelSerial $Value
  }
  if ($NumberFields.Contains($FieldName)) {
    if ($Value -is [double] -or $Value -is [float] -or $Value -is [decimal] -or $Value -is [int] -or $Value -is [long]) {
      return [double]$Value
    }
    $number = 0.0
    $text = ([string]$Value).Replace([string][char]0x00A0, "").Replace(" ", "").Replace(",", ".").Trim()
    if (-not $text) { return $null }
    if ([double]::TryParse($text, [Globalization.NumberStyles]::Any, [Globalization.CultureInfo]::InvariantCulture, [ref]$number)) {
      return $number
    }
    return [string]$Value
  }
  if ($FieldName -eq "gender") {
    $gender = ([string]$Value).Trim().ToLowerInvariant()
    if ($gender -eq "женский" -or $gender -eq "ж") { return "Ж" }
    if ($gender -eq "мужской" -or $gender -eq "м") { return "М" }
  }
  if ($FieldName -eq "uid") { return Convert-Uid $Value }
  if ($Value -is [bool]) { return $(if ($Value) { "Да" } else { "" }) }
  if ($Value -is [string]) {
    $text = $Value.Trim()
    return $(if ($text) { $text } else { $null })
  }
  return $Value
}

function Encode-StudentEventValue {
  param([object]$Value)
  $text = ([string]$Value).Trim()
  if (-not $text) { return "" }
  $encoding = [Text.Encoding]::GetEncoding(1251)
  return [Convert]::ToBase64String($encoding.GetBytes($text))
}

function Get-StudentEventKeys {
  param(
    [object]$Record,
    [object[]]$EventTemplates
  )
  $deleted = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($key in (([string](Get-ObjectProperty $Record "eventDeleted")) -split ",")) {
    $value = $key.Trim()
    if ($value) { [void]$deleted.Add($value) }
  }
  $keys = [Collections.Generic.List[string]]::new()
  $used = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  $orderedValues = @(
    ([string](Get-ObjectProperty $Record "eventOrder")),
    ([string](Get-ObjectProperty $Record "eventCustomKeys"))
  )
  foreach ($list in $orderedValues) {
    foreach ($key in ($list -split ",")) {
      $value = $key.Trim()
      if ($value -and -not $deleted.Contains($value) -and $used.Add($value)) {
        $keys.Add($value)
      }
    }
  }
  foreach ($template in @($EventTemplates)) {
    $key = ([string](Get-ObjectProperty $template "key")).Trim()
    if ($key -and -not $deleted.Contains($key) -and $used.Add($key)) {
      $keys.Add($key)
    }
  }
  return @($keys)
}

function Format-StudentEventDate {
  param([object]$Value)
  $text = ([string]$Value).Trim()
  if (-not $text) { return "" }
  $date = [datetime]::MinValue
  if ([datetime]::TryParseExact(
    $text,
    "yyyy-MM-dd",
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::None,
    [ref]$date
  )) {
    return $date.ToString("dd.MM.yyyy", [Globalization.CultureInfo]::InvariantCulture)
  }
  return $text
}

function Build-StudentEventSettings {
  param(
    [object]$Record,
    [object]$ExistingValue,
    [object[]]$EventTemplates
  )
  $templateLabels = @{}
  foreach ($template in @($EventTemplates)) {
    $key = ([string](Get-ObjectProperty $template "key")).Trim()
    if ($key) { $templateLabels[$key] = [string](Get-ObjectProperty $template "label") }
  }

  $preservedLines = [Collections.Generic.List[string]]::new()
  $insideEventSection = $false
  foreach ($line in (([string]$ExistingValue) -split "\r?\n")) {
    $trimmed = $line.Trim()
    if ($trimmed.StartsWith("[")) {
      $insideEventSection = $trimmed -match "^\[КарточкаСлушателя\\События(?:\\\d+)?\]$"
    }
    if (-not $insideEventSection) { $preservedLines.Add($line) }
  }
  $rootIndex = -1
  for ($index = 0; $index -lt $preservedLines.Count; $index += 1) {
    if ($preservedLines[$index].Trim() -eq "[КарточкаСлушателя]") {
      $rootIndex = $index
      break
    }
  }
  if ($rootIndex -lt 0) {
    $preservedLines.Insert(0, "События=")
    $preservedLines.Insert(0, "[КарточкаСлушателя]")
  } else {
    $hasEventSectionName = $false
    for ($index = $rootIndex + 1; $index -lt $preservedLines.Count; $index += 1) {
      $line = $preservedLines[$index].Trim()
      if ($line.StartsWith("[")) { break }
      if ($line -match "^События=") {
        $hasEventSectionName = $true
        break
      }
    }
    if (-not $hasEventSectionName) {
      $preservedLines.Insert($rootIndex + 1, "События=")
    }
  }

  $eventBlocks = [Collections.Generic.List[object]]::new()
  foreach ($key in @(Get-StudentEventKeys $Record $EventTemplates)) {
    $label = ([string](Get-ObjectProperty $Record "event_${key}_label")).Trim()
    if (-not $label -and $templateLabels.ContainsKey($key)) { $label = $templateLabels[$key] }
    if (-not $label) { continue }
    $date = Format-StudentEventDate (Get-ObjectProperty $Record "event_${key}_date")
    $state = ([string](Get-ObjectProperty $Record "event_${key}_state")).Trim().ToLowerInvariant()
    $selected = $state -and $state -notin @("none", "unchecked", "false", "0")
    $eventBlocks.Add([pscustomobject]@{
      Label = $label
      Date = $date
      Selected = $selected
    })
  }

  $selectedIndexes = [Collections.Generic.List[string]]::new()
  for ($index = 0; $index -lt $eventBlocks.Count; $index += 1) {
    if ($eventBlocks[$index].Selected) { $selectedIndexes.Add([string]($index + 1)) }
  }
  $eventLines = [Collections.Generic.List[string]]::new()
  $eventLines.Add("[КарточкаСлушателя\События]")
  $eventLines.Add("Тип=LB")
  $eventLines.Add("Кол=$($eventBlocks.Count)")
  $eventLines.Add("Выд=$($selectedIndexes -join ',')")
  for ($index = 0; $index -lt $eventBlocks.Count; $index += 1) {
    $number = $index + 1
    $eventLines.Add("[КарточкаСлушателя\События\$number]")
    $eventLines.Add("Кол=2")
    $eventLines.Add("0=$(Encode-StudentEventValue $eventBlocks[$index].Date)")
    $eventLines.Add("1=$(Encode-StudentEventValue $eventBlocks[$index].Label)")
  }

  $prefix = ($preservedLines -join "`r`n").TrimEnd()
  $events = $eventLines -join "`r`n"
  return $(if ($prefix) { "$prefix`r`n$events" } else { $events })
}

function Find-HeaderRow {
  param(
    [object]$Sheet,
    [string[]]$RequiredHeaders
  )
  $usedRange = $null
  try {
    $usedRange = $Sheet.UsedRange
    $firstRow = [Math]::Max(1, [int]$usedRange.Row)
    $lastRow = [int]$usedRange.Row + [int]$usedRange.Rows.Count - 1
    $lastColumn = [int]$usedRange.Column + [int]$usedRange.Columns.Count - 1
    $scanEndRow = [Math]::Min($lastRow, $firstRow + 20)
    for ($row = $firstRow; $row -le $scanEndRow; $row += 1) {
      $range = $null
      try {
        $range = $Sheet.Range($Sheet.Cells.Item($row, 1), $Sheet.Cells.Item($row, $lastColumn))
        $values = $range.Value2
        $headers = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        for ($column = 1; $column -le $lastColumn; $column += 1) {
          $header = Normalize-Header (Get-MatrixValue $values 1 $column)
          if ($header) { [void]$headers.Add($header) }
        }
        $matches = $true
        foreach ($required in $RequiredHeaders) {
          if (-not $headers.Contains((Normalize-Header $required))) {
            $matches = $false
            break
          }
        }
        if ($matches) {
          return [pscustomobject]@{
            Row = $row
            LastRow = $lastRow
            LastColumn = $lastColumn
          }
        }
      } finally {
        Release-ComObject $range
      }
    }
  } finally {
    Release-ComObject $usedRange
  }
  throw "Не найдена строка заголовков с колонками: $($RequiredHeaders -join ', ')."
}

function Get-MappedColumns {
  param(
    [object]$Sheet,
    [int]$HeaderRow,
    [int]$LastColumn,
    [object]$ColumnMap
  )
  $normalizedMap = @{}
  foreach ($property in $ColumnMap.PSObject.Properties) {
    $normalizedMap[(Normalize-Header $property.Name)] = [string]$property.Value
  }
  $headerRange = $null
  try {
    $headerRange = $Sheet.Range($Sheet.Cells.Item($HeaderRow, 1), $Sheet.Cells.Item($HeaderRow, $LastColumn))
    $values = $headerRange.Value2
    $columns = @()
    for ($column = 1; $column -le $LastColumn; $column += 1) {
      $header = Normalize-Header (Get-MatrixValue $values 1 $column)
      if ($header -and $normalizedMap.ContainsKey($header)) {
        $columns += [pscustomobject]@{
          Column = $column
          Header = $header
          FieldName = $normalizedMap[$header]
        }
      }
    }
    return @($columns)
  } finally {
    Release-ComObject $headerRange
  }
}

function Find-MappedColumn {
  param(
    [object[]]$Columns,
    [string]$FieldName
  )
  $match = $Columns | Where-Object { $_.FieldName -eq $FieldName } | Select-Object -First 1
  if ($null -eq $match) { throw "Не найдена колонка для поля $FieldName." }
  return [int]$match.Column
}

function Update-MappedColumn {
  param(
    [object]$Sheet,
    [int]$StartRow,
    [int]$EndRow,
    [int]$Column,
    [string]$FieldName,
    [hashtable]$RecordByRow,
    [Collections.Generic.HashSet[string]]$DateFields,
    [Collections.Generic.HashSet[string]]$NumberFields,
    [object[]]$EventTemplates,
    [Collections.Generic.HashSet[int]]$PreserveRows
  )
  if ($EndRow -lt $StartRow) { return }
  $range = $null
  try {
    $range = $Sheet.Range($Sheet.Cells.Item($StartRow, $Column), $Sheet.Cells.Item($EndRow, $Column))
    $formulas = $range.Formula
    $rowCount = $EndRow - $StartRow + 1
    $nextValues = New-Object "object[,]" $rowCount, 1
    for ($offset = 0; $offset -lt $rowCount; $offset += 1) {
      $currentValue = Get-MatrixValue $formulas ($offset + 1) 1
      if ($currentValue -is [string] -and $currentValue.StartsWith("=")) {
        $nextValues[$offset, 0] = $currentValue
        continue
      }
      $row = $StartRow + $offset
      $record = $RecordByRow[$row]
      if ($null -eq $record -and $null -ne $PreserveRows -and $PreserveRows.Contains($row)) {
        $nextValues[$offset, 0] = $currentValue
        continue
      }
      if ($FieldName -eq "__eventSettings") {
        $nextValues[$offset, 0] = if ($null -eq $record) {
          $null
        } else {
          Build-StudentEventSettings $record $currentValue $EventTemplates
        }
        continue
      }
      $value = Get-ObjectProperty $record $FieldName
      $nextValues[$offset, 0] = Convert-CellValue $value $FieldName $DateFields $NumberFields
    }
    $range.Formula = $nextValues
  } finally {
    Release-ComObject $range
  }
}

function Insert-StudentTemplateRows {
  param(
    [object]$Sheet,
    [int]$SourceRow,
    [int]$InsertRow,
    [int]$LastColumn,
    [int]$Count
  )
  if ($Count -le 0) { return }
  $insertedRows = $null
  $sourceRange = $null
  $targetRange = $null
  $constantCells = $null
  try {
    $insertEndRow = $InsertRow + $Count - 1
    $insertedRows = $Sheet.Rows.Item("${InsertRow}:${insertEndRow}")
    $insertedRows.Insert(-4121, 0) | Out-Null
    $sourceRange = $Sheet.Range($Sheet.Cells.Item($SourceRow, 1), $Sheet.Cells.Item($SourceRow, $LastColumn))
    $targetRange = $Sheet.Range(
      $Sheet.Cells.Item($InsertRow, 1),
      $Sheet.Cells.Item($insertEndRow, $LastColumn)
    )
    $sourceRange.Copy() | Out-Null
    $targetRange.PasteSpecial(-4104) | Out-Null
    try {
      $constantCells = $targetRange.SpecialCells(2)
      $constantCells.ClearContents() | Out-Null
    } catch {}
    $targetRange.RowHeight = $sourceRange.RowHeight
  } finally {
    Release-ComObject $constantCells
    Release-ComObject $targetRange
    Release-ComObject $sourceRange
    Release-ComObject $insertedRows
  }
}

function Update-StudentSheet {
  param(
    [object]$Workbook,
    [object]$Payload,
    [Collections.Generic.HashSet[string]]$DateFields,
    [Collections.Generic.HashSet[string]]$NumberFields
  )
  $sheet = $null
  try {
    $sheet = $Workbook.Worksheets.Item("База")
    $header = Find-HeaderRow $sheet @("uid", "ФИО")
    $columns = @(Get-MappedColumns $sheet $header.Row $header.LastColumn $Payload.studentColumnMap)
    $uidColumn = Find-MappedColumn $columns "uid"
    $nameColumn = Find-MappedColumn $columns "name"
    $startRow = $header.Row + 1
    $lastRow = [int]$header.LastRow
    $targetSectionTitle = "На зачисление (пока без документов)"
    $nextSectionTitle = "Заявки (без оплаты)"

    $uidRange = $null
    $nameRange = $null
    $existingUidCounts = @{}
    $targetSectionRow = 0
    $nextSectionRow = 0
    $targetSeparatorBlankRowCount = 0
    $targetBlankRows = [Collections.Generic.List[int]]::new()
    try {
      $uidRange = $sheet.Range($sheet.Cells.Item($startRow, $uidColumn), $sheet.Cells.Item($lastRow, $uidColumn))
      $nameRange = $sheet.Range($sheet.Cells.Item($startRow, $nameColumn), $sheet.Cells.Item($lastRow, $nameColumn))
      $uidValues = $uidRange.Value2
      $nameValues = $nameRange.Value2
      for ($row = $startRow; $row -le $lastRow; $row += 1) {
        $offset = $row - $startRow + 1
        $uid = Convert-Uid (Get-MatrixValue $uidValues $offset 1)
        $name = ([string](Get-MatrixValue $nameValues $offset 1)).Trim()
        if ($uid) {
          if (-not $existingUidCounts.ContainsKey($uid)) {
            $existingUidCounts[$uid] = 0
          }
          $existingUidCounts[$uid] += 1
        }
        if ([string]::Equals($name, $targetSectionTitle, [StringComparison]::InvariantCultureIgnoreCase)) {
          $targetSectionRow = $row
        } elseif (
          $targetSectionRow -gt 0 -and
          [string]::Equals($name, $nextSectionTitle, [StringComparison]::InvariantCultureIgnoreCase)
        ) {
          $nextSectionRow = $row
          break
        }
      }
      if ($targetSectionRow -le 0 -or $nextSectionRow -le $targetSectionRow) {
        throw "Не найдены границы раздела '$targetSectionTitle' на листе 'База'."
      }
      for ($row = $nextSectionRow - 1; $row -gt $targetSectionRow; $row -= 1) {
        $offset = $row - $startRow + 1
        $uid = Convert-Uid (Get-MatrixValue $uidValues $offset 1)
        $name = ([string](Get-MatrixValue $nameValues $offset 1)).Trim()
        if ($uid -or $name) { break }
        $targetSeparatorBlankRowCount += 1
      }
      $targetSeparatorStartRow = $nextSectionRow - $targetSeparatorBlankRowCount
      for ($row = $targetSectionRow + 1; $row -lt $nextSectionRow; $row += 1) {
        $offset = $row - $startRow + 1
        $uid = Convert-Uid (Get-MatrixValue $uidValues $offset 1)
        $name = ([string](Get-MatrixValue $nameValues $offset 1)).Trim()
        if (-not $uid -and -not $name -and $row -lt $targetSeparatorStartRow) {
          $targetBlankRows.Add([int]$row) | Out-Null
        }
      }
    } finally {
      Release-ComObject $uidRange
      Release-ComObject $nameRange
      $uidRange = $null
      $nameRange = $null
    }

    $remainingUidCounts = @{}
    foreach ($entry in $existingUidCounts.GetEnumerator()) {
      $remainingUidCounts[$entry.Key] = [int]$entry.Value
    }
    $newStudentCount = 0
    foreach ($student in @($Payload.students)) {
      $uid = Convert-Uid (Get-ObjectProperty $student "uid")
      if (-not $uid) { continue }
      if ($remainingUidCounts.ContainsKey($uid) -and $remainingUidCounts[$uid] -gt 0) {
        $remainingUidCounts[$uid] -= 1
      } else {
        $newStudentCount += 1
      }
    }

    if ($newStudentCount -gt $targetBlankRows.Count) {
      $insertRow = $nextSectionRow - $targetSeparatorBlankRowCount
      $templateRow = if ($targetBlankRows.Count -gt 0) {
        $targetBlankRows[$targetBlankRows.Count - 1]
      } elseif ($targetSeparatorBlankRowCount -gt 0) {
        $insertRow
      } else {
        $targetSectionRow + 1
      }
      $rowsToInsert = $newStudentCount - $targetBlankRows.Count
      Write-SyncProgress 9 "Добавление $rowsToInsert строк в раздел '$targetSectionTitle'..."
      Insert-StudentTemplateRows $sheet $templateRow $insertRow $header.LastColumn $rowsToInsert
      for ($index = 0; $index -lt $rowsToInsert; $index += 1) {
        $targetBlankRows.Add([int]($insertRow + $index)) | Out-Null
      }
      $nextSectionRow += $rowsToInsert
      $lastRow += $rowsToInsert
    }

    $preserveRows = [Collections.Generic.HashSet[int]]::new()
    $rowsByUid = @{}
    $newStudentRows = [Collections.Generic.Queue[int]]::new()
    $targetSeparatorStartRow = $nextSectionRow - $targetSeparatorBlankRowCount
    try {
      $uidRange = $sheet.Range($sheet.Cells.Item($startRow, $uidColumn), $sheet.Cells.Item($lastRow, $uidColumn))
      $nameRange = $sheet.Range($sheet.Cells.Item($startRow, $nameColumn), $sheet.Cells.Item($lastRow, $nameColumn))
      $uidValues = $uidRange.Value2
      $nameValues = $nameRange.Value2
      for ($row = $startRow; $row -le $lastRow; $row += 1) {
        $offset = $row - $startRow + 1
        $uid = Convert-Uid (Get-MatrixValue $uidValues $offset 1)
        $name = ([string](Get-MatrixValue $nameValues $offset 1)).Trim()
        if ($uid) {
          if (-not $rowsByUid.ContainsKey($uid)) {
            $rowsByUid[$uid] = [Collections.Generic.Queue[int]]::new()
          }
          $rowsByUid[$uid].Enqueue($row)
        } else {
          $preserveRows.Add($row) | Out-Null
          if (
            $row -gt $targetSectionRow -and
            $row -lt $targetSeparatorStartRow -and
            -not $name
          ) {
            $newStudentRows.Enqueue($row)
          }
        }
      }
    } finally {
      Release-ComObject $uidRange
      Release-ComObject $nameRange
    }

    $recordByRow = @{}
    foreach ($student in @($Payload.students)) {
      $uid = Convert-Uid (Get-ObjectProperty $student "uid")
      if (-not $uid) { continue }
      if ($rowsByUid.ContainsKey($uid) -and $rowsByUid[$uid].Count -gt 0) {
        $row = $rowsByUid[$uid].Dequeue()
      } elseif ($newStudentRows.Count -gt 0) {
        $row = $newStudentRows.Dequeue()
        $preserveRows.Remove($row) | Out-Null
      } else {
        throw "Недостаточно строк в разделе '$targetSectionTitle' для новых слушателей."
      }
      $recordByRow[$row] = $student
    }

    $processedColumns = 0
    foreach ($column in $columns) {
      Update-MappedColumn $sheet $startRow $lastRow $column.Column $column.FieldName $recordByRow $DateFields $NumberFields @($Payload.studentEventTemplates) $preserveRows
      $processedColumns += 1
      Write-SyncProgress (
        8 + [Math]::Floor(($processedColumns / [Math]::Max(1, $columns.Count)) * 62)
      ) "Обновление слушателей: $processedColumns из $($columns.Count) колонок"
    }
    return [pscustomobject]@{
      Count = $recordByRow.Count
      LastRow = $lastRow
    }
  } catch {
    throw "Ошибка обновления листа 'База': $($_.Exception.Message)`n$($_.ScriptStackTrace)"
  } finally {
    Release-ComObject $sheet
  }
}

function Update-DirectExpenseSheet {
  param(
    [object]$Workbook,
    [object]$Payload,
    [Collections.Generic.HashSet[string]]$DateFields,
    [Collections.Generic.HashSet[string]]$NumberFields
  )
  $sheet = $null
  try {
    $sheet = $Workbook.Worksheets.Item("Прямые затраты")
    $header = Find-HeaderRow $sheet @("uid", "Дата", "Вид затрат")
    $columns = @(Get-MappedColumns $sheet $header.Row $header.LastColumn $Payload.directExpenseColumnMap)
    $startRow = $header.Row + 1
    $expenses = @($Payload.directExpenses)
    $lastRow = [Math]::Max([int]$header.LastRow, $header.Row + $expenses.Count)
    $recordByRow = @{}
    for ($index = 0; $index -lt $expenses.Count; $index += 1) {
      $recordByRow[$startRow + $index] = $expenses[$index]
    }
    $processedColumns = 0
    foreach ($column in $columns) {
      Update-MappedColumn $sheet $startRow $lastRow $column.Column $column.FieldName $recordByRow $DateFields $NumberFields @() $null
      $processedColumns += 1
      Write-SyncProgress (
        70 + [Math]::Floor(($processedColumns / [Math]::Max(1, $columns.Count)) * 20)
      ) "Обновление прямых затрат: $processedColumns из $($columns.Count) колонок"
    }
    return [pscustomobject]@{
      Count = $expenses.Count
      LastRow = $lastRow
    }
  } finally {
    Release-ComObject $sheet
  }
}

$excel = $null
$workbook = $null
try {
  Write-SyncProgress 1 "Чтение данных веб-базы..."
  $payload = Get-Content -LiteralPath $PayloadPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $dateFields = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($field in @($payload.studentDateFields)) { [void]$dateFields.Add([string]$field) }
  [void]$dateFields.Add("date")
  $numberFields = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($field in @($payload.studentNumberFields)) { [void]$numberFields.Add([string]$field) }
  [void]$numberFields.Add("amount")

  Write-SyncProgress 3 "Запуск Microsoft Excel..."
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.EnableEvents = $false
  $excel.AskToUpdateLinks = $false
  $excel.AutomationSecurity = 3
  $workbook = $excel.Workbooks.Open($InputPath, 0, $false)

  Write-SyncProgress 8 "Книга открыта. Обновление слушателей..."
  $studentResult = Update-StudentSheet $workbook $payload $dateFields $numberFields
  $expenseResult = Update-DirectExpenseSheet $workbook $payload $dateFields $numberFields

  Write-SyncProgress 92 "Сохранение обновлённой книги..."
  try { $workbook.ForceFullCalculation = $true } catch {}
  try { $workbook.FullCalculationOnLoad = $true } catch {}
  try { $workbook.CalculateBeforeSave = $true } catch {}
  $workbook.SaveAs($OutputPath, 50)
  Write-SyncProgress 100 "Книга сохранена."

  [pscustomobject]@{
    type = "result"
    students = $studentResult.Count
    directExpenses = $expenseResult.Count
    outputPath = $OutputPath
  } | ConvertTo-Json -Compress | Write-Output
} finally {
  if ($null -ne $workbook) {
    try { $workbook.Close($false) } catch {}
    Release-ComObject $workbook
  }
  if ($null -ne $excel) {
    try { $excel.Quit() } catch {}
    Release-ComObject $excel
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}

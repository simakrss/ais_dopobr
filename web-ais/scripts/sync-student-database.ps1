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
$AgentRateWithAuthorDefinedName = "AIS_AgentRateWithAuthor"
$AgentRateWithoutAuthorDefinedName = "AIS_AgentRateWithoutAuthor"

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

function Test-ObjectProperty {
  param(
    [object]$Record,
    [string]$Name
  )
  if ($null -eq $Record) { return $false }
  return $null -ne $Record.PSObject.Properties[$Name]
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
  if ($FieldName -in @("accountingRecorded", "notificationEmail")) {
    if ($Value -is [bool]) { return $Value }
    $flag = ([string]$Value).Trim().ToLowerInvariant()
    if ($flag -in @("да", "true", "1")) { return $true }
    if ($flag -in @("нет", "false", "0")) { return $false }
  }
  if ($FieldName -eq "uid") { return Convert-Uid $Value }
  if ($Value -is [bool]) { return $(if ($Value) { "Да" } else { "" }) }
  if ($Value -is [string]) {
    $text = $Value.Trim()
    return $(if ($text) { $text } else { $null })
  }
  return $Value
}

function Get-WorkbookDefinedName {
  param(
    [object]$Workbook,
    [object[]]$Names
  )
  foreach ($candidate in @($Names)) {
    $name = ([string]$candidate).Trim()
    if (-not $name) { continue }
    $definedName = $null
    try {
      $definedName = $Workbook.Names.Item($name)
    } catch {}
    if ($null -ne $definedName) { return $definedName }
  }
  return $null
}

function Get-ExcelRangeReference {
  param(
    [object]$Sheet,
    [object]$Range
  )
  $sheetName = ([string]$Sheet.Name).Replace("'", "''")
  return "='$sheetName'!$($Range.Address())"
}

function Set-WorkbookDefinedName {
  param(
    [object]$Workbook,
    [string]$Name,
    [string]$Reference
  )
  $definedName = Get-WorkbookDefinedName $Workbook @($Name)
  if ($null -ne $definedName) {
    try {
      $definedName.RefersTo = $Reference
    } finally {
      Release-ComObject $definedName
    }
    return
  }
  $createdName = $null
  try {
    $createdName = $Workbook.Names.Add($Name, $Reference)
  } finally {
    Release-ComObject $createdName
  }
}

function Set-ExcelCellValue {
  param(
    [object]$Sheet,
    [int]$Row,
    [int]$Column,
    [string]$Value
  )
  $cell = $null
  try {
    $cell = $Sheet.Cells.Item($Row, $Column)
    $cell.Value2 = $Value
  } finally {
    Release-ComObject $cell
  }
}

function Get-AgentPaymentPercent {
  param(
    [object]$AgentPaymentRates,
    [string]$PropertyName,
    [double]$Fallback
  )
  $candidate = Get-ObjectProperty $AgentPaymentRates $PropertyName
  if ($null -eq $candidate -or ([string]$candidate).Trim() -eq "") { return $Fallback }
  try {
    $parsed = [double]$candidate
    if ($parsed -ge 0 -and $parsed -le 100) { return $parsed }
  } catch {}
  return $Fallback
}

function Update-AgentPaymentRates {
  param(
    [object]$Workbook,
    [object]$AgentPaymentRates
  )
  $sheet = $null
  $withAuthorRange = $null
  $withoutAuthorRange = $null
  try {
    $sheet = $Workbook.Worksheets.Item("Настройки")
    $markerColumn = 52
    $valueColumn = 53
    $markerHeader = "Ставки агентских выплат веб-АИС"
    $valueHeader = "Значение"
    $currentMarkerHeader = ([string]$sheet.Cells.Item(1, $markerColumn).Value2).Trim()
    $currentValueHeader = ([string]$sheet.Cells.Item(1, $valueColumn).Value2).Trim()
    if (
      ($currentMarkerHeader -and $currentMarkerHeader -ne $markerHeader) -or
      ($currentValueHeader -and $currentValueHeader -ne $valueHeader)
    ) {
      throw "Колонки AZ:BA листа 'Настройки' заняты и не могут использоваться для ставок агентских выплат."
    }

    $withAuthorPercent = Get-AgentPaymentPercent $AgentPaymentRates "withAuthorPercent" 10.0
    $withoutAuthorPercent = Get-AgentPaymentPercent $AgentPaymentRates "withoutAuthorPercent" 25.0
    Set-ExcelCellValue $sheet 1 $markerColumn $markerHeader
    Set-ExcelCellValue $sheet 1 $valueColumn $valueHeader
    Set-ExcelCellValue $sheet 2 $markerColumn "Программа с автором"
    Set-ExcelCellValue $sheet 3 $markerColumn "Программа без автора"

    $withAuthorRange = $sheet.Cells.Item(2, $valueColumn)
    $withoutAuthorRange = $sheet.Cells.Item(3, $valueColumn)
    $withAuthorRange.Value2 = $withAuthorPercent / 100
    $withoutAuthorRange.Value2 = $withoutAuthorPercent / 100
    try { $withAuthorRange.NumberFormat = "0.####%" } catch {}
    try { $withoutAuthorRange.NumberFormat = "0.####%" } catch {}
    Set-WorkbookDefinedName `
      $Workbook `
      $AgentRateWithAuthorDefinedName `
      (Get-ExcelRangeReference $sheet $withAuthorRange)
    Set-WorkbookDefinedName `
      $Workbook `
      $AgentRateWithoutAuthorDefinedName `
      (Get-ExcelRangeReference $sheet $withoutAuthorRange)

    return [pscustomobject]@{
      WithAuthorPercent = $withAuthorPercent
      WithoutAuthorPercent = $withoutAuthorPercent
      Count = 2
    }
  } catch {
    throw "Ошибка обновления ставок агентских выплат: $($_.Exception.Message)`n$($_.ScriptStackTrace)"
  } finally {
    Release-ComObject $withoutAuthorRange
    Release-ComObject $withAuthorRange
    Release-ComObject $sheet
  }
}

function Update-PaymentSettings {
  param(
    [object]$Workbook,
    [object]$Payload
  )
  if (-not [bool](Get-ObjectProperty $Payload "paymentConstantsProvided")) {
    return [pscustomobject]@{ Count = 0; Skipped = $true }
  }
  $sheet = $null
  try {
    $sheet = $Workbook.Worksheets.Item("Настройки")
    $constants = @($Payload.paymentConstants)
    $builtInConstants = @($constants | Where-Object { -not [bool](Get-ObjectProperty $_ "custom") })
    foreach ($constant in $builtInConstants) {
      $marker = ([string](Get-ObjectProperty $constant "marker")).Trim()
      if (-not $marker) { continue }
      $legacyNames = @((Get-ObjectProperty $constant "legacyNames"))
      $compatibleNames = @($marker) + $legacyNames
      $definedName = Get-WorkbookDefinedName $Workbook $compatibleNames
      $targetRange = $null
      try {
        if ($null -ne $definedName) {
          try { $targetRange = $definedName.RefersToRange } catch {}
        }
        if ($null -eq $targetRange) {
          $legacyRow = [int](Get-ObjectProperty $constant "legacyRow")
          if ($legacyRow -lt 2) { continue }
          $targetRange = $sheet.Cells.Item($legacyRow, 1)
        }
        $value = [double](Get-ObjectProperty $constant "value")
        if ([bool](Get-ObjectProperty $constant "percent")) {
          $value = $value / 100
          try { $targetRange.NumberFormat = "0.##%" } catch {}
        }
        $targetRange.Value2 = $value
        $reference = Get-ExcelRangeReference $sheet $targetRange
        Set-WorkbookDefinedName $Workbook $marker $reference
        foreach ($legacyName in $legacyNames) {
          $existingLegacyName = Get-WorkbookDefinedName $Workbook @($legacyName)
          if ($null -eq $existingLegacyName) { continue }
          try {
            $existingLegacyName.RefersTo = $reference
          } finally {
            Release-ComObject $existingLegacyName
          }
        }
      } finally {
        Release-ComObject $targetRange
        Release-ComObject $definedName
      }
    }

    $markerColumn = 50
    $valueColumn = 51
    $markerHeader = "Константы оплаты веб-АИС"
    $valueHeader = "Значение"
    $currentMarkerHeader = ([string]$sheet.Cells.Item(1, $markerColumn).Value2).Trim()
    $currentValueHeader = ([string]$sheet.Cells.Item(1, $valueColumn).Value2).Trim()
    if (
      ($currentMarkerHeader -and $currentMarkerHeader -ne $markerHeader) -or
      ($currentValueHeader -and $currentValueHeader -ne $valueHeader)
    ) {
      throw "Колонки AX:AY листа 'Настройки' заняты и не могут использоваться для констант оплаты."
    }
    $lastMarkerRow = [int]$sheet.Cells.Item($sheet.Rows.Count, $markerColumn).End(-4162).Row
    $lastValueRow = [int]$sheet.Cells.Item($sheet.Rows.Count, $valueColumn).End(-4162).Row
    $lastManagedRow = [Math]::Max(1, [Math]::Max($lastMarkerRow, $lastValueRow))
    for ($row = 2; $row -le $lastManagedRow; $row += 1) {
      $oldMarker = ([string]$sheet.Cells.Item($row, $markerColumn).Value2).Trim()
      if (-not $oldMarker) { continue }
      $oldName = Get-WorkbookDefinedName $Workbook @($oldMarker)
      if ($null -eq $oldName) { continue }
      $oldRange = $null
      try {
        try { $oldRange = $oldName.RefersToRange } catch {}
        if (
          $null -ne $oldRange -and
          ([string]$oldRange.Worksheet.Name) -eq "Настройки" -and
          [int]$oldRange.Column -eq $valueColumn
        ) {
          $oldName.Delete() | Out-Null
        }
      } finally {
        Release-ComObject $oldRange
        Release-ComObject $oldName
      }
    }
    $clearRange = $null
    try {
      $clearRange = $sheet.Range(
        $sheet.Cells.Item(1, $markerColumn),
        $sheet.Cells.Item([Math]::Max(2, $lastManagedRow), $valueColumn)
      )
      $clearRange.ClearContents() | Out-Null
    } finally {
      Release-ComObject $clearRange
    }
    Set-ExcelCellValue $sheet 1 $markerColumn $markerHeader
    Set-ExcelCellValue $sheet 1 $valueColumn $valueHeader

    $customConstants = @($constants | Where-Object { [bool](Get-ObjectProperty $_ "custom") })
    for ($index = 0; $index -lt $customConstants.Count; $index += 1) {
      $constant = $customConstants[$index]
      $marker = ([string](Get-ObjectProperty $constant "marker")).Trim()
      if (-not $marker) { continue }
      $row = $index + 2
      Set-ExcelCellValue $sheet $row $markerColumn $marker
      $valueRange = $null
      try {
        $valueRange = $sheet.Cells.Item($row, $valueColumn)
        $valueRange.Value2 = [double](Get-ObjectProperty $constant "value")
        $reference = Get-ExcelRangeReference $sheet $valueRange
        Set-WorkbookDefinedName $Workbook $marker $reference
      } finally {
        Release-ComObject $valueRange
      }
    }
    return [pscustomobject]@{
      Count = $constants.Count
      Skipped = $false
    }
  } catch {
    throw "Ошибка обновления ставок и констант оплаты: $($_.Exception.Message)`n$($_.ScriptStackTrace)"
  } finally {
    Release-ComObject $sheet
  }
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

function Build-RecordEventSettings {
  param(
    [object]$Record,
    [object]$ExistingValue,
    [object[]]$EventTemplates,
    [string]$RootSection
  )
  $templateLabels = @{}
  foreach ($template in @($EventTemplates)) {
    $key = ([string](Get-ObjectProperty $template "key")).Trim()
    if ($key) { $templateLabels[$key] = [string](Get-ObjectProperty $template "label") }
  }

  $preservedLines = [Collections.Generic.List[string]]::new()
  $insideEventSection = $false
  $eventSectionPattern = '^\[' + [regex]::Escape($RootSection) + '\\События(?:\\\d+)?\]$'
  foreach ($line in (([string]$ExistingValue) -split "\r?\n")) {
    $trimmed = $line.Trim()
    if ($trimmed.StartsWith("[")) {
      $insideEventSection = $trimmed -match $eventSectionPattern
    }
    if (-not $insideEventSection) { $preservedLines.Add($line) }
  }
  $rootIndex = -1
  for ($index = 0; $index -lt $preservedLines.Count; $index += 1) {
    if ($preservedLines[$index].Trim() -eq "[$RootSection]") {
      $rootIndex = $index
      break
    }
  }
  if ($rootIndex -lt 0) {
    $preservedLines.Insert(0, "События=")
    $preservedLines.Insert(0, "[$RootSection]")
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
    if ($eventBlocks[$index].Selected) { $selectedIndexes.Add([string]$index) }
  }
  $eventLines = [Collections.Generic.List[string]]::new()
  $eventLines.Add("[$RootSection\События]")
  $eventLines.Add("Тип=LB")
  $eventLines.Add("Кол=$($eventBlocks.Count)")
  $eventLines.Add("Выд=$($selectedIndexes -join ',')")
  for ($index = 0; $index -lt $eventBlocks.Count; $index += 1) {
    $number = $index + 1
    $eventLines.Add("[$RootSection\События\$number]")
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
      if ($FieldName -in @("__eventSettings", "__contractEventSettings")) {
        $rootSection = if ($FieldName -eq "__contractEventSettings") {
          "КарточкаКонтрагента"
        } else {
          "КарточкаСлушателя"
        }
        $nextValues[$offset, 0] = if ($null -eq $record) {
          $null
        } else {
          $recordSettings = if ($FieldName -eq "__contractEventSettings") {
            [string](Get-ObjectProperty $record "additionalSettings")
          } else {
            ""
          }
          $preservedSettings = if ($recordSettings) { $recordSettings } else { $currentValue }
          Build-RecordEventSettings $record $preservedSettings $EventTemplates $rootSection
        }
        continue
      }
      # АгентСумма is calculated by the workbook. Never replace its formula with
      # the cached numeric value imported into the web database. Newly inserted
      # student rows receive this formula from Insert-StudentTemplateRows.
      if ($FieldName -eq "agentAmount") {
        $nextValues[$offset, 0] = $currentValue
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

function ConvertTo-ExcelColumnName {
  param([int]$Column)
  if ($Column -le 0) { throw "Некорректный номер столбца Excel: $Column." }
  $letters = ""
  $remaining = $Column
  while ($remaining -gt 0) {
    $letterCode = 65 + [int](($remaining - 1) % 26)
    $letters = ([char]$letterCode).ToString() + $letters
    $remaining = [int][Math]::Floor(($remaining - 1) / 26)
  }
  return $letters
}

function Update-StudentAgentAmountFormulas {
  param(
    [object]$Sheet,
    [object[]]$Columns,
    [int]$StartRow,
    [int]$EndRow,
    [hashtable]$RecordByRow,
    [object]$AgentPaymentRates
  )
  if ($EndRow -lt $StartRow) {
    return [pscustomobject]@{
      UpdatedCount = 0
      SkippedUnknownFormulaCount = 0
      PreservedConstantCount = 0
    }
  }

  $requiredFields = @(
    "name",
    "agent",
    "agentAmount",
    "agentPayment1Amount",
    "agentPayment1Date",
    "agentPayment2Amount",
    "agentPayment2Date",
    "program",
    "paidAmount"
  )
  $columnByField = @{}
  foreach ($fieldName in $requiredFields) {
    $match = $Columns | Where-Object { $_.FieldName -eq $fieldName } | Select-Object -First 1
    if ($null -eq $match) {
      return [pscustomobject]@{
        UpdatedCount = 0
        SkippedUnknownFormulaCount = 0
        PreservedConstantCount = 0
      }
    }
    $columnByField[$fieldName] = [int]$match.Column
  }

  $withAuthorRate = $AgentRateWithAuthorDefinedName
  $withoutAuthorRate = $AgentRateWithoutAuthorDefinedName

  $nameColumn = ConvertTo-ExcelColumnName $columnByField.name
  $agentColumn = ConvertTo-ExcelColumnName $columnByField.agent
  $agentAmountColumn = $columnByField.agentAmount
  $agentPayment1Column = ConvertTo-ExcelColumnName $columnByField.agentPayment1Amount
  $agentPayment1DateColumn = ConvertTo-ExcelColumnName $columnByField.agentPayment1Date
  $agentPayment2Column = ConvertTo-ExcelColumnName $columnByField.agentPayment2Amount
  $agentPayment2DateColumn = ConvertTo-ExcelColumnName $columnByField.agentPayment2Date
  $programColumn = ConvertTo-ExcelColumnName $columnByField.program
  $paidAmountColumn = ConvertTo-ExcelColumnName $columnByField.paidAmount

  $range = $null
  try {
    $range = $Sheet.Range(
      $Sheet.Cells.Item($StartRow, $agentAmountColumn),
      $Sheet.Cells.Item($EndRow, $agentAmountColumn)
    )
    $currentFormulas = $range.Formula
    $rowCount = $EndRow - $StartRow + 1
    $nextFormulas = New-Object "object[,]" $rowCount, 1
    $updatedCount = 0
    $skippedUnknownFormulaCount = 0
    $preservedConstantCount = 0
    for ($offset = 0; $offset -lt $rowCount; $offset += 1) {
      $row = $StartRow + $offset
      $currentFormula = Get-MatrixValue $currentFormulas ($offset + 1) 1
      $hasFormula = $currentFormula -is [string] -and $currentFormula.StartsWith("=")
      $isEmpty = $null -eq $currentFormula -or ([string]$currentFormula).Trim() -eq ""
      if ($hasFormula) {
        $formulaText = ([string]$currentFormula).Replace('$', '')
        $payment1Pattern = "-\s*$([regex]::Escape($agentPayment1Column))$row(?!\d)"
        $payment2Pattern = "-\s*$([regex]::Escape($agentPayment2Column))$row(?!\d)"
        $payment1ReferencePattern = "(?i)(?<![A-Z])$([regex]::Escape($agentPayment1Column))$row(?!\d)"
        $payment1DateReferencePattern = "(?i)(?<![A-Z])$([regex]::Escape($agentPayment1DateColumn))$row(?!\d)"
        $payment2ReferencePattern = "(?i)(?<![A-Z])$([regex]::Escape($agentPayment2Column))$row(?!\d)"
        $payment2DateReferencePattern = "(?i)(?<![A-Z])$([regex]::Escape($agentPayment2DateColumn))$row(?!\d)"
        $isLegacyManagedFormula = $formulaText -match $payment1Pattern -and $formulaText -match $payment2Pattern
        $isDatedManagedFormula = (
          $formulaText -match $payment1ReferencePattern -and
          $formulaText -match $payment1DateReferencePattern -and
          $formulaText -match $payment2ReferencePattern -and
          $formulaText -match $payment2DateReferencePattern
        )
        $isManagedFormula = (
          $formulaText -match "(?i)(ROUNDUP|ОКРУГЛВВЕРХ)\s*\(" -and
          ($isLegacyManagedFormula -or $isDatedManagedFormula)
        )
        if (-not $isManagedFormula) {
          $nextFormulas[$offset, 0] = $currentFormula
          $skippedUnknownFormulaCount += 1
          continue
        }
      } elseif (-not $isEmpty) {
        $nextFormulas[$offset, 0] = $currentFormula
        $preservedConstantCount += 1
        continue
      } elseif (-not $RecordByRow.ContainsKey([int]$row)) {
        $nextFormulas[$offset, 0] = $currentFormula
        continue
      }
      $nextFormulas[$offset, 0] = (
        '=IF({0}{9}<>"",IF({1}{9}<>"",ROUNDUP(({2}{9}*IF(VLOOKUP({3}{9},РеестрПрограмм,COLUMN(''Реестр программ''!S:S),FALSE)<>"",{4},{5}))/50,0)*50-IF({6}{9}<>"",{7}{9},0)-IF({8}{9}<>"",{10}{9},0),""),"")' -f `
          $nameColumn,
          $agentColumn,
          $paidAmountColumn,
          $programColumn,
          $withAuthorRate,
          $withoutAuthorRate,
          $agentPayment1DateColumn,
          $agentPayment1Column,
          $agentPayment2DateColumn,
          $row,
          $agentPayment2Column
      )
      $updatedCount += 1
    }
    $range.Formula = $nextFormulas
    return [pscustomobject]@{
      UpdatedCount = $updatedCount
      SkippedUnknownFormulaCount = $skippedUnknownFormulaCount
      PreservedConstantCount = $preservedConstantCount
    }
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
    $effectiveSourceRow = if ($SourceRow -ge $InsertRow) { $SourceRow + $Count } else { $SourceRow }
    $sourceRange = $Sheet.Range(
      $Sheet.Cells.Item($effectiveSourceRow, 1),
      $Sheet.Cells.Item($effectiveSourceRow, $LastColumn)
    )
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

function Test-StudentSectionHeading {
  param(
    [object]$Sheet,
    [int]$Row,
    [int]$NameColumn
  )
  $cell = $null
  $font = $null
  try {
    $cell = $Sheet.Cells.Item($Row, $NameColumn)
    $font = $cell.Font
    return [bool]$font.Bold -and [double]$font.Size -ge 14
  } finally {
    Release-ComObject $font
    Release-ComObject $cell
  }
}

function Get-StudentSectionLayout {
  param(
    [object]$Sheet,
    [int]$StartRow,
    [int]$LastRow,
    [int]$UidColumn,
    [int]$NameColumn,
    [int]$FirstSectionRowHint = 0
  )
  $uidRange = $null
  $nameRange = $null
  try {
    $uidRange = $Sheet.Range(
      $Sheet.Cells.Item($StartRow, $UidColumn),
      $Sheet.Cells.Item($LastRow, $UidColumn)
    )
    $nameRange = $Sheet.Range(
      $Sheet.Cells.Item($StartRow, $NameColumn),
      $Sheet.Cells.Item($LastRow, $NameColumn)
    )
    $uidValues = $uidRange.Value2
    $nameValues = $nameRange.Value2
    $candidates = [Collections.Generic.List[object]]::new()
    $firstStudentRow = 0
    for ($row = $StartRow; $row -le $LastRow; $row += 1) {
      $offset = $row - $StartRow + 1
      $uid = Convert-Uid (Get-MatrixValue $uidValues $offset 1)
      $name = ([string](Get-MatrixValue $nameValues $offset 1)).Trim()
      if ($uid -and $name -and $firstStudentRow -le 0) {
        $firstStudentRow = $row
      }
      if (-not $uid -and $name) {
        $candidates.Add([pscustomobject]@{
          Row = [int]$row
          Title = $name
        }) | Out-Null
      }
    }
    if ($firstStudentRow -le 0) {
      throw "На листе не найдены строки слушателей с uid и ФИО."
    }

    $firstSection = $null
    if ($FirstSectionRowHint -gt 0) {
      $firstSection = $candidates | Where-Object { $_.Row -eq $FirstSectionRowHint } | Select-Object -First 1
    } else {
      foreach ($candidate in $candidates) {
        if ($candidate.Row -ge $firstStudentRow) { break }
        if (Test-StudentSectionHeading $Sheet $candidate.Row $NameColumn) {
          $firstSection = $candidate
        }
      }
    }
    if ($null -eq $firstSection) {
      throw "Не найден первый крупный жирный заголовок раздела слушателей."
    }

    $sections = [Collections.Generic.List[object]]::new()
    foreach ($candidate in $candidates) {
      if ($candidate.Row -lt $firstSection.Row) { continue }
      if (Test-StudentSectionHeading $Sheet $candidate.Row $NameColumn) {
        $sections.Add($candidate) | Out-Null
      }
    }
    if ($sections.Count -le 0) {
      throw "Не найдены крупные жирные заголовки разделов слушателей."
    }

    $lastSectionRow = [int]$sections[$sections.Count - 1].Row
    $lastMovableRow = $LastRow
    foreach ($candidate in $candidates) {
      if ($candidate.Row -le $lastSectionRow) { continue }
      $lastMovableRow = $candidate.Row - 1
      break
    }
    return [pscustomobject]@{
      Sections = @($sections)
      FirstSectionRow = [int]$firstSection.Row
      LastMovableRow = [int]$lastMovableRow
    }
  } finally {
    Release-ComObject $uidRange
    Release-ComObject $nameRange
  }
}

function Remove-StudentRows {
  param(
    [object]$Sheet,
    [int]$StartRow,
    [int]$Count
  )
  if ($Count -le 0) { return }
  $rows = $null
  try {
    $endRow = $StartRow + $Count - 1
    $rows = $Sheet.Rows.Item("${StartRow}:${endRow}")
    $rows.Delete(-4162) | Out-Null
  } finally {
    Release-ComObject $rows
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
    $layout = Get-StudentSectionLayout $sheet $startRow $lastRow $uidColumn $nameColumn
    $sections = @($layout.Sections)
    $defaultSectionTitle = ([string](Get-ObjectProperty $Payload "defaultStudentAdditionalStatus")).Trim()
    if (-not $defaultSectionTitle) {
      $defaultSectionTitle = "На зачисление (пока без документов)"
    }

    $sectionByKey = @{}
    $recordsBySection = @{}
    foreach ($section in $sections) {
      $key = ([string]$section.Title).Trim().ToLowerInvariant()
      if (-not $sectionByKey.ContainsKey($key)) {
        $sectionByKey[$key] = $section
        $recordsBySection[$key] = [Collections.Generic.List[object]]::new()
      }
    }
    $defaultSectionKey = $defaultSectionTitle.ToLowerInvariant()
    if (-not $sectionByKey.ContainsKey($defaultSectionKey)) {
      throw "На листе 'База' не найден раздел '$defaultSectionTitle'."
    }

    $fixedUidCounts = @{}
    $existingSectionByUid = @{}
    $uidRange = $null
    try {
      $uidRange = $sheet.Range(
        $sheet.Cells.Item($startRow, $uidColumn),
        $sheet.Cells.Item($lastRow, $uidColumn)
      )
      $uidValues = $uidRange.Value2
      for ($row = $startRow; $row -le $lastRow; $row += 1) {
        $offset = $row - $startRow + 1
        $uid = Convert-Uid (Get-MatrixValue $uidValues $offset 1)
        if (-not $uid) { continue }
        if ($row -lt $layout.FirstSectionRow -or $row -gt $layout.LastMovableRow) {
          if (-not $fixedUidCounts.ContainsKey($uid)) { $fixedUidCounts[$uid] = 0 }
          $fixedUidCounts[$uid] += 1
          continue
        }
        for ($sectionIndex = 0; $sectionIndex -lt $sections.Count; $sectionIndex += 1) {
          $sectionStart = [int]$sections[$sectionIndex].Row + 1
          $sectionEnd = if ($sectionIndex + 1 -lt $sections.Count) {
            [int]$sections[$sectionIndex + 1].Row - 1
          } else {
            [int]$layout.LastMovableRow
          }
          if ($row -lt $sectionStart -or $row -gt $sectionEnd) { continue }
          if (-not $existingSectionByUid.ContainsKey($uid)) {
            $existingSectionByUid[$uid] = [Collections.Generic.Queue[string]]::new()
          }
          $existingSectionByUid[$uid].Enqueue([string]$sections[$sectionIndex].Title)
          break
        }
      }
    } finally {
      Release-ComObject $uidRange
    }

    $fixedRecords = [Collections.Generic.List[object]]::new()
    foreach ($student in @($Payload.students)) {
      $uid = Convert-Uid (Get-ObjectProperty $student "uid")
      if (-not $uid) { continue }
      if ($fixedUidCounts.ContainsKey($uid) -and $fixedUidCounts[$uid] -gt 0) {
        $fixedUidCounts[$uid] -= 1
        $fixedRecords.Add($student) | Out-Null
        continue
      }
      $additionalStatus = ([string](Get-ObjectProperty $student "additionalStatus")).Trim()
      if (
        -not $additionalStatus -and
        $existingSectionByUid.ContainsKey($uid) -and
        $existingSectionByUid[$uid].Count -gt 0
      ) {
        $additionalStatus = $existingSectionByUid[$uid].Dequeue()
      }
      $sectionKey = if ($additionalStatus) {
        $additionalStatus.ToLowerInvariant()
      } else {
        $defaultSectionKey
      }
      if (-not $recordsBySection.ContainsKey($sectionKey)) {
        $sectionKey = $defaultSectionKey
      }
      $recordsBySection[$sectionKey].Add($student) | Out-Null
    }

    $totalRowDelta = 0
    for ($sectionIndex = $sections.Count - 1; $sectionIndex -ge 0; $sectionIndex -= 1) {
      $section = $sections[$sectionIndex]
      $sectionKey = ([string]$section.Title).Trim().ToLowerInvariant()
      $sectionStart = [int]$section.Row + 1
      $sectionEnd = if ($sectionIndex + 1 -lt $sections.Count) {
        [int]$sections[$sectionIndex + 1].Row - 1
      } else {
        [int]$layout.LastMovableRow
      }
      $currentCount = 0
      if ($sectionEnd -ge $sectionStart) {
        try {
          $uidRange = $sheet.Range(
            $sheet.Cells.Item($sectionStart, $uidColumn),
            $sheet.Cells.Item($sectionEnd, $uidColumn)
          )
          $uidValues = $uidRange.Value2
          for ($row = $sectionStart; $row -le $sectionEnd; $row += 1) {
            $offset = $row - $sectionStart + 1
            $uid = Convert-Uid (Get-MatrixValue $uidValues $offset 1)
            if (-not $uid) { continue }
            if ($row -ne $sectionStart + $currentCount) {
              throw "Строки слушателей в разделе '$($section.Title)' идут не подряд."
            }
            $currentCount += 1
          }
        } finally {
          Release-ComObject $uidRange
          $uidRange = $null
        }
      }
      $targetCount = $recordsBySection[$sectionKey].Count
      $delta = $targetCount - $currentCount
      if ($delta -gt 0) {
        $insertRow = $sectionStart + $currentCount
        $templateRow = if ($currentCount -gt 0) {
          $insertRow - 1
        } else {
          $sectionStart
        }
        Write-SyncProgress 9 "Добавление $delta строк в раздел '$($section.Title)'..."
        Insert-StudentTemplateRows $sheet $templateRow $insertRow $header.LastColumn $delta
        $totalRowDelta += $delta
      } elseif ($delta -lt 0) {
        $rowsToRemove = -$delta
        $removeStartRow = $sectionStart + $targetCount
        Write-SyncProgress 9 "Удаление $rowsToRemove строк из раздела '$($section.Title)'..."
        Remove-StudentRows $sheet $removeStartRow $rowsToRemove
        $totalRowDelta -= $rowsToRemove
      }
    }
    $lastRow += $totalRowDelta

    $finalLayout = Get-StudentSectionLayout `
      $sheet $startRow $lastRow $uidColumn $nameColumn $layout.FirstSectionRow
    $finalSections = @($finalLayout.Sections)
    $recordByRow = @{}
    foreach ($section in $finalSections) {
      $sectionKey = ([string]$section.Title).Trim().ToLowerInvariant()
      if (-not $recordsBySection.ContainsKey($sectionKey)) { continue }
      $sectionRecords = $recordsBySection[$sectionKey]
      for ($index = 0; $index -lt $sectionRecords.Count; $index += 1) {
        $recordByRow[[int]$section.Row + 1 + $index] = $sectionRecords[$index]
      }
    }

    $fixedRowsByUid = @{}
    try {
      $uidRange = $sheet.Range(
        $sheet.Cells.Item($startRow, $uidColumn),
        $sheet.Cells.Item($lastRow, $uidColumn)
      )
      $uidValues = $uidRange.Value2
      for ($row = $startRow; $row -le $lastRow; $row += 1) {
        if ($row -ge $finalLayout.FirstSectionRow -and $row -le $finalLayout.LastMovableRow) {
          continue
        }
        $offset = $row - $startRow + 1
        $uid = Convert-Uid (Get-MatrixValue $uidValues $offset 1)
        if (-not $uid) { continue }
        if (-not $fixedRowsByUid.ContainsKey($uid)) {
          $fixedRowsByUid[$uid] = [Collections.Generic.Queue[int]]::new()
        }
        $fixedRowsByUid[$uid].Enqueue([int]$row)
      }
    } finally {
      Release-ComObject $uidRange
      $uidRange = $null
    }
    foreach ($student in $fixedRecords) {
      $uid = Convert-Uid (Get-ObjectProperty $student "uid")
      if (
        -not $fixedRowsByUid.ContainsKey($uid) -or
        $fixedRowsByUid[$uid].Count -le 0
      ) {
        throw "Не найдена сохраненная служебная строка слушателя с uid '$uid'."
      }
      $recordByRow[$fixedRowsByUid[$uid].Dequeue()] = $student
    }

    $preserveRows = [Collections.Generic.HashSet[int]]::new()
    try {
      $uidRange = $sheet.Range(
        $sheet.Cells.Item($startRow, $uidColumn),
        $sheet.Cells.Item($lastRow, $uidColumn)
      )
      $uidValues = $uidRange.Value2
      for ($row = $startRow; $row -le $lastRow; $row += 1) {
        if ($recordByRow.ContainsKey($row)) { continue }
        $offset = $row - $startRow + 1
        $uid = Convert-Uid (Get-MatrixValue $uidValues $offset 1)
        if (-not $uid) {
          $preserveRows.Add([int]$row) | Out-Null
        }
      }
    } finally {
      Release-ComObject $uidRange
    }

    $agentFormulaResult = Update-StudentAgentAmountFormulas `
      $sheet $columns $startRow $lastRow $recordByRow (Get-ObjectProperty $Payload "agentPaymentRates")
    if ($agentFormulaResult.SkippedUnknownFormulaCount -gt 0) {
      Write-SyncProgress 8 (
        "Сохранено пользовательских формул в колонке АгентСумма без изменений: " +
        $agentFormulaResult.SkippedUnknownFormulaCount
      )
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
      AgentFormulaCount = $agentFormulaResult.UpdatedCount
      AgentFormulaSkippedUnknownCount = $agentFormulaResult.SkippedUnknownFormulaCount
      AgentFormulaPreservedConstantCount = $agentFormulaResult.PreservedConstantCount
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

function Find-ContractSectionRows {
  param(
    [object]$Sheet,
    [object]$Sections
  )
  $usedRange = $null
  $nameRange = $null
  try {
    $usedRange = $Sheet.UsedRange
    $lastRow = [int]$usedRange.Row + [int]$usedRange.Rows.Count - 1
    $nameRange = $Sheet.Range($Sheet.Cells.Item(1, 1), $Sheet.Cells.Item($lastRow, 1))
    $values = $nameRange.Value2
    $names = @{
      active = (Normalize-Header (Get-ObjectProperty $Sections "active")).ToUpperInvariant()
      partners = (Normalize-Header (Get-ObjectProperty $Sections "partners")).ToUpperInvariant()
      expired = (Normalize-Header (Get-ObjectProperty $Sections "expired")).ToUpperInvariant()
    }
    $rows = @{}
    for ($row = 1; $row -le $lastRow; $row += 1) {
      $value = (Normalize-Header (Get-MatrixValue $values $row 1)).ToUpperInvariant()
      foreach ($key in @("active", "partners", "expired")) {
        if ($value -and $value -eq $names[$key]) {
          if ($rows.ContainsKey($key)) {
            throw "Раздел '$($names[$key])' встречается несколько раз: строки $($rows[$key]) и $row."
          }
          $rows[$key] = $row
        }
      }
    }
    foreach ($key in @("active", "partners", "expired")) {
      if (-not $rows.ContainsKey($key)) {
        throw "На листе не найден раздел '$($names[$key])'."
      }
    }
    if ([int]$rows.active -ge [int]$rows.partners -or [int]$rows.partners -ge [int]$rows.expired) {
      throw "Разделы реестра договоров расположены в неверном порядке."
    }
    return $rows
  } finally {
    Release-ComObject $nameRange
    Release-ComObject $usedRange
  }
}

function Get-ContractSectionGap {
  param(
    [object]$Sheet,
    [int]$SectionRow,
    [int]$NextSectionRow
  )
  $range = $null
  try {
    if ($NextSectionRow -le $SectionRow + 1) { return 0 }
    $range = $Sheet.Range(
      $Sheet.Cells.Item($SectionRow + 1, 1),
      $Sheet.Cells.Item($NextSectionRow - 1, 1)
    )
    $values = $range.Value2
    $lastRecordRow = $SectionRow
    for ($row = $SectionRow + 1; $row -lt $NextSectionRow; $row += 1) {
      $offset = $row - $SectionRow
      if (Normalize-Header (Get-MatrixValue $values $offset 1)) { $lastRecordRow = $row }
    }
    return [Math]::Max(0, [Math]::Min(50, $NextSectionRow - $lastRecordRow - 1))
  } finally {
    Release-ComObject $range
  }
}

function Ensure-ContractFormulaRows {
  param(
    [object]$Sheet,
    [object[]]$Columns,
    [int]$TemplateRow,
    [int]$StartRow,
    [int]$Count
  )
  if ($Count -le 0) { return }
  foreach ($column in $Columns) {
    $templateCell = $null
    try {
      $templateCell = $Sheet.Cells.Item($TemplateRow, [int]$column.Column)
      $formula = [string]$templateCell.FormulaR1C1
      if (-not $formula.StartsWith("=")) { continue }
      for ($offset = 0; $offset -lt $Count; $offset += 1) {
        $targetCell = $null
        try {
          $targetCell = $Sheet.Cells.Item($StartRow + $offset, [int]$column.Column)
          $targetFormula = [string]$targetCell.FormulaR1C1
          if (-not $targetFormula.StartsWith("=")) {
            $targetCell.FormulaR1C1 = $formula
          }
        } finally {
          Release-ComObject $targetCell
        }
      }
    } finally {
      Release-ComObject $templateCell
    }
  }
}

function Limit-ContractDataRowHeight {
  param(
    [object]$Sheet,
    [int]$StartRow,
    [int]$Count,
    [double]$MaxHeightPoints = 15
  )
  if ($Count -le 0) { return 0 }
  $maximumHeight = 0.0
  for ($offset = 0; $offset -lt $Count; $offset += 1) {
    $row = $null
    try {
      $row = $Sheet.Rows.Item($StartRow + $offset)
      $currentHeight = [double]$row.RowHeight
      if ($currentHeight -gt $MaxHeightPoints) {
        $row.RowHeight = $MaxHeightPoints
        $currentHeight = $MaxHeightPoints
      }
      $maximumHeight = [Math]::Max($maximumHeight, $currentHeight)
    } finally {
      Release-ComObject $row
    }
  }
  return $maximumHeight
}

function Update-ContractSheet {
  param(
    [object]$Workbook,
    [object]$Payload,
    [Collections.Generic.HashSet[string]]$DateFields,
    [Collections.Generic.HashSet[string]]$NumberFields
  )
  $sheet = $null
  try {
    $sheet = $Workbook.Worksheets.Item("Реестр договоров")
    $header = Find-HeaderRow $sheet @("ФИО", "Договор", "Вид договора")
    $columns = @(Get-MappedColumns $sheet $header.Row $header.LastColumn $Payload.contractColumnMap)
    $sections = $Payload.contractSections
    $sectionRows = Find-ContractSectionRows $sheet $sections
    $contracts = @($Payload.contracts)
    $records = @{
      active = @($contracts | Where-Object { ([string](Get-ObjectProperty $_ "section")).Trim() -eq ([string](Get-ObjectProperty $sections "active")).Trim() })
      partners = @($contracts | Where-Object { ([string](Get-ObjectProperty $_ "section")).Trim() -eq ([string](Get-ObjectProperty $sections "partners")).Trim() })
      expired = @($contracts | Where-Object { ([string](Get-ObjectProperty $_ "section")).Trim() -eq ([string](Get-ObjectProperty $sections "expired")).Trim() })
    }

    $activeGap = Get-ContractSectionGap $sheet ([int]$sectionRows.active) ([int]$sectionRows.partners)
    $desiredPartnerRow = [int]$sectionRows.active + 1 + $records.active.Count + $activeGap
    $activeDelta = $desiredPartnerRow - [int]$sectionRows.partners
    if ($activeDelta -gt 0) {
      Insert-StudentTemplateRows $sheet ([int]$sectionRows.active + 1) ([int]$sectionRows.partners) $header.LastColumn $activeDelta
    } elseif ($activeDelta -lt 0) {
      Remove-StudentRows $sheet $desiredPartnerRow (-$activeDelta)
    }

    $sectionRows = Find-ContractSectionRows $sheet $sections
    $partnerGap = Get-ContractSectionGap $sheet ([int]$sectionRows.partners) ([int]$sectionRows.expired)
    $desiredExpiredRow = [int]$sectionRows.partners + 1 + $records.partners.Count + $partnerGap
    $partnerDelta = $desiredExpiredRow - [int]$sectionRows.expired
    if ($partnerDelta -gt 0) {
      Insert-StudentTemplateRows $sheet ([int]$sectionRows.partners + 1) ([int]$sectionRows.expired) $header.LastColumn $partnerDelta
    } elseif ($partnerDelta -lt 0) {
      Remove-StudentRows $sheet $desiredExpiredRow (-$partnerDelta)
    }

    $sectionRows = Find-ContractSectionRows $sheet $sections
    $refreshedHeader = Find-HeaderRow $sheet @("ФИО", "Договор", "Вид договора")
    $activeStart = [int]$sectionRows.active + 1
    $partnerStart = [int]$sectionRows.partners + 1
    $expiredStart = [int]$sectionRows.expired + 1
    $lastRow = [Math]::Max([int]$refreshedHeader.LastRow, $expiredStart + $records.expired.Count - 1)

    $recordByRow = @{}
    foreach ($key in @("active", "partners", "expired")) {
      $start = if ($key -eq "active") { $activeStart } elseif ($key -eq "partners") { $partnerStart } else { $expiredStart }
      for ($index = 0; $index -lt $records[$key].Count; $index += 1) {
        $recordByRow[$start + $index] = $records[$key][$index]
      }
    }

    Ensure-ContractFormulaRows $sheet $columns $activeStart $activeStart $records.active.Count
    Ensure-ContractFormulaRows $sheet $columns $partnerStart $partnerStart $records.partners.Count
    Ensure-ContractFormulaRows $sheet $columns $expiredStart $expiredStart $records.expired.Count

    $processedColumns = 0
    foreach ($column in $columns) {
      Update-MappedColumn $sheet $activeStart ([int]$sectionRows.partners - 1) $column.Column $column.FieldName $recordByRow $DateFields $NumberFields @($Payload.contractEventTemplates) $null
      Update-MappedColumn $sheet $partnerStart ([int]$sectionRows.expired - 1) $column.Column $column.FieldName $recordByRow $DateFields $NumberFields @($Payload.contractEventTemplates) $null
      Update-MappedColumn $sheet $expiredStart $lastRow $column.Column $column.FieldName $recordByRow $DateFields $NumberFields @($Payload.contractEventTemplates) $null
      $processedColumns += 1
      Write-SyncProgress 95 "Обновление договоров: $processedColumns из $($columns.Count) колонок"
    }
    $maximumRowHeight = @(
      (Limit-ContractDataRowHeight $sheet $activeStart $records.active.Count),
      (Limit-ContractDataRowHeight $sheet $partnerStart $records.partners.Count),
      (Limit-ContractDataRowHeight $sheet $expiredStart $records.expired.Count)
    ) | Measure-Object -Maximum | Select-Object -ExpandProperty Maximum
    return [pscustomobject]@{
      Count = $contracts.Count
      Active = $records.active.Count
      Partners = $records.partners.Count
      Expired = $records.expired.Count
      LastRow = $lastRow
      MaxRowHeightPoints = [double]$maximumRowHeight
    }
  } catch {
    throw "Ошибка обновления листа 'Реестр договоров': $($_.Exception.Message)`n$($_.ScriptStackTrace)"
  } finally {
    Release-ComObject $sheet
  }
}

function Update-GeneralExpenseSheet {
  param(
    [object]$Workbook,
    [object]$Payload,
    [Collections.Generic.HashSet[string]]$DateFields,
    [Collections.Generic.HashSet[string]]$NumberFields
  )
  $sheet = $null
  $counterpartyRange = $null
  try {
    $sheet = $Workbook.Worksheets.Item("Общие затраты")
    $header = Find-HeaderRow $sheet @("Контрагент", "Дата", "Вид работ", "Сумма")
    $columns = @(Get-MappedColumns $sheet $header.Row $header.LastColumn $Payload.generalExpenseColumnMap)
    $counterpartyColumn = Find-MappedColumn $columns "counterparty"
    $individualSectionName = ([string](Get-ObjectProperty $Payload.generalExpenseSections "individuals")).Trim()
    $organizationSectionName = ([string](Get-ObjectProperty $Payload.generalExpenseSections "organizations")).Trim()
    if (-not $individualSectionName -or -not $organizationSectionName) {
      throw "Не переданы названия разделов общих затрат."
    }

    $sectionRows = @{}
    $scanStartRow = $header.Row + 1
    $scanEndRow = [int]$header.LastRow
    $counterpartyRange = $sheet.Range(
      $sheet.Cells.Item($scanStartRow, $counterpartyColumn),
      $sheet.Cells.Item($scanEndRow, $counterpartyColumn)
    )
    $counterpartyValues = $counterpartyRange.Value2
    for ($row = $scanStartRow; $row -le $scanEndRow; $row += 1) {
      $offset = $row - $scanStartRow + 1
      $value = (Normalize-Header (Get-MatrixValue $counterpartyValues $offset 1)).ToUpperInvariant()
      if ($value -eq $individualSectionName.ToUpperInvariant()) { $sectionRows.individuals = $row }
      if ($value -eq $organizationSectionName.ToUpperInvariant()) { $sectionRows.organizations = $row }
    }
    if (-not $sectionRows.ContainsKey("individuals") -or -not $sectionRows.ContainsKey("organizations")) {
      throw "На листе не найдены разделы '$individualSectionName' и '$organizationSectionName'."
    }
    $individualSectionRow = [int]$sectionRows.individuals
    $organizationSectionRow = [int]$sectionRows.organizations
    if ($individualSectionRow -ge $organizationSectionRow) {
      throw "Разделы общих затрат расположены в неверном порядке."
    }

    $expenses = @($Payload.generalExpenses)
    $individualExpenses = @($expenses | Where-Object {
      ([string](Get-ObjectProperty $_ "section")).Trim() -eq $individualSectionName
    })
    $organizationExpenses = @($expenses | Where-Object {
      ([string](Get-ObjectProperty $_ "section")).Trim() -eq $organizationSectionName
    })

    $lastExistingIndividualRow = $individualSectionRow
    for ($row = $individualSectionRow + 1; $row -lt $organizationSectionRow; $row += 1) {
      $offset = $row - $scanStartRow + 1
      if ((Normalize-Header (Get-MatrixValue $counterpartyValues $offset 1))) {
        $lastExistingIndividualRow = $row
      }
    }
    $sectionGap = [Math]::Max(0, [Math]::Min(20, $organizationSectionRow - $lastExistingIndividualRow - 1))
    $individualStartRow = $individualSectionRow + 1
    $desiredOrganizationSectionRow = $individualStartRow + $individualExpenses.Count + $sectionGap
    $sectionRowDelta = $desiredOrganizationSectionRow - $organizationSectionRow
    if ($sectionRowDelta -gt 0) {
      $templateRow = if ($lastExistingIndividualRow -gt $individualSectionRow) {
        $lastExistingIndividualRow
      } else {
        $organizationSectionRow + 1
      }
      Insert-StudentTemplateRows $sheet $templateRow $organizationSectionRow $header.LastColumn $sectionRowDelta
    } elseif ($sectionRowDelta -lt 0) {
      Remove-StudentRows $sheet $desiredOrganizationSectionRow (-$sectionRowDelta)
    }
    $organizationSectionRow = $desiredOrganizationSectionRow
    $organizationStartRow = $organizationSectionRow + 1
    $lastExistingRow = [Math]::Max($organizationSectionRow, [int]$header.LastRow + $sectionRowDelta)
    $desiredLastOrganizationRow = $organizationStartRow + $organizationExpenses.Count - 1
    if ($desiredLastOrganizationRow -gt $lastExistingRow) {
      $templateRow = if ($lastExistingRow -ge $organizationStartRow) {
        $lastExistingRow
      } elseif ($individualExpenses.Count -gt 0) {
        $individualStartRow
      } else {
        $organizationSectionRow
      }
      Insert-StudentTemplateRows $sheet $templateRow ($lastExistingRow + 1) $header.LastColumn ($desiredLastOrganizationRow - $lastExistingRow)
      $lastExistingRow = $desiredLastOrganizationRow
    }

    $individualRecordByRow = @{}
    for ($index = 0; $index -lt $individualExpenses.Count; $index += 1) {
      $individualRecordByRow[$individualStartRow + $index] = $individualExpenses[$index]
    }
    $organizationRecordByRow = @{}
    for ($index = 0; $index -lt $organizationExpenses.Count; $index += 1) {
      $organizationRecordByRow[$organizationStartRow + $index] = $organizationExpenses[$index]
    }

    $processedColumns = 0
    foreach ($column in $columns) {
      Update-MappedColumn $sheet $individualStartRow ($organizationSectionRow - 1) $column.Column $column.FieldName $individualRecordByRow $DateFields $NumberFields @() $null
      Update-MappedColumn $sheet $organizationStartRow $lastExistingRow $column.Column $column.FieldName $organizationRecordByRow $DateFields $NumberFields @() $null
      $processedColumns += 1
      Write-SyncProgress (
        90 + [Math]::Floor(($processedColumns / [Math]::Max(1, $columns.Count)) * 5)
      ) "Обновление общих затрат: $processedColumns из $($columns.Count) колонок"
    }
    return [pscustomobject]@{
      Count = $expenses.Count
      Individuals = $individualExpenses.Count
      Organizations = $organizationExpenses.Count
      LastRow = $lastExistingRow
    }
  } catch {
    throw "Ошибка обновления листа 'Общие затраты': $($_.Exception.Message)`n$($_.ScriptStackTrace)"
  } finally {
    Release-ComObject $counterpartyRange
    Release-ComObject $sheet
  }
}

function Get-ProgramWorkbookIdentity {
  param(
    [object]$Name,
    [object]$LandingCode
  )
  $normalizedName = (Normalize-Header $Name).ToLowerInvariant()
  $normalizedLandingCode = (Normalize-Header $LandingCode).ToLowerInvariant()
  if (-not $normalizedName) { return "" }
  return "$normalizedName$([char]0)$normalizedLandingCode"
}

function Set-ProgramPromoMessageCell {
  param(
    [object]$Sheet,
    [int]$Row,
    [int]$Column,
    [object]$Value
  )
  $cell = $null
  $comment = $null
  try {
    $cell = $Sheet.Cells.Item($Row, $Column)
    try { [void]$cell.ClearComments() } catch {
      try {
        $comment = $cell.Comment
        if ($null -ne $comment) { [void]$comment.Delete() }
      } catch {}
    } finally {
      Release-ComObject $comment
      $comment = $null
    }
    $text = ([string]$Value).Replace("`r`n", "`n").Replace("`r", "`n")
    if ([string]::IsNullOrWhiteSpace($text)) {
      [void]$cell.ClearContents()
      return $false
    }
    $cell.Value2 = "Промосообщение"
    $comment = $cell.AddComment($text)
    try { $comment.Visible = $false } catch {}
    return $true
  } finally {
    Release-ComObject $comment
    Release-ComObject $cell
  }
}

function Update-ProgramPromoMessages {
  param(
    [object]$Workbook,
    [object]$Payload
  )
  $provided = Get-ObjectProperty $Payload "programPromoMessagesProvided"
  $programs = @(Get-ObjectProperty $Payload "programs")
  if (-not $provided) {
    return [pscustomobject]@{ Count = 0; Messages = 0; Skipped = 0; Provided = $false }
  }

  $sheet = $null
  $dataRange = $null
  try {
    $sheet = $Workbook.Worksheets.Item("Реестр программ")
    $header = Find-HeaderRow $sheet @("Наименование программы", "Промосообщение1", "Промосообщение2")
    $columnMap = [pscustomobject]@{
      "Наименование программы" = "name"
      "Код лендинга" = "landingCode"
      "Промосообщение1" = "promoMessage1"
      "Промосообщение2" = "promoMessage2"
    }
    $columns = @(Get-MappedColumns $sheet $header.Row $header.LastColumn $columnMap)
    $nameColumn = Find-MappedColumn $columns "name"
    $landingCodeColumn = Find-MappedColumn $columns "landingCode"
    $promoMessage1Column = Find-MappedColumn $columns "promoMessage1"
    $promoMessage2Column = Find-MappedColumn $columns "promoMessage2"
    $startRow = [int]$header.Row + 1
    $lastRow = [int]$header.LastRow
    if ($lastRow -lt $startRow) {
      return [pscustomobject]@{ Count = 0; Messages = 0; Skipped = $programs.Count; Provided = $true }
    }

    $dataRange = $sheet.Range($sheet.Cells.Item($startRow, 1), $sheet.Cells.Item($lastRow, $header.LastColumn))
    $values = $dataRange.Value2
    $rowByIdentity = @{}
    $identityByRow = @{}
    for ($row = $startRow; $row -le $lastRow; $row += 1) {
      $offset = $row - $startRow + 1
      $name = Get-MatrixValue $values $offset $nameColumn
      $landingCode = Get-MatrixValue $values $offset $landingCodeColumn
      $identity = Get-ProgramWorkbookIdentity $name $landingCode
      if (-not $identity) { continue }
      if ($rowByIdentity.ContainsKey($identity)) {
        throw "На листе 'Реестр программ' найден повторяющийся ключ названия и кода лендинга (строки $($rowByIdentity[$identity]) и $row)."
      }
      $rowByIdentity[$identity] = $row
      $identityByRow[$row] = $identity
    }

    $updatedRows = [Collections.Generic.HashSet[int]]::new()
    $updatedCount = 0
    $messageCount = 0
    $skippedCount = 0
    foreach ($program in $programs) {
      if ($null -eq $program) { continue }
      $promoMessage1Provided = [bool](Get-ObjectProperty $program "promoMessage1Provided")
      $promoMessage2Provided = [bool](Get-ObjectProperty $program "promoMessage2Provided")
      if (-not $promoMessage1Provided -and -not $promoMessage2Provided) { continue }
      $sourceName = Get-ObjectProperty $program "xlsbProgramName"
      if (-not (Normalize-Header $sourceName)) { $sourceName = Get-ObjectProperty $program "name" }
      if (Test-ObjectProperty $program "xlsbProgramLandingCode") {
        $sourceLandingCode = Get-ObjectProperty $program "xlsbProgramLandingCode"
      } else {
        $sourceLandingCode = Get-ObjectProperty $program "landingCode"
      }
      $sourceIdentity = Get-ProgramWorkbookIdentity $sourceName $sourceLandingCode
      $currentIdentity = Get-ProgramWorkbookIdentity `
        (Get-ObjectProperty $program "name") `
        (Get-ObjectProperty $program "landingCode")
      $requestedRow = [int](Get-ObjectProperty $program "xlsbProgramRow")
      $targetRow = 0
      if (
        $requestedRow -ge $startRow `
        -and $requestedRow -le $lastRow `
        -and $identityByRow.ContainsKey($requestedRow) `
        -and $identityByRow[$requestedRow] -eq $sourceIdentity
      ) {
        $targetRow = $requestedRow
      } elseif ($sourceIdentity -and $rowByIdentity.ContainsKey($sourceIdentity)) {
        $targetRow = [int]$rowByIdentity[$sourceIdentity]
      } elseif ($currentIdentity -and $rowByIdentity.ContainsKey($currentIdentity)) {
        $targetRow = [int]$rowByIdentity[$currentIdentity]
      }
      if ($targetRow -le 0) {
        $skippedCount += 1
        continue
      }
      if (-not $updatedRows.Add($targetRow)) {
        throw "Несколько записей веб-базы сопоставлены с одной строкой $targetRow листа 'Реестр программ'."
      }
      if ($promoMessage1Provided) {
        if (Set-ProgramPromoMessageCell $sheet $targetRow $promoMessage1Column (Get-ObjectProperty $program "promoMessage1")) {
          $messageCount += 1
        }
      }
      if ($promoMessage2Provided) {
        if (Set-ProgramPromoMessageCell $sheet $targetRow $promoMessage2Column (Get-ObjectProperty $program "promoMessage2")) {
          $messageCount += 1
        }
      }
      $updatedCount += 1
    }
    return [pscustomobject]@{
      Count = $updatedCount
      Messages = $messageCount
      Skipped = $skippedCount
      Provided = $true
    }
  } catch {
    throw "Ошибка обновления промосообщений на листе 'Реестр программ': $($_.Exception.Message)`n$($_.ScriptStackTrace)"
  } finally {
    Release-ComObject $dataRange
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
  foreach ($field in @($payload.contractDateFields)) { [void]$dateFields.Add([string]$field) }
  [void]$dateFields.Add("date")
  [void]$dateFields.Add("paid")
  $numberFields = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($field in @($payload.studentNumberFields)) { [void]$numberFields.Add([string]$field) }
  foreach ($field in @($payload.contractNumberFields)) { [void]$numberFields.Add([string]$field) }
  [void]$numberFields.Add("amount")

  Write-SyncProgress 3 "Запуск Microsoft Excel..."
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.EnableEvents = $false
  $excel.AskToUpdateLinks = $false
  $excel.AutomationSecurity = 3
  $workbook = $excel.Workbooks.Open($InputPath, 0, $false)

  Write-SyncProgress 7 "Книга открыта. Обновление ставок агентских выплат..."
  $agentRateResult = Update-AgentPaymentRates `
    $workbook `
    (Get-ObjectProperty $payload "agentPaymentRates")
  Write-SyncProgress 8 "Обновление слушателей..."
  $studentResult = Update-StudentSheet $workbook $payload $dateFields $numberFields
  $expenseResult = Update-DirectExpenseSheet $workbook $payload $dateFields $numberFields
  $generalExpenseResult = Update-GeneralExpenseSheet $workbook $payload $dateFields $numberFields
  $contractResult = Update-ContractSheet $workbook $payload $dateFields $numberFields
  Write-SyncProgress 95 "Обновление промосообщений программ..."
  $programPromoResult = Update-ProgramPromoMessages $workbook $payload
  Write-SyncProgress 96 "Обновление ставок и констант оплаты..."
  $paymentResult = Update-PaymentSettings $workbook $payload

  Write-SyncProgress 97 "Сохранение обновлённой книги..."
  try { $workbook.ForceFullCalculation = $true } catch {}
  try { $workbook.FullCalculationOnLoad = $true } catch {}
  try { $workbook.CalculateBeforeSave = $true } catch {}
  $workbook.SaveAs($OutputPath, 50)
  Write-SyncProgress 100 "Книга сохранена."

  [pscustomobject]@{
    type = "result"
    students = $studentResult.Count
    agentFormulaCount = $studentResult.AgentFormulaCount
    agentFormulaSkippedUnknownCount = $studentResult.AgentFormulaSkippedUnknownCount
    agentFormulaPreservedConstantCount = $studentResult.AgentFormulaPreservedConstantCount
    contracts = $contractResult.Count
    contractMaxRowHeightPoints = $contractResult.MaxRowHeightPoints
    directExpenses = $expenseResult.Count
    generalExpenses = $generalExpenseResult.Count
    programs = $programPromoResult.Count
    programPromoMessages = $programPromoResult.Messages
    programPromoSkipped = $programPromoResult.Skipped
    paymentConstants = $paymentResult.Count
    agentPaymentRates = [pscustomobject]@{
      withAuthorPercent = $agentRateResult.WithAuthorPercent
      withoutAuthorPercent = $agentRateResult.WithoutAuthorPercent
    }
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

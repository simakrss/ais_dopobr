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

if (-not ("AisExcelNativeMethods" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class AisExcelNativeMethods {
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
}

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

function Get-ExcelApplicationProcessId {
  param([object]$Application)
  if ($null -eq $Application) { return 0 }
  try {
    [uint32]$processId = 0
    [void][AisExcelNativeMethods]::GetWindowThreadProcessId(
      [IntPtr]([int64]$Application.Hwnd),
      [ref]$processId
    )
    return [int]$processId
  } catch {
    return 0
  }
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
  $isoMatch = [regex]::Match($text, '^(?<date>\d{4}-\d{2}-\d{2})(?:[T\s].*)?$')
  if ($isoMatch.Success) { $text = $isoMatch.Groups['date'].Value }
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
  if ($FieldName -eq "frdoStatus") {
    $frdoText = ([string]$Value).Trim()
    $isDateValue = $Value -is [datetime] `
      -or $frdoText -match '^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$' `
      -or $frdoText -match '^\d{1,2}[./]\d{1,2}[./]\d{2,4}$'
    if ($isDateValue) {
      $frdoDate = Convert-DateToExcelSerial $Value
      if ($null -ne $frdoDate) { return [Math]::Floor([double]$frdoDate) }
    }
  }
  if ($DateFields.Contains($FieldName)) {
    return Convert-DateToExcelSerial $Value
  }
  if ($NumberFields.Contains($FieldName)) {
    $number = 0.0
    if ($Value -is [double] -or $Value -is [float] -or $Value -is [decimal] -or $Value -is [int] -or $Value -is [long]) {
      $number = [double]$Value
    } else {
      $text = ([string]$Value).Replace([string][char]0x00A0, "").Replace(" ", "").Replace(",", ".").Trim()
      if (-not $text) { return $null }
      if (-not [double]::TryParse($text, [Globalization.NumberStyles]::Any, [Globalization.CultureInfo]::InvariantCulture, [ref]$number)) {
        return [string]$Value
      }
    }
    # The Web application stores discounts as human-readable percentages
    # (50 means 50%), while Excel percentage cells store the fraction (0.5).
    if ($FieldName -eq "discount") { return $number / 100.0 }
    return $number
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

function Normalize-CommunicationTemplateNamedRangeValue {
  param([AllowEmptyString()][string]$Value)
  if ($null -eq $Value) { return "" }
  return ([string]$Value).Replace("`r`n", "`n").Replace("`r", "`n")
}

function Test-StaticCommunicationTemplateTextFormula {
  param([AllowEmptyString()][string]$Formula)
  $pattern = '^\s*=\s*(?:"(?:[^"]|"")*"|CHAR\(\s*(?:10|13)\s*\))(?:\s*&\s*(?:"(?:[^"]|"")*"|CHAR\(\s*(?:10|13)\s*\)))*\s*$'
  return [regex]::IsMatch(
    [string]$Formula,
    $pattern,
    [Text.RegularExpressions.RegexOptions]::IgnoreCase
  )
}

function ConvertTo-CommunicationTemplateTextFormula {
  param([AllowEmptyString()][string]$Value)
  $normalized = Normalize-CommunicationTemplateNamedRangeValue $Value
  $tokens = [Collections.Generic.List[string]]::new()
  $lines = @([regex]::Split($normalized, "`n"))
  for ($lineIndex = 0; $lineIndex -lt $lines.Count; $lineIndex += 1) {
    if ($lineIndex -gt 0) { [void]$tokens.Add("CHAR(13)") }
    $line = [string]$lines[$lineIndex]
    if (-not $line.Length) {
      [void]$tokens.Add('""')
      continue
    }
    for ($offset = 0; $offset -lt $line.Length;) {
      $length = [Math]::Min(240, $line.Length - $offset)
      if (
        $offset + $length -lt $line.Length `
        -and [char]::IsHighSurrogate($line[$offset + $length - 1])
      ) {
        $length -= 1
      }
      if ($length -lt 1) { $length = [Math]::Min(2, $line.Length - $offset) }
      $chunk = $line.Substring($offset, $length)
      [void]$tokens.Add('"' + $chunk.Replace('"', '""') + '"')
      $offset += $length
    }
  }
  $formula = "=" + ($tokens -join " & ")
  if ($formula.Length -gt 8192) {
    throw "Текстовая формула именованного диапазона превышает предел Excel в 8192 символа."
  }
  return $formula
}

function Update-CommunicationTemplateNamedRanges {
  param(
    [object]$Workbook,
    [object]$Payload
  )
  if (-not [bool](Get-ObjectProperty $Payload "communicationTemplateFieldsProvided")) {
    return [pscustomobject]@{
      Provided = $false
      Requested = 0
      Updated = 0
      Skipped = 0
      FormulaPreserved = 0
      UpdatedNames = @()
      MissingNames = @()
    }
  }
  $values = Get-ObjectProperty $Payload "communicationTemplateNamedRangeValues"
  if ($null -eq $values -or $null -eq $values.PSObject) {
    throw "Не переданы значения именованных диапазонов шаблонов типовых сообщений."
  }
  $allowedNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($allowedName in @(
    "ПереченьДокументовДПП",
    "ПереченьДокументовДОП",
    "АдресАнкеты",
    "СсылкаНаОплату",
    "СсылкаНаОплатуПродления",
    "СсылкиСоцсети"
  )) {
    [void]$allowedNames.Add($allowedName)
  }
  $properties = @($values.PSObject.Properties)
  $updatedNames = [Collections.Generic.List[string]]::new()
  $missingNames = [Collections.Generic.List[string]]::new()
  $formulaPreserved = 0
  foreach ($property in $properties) {
    $requestedName = ([string]$property.Name).Trim()
    if (-not $allowedNames.Contains($requestedName)) {
      throw "Недопустимый именованный диапазон '$requestedName' в данных синхронизации."
    }
    $definedName = $null
    $targetRange = $null
    $operationStage = "поиск диапазона"
    try {
      $definedName = Get-WorkbookDefinedName $Workbook @($requestedName)
      if ($null -eq $definedName) {
        [void]$missingNames.Add($requestedName)
        continue
      }
      $operationStage = "проверка области видимости"
      $parentName = ""
      try { $parentName = [string]$definedName.Parent.Name } catch {}
      if (-not $parentName -or -not $parentName.Equals([string]$Workbook.Name, [StringComparison]::OrdinalIgnoreCase)) {
        [void]$missingNames.Add($requestedName)
        continue
      }
      $operationStage = "получение ячейки"
      try { $targetRange = $definedName.RefersToRange } catch {}
      $operationStage = "проверка размера диапазона"
      if ($null -eq $targetRange -or [double]$targetRange.CountLarge -ne 1) {
        throw "Именованный диапазон '$requestedName' должен указывать ровно на одну ячейку."
      }
      $operationStage = "подготовка значения"
      $value = Normalize-CommunicationTemplateNamedRangeValue ([string]$property.Value)
      if ($value.Length -gt 32767) {
        throw "Значение именованного диапазона '$requestedName' превышает предел Excel в 32767 символов."
      }
      $operationStage = "чтение текущего значения"
      $currentFormula = [string]$targetRange.Formula
      if ($currentFormula.TrimStart().StartsWith("=")) {
        if (-not (Test-StaticCommunicationTemplateTextFormula $currentFormula)) {
          throw "Именованный диапазон '$requestedName' содержит динамическую формулу; книга не изменена."
        }
        $operationStage = "запись текстовой формулы"
        $targetRange.Formula = [string](ConvertTo-CommunicationTemplateTextFormula $value)
        $formulaPreserved += 1
      } else {
        $operationStage = "запись значения"
        $targetRange.Value2 = [string]$value
      }
      try { [void]$targetRange.Calculate() } catch {}
      [void]$updatedNames.Add($requestedName)
    } catch {
      throw "Ошибка обновления именованного диапазона '$requestedName' на этапе '$operationStage': $($_.Exception.Message)"
    } finally {
      Release-ComObject $targetRange
      Release-ComObject $definedName
    }
  }
  return [pscustomobject]@{
    Provided = $true
    Requested = $properties.Count
    Updated = $updatedNames.Count
    Skipped = $missingNames.Count
    FormulaPreserved = $formulaPreserved
    UpdatedNames = @($updatedNames)
    MissingNames = @($missingNames)
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
      $value = if ($FieldName -eq "frdoStatus") {
        $frdoDate = Get-ObjectProperty $record "frdoDate"
        if (-not [string]::IsNullOrWhiteSpace([string]$frdoDate)) {
          $frdoDate
        } else {
          Get-ObjectProperty $record $FieldName
        }
      } else {
        Get-ObjectProperty $record $FieldName
      }
      $nextValues[$offset, 0] = Convert-CellValue $value $FieldName $DateFields $NumberFields
    }
    $range.Formula = $nextValues
    if ($FieldName -eq "discount") {
      try { $range.NumberFormat = "0.##%" } catch {}
    } elseif ($FieldName -eq "frdoStatus") {
      # Dates remain native Excel serial values. Text statuses in this mixed
      # column are unaffected by the date display format.
      try { $range.NumberFormatLocal = "ДД.ММ.ГГГГ" } catch {}
    }
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

function Sort-StudentLearningSectionByDaysUntilEnd {
  param(
    [object]$Sheet,
    [int]$HeaderRow,
    [int]$LastColumn,
    [int]$StartRow,
    [int]$RecordCount
  )
  if ($RecordCount -le 1) { return }

  $headerRange = $null
  $keyRange = $null
  $sortRange = $null
  $sort = $null
  $sortFields = $null
  $sortField = $null
  try {
    $headerRange = $Sheet.Range($Sheet.Cells.Item($HeaderRow, 1), $Sheet.Cells.Item($HeaderRow, $LastColumn))
    $headerValues = $headerRange.Value2
    $daysColumn = 0
    for ($column = 1; $column -le $LastColumn; $column += 1) {
      if (([string](Get-MatrixValue $headerValues 1 $column)).Trim() -eq "Дней до окончания") {
        $daysColumn = $column
        break
      }
    }
    if ($daysColumn -le 0) {
      throw "На листе 'База' не найдена колонка 'Дней до окончания'."
    }

    $endRow = $StartRow + $RecordCount - 1
    $keyRange = $Sheet.Range($Sheet.Cells.Item($StartRow, $daysColumn), $Sheet.Cells.Item($endRow, $daysColumn))
    $sortRange = $Sheet.Range($Sheet.Cells.Item($StartRow, 1), $Sheet.Cells.Item($endRow, $LastColumn))
    [void]$Sheet.Calculate()

    $sort = $Sheet.Sort
    $sortFields = $sort.SortFields
    [void]$sortFields.Clear()
    $sortField = $sortFields.Add($keyRange, 0, 1)
    [void]$sort.SetRange($sortRange)
    $sort.Header = 2
    $sort.MatchCase = $false
    $sort.Orientation = 1
    $sort.SortMethod = 1
    [void]$sort.Apply()
    [void]$sortFields.Clear()
  } finally {
    Release-ComObject $sortField
    Release-ComObject $sortFields
    Release-ComObject $sort
    Release-ComObject $sortRange
    Release-ComObject $keyRange
    Release-ComObject $headerRange
  }
}

function Sort-StudentLearningRecordsByEndDate {
  param([Collections.Generic.List[object]]$Records)
  if ($null -eq $Records -or $Records.Count -le 1) { return }
  $indexed = for ($index = 0; $index -lt $Records.Count; $index += 1) {
    $endDate = ([string](Get-ObjectProperty $Records[$index] "endDate")).Trim()
    [pscustomobject]@{
      Record = $Records[$index]
      Missing = $(if ($endDate) { 0 } else { 1 })
      EndDate = $endDate
      Index = $index
    }
  }
  $ordered = @($indexed | Sort-Object Missing, EndDate, Index)
  $Records.Clear()
  foreach ($item in $ordered) { $Records.Add($item.Record) | Out-Null }
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

    $learningRecordsKey = "обучающиеся"
    if ($recordsBySection.ContainsKey($learningRecordsKey)) {
      # The workbook formula for «Дней до окончания» is monotonic in endDate.
      # Pre-order the records so synchronization remains correct even when an
      # unlicensed Excel build refuses the optional COM Sort operation.
      Sort-StudentLearningRecordsByEndDate $recordsBySection[$learningRecordsKey]
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
    $syncCommentCount = Update-AisSyncMetadataForRows $sheet $recordByRow $startRow $lastRow 1
    $learningSection = @($finalSections | Where-Object {
      ([string]$_.Title).Trim().ToLowerInvariant() -eq "обучающиеся"
    } | Select-Object -First 1)
    if ($learningSection.Count -gt 0) {
      $learningSectionKey = ([string]$learningSection[0].Title).Trim().ToLowerInvariant()
      $learningRecordCount = if ($recordsBySection.ContainsKey($learningSectionKey)) {
        [int]$recordsBySection[$learningSectionKey].Count
      } else {
        0
      }
      if ($learningRecordCount -gt 1) {
        Write-SyncProgress 72 "Сортировка раздела 'Обучающиеся' по дням до окончания..."
        try {
          Sort-StudentLearningSectionByDaysUntilEnd `
            $sheet $header.Row $header.LastColumn ([int]$learningSection[0].Row + 1) $learningRecordCount
        } catch {
          if ($_.Exception.Message -notmatch "лицензи") { throw }
          Write-SyncProgress 72 (
            "Excel не выполнил дополнительную сортировку из-за ограничения лицензии; " +
            "сохранён предварительно рассчитанный порядок по дате окончания."
          )
        }
      }
    }
    return [pscustomobject]@{
      Count = $recordByRow.Count
      LastRow = $lastRow
      SyncCommentCount = $syncCommentCount
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
    [void](Update-AisSyncMetadataForRows $sheet $recordByRow $startRow $lastRow 1)
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
        # Row height is a presentation-only constraint. An expired/restricted
        # Excel license can reject it even though workbook data remains fully
        # writable, so keep the source height instead of aborting the sync.
        try {
          $row.RowHeight = $MaxHeightPoints
          $currentHeight = $MaxHeightPoints
        } catch {}
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
    [void](Update-AisSyncMetadataForRows $sheet $recordByRow ($header.Row + 1) $lastRow 1)
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
    $allGeneralExpenseRecords = @{}
    foreach ($row in $individualRecordByRow.Keys) {
      $allGeneralExpenseRecords[[int]$row] = $individualRecordByRow[$row]
    }
    foreach ($row in $organizationRecordByRow.Keys) {
      $allGeneralExpenseRecords[[int]$row] = $organizationRecordByRow[$row]
    }
    [void](Update-AisSyncMetadataForRows $sheet $allGeneralExpenseRecords $scanStartRow $lastExistingRow 1)
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

function Update-InventorySheet {
  param(
    [object]$Workbook,
    [object]$Payload,
    [Collections.Generic.HashSet[string]]$DateFields,
    [Collections.Generic.HashSet[string]]$NumberFields
  )
  $provided = [bool](Get-ObjectProperty $Payload "inventoryProvided")
  $items = @(Get-ObjectProperty $Payload "inventory")
  $records = @(Get-ObjectProperty $Payload "inventoryRows")
  if (-not $provided) {
    return [pscustomobject]@{
      Provided = $false
      Items = 0
      Units = 0
      LastRow = 0
      InsertedRows = 0
    }
  }

  $sheet = $null
  try {
    $sheet = $Workbook.Worksheets.Item("Запасы")
    $header = Find-HeaderRow $sheet @("Вид ТМЦ", "Сумма", "uid")
    $columns = @(Get-MappedColumns $sheet $header.Row $header.LastColumn $Payload.inventoryColumnMap)
    foreach ($fieldName in @("date", "itemType", "amount", "note", "uid")) {
      [void](Find-MappedColumn $columns $fieldName)
    }
    $startRow = [int]$header.Row + 1
    $lastRow = [int]$header.LastRow
    if ($lastRow -lt $startRow) {
      throw "На листе нет шаблонной строки для безопасного добавления запасов."
    }
    $desiredLastRow = $startRow + $records.Count - 1
    $insertedRows = [Math]::Max(0, $desiredLastRow - $lastRow)
    if ($insertedRows -gt 0) {
      Insert-StudentTemplateRows $sheet $lastRow ($lastRow + 1) $header.LastColumn $insertedRows
      $lastRow = $desiredLastRow
    }

    $recordByRow = @{}
    for ($index = 0; $index -lt $records.Count; $index += 1) {
      $recordByRow[$startRow + $index] = $records[$index]
    }
    $processedColumns = 0
    foreach ($column in $columns) {
      Update-MappedColumn $sheet $startRow $lastRow $column.Column $column.FieldName $recordByRow $DateFields $NumberFields @() $null
      $processedColumns += 1
      Write-SyncProgress 94 "Обновление запасов: $processedColumns из $($columns.Count) колонок"
    }
    [void](Update-AisSyncMetadataForRows $sheet $recordByRow $startRow $lastRow 1)
    return [pscustomobject]@{
      Provided = $true
      Items = $items.Count
      Units = $records.Count
      LastRow = $lastRow
      InsertedRows = $insertedRows
    }
  } catch {
    throw "Ошибка обновления листа 'Запасы': $($_.Exception.Message)`n$($_.ScriptStackTrace)"
  } finally {
    Release-ComObject $sheet
  }
}

function Update-TrainingPlanSheet {
  param(
    [object]$Workbook,
    [object]$Payload,
    [Collections.Generic.HashSet[string]]$DateFields,
    [Collections.Generic.HashSet[string]]$NumberFields
  )
  $provided = [bool](Get-ObjectProperty $Payload "trainingPlansProvided")
  $records = @(Get-ObjectProperty $Payload "trainingPlans")
  if (-not $provided) {
    return [pscustomobject]@{
      Provided = $false
      Count = 0
      LastRow = 0
      InsertedRows = 0
      ClearedRows = 0
    }
  }

  $sheet = $null
  try {
    $sheet = $Workbook.Worksheets.Item("Учебные планы")
    $header = Find-HeaderRow $sheet @("Код", "Наименование программы")
    $columns = @(Get-MappedColumns $sheet $header.Row $header.LastColumn $Payload.trainingPlanColumnMap)
    foreach ($fieldName in @(
      "code",
      "programName",
      "discipline",
      "description",
      "totalHours",
      "theoryHours",
      "practiceHours",
      "attestation",
      "teacher",
      "materials",
      "content"
    )) {
      [void](Find-MappedColumn $columns $fieldName)
    }
    $startRow = [int]$header.Row + 1
    $lastRow = [int]$header.LastRow
    $dataLastColumn = [int](($columns | Measure-Object -Property Column -Maximum).Maximum)
    if ($lastRow -lt $startRow) {
      throw "На листе нет шаблонной строки для безопасного добавления учебного плана."
    }
    $desiredLastRow = $startRow + $records.Count - 1
    $insertedRows = [Math]::Max(0, $desiredLastRow - $lastRow)
    if ($insertedRows -gt 0) {
      $insertStartRow = $lastRow + 1
      Insert-StudentTemplateRows $sheet $startRow $insertStartRow $dataLastColumn $insertedRows
      $insertedRange = $null
      try {
        $insertedRange = $sheet.Range(
          $sheet.Cells.Item($insertStartRow, 1),
          $sheet.Cells.Item($desiredLastRow, $dataLastColumn)
        )
        try { [void]$insertedRange.ClearComments() } catch {}
      } finally {
        Release-ComObject $insertedRange
      }
      $lastRow = $desiredLastRow
    }

    $recordByRow = @{}
    for ($index = 0; $index -lt $records.Count; $index += 1) {
      $recordByRow[$startRow + $index] = $records[$index]
    }
    Ensure-ContractFormulaRows $sheet $columns $startRow $startRow $records.Count
    $processedColumns = 0
    foreach ($column in $columns) {
      Update-MappedColumn $sheet $startRow $lastRow $column.Column $column.FieldName $recordByRow $DateFields $NumberFields @() $null
      $processedColumns += 1
      Write-SyncProgress 95 "Обновление учебных планов: $processedColumns из $($columns.Count) колонок"
    }
    [void](Update-AisSyncMetadataForRows $sheet $recordByRow $startRow $lastRow 1)
    return [pscustomobject]@{
      Provided = $true
      Count = $records.Count
      LastRow = $lastRow
      InsertedRows = $insertedRows
      ClearedRows = [Math]::Max(0, $lastRow - $desiredLastRow)
    }
  } catch {
    throw "Ошибка обновления листа 'Учебные планы': $($_.Exception.Message)`n$($_.ScriptStackTrace)"
  } finally {
    Release-ComObject $sheet
  }
}

function Sort-ProgramRegistryRows {
  param(
    [object]$Sheet,
    [int]$HeaderRow,
    [int]$StartRow,
    [int]$LastRow,
    [int]$DataLastColumn,
    [int]$NameColumn,
    [int]$StatusColumn
  )
  if ($LastRow -lt $StartRow) {
    return [pscustomobject]@{ Rows = 0; ArchiveRows = 0 }
  }

  $helperColumn = $DataLastColumn + 1
  $helperHeaderCell = $null
  $helperRange = $null
  $helperDataRange = $null
  $nameDataRange = $null
  $sortRange = $null
  $sort = $null
  $sortFields = $null
  try {
    $rowCount = $LastRow - $StartRow + 1
    $helperValues = New-Object "object[,]" $rowCount, 1
    $archiveRows = 0
    for ($offset = 0; $offset -lt $rowCount; $offset += 1) {
      $statusCell = $null
      try {
        $statusCell = $Sheet.Cells.Item($StartRow + $offset, $StatusColumn)
        $status = (Normalize-Header $statusCell.Value2).ToLowerInvariant()
        $isArchive = $status -match "архив"
        $helperValues[$offset, 0] = if ($isArchive) { 1 } else { 0 }
        if ($isArchive) { $archiveRows += 1 }
      } finally {
        Release-ComObject $statusCell
      }
    }

    $helperRange = $Sheet.Range(
      $Sheet.Cells.Item($HeaderRow, $helperColumn),
      $Sheet.Cells.Item($LastRow, $helperColumn)
    )
    $helperHeaderCell = $Sheet.Cells.Item($HeaderRow, $helperColumn)
    $helperHeaderCell.Value2 = "__AIS_ARCHIVE_SORT"
    $helperDataRange = $Sheet.Range(
      $Sheet.Cells.Item($StartRow, $helperColumn),
      $Sheet.Cells.Item($LastRow, $helperColumn)
    )
    $helperDataRange.Formula = $helperValues
    $nameDataRange = $Sheet.Range(
      $Sheet.Cells.Item($StartRow, $NameColumn),
      $Sheet.Cells.Item($LastRow, $NameColumn)
    )
    $sortRange = $Sheet.Range(
      $Sheet.Cells.Item($HeaderRow, 1),
      $Sheet.Cells.Item($LastRow, $helperColumn)
    )
    $sort = $Sheet.Sort
    $sortFields = $sort.SortFields
    $sortFields.Clear()
    [void]$sortFields.Add($helperDataRange, 0, 1, $null, 0)
    [void]$sortFields.Add($nameDataRange, 0, 1, $null, 0)
    $sort.SetRange($sortRange)
    $sort.Header = 1
    $sort.MatchCase = $false
    $sort.Orientation = 1
    $sort.Apply()
    return [pscustomobject]@{
      Rows = $rowCount
      ArchiveRows = $archiveRows
    }
  } finally {
    if ($null -ne $helperRange) {
      try { [void]$helperRange.ClearContents() } catch {}
    }
    Release-ComObject $sortFields
    Release-ComObject $sort
    Release-ComObject $sortRange
    Release-ComObject $nameDataRange
    Release-ComObject $helperDataRange
    Release-ComObject $helperRange
    Release-ComObject $helperHeaderCell
  }
}

function Update-AisSyncMetadataForCurrentRows {
  param(
    [object]$Sheet,
    [hashtable]$RecordByRow,
    [int]$StartRow,
    [int]$LastRow,
    [int]$FirstColumn
  )
  $updated = 0
  $usedIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  for ($row = $StartRow; $row -le $LastRow; $row += 1) {
    $record = if ($RecordByRow.ContainsKey($row)) { $RecordByRow[$row] } else { $null }
    $metadata = if ($null -ne $record) {
      ([string](Get-ObjectProperty $record "__syncComment")).Trim()
    } else {
      ""
    }
    if ($metadata) {
      $metadataObject = Get-AisSyncMetadataObject $metadata
      $recordId = ([string](Get-ObjectProperty $metadataObject "recordId")).Trim()
      if (-not $usedIds.Add($recordId)) {
        throw "После сортировки реестра программ повторяется служебный ID '$recordId'."
      }
    }
    $cell = $null
    try {
      $cell = $Sheet.Cells.Item($row, $FirstColumn)
      $humanText = Get-CellCommentText $cell
      if (Set-AisSyncCommentCell $cell "" -HumanText $humanText -UseProvidedHumanText) {
        $updated += 1
      }
      if (Set-AisSyncValidationCell $cell $metadata) {
        $updated += 1
      }
    } finally {
      Release-ComObject $cell
    }
  }
  return $updated
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
    [object]$Value,
    [string]$IndicatorText = ""
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
      $currentFormula = [string]$cell.Formula
      if (
        $IndicatorText `
        -and -not $currentFormula.StartsWith("=") `
        -and ([string]$cell.Value2).Trim() -eq $IndicatorText
      ) {
        [void]$cell.ClearContents()
      }
      return $false
    }
    if ($IndicatorText -and -not ([string]$cell.Formula).StartsWith("=")) {
      $cell.Value2 = $IndicatorText
    }
    $comment = $cell.AddComment($text)
    try { $comment.Visible = $false } catch {}
    return $true
  } finally {
    Release-ComObject $comment
    Release-ComObject $cell
  }
}

function Set-ProgramManagedValueCell {
  param(
    [object]$Sheet,
    [int]$Row,
    [int]$Column,
    [string]$FieldName,
    [object]$Value,
    [Collections.Generic.HashSet[string]]$DateFields,
    [Collections.Generic.HashSet[string]]$NumberFields
  )
  $cell = $null
  try {
    $cell = $Sheet.Cells.Item($Row, $Column)
    $currentFormula = [string]$cell.Formula
    if ($currentFormula.StartsWith("=")) {
      if (
        $FieldName -eq "name" `
        -and (Normalize-Header $cell.Value2) -ne (Normalize-Header $Value)
      ) {
        throw "Название программы в строке $Row вычисляется формулой и не совпадает с Web-базой."
      }
      return "formula"
    }
    $cell.Formula = Convert-CellValue $Value $FieldName $DateFields $NumberFields
    return "updated"
  } finally {
    Release-ComObject $cell
  }
}

function Get-CellCommentText {
  param([object]$Cell)
  $comment = $null
  try {
    $comment = $Cell.Comment
    if ($null -eq $comment) { return "" }
    try { return [string]$comment.Text() } catch {
      return [string]$comment.Text
    }
  } catch {
    return ""
  } finally {
    Release-ComObject $comment
  }
}

function Get-AisSyncHumanCommentText {
  param([object]$Value)
  $source = ([string]$Value).Replace("`r`n", "`n").Replace("`r", "`n")
  $managedPattern = "(?s)\[\[AIS_SYNC_V1\]\].*?\[\[/AIS_SYNC_V1\]\]"
  $preserved = [regex]::Replace($source, $managedPattern, "")
  $orphanStart = $preserved.IndexOf("[[AIS_SYNC_V1]]", [StringComparison]::Ordinal)
  if ($orphanStart -ge 0) { $preserved = $preserved.Substring(0, $orphanStart) }
  return $preserved.Replace("[[/AIS_SYNC_V1]]", "").Trim([char]13, [char]10)
}

function Set-AisSyncCommentCell {
  param(
    [object]$Cell,
    [object]$MetadataJson,
    [string]$HumanText = "",
    [switch]$UseProvidedHumanText
  )
  $metadata = ([string]$MetadataJson).Trim()
  $existing = (Get-CellCommentText $Cell).Replace("`r`n", "`n").Replace("`r", "`n")
  $preserved = if ($UseProvidedHumanText) {
    (Get-AisSyncHumanCommentText $HumanText)
  } else {
    (Get-AisSyncHumanCommentText $existing)
  }
  $managed = if ($metadata) { "[[AIS_SYNC_V1]]`n$metadata`n[[/AIS_SYNC_V1]]" } else { "" }
  $text = if ($preserved -and $managed) {
    "$preserved`n`n$managed"
  } elseif ($preserved) {
    $preserved
  } else {
    $managed
  }
  if ($existing -ceq $text) { return $false }
  $comment = $null
  try {
    try { $comment = $Cell.Comment } catch { $comment = $null }
    if (-not $text) {
      if ($null -ne $comment) { [void]$comment.Delete() }
      return ($existing -ne "")
    }
    if ($null -eq $comment) {
      $comment = $Cell.AddComment($text)
    } else {
      [void]$comment.Text($text)
    }
    try { $comment.Visible = $false } catch {}
    return $true
  } finally {
    Release-ComObject $comment
  }
}

function Get-AisSyncMetadataObject {
  param([object]$MetadataJson)
  $metadata = ([string]$MetadataJson).Trim()
  if (-not $metadata) { return $null }
  try {
    $parsed = $metadata | ConvertFrom-Json
  } catch {
    throw "Некорректная служебная метка AIS_SYNC: $($_.Exception.Message)"
  }
  $recordId = ([string](Get-ObjectProperty $parsed "recordId")).Trim()
  $entity = ([string](Get-ObjectProperty $parsed "entity")).Trim()
  if ([int](Get-ObjectProperty $parsed "v") -ne 1 -or -not $recordId -or -not $entity) {
    throw "Некорректная служебная метка AIS_SYNC: отсутствует версия, тип или ID записи."
  }
  return $parsed
}

function Get-AisSyncMetadataFromText {
  param(
    [object]$Value,
    [string]$ExpectedEntity = "",
    [string]$SourceLabel = "свойстве ячейки"
  )
  $text = ([string]$Value).Replace("`r`n", "`n").Replace("`r", "`n")
  $hasStart = $text.Contains("[[AIS_SYNC_V1]]")
  $hasEnd = $text.Contains("[[/AIS_SYNC_V1]]")
  if (-not $hasStart -and -not $hasEnd) { return $null }
  $matches = [regex]::Matches(
    $text,
    "(?s)\[\[AIS_SYNC_V1\]\](.*?)\[\[/AIS_SYNC_V1\]\]"
  )
  if ($matches.Count -ne 1) {
    throw "В $SourceLabel должна быть ровно одна служебная метка AIS_SYNC."
  }
  $parsed = Get-AisSyncMetadataObject $matches[0].Groups[1].Value
  $entity = ([string](Get-ObjectProperty $parsed "entity")).Trim()
  if ($ExpectedEntity -and $entity -ne $ExpectedEntity) {
    throw "Служебная метка AIS_SYNC типа '$entity' находится на листе '$ExpectedEntity'."
  }
  return $parsed
}

function Get-AisSyncCommentMetadata {
  param(
    [object]$Cell,
    [string]$ExpectedEntity = ""
  )
  return Get-AisSyncMetadataFromText `
    (Get-CellCommentText $Cell) `
    $ExpectedEntity `
    "примечании ячейки"
}

function Get-CellValidationErrorText {
  param([object]$Cell)
  $validation = $null
  try {
    $validation = $Cell.Validation
    [void]$validation.Type
    return [string]$validation.ErrorMessage
  } catch {
    return ""
  } finally {
    Release-ComObject $validation
  }
}

function Get-AisSyncValidationMetadata {
  param(
    [object]$Cell,
    [string]$ExpectedEntity = ""
  )
  return Get-AisSyncMetadataFromText `
    (Get-CellValidationErrorText $Cell) `
    $ExpectedEntity `
    "тексте сообщения об ошибке проверки данных"
}

function Get-AisSyncCellMetadata {
  param(
    [object]$Cell,
    [string]$ExpectedEntity = ""
  )
  $validationMetadata = Get-AisSyncValidationMetadata $Cell $ExpectedEntity
  $commentMetadata = Get-AisSyncCommentMetadata $Cell $ExpectedEntity
  if ($null -ne $validationMetadata -and $null -ne $commentMetadata) {
    $validationRecordId = ([string](Get-ObjectProperty $validationMetadata "recordId")).Trim()
    $commentRecordId = ([string](Get-ObjectProperty $commentMetadata "recordId")).Trim()
    $validationParentId = ([string](Get-ObjectProperty $validationMetadata "parentRecordId")).Trim()
    $commentParentId = ([string](Get-ObjectProperty $commentMetadata "parentRecordId")).Trim()
    if ($validationRecordId -ne $commentRecordId -or $validationParentId -ne $commentParentId) {
      throw "Служебные метки AIS_SYNC в проверке данных и примечании ячейки не совпадают."
    }
  }
  if ($null -ne $validationMetadata) { return $validationMetadata }
  return $commentMetadata
}

function Set-AisSyncValidationCell {
  param(
    [object]$Cell,
    [object]$MetadataJson
  )
  $metadata = ([string]$MetadataJson).Trim()
  if ($metadata) { [void](Get-AisSyncMetadataObject $metadata) }

  $validation = $null
  $hasValidation = $false
  $operation = "чтение проверки данных"
  try {
    try {
      $validation = $Cell.Validation
      $validationTypeValue = $validation.Type
      $hasValidation = $null -ne $validationTypeValue -and [string]$validationTypeValue -ne ""
    } catch {
      $hasValidation = $false
    }

    $existing = if ($hasValidation) {
      ([string]$validation.ErrorMessage).Replace("`r`n", "`n").Replace("`r", "`n")
    } else {
      ""
    }
    $wasManaged = $existing.Contains("[[AIS_SYNC_V1]]") `
      -or $existing.Contains("[[/AIS_SYNC_V1]]") `
      -or ($hasValidation -and [string]$validation.ErrorTitle -eq "AIS_SYNC_V1")
    if (-not $metadata -and -not $wasManaged) { return $false }

    $preserved = Get-AisSyncHumanCommentText $existing
    $managed = if ($metadata) { "[[AIS_SYNC_V1]]`n$metadata`n[[/AIS_SYNC_V1]]" } else { "" }
    $text = if ($preserved -and $managed) {
      "$preserved`n`n$managed"
    } elseif ($preserved) {
      $preserved
    } else {
      $managed
    }
    if ($text.Length -gt 225) {
      throw "Служебная метка AIS_SYNC не помещается в сообщение проверки данных Excel (максимум 225 символов)."
    }

    if (-not $metadata -and -not $preserved -and $hasValidation -and [string]$validation.ErrorTitle -eq "AIS_SYNC_V1") {
      $operation = "удаление служебной проверки данных"
      [void]$validation.Delete()
      return $true
    }
    if (-not $hasValidation) {
      # xlValidateCustom + always-true formula keeps the metadata invisible and never blocks input.
      $operation = "создание проверки данных"
      try { [void]$validation.Delete() } catch {}
      $validation.Add(7, 1, 1, "=1=1")
      $hasValidation = $true
      $validation.IgnoreBlank = $true
      $validation.ShowInput = $false
      $validation.ShowError = $true
      $validation.ErrorTitle = "AIS_SYNC_V1"
    }
    if ($existing -ceq $text) { return $false }
    $operation = "запись сообщения проверки данных"
    $validation.ErrorMessage = $text
    if ([string]$validation.ErrorTitle -eq "AIS_SYNC_V1") {
      $validation.ShowError = $false
    }
    return $true
  } catch {
    $address = try { [string]$Cell.Address($false, $false) } catch { "?" }
    $sheetName = try { [string]$Cell.Worksheet.Name } catch { "?" }
    $validationType = try { [string]$validation.Type } catch { "ошибка: $($_.Exception.Message)" }
    $validationTitle = try { [string]$validation.ErrorTitle } catch { "" }
    $validationFormula = try { [string]$validation.Formula1 } catch { "ошибка: $($_.Exception.Message)" }
    $isMerged = try { [bool]$Cell.MergeCells } catch { $false }
    $isProtected = try { [bool]$Cell.Worksheet.ProtectContents } catch { $false }
    throw "Ошибка AIS_SYNC ($operation) в ячейке '$sheetName!$address' (тип проверки: $validationType, формула: '$validationFormula', заголовок: '$validationTitle', длина сообщения: $($text.Length), объединение: $isMerged, защита: $isProtected): $($_.Exception.Message)"
  } finally {
    Release-ComObject $validation
  }
}

function Update-AisSyncMetadataForRows {
  param(
    [object]$Sheet,
    [hashtable]$RecordByRow,
    [int]$StartRow,
    [int]$LastRow,
    [int]$FirstColumn = 1
  )
  $updated = 0
  $usedIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  $recordIdByRow = @{}
  $expectedEntity = ""
  foreach ($row in @($RecordByRow.Keys | Sort-Object)) {
    $record = $RecordByRow[[int]$row]
    $metadata = Get-ObjectProperty $record "__syncComment"
    if ([string]::IsNullOrWhiteSpace([string]$metadata)) {
      throw "Для строки $row не передана служебная метка AIS_SYNC."
    }
    $parsed = Get-AisSyncMetadataObject $metadata
    $recordId = ([string](Get-ObjectProperty $parsed "recordId")).Trim()
    $entity = ([string](Get-ObjectProperty $parsed "entity")).Trim()
    if (-not $expectedEntity) { $expectedEntity = $entity }
    if ($expectedEntity -ne $entity) {
      throw "В одном диапазоне переданы служебные метки AIS_SYNC разных типов."
    }
    if (-not $usedIds.Add($recordId)) {
      throw "В переданных данных повторяется служебный ID '$recordId'."
    }
    $recordIdByRow[[int]$row] = $recordId
  }

  $humanTextByRecordId = @{}
  $unmanagedHumanTextByRow = @{}
  $seenExistingIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  for ($row = $StartRow; $row -le $LastRow; $row += 1) {
    $cell = $null
    try {
      $cell = $Sheet.Cells.Item($row, $FirstColumn)
      $humanText = Get-AisSyncHumanCommentText (Get-CellCommentText $cell)
      $existingMetadata = Get-AisSyncCellMetadata $cell $expectedEntity
      if ($null -ne $existingMetadata) {
        $existingRecordId = ([string](Get-ObjectProperty $existingMetadata "recordId")).Trim()
        if (-not $seenExistingIds.Add($existingRecordId)) {
          throw "В служебных свойствах листа '$([string]$Sheet.Name)' повторяется ID '$existingRecordId'."
        }
        $humanTextByRecordId[$existingRecordId] = $humanText
      } elseif ($humanText) {
        $unmanagedHumanTextByRow[$row] = $humanText
      }
    } finally {
      Release-ComObject $cell
    }
  }

  for ($row = $StartRow; $row -le $LastRow; $row += 1) {
    if ($RecordByRow.ContainsKey($row)) { continue }
    $cell = $null
    try {
      $cell = $Sheet.Cells.Item($row, $FirstColumn)
      $staleMetadata = Get-AisSyncCellMetadata $cell $expectedEntity
      if ($null -eq $staleMetadata) { continue }
      $staleRecordId = ([string](Get-ObjectProperty $staleMetadata "recordId")).Trim()
      if ($staleRecordId -and $usedIds.Contains($staleRecordId)) {
        if (Set-AisSyncCommentCell $cell "" -HumanText "" -UseProvidedHumanText) { $updated += 1 }
      } elseif (Set-AisSyncCommentCell $cell "") {
        $updated += 1
      }
      if (Set-AisSyncValidationCell $cell "") { $updated += 1 }
    } finally {
      Release-ComObject $cell
    }
  }

  foreach ($row in @($RecordByRow.Keys | Sort-Object)) {
    $record = $RecordByRow[[int]$row]
    $metadata = Get-ObjectProperty $record "__syncComment"
    $recordId = [string]$recordIdByRow[[int]$row]
    $humanText = if ($humanTextByRecordId.ContainsKey($recordId)) {
      [string]$humanTextByRecordId[$recordId]
    } elseif ($unmanagedHumanTextByRow.ContainsKey([int]$row)) {
      [string]$unmanagedHumanTextByRow[[int]$row]
    } else {
      ""
    }
    $cell = $null
    try {
      $cell = $Sheet.Cells.Item([int]$row, $FirstColumn)
      if (Set-AisSyncCommentCell $cell "" -HumanText $humanText -UseProvidedHumanText) {
        $updated += 1
      }
      if (Set-AisSyncValidationCell $cell $metadata) {
        $updated += 1
      }
    } finally {
      Release-ComObject $cell
    }
  }
  return $updated
}

function Update-ProgramPromoMessages {
  param(
    [object]$Workbook,
    [object]$Payload,
    [Collections.Generic.HashSet[string]]$DateFields,
    [Collections.Generic.HashSet[string]]$NumberFields
  )
  $provided = Get-ObjectProperty $Payload "programPromoMessagesProvided"
  $programs = @(Get-ObjectProperty $Payload "programs")
  if (-not $provided) {
    return [pscustomobject]@{
      Count = 0
      Messages = 0
      EmailMessages = 0
      ManagedCells = 0
      FormulaCellsPreserved = 0
      MissingManagedColumns = 0
      MissingManagedColumnNames = @()
      Skipped = 0
      SkippedPrograms = @()
      InsertedRows = 0
      SortedRows = 0
      ArchiveRows = 0
      Provided = $false
    }
  }

  $sheet = $null
  $dataRange = $null
  try {
    $sheet = $Workbook.Worksheets.Item("Реестр программ")
    $header = Find-HeaderRow $sheet @("Наименование программы", "Автор")
    $columnMapValues = [ordered]@{
      "Наименование программы" = "name"
    }
    foreach ($property in $Payload.programColumnMap.PSObject.Properties) {
      $columnMapValues[$property.Name] = [string]$property.Value
    }
    $columnMap = [pscustomobject]$columnMapValues
    $columns = @(Get-MappedColumns $sheet $header.Row $header.LastColumn $columnMap)
    $nameColumn = Find-MappedColumn $columns "name"
    $statusColumn = Find-MappedColumn $columns "status"
    $landingCodeColumn = Find-MappedColumn $columns "landingCode"
    $promoMessage1Column = Find-MappedColumn $columns "promoMessage1"
    $promoMessage2Column = Find-MappedColumn $columns "promoMessage2"
    $emailMessageTemplateColumn = Find-MappedColumn $columns "emailMessageTemplate"
    $columnByField = @{}
    foreach ($column in $columns) {
      if (-not $columnByField.ContainsKey([string]$column.FieldName)) {
        $columnByField[[string]$column.FieldName] = [int]$column.Column
      }
    }
    $startRow = [int]$header.Row + 1
    $lastRow = [int]$header.LastRow
    $dataLastColumn = [int](($columns | Measure-Object -Property Column -Maximum).Maximum)
    if ($lastRow -lt $startRow) {
      $emptySheetSkippedPrograms = @($programs | Where-Object { $null -ne $_ } | ForEach-Object {
        $program = $_
        $sourceName = Get-ObjectProperty $program "xlsbProgramName"
        if (-not (Normalize-Header $sourceName)) { $sourceName = Get-ObjectProperty $program "name" }
        $sourceLandingCode = if (Test-ObjectProperty $program "xlsbProgramLandingCode") {
          Get-ObjectProperty $program "xlsbProgramLandingCode"
        } else {
          Get-ObjectProperty $program "landingCode"
        }
        [pscustomobject]@{
          id = ([string](Get-ObjectProperty $program "id")).Trim()
          name = ([string](Get-ObjectProperty $program "name")).Trim()
          landingCode = ([string](Get-ObjectProperty $program "landingCode")).Trim()
          sourceName = ([string]$sourceName).Trim()
          sourceLandingCode = ([string]$sourceLandingCode).Trim()
          requestedRow = [int](Get-ObjectProperty $program "xlsbProgramRow")
          reason = "На листе 'Реестр программ' нет строк данных."
        }
      })
      return [pscustomobject]@{
        Count = 0
        Messages = 0
        EmailMessages = 0
        ManagedCells = 0
        FormulaCellsPreserved = 0
        MissingManagedColumns = 0
        MissingManagedColumnNames = @()
        Skipped = $programs.Count
        SkippedPrograms = $emptySheetSkippedPrograms
        InsertedRows = 0
        SortedRows = 0
        ArchiveRows = 0
        Provided = $true
      }
    }

    $dataRange = $sheet.Range($sheet.Cells.Item($startRow, 1), $sheet.Cells.Item($lastRow, $header.LastColumn))
    $values = $dataRange.Value2
    $rowByIdentity = @{}
    $identityByRow = @{}
    $rowByRecordId = @{}
    $recordIdByRow = @{}
    $existingRecordByIdentity = @{}
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
      $firstCell = $null
      try {
        $firstCell = $sheet.Cells.Item($row, 1)
        $syncMetadata = Get-AisSyncCellMetadata $firstCell "programs"
        if ($null -ne $syncMetadata) {
          $recordId = ([string](Get-ObjectProperty $syncMetadata "recordId")).Trim()
          if ($rowByRecordId.ContainsKey($recordId)) {
            throw "В реестре программ повторяется служебный ID '$recordId' (строки $($rowByRecordId[$recordId]) и $row)."
          }
          $rowByRecordId[$recordId] = $row
          $recordIdByRow[$row] = $recordId
          $existingRecordByIdentity[$identity] = [pscustomobject]@{
            id = $recordId
            __syncComment = ($syncMetadata | ConvertTo-Json -Compress -Depth 6)
          }
        }
      } finally {
        Release-ComObject $firstCell
      }
    }

    $updatedRows = [Collections.Generic.HashSet[int]]::new()
    $programRecordByRow = @{}
    $updatedCount = 0
    $messageCount = 0
    $emailMessageCount = 0
    $managedCellCount = 0
    $formulaCellsPreserved = 0
    $missingManagedColumns = 0
    $missingManagedColumnNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $skippedCount = 0
    $skippedPrograms = [Collections.Generic.List[object]]::new()
    $insertedRows = 0
    foreach ($program in $programs) {
      if ($null -eq $program) { continue }
      $providedFields = @(
        @(Get-ObjectProperty $program "providedFields") |
          ForEach-Object { ([string]$_).Trim() } |
          Where-Object { $_ }
      )
      $promoMessage1Provided = [bool](Get-ObjectProperty $program "promoMessage1Provided")
      $promoMessage2Provided = [bool](Get-ObjectProperty $program "promoMessage2Provided")
      $emailMessageTemplateProvided = [bool](Get-ObjectProperty $program "emailMessageTemplateProvided")
      $hasManagedValues = -not (
        $providedFields.Count -eq 0 `
        -and -not $promoMessage1Provided `
        -and -not $promoMessage2Provided `
        -and -not $emailMessageTemplateProvided
      )
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
      $requestedRecordId = ([string](Get-ObjectProperty $program "id")).Trim()
      $targetRow = 0
      if (
        $requestedRecordId `
        -and $rowByRecordId.ContainsKey($requestedRecordId)
      ) {
        $targetRow = [int]$rowByRecordId[$requestedRecordId]
      } elseif (
        $requestedRow -ge $startRow `
        -and $requestedRow -le $lastRow `
        -and $identityByRow.ContainsKey($requestedRow) `
        -and $identityByRow[$requestedRow] -eq $sourceIdentity `
        -and -not $recordIdByRow.ContainsKey($requestedRow)
      ) {
        $targetRow = $requestedRow
      } elseif (
        $sourceIdentity `
        -and $rowByIdentity.ContainsKey($sourceIdentity) `
        -and -not $recordIdByRow.ContainsKey([int]$rowByIdentity[$sourceIdentity])
      ) {
        $targetRow = [int]$rowByIdentity[$sourceIdentity]
      } elseif (
        $currentIdentity `
        -and $rowByIdentity.ContainsKey($currentIdentity) `
        -and -not $recordIdByRow.ContainsKey([int]$rowByIdentity[$currentIdentity])
      ) {
        $targetRow = [int]$rowByIdentity[$currentIdentity]
      }
      if ($targetRow -le 0) {
        $targetRow = $lastRow + 1
        Insert-StudentTemplateRows $sheet $startRow $targetRow $dataLastColumn 1
        $insertedRange = $null
        try {
          $insertedRange = $sheet.Range(
            $sheet.Cells.Item($targetRow, 1),
            $sheet.Cells.Item($targetRow, $dataLastColumn)
          )
          try { [void]$insertedRange.ClearComments() } catch {}
        } finally {
          Release-ComObject $insertedRange
        }
        $lastRow = $targetRow
        $insertedRows += 1
        if ($currentIdentity) {
          $rowByIdentity[$currentIdentity] = $targetRow
          $identityByRow[$targetRow] = $currentIdentity
        }
        if ($requestedRecordId) {
          $rowByRecordId[$requestedRecordId] = $targetRow
          $recordIdByRow[$targetRow] = $requestedRecordId
        }
      }
      if (-not $updatedRows.Add($targetRow)) {
        throw "Несколько записей веб-базы сопоставлены с одной строкой $targetRow листа 'Реестр программ'."
      }
      $programRecordByRow[$targetRow] = $program
      if (-not $hasManagedValues) { continue }
      foreach ($fieldName in $providedFields) {
        if ($fieldName -in @("promoMessage1", "promoMessage2", "emailMessageTemplate")) {
          continue
        }
        if (-not $columnByField.ContainsKey($fieldName)) {
          $missingManagedColumns += 1
          [void]$missingManagedColumnNames.Add($fieldName)
          continue
        }
        $result = Set-ProgramManagedValueCell `
          $sheet `
          $targetRow `
          ([int]$columnByField[$fieldName]) `
          $fieldName `
          (Get-ObjectProperty $program $fieldName) `
          $DateFields `
          $NumberFields
        if ($result -eq "formula") {
          $formulaCellsPreserved += 1
        } else {
          $managedCellCount += 1
        }
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
      if ($emailMessageTemplateProvided) {
        if (Set-ProgramPromoMessageCell `
          $sheet `
          $targetRow `
          $emailMessageTemplateColumn `
          (Get-ObjectProperty $program "emailMessageTemplate") `
          -IndicatorText "Сообщ"
        ) {
          $emailMessageCount += 1
        }
      }
      $updatedCount += 1
    }
    $sortResult = Sort-ProgramRegistryRows `
      $sheet `
      ([int]$header.Row) `
      $startRow `
      $lastRow `
      $dataLastColumn `
      $nameColumn `
      $statusColumn
    $programByIdentity = @{}
    foreach ($record in @($programRecordByRow.Values)) {
      $identity = Get-ProgramWorkbookIdentity `
        (Get-ObjectProperty $record "name") `
        (Get-ObjectProperty $record "landingCode")
      if (-not $identity) {
        throw "После обновления реестра программ найдена запись без названия."
      }
      if ($programByIdentity.ContainsKey($identity)) {
        throw "После обновления реестра программ повторяется название и код лендинга."
      }
      $programByIdentity[$identity] = $record
    }
    $sortedRecordByRow = @{}
    $usedProgramIdentities = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $sortedIdentityRange = $null
    try {
      $sortedIdentityRange = $sheet.Range(
        $sheet.Cells.Item($startRow, 1),
        $sheet.Cells.Item($lastRow, [Math]::Max($nameColumn, $landingCodeColumn))
      )
      $sortedValues = $sortedIdentityRange.Value2
      for ($row = $startRow; $row -le $lastRow; $row += 1) {
        $offset = $row - $startRow + 1
        $identity = Get-ProgramWorkbookIdentity `
          (Get-MatrixValue $sortedValues $offset $nameColumn) `
          (Get-MatrixValue $sortedValues $offset $landingCodeColumn)
        if (-not $identity) { continue }
        if ($programByIdentity.ContainsKey($identity)) {
          $sortedRecordByRow[$row] = $programByIdentity[$identity]
          [void]$usedProgramIdentities.Add($identity)
        } elseif ($existingRecordByIdentity.ContainsKey($identity)) {
          $sortedRecordByRow[$row] = $existingRecordByIdentity[$identity]
        }
      }
    } finally {
      Release-ComObject $sortedIdentityRange
    }
    if ($usedProgramIdentities.Count -ne $programByIdentity.Count) {
      throw "После сортировки не удалось повторно сопоставить все программы Web со строками XLSB."
    }
    [void](Update-AisSyncMetadataForCurrentRows $sheet $sortedRecordByRow $startRow $lastRow 1)
    return [pscustomobject]@{
      Count = $programRecordByRow.Count
      Messages = $messageCount
      EmailMessages = $emailMessageCount
      ManagedCells = $managedCellCount
      FormulaCellsPreserved = $formulaCellsPreserved
      MissingManagedColumns = $missingManagedColumns
      MissingManagedColumnNames = @($missingManagedColumnNames | Sort-Object)
      Skipped = $skippedCount
      SkippedPrograms = @($skippedPrograms)
      InsertedRows = $insertedRows
      SortedRows = $sortResult.Rows
      ArchiveRows = $sortResult.ArchiveRows
      Provided = $true
    }
  } catch {
    throw "Ошибка обновления листа 'Реестр программ': $($_.Exception.Message)`n$($_.ScriptStackTrace)"
  } finally {
    Release-ComObject $dataRange
    Release-ComObject $sheet
  }
}

function ConvertTo-MacroSettingSingleLine {
  param([object]$Value)
  return (([string]$Value) -replace "[;\r\n\v]+", " ").Trim()
}

function ConvertTo-MacroSettingMultilineValue {
  param([object]$Value)
  $separator = "$([char]11)$([char]11)"
  return (([string]$Value).Trim() -replace "\r?\n", $separator)
}

function Set-MacroSettingTextValue {
  param(
    [string]$Text,
    [string]$Key,
    [string]$Value
  )
  $line = "$Key=$Value"
  $pattern = "(?m)^$([regex]::Escape($Key))=.*$"
  if ([regex]::IsMatch($Text, $pattern)) {
    return [regex]::Replace(
      $Text,
      $pattern,
      [Text.RegularExpressions.MatchEvaluator]{ param($match) return $line },
      1
    )
  }
  if (-not $Text) { return $line }
  return "$($Text.TrimEnd([char[]]"`r`n"))`r`n$line"
}

function ConvertTo-StudentEventMacroSettingValue {
  param([object[]]$Templates)
  $separator = "$([char]11)$([char]11)"
  $rows = foreach ($template in @($Templates)) {
    if ($null -eq $template) { continue }
    $label = ConvertTo-MacroSettingSingleLine (Get-ObjectProperty $template "label")
    if (-not $label) { continue }
    $conditions = [Collections.Generic.List[string]]::new()
    foreach ($type in @(Get-ObjectProperty $template "includeTypes")) {
      $normalized = ConvertTo-MacroSettingSingleLine $type
      if ($normalized -and -not $conditions.Contains($normalized)) { [void]$conditions.Add($normalized) }
    }
    foreach ($type in @(Get-ObjectProperty $template "excludeTypes")) {
      $normalized = ConvertTo-MacroSettingSingleLine $type
      if ($normalized -and -not $conditions.Contains("-$normalized")) { [void]$conditions.Add("-$normalized") }
    }
    @($label) + @($conditions) -join ";"
  }
  return (@($rows) -join $separator)
}

function ConvertTo-ContractEventMacroSettingValue {
  param([object[]]$Templates)
  $separator = "$([char]11)$([char]11)"
  return (@($Templates) | ForEach-Object {
    ConvertTo-MacroSettingSingleLine (Get-ObjectProperty $_ "label")
  } | Where-Object { $_ }) -join $separator
}

function Update-ProgramDictionaries {
  param(
    [object]$Workbook,
    [object]$Payload
  )
  if (-not [bool](Get-ObjectProperty $Payload "programDictionariesProvided")) {
    return [pscustomobject]@{ Provided = $false; Count = 0 }
  }
  $dictionaries = Get-ObjectProperty $Payload "programDictionaries"
  if ($null -eq $dictionaries) { throw "Не переданы справочники программ." }
  $definitions = @(
    [pscustomobject]@{ Key = "frdoProfessionalAreas"; Name = "Деятельность" },
    [pscustomobject]@{ Key = "economicActivities"; Name = "ВидыДеятПК1" }
  )
  $totalCount = 0
  foreach ($definition in $definitions) {
    $sheet = $null
    $definedName = $null
    $currentRange = $null
    $targetRange = $null
    $extraRange = $null
    try {
      $definedName = Get-WorkbookDefinedName $Workbook @($definition.Name)
      if ($null -eq $definedName) {
        throw "В книге не найден именованный диапазон '$($definition.Name)'."
      }
      try { $currentRange = $definedName.RefersToRange } catch {}
      if ($null -eq $currentRange) {
        throw "Именованный диапазон '$($definition.Name)' не указывает на ячейки."
      }
      $sheet = $currentRange.Worksheet
      $startRow = [int]$currentRange.Row
      $column = [int]$currentRange.Column
      $currentCount = [int]$currentRange.Rows.Count
      $values = @(
        @(Get-ObjectProperty $dictionaries $definition.Key) |
          ForEach-Object { ([string]$_).Trim() } |
          Where-Object { $_ }
      )
      $targetCount = [Math]::Max(1, $values.Count)
      if ($targetCount -gt $currentCount) {
        $extraRange = $sheet.Range(
          $sheet.Cells.Item($startRow + $currentCount, $column),
          $sheet.Cells.Item($startRow + $targetCount - 1, $column)
        )
        for ($offset = 1; $offset -le [int]$extraRange.Rows.Count; $offset += 1) {
          $extraCell = $null
          try {
            $extraCell = $extraRange.Cells.Item($offset, 1)
            if (
              ([string]$extraCell.Formula).StartsWith("=") `
              -or ([string]$extraCell.Value2).Trim()
            ) {
              throw "Нельзя расширить диапазон '$($definition.Name)': следующая ячейка уже занята."
            }
          } finally {
            Release-ComObject $extraCell
          }
        }
      }
      for ($offset = 1; $offset -le $currentCount; $offset += 1) {
        $currentCell = $null
        try {
          $currentCell = $currentRange.Cells.Item($offset, 1)
          if (([string]$currentCell.Formula).StartsWith("=")) {
            throw "Диапазон '$($definition.Name)' содержит формулу; книга не изменена."
          }
        } finally {
          Release-ComObject $currentCell
        }
      }
      $currentRange.ClearContents()
      $targetRange = $sheet.Range(
        $sheet.Cells.Item($startRow, $column),
        $sheet.Cells.Item($startRow + $targetCount - 1, $column)
      )
      for ($offset = 0; $offset -lt $values.Count; $offset += 1) {
        $targetCell = $null
        try {
          $targetCell = $targetRange.Cells.Item($offset + 1, 1)
          $targetCell.Value2 = [string]$values[$offset]
        } finally {
          Release-ComObject $targetCell
        }
      }
      $definedName.RefersTo = Get-ExcelRangeReference $sheet $targetRange
      $totalCount += $values.Count
    } catch {
      throw "Ошибка обновления справочника '$($definition.Name)': $($_.Exception.Message)"
    } finally {
      Release-ComObject $extraRange
      Release-ComObject $targetRange
      Release-ComObject $currentRange
      Release-ComObject $definedName
      Release-ComObject $sheet
    }
  }
  return [pscustomobject]@{ Provided = $true; Count = $totalCount }
}

function Update-MacroSettings {
  param(
    [object]$Workbook,
    [object]$Payload
  )
  $settings = Get-ObjectProperty $Payload "macroSettings"
  if ($null -eq $settings -or -not [bool](Get-ObjectProperty $settings "provided")) {
    return [pscustomobject]@{ Provided = $false; StudentEvents = 0; ContractEvents = 0; PaymentRules = 0 }
  }
  $definedName = $null
  $targetRange = $null
  $text = ""
  try {
    $definedName = Get-WorkbookDefinedName $Workbook @("НастройкиМакросов")
    if ($null -eq $definedName) { throw "В книге не найден именованный диапазон 'НастройкиМакросов'." }
    try { $targetRange = $definedName.RefersToRange } catch {}
    if ($null -eq $targetRange) { throw "Именованный диапазон 'НастройкиМакросов' не указывает на ячейку." }
    $text = [string]$targetRange.Value2
    $studentTemplates = @(Get-ObjectProperty $settings "studentEventTemplates")
    $contractTemplates = @(Get-ObjectProperty $settings "contractEventTemplates")
    $text = Set-MacroSettingTextValue $text "События" (ConvertTo-StudentEventMacroSettingValue $studentTemplates)
    $text = Set-MacroSettingTextValue $text "СобытияКонтрагент" (ConvertTo-ContractEventMacroSettingValue $contractTemplates)
    $paymentRuleCount = 0
    if (Test-ObjectProperty $settings "automaticExpenseRules") {
      $automaticExpenseRules = [string](Get-ObjectProperty $settings "automaticExpenseRules")
      $text = Set-MacroSettingTextValue $text "АвтоНазнОплат" (ConvertTo-MacroSettingMultilineValue $automaticExpenseRules)
      $paymentRuleCount = @($automaticExpenseRules -split "\r?\n" | Where-Object { $_.Trim() }).Count
    }

    $query = [string](Get-ObjectProperty $settings "applicationsSqlQuery")
    if ($query.Trim()) {
      $text = Set-MacroSettingTextValue $text "Магазин_SQL" (ConvertTo-MacroSettingMultilineValue $query)
    }
    foreach ($mapping in @(
      @("Магазин_SQL_сервер", "applicationsMysqlHost"),
      @("Магазин_SQL_база", "applicationsMysqlDatabase"),
      @("Магазин_SQL_пользователь", "applicationsMysqlUser"),
      @("Магазин_SQL_пароль", "applicationsMysqlPassword")
    )) {
      $value = [string](Get-ObjectProperty $settings $mapping[1])
      if ($value) { $text = Set-MacroSettingTextValue $text $mapping[0] $value }
    }
    while ($text.Length -gt 32767 -and $text.Contains("`r`n`r`n")) {
      $text = $text.Remove($text.IndexOf("`r`n`r`n"), 2)
    }
    if ($text.Length -gt 32767) {
      $overflow = $text.Length - 32767
      throw "Диапазон 'НастройкиМакросов' превышает предел Excel на $overflow символов. Сократите правила назначения оплат или SQL-запрос интернет-магазина."
    }
    $rowHeight = $null
    try { $rowHeight = $targetRange.EntireRow.RowHeight } catch {}
    try {
      $targetRange.Value2 = [object]$text
    } catch {
      # PowerShell may fail to marshal a near-limit (32767 chars) string through Value2.
      # FormulaLocal stores the same literal text because the value does not start with '='.
      $targetRange.FormulaLocal = [object]$text
    }
    if ($null -ne $rowHeight) {
      try { $targetRange.EntireRow.RowHeight = $rowHeight } catch {}
    }
    return [pscustomobject]@{
      Provided = $true
      StudentEvents = $studentTemplates.Count
      ContractEvents = $contractTemplates.Count
      PaymentRules = $paymentRuleCount
    }
  } catch {
    $textLength = if ($null -eq $text) { 0 } else { $text.Length }
    throw "Ошибка обновления диапазона 'НастройкиМакросов' (длина: $textLength): $($_.Exception.Message)"
  } finally {
    Release-ComObject $targetRange
    Release-ComObject $definedName
  }
}

function Update-AisSyncMetadataOnlyWorkbook {
  param(
    [object]$Workbook,
    [object]$Payload
  )
  $rows = @(Get-ObjectProperty $Payload "syncMetadataRows")
  if ($rows.Count -eq 0) { $rows = @(Get-ObjectProperty $Payload "syncCommentRows") }
  $sheetDefinitions = @(Get-ObjectProperty $Payload "syncMetadataSheets")
  if ($sheetDefinitions.Count -eq 0) {
    $sheetDefinitions = @(Get-ObjectProperty $Payload "syncCommentSheets")
  }
  if ($sheetDefinitions.Count -eq 0) { throw "Не передан список управляемых листов AIS_SYNC." }
  $usedCells = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  $usedRecordIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  $entityBySheet = @{}
  $entriesBySheet = @{}
  $targetRecordIdsBySheet = @{}
  foreach ($definition in $sheetDefinitions) {
    $definedSheetName = ([string](Get-ObjectProperty $definition "sheetName")).Trim()
    $definedEntity = ([string](Get-ObjectProperty $definition "entity")).Trim()
    if (-not $definedSheetName -or -not $definedEntity -or $entityBySheet.ContainsKey($definedSheetName)) {
      throw "Некорректный список управляемых листов AIS_SYNC."
    }
    $entityBySheet[$definedSheetName] = $definedEntity
    $entriesBySheet[$definedSheetName] = [Collections.Generic.List[object]]::new()
    $targetRecordIdsBySheet[$definedSheetName] = (
      [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    )
  }
  $updated = 0
  $removed = 0
  for ($index = 0; $index -lt $rows.Count; $index += 1) {
    $entry = $rows[$index]
    $sheetName = ([string](Get-ObjectProperty $entry "sheetName")).Trim()
    $entity = ([string](Get-ObjectProperty $entry "entity")).Trim()
    $recordId = ([string](Get-ObjectProperty $entry "recordId")).Trim()
    $row = [int](Get-ObjectProperty $entry "row")
    $metadata = ([string](Get-ObjectProperty $entry "metadata")).Trim()
    if (-not $sheetName -or -not $entity -or -not $recordId -or $row -lt 2 -or -not $metadata) {
      throw "Некорректная строка плана служебных свойств № $($index + 1)."
    }
    if (-not $entityBySheet.ContainsKey($sheetName) -or $entityBySheet[$sheetName] -ne $entity) {
      throw "Строка $row указывает на неуправляемый лист или тип AIS_SYNC '$sheetName' / '$entity'."
    }
    $parsed = Get-AisSyncMetadataObject $metadata
    if (
      ([string](Get-ObjectProperty $parsed "entity")).Trim() -ne $entity `
      -or ([string](Get-ObjectProperty $parsed "recordId")).Trim() -ne $recordId
    ) {
      throw "Содержимое метки AIS_SYNC не совпадает с планом для строки $row листа '$sheetName'."
    }
    $cellKey = "$sheetName$([char]0)$row"
    $recordKey = "$entity$([char]0)$recordId"
    if (-not $usedCells.Add($cellKey)) {
      throw "Для строки $row листа '$sheetName' передано несколько меток AIS_SYNC."
    }
    if (-not $usedRecordIds.Add($recordKey)) {
      throw "В плане примечаний повторяется служебный ID '$recordId'."
    }
    [void]($targetRecordIdsBySheet[$sheetName].Add($recordId))
    [void]$entriesBySheet[$sheetName].Add($entry)
  }

  foreach ($definition in $sheetDefinitions) {
    $sheetName = ([string](Get-ObjectProperty $definition "sheetName")).Trim()
    $entity = [string]$entityBySheet[$sheetName]
    $sheet = $null
    try {
      $sheet = $Workbook.Worksheets.Item($sheetName)
      $humanTextByRecordId = @{}
      $unmanagedHumanTextByRow = @{}
      $sourceComments = $null
      try {
        $sourceComments = $sheet.Comments
        for ($commentIndex = 1; $commentIndex -le [int]$sourceComments.Count; $commentIndex += 1) {
          $sourceComment = $null
          $sourceParent = $null
          try {
            $sourceComment = $sourceComments.Item($commentIndex)
            $sourceParent = $sourceComment.Parent
            $sourceRow = [int]$sourceParent.Row
            if ([int]$sourceParent.Column -ne 1 -or $sourceRow -lt 2) { continue }
            $sourceText = try {
              [string]$sourceComment.Text()
            } catch {
              [string]$sourceComment.Text
            }
            $sourceHumanText = Get-AisSyncHumanCommentText $sourceText
            $sourceMetadata = Get-AisSyncCellMetadata $sourceParent $entity
            if ($null -ne $sourceMetadata) {
              $sourceRecordId = ([string](Get-ObjectProperty $sourceMetadata "recordId")).Trim()
              if ($humanTextByRecordId.ContainsKey($sourceRecordId)) {
              throw "В служебных свойствах листа '$sheetName' повторяется ID '$sourceRecordId'."
              }
              $humanTextByRecordId[$sourceRecordId] = $sourceHumanText
            } elseif ($sourceHumanText) {
              $unmanagedHumanTextByRow[$sourceRow] = $sourceHumanText
            }
          } finally {
            Release-ComObject $sourceParent
            Release-ComObject $sourceComment
          }
        }
      } finally {
        Release-ComObject $sourceComments
      }

      foreach ($entry in @($entriesBySheet[$sheetName])) {
        $row = [int](Get-ObjectProperty $entry "row")
        $recordId = ([string](Get-ObjectProperty $entry "recordId")).Trim()
        $metadata = ([string](Get-ObjectProperty $entry "metadata")).Trim()
        $cell = $null
        try {
          $cell = $sheet.Cells.Item($row, 1)
          $humanText = if ($humanTextByRecordId.ContainsKey($recordId)) {
            [string]$humanTextByRecordId[$recordId]
          } elseif ($unmanagedHumanTextByRow.ContainsKey($row)) {
            [string]$unmanagedHumanTextByRow[$row]
          } else {
            ""
          }
          if (Set-AisSyncCommentCell $cell "" -HumanText $humanText -UseProvidedHumanText) {
            $updated += 1
          }
          if (Set-AisSyncValidationCell $cell $metadata) {
            $updated += 1
          }
        } finally {
          Release-ComObject $cell
        }
      }

      $comments = $null
      try {
        $comments = $sheet.Comments
        for ($commentIndex = [int]$comments.Count; $commentIndex -ge 1; $commentIndex -= 1) {
          $comment = $null
          $parent = $null
          try {
            $comment = $comments.Item($commentIndex)
            $parent = $comment.Parent
            $commentRow = [int]$parent.Row
            if ([int]$parent.Column -ne 1 -or $commentRow -lt 2) { continue }
            $cellKey = "$sheetName$([char]0)$commentRow"
            if ($usedCells.Contains($cellKey)) { continue }
            $commentText = try { [string]$comment.Text() } catch { [string]$comment.Text }
            if (
              -not $commentText.Contains("[[AIS_SYNC_V1]]") `
              -and -not $commentText.Contains("[[/AIS_SYNC_V1]]")
            ) { continue }
            $staleMetadata = Get-AisSyncCellMetadata $parent $entity
            $staleRecordId = if ($null -ne $staleMetadata) {
              ([string](Get-ObjectProperty $staleMetadata "recordId")).Trim()
            } else {
              ""
            }
            if (
              $staleRecordId `
              -and $targetRecordIdsBySheet[$sheetName].Contains($staleRecordId)
            ) {
              if (
                Set-AisSyncCommentCell $parent "" -HumanText "" -UseProvidedHumanText
              ) { $removed += 1 }
            } elseif (Set-AisSyncCommentCell $parent "") {
              $removed += 1
            }
          } finally {
            Release-ComObject $parent
            Release-ComObject $comment
          }
        }
      } finally {
        Release-ComObject $comments
      }

      $usedRange = $null
      try {
        $usedRange = $sheet.UsedRange
        $lastUsedRow = [Math]::Max(2, [int]$usedRange.Row + [int]$usedRange.Rows.Count - 1)
        foreach ($entry in @($entriesBySheet[$sheetName])) {
          $lastUsedRow = [Math]::Max($lastUsedRow, [int](Get-ObjectProperty $entry "row"))
        }
        for ($row = 2; $row -le $lastUsedRow; $row += 1) {
          $cellKey = "$sheetName$([char]0)$row"
          if ($usedCells.Contains($cellKey)) { continue }
          $cell = $null
          try {
            $cell = $sheet.Cells.Item($row, 1)
            if ($null -eq (Get-AisSyncValidationMetadata $cell $entity)) { continue }
            if (Set-AisSyncValidationCell $cell "") { $removed += 1 }
          } finally {
            Release-ComObject $cell
          }
        }
      } finally {
        Release-ComObject $usedRange
      }
    } finally {
      Release-ComObject $sheet
    }
  }
  return [pscustomobject]@{ Count = $updated; Requested = $rows.Count; Removed = $removed }
}

function Read-AisSyncValidationMetadataWorkbook {
  param(
    [object]$Workbook,
    [object]$Payload
  )
  $sheetDefinitions = @(Get-ObjectProperty $Payload "syncMetadataSheets")
  if ($sheetDefinitions.Count -eq 0) {
    $sheetDefinitions = @(Get-ObjectProperty $Payload "syncCommentSheets")
  }
  if ($sheetDefinitions.Count -eq 0) { throw "Не передан список управляемых листов AIS_SYNC." }

  $rows = [Collections.Generic.List[object]]::new()
  $usedRecordIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($definition in $sheetDefinitions) {
    $sheetName = ([string](Get-ObjectProperty $definition "sheetName")).Trim()
    $entity = ([string](Get-ObjectProperty $definition "entity")).Trim()
    if (-not $sheetName -or -not $entity) { throw "Некорректный список управляемых листов AIS_SYNC." }
    $sheet = $null
    $usedRange = $null
    $firstColumnRange = $null
    $validationCells = $null
    $validationAreas = $null
    try {
      $sheet = $Workbook.Worksheets.Item($sheetName)
      $usedRange = $sheet.UsedRange
      $lastUsedRow = [Math]::Max(2, [int]$usedRange.Row + [int]$usedRange.Rows.Count - 1)
      $firstColumnRange = $sheet.Range($sheet.Cells.Item(2, 1), $sheet.Cells.Item($lastUsedRow, 1))
      try { $validationCells = $firstColumnRange.SpecialCells(-4174) } catch { $validationCells = $null }
      if ($null -eq $validationCells) { continue }
      $validationAreas = $validationCells.Areas
      for ($areaIndex = 1; $areaIndex -le [int]$validationAreas.Count; $areaIndex += 1) {
        $area = $null
        $areaCells = $null
        try {
          $area = $validationAreas.Item($areaIndex)
          $areaCells = $area.Cells
          for ($index = 1; $index -le [int]$areaCells.Count; $index += 1) {
            $cell = $null
            try {
              $cell = $areaCells.Item($index)
              $row = [int]$cell.Row
              $metadata = Get-AisSyncValidationMetadata $cell $entity
              if ($null -eq $metadata) { continue }
              $recordId = ([string](Get-ObjectProperty $metadata "recordId")).Trim()
              $recordKey = "$entity$([char]0)$recordId"
              if (-not $usedRecordIds.Add($recordKey)) {
                throw "В свойствах проверки данных повторяется служебный ID '$recordId' типа '$entity'."
              }
              [void]$rows.Add([pscustomobject]@{
                sheetName = $sheetName
                row = $row
                entity = $entity
                metadata = ($metadata | ConvertTo-Json -Compress -Depth 6)
              })
            } finally {
              Release-ComObject $cell
            }
          }
        } finally {
          Release-ComObject $areaCells
          Release-ComObject $area
        }
      }
    } finally {
      Release-ComObject $validationAreas
      Release-ComObject $validationCells
      Release-ComObject $firstColumnRange
      Release-ComObject $usedRange
      Release-ComObject $sheet
    }
  }
  return @($rows)
}

function Assert-AisSyncValidationMetadataWorkbook {
  param(
    [object]$Workbook,
    [object]$Payload
  )
  $expectedRows = @(Get-ObjectProperty $Payload "syncMetadataRows")
  if ($expectedRows.Count -eq 0) { $expectedRows = @(Get-ObjectProperty $Payload "syncCommentRows") }
  $actualRows = @(Read-AisSyncValidationMetadataWorkbook $Workbook $Payload)
  $actualByCell = @{}
  foreach ($actual in $actualRows) {
    $key = "$([string](Get-ObjectProperty $actual "sheetName"))$([char]0)$([int](Get-ObjectProperty $actual "row"))"
    $actualByCell[$key] = Get-AisSyncMetadataObject (Get-ObjectProperty $actual "metadata")
  }
  foreach ($expected in $expectedRows) {
    $sheetName = ([string](Get-ObjectProperty $expected "sheetName")).Trim()
    $row = [int](Get-ObjectProperty $expected "row")
    $key = "$sheetName$([char]0)$row"
    if (-not $actualByCell.ContainsKey($key)) {
      throw "Служебное свойство AIS_SYNC не записано в ячейку '$sheetName!A$row'."
    }
    $expectedMetadata = Get-AisSyncMetadataObject (Get-ObjectProperty $expected "metadata")
    $actualMetadata = $actualByCell[$key]
    foreach ($propertyName in @("entity", "recordId", "parentRecordId", "syncedAt")) {
      if (
        ([string](Get-ObjectProperty $expectedMetadata $propertyName)).Trim() `
        -ne ([string](Get-ObjectProperty $actualMetadata $propertyName)).Trim()
      ) {
        throw "Служебное свойство AIS_SYNC в ячейке '$sheetName!A$row' записано некорректно."
      }
    }
    [void]$actualByCell.Remove($key)
  }
  if ($actualByCell.Count -gt 0) {
    throw "В книге остались лишние служебные свойства AIS_SYNC: $($actualByCell.Count)."
  }
  return $actualRows.Count
}

$excel = $null
$workbook = $null
$ownedExcelProcessId = 0
$ownedExcelProcessPidPath = ([string]$env:AIS_SYNC_EXCEL_PID_PATH).Trim()
try {
  Write-SyncProgress 1 "Чтение данных веб-базы..."
  $payload = Get-Content -LiteralPath $PayloadPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $readSyncMetadataOnly = [bool](Get-ObjectProperty $payload "readSyncMetadataOnly")
  $dateFields = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($field in @(Get-ObjectProperty $payload "studentDateFields")) { [void]$dateFields.Add([string]$field) }
  foreach ($field in @(Get-ObjectProperty $payload "contractDateFields")) { [void]$dateFields.Add([string]$field) }
  foreach ($field in @(Get-ObjectProperty $payload "inventoryDateFields")) { [void]$dateFields.Add([string]$field) }
  foreach ($field in @(Get-ObjectProperty $payload "programDateFields")) { [void]$dateFields.Add([string]$field) }
  [void]$dateFields.Add("date")
  [void]$dateFields.Add("paid")
  $numberFields = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($field in @(Get-ObjectProperty $payload "studentNumberFields")) { [void]$numberFields.Add([string]$field) }
  foreach ($field in @(Get-ObjectProperty $payload "contractNumberFields")) { [void]$numberFields.Add([string]$field) }
  foreach ($field in @(Get-ObjectProperty $payload "inventoryNumberFields")) { [void]$numberFields.Add([string]$field) }
  foreach ($field in @(Get-ObjectProperty $payload "trainingPlanNumberFields")) { [void]$numberFields.Add([string]$field) }
  foreach ($field in @(Get-ObjectProperty $payload "programNumberFields")) { [void]$numberFields.Add([string]$field) }
  [void]$numberFields.Add("amount")

  Write-SyncProgress 3 "Запуск Microsoft Excel..."
  $excelProcessIdsBefore = [Collections.Generic.HashSet[int]]::new()
  @(Get-Process -Name EXCEL -ErrorAction SilentlyContinue).ForEach({
    [void]$excelProcessIdsBefore.Add([int]$_.Id)
  })
  $excel = New-Object -ComObject Excel.Application
  $excelProcessId = Get-ExcelApplicationProcessId $excel
  if ($excelProcessId -le 0 -or $excelProcessIdsBefore.Contains($excelProcessId)) {
    $newExcelProcesses = @(Get-Process -Name EXCEL -ErrorAction SilentlyContinue | Where-Object {
      -not $excelProcessIdsBefore.Contains([int]$_.Id)
    } | Sort-Object StartTime -Descending)
    if ($newExcelProcesses.Count -eq 1) {
      $excelProcessId = [int]$newExcelProcesses[0].Id
    }
  }
  if ($excelProcessId -gt 0 -and -not $excelProcessIdsBefore.Contains($excelProcessId)) {
    $ownedExcelProcessId = $excelProcessId
  }
  if ($ownedExcelProcessId -gt 0 -and $ownedExcelProcessPidPath) {
    [IO.File]::WriteAllText(
      $ownedExcelProcessPidPath,
      [string]$ownedExcelProcessId,
      [Text.Encoding]::ASCII
    )
  }
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.EnableEvents = $false
  $excel.AskToUpdateLinks = $false
  $excel.AutomationSecurity = 3
  $workbook = $excel.Workbooks.Open($InputPath, 0, $readSyncMetadataOnly)
  # Hundreds of mapped columns are updated in batches. Automatic calculation
  # after every batch makes a full XLSB synchronization take many minutes;
  # calculate once, immediately before SaveAs, instead.
  try { $excel.Calculation = -4135 } catch {} # xlCalculationManual

  if ($readSyncMetadataOnly) {
    Write-SyncProgress 30 "Чтение стабильных ID из свойств проверки данных..."
    $metadataRows = @(Read-AisSyncValidationMetadataWorkbook $workbook $payload)
    Write-SyncProgress 100 "Стабильные ID прочитаны."
    [pscustomobject]@{
      type = "result"
      readSyncMetadataOnly = $true
      syncMetadataRows = $metadataRows
      syncMetadataCount = $metadataRows.Count
    } | ConvertTo-Json -Compress -Depth 8 | Write-Output
    return
  }

  if (
    [bool](Get-ObjectProperty $payload "syncMetadataOnly") `
    -or [bool](Get-ObjectProperty $payload "commentOnly")
  ) {
    Write-SyncProgress 20 "Запись стабильных ID в свойства проверки данных первого столбца..."
    $metadataResult = Update-AisSyncMetadataOnlyWorkbook $workbook $payload
    $verifiedMetadataCount = Assert-AisSyncValidationMetadataWorkbook $workbook $payload
    Write-SyncProgress 95 "Сохранение книги со служебными свойствами AIS_SYNC..."
    $workbook.SaveAs($OutputPath, 50)
    $verifiedMetadataCount = Assert-AisSyncValidationMetadataWorkbook $workbook $payload
    Write-SyncProgress 100 "Служебные свойства AIS_SYNC сохранены."
    [pscustomobject]@{
      type = "result"
      syncMetadataOnly = $true
      syncMetadata = $metadataResult.Count
      requestedSyncMetadata = $metadataResult.Requested
      verifiedSyncMetadata = $verifiedMetadataCount
      removedSyncMetadata = $metadataResult.Removed
      syncComments = $metadataResult.Count
      requestedSyncComments = $metadataResult.Requested
      removedSyncComments = $metadataResult.Removed
      outputPath = $OutputPath
    } | ConvertTo-Json -Compress -Depth 6 | Write-Output
    return
  }

  Write-SyncProgress 7 "Книга открыта. Обновление ставок агентских выплат..."
  $agentRateResult = Update-AgentPaymentRates `
    $workbook `
    (Get-ObjectProperty $payload "agentPaymentRates")
  Write-SyncProgress 7 "Проверка событий, правил оплаты и настроек интернет-магазина..."
  $macroSettingsResult = Update-MacroSettings $workbook $payload
  Write-SyncProgress 7 "Обновление полей шаблонов типовых сообщений..."
  $communicationTemplateResult = Update-CommunicationTemplateNamedRanges $workbook $payload
  Write-SyncProgress 7 "Обновление справочников программ..."
  $programDictionaryResult = Update-ProgramDictionaries $workbook $payload
  Write-SyncProgress 8 "Обновление слушателей..."
  $studentResult = Update-StudentSheet $workbook $payload $dateFields $numberFields
  $expenseResult = Update-DirectExpenseSheet $workbook $payload $dateFields $numberFields
  $generalExpenseResult = Update-GeneralExpenseSheet $workbook $payload $dateFields $numberFields
  $contractResult = Update-ContractSheet $workbook $payload $dateFields $numberFields
  Write-SyncProgress 94 "Обновление запасов..."
  $inventoryResult = Update-InventorySheet $workbook $payload $dateFields $numberFields
  Write-SyncProgress 95 "Обновление учебных планов..."
  $trainingPlanResult = Update-TrainingPlanSheet $workbook $payload $dateFields $numberFields
  Write-SyncProgress 95 "Обновление реестра программ..."
  $programPromoResult = Update-ProgramPromoMessages $workbook $payload $dateFields $numberFields
  Write-SyncProgress 96 "Обновление ставок и констант оплаты..."
  $paymentResult = Update-PaymentSettings $workbook $payload

  Write-SyncProgress 97 "Сохранение обновлённой книги..."
  try { $workbook.ForceFullCalculation = $true } catch {}
  try { $workbook.FullCalculationOnLoad = $true } catch {}
  try { $workbook.CalculateBeforeSave = $true } catch {}
  try {
    $excel.CalculateFullRebuild()
  } catch {
    try { $workbook.Calculate() } catch {}
  }
  $workbook.SaveAs($OutputPath, 50)
  Write-SyncProgress 100 "Книга сохранена."

  [pscustomobject]@{
    type = "result"
    students = $studentResult.Count
    studentSyncComments = $studentResult.SyncCommentCount
    agentFormulaCount = $studentResult.AgentFormulaCount
    agentFormulaSkippedUnknownCount = $studentResult.AgentFormulaSkippedUnknownCount
    agentFormulaPreservedConstantCount = $studentResult.AgentFormulaPreservedConstantCount
    contracts = $contractResult.Count
    contractMaxRowHeightPoints = $contractResult.MaxRowHeightPoints
    directExpenses = $expenseResult.Count
    generalExpenses = $generalExpenseResult.Count
    programs = $programPromoResult.Count
    programManagedCells = $programPromoResult.ManagedCells
    programFormulaCellsPreserved = $programPromoResult.FormulaCellsPreserved
    programMissingManagedColumns = $programPromoResult.MissingManagedColumns
    programMissingManagedColumnNames = @($programPromoResult.MissingManagedColumnNames)
    programPromoMessages = $programPromoResult.Messages
    programEmailMessages = $programPromoResult.EmailMessages
    programPromoSkipped = $programPromoResult.Skipped
    programPromoSkippedDetails = @($programPromoResult.SkippedPrograms)
    programRowsInserted = $programPromoResult.InsertedRows
    programRowsSorted = $programPromoResult.SortedRows
    programArchiveRows = $programPromoResult.ArchiveRows
    programDictionaryValues = $programDictionaryResult.Count
    inventoryItems = $inventoryResult.Items
    inventoryUnits = $inventoryResult.Units
    inventoryRowsInserted = $inventoryResult.InsertedRows
    trainingPlans = $trainingPlanResult.Count
    trainingPlanRowsInserted = $trainingPlanResult.InsertedRows
    trainingPlanRowsCleared = $trainingPlanResult.ClearedRows
    studentEventTemplates = $macroSettingsResult.StudentEvents
    contractEventTemplates = $macroSettingsResult.ContractEvents
    automaticExpenseRules = $macroSettingsResult.PaymentRules
    macroSettingsUpdated = $macroSettingsResult.Provided
    communicationTemplateNamedRangesRequested = $communicationTemplateResult.Requested
    communicationTemplateNamedRanges = $communicationTemplateResult.Updated
    communicationTemplateNamedRangesSkipped = $communicationTemplateResult.Skipped
    communicationTemplateNamedRangeFormulasPreserved = $communicationTemplateResult.FormulaPreserved
    communicationTemplateNamedRangeNames = @($communicationTemplateResult.UpdatedNames)
    communicationTemplateMissingNamedRangeNames = @($communicationTemplateResult.MissingNames)
    paymentConstants = $paymentResult.Count
    agentPaymentRates = [pscustomobject]@{
      withAuthorPercent = $agentRateResult.WithAuthorPercent
      withoutAuthorPercent = $agentRateResult.WithoutAuthorPercent
    }
    outputPath = $OutputPath
  } | ConvertTo-Json -Compress -Depth 6 | Write-Output
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
  if ($ownedExcelProcessId -gt 0) {
    $ownedExcelProcess = Get-Process -Id $ownedExcelProcessId -ErrorAction SilentlyContinue
    if ($null -ne $ownedExcelProcess) {
      try { [void]$ownedExcelProcess.WaitForExit(3000) } catch {}
      if (-not $ownedExcelProcess.HasExited) {
        Stop-Process -Id $ownedExcelProcessId -Force -ErrorAction SilentlyContinue
        Wait-Process -Id $ownedExcelProcessId -Timeout 5 -ErrorAction SilentlyContinue
      }
    }
  }
  if ($ownedExcelProcessPidPath) {
    Remove-Item -LiteralPath $ownedExcelProcessPidPath -Force -ErrorAction SilentlyContinue
  }
}

# Windows/Excel integration regression. Uses only a new synthetic workbook;
# never opens the production database or attaches to an existing Excel session.
param([switch]$SkipExcel)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$syncScriptPath = Join-Path $PSScriptRoot "sync-student-database.ps1"
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($syncScriptPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
foreach ($statement in $ast.EndBlock.Statements) {
  if ($statement -is [Management.Automation.Language.FunctionDefinitionAst]) {
    . ([ScriptBlock]::Create($statement.Extent.Text))
  }
}

function Assert-Equal {
  param([object]$Actual, [object]$Expected, [string]$Label)
  if ($Actual -cne $Expected) { throw "${Label}: expected [$Expected], got [$Actual]." }
}

Add-Type -TypeDefinition @"
public class AisProgramTestCell {
  public string FormulaR1C1 = "=stale";
}
public class AisProgramTestCells {
  public AisProgramTestCell[] Items;
  public AisProgramTestCells(int count) {
    Items = new AisProgramTestCell[count];
    for (int i = 0; i < count; i++) Items[i] = new AisProgramTestCell();
  }
  public AisProgramTestCell Item(int row, int column) {
    if (row != 1) throw new System.ArgumentOutOfRangeException("row");
    return Items[column - 1];
  }
}
public class AisProgramTestRange {
  public AisProgramTestCells Cells;
  public int ClearCount;
  public AisProgramTestRange(int count) { Cells = new AisProgramTestCells(count); }
  public void ClearContents() {
    ClearCount++;
    foreach (var cell in Cells.Items) cell.FormulaR1C1 = "";
  }
  public object FormulaR1C1 {
    set { throw new System.InvalidCastException("Bulk FormulaR1C1 assignment is not supported."); }
  }
}
"@

# Force the scalar-only binding even on Excel versions where bulk assignment
# happens to work. Cover both COM (one-based) and cached (zero-based) matrices.
foreach ($lowerBound in @(0, 1)) {
  $matrix = [Array]::CreateInstance([object], [int[]]@(1, 6), [int[]]@($lowerBound, $lowerBound))
  $formulas = @("=RC[1]*2", $null, "=0", 0, "not a formula", "")
  for ($index = 0; $index -lt $formulas.Count; $index++) {
    $matrix.SetValue($formulas[$index], $lowerBound, $lowerBound + $index)
  }
  $testRange = [AisProgramTestRange]::new(6)
  Set-ProgramTemplateFormulas $testRange $matrix 6
  Assert-Equal $testRange.ClearCount 1 "clear copied contents once"
  $expectedFormulas = @("=RC[1]*2", "", "=0", "", "", "")
  for ($index = 0; $index -lt $expectedFormulas.Count; $index++) {
    Assert-Equal $testRange.Cells.Items[$index].FormulaR1C1 $expectedFormulas[$index] "cached formula $index"
  }
}
$testRange = [AisProgramTestRange]::new(1)
Set-ProgramTemplateFormulas $testRange "=1+1" 1
Assert-Equal $testRange.Cells.Items[0].FormulaR1C1 "=1+1" "scalar template"
Set-ProgramTemplateFormulas $testRange $null 1
Assert-Equal $testRange.Cells.Items[0].FormulaR1C1 "" "empty template clears stale formulas"
Write-Output "Scalar-only formula binding and zero-/one-based template matrices: OK"
if ($SkipExcel) { return }

function Assert-TestPrograms {
  param([object]$Workbook, [string]$NumberFormat, [double]$RowHeight)
  $sheet = $Workbook.Worksheets.Item("Реестр программ")
  $range = $null
  try {
    $range = $sheet.Range("A2:K5")
    $values = $range.Value2
    $formulas = $range.FormulaR1C1
    $expected = @{
      "Базовая программа" = @{ hours = 72; formula = $false; author = "Автор исходной программы"; reserve = "0" }
      "Я Новая программа" = @{ hours = 80; formula = $true; author = ""; reserve = "" }
      "А Новая программа" = @{ hours = 96; formula = $false; author = ""; reserve = "" }
      "М Новая программа" = @{ hours = 30; formula = $true; author = ""; reserve = "" }
    }
    $seen = [Collections.Generic.HashSet[string]]::new()
    for ($offset = 1; $offset -le 4; $offset++) {
      $name = [string](Get-MatrixValue $values $offset 1)
      if (-not $expected.ContainsKey($name) -or -not $seen.Add($name)) {
        throw "Unexpected or duplicate program after sorting: $name"
      }
      $entry = $expected[$name]
      Assert-Equal (Get-MatrixValue $values $offset 4) $entry.hours "$name hours"
      $hoursFormula = [string](Get-MatrixValue $formulas $offset 4)
      Assert-Equal $hoursFormula.StartsWith("=") $entry.formula "$name formula/fixed value"
      if ($entry.formula) { Assert-Equal $hoursFormula "=RC[1]*2" "$name relative formula" }
      Assert-Equal ([string](Get-MatrixValue $values $offset 2)) $entry.author "$name copied constant"
      Assert-Equal ([string](Get-MatrixValue $values $offset 11)) $entry.reserve "$name zero/empty constant"
      Assert-Equal ([string](Get-MatrixValue $formulas $offset 10)) "=LEN(RC[-9])" "$name unmanaged formula"
      Assert-Equal (Get-MatrixValue $values $offset 10) $name.Length "$name recalculation"
      $cell = $sheet.Cells.Item($offset + 1, 4)
      try {
        Assert-Equal $cell.NumberFormat $NumberFormat "$name number format"
        Assert-Equal $cell.RowHeight $RowHeight "$name row height"
      } finally { Release-ComObject $cell }
      $cell = $sheet.Cells.Item($offset + 1, 7)
      try {
        $message = if ($name -eq "Я Новая программа") { "Новое промосообщение" } elseif ($name -eq "Базовая программа") { "Исходное промосообщение" } else { "" }
        Assert-Equal (Get-CellCommentText $cell) $message "$name promo comment"
      } finally { Release-ComObject $cell }
    }
    Assert-Equal $seen.Count 4 "program count"
  } finally {
    Release-ComObject $range
    Release-ComObject $sheet
  }
}

$temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ("ais-program-insert-test-" + [guid]::NewGuid().ToString("N"))
$temporaryWorkbook = Join-Path $temporaryDirectory "synthetic-programs.xlsb"
$excel = $null
$workbooks = $null
$workbook = $null
$sheet = $null
$range = $null
$cell = $null
try {
  [void](New-Item -ItemType Directory -Path $temporaryDirectory)
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.EnableEvents = $false
  $excel.AskToUpdateLinks = $false
  $excel.AutomationSecurity = 3
  $workbooks = $excel.Workbooks
  $workbook = $workbooks.Add()
  $sheet = $workbook.Worksheets.Item(1)
  $sheet.Name = "Реестр программ"
  $headers = @("Наименование программы", "Автор", "Код лендинга", "Часы", "Стоимость", "Статус", "Промосообщение1", "Промосообщение2", "СообщПочты", "Контроль", "Резерв")
  $seedValues = New-Object 'object[,]' 2, $headers.Count
  $seedProgram = @("Базовая программа", "Автор исходной программы", "base", "=E2*2", 21, "Действующая", $null, $null, $null, "=LEN(A2)", 0)
  for ($index = 0; $index -lt $headers.Count; $index++) {
    $seedValues[0, $index] = $headers[$index]
    $seedValues[1, $index] = $seedProgram[$index]
  }
  $range = $sheet.Range("A1:K2")
  $range.Formula = $seedValues
  Release-ComObject $range
  $range = $null
  [void](Set-ProgramPromoMessageCell $sheet 2 7 "Исходное промосообщение")
  $cell = $sheet.Cells.Item(2, 4)
  $numberFormat = $cell.NumberFormat
  $rowHeight = $cell.RowHeight
  Release-ComObject $cell
  $cell = $null
  Release-ComObject $sheet
  $sheet = $null

  $payload = [pscustomobject]@{
    programPromoMessagesProvided = $true
    programColumnMap = [pscustomobject]@{
      "Автор" = "author"; "Код лендинга" = "landingCode"; "Часы" = "hours"; "Стоимость" = "price"
      "Статус" = "status"; "Промосообщение1" = "promoMessage1"; "Промосообщение2" = "promoMessage2"
      "СообщПочты" = "emailMessageTemplate"; "Контроль" = "control"; "Резерв" = "reserve"
    }
    programs = @(
      [pscustomobject]@{
        name = "Базовая программа"; landingCode = "base"; hours = "72"; price = "21"
        providedFields = @("name", "landingCode", "hours", "price")
        databaseFixedValueOverrides = @("hours")
      },
      [pscustomobject]@{
        name = "Я Новая программа"; landingCode = "new-1"; hours = "999"; price = "40"
        providedFields = @("name", "landingCode", "hours", "price")
        promoMessage1Provided = $true; promoMessage1 = "Новое промосообщение"
      },
      [pscustomobject]@{
        name = "А Новая программа"; landingCode = "new-2"; hours = "96"; price = "60"
        providedFields = @("name", "landingCode", "hours", "price")
        databaseFixedValueOverrides = @("hours")
      },
      [pscustomobject]@{
        name = "М Новая программа"; landingCode = "new-3"; price = "15"
        providedFields = @("name", "landingCode", "price")
      }
    )
  }
  $dateFields = [Collections.Generic.HashSet[string]]::new()
  $numberFields = [Collections.Generic.HashSet[string]]::new([string[]]@("hours", "price"))
  $result = Update-ProgramPromoMessages $workbook $payload $dateFields $numberFields
  Assert-Equal $result.InsertedRows 3 "inserted programs"
  Assert-Equal $result.Count 4 "updated programs"
  Assert-Equal $result.FormulaCellsPreserved 1 "preserved managed formulas"
  Assert-Equal $result.FormulaCellsReplaced 2 "fixed Web overrides"
  $excel.Calculate()
  Assert-TestPrograms $workbook $numberFormat $rowHeight

  # Check the persisted XLSB, not just the live COM values.
  $workbook.SaveAs($temporaryWorkbook, 50)
  $workbook.Close($false)
  Release-ComObject $workbook
  $workbook = $workbooks.Open($temporaryWorkbook, 0, $false)
  $excel.Calculate()
  Assert-TestPrograms $workbook $numberFormat $rowHeight
  $result = Update-ProgramPromoMessages $workbook $payload $dateFields $numberFields
  Assert-Equal $result.InsertedRows 0 "repeat sync must not duplicate programs"
  $excel.Calculate()
  Assert-TestPrograms $workbook $numberFormat $rowHeight
  Write-Output "Program insertion, original R1C1 formulas, fixed Web values, comments, styles, XLSB roundtrip and repeat sync: OK"
} finally {
  Release-ComObject $cell
  Release-ComObject $range
  Release-ComObject $sheet
  if ($null -ne $workbook) { try { $workbook.Close($false) } catch {} }
  Release-ComObject $workbook
  Release-ComObject $workbooks
  if ($null -ne $excel) { try { $excel.Quit() } catch {} }
  Release-ComObject $excel
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
  # Delete only the synthetic file we created, never a workbook supplied by a user.
  if (Test-Path -LiteralPath $temporaryWorkbook) { Remove-Item -LiteralPath $temporaryWorkbook -Force }
  if (Test-Path -LiteralPath $temporaryDirectory) { Remove-Item -LiteralPath $temporaryDirectory }
}

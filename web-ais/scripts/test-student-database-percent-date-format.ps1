Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "sync-student-database.ps1"
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile(
  $scriptPath,
  [ref]$tokens,
  [ref]$parseErrors
)
if ($parseErrors.Count) { throw $parseErrors[0] }

$requiredFunctions = @("Convert-DateToExcelSerial", "Convert-CellValue")
foreach ($name in $requiredFunctions) {
  $definition = $ast.Find({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
  }, $true)
  if ($null -eq $definition) { throw "Function $name was not found." }
  Invoke-Expression $definition.Extent.Text
}

$dateFields = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$numberFields = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
[void]$numberFields.Add("discount")

$discount50 = Convert-CellValue 50 "discount" $dateFields $numberFields
$discount10 = Convert-CellValue "10,0" "discount" $dateFields $numberFields
if ([Math]::Abs([double]$discount50 - 0.5) -gt 0.0000001) {
  throw "A 50 percent discount is not exported as 0.5."
}
if ([Math]::Abs([double]$discount10 - 0.1) -gt 0.0000001) {
  throw "A 10 percent discount is not exported as 0.1."
}

$frdoSerial = Convert-CellValue "2026-12-24" "frdoStatus" $dateFields $numberFields
$expectedSerial = ([datetime]"2026-12-24").ToOADate()
if ([Math]::Abs([double]$frdoSerial - [double]$expectedSerial) -gt 0.0000001) {
  throw "The FRDO date is not exported as an Excel serial date."
}

$source = Get-Content -LiteralPath $scriptPath -Raw -Encoding UTF8
if ($source -notmatch '\$range\.NumberFormat = "0\.##%"') {
  throw "The discount column has no percentage format."
}
$localDateFormat = ([char]0x0414).ToString() * 2 + "." + `
  ([char]0x041C).ToString() * 2 + "." + ([char]0x0413).ToString() * 4
$expectedFormatAssignment = '$range.NumberFormatLocal = "' + $localDateFormat + '"'
if (-not $source.Contains($expectedFormatAssignment)) {
  throw "The FRDO column has no dd.mm.yyyy format."
}
if ($source -match '\$range\.NumberFormat = "yyyy-mm-dd"') {
  throw "The obsolete yyyy-mm-dd FRDO format is still present."
}

Write-Output "Student database PowerShell percentage and FRDO date tests passed."

param([Parameter(Mandatory)][string]$Source, [Parameter(Mandatory)][string]$Output)
$ErrorActionPreference = 'Stop'
# One-time developer conversion of the legacy XLS; never open macros or update links.
if (Test-Path -LiteralPath $Output) { throw 'Output already exists.' }
$excel = New-Object -ComObject Excel.Application
$book = $null
try {
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.AutomationSecurity = 3
  $excel.EnableEvents = $false
  $excel.AskToUpdateLinks = $false
  $book = $excel.Workbooks.Open($Source, 0, $true)
  $book.SaveAs($Output, 51)
  Write-Output ('Converted read-only template: ' + $book.Worksheets.Count + ' sheets')
} finally {
  if ($null -ne $book) { $book.Close($false); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($book) }
  $excel.Quit()
  [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel)
}

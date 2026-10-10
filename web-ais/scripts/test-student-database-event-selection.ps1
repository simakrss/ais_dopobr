Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$tokens = $null
$errors = $null
$syntax = [Management.Automation.Language.Parser]::ParseFile(
  (Join-Path $PSScriptRoot "sync-student-database.ps1"), [ref]$tokens, [ref]$errors
)
if ($errors.Count) { throw "Cannot parse the workbook serializer" }
$names = @("Get-ObjectProperty", "Encode-StudentEventValue", "Get-StudentEventKeys", "Format-StudentEventDate", "Build-RecordEventSettings")
foreach ($name in $names) {
  $definition = $syntax.Find({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
  }, $true)
  if (-not $definition) { throw "Missing serializer function: $name" }
  . ([scriptblock]::Create($definition.Extent.Text))
}
$cases = ConvertFrom-Json ([Console]::In.ReadToEnd())
$result = @($cases | ForEach-Object {
  Build-RecordEventSettings $_.record "" @($_.templates) $_.root
})
ConvertTo-Json -InputObject $result -Compress

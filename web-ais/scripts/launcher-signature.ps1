# Verification only. Never unlocks a signing key or accepts a PIN.
function Get-AisLauncherBody([string]$Text) {
  $marker = '# SIG # Begin signature block'
  $offset = $Text.LastIndexOf($marker, [StringComparison]::Ordinal)
  if ($offset -lt 0) { return $null }
  $signature = $Text.Substring($offset)
  if ($signature -cnotmatch '\A# SIG # Begin signature block\r?\n(?:#[^\r\n]*\r?\n)*# SIG # End signature block(?:\r?\n)?\z') { return $null }
  return $Text.Substring(0, $offset).Replace("`r`n", "`n").TrimEnd([char[]]"`r`n")
}

function Test-AisReusableLauncher([string]$Path, [string]$ExpectedContent, [string]$CertificateThumbprint) {
  if (-not $ExpectedContent -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
  try {
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    if ($signature.Status -ne 'Valid' -or -not $signature.TimeStamperCertificate -or
        $signature.SignerCertificate.Thumbprint -ine $CertificateThumbprint) { return $false }
    $body = Get-AisLauncherBody ([IO.File]::ReadAllText($Path))
    return $null -ne $body -and $body -ceq $ExpectedContent.Replace("`r`n", "`n").TrimEnd([char[]]"`r`n")
  } catch { return $false }
}

"use strict";

// Use the Windows Explorer save dialog. Paths are supplied only through the
// environment, never interpolated into PowerShell code.
function buildLocalDocumentSaveDialogLauncher() {
  return String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
[Threading.Thread]::CurrentThread.CurrentCulture = [Globalization.CultureInfo]::GetCultureInfo('ru-RU')
[Threading.Thread]::CurrentThread.CurrentUICulture = [Globalization.CultureInfo]::GetCultureInfo('ru-RU')

function Show-AisSaveExtensionError([string]$Extension) {
  [void][System.Windows.Forms.MessageBox]::Show(
    ('Файл должен иметь расширение .' + $Extension + ', соответствующее формату сформированного документа.'),
    'Сохранить как',
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Warning
  )
}

function New-AisDocumentSaveDialog([string]$InitialPath, [string]$Format) {
  $extension = $Format.Trim().ToLowerInvariant()
  if ($extension -notin @('pdf', 'docx')) { throw 'Выбран неподдерживаемый формат документа.' }
  $dialog = New-Object System.Windows.Forms.SaveFileDialog
  $dialog.Title = 'Сохранить как'
  $dialog.AutoUpgradeEnabled = $true
  $dialog.InitialDirectory = [IO.Path]::GetDirectoryName($InitialPath)
  $dialog.FileName = [IO.Path]::GetFileName($InitialPath)
  $dialog.Filter = if ($extension -eq 'pdf') { 'Документ PDF (*.pdf)|*.pdf' } else { 'Документ Word (*.docx)|*.docx' }
  $dialog.FilterIndex = 1
  $dialog.DefaultExt = $extension
  $dialog.AddExtension = $true
  $dialog.SupportMultiDottedExtensions = $true
  $dialog.CheckPathExists = $true
  $dialog.CheckFileExists = $false
  $dialog.ValidateNames = $true
  $dialog.OverwritePrompt = $true
  $dialog.RestoreDirectory = $true
  $dialog.Add_FileOk({
    param($sender, $eventArgs)
    if ([IO.Path]::GetExtension($sender.FileName).ToLowerInvariant() -ne ('.' + $sender.DefaultExt)) {
      $eventArgs.Cancel = $true
      Show-AisSaveExtensionError $sender.DefaultExt
    }
  })
  return $dialog
}

function Show-AisDocumentSaveDialog {
  $dialog = New-AisDocumentSaveDialog $env:AIS_SAVE_INITIAL_PATH $env:AIS_SAVE_FORMAT
  $owner = New-Object System.Windows.Forms.Form
  try {
    $owner.ClientSize = New-Object System.Drawing.Size(1, 1)
    $owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
    $owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
    $owner.ShowInTaskbar = $false
    $owner.TopMost = $true
    $owner.Opacity = 0
    $owner.Show()
    [void]$owner.Activate()
    if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
      [Console]::Write('AIS_SAVE_PATH:' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($dialog.FileName)))
    }
  } finally {
    $dialog.Dispose()
    $owner.Close()
    $owner.Dispose()
  }
}
Show-AisDocumentSaveDialog
`.trim().replace(/\r?\n/g, "\r\n");
}

module.exports = { buildLocalDocumentSaveDialogLauncher };

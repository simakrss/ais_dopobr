"use strict";

// Native Windows dialogs use the same palette and typography as styles.css.
// Paths are supplied only through the environment, never interpolated into PowerShell code.
function buildLocalDocumentSaveDialogLauncher() {
  return String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
[Threading.Thread]::CurrentThread.CurrentCulture = [Globalization.CultureInfo]::GetCultureInfo('ru-RU')
[Threading.Thread]::CurrentThread.CurrentUICulture = [Globalization.CultureInfo]::GetCultureInfo('ru-RU')

function New-AisDialog([string]$Title, [int]$Width, [int]$Height) {
  $form = New-Object System.Windows.Forms.Form
  $form.Text = $Title + ' — АИС Допобразование'
  $form.ClientSize = New-Object System.Drawing.Size($Width, $Height)
  $form.AutoScaleDimensions = New-Object System.Drawing.SizeF(96, 96)
  $form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::Dpi
  $form.Font = New-Object System.Drawing.Font('Segoe UI', 10)
  $form.BackColor = [Drawing.ColorTranslator]::FromHtml('#f4f6f2')
  $form.ForeColor = [Drawing.ColorTranslator]::FromHtml('#1f2926')
  $form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterParent
  $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.ShowInTaskbar = $false
  $form.TopMost = $true
  $accent = New-Object System.Windows.Forms.Panel
  $accent.Dock = [System.Windows.Forms.DockStyle]::Top
  $accent.Height = 4
  $accent.BackColor = [Drawing.ColorTranslator]::FromHtml('#0f766e')
  [void]$form.Controls.Add($accent)
  $form.Add_Shown({ [void]$this.Activate(); [void]$this.BringToFront() })
  return $form
}

function Add-AisLabel($Form, [string]$Text, [int]$X, [int]$Y, [int]$Width, [int]$Height, [single]$Size = 10, [bool]$Bold = $false) {
  $label = New-Object System.Windows.Forms.Label
  $label.Text = $Text
  $label.AutoSize = $false
  $label.Location = New-Object System.Drawing.Point($X, $Y)
  $label.Size = New-Object System.Drawing.Size($Width, $Height)
  $style = if ($Bold) { [Drawing.FontStyle]::Bold } else { [Drawing.FontStyle]::Regular }
  $label.Font = New-Object System.Drawing.Font('Segoe UI', $Size, $style)
  [void]$Form.Controls.Add($label)
  return $label
}

function Add-AisButton($Form, [string]$Text, [int]$X, [int]$Y, [int]$Width, [bool]$Primary = $false) {
  $button = New-Object System.Windows.Forms.Button
  $button.Text = $Text
  $button.Location = New-Object System.Drawing.Point($X, $Y)
  $button.Size = New-Object System.Drawing.Size($Width, 36)
  $button.Anchor = [System.Windows.Forms.AnchorStyles]'Bottom,Right'
  $button.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $button.FlatAppearance.BorderSize = 1
  $button.FlatAppearance.BorderColor = [Drawing.ColorTranslator]::FromHtml('#d9e0dc')
  $button.BackColor = [Drawing.Color]::White
  $button.ForeColor = [Drawing.ColorTranslator]::FromHtml('#0f766e')
  $button.Cursor = [System.Windows.Forms.Cursors]::Hand
  if ($Primary) {
    $button.BackColor = [Drawing.ColorTranslator]::FromHtml('#0f766e')
    $button.ForeColor = [Drawing.Color]::White
    $button.FlatAppearance.BorderColor = $button.BackColor
    $button.FlatAppearance.MouseOverBackColor = [Drawing.ColorTranslator]::FromHtml('#0b5f58')
    $button.Font = New-Object System.Drawing.Font('Segoe UI', 10, [Drawing.FontStyle]::Bold)
  }
  [void]$Form.Controls.Add($button)
  return $button
}

function Add-AisTextInput($Form, [string]$Name, [string]$Text, [int]$X, [int]$Y, [int]$Width) {
  $inputBox = New-Object System.Windows.Forms.TextBox
  $inputBox.Name = $Name
  $inputBox.Text = $Text
  $inputBox.Location = New-Object System.Drawing.Point($X, $Y)
  $inputBox.Size = New-Object System.Drawing.Size($Width, 30)
  $inputBox.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
  [void]$Form.Controls.Add($inputBox)
  return $inputBox
}

function New-AisReplacementDialog([string]$FilePath) {
  $form = New-AisDialog 'Подтверждение замены' 600 290
  [void](Add-AisLabel $form 'Заменить существующий файл?' 22 22 556 34 16 $true)
  $name = Add-AisLabel $form ([IO.Path]::GetFileName($FilePath)) 22 70 556 28 10 $true
  $name.AutoEllipsis = $true
  $folder = Add-AisLabel $form ([IO.Path]::GetDirectoryName($FilePath)) 22 102 556 45 9
  $folder.ForeColor = [Drawing.ColorTranslator]::FromHtml('#66736e')
  $folder.AutoEllipsis = $true
  [void](Add-AisLabel $form ('В этой папке уже есть файл с таким именем.' + [Environment]::NewLine + 'При замене его содержимое будет перезаписано.') 22 156 556 48 10)
  $cancel = Add-AisButton $form 'Отмена' 298 232 112
  $replace = Add-AisButton $form 'Заменить файл' 422 232 156 $true
  $cancel.Name = 'CancelReplacement'
  $replace.Name = 'ConfirmReplacement'
  $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
  $replace.DialogResult = [System.Windows.Forms.DialogResult]::Yes
  $form.AcceptButton = $cancel
  $form.CancelButton = $cancel
  $form.ActiveControl = $cancel
  $tooltip = New-Object System.Windows.Forms.ToolTip
  $tooltip.SetToolTip($name, $FilePath)
  $tooltip.SetToolTip($folder, $FilePath)
  $form.Tag = @{ Tooltip = $tooltip }
  return $form
}

function Confirm-AisFileReplacement([string]$FilePath, $DialogOwner) {
  $form = New-AisReplacementDialog $FilePath
  try { return $form.ShowDialog($DialogOwner) -eq [System.Windows.Forms.DialogResult]::Yes }
  finally { $form.Tag.Tooltip.Dispose(); $form.Dispose() }
}

function Resolve-AisDocumentSavePath([string]$Folder, [string]$FileName, [string]$Format) {
  if ($Format -notin @('pdf', 'docx')) { throw 'Выбран неподдерживаемый формат документа.' }
  $folderPath = $Folder.Trim()
  if ($folderPath -notmatch '^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)') {
    throw 'Укажите полный путь к папке или нажмите «Выбрать папку».'
  }
  if (-not (Test-Path -LiteralPath $folderPath -PathType Container)) { throw 'Папка не найдена или недоступна. Выберите существующую папку.' }
  $name = $FileName.Trim() -replace '\.(?:pdf|docx)$', ''
  if (-not $name -or $name -match '[. ]$' -or $name.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0) {
    throw 'Укажите имя файла без символов \ / : * ? " < > | и без точки в конце.'
  }
  if ($name -match '^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') { throw 'Это имя зарезервировано Windows. Укажите другое имя файла.' }
  $selectedPath = [IO.Path]::GetFullPath([IO.Path]::Combine($folderPath, $name + '.' + $Format))
  if (Test-Path -LiteralPath $selectedPath -PathType Container) { throw 'Папка с таким именем уже существует. Укажите другое имя файла.' }
  return $selectedPath
}

function New-AisDocumentSaveDialog([string]$InitialPath, [string]$Format) {
  $form = New-AisDialog 'Сохранение документа' 660 352
  [void](Add-AisLabel $form 'Сохранение документа' 22 22 616 34 17 $true)
  $hint = Add-AisLabel $form 'Выберите папку и имя итогового файла.' 22 61 616 25 10
  $hint.ForeColor = [Drawing.ColorTranslator]::FromHtml('#66736e')
  [void](Add-AisLabel $form 'Имя файла (без расширения)' 22 101 462 24 10 $true)
  [void](Add-AisLabel $form 'Формат' 516 101 122 24 10 $true)
  $fileName = Add-AisTextInput $form 'DocumentFileName' ([IO.Path]::GetFileNameWithoutExtension($InitialPath)) 22 128 478
  $formatBox = Add-AisTextInput $form 'DocumentFormat' ($Format.ToUpperInvariant()) 516 128 122
  $formatBox.ReadOnly = $true
  $formatBox.TabStop = $false
  $formatBox.BackColor = [Drawing.ColorTranslator]::FromHtml('#f9faf7')
  [void](Add-AisLabel $form 'Папка сохранения' 22 172 616 24 10 $true)
  $folder = Add-AisTextInput $form 'DocumentFolder' ([IO.Path]::GetDirectoryName($InitialPath)) 22 199 462
  $browse = Add-AisButton $form 'Выбрать папку' 496 194 142
  $errorLabel = Add-AisLabel $form '' 22 236 616 43 9
  $errorLabel.Name = 'SaveError'
  $errorLabel.ForeColor = [Drawing.ColorTranslator]::FromHtml('#b42318')
  $errorLabel.AccessibleName = 'Ошибка сохранения'
  $cancel = Add-AisButton $form 'Отмена' 370 294 112
  $save = Add-AisButton $form 'Сохранить' 494 294 144 $true
  $cancel.Name = 'CancelSave'
  $save.Name = 'ConfirmSave'
  $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
  $form.AcceptButton = $save
  $form.CancelButton = $cancel
  $form.ActiveControl = $fileName
  $fileName.TabIndex = 0
  $folder.TabIndex = 1
  $browse.TabIndex = 2
  $cancel.TabIndex = 3
  $save.TabIndex = 4
  $form.Tag = @{ SelectedPath = ''; Format = $Format; FileName = $fileName; Folder = $folder; ErrorLabel = $errorLabel }
  $browse.Add_Click({
    $window = $this.FindForm()
    $picker = New-Object System.Windows.Forms.FolderBrowserDialog
    $picker.Description = 'Выберите папку для сохранения документа'
    $picker.ShowNewFolderButton = $true
    $picker.SelectedPath = $window.Tag.Folder.Text
    try {
      if ($picker.ShowDialog($window) -eq [System.Windows.Forms.DialogResult]::OK) {
        $window.Tag.Folder.Text = $picker.SelectedPath
        $window.Tag.ErrorLabel.Text = ''
      }
    } catch { $window.Tag.ErrorLabel.Text = 'Не удалось открыть выбор папки. Укажите путь вручную.' }
    finally { $picker.Dispose() }
  })
  $save.Add_Click({
    $window = $this.FindForm()
    try {
      $selectedPath = Resolve-AisDocumentSavePath $window.Tag.Folder.Text $window.Tag.FileName.Text $window.Tag.Format
      if ((Test-Path -LiteralPath $selectedPath -PathType Leaf) -and -not (Confirm-AisFileReplacement $selectedPath $window)) { return }
      $window.Tag.SelectedPath = $selectedPath
      $window.DialogResult = [System.Windows.Forms.DialogResult]::OK
    } catch { $window.Tag.ErrorLabel.Text = $_.Exception.Message }
  })
  return $form
}

function Show-AisDocumentSaveDialog {
  $owner = New-Object System.Windows.Forms.Form
  $owner.ClientSize = New-Object System.Drawing.Size(1, 1)
  $owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
  $owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
  $owner.ShowInTaskbar = $false
  $owner.TopMost = $true
  $owner.Opacity = 0
  $dialog = New-AisDocumentSaveDialog $env:AIS_SAVE_INITIAL_PATH $env:AIS_SAVE_FORMAT
  $owner.Show()
  [void]$owner.Activate()
  try {
    if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
      $selectedPath = $dialog.Tag.SelectedPath
      [Console]::Write('AIS_SAVE_PATH:' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($selectedPath)))
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

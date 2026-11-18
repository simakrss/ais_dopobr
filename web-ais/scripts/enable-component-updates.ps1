[CmdletBinding()]
param([string]$AppRoot = "", [switch]$Elevated, [string]$NodePath = "")
# Compatibility entry point only. Never restore quarantined files or recreate the
# withdrawn elevated updater. Windows service setup remains an explicit action.
Write-Warning 'Автоматическая замена защищённых файлов службы отключена после блокировки антивирусом. Не добавляйте исключения и не восстанавливайте заблокированный компонент. Обновление файлов приложения продолжает работать.'

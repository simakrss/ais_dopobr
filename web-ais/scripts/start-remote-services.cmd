@echo off
setlocal EnableExtensions DisableDelayedExpansion
for %%I in ("%~dp0..") do set "AIS_APP_DIR=%%~fI"
start "" /b "%SystemRoot%\System32\wscript.exe" //NoLogo ^
  "%~dp0ais-hidden-process.vbs" --notify-errors ^
  "%AIS_APP_DIR%" "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" ^
  -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden ^
  -File "%~dp0start-remote-services.ps1" -Supervisor
exit /b %ERRORLEVEL%

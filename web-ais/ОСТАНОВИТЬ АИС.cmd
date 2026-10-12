@echo off
setlocal EnableExtensions DisableDelayedExpansion
for %%I in ("%~dp0.") do set "AIS_APP_DIR=%%~fI"

if /i "%AIS_LAUNCHER_VALIDATE_ONLY%"=="1" goto :validate
if not exist "%AIS_APP_DIR%\scripts\ais-hidden-process.vbs" exit /b 1
start "" /b "%SystemRoot%\System32\wscript.exe" //NoLogo ^
  "%AIS_APP_DIR%\scripts\ais-hidden-process.vbs" --notify-errors ^
  "%AIS_APP_DIR%" "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" ^
  -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden ^
  -File "%AIS_APP_DIR%\scripts\control-ais-service.ps1" ^
  -Action Stop -SourceAppRoot "%AIS_APP_DIR%"
exit /b %ERRORLEVEL%

:validate
if not exist "%AIS_APP_DIR%\scripts\setup-ais-windows-service.ps1" exit /b 1
pushd "%AIS_APP_DIR%"
if errorlevel 1 exit /b 1
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass ^
  -File ".\scripts\setup-ais-windows-service.ps1" -Action Validate
set "AIS_EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %AIS_EXIT_CODE%

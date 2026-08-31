@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title АИС Допобразование — остановка службы
call :log Начало остановки службы АИС.
pushd "%~dp0"
if errorlevel 1 goto :path_error
if not exist ".\scripts\control-ais-service.ps1" goto :path_error
if not exist ".\scripts\setup-ais-windows-service.ps1" goto :path_error

if /i "%AIS_LAUNCHER_VALIDATE_ONLY%"=="1" (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\scripts\setup-ais-windows-service.ps1" -Action Validate
) else (
  call :log Отправлена команда остановки службы АИС. Контейнеры Docker будут сохранены.
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\scripts\control-ais-service.ps1" -Action Stop
)
set "AIS_EXIT_CODE=%ERRORLEVEL%"
popd
if /i "%AIS_LAUNCHER_VALIDATE_ONLY%"=="1" exit /b %AIS_EXIT_CODE%
if "%AIS_EXIT_CODE%"=="0" (
  call :log Служба АИС остановлена. Контейнеры Docker оставлены работающими.
  exit /b 0
)
call :log ОШИБКА: остановка службы АИС завершилась с кодом %AIS_EXIT_CODE%.
echo.
pause
exit /b %AIS_EXIT_CODE%

:path_error
call :log ОШИБКА: не удалось открыть папку АИС.
echo.
pause
exit /b 1

:log
set "AIS_LOG_TIME=%TIME: =0%"
echo [%DATE% %AIS_LOG_TIME:~0,8%] %*
exit /b 0

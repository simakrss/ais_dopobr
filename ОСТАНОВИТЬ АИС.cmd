@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title АИС Допобразование — остановка сервера
set "AIS_APP_DIR=%~dp0web-ais"
call :log Начало остановки АИС.
if not exist "%AIS_APP_DIR%\scripts\stop-lan-system.ps1" goto :path_error
pushd "%AIS_APP_DIR%"
if errorlevel 1 goto :path_error

:run
if /i "%AIS_LAUNCHER_VALIDATE_ONLY%"=="1" goto :validation_ok
call :log Отправлена команда остановки локальных серверов АИС.
set "AIS_STOP_ARGUMENTS="
if /i "%~1"=="--keep-docker" set "AIS_STOP_ARGUMENTS=-KeepDocker"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\scripts\stop-lan-system.ps1" %AIS_STOP_ARGUMENTS%
set "AIS_EXIT_CODE=%ERRORLEVEL%"
if "%AIS_EXIT_CODE%"=="0" (
  call :log Локальные серверы АИС остановлены.
) else (
  call :log ОШИБКА: остановка АИС завершилась с кодом %AIS_EXIT_CODE%.
)
popd
echo.
pause
exit /b %AIS_EXIT_CODE%

:validation_ok
call :log Проверка сценария остановки АИС выполнена успешно.
popd
exit /b 0

:path_error
call :log ОШИБКА: не найдена папка системы: %AIS_APP_DIR%
echo.
pause
exit /b 1

:log
set "AIS_LOG_TIME=%TIME: =0%"
echo [%DATE% %AIS_LOG_TIME:~0,8%] %*
exit /b 0

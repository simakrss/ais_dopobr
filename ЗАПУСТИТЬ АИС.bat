@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title АИС Допобразование — автономный сервер
set "AIS_APP_DIR=%~dp0web-ais"
call :log Начало запуска АИС.
if not exist "%AIS_APP_DIR%\app-server.js" goto :path_error
if not exist "%AIS_APP_DIR%\scripts\bootstrap-local-system.ps1" goto :bootstrap_error
pushd "%AIS_APP_DIR%"
if errorlevel 1 goto :path_error

:run
if /i "%AIS_LAUNCHER_VALIDATE_ONLY%"=="1" (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\scripts\bootstrap-local-system.ps1" -Action Validate -LauncherArguments "--open-browser %*"
) else (
  call :log Проверка и установка необходимых компонентов.
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\scripts\bootstrap-local-system.ps1" -Action Start -LauncherArguments "--open-browser %*"
)
set "AIS_EXIT_CODE=%ERRORLEVEL%"
if /i "%AIS_LAUNCHER_VALIDATE_ONLY%"=="1" (
  popd
  exit /b %AIS_EXIT_CODE%
)
if "%AIS_EXIT_CODE%"=="0" (
  call :log Работа локальных серверов АИС завершена.
) else (
  call :log ОШИБКА: не удалось запустить АИС. Сообщение об ошибке указано выше.
)
popd
echo.
pause
exit /b %AIS_EXIT_CODE%

:bootstrap_error
call :log ОШИБКА: не найден сценарий подготовки окружения АИС.
echo.
pause
exit /b 1

:path_error
call :log ОШИБКА: не найдена папка системы: %AIS_APP_DIR%
echo.
pause
exit /b 1

:log
set "AIS_LOG_TIME=%TIME: =0%"
echo [%DATE% %AIS_LOG_TIME:~0,8%] %*
exit /b 0

@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title АИС Допобразование — автономный сервер
call :log Начало запуска АИС в локальной сети.
pushd "%~dp0"
if errorlevel 1 goto :path_error
if not exist ".\scripts\bootstrap-local-system.ps1" goto :bootstrap_error

:run
if /i "%AIS_LAUNCHER_VALIDATE_ONLY%"=="1" (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\scripts\bootstrap-local-system.ps1" -Action Validate -LauncherArguments "%*"
) else (
  call :log Проверка и установка необходимых компонентов.
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\scripts\bootstrap-local-system.ps1" -Action Start -LauncherArguments "%*"
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
call :log ОШИБКА: не удалось открыть папку АИС.
echo.
pause
exit /b 1

:log
set "AIS_LOG_TIME=%TIME: =0%"
echo [%DATE% %AIS_LOG_TIME:~0,8%] %*
exit /b 0

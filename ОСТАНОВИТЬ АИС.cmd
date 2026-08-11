@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title АИС Допобразование — остановка сервера
set "AIS_APP_DIR=%~dp0web-ais"
call :log Начало остановки АИС.
if not exist "%AIS_APP_DIR%\scripts\stop-lan-system.js" goto :path_error
pushd "%AIS_APP_DIR%"
if errorlevel 1 goto :path_error

set "AIS_NODE=node.exe"
where "%AIS_NODE%" >nul 2>nul
if not errorlevel 1 goto :run
if exist "C:\Program Files\nodejs\node.exe" set "AIS_NODE=C:\Program Files\nodejs\node.exe"
if not exist "%AIS_NODE%" goto :node_error

:run
call :log Отправлена команда остановки локальных серверов АИС.
"%AIS_NODE%" ".\scripts\stop-lan-system.js" %*
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

:node_error
call :log ОШИБКА: Node.js не найден. Установите Node.js или добавьте node.exe в PATH.
popd
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

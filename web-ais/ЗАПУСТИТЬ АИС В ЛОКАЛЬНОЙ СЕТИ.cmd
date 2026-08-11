@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title АИС Допобразование — автономный сервер
call :log Начало запуска АИС в локальной сети.
pushd "%~dp0"
if errorlevel 1 goto :path_error

set "AIS_NODE=node.exe"
where "%AIS_NODE%" >nul 2>nul
if not errorlevel 1 goto :run
if exist "C:\Program Files\nodejs\node.exe" set "AIS_NODE=C:\Program Files\nodejs\node.exe"
if not exist "%AIS_NODE%" goto :node_error

:run
call :log Запуск локальных серверов АИС.
"%AIS_NODE%" ".\scripts\start-lan-system.js" %*
set "AIS_EXIT_CODE=%ERRORLEVEL%"
if "%AIS_EXIT_CODE%"=="0" (
  call :log Работа локальных серверов АИС завершена.
) else (
  call :log ОШИБКА: не удалось запустить АИС. Сообщение об ошибке указано выше.
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
call :log ОШИБКА: не удалось открыть папку АИС.
echo.
pause
exit /b 1

:log
set "AIS_LOG_TIME=%TIME: =0%"
echo [%DATE% %AIS_LOG_TIME:~0,8%] %*
exit /b 0

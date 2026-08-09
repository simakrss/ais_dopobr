@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title АИС Допобразование — остановка сервера
set "AIS_APP_DIR=%~dp0web-ais"
if not exist "%AIS_APP_DIR%\scripts\stop-lan-system.js" goto :path_error
pushd "%AIS_APP_DIR%"
if errorlevel 1 goto :path_error

set "AIS_NODE=node.exe"
where "%AIS_NODE%" >nul 2>nul
if not errorlevel 1 goto :run
if exist "C:\Program Files\nodejs\node.exe" set "AIS_NODE=C:\Program Files\nodejs\node.exe"
if not exist "%AIS_NODE%" goto :node_error

:run
"%AIS_NODE%" ".\scripts\stop-lan-system.js" %*
set "AIS_EXIT_CODE=%ERRORLEVEL%"
popd
echo.
pause
exit /b %AIS_EXIT_CODE%

:node_error
echo Node.js не найден. Установите Node.js или добавьте node.exe в PATH.
popd
echo.
pause
exit /b 1

:path_error
echo Не найдена папка системы: %AIS_APP_DIR%
echo.
pause
exit /b 1

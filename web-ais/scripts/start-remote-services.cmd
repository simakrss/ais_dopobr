@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0start-remote-services.ps1" -Supervisor

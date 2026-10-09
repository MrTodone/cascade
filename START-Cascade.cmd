@echo off
setlocal
title Cascade
cd /d "%~dp0"
start "Cascade" "%~dp0cascade.exe"
timeout /t 3 /nobreak >nul
start "" "http://localhost:3000"
endlocal
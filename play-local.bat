@echo off
setlocal
cd /d "%~dp0"
echo Project Gehenna - Local HYTOPIA client previewer
echo.
call npm run play-local
endlocal

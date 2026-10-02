@echo off
chcp 65001 >nul
cd /d "%~dp0\.."
set "VENV=%LOCALAPPDATA%\langdy-processor\venv"
"%VENV%\Scripts\python" tools\process.py weekly %*
if exist private\out start "" "private\out"
pause

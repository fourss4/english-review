@echo off
chcp 65001 >nul
cd /d "%~dp0\.."
set "VENV=%LOCALAPPDATA%\langdy-processor\venv"
if not exist "%VENV%\Scripts\python.exe" (
  echo Run tools\setup.bat first.
  pause
  exit /b 1
)
"%VENV%\Scripts\python" tools\process.py %*
if exist private\out start "" "private\out"
pause

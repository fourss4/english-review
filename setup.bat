@echo off
rem Langdy processor setup. Messages are ASCII only (cmd encoding safe).
rem NOTE: do not put ( ) inside echo lines that are inside an if-block.
chcp 65001 >nul
cd /d "%~dp0\.."
set "VENV=%LOCALAPPDATA%\langdy-processor\venv"

rem --- find Python: py launcher first, then python ---
set "PY="
where py >nul 2>nul
if not errorlevel 1 set "PY=py -3"
if not defined PY (
  where python >nul 2>nul
  if not errorlevel 1 set "PY=python"
)
if not defined PY goto nopython

%PY% -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)"
if errorlevel 1 goto oldpython

if exist "%VENV%\Scripts\python.exe" goto install
echo Creating virtual environment: %VENV%
%PY% -m venv "%VENV%"
if errorlevel 1 goto fail

:install
echo Installing packages - first time can take 5 to 15 minutes...
"%VENV%\Scripts\python" -m pip install --upgrade pip
"%VENV%\Scripts\python" -m pip install -r tools\requirements.txt
if errorlevel 1 goto fail

if not exist tools\config.toml copy tools\config.example.toml tools\config.toml >nul
if not exist tools\.env echo ANTHROPIC_API_KEY=> tools\.env
if not exist private\inbox mkdir private\inbox
if not exist private\out mkdir private\out
echo.
echo Next steps:
echo  1. Put a Claude model ID in tools\config.toml : model = "..."
echo  2. Put your API key in tools\.env : ANTHROPIC_API_KEY=...
echo  3. Run setup.bat again to check.
echo.
"%VENV%\Scripts\python" tools\process.py check
goto end

:nopython
echo [ERROR] Python not found.
echo Install Python 3.11 or newer from https://www.python.org/downloads/
echo On the first installer screen, check "Add python.exe to PATH". Then restart the PC.
goto end

:oldpython
echo [ERROR] Python 3.11 or newer is required. Found:
%PY% --version
goto end

:fail
echo.
echo [ERROR] Setup failed. Take a screenshot of the messages above and share it.

:end
echo.
pause

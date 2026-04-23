@echo off
setlocal
chcp 65001 >nul
echo ============================================
echo   GAME STREAM DJ - Setup ^& Launch
echo ============================================
echo.

set "BASE_DIR=%~dp0"
cd /d "%BASE_DIR%"

REM Find Python
set "PYTHON_CMD="
py --version >nul 2>&1
if %errorlevel% equ 0 (
    set "PYTHON_CMD=py"
) else (
    python --version >nul 2>&1
    if %errorlevel% equ 0 (
        set "PYTHON_CMD=python"
    ) else (
        echo [ERROR] Python not found.
        pause
        exit /b 1
    )
)

echo [INFO] Python found: %PYTHON_CMD%

REM Venv
if not exist "backend\.venv" (
    echo [INFO] Creating virtual environment...
    "%PYTHON_CMD%" -m venv backend\.venv
)

REM Activation & Run
echo.
echo ============================================
echo   Checking/Updating Dependencies...
echo ============================================
echo.

"%BASE_DIR%backend\.venv\Scripts\python.exe" -m pip install -U -q -r "%BASE_DIR%backend\requirements.txt"

echo.
echo ============================================
echo   Starting Backend Server...
echo ============================================
echo.

"%BASE_DIR%backend\.venv\Scripts\python.exe" "%BASE_DIR%backend\main.py"

pause

# GAME STREAM DJ - PowerShell Setup Script
# Run with: powershell -ExecutionPolicy Bypass -File setup_env.ps1

$ErrorActionPreference = "Stop"
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  GAME STREAM DJ - Environment Setup" -ForegroundColor Cyan  
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

Set-Location $PSScriptRoot

# Check Python
$pythonCmd = Get-Command py -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
    $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
}
if (-not $pythonCmd) {
    Write-Host "[ERROR] Python not found. Please install Python first." -ForegroundColor Red
    exit 1
}

Write-Host "[OK] Python found" -ForegroundColor Green

# Create virtual environment
if (-not (Test-Path "backend\.venv")) {
    Write-Host "[INFO] Creating virtual environment..." -ForegroundColor Yellow
    & $pythonCmd.Source -m venv backend\.venv
}

# Activate and install
Write-Host "[INFO] Installing dependencies..." -ForegroundColor Yellow
& backend\.venv\Scripts\Activate.ps1
pip install -q -r backend\requirements.txt

Write-Host ""
Write-Host "[SUCCESS] Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "To start the server, run:" -ForegroundColor Cyan
Write-Host "  .\start.bat" -ForegroundColor White
Write-Host ""
Write-Host "Or manually:" -ForegroundColor Cyan
Write-Host "  backend\.venv\Scripts\Activate.ps1" -ForegroundColor White
Write-Host "  cd backend" -ForegroundColor White
Write-Host "  py main.py" -ForegroundColor White
Write-Host ""

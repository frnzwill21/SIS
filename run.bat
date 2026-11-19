@echo off
setlocal EnableDelayedExpansion
title School Intelligence System - Services Launcher

echo ==============================================================================
echo                SCHOOL INTELLIGENCE SYSTEM (SIS) - SERVICES LAUNCHER
echo                         SMKN 4 BANDUNG ACADEMIC YEAR
echo ==============================================================================
echo Initializing application services and validating runtime dependencies...
echo.

set "ROOT=%~dp0"
cd /d "%ROOT%"

:: ------------------------------------------------------------------
:: STEP 0: Sanity Check Prerequisites
:: ------------------------------------------------------------------
if not exist "backend\.venv\Scripts\activate.bat" (
    echo [CRITICAL ERROR] Python virtual environment not found in backend\.venv!
    echo Please run setup.bat first to initialize project dependencies.
    echo.
    pause
    exit /b 1
)

if not exist "frontend\node_modules" (
    echo [CRITICAL ERROR] Frontend dependencies not found in frontend\node_modules!
    echo Please run setup.bat first to initialize project dependencies.
    echo.
    pause
    exit /b 1
)

if not exist ".env" (
    echo [CRITICAL ERROR] Environment configuration file .env not found!
    echo Please create or restore .env from .env.example before launching.
    echo.
    pause
    exit /b 1
)

:: ------------------------------------------------------------------
:: STEP 1: Database Service State & Dynamic IP Binding (WSL Support)
:: ------------------------------------------------------------------
echo [1/3] Checking PostgreSQL database service state...
set "WSL_IP="
where wsl >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo       [INFO] Running in native Windows mode. Utilizing configured DATABASE_URL.
    goto launch_services
)

wsl.exe whoami >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    net session >nul 2>&1
    if !ERRORLEVEL! NEQ 0 (
        echo       [NOTICE] WSL virtual disk access requires Administrator privileges.
        echo       Requesting elevation prompt...
        powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -WorkingDirectory '%ROOT%' -Verb RunAs"
        exit /b 0
    )
)

wsl -u root -- which psql >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo       [INFO] WSL detected without internal PostgreSQL. Using native or Docker database.
    goto launch_services
)

echo       Ensuring PostgreSQL daemon in WSL is active...
wsl -u root -- /usr/sbin/service postgresql start >nul 2>&1
start "SIS Database Keepalive" /min wsl -u root -- sleep infinity

for /f "tokens=1" %%i in ('wsl -u root -- hostname -I') do set "WSL_IP=%%i"
if defined WSL_IP (
    echo       Binding active WSL host IP !WSL_IP! to backend configuration...
    cd /d "%ROOT%backend"
    call .venv\Scripts\activate.bat
    python -c "import os, re; p = os.path.join(r'%ROOT%.', '.env'); ip = os.environ.get('WSL_IP', '').strip(); t = open(p, 'r', encoding='utf-8').read(); t = re.sub(r'(@)[^:/]+(:5432)', r'\g<1>' + ip + r'\2', t); open(p, 'w', encoding='utf-8').write(t)" >nul 2>&1
    cd /d "%ROOT%"
)

:launch_services
:: ------------------------------------------------------------------
:: STEP 2: Launch FastAPI Backend Server
:: ------------------------------------------------------------------
echo [2/3] Launching FastAPI Backend Server on Port 8000...
start "SIS Backend - Port 8000" cmd /k "title SIS Backend - Port 8000 && cd /d "%ROOT%backend" && call .venv\Scripts\activate.bat && uvicorn app.main:app --reload --port 8000"

:: ------------------------------------------------------------------
:: STEP 3: Launch Next.js Frontend Server
:: ------------------------------------------------------------------
echo [3/3] Launching Next.js Frontend Server on Port 3000...
start "SIS Frontend - Port 3000" cmd /k "title SIS Frontend - Port 3000 && cd /d "%ROOT%frontend" && npm run dev"

echo.
echo ==============================================================================
echo                          ALL SERVICES ARE INITIALIZED!
echo ==============================================================================
echo Application endpoints:
echo   - Frontend Interface : http://localhost:3000
echo   - Interactive API    : http://localhost:8000/docs
echo   - System Health API  : http://localhost:8000/api/v1/health
echo.
echo Note: Keep the opened terminal windows running while using the system.
echo ==============================================================================
echo.
pause

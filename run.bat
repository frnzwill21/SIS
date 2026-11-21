@echo off
setlocal EnableDelayedExpansion
title School Intelligence System - Docker Launcher

echo ==============================================================================
echo             SCHOOL INTELLIGENCE SYSTEM (SIS) - DOCKER LAUNCHER
echo                           SMKN 4 BANDUNG
echo ==============================================================================
echo.

set "ROOT=%~dp0"
cd /d "%ROOT%"

where docker >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Docker belum terpasang. Pasang Docker Desktop terlebih dahulu.
    pause
    exit /b 1
)

docker info >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Docker Desktop belum menyala. Buka Docker Desktop terlebih dahulu.
    pause
    exit /b 1
)

if not exist ".env" (
    echo [ERROR] File .env belum ada. Jalankan setup.bat terlebih dahulu.
    pause
    exit /b 1
)

echo Menjalankan container SIS (PostgreSQL, FastAPI, Next.js)...
docker compose up -d
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Gagal menjalankan container. Jalankan setup.bat untuk build ulang.
    pause
    exit /b 1
)

echo.
echo ==============================================================================
echo                        SEMUA LAYANAN AKTIF!
echo ==============================================================================
echo   - Frontend Web   : http://localhost:3000
echo   - API Docs       : http://localhost:8000/docs
echo   - Health Check   : http://localhost:8000/api/v1/health
echo   - PostgreSQL     : localhost:5432
echo.
echo Perintah berguna:
echo   - Lihat log live : docker compose logs -f
echo   - Hentikan semua : docker compose down
echo ==============================================================================
echo.
pause

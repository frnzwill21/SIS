@echo off
setlocal EnableDelayedExpansion
title School Intelligence System - Docker Setup

echo ==============================================================================
echo              SCHOOL INTELLIGENCE SYSTEM (SIS) - DOCKER SETUP
echo                           SMKN 4 BANDUNG
echo ==============================================================================
echo Skrip ini menyiapkan konfigurasi .env lalu membangun dan menjalankan seluruh
echo layanan SIS (PostgreSQL 16, Backend FastAPI, Frontend Next.js) lewat Docker.
echo ==============================================================================
echo.

set "ROOT=%~dp0"
cd /d "%ROOT%"

:: ------------------------------------------------------------------
:: STEP 1: Cek Docker & Docker Compose
:: ------------------------------------------------------------------
echo [1/3] Memeriksa Docker Desktop...
where docker >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo       [ERROR] Docker belum terpasang di sistem ini.
    echo       Pasang Docker Desktop terlebih dahulu: https://www.docker.com/products/docker-desktop/
    pause
    exit /b 1
)

docker info >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo       [ERROR] Docker Desktop belum menyala.
    echo       Buka aplikasi Docker Desktop hingga statusnya "Engine running", lalu ulangi setup.bat.
    pause
    exit /b 1
)
echo       [OK] Docker Desktop aktif.

:: ------------------------------------------------------------------
:: STEP 2: Inisialisasi & Validasi .env
:: ------------------------------------------------------------------
echo.
echo [2/3] Memeriksa konfigurasi .env...
if not exist ".env" (
    if not exist ".env.example" (
        echo       [ERROR] .env.example tidak ditemukan.
        pause
        exit /b 1
    )
    copy ".env.example" ".env" >nul
    echo       [CREATED] .env dibuat dari .env.example.
) else (
    echo       [OK] .env sudah ada.
)

:: Ganti placeholder POSTGRES_PASSWORD & JWT_SECRET dengan nilai acak kuat bila masih default
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p = Join-Path '%ROOT%' '.env';" ^
  "$t = Get-Content -Raw -Encoding UTF8 $p;" ^
  "$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create();" ^
  "function New-Secret($n){ $b = New-Object byte[] $n; $rng.GetBytes($b); ([Convert]::ToBase64String($b) -replace '[+/=]','') }" ^
  "if ($t -match 'POSTGRES_PASSWORD=ganti-dengan[^\r\n]*') { $pw = New-Secret 24; $t = $t -replace 'POSTGRES_PASSWORD=ganti-dengan[^\r\n]*', ('POSTGRES_PASSWORD=' + $pw); $t = $t -replace 'ganti-dengan-kata-sandi-kuat', $pw }" ^
  "if ($t -match 'JWT_SECRET=ganti-dengan[^\r\n]*') { $jwt = New-Secret 40; $t = $t -replace 'JWT_SECRET=ganti-dengan[^\r\n]*', ('JWT_SECRET=' + $jwt) }" ^
  "Set-Content -Path $p -Value $t -Encoding UTF8 -NoNewline"

echo       [OK] Kredensial .env siap dipakai.

:: ------------------------------------------------------------------
:: STEP 3: Build & Jalankan Container Docker Compose
:: ------------------------------------------------------------------
echo.
echo [3/3] Membangun dan menjalankan layanan Docker Compose...
docker compose up --build -d
if %ERRORLEVEL% NEQ 0 (
    echo       [ERROR] docker compose up gagal. Periksa pesan di atas.
    pause
    exit /b 1
)

echo.
echo ==============================================================================
echo                       SETUP DOCKER SELESAI!
echo ==============================================================================
echo Layanan aktif:
echo   - Aplikasi Web (Frontend) : http://localhost:3000
echo   - Dokumentasi API         : http://localhost:8000/docs
echo   - Health Check            : http://localhost:8000/api/v1/health
echo   - PostgreSQL (DBeaver)    : localhost:5432
echo.
echo Catatan:
echo   - Kali pertama, backend otomatis mengisi skema, 21 tabel, dan akun awal.
echo   - Daftar akun awal ada di: backend\seed_output\seed_credentials.txt
echo   - Untuk menjalankan lagi nanti cukup klik: run.bat
echo   - Untuk melihat log: docker compose logs -f
echo   - Untuk menghentikan: docker compose down
echo ==============================================================================
echo.
pause

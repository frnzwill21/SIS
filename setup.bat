@echo off
setlocal EnableDelayedExpansion
title School Intelligence System - Automated Environment Setup

echo ==============================================================================
echo                SCHOOL INTELLIGENCE SYSTEM (SIS) - SETUP WIZARD
echo                         SMKN 4 BANDUNG ACADEMIC YEAR
echo ==============================================================================
echo This automated installer verifies system prerequisites, inspects dependency
echo integrity, and provisions only missing components to prevent duplicate builds.
echo.
echo Scope of verification:
echo   [1/6] Environment Configuration - .env
echo   [2/6] Python Runtime and Virtual Environment - .venv
echo   [3/6] Backend Dependencies - FastAPI, SQLAlchemy, Drivers
echo   [4/6] Node.js Runtime and Frontend Packages - Next.js, Dependencies
echo   [5/6] PostgreSQL Database Connectivity and Schema Seeding
echo   [6/6] Production Runner Provisioning - run.bat and Script Self-Destruction
echo ==============================================================================
echo.
pause

set "ROOT=%~dp0"
cd /d "%ROOT%"

:: ------------------------------------------------------------------
:: STEP 1: Environment Configuration
:: ------------------------------------------------------------------
echo.
echo [1/6] Verifying environment configuration...
if exist ".env" (
    echo       [OK] Existing .env configuration detected. Preserved.
    goto step2
)
if exist ".env.example" (
    copy ".env.example" ".env" >nul
    echo       [CREATED] .env initialized from template.
) else (
    echo       [WARNING] .env.example not found. Manual .env configuration required.
)

:step2
:: ------------------------------------------------------------------
:: STEP 2: Python Runtime and Virtual Environment Verification
:: ------------------------------------------------------------------
echo.
echo [2/6] Verifying Python runtime and virtual environment...
where python >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo       [CRITICAL] Python runtime not detected in system PATH.
    echo       Please install Python 3.11 or later and enable PATH integration.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('python --version 2^>^&1') do set "PY_VER=%%v"
echo       [OK] Found %PY_VER%

cd /d "%ROOT%backend"
if exist ".venv\Scripts\python.exe" (
    echo       [OK] Valid Python virtual environment detected.
    goto step3
)
echo       [PROVISIONING] Python virtual environment not found. Initializing...
python -m venv .venv
if %ERRORLEVEL% NEQ 0 (
    echo       [ERROR] Failed to initialize Python virtual environment.
    pause
    exit /b 1
)
echo       [OK] Virtual environment created successfully.

:step3
:: ------------------------------------------------------------------
:: STEP 3: Backend Package Integrity Verification
:: ------------------------------------------------------------------
echo.
echo [3/6] Verifying backend dependency integrity...
call .venv\Scripts\activate.bat

python -c "import fastapi, uvicorn, sqlalchemy, psycopg, pydantic, jwt, bcrypt" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo       [OK] Core backend dependencies validated. Skipping reinstallation.
    goto step4
)

echo       [NOTICE] Missing or incomplete backend dependencies detected.
echo       [INSTALLING] Resolving backend packages from requirements.txt...
python -m pip install --upgrade pip >nul 2>&1
pip install -r requirements.txt
if %ERRORLEVEL% NEQ 0 (
    echo       [ERROR] Failed to install backend dependencies.
    pause
    exit /b 1
)
echo       [OK] Backend dependencies installed successfully.

:step4
cd /d "%ROOT%"
:: ------------------------------------------------------------------
:: STEP 4: Node.js Runtime and Frontend Packages Verification
:: ------------------------------------------------------------------
echo.
echo [4/6] Verifying Node.js runtime and frontend packages...
where npm >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo       [CRITICAL] Node.js/npm runtime not detected in system PATH.
    echo       Please install Node.js 18 or later from https://nodejs.org/
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v 2^>^&1') do set "NODE_VER=%%v"
echo       [OK] Found Node.js %NODE_VER%

cd /d "%ROOT%frontend"
set "NEED_NPM=0"
if not exist "node_modules" set "NEED_NPM=1"
if not exist "node_modules\next" set "NEED_NPM=1"
if not exist "node_modules\lucide-react" set "NEED_NPM=1"

if "!NEED_NPM!"=="0" (
    echo       [OK] Frontend package integrity verified. Skipping npm install.
    goto step5
)

echo       [NOTICE] Missing frontend dependencies detected.
echo       [INSTALLING] Installing frontend dependencies via npm...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo       [ERROR] Failed to complete npm install.
    pause
    exit /b 1
)
echo       [OK] Frontend packages installed successfully.

:step5
cd /d "%ROOT%"
:: ------------------------------------------------------------------
:: STEP 5: Database Service and Schema Verification
:: ------------------------------------------------------------------
echo.
echo [5/6] Verifying database services and schema integrity...
set "WSL_IP="
set "SETUP_OK=1"
where wsl >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo       [INFO] WSL environment not present. Utilizing standard DATABASE_URL.
    goto sync_env
)

echo       [INFO] WSL environment detected. Checking PostgreSQL service...
wsl -u root -- which psql >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo       [PROVISIONING] Installing PostgreSQL in WSL...
    wsl -u root -- apt-get update >nul 2>&1
    wsl -u root -- apt-get install -y postgresql postgresql-contrib >nul 2>&1
)

wsl -u root -- which psql >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo       [INFO] PostgreSQL package not found in WSL. Assuming native Windows or Docker DB.
    goto sync_env
)

wsl -u root -- /usr/sbin/service postgresql start >nul 2>&1
:: Kata sandi DB acak per instalasi (tidak ada lagi sandi bawaan di skrip). Bila .env sudah berisi sandi sungguhan, pakai itu.
set "DB_PASS="
for /f "usebackq delims=" %%p in (`python -c "import re,secrets,pathlib; f=pathlib.Path(r'%ROOT%.env'); t=f.read_text(encoding='utf-8') if f.exists() else ''; m=re.search(r'DATABASE_URL=postgresql\+psycopg://[^:]+:([^@]+)@', t); m2=re.search(r'^POSTGRES_PASSWORD=(.+)$', t, re.M); existing=(m.group(1) if m and 'ganti-dengan' not in m.group(1) else (m2.group(1) if m2 and 'ganti-dengan' not in m2.group(1) else '')); print(existing.strip() if existing.strip() else secrets.token_urlsafe(18))"`) do set "DB_PASS=%%p"
wsl -u postgres -- psql -c "CREATE USER sis WITH PASSWORD '!DB_PASS!';" >nul 2>&1
wsl -u postgres -- psql -c "ALTER USER sis WITH PASSWORD '!DB_PASS!';" >nul 2>&1
wsl -u postgres -- psql -c "CREATE DATABASE sis OWNER sis;" >nul 2>&1
wsl -u root -- sh -c "sed -i \"s/#listen_addresses = 'localhost'/listen_addresses = '*'/\" /etc/postgresql/*/main/postgresql.conf" >nul 2>&1
wsl -u root -- sh -c "grep -q '172.16.0.0/12' /etc/postgresql/*/main/pg_hba.conf || echo 'host sis sis 172.16.0.0/12 scram-sha-256' >> /etc/postgresql/*/main/pg_hba.conf" >nul 2>&1
wsl -u root -- sh -c "grep -q '0.0.0.0/0' /etc/postgresql/*/main/pg_hba.conf || echo 'host sis sis 0.0.0.0/0 scram-sha-256' >> /etc/postgresql/*/main/pg_hba.conf" >nul 2>&1
wsl -u root -- /usr/sbin/service postgresql restart >nul 2>&1

for /f "tokens=1" %%i in ('wsl -u root -- hostname -I') do set "WSL_IP=%%i"

:sync_env
cd /d "%ROOT%backend"
call .venv\Scripts\activate.bat
python -c "import os, re, secrets; p = os.path.join(r'%ROOT%.', '.env'); t = open(p, 'r', encoding='utf-8').read(); ip = os.environ.get('WSL_IP', '').strip(); dp = os.environ.get('DB_PASS', '').strip(); t = re.sub(r'^#\s*(DATABASE_URL=)', r'\1', t, flags=re.M); t = (re.sub(r'^POSTGRES_PASSWORD=.*$', 'POSTGRES_PASSWORD=' + dp, t, flags=re.M) if dp and 'ganti-dengan' not in dp else t); t = (re.sub(r'(DATABASE_URL=postgresql\+psycopg://[^:]+:)[^@]+(@)', r'\g<1>' + dp + r'\2', t) if dp and 'ganti-dengan' not in dp else t); t = (re.sub(r'(@)[^:/]+(:5432)', r'\g<1>' + ip + r'\2', t) if ip else t); t = re.sub(r'JWT_SECRET=ganti-dengan-string-acak-panjang', 'JWT_SECRET=' + secrets.token_urlsafe(32), t); open(p, 'w', encoding='utf-8').write(t)"
if defined WSL_IP (
    echo       [INFO] Bound active WSL dynamic host IP: !WSL_IP!
)

python -c "import sys; from scripts.common import connect; conn = connect(wait_seconds=5); cur = conn.cursor(); cur.execute('SELECT count(*) FROM siswa'); sys.exit(0 if cur.fetchone()[0] > 0 else 1)" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo       [OK] Existing dataset detected - 612 students, 17 classes. Skipping bootstrap.
    goto step6
)

echo       [PROVISIONING] Database empty or unseeded. Initializing schema and dataset...
python -m scripts.bootstrap
if %ERRORLEVEL% EQU 0 (
    echo       [OK] Database schema and 21 dataset tables seeded successfully.
) else (
    set "SETUP_OK=0"
    echo       [WARNING] Could not connect to database automatically.
    echo       Ensure PostgreSQL or Docker is running and verify DATABASE_URL in .env.
)

:step6
cd /d "%ROOT%"
:: ------------------------------------------------------------------
:: STEP 6: Provision run.bat and Self-Destruct
:: ------------------------------------------------------------------
echo.
echo [6/6] Provisioning launcher script...
cd /d "%ROOT%backend"
call .venv\Scripts\activate.bat
python -c "import os; p = os.path.join(r'%ROOT%.', 'run.bat'); assert os.path.isfile(p) and os.path.getsize(p) > 200" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo       [PROVISIONING] Generating production launcher run.bat...
    python -c "import os; p = os.path.join(r'%ROOT%.', 'run.bat'); lines = ['@echo off','setlocal EnableDelayedExpansion','title School Intelligence System - Services Launcher','set \"ROOT=%%~dp0\"','cd /d \"%%ROOT%%\"','where wsl >nul 2>&1','if %%ERRORLEVEL%% EQU 0 (','    wsl -u root -- /usr/sbin/service postgresql start >nul 2>&1','    start \"SIS Database Keepalive\" /min wsl -u root -- sleep infinity','    for /f \"tokens=1\" %%%%i in (\x27wsl -u root -- hostname -I\x27) do set \"WSL_IP=%%%%i\"','    if defined WSL_IP (','        cd /d \"%%ROOT%%backend\"','        call .venv\\Scripts\\activate.bat','        python -c \"import os, re; p = os.path.join(r\x27%%ROOT%%.\x27, \x27.env\x27); ip = os.environ.get(\x27WSL_IP\x27, \x27\x27).strip(); t = open(p, \x27r\x27, encoding=\x27utf-8\x27).read(); t = re.sub(r\x27(@)[^:/]+(:5432)\x27, r\x27\\g<1>\x27 + ip + r\x27\\2\x27, t); open(p, \x27w\x27, encoding=\x27utf-8\x27).write(t)\" >nul 2>&1','        cd /d \"%%ROOT%%\"','    )',')','start \"SIS Backend - Port 8000\" cmd /k \"title SIS Backend - Port 8000 && cd /d \"%%ROOT%%backend\" && call .venv\\Scripts\\activate.bat && uvicorn app.main:app --reload --port 8000\"','start \"SIS Frontend - Port 3000\" cmd /k \"title SIS Frontend - Port 3000 && cd /d \"%%ROOT%%frontend\" && npm run dev\"','pause']; open(p, 'w', encoding='utf-8', newline='\r\n').write('\n'.join(lines) + '\n')"
)
echo       [OK] Production launcher run.bat verified and ready.
cd /d "%ROOT%"

echo.
echo ==============================================================================
echo                        SETUP COMPLETED SUCCESSFULLY
echo ==============================================================================
echo All prerequisites and dependencies are fully verified and operational.
echo Bila semua langkah berhasil, setup.bat akan dihapus otomatis.
echo.
echo To launch the application at any time, execute:
echo                             run.bat
echo ==============================================================================
echo.
pause

:: Hapus installer HANYA bila seluruh langkah berhasil; bila gagal, simpan agar bisa dijalankan ulang.
if "!SETUP_OK!"=="1" goto cleanup
echo [PERHATIAN] Inisialisasi database belum berhasil. setup.bat TIDAK dihapus; perbaiki lalu jalankan ulang.
pause
exit /b 1
:cleanup
(goto) 2>nul & del "%~f0"

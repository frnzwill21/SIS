"""Pengaturan bersama untuk skrip (impor, seed, bootstrap)."""
import os
import time
from pathlib import Path

import psycopg

from app.envfile import load_env

load_env()

ROOT = Path(__file__).resolve().parents[2]  # folder sis/

DATASET_DIR = Path(os.environ.get("DATASET_DIR", ROOT / "database" / "dataset_bersih"))
SQL_DIR = Path(os.environ.get("SQL_DIR", ROOT / "database" / "init"))
SEED_OUTPUT_DIR = Path(os.environ.get("SEED_OUTPUT_DIR", ROOT / "backend" / "seed_output"))

# Urutan muat: tabel induk dulu, tabel anak kemudian (sesuai foreign key).
LOAD_ORDER = [
    "jurusan", "guru", "mapel_jadwal", "mapel_rapor", "periode_akademik",
    "jenis_pelanggaran", "predikat_ekskul", "sesi_pkl",
    "kelas", "guru_mapel", "pemetaan_mapel", "siswa",
    "ekstrakurikuler", "pembina_ekskul", "perusahaan_pkl",
    "nilai", "kehadiran", "pelanggaran", "partisipasi_ekskul",
    "jadwal_pelajaran", "penempatan_pkl",
]

# Jumlah baris yang diharapkan dari dataset bersih (kelas XII).
EXPECTED_ROWS = {
    "jurusan": 5, "guru": 47, "mapel_jadwal": 13, "mapel_rapor": 26, "periode_akademik": 6,
    "jenis_pelanggaran": 25, "predikat_ekskul": 5, "sesi_pkl": 2, "kelas": 17, "guru_mapel": 51,
    "pemetaan_mapel": 9, "siswa": 612, "ekstrakurikuler": 19, "pembina_ekskul": 36,
    "perusahaan_pkl": 39, "nilai": 48384, "kehadiran": 3672, "pelanggaran": 473,
    "partisipasi_ekskul": 1978, "jadwal_pelajaran": 227, "penempatan_pkl": 612,
}


def database_url() -> str:
    """URL untuk psycopg langsung (tanpa awalan +psycopg milik SQLAlchemy)."""
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL belum diisi. Salin .env.example menjadi .env dan isi nilainya.")
    return url.replace("postgresql+psycopg://", "postgresql://")


def connect(wait_seconds: int = 30) -> psycopg.Connection:
    """Sambung ke PostgreSQL; ulangi sampai database siap (berguna di Docker)."""
    url = database_url()
    deadline = time.time() + wait_seconds
    while True:
        try:
            return psycopg.connect(url)
        except psycopg.OperationalError as exc:
            if time.time() > deadline:
                raise SystemExit(f"Tidak bisa tersambung ke database: {exc}")
            time.sleep(1)

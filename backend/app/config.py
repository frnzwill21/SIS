"""Pengaturan dari environment (.env)."""
import os
from pathlib import Path

from .envfile import load_env

load_env()

# Nilai contoh dari .env.example / setup.bat yang TIDAK boleh dipakai sungguhan.
_PLACEHOLDER_MARKERS = ("ganti-dengan", "changeme", "change-me", "your-secret", "contoh", "example")


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Variabel environment {name} belum diisi (lihat .env.example).")
    return value


def _strong_secret(name: str, min_len: int = 32) -> str:
    """JWT_SECRET wajib acak dan panjang: placeholder dari .env.example berarti siapa pun bisa menempa token admin."""
    value = _required(name)
    if len(value) < min_len or any(m in value.lower() for m in _PLACEHOLDER_MARKERS):
        raise RuntimeError(
            f"{name} masih berupa placeholder atau terlalu pendek (minimal {min_len} karakter). "
            "Buat nilai acak, mis.: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
        )
    return value


def _flag(name: str, default: str = "0") -> bool:
    return os.environ.get(name, default).strip().lower() in ("1", "true", "ya", "yes", "on")


class Settings:
    database_url: str = _required("DATABASE_URL")  # postgresql+psycopg://user:pass@host:5432/sis
    jwt_secret: str = _strong_secret("JWT_SECRET")
    jwt_expire_minutes: int = int(os.environ.get("JWT_EXPIRE_MINUTES", "120"))
    cors_origins: list[str] = [
        o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()
    ]
    gemini_api_key: str = os.environ.get("GEMINI_API_KEY", "")
    gemini_model: str = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")
    # Default MATI: data hasil query (nama, nilai, dst.) baru boleh dikirim ke Gemini setelah sekolah mengizinkan.
    # Teks pertanyaan guru untuk klasifikasi intent tetap dikirim selama GEMINI_API_KEY terisi.
    gemini_send_data: bool = _flag("GEMINI_SEND_DATA", "0")
    chat_rate_per_minute: int = int(os.environ.get("CHAT_RATE_PER_MINUTE", "20"))
    login_rate_per_minute: int = int(os.environ.get("LOGIN_RATE_PER_MINUTE", "10"))
    dataset_dir: str = os.environ.get(
        "DATASET_DIR", str(Path(__file__).resolve().parents[2] / "database" / "dataset_bersih")
    )


if "ganti-dengan" in Settings.database_url:
    raise RuntimeError("DATABASE_URL masih berisi placeholder kata sandi; isi dengan kredensial sungguhan.")

settings = Settings()

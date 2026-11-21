"""Autentikasi: bcrypt + JWT + pencabutan token persisten (token_version) & in-memory. Hanya dua peran: admin dan teacher."""
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from weakref import WeakKeyDictionary

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import Connection, inspect, text

from . import queries
from .config import settings
from .db import engine

ROLES = ("admin", "teacher")
_bearer = HTTPBearer(auto_error=False)
MAX_PASSWORD_BYTES = 72  # batas bcrypt; bcrypt>=5 melempar ValueError bila lebih

# Cache deteksi kolom token_version/token_exempt_jti per engine (agar kompatibel dgn skema SQLite uji minimal).
_tv_cols_lock = threading.Lock()
_tv_cols_cache: WeakKeyDictionary = WeakKeyDictionary()


def user_token_cols(conn: Connection) -> tuple[bool, bool]:
    """Kembalikan (punya_token_version, punya_token_exempt_jti) untuk tabel users pada engine aktif."""
    eng = conn.engine
    with _tv_cols_lock:
        cached = _tv_cols_cache.get(eng)
    if cached is not None:
        return cached
    try:
        cols = {c["name"] for c in inspect(conn).get_columns("users")}
        val = ("token_version" in cols, "token_exempt_jti" in cols)
    except Exception:  # noqa: BLE001
        val = (False, False)
    with _tv_cols_lock:
        _tv_cols_cache[eng] = val
    return val


def bump_token_version(conn: Connection, user_id: int, exempt_jti: str | None = None) -> None:
    """Naikkan token_version di DB agar pencabutan JWT bertahan lintas --reload/restart."""
    has_tv, has_exempt = user_token_cols(conn)
    if not has_tv:
        return
    if has_exempt:
        conn.execute(text(queries.USER_BUMP_TOKEN_VERSION), {"id": user_id, "exempt_jti": exempt_jti})
    elif exempt_jti is None:
        conn.execute(text(queries.USER_BUMP_TOKEN_VERSION_ONLY), {"id": user_id})

# Pencabutan token dalam memori proses (logout, ganti sandi, reset/nonaktif admin).
_revoke_lock = threading.Lock()
_revoked_jtis: dict[str, float] = {}  # jti -> exp unix timestamp
_revoked_users: dict[int, tuple[float, str | None]] = {}  # user_id -> (cutoff_ts, exempt_jti)


def _prune_revoked(now: float) -> None:
    expired = [jti for jti, exp in _revoked_jtis.items() if exp <= now]
    for jti in expired:
        _revoked_jtis.pop(jti, None)


def revoke_token(jti: str | None, exp: float | None = None) -> None:
    if not jti:
        return
    now = time.time()
    until = float(exp) if exp else now + settings.jwt_expire_minutes * 60
    with _revoke_lock:
        _prune_revoked(now)
        _revoked_jtis[jti] = until


def revoke_user_tokens(user_id: int, except_jti: str | None = None) -> None:
    """Batalkan semua JWT lama milik user_id (opsional: kecualikan sesi saat ini)."""
    with _revoke_lock:
        _revoked_users[user_id] = (time.time(), except_jti)


def is_token_revoked(claims: dict) -> bool:
    jti = claims.get("jti")
    sub = claims.get("sub")
    iat = claims.get("iat")
    with _revoke_lock:
        if jti and jti in _revoked_jtis:
            return True
        if sub is not None:
            try:
                uid = int(sub)
            except (TypeError, ValueError):
                return True
            entry = _revoked_users.get(uid)
            if entry is not None:
                cutoff, exempt_jti = entry
                if jti and exempt_jti and jti == exempt_jti:
                    return False
                # Token tanpa iat atau terbit pada/sebelum cutoff ditolak
                if iat is None or float(iat) <= cutoff:
                    return True
    return False


def clear_revocations() -> None:
    with _revoke_lock:
        _revoked_jtis.clear()
        _revoked_users.clear()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("ascii"))
    except ValueError:
        return False


def validate_new_password(password: str, username: str = "") -> str | None:
    """Pesan galat bila kata sandi baru tidak layak; None bila lolos. Panggil dari POST /auth/ganti-password."""
    if len(password) < 1:
        return "Kata sandi minimal 1 karakter."
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        return f"Kata sandi terlalu panjang (maksimal {MAX_PASSWORD_BYTES} byte)."
    if username and username.lower() in password.lower():
        return "Kata sandi tidak boleh memuat username."
    return None


def create_token(user_id: int, role: str, token_version: int = 1) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "role": role,
        "tv": int(token_version),
        "jti": secrets.token_hex(16),
        "iat": now.timestamp(),
        "exp": now + timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"], options={"require": ["exp", "sub"]})


def _error(code: int, kode: str, pesan: str) -> HTTPException:
    return HTTPException(status_code=code, detail={"code": kode, "message": pesan, "details": None})


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict:
    """Pengguna dari token. TIDAK menahan koneksi DB sesudah selesai (aman dipakai di endpoint yang memanggil Gemini).

    Peran dan token_version selalu diambil dari database, bukan hanya dari klaim token, sehingga perubahan peran,
    penonaktifan, logout, maupun reset sandi langsung berlaku dan bertahan lintas restart/reload.
    """
    if creds is None:
        raise _error(status.HTTP_401_UNAUTHORIZED, "UNAUTHORIZED", "Token tidak ada; silakan login.")
    try:
        data = decode_token(creds.credentials)
        user_id = int(data["sub"])
    except (jwt.PyJWTError, ValueError, TypeError):
        raise _error(status.HTTP_401_UNAUTHORIZED, "UNAUTHORIZED", "Token tidak valid atau kedaluwarsa.")
    if is_token_revoked(data):
        raise _error(status.HTTP_401_UNAUTHORIZED, "UNAUTHORIZED", "Sesi telah berakhir; silakan login kembali.")
    with engine.connect() as conn:  # koneksi pendek, langsung kembali ke kolam
        has_tv, has_exempt = user_token_cols(conn)
        sql = queries.USER_BY_ID_TV if (has_tv and has_exempt) else (queries.USER_BY_ID_TV_ONLY if has_tv else queries.USER_BY_ID)
        user = conn.execute(text(sql), {"id": user_id}).mappings().first()
    if user is None or not user["aktif"]:
        raise _error(status.HTTP_401_UNAUTHORIZED, "UNAUTHORIZED", "Akun tidak ditemukan atau dinonaktifkan.")
    if has_tv:
        db_tv = user.get("token_version")
        tv_claim = data.get("tv")
        exempt_jti = user.get("token_exempt_jti") if has_exempt else None
        is_exempt = bool(exempt_jti and data.get("jti") and data.get("jti") == exempt_jti)
        if db_tv is not None and tv_claim != db_tv and not is_exempt:
            raise _error(status.HTTP_401_UNAUTHORIZED, "UNAUTHORIZED", "Sesi telah berakhir; silakan login kembali.")
    out = dict(user)
    out.pop("token_version", None)
    out.pop("token_exempt_jti", None)
    out["_jti"] = data.get("jti")
    out["_exp"] = data.get("exp")
    return out


def active_user(user: dict = Depends(current_user)) -> dict:
    """Seperti current_user, tetapi menolak (403) selama kata sandi sementara belum diganti.

    Pakai ini untuk SEMUA endpoint data/chat/admin. Hanya /auth/me, /auth/ganti-password, dan /auth/logout
    yang boleh memakai current_user langsung. Sebelumnya kewajiban ganti sandi hanya dicek di frontend.
    """
    if user.get("wajib_ganti_password"):
        raise _error(status.HTTP_403_FORBIDDEN, "PASSWORD_CHANGE_REQUIRED", "Ganti kata sandi sementara Anda terlebih dahulu.")
    return user


def require_admin(user: dict = Depends(active_user)) -> dict:
    if user["role"] != "admin":
        raise _error(status.HTTP_403_FORBIDDEN, "FORBIDDEN", "Hanya admin yang boleh mengakses ini.")
    return user


_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def new_password(length: int = 12) -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))

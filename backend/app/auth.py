"""Autentikasi: bcrypt + JWT + pencabutan token persisten (token_version) & in-memory. 4 peran: admin, kepala_sekolah, bk, teacher."""
import re
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

ROLES = ("admin", "kepala_sekolah", "bk", "teacher")
PELANGGARAN_ROLES = ("admin", "kepala_sekolah", "bk")
_bearer = HTTPBearer(auto_error=False)
MAX_PASSWORD_BYTES = 72  # batas bcrypt; bcrypt>=5 melempar ValueError bila lebih

_COMMON_WEAK_PASSWORDS = frozenset({
    # Global umum & bocor
    "password",
    "password1",
    "password12",
    "password123",
    "password123!",
    "password1234",
    "passw0rd",
    "p@ssword",
    "p@ssw0rd",
    "12345678",
    "123456789",
    "1234567890",
    "01234567",
    "0123456789",
    "87654321",
    "987654321",
    "11111111",
    "00000000",
    "12341234",
    "12344321",
    "abcd1234",
    "abcdefgh",
    "qwerty",
    "qwertyui",
    "qwertyuiop",
    "qwerty12",
    "qwerty123",
    "qwerty123!",
    "qwerty1234",
    "asdfghjk",
    "asdfghjkl",
    "zxcvbnm1",
    "1q2w3e4r",
    "1qaz2wsx",
    "qazwsxedc",
    "zaq12wsx",
    "admin123",
    "admin123!",
    "admin1234",
    "administrator",
    "welcome1",
    "welcome123",
    "letmein1",
    "letmein123",
    "iloveyou",
    "sunshine",
    "princess",
    "football",
    "monkey123",
    "dragon123",
    "master123",
    "changeme",
    "default123",
    "test1234",
    "testing1",
    "guest123",
    "user1234",
    "login123",
    # Umum di Indonesia & lingkungan sekolah / SMKN 4 Bandung
    "indonesia",
    "indonesia1",
    "indonesia123",
    "merdeka1",
    "merdeka123",
    "nusantara",
    "pancasila",
    "garuda123",
    "bandung",
    "bandung1",
    "bandung123",
    "bandungjuara",
    "jawabarat",
    "jabarjuara",
    "jakarta1",
    "jakarta123",
    "surabaya",
    "semarang",
    "yogyakarta",
    "smkn4",
    "smkn4bdg",
    "smkn4bandung",
    "smkn4123",
    "smkn42024",
    "smkn42025",
    "smkn42026",
    "smkn4bdg123",
    "smkn4bandung123",
    "smkhebat",
    "smkbisa1",
    "smkbisa123",
    "sekolah",
    "sekolah1",
    "sekolah123",
    "sekolahku",
    "guru1234",
    "guruku123",
    "siswa123",
    "pelajar123",
    "pendidikan",
    "kurikulum",
    "akademik",
    "rahasia",
    "rahasia1",
    "rahasia123",
    "rahasia1234",
    "rahasiaku",
    "bismillah",
    "bismillah1",
    "bismillah123",
    "alhamdulillah",
    "insyaallah",
    "allah123",
    "astaghfirullah",
    "sayangku",
    "sayang123",
    "cintaku1",
    "cintaku123",
    "persib123",
    "persibbdg",
    "persibbandung",
    "viking123",
    "bobotoh1",
    "bobotoh123",
    "semangat",
    "semangat123",
    "mantap123",
    "sukses123",
    "juara123",
    "terbaik1",
    "sahabat1",
    "keluarga",
    "orangtua",
    "komputer",
    "teknologi",
    "informasi",
    "aplikasi",
})

_SEQUENTIAL_PATTERNS = (
    "abcdefghijklmnopqrstuvwxyz",
    "01234567890",
    "`1234567890-=",
    "qwertyuiop[]\\",
    "asdfghjkl;'",
    "zxcvbnm,./",
    "!@#$%^&*()_+",
)
_SEQUENTIAL_PATTERNS_BOTH = _SEQUENTIAL_PATTERNS + tuple(p[::-1] for p in _SEQUENTIAL_PATTERNS)

_USERNAME_ALLOWED_CHARS_RE = re.compile(r"^[a-zA-Z0-9._]+$")
_USERNAME_RE = re.compile(r"^(?!\.)(?!.*\.\.)[a-zA-Z0-9._]{3,30}(?<!\.)$")

_ACADEMIC_TITLES = frozenset({
    "s.pd",
    "s.pd.i",
    "m.pd",
    "m.pd.i",
    "s.kom",
    "s.st",
    "m.hum",
    "m.kom",
    "s.ag",
    "s.sn",
    "s.or",
    "s.kep",
    "s.sos",
    "s.si",
    "m.si",
    "s.t",
    "m.t",
    "s.tr.kom",
    "s.tr.t",
    "s.e",
    "s.h",
    "m.m",
    "m.sc",
    "ph.d",
    "drs",
    "dra",
    "prof",
})

# Cache deteksi kolom tabel users per engine (agar kompatibel dgn skema SQLite uji minimal).
_cols_lock = threading.Lock()
_cols_cache: WeakKeyDictionary = WeakKeyDictionary()


def _user_cols(conn: Connection) -> set[str]:
    """Kembalikan himpunan nama kolom tabel users pada engine aktif."""
    eng = conn.engine
    with _cols_lock:
        cached = _cols_cache.get(eng)
    if cached is not None:
        return cached
    try:
        cols = {c["name"] for c in inspect(conn).get_columns("users")}
    except Exception:  # noqa: BLE001
        return set()
    with _cols_lock:
        _cols_cache[eng] = cols
    return cols


def user_token_cols(conn: Connection) -> tuple[bool, bool]:
    """Kembalikan (punya_token_version, punya_token_exempt_jti) untuk tabel users pada engine aktif."""
    cols = _user_cols(conn)
    return ("token_version" in cols, "token_exempt_jti" in cols)


def user_has_foto_col(conn: Connection) -> bool:
    """Kembalikan apakah tabel users memiliki kolom foto_profil pada engine aktif."""
    return "foto_profil" in _user_cols(conn)


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


def _nama_tokens(nama: str) -> list[str]:
    tokens: list[str] = []
    for raw in re.split(r"[\s,;/()]+", nama):
        tok = raw.strip(".,;:()[]{}\"'`~!?").lower()
        if not tok or tok in _ACADEMIC_TITLES:
            continue
        if len(tok) >= 4:
            tokens.append(tok)
        for sub in tok.split("-"):
            if sub and sub not in _ACADEMIC_TITLES and len(sub) >= 4 and sub != tok:
                tokens.append(sub)
    return tokens


def validate_username(username: str) -> str | None:
    """Validasi format username ala Instagram (3-30 karakter: a-z, A-Z, 0-9, '.', '_'). None bila valid."""
    if not isinstance(username, str) or len(username) < 3:
        return "Username minimal 3 karakter."
    if len(username) > 30:
        return "Username maksimal 30 karakter."
    if not _USERNAME_ALLOWED_CHARS_RE.fullmatch(username):
        return "Username hanya boleh berisi huruf (a-z, A-Z), angka (0-9), titik (.), dan garis bawah (_)."
    if username.startswith(".") or username.endswith("."):
        return "Username tidak boleh diawali atau diakhiri dengan titik (.)."
    if ".." in username:
        return "Username tidak boleh mengandung dua titik berurutan (..)."
    if not _USERNAME_RE.fullmatch(username):
        return "Format username tidak valid."
    return None


def _is_repetitive_or_sequential(password: str) -> bool:
    """Deteksi kata sandi murni berulang (mis. aaaaaaaa, 11111111) atau urutan >=8 karakter."""
    pw = password.lower()
    n = len(pw)
    if n < 8:
        return False
    for unit_len in (1, 2, 3):
        unit = pw[:unit_len]
        if (unit * (n // unit_len + 1))[:n] == pw:
            return True
    for i in range(n - 7):
        chunk = pw[i : i + 8]
        if any(chunk in seq for seq in _SEQUENTIAL_PATTERNS_BOTH):
            return True
    return False


def validate_new_password(password: str, username: str = "", nama: str = "") -> str | None:
    """Pesan galat bila kata sandi baru tidak memenuhi NIST SP 800-63B Rev 4; None bila lolos."""
    if len(password) < 8:
        return "Kata sandi minimal 8 karakter."
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        return f"Kata sandi terlalu panjang (maksimal {MAX_PASSWORD_BYTES} byte)."
    pw_lower = password.lower()
    if pw_lower in _COMMON_WEAK_PASSWORDS or pw_lower.strip() in _COMMON_WEAK_PASSWORDS:
        return "Kata sandi terlalu umum dan mudah ditebak."
    if _is_repetitive_or_sequential(password):
        return "Kata sandi tidak boleh berupa karakter berulang atau urutan sederhana."
    uname = username.strip().lower()
    if len(uname) >= 3 and uname in pw_lower:
        return "Kata sandi tidak boleh memuat username."
    if nama:
        for tok in _nama_tokens(nama):
            if tok in pw_lower:
                return "Kata sandi tidak boleh memuat bagian dari nama Anda."
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


def can_view_pelanggaran(role: str | None) -> bool:
    return role in PELANGGARAN_ROLES


def require_admin(user: dict = Depends(active_user)) -> dict:
    if user["role"] != "admin":
        raise _error(status.HTTP_403_FORBIDDEN, "FORBIDDEN", "Hanya admin yang boleh mengakses ini.")
    return user


def require_pelanggaran_access(user: dict = Depends(active_user)) -> dict:
    if not can_view_pelanggaran(user.get("role")):
        raise _error(
            status.HTTP_403_FORBIDDEN,
            "FORBIDDEN",
            "Data pelanggaran siswa hanya dapat diakses oleh Admin, Kepala Sekolah, dan BK.",
        )
    return user


_PW_LOWER = "abcdefghjkmnpqrstuvwxyz"
_PW_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
_PW_DIGITS = "23456789"
_PW_SYMBOLS = "!@#$%&*"
_ALPHABET = _PW_LOWER + _PW_UPPER + _PW_DIGITS + _PW_SYMBOLS


def new_password(length: int = 12) -> str:
    """Buat kata sandi sementara acak yang selalu memuat huruf kecil, huruf besar, angka, dan simbol aman."""
    if length < 4:
        raise ValueError("Panjang kata sandi minimal 4 karakter.")
    chars = [
        secrets.choice(_PW_LOWER),
        secrets.choice(_PW_UPPER),
        secrets.choice(_PW_DIGITS),
        secrets.choice(_PW_SYMBOLS),
    ]
    chars.extend(secrets.choice(_ALPHABET) for _ in range(length - 4))
    for i in range(len(chars) - 1, 0, -1):
        j = secrets.randbelow(i + 1)
        chars[i], chars[j] = chars[j], chars[i]
    return "".join(chars)

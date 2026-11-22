import base64
import binascii
import re
import threading
import time
from collections import deque
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import Connection, inspect, text
from sqlalchemy.exc import IntegrityError

from .. import queries
from ..auth import (
    active_user,
    bump_token_version,
    create_token,
    current_user,
    hash_password,
    revoke_token,
    revoke_user_tokens,
    user_has_foto_col,
    user_token_cols,
    validate_new_password,
    validate_username,
    verify_password,
)
from ..config import settings
from ..db import engine as db_engine
from ..db import get_conn

router = APIRouter(prefix="/auth", tags=["auth"])

_login_hits: dict[str, deque] = {}
_login_lock = threading.Lock()
_MAX_BUCKETS = 1000


def _prune_bucket(key: str, now: float) -> deque | None:
    q = _login_hits.get(key)
    if q is None:
        return None
    while q and now - q[0] > 60:
        q.popleft()
    if not q:
        _login_hits.pop(key, None)
        return None
    return q


def _sweep_expired_buckets(now: float) -> None:
    if len(_login_hits) <= _MAX_BUCKETS:
        return
    for k in list(_login_hits.keys()):
        _prune_bucket(k, now)


def _login_rate_limit(ip: str, uname: str) -> None:
    per_user_limit = settings.login_rate_per_minute
    per_ip_limit = max(per_user_limit * 3, per_user_limit)
    now = time.monotonic()
    user_key = f"u:{ip}:{uname.lower()}"
    ip_key = f"ip:{ip}"
    with _login_lock:
        _sweep_expired_buckets(now)
        uq = _prune_bucket(user_key, now)
        iq = _prune_bucket(ip_key, now)
        if (uq is not None and len(uq) >= per_user_limit) or (iq is not None and len(iq) >= per_ip_limit):
            raise HTTPException(
                429,
                {
                    "code": "RATE_LIMITED",
                    "message": "Terlalu banyak percobaan login. Coba lagi 1 menit lagi.",
                    "details": None,
                },
            )
        if uq is None:
            uq = deque()
            _login_hits[user_key] = uq
        if iq is None:
            iq = deque()
            _login_hits[ip_key] = iq
        uq.append(now)
        iq.append(now)


def _audit_auth(user_id: int | None, aksi: str, detail: str, status: str) -> None:
    """Catat peristiwa autentikasi pada transaksi terpisah agar login gagal tetap tersimpan."""
    with db_engine.begin() as conn:
        conn.execute(
            text(queries.AUDIT_INSERT_STATUS),
            {"user_id": user_id, "aksi": aksi, "pertanyaan": detail, "tabel": "users", "status": status},
        )


class LoginIn(BaseModel):
    username: str
    password: str


class GantiPasswordIn(BaseModel):
    password_lama: str
    password_baru: str = Field(min_length=1)


class ProfilPatchIn(BaseModel):
    nama: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


class UsernamePatchIn(BaseModel):
    username_baru: str
    password_saat_ini: str


class FotoProfilIn(BaseModel):
    foto_profil: str = Field(min_length=1, max_length=4 * 1024 * 1024)


_AVATAR_URI_RE = re.compile(r"^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=\s]+)$")
_MAX_AVATAR_DECODED_BYTES = 2 * 1024 * 1024
_MAX_AVATAR_URI_LEN = 600_000


def _validate_avatar_data_uri(raw: str) -> str:
    """Validasi dan kanonisasi data URI gambar PNG/JPEG/WebP berdasarkan magic bytes asli."""
    def _bad(msg: str) -> HTTPException:
        return HTTPException(422, {"code": "VALIDATION_ERROR", "message": msg, "details": None})

    m = _AVATAR_URI_RE.fullmatch(raw.strip())
    if not m:
        raise _bad("Format foto profil harus berupa data URI gambar PNG, JPEG, atau WebP.")
    fmt, b64_raw = m.group(1), m.group(2)
    b64_compact = re.sub(r"\s+", "", b64_raw)
    if not b64_compact:
        raise _bad("Data gambar base64 tidak boleh kosong.")
    try:
        decoded = base64.b64decode(b64_compact, validate=True)
    except (binascii.Error, ValueError):
        raise _bad("Data gambar base64 tidak valid atau rusak.")
    if len(decoded) < 16 or len(decoded) > _MAX_AVATAR_DECODED_BYTES:
        raise _bad("Ukuran foto profil di luar batas yang diizinkan (16 byte - 2 MB).")
    if fmt == "png":
        valid_magic = decoded.startswith(b"\x89PNG\r\n\x1a\n")
    elif fmt == "jpeg":
        valid_magic = decoded.startswith(b"\xff\xd8\xff")
    elif fmt == "webp":
        valid_magic = len(decoded) >= 12 and decoded[:4] == b"RIFF" and decoded[8:12] == b"WEBP"
    else:
        valid_magic = False
    if not valid_magic:
        raise _bad("Isi berkas gambar tidak sesuai dengan format PNG, JPEG, atau WebP.")
    clean_b64 = base64.b64encode(decoded).decode("ascii")
    canonical = f"data:image/{fmt};base64,{clean_b64}"
    if len(canonical) > _MAX_AVATAR_URI_LEN:
        raise _bad("Ukuran foto profil terlalu besar (maksimal 600.000 karakter data URI).")
    return canonical


def _iso(val):
    return val.isoformat() if hasattr(val, "isoformat") else val


def _public(user: dict) -> dict:
    out = {k: user[k] for k in ("id", "username", "nama", "nip", "role", "wajib_ganti_password")}
    out["foto_profil"] = user.get("foto_profil")
    if "dibuat_pada" in user:
        out["dibuat_pada"] = _iso(user["dibuat_pada"])
    if "wali_kelas" in user:
        out["wali_kelas"] = list(user["wali_kelas"])
    return out


def _enrich_profile(conn: Connection, user: dict) -> dict:
    enriched = dict(user)
    try:
        insp = inspect(conn)
        user_cols = {c["name"] for c in insp.get_columns("users")}
        if "dibuat_pada" in user_cols and "dibuat_pada" not in enriched:
            row = conn.execute(text(queries.USER_DIBUAT_PADA), {"id": user["id"]}).first()
            enriched["dibuat_pada"] = _iso(row[0]) if row else None
        else:
            enriched.setdefault("dibuat_pada", None)
        if user_has_foto_col(conn) and "foto_profil" not in enriched:
            row_foto = conn.execute(text("SELECT foto_profil FROM users WHERE id = :id"), {"id": user["id"]}).first()
            enriched["foto_profil"] = row_foto[0] if row_foto else None
        else:
            enriched.setdefault("foto_profil", None)
        if user.get("nip") and insp.has_table("kelas"):
            kelas_rows = conn.execute(text(queries.WALI_KELAS_BY_NIP), {"nip": user["nip"]}).all()
            enriched["wali_kelas"] = [r[0] for r in kelas_rows]
        else:
            enriched["wali_kelas"] = []
    except Exception:  # noqa: BLE001
        enriched.setdefault("dibuat_pada", None)
        enriched.setdefault("foto_profil", None)
        enriched.setdefault("wali_kelas", [])
    return _public(enriched)


@router.post("/login")
def login(body: LoginIn, request: Request, conn: Connection = Depends(get_conn)):
    uname = body.username.strip()
    ip = request.client.host if request.client else "unknown"
    _login_rate_limit(ip, uname)
    has_tv, _ = user_token_cols(conn)
    sql = queries.USER_BY_USERNAME_TV if has_tv else queries.USER_BY_USERNAME
    user = conn.execute(text(sql), {"username": uname}).mappings().first()
    if user is None or not user["aktif"] or not verify_password(body.password, user["password_hash"]):
        _audit_auth(
            user["id"] if user else None,
            "login_gagal",
            f"username={uname[:50]} ip={ip}",
            "gagal",
        )
        raise HTTPException(401, {"code": "UNAUTHORIZED", "message": "Username atau kata sandi salah.", "details": None})
    _audit_auth(user["id"], "login_ok", f"username={uname[:50]} ip={ip}", "ok")
    tv = int(user["token_version"]) if has_tv and user.get("token_version") is not None else 1
    user_dict = dict(user)
    if user_has_foto_col(conn):
        row_foto = conn.execute(text("SELECT foto_profil FROM users WHERE id = :id"), {"id": user["id"]}).first()
        user_dict["foto_profil"] = row_foto[0] if row_foto else None
    else:
        user_dict["foto_profil"] = None
    return {
        "access_token": create_token(user["id"], user["role"], token_version=tv),
        "token_type": "bearer",
        "user": _public(user_dict),
    }


@router.post("/logout")
def logout(user: dict = Depends(current_user), conn: Connection = Depends(get_conn)):
    revoke_token(user.get("_jti"), user.get("_exp"))
    bump_token_version(conn, user["id"])
    return {"status": "ok"}


@router.get("/me")
def me(user: dict = Depends(current_user), conn: Connection = Depends(get_conn)):
    return _enrich_profile(conn, user)


@router.patch("/profil")
def ubah_profil(body: ProfilPatchIn, user: dict = Depends(active_user), conn: Connection = Depends(get_conn)):
    conn.execute(text(queries.USER_UPDATE_NAMA), {"nama": body.nama, "id": user["id"]})
    conn.execute(
        text(queries.AUDIT_INSERT),
        {"user_id": user["id"], "aksi": "ubah_profil", "pertanyaan": f"nama={body.nama[:100]}", "tabel": "users"},
    )
    return _enrich_profile(conn, {**user, "nama": body.nama})


@router.get("/cek-username")
def cek_username(
    username: str = Query(default=""),
    user: dict = Depends(active_user),
    conn: Connection = Depends(get_conn),
):
    u = username.strip()
    err = validate_username(u)
    if err:
        return {"available": False, "reason": err}
    if u.lower() == (user.get("username") or "").lower():
        return {"available": False, "reason": "Username ini sudah menjadi username Anda saat ini."}
    dup = conn.execute(
        text("SELECT id FROM users WHERE LOWER(username) = LOWER(:u) AND id <> :id"),
        {"u": u, "id": user["id"]},
    ).first()
    if dup is not None:
        return {"available": False, "reason": "Username sudah digunakan oleh akun lain."}
    return {"available": True, "reason": None}


@router.patch("/username")
def ubah_username(
    body: UsernamePatchIn,
    user: dict = Depends(active_user),
    conn: Connection = Depends(get_conn),
):
    new_u = body.username_baru.strip()
    err = validate_username(new_u)
    if err:
        raise HTTPException(422, {"code": "VALIDATION_ERROR", "message": err, "details": None})
    row = conn.execute(
        text("SELECT id, username, password_hash, aktif FROM users WHERE id = :id"),
        {"id": user["id"]},
    ).mappings().first()
    if row is None or not row["aktif"]:
        raise HTTPException(
            401,
            {"code": "UNAUTHORIZED", "message": "Akun tidak ditemukan atau dinonaktifkan.", "details": None},
        )
    if not verify_password(body.password_saat_ini, row["password_hash"]):
        raise HTTPException(
            400,
            {"code": "BAD_REQUEST", "message": "Kata sandi saat ini salah.", "details": None},
        )
    old_u = row["username"]
    if new_u.lower() == old_u.lower():
        raise HTTPException(
            422,
            {
                "code": "VALIDATION_ERROR",
                "message": "Username baru harus berbeda dari username saat ini.",
                "details": None,
            },
        )
    dup = conn.execute(
        text("SELECT id FROM users WHERE LOWER(username) = LOWER(:u) AND id <> :id"),
        {"u": new_u, "id": user["id"]},
    ).first()
    if dup is not None:
        raise HTTPException(
            409,
            {"code": "CONFLICT", "message": "Username sudah digunakan oleh akun lain.", "details": None},
        )
    try:
        conn.execute(
            text("UPDATE users SET username = :new_u WHERE id = :id"),
            {"new_u": new_u, "id": user["id"]},
        )
    except IntegrityError:
        raise HTTPException(
            409,
            {"code": "CONFLICT", "message": "Username sudah digunakan oleh akun lain.", "details": None},
        )
    conn.execute(
        text(queries.AUDIT_INSERT),
        {
            "user_id": user["id"],
            "aksi": "ganti_username",
            "pertanyaan": f"{old_u} -> {new_u}",
            "tabel": "users",
        },
    )
    return _enrich_profile(conn, {**user, "username": new_u})


@router.post("/cabut-sesi-lain")
def cabut_sesi_lain(user: dict = Depends(active_user), conn: Connection = Depends(get_conn)):
    bump_token_version(conn, user["id"], exempt_jti=user.get("_jti"))
    revoke_user_tokens(user["id"], except_jti=user.get("_jti"))
    conn.execute(
        text(queries.AUDIT_INSERT),
        {"user_id": user["id"], "aksi": "cabut_sesi_lain", "pertanyaan": f"user_id={user['id']}", "tabel": "users"},
    )
    return {"status": "ok"}


@router.get("/aktivitas")
def aktivitas_akun(user: dict = Depends(active_user), conn: Connection = Depends(get_conn)):
    rows = conn.execute(text(queries.USER_AKTIVITAS), {"user_id": user["id"]}).mappings().all()
    data = [
        {
            "id": int(r["id"]),
            "waktu": _iso(r["waktu"]),
            "aksi": r["aksi"],
            "pertanyaan": r["pertanyaan"],
            "status": r["status"],
        }
        for r in rows
    ]
    return {"data": data}


@router.post("/foto-profil")
def ubah_foto_profil(body: FotoProfilIn, user: dict = Depends(active_user), conn: Connection = Depends(get_conn)):
    clean_uri = _validate_avatar_data_uri(body.foto_profil)
    if not user_has_foto_col(conn):
        raise HTTPException(
            503,
            {"code": "SERVICE_UNAVAILABLE", "message": "Skema database belum mendukung foto profil.", "details": None},
        )
    conn.execute(text("UPDATE users SET foto_profil = :foto WHERE id = :id"), {"foto": clean_uri, "id": user["id"]})
    conn.execute(
        text(queries.AUDIT_INSERT),
        {"user_id": user["id"], "aksi": "ubah_foto_profil", "pertanyaan": f"user_id={user['id']}", "tabel": "users"},
    )
    return _enrich_profile(conn, {**user, "foto_profil": clean_uri})


@router.delete("/foto-profil")
def hapus_foto_profil(user: dict = Depends(active_user), conn: Connection = Depends(get_conn)):
    if not user_has_foto_col(conn):
        raise HTTPException(
            503,
            {"code": "SERVICE_UNAVAILABLE", "message": "Skema database belum mendukung foto profil.", "details": None},
        )
    conn.execute(text("UPDATE users SET foto_profil = NULL WHERE id = :id"), {"id": user["id"]})
    conn.execute(
        text(queries.AUDIT_INSERT),
        {"user_id": user["id"], "aksi": "hapus_foto_profil", "pertanyaan": f"user_id={user['id']}", "tabel": "users"},
    )
    return _enrich_profile(conn, {**user, "foto_profil": None})


@router.post("/ganti-password")
def ganti_password(body: GantiPasswordIn, user: dict = Depends(current_user), conn: Connection = Depends(get_conn)):
    msg = validate_new_password(body.password_baru, user.get("username", ""), nama=user.get("nama", ""))
    if msg:
        raise HTTPException(422, {"code": "VALIDATION_ERROR", "message": msg, "details": None})
    row = conn.execute(text(queries.USER_AUTH_BY_ID), {"id": user["id"]}).mappings().first()
    if row is None or not row["aktif"]:
        raise HTTPException(401, {"code": "UNAUTHORIZED", "message": "Akun tidak ditemukan atau dinonaktifkan.", "details": None})
    if not verify_password(body.password_lama, row["password_hash"]):
        raise HTTPException(400, {"code": "BAD_REQUEST", "message": "Kata sandi lama salah.", "details": None})
    if verify_password(body.password_baru, row["password_hash"]):
        raise HTTPException(
            422,
            {
                "code": "VALIDATION_ERROR",
                "message": "Kata sandi baru tidak boleh sama dengan kata sandi saat ini.",
                "details": None,
            },
        )
    conn.execute(text(queries.USER_SET_PASSWORD), {"hash": hash_password(body.password_baru), "id": user["id"]})
    bump_token_version(conn, user["id"], exempt_jti=user.get("_jti"))
    conn.execute(
        text(queries.AUDIT_INSERT),
        {"user_id": user["id"], "aksi": "ganti_password", "pertanyaan": f"user_id={user['id']}", "tabel": "users"},
    )
    revoke_user_tokens(user["id"], except_jti=user.get("_jti"))
    return {"status": "ok"}

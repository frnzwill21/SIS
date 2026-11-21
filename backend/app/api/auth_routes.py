import threading
import time
from collections import deque

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import Connection, text

from .. import queries
from ..auth import (
    bump_token_version,
    create_token,
    current_user,
    hash_password,
    revoke_token,
    revoke_user_tokens,
    user_token_cols,
    validate_new_password,
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


def _public(user: dict) -> dict:
    return {k: user[k] for k in ("id", "username", "nama", "nip", "role", "wajib_ganti_password")}


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
    return {
        "access_token": create_token(user["id"], user["role"], token_version=tv),
        "token_type": "bearer",
        "user": _public(dict(user)),
    }


@router.post("/logout")
def logout(user: dict = Depends(current_user), conn: Connection = Depends(get_conn)):
    revoke_token(user.get("_jti"), user.get("_exp"))
    bump_token_version(conn, user["id"])
    return {"status": "ok"}


@router.get("/me")
def me(user: dict = Depends(current_user)):
    return _public(user)


@router.post("/ganti-password")
def ganti_password(body: GantiPasswordIn, user: dict = Depends(current_user), conn: Connection = Depends(get_conn)):
    msg = validate_new_password(body.password_baru, user.get("username", ""))
    if msg:
        raise HTTPException(422, {"code": "VALIDATION_ERROR", "message": msg, "details": None})
    row = conn.execute(text(queries.USER_AUTH_BY_ID), {"id": user["id"]}).mappings().first()
    if row is None or not row["aktif"]:
        raise HTTPException(401, {"code": "UNAUTHORIZED", "message": "Akun tidak ditemukan atau dinonaktifkan.", "details": None})
    if not verify_password(body.password_lama, row["password_hash"]):
        raise HTTPException(400, {"code": "BAD_REQUEST", "message": "Kata sandi lama salah.", "details": None})
    conn.execute(text(queries.USER_SET_PASSWORD), {"hash": hash_password(body.password_baru), "id": user["id"]})
    bump_token_version(conn, user["id"], exempt_jti=user.get("_jti"))
    conn.execute(
        text(queries.AUDIT_INSERT),
        {"user_id": user["id"], "aksi": "ganti_password", "pertanyaan": f"user_id={user['id']}", "tabel": "users"},
    )
    revoke_user_tokens(user["id"], except_jti=user.get("_jti"))
    return {"status": "ok"}

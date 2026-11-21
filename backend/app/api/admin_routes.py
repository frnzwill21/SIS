"""Endpoint khusus admin: akun, audit log, riwayat impor."""
import re
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field, StringConstraints, field_validator
from sqlalchemy import Connection, text
from sqlalchemy.exc import IntegrityError

from .. import queries
from ..auth import bump_token_version, hash_password, new_password, require_admin, revoke_user_tokens
from ..db import get_conn

router = APIRouter(tags=["admin"], dependencies=[Depends(require_admin)])
WIB = timezone(timedelta(hours=7))


def _audit(conn: Connection, admin: dict, aksi: str, detail: str) -> None:
    """Tindakan admin (buat/ubah akun, reset sandi) juga dicatat. Jangan pernah menulis kata sandi ke sini."""
    conn.execute(text(queries.AUDIT_INSERT), {"user_id": admin["id"], "aksi": aksi, "pertanyaan": detail, "tabel": "users"})


def _err(code: int, kode: str, pesan: str) -> HTTPException:
    return HTTPException(code, {"code": kode, "message": pesan, "details": None})


class UserIn(BaseModel):
    username: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=50)]
    nama: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    role: Literal["admin", "teacher"]
    nip: str | None = Field(default=None, max_length=30)

    @field_validator("nip", mode="before")
    @classmethod
    def _clean_nip(cls, v):
        if isinstance(v, str):
            v = v.strip()
            return v or None
        return v


class UserPatch(BaseModel):
    aktif: bool | None = None
    reset_password: bool = False


@router.get("/users")
def daftar_user(conn: Connection = Depends(get_conn)):
    return {"data": [dict(r) for r in conn.execute(text(queries.USERS_LIST)).mappings().all()]}


@router.post("/users", status_code=201)
def buat_user(body: UserIn, response: Response, admin: dict = Depends(require_admin), conn: Connection = Depends(get_conn)):
    response.headers["Cache-Control"] = "no-store"  # respons memuat kata sandi awal
    if not re.fullmatch(r"[a-zA-Z0-9._-]+", body.username):
        raise _err(422, "VALIDATION_ERROR", "Username hanya boleh huruf, angka, titik, garis bawah, dan strip.")
    if conn.execute(text(queries.USER_BY_USERNAME), {"username": body.username}).first():
        raise _err(409, "CONFLICT", "Username sudah dipakai.")
    if body.nip and not conn.execute(text("SELECT 1 FROM guru WHERE nip = :nip"), {"nip": body.nip}).first():
        raise _err(422, "VALIDATION_ERROR", "NIP tidak ada di data guru.")
    password = new_password()
    try:
        new_id = conn.execute(
            text(queries.USER_INSERT),
            {"username": body.username, "nama": body.nama, "nip": body.nip, "role": body.role, "hash": hash_password(password)},
        ).scalar_one()
    except IntegrityError:  # dua admin membuat username yang sama bersamaan (cek di atas bukan jaminan)
        raise _err(409, "CONFLICT", "Username sudah dipakai.")
    _audit(conn, admin, "admin_buat_user", f"user_id={new_id} username={body.username} role={body.role}")
    # kata sandi awal hanya ditampilkan sekali ini
    return {"id": new_id, "username": body.username, "role": body.role, "password_awal": password}


@router.patch("/users/{user_id}")
def ubah_user(user_id: int, body: UserPatch, response: Response, admin: dict = Depends(require_admin), conn: Connection = Depends(get_conn)):
    target = conn.execute(text(queries.USER_BY_ID), {"id": user_id}).mappings().first()
    if not target:
        raise _err(404, "NOT_FOUND", "Akun tidak ditemukan.")
    if body.reset_password and target["id"] == admin["id"]:
        raise _err(409, "CONFLICT", "Gunakan Pengaturan Akun (/akun) untuk mengganti kata sandi Anda sendiri.")
    out: dict = {"id": user_id}
    if body.aktif is False:
        if target["id"] == admin["id"]:
            raise _err(409, "CONFLICT", "Tidak bisa menonaktifkan akun Anda sendiri.")
        if target["role"] == "admin":
            if conn.dialect.name == "postgresql":
                active_ids = [r[0] for r in conn.execute(text(queries.ADMIN_AKTIF_LOCK)).all()]
                other_admins = sum(1 for uid in active_ids if uid != user_id)
            else:
                other_admins = conn.execute(text(queries.ADMIN_AKTIF_LAIN), {"id": user_id}).scalar_one()
            if other_admins == 0:
                raise _err(409, "CONFLICT", "Tidak bisa menonaktifkan admin aktif terakhir.")
    if body.aktif is not None:
        conn.execute(text(queries.USER_UPDATE_AKTIF), {"aktif": body.aktif, "id": user_id})
        if body.aktif is False:
            bump_token_version(conn, user_id)
            revoke_user_tokens(user_id)
        out["aktif"] = body.aktif
        _audit(conn, admin, "admin_ubah_aktif", f"user_id={user_id} aktif={body.aktif}")
    if body.reset_password:
        response.headers["Cache-Control"] = "no-store"
        password = new_password()
        conn.execute(text(queries.USER_RESET_PASSWORD), {"hash": hash_password(password), "id": user_id})
        bump_token_version(conn, user_id)
        revoke_user_tokens(user_id)
        out["password_baru"] = password
        _audit(conn, admin, "admin_reset_password", f"user_id={user_id}")
    return out


def _wib_bounds(dari: date | None, sampai: date | None, is_pg: bool):
    """Konversi tanggal filter WIB (Asia/Jakarta) ke batas setengah-terbuka [dari, sampai+1)."""
    dari_dt = datetime(dari.year, dari.month, dari.day, 0, 0, 0, tzinfo=WIB) if dari else None
    sampai_dt = (
        datetime(sampai.year, sampai.month, sampai.day, 0, 0, 0, tzinfo=WIB) + timedelta(days=1)
        if sampai
        else None
    )
    if is_pg:
        return dari_dt, sampai_dt
    return (
        dari_dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S") if dari_dt else None,
        sampai_dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S") if sampai_dt else None,
    )


@router.get("/admin/audit")
def audit(
    user: str = "",  # sesuai dokumen 03: ?user=&dari=&sampai=
    username: str = "",  # alias lama, tetap diterima agar frontend yang ada tidak putus
    dari: date | None = None,
    sampai: date | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    conn: Connection = Depends(get_conn),
):
    is_pg = conn.dialect.name == "postgresql"
    dari_bound, sampai_bound = _wib_bounds(dari, sampai, is_pg)
    f = {"username": (user or username).strip(), "dari": dari_bound, "sampai": sampai_bound}
    list_sql = queries.AUDIT_LIST if is_pg else queries.AUDIT_LIST_GENERIC
    count_sql = queries.AUDIT_COUNT if is_pg else queries.AUDIT_COUNT_GENERIC
    rows = conn.execute(text(list_sql), {**f, "limit": page_size, "offset": (page - 1) * page_size}).mappings().all()
    total = conn.execute(text(count_sql), f).scalar_one()
    return {"data": [dict(r) for r in rows], "meta": {"page": page, "page_size": page_size, "total": total}}


@router.get("/admin/impor")
def riwayat_impor(conn: Connection = Depends(get_conn)):
    return {"data": [dict(r) for r in conn.execute(text(queries.IMPORT_LIST)).mappings().all()]}

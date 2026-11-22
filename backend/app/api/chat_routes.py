"""POST /chat & manajemen sesi percakapan (/chat/sesi). Semua pertanyaan dicatat di audit_log, termasuk yang GAGAL."""
import json
import threading
import time
import uuid
from collections import deque
from contextlib import contextmanager
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import Connection, inspect, text

from .. import engine, queries
from ..auth import active_user
from ..config import settings
from ..db import engine as db_engine
from ..db import get_conn
from ..engine import titler
from ..engine.core import bound, plain

router = APIRouter(tags=["chat"])


class SaDb:
    """Adaptor SQLAlchemy untuk antarmuka Db milik engine."""

    def __init__(self, conn: Connection) -> None:
        self.conn = conn

    def rows(self, sql: str, **params) -> list[dict]:
        result = self.conn.execute(text(sql), bound(sql, params)).mappings().all()
        return [{k: plain(v) for k, v in row.items()} for row in result]


@contextmanager
def _db_scope():
    """Transaksi pendek khusus query data. Dibuka engine HANYA di sekitar handlers.run (bukan selama panggilan Gemini)."""
    with db_engine.begin() as conn:
        yield SaDb(conn)


# ---- pembatas laju sederhana per pengguna (memori proses; cukup untuk satu instance uvicorn) --------------------
_hits: dict[int, deque] = {}
_hits_lock = threading.Lock()
_MAX_BUCKETS = 500


def _prune_user(user_id: int, now: float) -> deque | None:
    q = _hits.get(user_id)
    if q is None:
        return None
    while q and now - q[0] > 60:
        q.popleft()
    if not q:
        _hits.pop(user_id, None)
        return None
    return q


def _rate_limit(user_id: int) -> None:
    limit, now = settings.chat_rate_per_minute, time.monotonic()
    with _hits_lock:
        if len(_hits) > _MAX_BUCKETS:
            for uid in list(_hits.keys()):
                _prune_user(uid, now)
        q = _prune_user(user_id, now)
        if q is not None and len(q) >= limit:
            raise HTTPException(429, {"code": "RATE_LIMITED", "message": "Terlalu banyak pertanyaan. Coba lagi sebentar lagi.", "details": None})
        if q is None:
            q = deque()
            _hits[user_id] = q
        q.append(now)


class ChatIn(BaseModel):
    pesan: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
    sesi_id: str | None = None


class SesiPatchIn(BaseModel):
    judul: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)] | None = None
    pinned: bool | None = None


class UndoTurnIn(BaseModel):
    message_id: int = Field(..., ge=1)


def _iso(val):
    return val.isoformat() if hasattr(val, "isoformat") else val


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _has_chat_tables(conn: Connection) -> bool:
    try:
        insp = inspect(conn)
        return bool(insp.has_table("chat_sessions") and insp.has_table("chat_messages"))
    except Exception:  # noqa: BLE001
        return False


def _session_dict(row: dict) -> dict:
    out = {
        "id": row["id"],
        "judul": row["judul"],
        "pinned": bool(row["pinned"]),
        "dibuat_pada": _iso(row["dibuat_pada"]),
        "diperbarui_pada": _iso(row["diperbarui_pada"]),
    }
    if "jumlah_pesan" in row:
        out["jumlah_pesan"] = int(row["jumlah_pesan"] or 0)
    return out


def _not_found_session() -> HTTPException:
    return HTTPException(404, {"code": "NOT_FOUND", "message": "Sesi percakapan tidak ditemukan.", "details": None})


def _write_audit(user: dict, pesan: str, out: dict | None, status: str) -> None:
    """Transaksi TERPISAH dari query data: audit tetap tersimpan walau engine/handler gagal.

    Sengaja tidak menelan galat: bila audit gagal ditulis, request ikut gagal (jawaban sensitif tidak boleh keluar
    tanpa jejak).
    """
    out = out or {"sensitif": False, "intent": {}, "sumber": []}
    with db_engine.begin() as conn:
        conn.execute(
            text(queries.AUDIT_CHAT),
            {
                "user_id": user["id"],
                "aksi": "chat_data_sensitif" if out["sensitif"] else "chat",
                "pertanyaan": pesan,
                "intent": json.dumps(out["intent"], ensure_ascii=False),
                "tabel": ",".join(out["sumber"]),
                "status": status,
            },
        )


def _insert_message(conn: Connection, sql: str, params: dict) -> int:
    if conn.dialect.name == "postgresql":
        return int(conn.execute(text(f"{sql} RETURNING id"), params).scalar_one())
    res = conn.execute(text(sql), params)
    return int(res.lastrowid)


def _persist_turn(
    user_id: int,
    req_sesi_id: str | None,
    pesan: str,
    out: dict,
    precomputed_title: str | None = None,
) -> tuple[str | None, str | None, int | None, int | None]:
    intent_obj = out.get("intent")
    intent_name = intent_obj.get("intent") if isinstance(intent_obj, dict) else ""
    new_title = precomputed_title
    if req_sesi_id is None and new_title is None:
        new_title = titler.generate_session_title(pesan, intent_obj)

    with db_engine.begin() as conn:
        if not _has_chat_tables(conn):
            return req_sesi_id, None, None, None
        if req_sesi_id:
            existing = conn.execute(
                text(queries.CHAT_SESI_BY_ID), {"id": req_sesi_id, "user_id": user_id}
            ).mappings().first()
            if not existing:
                raise _not_found_session()
            sesi_id = req_sesi_id
            judul_sesi = existing["judul"]
            is_default_title = (judul_sesi or "").strip().lower() == titler.DEFAULT_TITLE.lower()
            if is_default_title and intent_name != "sapaan":
                upgraded = new_title or titler.generate_session_title(pesan, intent_obj)
                if upgraded and upgraded.strip().lower() != titler.DEFAULT_TITLE.lower():
                    judul_sesi = upgraded
                    conn.execute(
                        text(queries.CHAT_SESI_UPDATE_JUDUL),
                        {"id": sesi_id, "user_id": user_id, "judul": judul_sesi},
                    )
                else:
                    conn.execute(text(queries.CHAT_SESI_TOUCH), {"id": sesi_id, "user_id": user_id})
            else:
                conn.execute(text(queries.CHAT_SESI_TOUCH), {"id": sesi_id, "user_id": user_id})
        else:
            sesi_id = str(uuid.uuid4())
            judul_sesi = new_title or titler.DEFAULT_TITLE
            conn.execute(
                text(queries.CHAT_SESI_INSERT),
                {"id": sesi_id, "user_id": user_id, "judul": judul_sesi},
            )

        meta_expr = "CAST(:meta AS JSONB)" if conn.dialect.name == "postgresql" else ":meta"
        user_msg_id = _insert_message(
            conn,
            "INSERT INTO chat_messages (session_id, role, konten, metadata_json) "
            "VALUES (:sid, 'user', :konten, NULL)",
            {"sid": sesi_id, "konten": pesan},
        )
        ai_meta = {
            "tabel": out["tabel"],
            "sumber": out["sumber"],
            "intent": out["intent"],
            "mode": out["mode"],
            "sensitif": out["sensitif"],
            "butuh_klarifikasi": out["butuh_klarifikasi"],
            "contoh": out["contoh"],
            "jejak_pikir": out.get("jejak_pikir", []),
            "total_durasi_ms": out.get("total_durasi_ms", 0),
        }
        ai_msg_id = _insert_message(
            conn,
            f"INSERT INTO chat_messages (session_id, role, konten, metadata_json) "
            f"VALUES (:sid, 'ai', :konten, {meta_expr})",
            {
                "sid": sesi_id,
                "konten": out["jawaban"],
                "meta": json.dumps(ai_meta, ensure_ascii=False),
            },
        )
        return sesi_id, judul_sesi, user_msg_id, ai_msg_id


@router.get("/chat/sesi")
def daftar_sesi(
    q: str = "",
    limit: int = Query(50, ge=1, le=200),
    user: dict = Depends(active_user),
    conn: Connection = Depends(get_conn),
):
    if not _has_chat_tables(conn):
        return {"data": []}
    rows = conn.execute(
        text(queries.CHAT_SESI_LIST),
        {"user_id": user["id"], "q": _escape_like(q.strip()), "limit": limit},
    ).mappings().all()
    return {"data": [_session_dict(dict(r)) for r in rows]}


@router.get("/chat/sesi/{sesi_id}")
def detail_sesi(
    sesi_id: str,
    user: dict = Depends(active_user),
    conn: Connection = Depends(get_conn),
):
    if not _has_chat_tables(conn):
        raise _not_found_session()
    sesi = conn.execute(
        text(queries.CHAT_SESI_BY_ID), {"id": sesi_id, "user_id": user["id"]}
    ).mappings().first()
    if not sesi:
        raise _not_found_session()
    msgs = conn.execute(text(queries.CHAT_MESSAGES_BY_SESI), {"session_id": sesi_id}).mappings().all()
    out_msgs = []
    for m in msgs:
        meta = m["metadata_json"]
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except json.JSONDecodeError:
                meta = None
        out_msgs.append(
            {
                "id": int(m["id"]),
                "role": m["role"],
                "konten": m["konten"],
                "metadata": meta,
                "dibuat_pada": _iso(m["dibuat_pada"]),
            }
        )
    return {"sesi": _session_dict(dict(sesi)), "messages": out_msgs}


@router.patch("/chat/sesi/{sesi_id}")
def ubah_sesi(
    sesi_id: str,
    body: SesiPatchIn,
    user: dict = Depends(active_user),
    conn: Connection = Depends(get_conn),
):
    if not _has_chat_tables(conn):
        raise _not_found_session()
    sesi = conn.execute(
        text(queries.CHAT_SESI_BY_ID), {"id": sesi_id, "user_id": user["id"]}
    ).mappings().first()
    if not sesi:
        raise _not_found_session()
    sets: list[str] = []
    params: dict = {"id": sesi_id, "user_id": user["id"]}
    if body.judul is not None:
        sets.append("judul = :judul")
        sets.append("diperbarui_pada = CURRENT_TIMESTAMP")
        params["judul"] = body.judul
    if body.pinned is not None:
        sets.append("pinned = :pinned")
        params["pinned"] = bool(body.pinned)
    if sets:
        conn.execute(
            text(f"UPDATE chat_sessions SET {', '.join(sets)} WHERE id = :id AND user_id = :user_id"),
            params,
        )
    updated = conn.execute(
        text(queries.CHAT_SESI_ONE_WITH_COUNT), {"id": sesi_id, "user_id": user["id"]}
    ).mappings().one()
    return _session_dict(dict(updated))


@router.delete("/chat/sesi/{sesi_id}")
def hapus_sesi(
    sesi_id: str,
    user: dict = Depends(active_user),
    conn: Connection = Depends(get_conn),
):
    if not _has_chat_tables(conn):
        raise _not_found_session()
    sesi = conn.execute(
        text(queries.CHAT_SESI_BY_ID), {"id": sesi_id, "user_id": user["id"]}
    ).mappings().first()
    if not sesi:
        raise _not_found_session()
    conn.execute(text(queries.CHAT_SESI_DELETE_MESSAGES), {"id": sesi_id})
    conn.execute(text(queries.CHAT_SESI_DELETE), {"id": sesi_id, "user_id": user["id"]})
    return {"status": "ok"}


@router.delete("/chat/sesi")
def hapus_semua_sesi_tidak_disematkan(
    user: dict = Depends(active_user),
    conn: Connection = Depends(get_conn),
):
    if not _has_chat_tables(conn):
        return {"deleted": 0}
    conn.execute(text(queries.CHAT_SESI_DELETE_UNPINNED_MESSAGES), {"user_id": user["id"]})
    res = conn.execute(text(queries.CHAT_SESI_DELETE_UNPINNED), {"user_id": user["id"]})
    return {"deleted": int(res.rowcount or 0)}


@router.post("/chat/sesi/{sesi_id}/undo")
def batalkan_giliran_chat(
    sesi_id: str,
    body: UndoTurnIn,
    user: dict = Depends(active_user),
    conn: Connection = Depends(get_conn),
):
    if not _has_chat_tables(conn):
        raise _not_found_session()
    sesi = conn.execute(
        text(queries.CHAT_SESI_BY_ID), {"id": sesi_id, "user_id": user["id"]}
    ).mappings().first()
    if not sesi:
        raise _not_found_session()
    user_row = conn.execute(
        text(
            "SELECT id, role, konten FROM chat_messages "
            "WHERE id = :mid AND session_id = :sid AND role = 'user'"
        ),
        {"mid": body.message_id, "sid": sesi_id},
    ).mappings().first()
    if not user_row:
        raise HTTPException(
            404,
            {"code": "NOT_FOUND", "message": "Pesan pengguna tidak ditemukan pada sesi ini.", "details": None},
        )
    res = conn.execute(
        text("DELETE FROM chat_messages WHERE session_id = :sid AND id >= :mid"),
        {"sid": sesi_id, "mid": body.message_id},
    )
    deleted = int(res.rowcount or 0)
    conn.execute(text(queries.CHAT_SESI_TOUCH), {"id": sesi_id, "user_id": user["id"]})
    remaining = conn.execute(
        text("SELECT COUNT(*) FROM chat_messages WHERE session_id = :sid"),
        {"sid": sesi_id},
    ).scalar_one()
    return {
        "deleted": deleted,
        "restored_text": user_row["konten"],
        "remaining": int(remaining or 0),
    }


@router.post("/chat")
def chat(body: ChatIn, user: dict = Depends(active_user)):
    _rate_limit(user["id"])
    req_sesi_id = body.sesi_id.strip() if body.sesi_id and body.sesi_id.strip() else None
    existing_judul: str | None = None
    history: list[dict] = []
    if req_sesi_id:
        with db_engine.connect() as conn:
            if _has_chat_tables(conn):
                owned = conn.execute(
                    text(queries.CHAT_SESI_BY_ID), {"id": req_sesi_id, "user_id": user["id"]}
                ).mappings().first()
                if not owned:
                    raise _not_found_session()
                existing_judul = owned["judul"]
                rows = conn.execute(
                    text(
                        "SELECT role, konten, metadata_json "
                        "FROM chat_messages "
                        "WHERE session_id = :sid "
                        "ORDER BY id DESC LIMIT 6"
                    ),
                    {"sid": req_sesi_id},
                ).mappings().all()
                for r in reversed(rows):
                    meta = r["metadata_json"]
                    if isinstance(meta, str):
                        try:
                            meta = json.loads(meta)
                        except json.JSONDecodeError:
                            meta = None
                    history.append(
                        {
                            "role": r["role"],
                            "konten": r["konten"],
                            "intent": meta.get("intent") if isinstance(meta, dict) else None,
                        }
                    )

    out: dict | None = None
    status = "error"
    try:
        out = engine.answer(_db_scope, body.pesan, role=user.get("role", "teacher"), history=history)
        status = (
            "ditolak"
            if out.get("ditolak")
            else ("error" if out["galat"] else ("perlu_klarifikasi" if out["butuh_klarifikasi"] else "ok"))
        )
        intent_obj = out.get("intent")
        intent_name = intent_obj.get("intent") if isinstance(intent_obj, dict) else ""
        needs_title = (req_sesi_id is None) or (
            existing_judul is not None
            and existing_judul.strip().lower() == titler.DEFAULT_TITLE.lower()
            and intent_name != "sapaan"
        )
        precomputed_title = titler.generate_session_title(body.pesan, intent_obj) if needs_title else None
        sesi_id, judul_sesi, user_msg_id, ai_msg_id = _persist_turn(
            user["id"], req_sesi_id, body.pesan, out, precomputed_title=precomputed_title
        )
        return {
            "jawaban": out["jawaban"],
            "tabel": out["tabel"],
            "sumber": out["sumber"],
            "intent": out["intent"],
            "mode": out["mode"],
            "sensitif": out["sensitif"],
            "butuh_klarifikasi": out["butuh_klarifikasi"],
            "contoh": out["contoh"],
            "sesi_id": sesi_id,
            "judul_sesi": judul_sesi,
            "user_message_id": user_msg_id,
            "ai_message_id": ai_msg_id,
            "jejak_pikir": out.get("jejak_pikir", []),
            "total_durasi_ms": out.get("total_durasi_ms", 0),
        }
    finally:
        _write_audit(user, body.pesan, out, status)

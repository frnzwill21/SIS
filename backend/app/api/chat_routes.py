"""POST /chat: pintu masuk Hybrid Query Engine. Semua pertanyaan dicatat di audit_log, termasuk yang GAGAL."""
import json
import threading
import time
from collections import deque
from contextlib import contextmanager
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, StringConstraints
from sqlalchemy import Connection, text

from .. import engine, queries
from ..auth import active_user
from ..config import settings
from ..db import engine as db_engine
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
    sesi_id: str | None = None  # belum dipakai: engine masih tanpa memori percakapan


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


@router.post("/chat")
def chat(body: ChatIn, user: dict = Depends(active_user)):
    _rate_limit(user["id"])
    out: dict | None = None
    status = "error"
    try:
        out = engine.answer(_db_scope, body.pesan)
        status = "error" if out["galat"] else ("perlu_klarifikasi" if out["butuh_klarifikasi"] else "ok")
        return {
            "jawaban": out["jawaban"],
            "tabel": out["tabel"],
            "sumber": out["sumber"],
            "intent": out["intent"],
            "mode": out["mode"],
            "sensitif": out["sensitif"],
            "butuh_klarifikasi": out["butuh_klarifikasi"],
            "contoh": out["contoh"],
        }
    finally:
        _write_audit(user, body.pesan, out, status)

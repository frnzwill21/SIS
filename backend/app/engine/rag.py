"""RAG sederhana atas profil_sekolah.json dan knowledge_document aktif (pencarian leksikal).

Profil sekolah hanya ~6.600 karakter, jadi pencarian kata kunci berbobot IDF sudah cukup untuk MVP.
Antarmuka `retrieve()` sengaja dibuat sama dengan yang nanti dipakai ChromaDB: tinggal ganti isi fungsinya.
"""
import json
import math
import re
from contextlib import contextmanager
from contextvars import ContextVar
from functools import lru_cache
from pathlib import Path
from typing import Any

from sqlalchemy import inspect

from ..config import settings

_STOP = {"yang", "dan", "di", "ke", "dari", "untuk", "dengan", "pada", "itu", "ini", "apa", "siapa", "adalah", "saja", "tentang",
         "sekolah", "smkn", "bandung", "bagaimana", "berapa", "ada", "atau", "para", "kami", "kita", "saya"}
_LABELS = {
    "identitas_sekolah": "Identitas sekolah", "sejarah": "Sejarah", "visi_dan_misi": "Visi dan misi",
    "program_dan_konsentrasi_keahlian": "Program keahlian", "sarana_dan_fasilitas": "Sarana dan fasilitas",
    "ekstrakurikuler_dan_organisasi": "Ekstrakurikuler dan organisasi", "peraturan_dan_tata_tertib": "Peraturan dan tata tertib",
    "prestasi_dan_mitra_industri": "Prestasi dan mitra industri",
}

_active_db: ContextVar[Any] = ContextVar("rag_active_db", default=None)


@contextmanager
def use_db(db: Any):
    """Ikat koneksi DB aktif selama eksekusi handler agar `retrieve()` dapat membaca knowledge_document."""
    token = _active_db.set(db)
    try:
        yield
    finally:
        _active_db.reset(token)


def _tokens(text: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9]+", text.lower()) if len(t) >= 3 and t not in _STOP]


def _text(node) -> str:
    if isinstance(node, dict):
        return "; ".join(f"{k.replace('_', ' ')}: {_text(v)}" for k, v in node.items())
    if isinstance(node, list):
        return "; ".join(_text(x) for x in node)
    return str(node)


def _flatten(path: list[str], node, out: list[tuple[str, str]]) -> None:
    label = " > ".join(_LABELS.get(p, p.replace("_", " ")) for p in path)
    if isinstance(node, dict):
        # tingkat dua dijadikan potongan sendiri agar pencarian lebih tepat
        for k, v in node.items():
            if len(path) < 2:
                _flatten(path + [k], v, out)
            else:
                out.append((label, f"{k.replace('_', ' ')}: {_text(v)}"))
    elif isinstance(node, list) and len(path) <= 2:
        for item in node:
            out.append((label, _text(item)))
    else:
        out.append((label, _text(node)))


@lru_cache(maxsize=1)
def chunks() -> list[tuple[str, str]]:
    path = Path(settings.dataset_dir) / "profil_sekolah.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    out: list[tuple[str, str]] = []
    for key, value in data.items():
        _flatten([key], value, out)
    return out


def _split_doc_text(text: str, max_len: int = 450) -> list[str]:
    cleaned = (text or "").strip()
    if not cleaned:
        return []
    blocks = [b.strip() for b in re.split(r"\r?\n\s*\r?\n", cleaned) if b.strip()]
    out: list[str] = []
    for block in blocks:
        if len(block) <= max_len:
            out.append(block)
            continue
        cur = ""
        for part in re.split(r"(?<=[.!?\n])\s+", block):
            part = part.strip()
            if not part:
                continue
            if len(cur) + len(part) + 1 <= max_len:
                cur = f"{cur} {part}".strip() if cur else part
            else:
                if cur:
                    out.append(cur)
                while len(part) > max_len:
                    out.append(part[:max_len].strip())
                    part = part[max_len:].strip()
                cur = part
        if cur:
            out.append(cur)
    return out


def _has_knowledge_table(db: Any) -> bool:
    conn = getattr(db, "conn", None)
    if conn is not None:
        try:
            return bool(inspect(conn).has_table("knowledge_document"))
        except Exception:  # noqa: BLE001
            return False
    return True


def doc_chunks(db: Any) -> list[tuple[str, str]]:
    """Ambil potongan teks dari dokumen pengetahuan berstatus 'aktif' bila tabel tersedia."""
    if db is None or not _has_knowledge_table(db):
        return []
    try:
        rows = db.rows(
            "SELECT nama_file, ringkasan, konten_teks FROM knowledge_document "
            "WHERE status = 'aktif' ORDER BY id DESC"
        )
    except Exception:  # noqa: BLE001 - DB uji minimal tanpa tabel knowledge_document
        return []
    out: list[tuple[str, str]] = []
    for r in rows:
        label = f"Dokumen: {r.get('nama_file', 'dokumen')}"
        parts = _split_doc_text(r.get("konten_teks") or "")
        if not parts and r.get("ringkasan"):
            parts = [str(r["ringkasan"]).strip()]
        for p in parts:
            out.append((label, p))
    return out


def _rank_docs(docs: list[tuple[str, str]], query: str, k: int) -> list[tuple[str, str]]:
    q = set(_tokens(query))
    if not q or not docs:
        return []
    doc_tokens = [set(_tokens(f"{label} {text}")) for label, text in docs]
    n = len(docs)
    idf = {t: math.log(1 + n / (1 + sum(t in d for d in doc_tokens))) for t in q}
    scored = []
    for (label, text), toks in zip(docs, doc_tokens):
        score = sum(idf[t] for t in q if t in toks)
        if score > 0:
            scored.append((score, label, text))
    scored.sort(key=lambda x: -x[0])
    return [(label, text) for _, label, text in scored[:k]]


def retrieve_docs(db: Any, query: str, k: int = 3) -> list[tuple[str, str]]:
    """Cari potongan teks relevan khusus dari dokumen pengetahuan aktif di database."""
    return _rank_docs(doc_chunks(db), query, k)


def retrieve(query: str, k: int = 3, db: Any = None) -> list[tuple[str, str]]:
    """Potongan teks paling relevan: [(bagian, isi)]. Kosong bila tidak ada kata yang cocok."""
    active_db = db if db is not None else _active_db.get()
    docs = list(chunks())
    if active_db is not None:
        docs.extend(doc_chunks(active_db))
    return _rank_docs(docs, query, k)

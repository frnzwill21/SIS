"""Endpoint Knowledge Graph: graf entitas, unggah dokumen, serta alur persetujuan penghapusan."""
import base64
import binascii
import json
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import Connection, text

from .. import queries
from ..auth import active_user, require_admin
from ..db import get_conn
from ..engine import graph

router = APIRouter(prefix="/knowledge", tags=["knowledge"], dependencies=[Depends(active_user)])

_MAX_B64_CHARS = 8 * 1024 * 1024  # batas aman sebelum decode (> 5 MB raw)


def _err(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code, {"code": code, "message": message, "details": None})


def _iso(val):
    return val.isoformat() if hasattr(val, "isoformat") else val


def _parse_meta(val) -> dict:
    if isinstance(val, dict):
        return val
    if isinstance(val, str) and val.strip():
        try:
            parsed = json.loads(val)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


class DokumenIn(BaseModel):
    nama_file: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
    konten_base64: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class AjukanHapusIn(BaseModel):
    alasan: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=300)]


class ProsesHapusIn(BaseModel):
    catatan_admin: str | None = Field(default=None, max_length=300)


def _doc_dict(r: dict) -> dict:
    return {
        "id": int(r["id"]),
        "nama_file": r["nama_file"],
        "tipe_file": r["tipe_file"],
        "ukuran_bytes": int(r["ukuran_bytes"]),
        "ringkasan": r["ringkasan"] or "",
        "status": r["status"],
        "pengunggah": r["pengunggah"] or "-",
        "dibuat_pada": _iso(r["dibuat_pada"]),
        "jumlah_relasi": int(r["jumlah_relasi"] or 0),
    }


def _soft_delete_doc_graph(conn: Connection, doc_id: int) -> None:
    conn.execute(
        text("UPDATE knowledge_document SET status = 'dihapus', dihapus_pada = CURRENT_TIMESTAMP WHERE id = :doc_id"),
        {"doc_id": doc_id},
    )
    conn.execute(
        text("UPDATE knowledge_edge SET status = 'dihapus' WHERE document_id = :doc_id"),
        {"doc_id": doc_id},
    )
    conn.execute(
        text("UPDATE knowledge_node SET status = 'dihapus' WHERE document_id = :doc_id AND tipe = 'dokumen'"),
        {"doc_id": doc_id},
    )
    # Hapus lunak node topik milik dokumen ini hanya jika tidak lagi dirujuk edge aktif dokumen lain
    conn.execute(
        text(
            "UPDATE knowledge_node SET status = 'dihapus' "
            "WHERE tipe = 'topik' AND status <> 'dihapus' "
            "AND NOT EXISTS ("
            "  SELECT 1 FROM knowledge_edge ke "
            "  WHERE (ke.source_id = knowledge_node.id OR ke.target_id = knowledge_node.id) "
            "    AND ke.status <> 'dihapus'"
            ")"
        )
    )
    conn.execute(
        text(
            "UPDATE knowledge_edge SET status = 'dihapus' "
            "WHERE status <> 'dihapus' AND ("
            "  source_id IN (SELECT id FROM knowledge_node WHERE status = 'dihapus') "
            "  OR target_id IN (SELECT id FROM knowledge_node WHERE status = 'dihapus')"
            ")"
        )
    )


@router.get("/graf")
def lihat_graf(
    tipe: str = "",
    relasi: str = "",
    q: str = "",
    sertakan_sistem: bool = True,
    conn: Connection = Depends(get_conn),
):
    graph.ensure_base_graph(conn)

    raw_nodes = conn.execute(
        text(
            "SELECT id, kunci, label, tipe, sumber, document_id, metadata_json, status "
            "FROM knowledge_node WHERE status <> 'dihapus' ORDER BY id"
        )
    ).mappings().all()

    raw_edges = conn.execute(
        text(
            "SELECT id, source_id, target_id, relasi, document_id, status, catatan "
            "FROM knowledge_edge WHERE status <> 'dihapus' ORDER BY id"
        )
    ).mappings().all()

    tipe_set = {t.strip().lower() for t in tipe.split(",") if t.strip()}
    relasi_set = {r.strip().lower() for r in relasi.split(",") if r.strip()}
    q_f = q.strip().lower()

    type_counts: dict[str, int] = {}
    nodes: list[dict] = []
    allowed_ids: set[int] = set()
    for r in raw_nodes:
        if not sertakan_sistem and r["sumber"] == "sistem":
            continue
        t_low = (r["tipe"] or "").strip().lower()
        if t_low:
            type_counts[t_low] = type_counts.get(t_low, 0) + 1
        if tipe_set and t_low not in tipe_set:
            continue
        meta = _parse_meta(r["metadata_json"])
        if q_f:
            haystack = f"{r['label']} {r['kunci']} {json.dumps(meta, ensure_ascii=False)}".lower()
            if q_f not in haystack:
                continue
        nid = int(r["id"])
        allowed_ids.add(nid)
        nodes.append(
            {
                "id": str(nid),
                "kunci": r["kunci"],
                "label": r["label"],
                "tipe": r["tipe"],
                "sumber": r["sumber"],
                "status": r["status"],
                "metadata": meta,
                "document_id": int(r["document_id"]) if r["document_id"] is not None else None,
            }
        )

    edges: list[dict] = []
    for e in raw_edges:
        src = int(e["source_id"])
        tgt = int(e["target_id"])
        if src not in allowed_ids or tgt not in allowed_ids:
            continue
        if relasi_set and (e["relasi"] or "").strip().lower() not in relasi_set:
            continue
        edges.append(
            {
                "id": str(e["id"]),
                "source": str(src),
                "target": str(tgt),
                "relasi": e["relasi"],
                "status": e["status"],
                "catatan": e["catatan"] or "",
                "document_id": int(e["document_id"]) if e["document_id"] is not None else None,
            }
        )

    total_dokumen = conn.execute(
        text("SELECT COUNT(*) FROM knowledge_document WHERE status IN ('aktif', 'menunggu_hapus')")
    ).scalar_one()
    menunggu_hapus = conn.execute(
        text("SELECT COUNT(*) FROM delete_request WHERE status = 'menunggu'")
    ).scalar_one()
    konflik_nodes = sum(1 for r in raw_nodes if r["status"] in ("konflik", "saran"))
    konflik_edges = sum(1 for e in raw_edges if e["status"] in ("konflik", "saran"))

    return {
        "nodes": nodes,
        "edges": edges,
        "stats": {
            "total_nodes": len(raw_nodes),
            "total_edges": len(raw_edges),
            "total_dokumen": int(total_dokumen or 0),
            "menunggu_hapus": int(menunggu_hapus or 0),
            "konflik": konflik_nodes + konflik_edges,
            "type_counts": type_counts,
        },
    }


@router.get("/dokumen")
def daftar_dokumen(conn: Connection = Depends(get_conn)):
    rows = conn.execute(text(queries.KNOWLEDGE_DOC_LIST)).mappings().all()
    return {"data": [_doc_dict(dict(r)) for r in rows]}


@router.post("/dokumen", status_code=201)
def unggah_dokumen(body: DokumenIn, user: dict = Depends(active_user), conn: Connection = Depends(get_conn)):
    nama_file = Path(body.nama_file.strip()).name
    if not nama_file:
        raise _err(422, "VALIDATION_ERROR", "Nama file tidak valid.")

    b64 = body.konten_base64.strip()
    if b64.startswith("data:") and ";base64," in b64[:128]:
        b64 = b64.split(";base64,", 1)[1]
    if len(b64) > _MAX_B64_CHARS:
        raise _err(422, "VALIDATION_ERROR", "Ukuran berkas melebihi batas maksimal 5 MB.")
    try:
        raw_bytes = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError):
        raise _err(422, "VALIDATION_ERROR", "Konten base64 tidak valid.")

    try:
        extracted_text = graph.extract_text(nama_file, raw_bytes)
    except ValueError as exc:
        raise _err(422, "VALIDATION_ERROR", str(exc))

    tipe_file = graph.file_extension(nama_file).lstrip(".") or "txt"
    doc_id = conn.execute(
        text(
            "INSERT INTO knowledge_document (nama_file, tipe_file, ukuran_bytes, ringkasan, konten_teks, status, diunggah_oleh) "
            "VALUES (:nama_file, :tipe_file, :ukuran_bytes, '', :konten_teks, 'aktif', :uid) "
            "RETURNING id"
        ),
        {
            "nama_file": nama_file,
            "tipe_file": tipe_file[:20],
            "ukuran_bytes": len(raw_bytes),
            "konten_teks": extracted_text,
            "uid": user["id"],
        },
    ).scalar_one()

    info = graph.process_document_into_graph(conn, int(doc_id), nama_file, extracted_text, user["id"])
    conn.execute(
        text("UPDATE knowledge_document SET ringkasan = :ringkasan WHERE id = :id"),
        {"ringkasan": info["ringkasan"], "id": int(doc_id)},
    )
    conn.execute(
        text(queries.AUDIT_INSERT),
        {
            "user_id": user["id"],
            "aksi": "knowledge_impor",
            "pertanyaan": f"doc_id={doc_id} file={nama_file[:120]}",
            "tabel": "knowledge_document",
        },
    )
    doc_row = conn.execute(text(queries.KNOWLEDGE_DOC_ONE), {"id": int(doc_id)}).mappings().one()
    seen_matched: set[tuple[str, str]] = set()
    matched: list[dict] = []
    for m in info["matched_entities"]:
        key = (m["label"].lower(), m["tipe"])
        if key in seen_matched:
            continue
        seen_matched.add(key)
        matched.append({"id": str(m["id"]), "kunci": m["kunci"], "label": m["label"], "tipe": m["tipe"]})
    payload = {
        "dokumen": _doc_dict(dict(doc_row)),
        "matched_entities": matched,
        "konflik": info["konflik"],
    }
    conn.commit()
    return payload


@router.post("/dokumen/{doc_id}/ajukan-hapus")
def ajukan_hapus_dokumen(
    doc_id: int,
    body: AjukanHapusIn,
    user: dict = Depends(active_user),
    conn: Connection = Depends(get_conn),
):
    doc = conn.execute(
        text("SELECT id, nama_file, status FROM knowledge_document WHERE id = :id AND status <> 'dihapus'"),
        {"id": doc_id},
    ).mappings().first()
    if not doc:
        raise _err(404, "NOT_FOUND", "Dokumen tidak ditemukan.")
    if doc["status"] == "menunggu_hapus":
        raise _err(409, "CONFLICT", "Dokumen ini sudah memiliki permintaan hapus yang sedang menunggu persetujuan.")

    pending = conn.execute(
        text("SELECT id FROM delete_request WHERE document_id = :doc_id AND status = 'menunggu'"),
        {"doc_id": doc_id},
    ).first()
    if pending:
        raise _err(409, "CONFLICT", "Permintaan hapus untuk dokumen ini sudah diajukan.")

    req_id = conn.execute(
        text(
            "INSERT INTO delete_request (document_id, diajukan_oleh, alasan, status) "
            "VALUES (:doc_id, :uid, :alasan, 'menunggu') RETURNING id"
        ),
        {"doc_id": doc_id, "uid": user["id"], "alasan": body.alasan},
    ).scalar_one()
    conn.execute(
        text("UPDATE knowledge_document SET status = 'menunggu_hapus' WHERE id = :doc_id"),
        {"doc_id": doc_id},
    )
    conn.execute(
        text(queries.AUDIT_INSERT),
        {
            "user_id": user["id"],
            "aksi": "knowledge_ajukan_hapus",
            "pertanyaan": f"doc_id={doc_id} req_id={req_id} alasan={body.alasan[:120]}",
            "tabel": "delete_request",
        },
    )
    return {"status": "ok", "request_id": int(req_id), "document_id": doc_id}


@router.get("/permintaan-hapus")
def daftar_permintaan_hapus(_admin: dict = Depends(require_admin), conn: Connection = Depends(get_conn)):
    rows = conn.execute(text(queries.KNOWLEDGE_DELETE_REQUESTS)).mappings().all()
    data = [
        {
            "id": int(r["id"]),
            "document_id": int(r["document_id"]),
            "nama_file": r["nama_file"],
            "pemohon": r["pemohon"],
            "alasan": r["alasan"],
            "status": r["status"],
            "dibuat_pada": _iso(r["dibuat_pada"]),
            "diproses_oleh_nama": r["diproses_oleh_nama"],
            "diproses_pada": _iso(r["diproses_pada"]),
            "catatan_admin": r["catatan_admin"],
        }
        for r in rows
    ]
    return {"data": data}


@router.post("/permintaan-hapus/{req_id}/setuju")
def setuju_hapus(
    req_id: int,
    body: ProsesHapusIn | None = None,
    admin: dict = Depends(require_admin),
    conn: Connection = Depends(get_conn),
):
    req = conn.execute(
        text("SELECT id, document_id, status FROM delete_request WHERE id = :id"),
        {"id": req_id},
    ).mappings().first()
    if not req:
        raise _err(404, "NOT_FOUND", "Permintaan hapus tidak ditemukan.")
    if req["status"] != "menunggu":
        raise _err(409, "CONFLICT", "Permintaan hapus ini sudah diproses sebelumnya.")

    catatan = body.catatan_admin.strip() if body and body.catatan_admin else None
    conn.execute(
        text(
            "UPDATE delete_request SET status = 'disetujui', diproses_oleh = :aid, "
            "catatan_admin = :catatan, diproses_pada = CURRENT_TIMESTAMP WHERE id = :id"
        ),
        {"aid": admin["id"], "catatan": catatan, "id": req_id},
    )
    _soft_delete_doc_graph(conn, int(req["document_id"]))
    conn.execute(
        text(queries.AUDIT_INSERT),
        {
            "user_id": admin["id"],
            "aksi": "knowledge_setuju_hapus",
            "pertanyaan": f"req_id={req_id} doc_id={req['document_id']}",
            "tabel": "knowledge_document",
        },
    )
    return {"status": "ok", "id": req_id, "document_id": int(req["document_id"])}


@router.post("/permintaan-hapus/{req_id}/tolak")
def tolak_hapus(
    req_id: int,
    body: ProsesHapusIn | None = None,
    admin: dict = Depends(require_admin),
    conn: Connection = Depends(get_conn),
):
    req = conn.execute(
        text("SELECT id, document_id, status FROM delete_request WHERE id = :id"),
        {"id": req_id},
    ).mappings().first()
    if not req:
        raise _err(404, "NOT_FOUND", "Permintaan hapus tidak ditemukan.")
    if req["status"] != "menunggu":
        raise _err(409, "CONFLICT", "Permintaan hapus ini sudah diproses sebelumnya.")

    catatan = body.catatan_admin.strip() if body and body.catatan_admin else None
    conn.execute(
        text(
            "UPDATE delete_request SET status = 'ditolak', diproses_oleh = :aid, "
            "catatan_admin = :catatan, diproses_pada = CURRENT_TIMESTAMP WHERE id = :id"
        ),
        {"aid": admin["id"], "catatan": catatan, "id": req_id},
    )
    conn.execute(
        text("UPDATE knowledge_document SET status = 'aktif' WHERE id = :doc_id AND status = 'menunggu_hapus'"),
        {"doc_id": int(req["document_id"])},
    )
    conn.execute(
        text(queries.AUDIT_INSERT),
        {
            "user_id": admin["id"],
            "aksi": "knowledge_tolak_hapus",
            "pertanyaan": f"req_id={req_id} doc_id={req['document_id']}",
            "tabel": "delete_request",
        },
    )
    return {"status": "ok", "id": req_id, "document_id": int(req["document_id"])}


@router.delete("/dokumen/{doc_id}")
def hapus_dokumen_admin(
    doc_id: int,
    admin: dict = Depends(require_admin),
    conn: Connection = Depends(get_conn),
):
    doc = conn.execute(
        text("SELECT id, nama_file FROM knowledge_document WHERE id = :id AND status <> 'dihapus'"),
        {"id": doc_id},
    ).mappings().first()
    if not doc:
        raise _err(404, "NOT_FOUND", "Dokumen tidak ditemukan.")

    _soft_delete_doc_graph(conn, doc_id)
    conn.execute(
        text(
            "UPDATE delete_request SET status = 'disetujui', diproses_oleh = :aid, "
            "catatan_admin = 'Dihapus langsung oleh admin', diproses_pada = CURRENT_TIMESTAMP "
            "WHERE document_id = :doc_id AND status = 'menunggu'"
        ),
        {"aid": admin["id"], "doc_id": doc_id},
    )
    conn.execute(
        text(queries.AUDIT_INSERT),
        {
            "user_id": admin["id"],
            "aksi": "knowledge_hapus_dokumen",
            "pertanyaan": f"doc_id={doc_id} file={doc['nama_file'][:120]}",
            "tabel": "knowledge_document",
        },
    )
    return {"status": "ok", "id": doc_id}

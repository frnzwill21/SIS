"""Endpoint data sekolah kelas XII (hanya baca). Data pelanggaran dibatasi ke admin, kepala_sekolah, dan bk."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Connection, inspect, text

from .. import queries
from ..auth import active_user, require_pelanggaran_access
from ..db import get_conn

router = APIRouter(tags=["data sekolah"], dependencies=[Depends(active_user)])


def _rows(conn: Connection, sql: str, **params) -> list[dict]:
    return [dict(r) for r in conn.execute(text(sql), params).mappings().all()]


def _not_found(what: str) -> HTTPException:
    return HTTPException(404, {"code": "NOT_FOUND", "message": f"{what} tidak ditemukan.", "details": None})


def _ensure_siswa(conn: Connection, nis: str) -> dict:
    rows = _rows(conn, queries.SISWA_DETAIL, nis=nis)
    if not rows:
        raise _not_found(f"Siswa dengan NIS {nis}")
    return rows[0]


@router.get("/kelas")
def daftar_kelas(conn: Connection = Depends(get_conn)):
    return {"data": _rows(conn, queries.KELAS_LIST)}


@router.get("/kelas/{kode}/siswa")
def siswa_kelas(kode: str, conn: Connection = Depends(get_conn)):
    if not _rows(conn, queries.KELAS_EXISTS, kelas=kode):
        raise _not_found(f"Kelas {kode}")
    return {"data": _rows(conn, queries.KELAS_SISWA, kelas=kode)}


@router.get("/kelas/{kode}/jadwal")
def jadwal_kelas(kode: str, hari: str = "", conn: Connection = Depends(get_conn)):
    if not _rows(conn, queries.KELAS_EXISTS, kelas=kode):
        raise _not_found(f"Kelas {kode}")
    return {"data": _rows(conn, queries.JADWAL_KELAS, kelas=kode, hari=hari)}


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@router.get("/siswa")
def cari_siswa(
    q: str = "",
    kelas: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    conn: Connection = Depends(get_conn),
):
    q = _escape_like(q.strip())
    total = conn.execute(text(queries.SISWA_SEARCH_COUNT), {"q": q, "kelas": kelas}).scalar_one()
    data = _rows(conn, queries.SISWA_SEARCH, q=q, kelas=kelas, limit=page_size, offset=(page - 1) * page_size)
    return {"data": data, "meta": {"page": page, "page_size": page_size, "total": total}}


@router.get("/siswa/{nis}")
def profil_siswa(nis: str, conn: Connection = Depends(get_conn)):
    siswa = _ensure_siswa(conn, nis)
    return {
        "data": {
            **siswa,
            "pkl": (_rows(conn, queries.SISWA_PKL, nis=nis) or [None])[0],
            "ekskul": _rows(conn, queries.SISWA_EKSKUL, nis=nis),
        }
    }


@router.get("/siswa/{nis}/nilai")
def nilai_siswa(nis: str, semester: int = Query(0, ge=0, le=6), conn: Connection = Depends(get_conn)):
    _ensure_siswa(conn, nis)
    return {
        "data": _rows(conn, queries.SISWA_NILAI, nis=nis, semester=semester),
        "rata_rata_per_semester": _rows(conn, queries.SISWA_NILAI_RATA, nis=nis, semester=semester),
    }


@router.get("/siswa/{nis}/kehadiran")
def kehadiran_siswa(nis: str, conn: Connection = Depends(get_conn)):
    _ensure_siswa(conn, nis)
    return {"data": _rows(conn, queries.SISWA_KEHADIRAN, nis=nis)}


@router.get("/siswa/{nis}/pelanggaran")
def pelanggaran_siswa(nis: str, user: dict = Depends(require_pelanggaran_access), conn: Connection = Depends(get_conn)):
    """Data sensitif: hanya admin, kepala_sekolah, dan bk; setiap akses dicatat di audit_log."""
    _ensure_siswa(conn, nis)
    conn.execute(
        text(queries.AUDIT_INSERT),
        {"user_id": user["id"], "aksi": "baca_pelanggaran", "pertanyaan": f"GET /siswa/{nis}/pelanggaran", "tabel": "pelanggaran"},
    )
    return {"data": _rows(conn, queries.SISWA_PELANGGARAN, nis=nis)}


# ---------------------------------------------------------------- PKL, ekskul, guru, profil sekolah
@router.get("/pkl/penempatan")
def pkl_penempatan(
    q: str = "",
    kelas: str = "",
    sesi: int = Query(0, ge=0, le=2),
    status: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    conn: Connection = Depends(get_conn),
):
    params = {
        "q": _escape_like(q.strip()),
        "kelas": kelas.strip(),
        "sesi": sesi,
        "status": status.strip(),
    }
    summary_row = conn.execute(text(queries.PKL_PENEMPATAN_SUMMARY), params).mappings().one()
    total = int(summary_row["total"] or 0)
    data = _rows(conn, queries.PKL_PENEMPATAN_LIST, **params, limit=page_size, offset=(page - 1) * page_size)
    return {
        "data": data,
        "meta": {"page": page, "page_size": page_size, "total": total},
        "summary": {
            "total": total,
            "sesi1": int(summary_row["sesi1"] or 0),
            "sesi2": int(summary_row["sesi2"] or 0),
            "selesai": int(summary_row["selesai"] or 0),
            "berlangsung": int(summary_row["berlangsung"] or 0),
        },
    }


@router.get("/pkl/perusahaan")
def pkl_perusahaan(q: str = "", jurusan: str = "", conn: Connection = Depends(get_conn)):
    return {"data": _rows(conn, queries.PERUSAHAAN_SEARCH, q=_escape_like(q.strip()), jurusan=jurusan.strip())}


@router.get("/ekskul")
def daftar_ekskul(conn: Connection = Depends(get_conn)):
    return {"data": _rows(conn, queries.EKSKUL_LIST)}


@router.get("/guru")
def cari_guru(q: str = "", conn: Connection = Depends(get_conn)):
    return {"data": _rows(conn, queries.GURU_SEARCH, q=_escape_like(q.strip()))}


@router.get("/guru/{nip}/jadwal")
def jadwal_guru(nip: str, conn: Connection = Depends(get_conn)):
    if not _rows(conn, "SELECT 1 FROM guru WHERE nip = :nip", nip=nip):
        raise _not_found(f"Guru dengan NIP {nip}")
    return {"data": _rows(conn, queries.JADWAL_GURU, nip=nip)}


@router.get("/sekolah/profil")
def profil_sekolah():
    import json
    from pathlib import Path

    from ..config import settings

    path = Path(settings.dataset_dir) / "profil_sekolah.json"
    try:
        return {"data": json.loads(path.read_text(encoding="utf-8"))}
    except (OSError, json.JSONDecodeError):
        raise HTTPException(503, {"code": "UNAVAILABLE", "message": "Profil sekolah belum tersedia.", "details": None})


@router.get("/master/ringkasan")
def master_ringkasan(conn: Connection = Depends(get_conn)):
    row = conn.execute(text(queries.MASTER_RINGKASAN)).mappings().one()
    tahun_ajaran = "2026/2027"
    if inspect(conn).has_table("periode_akademik"):
        ta_row = conn.execute(text(queries.TAHUN_AJARAN_AKTIF)).first()
        if ta_row and ta_row[0]:
            tahun_ajaran = str(ta_row[0])
    return {
        "data": {
            "siswa": int(row["siswa"] or 0),
            "kelas": int(row["kelas"] or 0),
            "guru": int(row["guru"] or 0),
            "penempatan_pkl": int(row["penempatan_pkl"] or 0),
            "perusahaan_pkl": int(row["perusahaan_pkl"] or 0),
            "ekstrakurikuler": int(row["ekstrakurikuler"] or 0),
            "jurusan": int(row["jurusan"] or 0),
            "tahun_ajaran": tahun_ajaran,
        }
    }

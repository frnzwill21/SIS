"""Safe Read-Only SQL Planner (v2):
Layer A: Pembangun query analitik deterministik terparameter (PG16 + SQLite).
Layer B: SQL Read-Only dari Gemini dengan validator ketat + READ ONLY + statement_timeout 3000ms.
"""
import json
import logging
import re
from dataclasses import dataclass
from typing import Any

from .. import queries
from ..auth import can_view_pelanggaran
from . import gemini
from .core import Db, Result, fmt_num, plain
from .parsing import (
    mentions_unknown_kelas,
    normalize_kelas,
    outside_scope,
    parse_gender,
    parse_hari,
    parse_jurusan,
    parse_limit,
    parse_mapel,
    parse_pkl_sesi,
    parse_pkl_status,
    parse_semester,
    parse_tingkat_pelanggaran,
    parse_urutan,
)

log = logging.getLogger("uvicorn.error")

MAX_SQL_LIMIT = 40

ALLOWED_TABLES = {
    "jurusan",
    "guru",
    "mapel_jadwal",
    "mapel_rapor",
    "periode_akademik",
    "jenis_pelanggaran",
    "predikat_ekskul",
    "sesi_pkl",
    "kelas",
    "guru_mapel",
    "pemetaan_mapel",
    "siswa",
    "ekstrakurikuler",
    "pembina_ekskul",
    "perusahaan_pkl",
    "nilai",
    "kehadiran",
    "pelanggaran",
    "partisipasi_ekskul",
    "jadwal_pelajaran",
    "penempatan_pkl",
}

_FORBIDDEN_EXACT = {"users", "audit_log", "import_batch", "delete_request", "information_schema"}
_FORBIDDEN_PREFIX_RE = re.compile(r"\b(?:chat_[a-z0-9_]*|knowledge_[a-z0-9_]*|pg_[a-z0-9_]*|sqlite_[a-z0-9_]*)\b", re.IGNORECASE)
_MUTATING_RE = re.compile(
    r"\b(insert|update|delete|drop|alter|create|truncate|replace|merge|upsert|grant|revoke|"
    r"commit|rollback|savepoint|begin|exec|execute|call|do|copy|attach|detach|pragma|vacuum|"
    r"reindex|analyze|cluster|lock|set|show|explain|prepare|deallocate|listen|notify|load|"
    r"import|into|returning|pg_sleep|dblink|lo_import|lo_export|pg_read_file|pg_read_binary_file|"
    r"pg_ls_dir|query_to_xml|current_user|session_user)\b",
    re.IGNORECASE,
)
_LOCKING_RE = re.compile(r"\bfor\s+(?:update|share|no\s+key\s+update|key\s+share)\b", re.IGNORECASE)
_STRING_LIT_RE = re.compile(r"'(?:''|[^'])*'")
_IDENT_QUOTES_RE = re.compile(r'["`]')
_TRAILING_LIMIT_RE = re.compile(r"\blimit\s+(-?\d+|all)(?:\s+offset\s+\d+)?\s*$", re.IGNORECASE)
_ANY_TRAILING_LIMIT_TOKEN_RE = re.compile(r"\blimit\s+[^\s;]+(?:\s+offset\s+[^\s;]+)?\s*$", re.IGNORECASE)


@dataclass
class SqlValidation:
    ok: bool
    sql: str = ""
    reason: str = ""
    ditolak: bool = False


def _strip_literals(sql: str) -> str:
    return _STRING_LIT_RE.sub(" '' ", sql)


def _extract_ctes(unquoted: str) -> set[str]:
    ctes: set[str] = set()
    if not re.match(r"^\s*with\b", unquoted, re.IGNORECASE):
        return ctes
    for m in re.finditer(
        r"(?:^|\bwith(?:\s+recursive)?|,)\s*([a-z_][a-z0-9_]*)\s*(?:\([^)]*\))?\s+as\s*\(",
        unquoted,
        re.IGNORECASE,
    ):
        ctes.add(m.group(1).lower())
    return ctes


def _extract_tables(unquoted: str) -> tuple[set[str], str | None]:
    """Ambil nama tabel dari klausa FROM dan JOIN. Kembalikan (tables, invalid_schema_or_none)."""
    tables: set[str] = set()
    for m in re.finditer(r"\b(?:from|join)\s+([a-z_][a-z0-9_]*(?:\s*\.\s*[a-z_][a-z0-9_]*)?)", unquoted, re.IGNORECASE):
        raw = re.sub(r"\s+", "", m.group(1)).lower()
        if "." in raw:
            schema, tbl = raw.split(".", 1)
            if schema != "public":
                return tables, f"Skema '{schema}' tidak diizinkan."
            tables.add(tbl)
        else:
            tables.add(raw)
    # Tangani comma-join sederhana: FROM tabel_a a, tabel_b b
    for m in re.finditer(
        r"\bfrom\s+(.+?)(?=\b(?:where|group\s+by|having|order\s+by|limit|union|intersect|except|join)\b|\)|$)",
        unquoted,
        re.IGNORECASE,
    ):
        segment = m.group(1)
        if "," not in segment or "(" in segment:
            continue
        for part in segment.split(","):
            tok_m = re.match(r"^\s*([a-z_][a-z0-9_]*(?:\s*\.\s*[a-z_][a-z0-9_]*)?)", part, re.IGNORECASE)
            if tok_m:
                raw = re.sub(r"\s+", "", tok_m.group(1)).lower()
                if "." in raw:
                    schema, tbl = raw.split(".", 1)
                    if schema != "public":
                        return tables, f"Skema '{schema}' tidak diizinkan."
                    tables.add(tbl)
                else:
                    tables.add(raw)
    return tables, None


def validate_readonly_sql(sql: str, role: str = "teacher") -> SqlValidation:
    """Validator ketat SQL read-only + RBAC. Hanya mengizinkan satu SELECT (atau WITH ... SELECT) dengan LIMIT <= 40."""
    if not isinstance(sql, str) or not sql.strip():
        return SqlValidation(False, reason="SQL kosong.")
    raw = sql.strip()
    if len(raw) > 4000:
        return SqlValidation(False, reason="SQL terlalu panjang.")
    if "\x00" in raw or ";" in raw:
        return SqlValidation(False, reason="Karakter ';' atau null byte tidak diizinkan.")
    if "--" in raw or "/*" in raw or "*/" in raw or "```" in raw:
        return SqlValidation(False, reason="Komentar atau blok kode SQL tidak diizinkan.")

    norm = " ".join(raw.split())
    if not re.match(r"^(?:select|with)\b", norm, re.IGNORECASE):
        return SqlValidation(False, reason="Hanya query SELECT atau WITH ... SELECT yang diizinkan.")
    if re.match(r"^with\b", norm, re.IGNORECASE) and not re.search(r"\bselect\b", norm, re.IGNORECASE):
        return SqlValidation(False, reason="Klausa WITH wajib diikuti SELECT.")

    no_lit = _strip_literals(norm)
    unquoted = _IDENT_QUOTES_RE.sub("", no_lit)

    if _MUTATING_RE.search(unquoted) or _LOCKING_RE.search(unquoted):
        return SqlValidation(False, reason="Kata kunci mutasi atau sistem tidak diizinkan.")

    # Cek tabel sistem/rahasia terlarang di mana pun dalam identifier SQL
    lower_tokens = set(re.findall(r"\b[a-z_][a-z0-9_]*\b", unquoted.lower()))
    if lower_tokens & _FORBIDDEN_EXACT or _FORBIDDEN_PREFIX_RE.search(unquoted):
        return SqlValidation(False, reason="Tabel sistem tidak dapat diakses.")

    ctes = _extract_ctes(unquoted)
    tables, schema_err = _extract_tables(unquoted)
    if schema_err:
        return SqlValidation(False, reason=schema_err)
    if not tables:
        return SqlValidation(False, reason="Query harus merujuk tabel sekolah yang valid.")

    # RBAC: role teacher dilarang keras mengakses tabel pelanggaran
    if not can_view_pelanggaran(role):
        if "pelanggaran" in tables or re.search(r"\bpelanggaran\b", unquoted, re.IGNORECASE):
            return SqlValidation(
                False,
                reason="Akses data pelanggaran siswa ditolak untuk peran teacher.",
                ditolak=True,
            )

    allowed_with_ctes = ALLOWED_TABLES | ctes
    unknown_tables = tables - allowed_with_ctes
    if unknown_tables:
        return SqlValidation(False, reason=f"Tabel tidak diizinkan: {', '.join(sorted(unknown_tables))}.")

    # Paksa LIMIT <= 40 di tingkat terluar
    m_lim = _TRAILING_LIMIT_RE.search(norm)
    if m_lim:
        tok = m_lim.group(1).lower()
        if tok == "all":
            return SqlValidation(False, reason="LIMIT ALL tidak diizinkan.")
        val = int(tok)
        if val < 1:
            return SqlValidation(False, reason="LIMIT harus bernilai minimal 1.")
        if val > MAX_SQL_LIMIT:
            start, end = m_lim.span(1)
            norm = f"{norm[:start]}{MAX_SQL_LIMIT}{norm[end:]}"
    elif _ANY_TRAILING_LIMIT_TOKEN_RE.search(norm):
        return SqlValidation(False, reason="Format LIMIT tidak valid.")
    else:
        norm = f"{norm} LIMIT {MAX_SQL_LIMIT}"

    return SqlValidation(True, sql=norm)


def _is_postgres(db: Any) -> bool:
    conn = getattr(db, "conn", None)
    dialect = getattr(conn, "dialect", None)
    return getattr(dialect, "name", "") == "postgresql"


def _execute_readonly(db: Db, sql: str) -> list[dict]:
    conn = getattr(db, "conn", None)
    if conn is not None and _is_postgres(db):
        from sqlalchemy import text

        with conn.begin_nested():
            conn.execute(text("SET LOCAL TRANSACTION READ ONLY"))
            conn.execute(text("SET LOCAL statement_timeout = '3000ms'"))
            rows = conn.execute(text(sql)).mappings().all()
            return [{k: plain(v) for k, v in row.items()} for row in rows]
    if conn is not None and getattr(getattr(conn, "dialect", None), "name", "") == "sqlite":
        sql_exec = sql.replace(" ILIKE ", " LIKE ")
        return db.rows(sql_exec)
    return db.rows(sql)


def _sem_berjalan(db: Db) -> int:
    rows = db.rows(queries.PERIODE_BERJALAN)
    return int(rows[0]["semester"]) if rows else 5


def _has(text: str, pattern: str) -> bool:
    return bool(re.search(pattern, text))


# ------------------------------------------------------------------ Layer A: Deterministic Analytical Builder
def _layer_a_pelanggaran(db: Db, low: str, role: str, kelas: str | None, jurusan: str, tingkat: str, limit: int) -> tuple[Result | None, bool]:
    if not _has(low, r"\b(pelanggaran|melanggar|kasus|indisipliner)\b"):
        return None, False
    if _has(low, r"\b(sanksi|tata tertib|peraturan|aturan)\b") and not _has(low, r"\b(siswa|murid|anak|jumlah|rekap|kasus|terbanyak|per\s+jurusan|per\s+kelas)\b"):
        return None, False
    if not can_view_pelanggaran(role):
        return None, True

    if _has(low, r"\b(per\s+tingkat|tiap\s+tingkat|berdasarkan\s+tingkat|jumlah.*tingkat|rekap.*tingkat)\b"):
        sql = """
        SELECT jp.tingkat, COUNT(*) AS jumlah_kejadian, COUNT(DISTINCT pl.nis) AS jumlah_siswa, SUM(jp.poin) AS total_poin
        FROM pelanggaran pl
        JOIN jenis_pelanggaran jp ON jp.kode = pl.kode_pelanggaran
        JOIN siswa s ON s.nis = pl.nis
        JOIN kelas k ON k.kode = s.kelas_kode
        WHERE (CAST(:jurusan AS TEXT) = '' OR k.jurusan_kode = CAST(:jurusan AS TEXT))
        GROUP BY jp.tingkat
        ORDER BY total_poin DESC
        """
        rows = db.rows(sql, jurusan=jurusan)
        if not rows:
            return Result("Tidak ada data pelanggaran untuk filter tersebut.", sumber=["pelanggaran"], sensitif=True), False
        kolom = ["Tingkat", "Jumlah Kejadian", "Jumlah Siswa", "Total Poin"]
        baris = [[r["tingkat"], r["jumlah_kejadian"], r["jumlah_siswa"], r["total_poin"]] for r in rows]
        lok = f" jurusan {jurusan}" if jurusan else " seluruh kelas XII"
        return Result(f"Rekap pelanggaran per tingkat di{lok}: {len(rows)} kategori.", kolom, baris, ["pelanggaran", "jenis_pelanggaran", "siswa"], sensitif=True), False

    if _has(low, r"\b(per\s+jurusan|tiap\s+jurusan|per\s+kelas|tiap\s+kelas)\b"):
        group_col = "k.nama" if _has(low, r"\b(per\s+kelas|tiap\s+kelas)\b") else "k.jurusan_kode"
        label_col = "Kelas" if group_col == "k.nama" else "Jurusan"
        sql = f"""
        SELECT {group_col} AS grup, COUNT(*) AS jumlah_kejadian, COUNT(DISTINCT pl.nis) AS jumlah_siswa, SUM(jp.poin) AS total_poin
        FROM pelanggaran pl
        JOIN jenis_pelanggaran jp ON jp.kode = pl.kode_pelanggaran
        JOIN siswa s ON s.nis = pl.nis
        JOIN kelas k ON k.kode = s.kelas_kode
        WHERE (CAST(:tingkat AS TEXT) = '' OR LOWER(jp.tingkat) = LOWER(CAST(:tingkat AS TEXT)))
        GROUP BY {group_col}
        ORDER BY total_poin DESC, jumlah_kejadian DESC
        LIMIT 40
        """
        rows = db.rows(sql, tingkat=tingkat)
        kolom = [label_col, "Jumlah Kejadian", "Jumlah Siswa", "Total Poin"]
        baris = [[r["grup"], r["jumlah_kejadian"], r["jumlah_siswa"], r["total_poin"]] for r in rows]
        return Result(f"Rekap pelanggaran per {label_col.lower()} ({len(rows)} baris).", kolom, baris, ["pelanggaran", "jenis_pelanggaran", "siswa", "kelas"], sensitif=True), False

    if _has(low, r"\b(sering|terbanyak|paling\s+sering|jenis.*sering|populer)\b") and _has(low, r"\b(jenis|macam|pelanggaran)\b") and not _has(low, r"\b(siswa|murid)\b"):
        sql = """
        SELECT jp.kode, jp.nama AS pelanggaran, jp.tingkat, jp.poin, COUNT(*) AS jumlah_kejadian
        FROM pelanggaran pl
        JOIN jenis_pelanggaran jp ON jp.kode = pl.kode_pelanggaran
        GROUP BY jp.kode, jp.nama, jp.tingkat, jp.poin
        ORDER BY jumlah_kejadian DESC, jp.poin DESC
        LIMIT :lim
        """
        rows = db.rows(sql, lim=limit or 10)
        kolom = ["Kode", "Pelanggaran", "Tingkat", "Poin", "Jumlah Kejadian"]
        baris = [[r["kode"], r["pelanggaran"], r["tingkat"], r["poin"], r["jumlah_kejadian"]] for r in rows]
        return Result(f"Pelanggaran yang paling sering terjadi: {rows[0]['pelanggaran']} ({rows[0]['jumlah_kejadian']} kejadian)." if rows else "Belum ada catatan pelanggaran.", kolom, baris, ["pelanggaran", "jenis_pelanggaran"], sensitif=True), False

    return None, False


def _layer_a_mitra_pkl(db: Db, low: str, jurusan: str, limit: int) -> Result | None:
    if not _has(low, r"\b(pkl|magang|prakerin|mitra|perusahaan|iduka)\b"):
        return None
    if _has(low, r"\b(kota\s+mana|per\s+kota|tiap\s+kota|berdasarkan\s+kota)\b"):
        return None
    if not _has(low, r"\b(mitra|perusahaan|industri|kuota|kota|lowongan|posisi|bidang|daftar|mana\s+saja|apa\s+saja)\b"):
        return None
    if _has(low, r"\b(siswa|murid)\b") and not _has(low, r"\b(kuota|mitra|perusahaan\s+(?:pkl|untuk|jurusan))\b"):
        return None

    kota_q = ""
    for k_name in ("bandung barat", "bandung", "cimahi", "purwakarta", "karawang"):
        if k_name in low:
            kota_q = k_name
            break

    rows = db.rows(queries.PERUSAHAAN_SEARCH, q=kota_q, jurusan=jurusan)
    if not rows:
        return Result("Tidak ada mitra perusahaan PKL yang sesuai dengan kriteria tersebut.", sumber=["perusahaan_pkl"])
    if _has(low, r"\b(sisa\s+kuota|masih\s+kosong|kuota\s+tersedia|punya\s+kuota)\b"):
        rows = [
            r for r in rows
            if (int(r["kuota_sesi1"] or 0) - int(r["terisi_sesi1"] or 0) > 0)
            or (int(r["kuota_sesi2"] or 0) - int(r["terisi_sesi2"] or 0) > 0)
        ]
    shown = rows[: (limit or MAX_SQL_LIMIT)]
    kolom = ["Perusahaan", "Jurusan", "Kota", "Bidang Usaha", "Kuota S1/S2", "Terisi S1/S2"]
    baris = [
        [
            r["nama"],
            r["jurusan_kode"],
            r["kota"],
            r["bidang_usaha"],
            f"{r['kuota_sesi1']} / {r['kuota_sesi2']}",
            f"{r['terisi_sesi1']} / {r['terisi_sesi2']}",
        ]
        for r in shown
    ]
    ket_jur = f" untuk jurusan {jurusan}" if jurusan else ""
    ket_kota = f" di {kota_q.title()}" if kota_q else ""
    return Result(
        f"Ditemukan {len(rows)} mitra PKL{ket_jur}{ket_kota}"
        + (f" (menampilkan {len(shown)})." if len(rows) > len(shown) else "."),
        kolom,
        baris,
        ["perusahaan_pkl", "penempatan_pkl"],
    )


def _layer_a_ekskul_pkl(db: Db, low: str, kelas: str | None, jurusan: str, sem: int, limit: int) -> Result | None:
    has_ekskul = _has(low, r"\b(ekskul|ekstrakurikuler|ekstra)\b")
    has_pkl = _has(low, r"\b(pkl|magang|prakerin)\b")
    if not (has_ekskul and has_pkl):
        return None
    sql = """
    SELECT s.nis, s.nama, k.nama AS kelas, e.nama AS ekskul, p.nama AS perusahaan, pp.sesi, pp.status
    FROM siswa s
    JOIN kelas k ON k.kode = s.kelas_kode
    JOIN penempatan_pkl pp ON pp.nis = s.nis
    JOIN perusahaan_pkl p ON p.kode = pp.kode_perusahaan
    JOIN partisipasi_ekskul pe ON pe.nis = s.nis
    JOIN ekstrakurikuler e ON e.kode = pe.kode_ekskul
    WHERE pe.semester = CAST(:semester AS INTEGER)
      AND (CAST(:kelas AS TEXT) = '' OR s.kelas_kode = CAST(:kelas AS TEXT))
      AND (CAST(:jurusan AS TEXT) = '' OR k.jurusan_kode = CAST(:jurusan AS TEXT))
    ORDER BY k.kode, s.no_absen, e.nama
    """
    raw = db.rows(sql, semester=sem, kelas=kelas or "", jurusan=jurusan)
    if not raw:
        return Result(f"Tidak ditemukan siswa yang mengikuti ekskul sekaligus PKL pada semester {sem} dengan filter itu.", sumber=["siswa", "partisipasi_ekskul", "penempatan_pkl"])
    grouped: dict[str, dict] = {}
    for r in raw:
        ent = grouped.setdefault(
            r["nis"],
            {
                "nama": r["nama"],
                "kelas": r["kelas"],
                "ekskul": [],
                "perusahaan": r["perusahaan"],
                "sesi": r["sesi"],
                "status": r["status"],
            },
        )
        if r["ekskul"] not in ent["ekskul"]:
            ent["ekskul"].append(r["ekskul"])
    items = list(grouped.values())
    shown = items[: (limit or MAX_SQL_LIMIT)]
    kolom = ["Nama", "Kelas", "Ekskul", "Perusahaan PKL", "Sesi", "Status PKL"]
    baris = [[it["nama"], it["kelas"], ", ".join(it["ekskul"]), it["perusahaan"], it["sesi"], it["status"]] for it in shown]
    return Result(
        f"Ditemukan {len(items)} siswa yang mengikuti ekstrakurikuler dan PKL (semester {sem})"
        + (f", menampilkan {len(shown)}." if len(items) > len(shown) else "."),
        kolom,
        baris,
        ["siswa", "kelas", "partisipasi_ekskul", "ekstrakurikuler", "penempatan_pkl", "perusahaan_pkl"],
    )


def _layer_a_gender_siswa(db: Db, low: str, kelas: str | None, jurusan: str, limit: int) -> Result | None:
    gender = parse_gender(low)
    wants_siswa_list = _has(low, r"\b(siswa|murid|siswi|pelajar)\b") and (
        gender != "" or (jurusan != "" and _has(low, r"\b(daftar|siapa|tampilkan|cari|sebutkan|data)\b"))
    )
    if not wants_siswa_list:
        return None
    if _has(low, r"\b(nilai|rapor|kkm|alpha|absen|kehadiran|jadwal|pelanggaran|poin|pkl|ekskul)\b"):
        return None

    is_count = _has(low, r"\b(berapa|jumlah|total|ada berapa|statistik|rekap)\b")
    if is_count:
        if kelas:
            rows = db.rows(queries.STATISTIK_SISWA_PER_KELAS, jurusan="")
            rows = [r for r in rows if r["kode"] == kelas]
            if not rows:
                return None
            r = rows[0]
            kolom = ["Kelas", "Wali Kelas", "Jumlah Siswa", "Laki-laki", "Perempuan"]
            baris = [[r["kelas"], r["wali_kelas"], r["jumlah_siswa"], r["laki_laki"], r["perempuan"]]]
            if gender == "L":
                teks = f"Jumlah siswa laki-laki di {r['kelas']}: {r['laki_laki']} dari {r['jumlah_siswa']} siswa."
            elif gender == "P":
                teks = f"Jumlah siswa perempuan di {r['kelas']}: {r['perempuan']} dari {r['jumlah_siswa']} siswa."
            else:
                teks = f"{r['kelas']} memiliki {r['jumlah_siswa']} siswa ({r['laki_laki']} laki-laki, {r['perempuan']} perempuan)."
            return Result(teks, kolom, baris, ["siswa", "kelas"])
        rows = db.rows(queries.STATISTIK_SISWA_PER_JURUSAN)
        if jurusan:
            rows = [r for r in rows if r["jurusan_kode"] == jurusan]
        kolom = ["Kode", "Jurusan", "Jumlah Kelas", "Jumlah Siswa", "Laki-laki", "Perempuan"]
        baris = [[r["jurusan_kode"], r["jurusan"], r["jumlah_kelas"], r["jumlah_siswa"], r["laki_laki"], r["perempuan"]] for r in rows]
        tot_s = sum(int(r["jumlah_siswa"]) for r in rows)
        tot_l = sum(int(r["laki_laki"]) for r in rows)
        tot_p = sum(int(r["perempuan"]) for r in rows)
        if gender == "L":
            teks = f"Total siswa laki-laki{' di jurusan ' + jurusan if jurusan else ''}: {tot_l} dari {tot_s} siswa."
        elif gender == "P":
            teks = f"Total siswa perempuan{' di jurusan ' + jurusan if jurusan else ''}: {tot_p} dari {tot_s} siswa."
        else:
            teks = f"Total siswa{' di jurusan ' + jurusan if jurusan else ''}: {tot_s} siswa ({tot_l} laki-laki, {tot_p} perempuan)."
        return Result(teks, kolom, baris, ["jurusan", "kelas", "siswa"])

    sql = """
    SELECT s.no_absen, s.nama, k.nama AS kelas, s.jenis_kelamin
    FROM siswa s
    JOIN kelas k ON k.kode = s.kelas_kode
    WHERE (CAST(:kelas AS TEXT) = '' OR s.kelas_kode = CAST(:kelas AS TEXT))
      AND (CAST(:jurusan AS TEXT) = '' OR k.jurusan_kode = CAST(:jurusan AS TEXT))
      AND (CAST(:jk AS TEXT) = '' OR s.jenis_kelamin = CAST(:jk AS TEXT))
    ORDER BY k.kode, s.no_absen
    """
    rows = db.rows(sql, kelas=kelas or "", jurusan=jurusan, jk=gender)
    if not rows:
        return Result("Tidak ada siswa yang sesuai dengan filter tersebut.", sumber=["siswa", "kelas"])
    shown = rows[: (limit or MAX_SQL_LIMIT)]
    kolom = ["No Absen", "Nama", "Kelas", "L/P"]
    baris = [[r["no_absen"], r["nama"], r["kelas"], r["jenis_kelamin"]] for r in shown]
    lbl_jk = " laki-laki" if gender == "L" else (" perempuan" if gender == "P" else "")
    lok = f" di {kelas.replace('-', ' ')}" if kelas else (f" di jurusan {jurusan}" if jurusan else " di kelas XII")
    note = f" (menampilkan {len(shown)} dari {len(rows)})" if len(rows) > len(shown) else ""
    return Result(f"Ditemukan {len(rows)} siswa{lbl_jk}{lok}{note}.", kolom, baris, ["siswa", "kelas"])


def _layer_a_avg_per_grup(db: Db, low: str, sem: int, mapel: str, urutan: str) -> Result | None:
    if not _has(low, r"\b(rata[\s-]*rata|nilai)\b"):
        return None
    by_kelas = _has(low, r"\b(per\s+kelas|tiap\s+kelas|setiap\s+kelas|antar\s+kelas)\b")
    by_jurusan = _has(low, r"\b(per\s+jurusan|tiap\s+jurusan|setiap\s+jurusan|antar\s+jurusan|jurusan\s+dengan\s+rata)\b")
    if not (by_kelas or by_jurusan):
        return None

    direction = "ASC" if urutan == "asc" else "DESC"
    if by_kelas:
        sql = f"""
        SELECT k.nama AS kelas, k.jurusan_kode, COUNT(DISTINCT s.nis) AS jumlah_siswa,
               ROUND(AVG(n.nilai), 2) AS rata_rata
        FROM nilai n
        JOIN siswa s ON s.nis = n.nis
        JOIN kelas k ON k.kode = s.kelas_kode
        WHERE n.semester = CAST(:semester AS INTEGER)
          AND (CAST(:mapel AS TEXT) = '' OR n.kode_mapel = CAST(:mapel AS TEXT))
        GROUP BY k.kode, k.nama, k.jurusan_kode
        ORDER BY rata_rata {direction}, k.kode
        LIMIT 40
        """
        rows = db.rows(sql, semester=sem, mapel=mapel)
        if not rows:
            return None
        kolom = ["Kelas", "Jurusan", "Jumlah Siswa", "Rata-rata"]
        baris = [[r["kelas"], r["jurusan_kode"], r["jumlah_siswa"], r["rata_rata"]] for r in rows]
        m_lbl = f" mapel {mapel}" if mapel else ""
        return Result(
            f"Rata-rata nilai{m_lbl} per kelas pada semester {sem}: {'terendah' if direction == 'ASC' else 'tertinggi'} "
            f"{rows[0]['kelas']} ({fmt_num(rows[0]['rata_rata'])}).",
            kolom,
            baris,
            ["nilai", "siswa", "kelas"],
        )

    sql = f"""
    SELECT j.kode AS jurusan_kode, j.nama_konsentrasi AS jurusan,
           COUNT(DISTINCT s.nis) AS jumlah_siswa, ROUND(AVG(n.nilai), 2) AS rata_rata
    FROM nilai n
    JOIN siswa s ON s.nis = n.nis
    JOIN kelas k ON k.kode = s.kelas_kode
    JOIN jurusan j ON j.kode = k.jurusan_kode
    WHERE n.semester = CAST(:semester AS INTEGER)
      AND (CAST(:mapel AS TEXT) = '' OR n.kode_mapel = CAST(:mapel AS TEXT))
    GROUP BY j.kode, j.nama_konsentrasi
    ORDER BY rata_rata {direction}, j.kode
    """
    rows = db.rows(sql, semester=sem, mapel=mapel)
    if not rows:
        return None
    kolom = ["Kode", "Jurusan", "Jumlah Siswa", "Rata-rata"]
    baris = [[r["jurusan_kode"], r["jurusan"], r["jumlah_siswa"], r["rata_rata"]] for r in rows]
    m_lbl = f" mapel {mapel}" if mapel else ""
    return Result(
        f"Rata-rata nilai{m_lbl} per jurusan pada semester {sem}: {'terendah' if direction == 'ASC' else 'tertinggi'} "
        f"{rows[0]['jurusan']} ({fmt_num(rows[0]['rata_rata'])}).",
        kolom,
        baris,
        ["nilai", "siswa", "kelas", "jurusan"],
    )


def _layer_a_kehadiran_grup(db: Db, low: str, sem: int, urutan: str) -> Result | None:
    if not _has(low, r"\b(kehadiran|hadir|alpha|alpa|sakit|izin|absensi)\b"):
        return None
    if not _has(low, r"\b(per\s+jurusan|tiap\s+jurusan|per\s+kelas|tiap\s+kelas|kelas\s+dengan\s+alpha)\b"):
        return None
    by_kelas = _has(low, r"\b(per\s+kelas|tiap\s+kelas|kelas\s+dengan)\b")
    order_dir = "ASC" if urutan == "asc" else "DESC"
    if by_kelas:
        sql = f"""
        SELECT k.nama AS kelas, k.jurusan_kode,
               SUM(kh.hadir) AS hadir, SUM(kh.sakit) AS sakit, SUM(kh.izin) AS izin, SUM(kh.alpha) AS alpha
        FROM kehadiran kh
        JOIN siswa s ON s.nis = kh.nis
        JOIN kelas k ON k.kode = s.kelas_kode
        WHERE kh.semester = CAST(:semester AS INTEGER)
        GROUP BY k.kode, k.nama, k.jurusan_kode
        ORDER BY alpha {order_dir}, k.kode
        LIMIT 40
        """
        rows = db.rows(sql, semester=sem)
        if not rows:
            return None
        kolom = ["Kelas", "Jurusan", "Hadir", "Sakit", "Izin", "Alpha"]
        baris = [[r["kelas"], r["jurusan_kode"], r["hadir"], r["sakit"], r["izin"], r["alpha"]] for r in rows]
        return Result(f"Rekap kehadiran per kelas semester {sem} ({len(rows)} kelas).", kolom, baris, ["kehadiran", "siswa", "kelas"])

    sql = f"""
    SELECT j.kode AS jurusan_kode, j.nama_konsentrasi AS jurusan,
           SUM(kh.hadir) AS hadir, SUM(kh.sakit) AS sakit, SUM(kh.izin) AS izin, SUM(kh.alpha) AS alpha
    FROM kehadiran kh
    JOIN siswa s ON s.nis = kh.nis
    JOIN kelas k ON k.kode = s.kelas_kode
    JOIN jurusan j ON j.kode = k.jurusan_kode
    WHERE kh.semester = CAST(:semester AS INTEGER)
    GROUP BY j.kode, j.nama_konsentrasi
    ORDER BY alpha {order_dir}, j.kode
    """
    rows = db.rows(sql, semester=sem)
    if not rows:
        return None
    kolom = ["Kode", "Jurusan", "Hadir", "Sakit", "Izin", "Alpha"]
    baris = [[r["jurusan_kode"], r["jurusan"], r["hadir"], r["sakit"], r["izin"], r["alpha"]] for r in rows]
    return Result(f"Rekap kehadiran per jurusan semester {sem} ({len(rows)} jurusan).", kolom, baris, ["kehadiran", "siswa", "kelas", "jurusan"])


def _layer_a_wali_kelas(db: Db, low: str, jurusan: str) -> Result | None:
    if not _has(low, r"\bwali\b"):
        return None
    rows = db.rows(queries.STATISTIK_SISWA_PER_KELAS, jurusan=jurusan)
    if not rows:
        return None
    kolom = ["Kelas", "Jurusan", "Wali Kelas", "Jumlah Siswa"]
    baris = [[r["kelas"], r["jurusan_kode"], r["wali_kelas"], r["jumlah_siswa"]] for r in rows]
    lok = f" jurusan {jurusan}" if jurusan else ""
    return Result(f"Daftar wali kelas XII{lok} ({len(rows)} kelas).", kolom, baris, ["kelas", "guru"])


def try_deterministic(db: Db, pesan: str, role: str = "admin", intent: dict | None = None) -> tuple[Result | None, bool]:
    """Layer A: Query analitik deterministik terparameter. Kembalikan (Result | None, ditolak_rbac)."""
    if not pesan or mentions_unknown_kelas(pesan) or outside_scope(pesan):
        return None, False

    low = pesan.lower()
    params = intent.get("params", {}) if isinstance(intent, dict) else {}
    kelas = params.get("kelas") or normalize_kelas(pesan)
    jurusan = params.get("jurusan") or ("" if kelas else parse_jurusan(pesan))
    sem = int(params.get("semester") or parse_semester(pesan) or _sem_berjalan(db))
    mapel = params.get("mapel") or parse_mapel(pesan, kelas, jurusan)
    limit = int(params.get("limit") or parse_limit(pesan, default=0) or 0)
    tingkat = params.get("tingkat") or parse_tingkat_pelanggaran(pesan)
    urutan = params.get("urutan") or parse_urutan(pesan, default="desc")

    res_pel, ditolak = _layer_a_pelanggaran(db, low, role, kelas, jurusan, tingkat, limit)
    if ditolak or res_pel is not None:
        return res_pel, ditolak

    for fn in (
        lambda: _layer_a_ekskul_pkl(db, low, kelas, jurusan, sem, limit),
        lambda: _layer_a_mitra_pkl(db, low, jurusan, limit),
        lambda: _layer_a_avg_per_grup(db, low, sem, mapel, urutan),
        lambda: _layer_a_kehadiran_grup(db, low, sem, urutan),
        lambda: _layer_a_gender_siswa(db, low, kelas, jurusan, limit),
        lambda: _layer_a_wali_kelas(db, low, jurusan),
    ):
        res = fn()
        if res is not None:
            return res, False

    # PKL per jurusan / sesi / status yang lolos dari handler standar
    if _has(low, r"\bpkl\b|magang|prakerin") and (jurusan or parse_pkl_sesi(pesan) or parse_pkl_status(pesan)):
        sesi = int(params.get("sesi") or parse_pkl_sesi(pesan) or 0)
        status = params.get("status") or parse_pkl_status(pesan)
        rows = db.rows(queries.PKL_BY_FILTER, kelas=kelas or "", jurusan=jurusan, sesi=sesi, status=status)
        if not rows:
            return Result("Tidak ada data penempatan PKL yang cocok dengan filter tersebut.", sumber=["penempatan_pkl"]), False
        shown = rows[: (limit or MAX_SQL_LIMIT)]
        kolom = ["Nama", "Kelas", "Perusahaan", "Posisi", "Sesi", "Status"]
        baris = [[r["nama"], r["kelas"], r["perusahaan"], r["posisi"], r["sesi"], r["status"]] for r in shown]
        return Result(
            f"Ditemukan {len(rows)} penempatan PKL" + (f" (menampilkan {len(shown)})." if len(rows) > len(shown) else "."),
            kolom,
            baris,
            ["penempatan_pkl", "perusahaan_pkl", "siswa", "kelas"],
        ), False

    return None, False


# ------------------------------------------------------------------ Layer B: Gemini Safe Read-Only SQL
_SCHEMA_DOC = """Skema Database SMKN 4 Bandung (kelas XII, PostgreSQL 16 & SQLite kompatibel):
- jurusan(kode PK, nama_konsentrasi, program_keahlian)
- guru(nip PK, nama)
- mapel_jadwal(kode PK, nama)
- mapel_rapor(kode PK, nama, kelompok ['umum'|'kejuruan'], berlaku_untuk)
- periode_akademik(semester PK 1..6, tahun_ajaran, tipe ['Ganjil'|'Genap'], kkm, hari_efektif, status ['selesai'|'berjalan'|'proyeksi'])
- jenis_pelanggaran(kode PK, nama, tingkat ['Ringan'|'Sedang'|'Berat'], poin, sanksi_disarankan)
- predikat_ekskul(predikat PK, nilai_min, nilai_maks, keterangan, deskripsi)
- sesi_pkl(sesi PK, tahun_ajaran, tanggal_mulai, tanggal_selesai, aturan)
- kelas(kode PK, nama, jurusan_kode FK->jurusan, tingkat, tahun_ajaran, wali_kelas_nip FK->guru)
- guru_mapel(nip FK->guru, kode_mapel_jadwal FK->mapel_jadwal)
- siswa(nis PK, nisn, nama, jenis_kelamin ['L'|'P'], no_absen, kelas_kode FK->kelas, status, sumber_data)
- ekstrakurikuler(kode PK, nama, deskripsi, hari, waktu, ketua_nis FK->siswa)
- pembina_ekskul(kode_ekskul FK->ekstrakurikuler, urutan, nama, biodata)
- perusahaan_pkl(kode PK, nama, jurusan_kode FK->jurusan, bidang_usaha, alamat, kota, kuota_sesi1, kuota_sesi2, posisi_tersedia, narahubung, telepon)
- nilai(nis FK->siswa, semester FK->periode_akademik, kode_mapel FK->mapel_rapor, nilai)
- kehadiran(nis FK->siswa, semester FK->periode_akademik, sakit, izin, alpha, hadir)
- pelanggaran(id PK, nis FK->siswa, kode_pelanggaran FK->jenis_pelanggaran, tanggal_kejadian, catatan)
- partisipasi_ekskul(nis FK->siswa, semester FK->periode_akademik, kode_ekskul FK->ekstrakurikuler, nilai, predikat)
- jadwal_pelajaran(id PK, kelas_kode FK->kelas, hari ['Senin'..'Jumat'], jam_mulai, jam_selesai, kode_mapel FK->mapel_jadwal, nip_guru FK->guru, ruangan)
- penempatan_pkl(nis PK FK->siswa, kode_perusahaan FK->perusahaan_pkl, posisi, sesi, pembimbing_perusahaan, pembimbing_sekolah_nip FK->guru, status ['Selesai'|'Sedang berlangsung'])

Aturan KETAT:
1. Buat TEPAT SATU query SELECT (atau WITH ... SELECT) standar yang kompatibel di PostgreSQL DAN SQLite (jangan pakai ILIKE, STRING_AGG, GROUP_CONCAT, ::type, ;, atau komentar --). Gunakan LOWER(col) LIKE LOWER('%...%') untuk pencarian teks.
2. Selalu sertakan LIMIT <= 40. Jangan gunakan SELECT *.
3. DILARANG mengakses tabel users, audit_log, import_batch, chat_*, knowledge_*, delete_request, pg_*, information_schema.
4. Jika pertanyaan tidak berhubungan dengan data sekolah SMKN 4 Bandung atau tidak bisa dijawab dari skema di atas, keluarkan {"sql": null, "reason": "outside_domain"}.
5. Format keluaran HANYA JSON: {"sql": "...", "ringkasan": "kalimat singkat penjelasan hasil"}."""


def _extract_gemini_json(raw: str) -> tuple[str | None, str]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None, ""
    if not isinstance(data, dict):
        return None, ""
    sql = data.get("sql")
    if not isinstance(sql, str) or not sql.strip():
        return None, ""
    # Bersihkan trailing ';' tunggal atau code fence bila Gemini menyertakannya
    cleaned = re.sub(r"^```(?:sql)?\s*|\s*```$", "", sql.strip(), flags=re.IGNORECASE).strip()
    if cleaned.endswith(";") and cleaned.count(";") == 1:
        cleaned = cleaned[:-1].strip()
    ring = data.get("ringkasan")
    return cleaned, (ring.strip()[:220] if isinstance(ring, str) else "")


def try_gemini_sql(db: Db, pesan: str, role: str = "admin") -> tuple[Result | None, bool]:
    """Layer B: Minta Gemini menyusun 1 query SELECT aman, validasi ketat, jalankan READ ONLY."""
    if not gemini.enabled() or not pesan or mentions_unknown_kelas(pesan) or outside_scope(pesan):
        return None, False

    raw = gemini.generate(_SCHEMA_DOC, f"Peran pengguna: {role}\nPertanyaan: {pesan}", json_mode=True)
    if not raw:
        return None, False

    sql, ringkasan = _extract_gemini_json(raw)
    if not sql:
        return None, False

    val = validate_readonly_sql(sql, role=role)
    if val.ditolak:
        return None, True
    if not val.ok:
        log.warning("SQL builder menolak query Gemini (%s): %s", val.reason, sql[:200])
        return None, False

    try:
        rows = _execute_readonly(db, val.sql)
    except Exception as exc:  # noqa: BLE001
        log.warning("Eksekusi SQL builder gagal (%s): %s", type(exc).__name__, exc)
        return None, False

    tables, _ = _extract_tables(_IDENT_QUOTES_RE.sub("", _strip_literals(val.sql)))
    sumber = sorted(tables & ALLOWED_TABLES)
    sensitif = "pelanggaran" in sumber

    if not rows:
        return Result(
            "Tidak ditemukan data yang sesuai untuk pertanyaan tersebut.",
            sumber=sumber,
            sensitif=sensitif,
        ), False

    keys = list(rows[0].keys())
    # Jangan pernah tampilkan kolom rahasia jika kebetulan terpilih
    keys = [k for k in keys if k.lower() not in ("password_hash", "token_exempt_jti")]
    kolom = [k.replace("_", " ").title() for k in keys]
    baris = [[r.get(k) for k in keys] for r in rows[:MAX_SQL_LIMIT]]
    teks = ringkasan or f"Ditemukan {len(baris)} baris data yang sesuai."
    if sensitif and "sensitif" not in teks.lower():
        teks += " Data ini sensitif; gunakan seperlunya untuk pembinaan."
    return Result(teks, kolom, baris, sumber, sensitif=sensitif), False


def plan_and_execute(db: Db, pesan: str, role: str = "admin", intent: dict | None = None) -> tuple[Result | None, bool, str]:
    """Jalankan Layer A lalu Layer B. Kembalikan (Result | None, ditolak_rbac, mode)."""
    res_a, ditolak_a = try_deterministic(db, pesan, role=role, intent=intent)
    if ditolak_a:
        return None, True, "aturan"
    if res_a is not None:
        return res_a, False, "aturan"

    res_b, ditolak_b = try_gemini_sql(db, pesan, role=role)
    if ditolak_b:
        return None, True, "gemini"
    if res_b is not None:
        return res_b, False, "gemini"
    return None, False, "aturan"

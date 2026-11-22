"""Uji menyeluruh Hybrid Query Engine v2, Safe SQL Builder, multi-turn follow-up, smart suggestions, dan RBAC."""
import csv
import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

from app import auth, db as app_db, engine, queries
from app.api import chat_routes, knowledge_routes
from app.config import settings
from app.engine import gemini, intents, sql_builder, titler
from app.engine.core import bound, plain
from app.engine.parsing import (
    mentions_all_scope,
    parse_limit,
    parse_pkl_sesi,
    parse_pkl_status,
    parse_poin_filter,
    parse_tingkat_pelanggaran,
    parse_urutan,
)
from app.engine.sql_builder import validate_readonly_sql

ROOT = Path(__file__).resolve().parents[2]
ORDER = (
    "jurusan guru mapel_jadwal mapel_rapor periode_akademik jenis_pelanggaran predikat_ekskul sesi_pkl kelas guru_mapel "
    "pemetaan_mapel siswa ekstrakurikuler pembina_ekskul perusahaan_pkl nilai kehadiran pelanggaran partisipasi_ekskul "
    "jadwal_pelajaran penempatan_pkl"
).split()


class RealDatasetSqliteDb:
    def __init__(self) -> None:
        self.c = sqlite3.connect(":memory:")
        self.c.row_factory = sqlite3.Row
        self.c.executescript((ROOT / "database/init/01_schema.sql").read_text(encoding="utf-8"))
        for t in ORDER:
            rows = list(csv.reader((ROOT / f"database/dataset_bersih/{t}.csv").open(encoding="utf-8")))
            h = rows[0]
            self.c.executemany(f"INSERT INTO {t} ({','.join(h)}) VALUES ({','.join('?' * len(h))})", rows[1:])

    def rows(self, sql: str, **params) -> list[dict]:
        cur = self.c.execute(sql.replace(" ILIKE ", " LIKE "), bound(sql, params))
        return [{k: plain(v) for k, v in dict(r).items()} for r in cur.fetchall()]


@pytest.fixture(scope="module")
def dataset_open_db():
    db = RealDatasetSqliteDb()

    @contextmanager
    def _open():
        yield db

    return _open


# ------------------------------------------------------------------ 1. Parsing
def test_parsing_v2_helpers():
    assert parse_limit("saya butuh 3 murid yang melakukan pelanggaran berat") == 3
    assert parse_limit("top 5 siswa terbaik") == 5
    assert parse_limit("lima siswa dengan alpha terbanyak") == 5
    assert parse_limit("tampilkan 99 murid terbaik") == 40
    assert parse_limit("0 siswa") == 1
    assert parse_limit("ranking nilai XII RPL 1 semester 5") == 0
    assert parse_limit("Siapa saja yang alpha lebih dari 5 hari?") == 0
    assert parse_limit("di satu sekolah") == 0

    assert parse_tingkat_pelanggaran("3 murid yang melakukan pelanggaran berat") == "Berat"
    assert parse_tingkat_pelanggaran("pelanggaran ringan") == "Ringan"
    assert parse_tingkat_pelanggaran("Apa sanksi untuk pelanggaran tingkat sedang?") == "Sedang"
    assert parse_tingkat_pelanggaran("Fasilitas apa yang sedang dibangun?") == ""
    assert parse_tingkat_pelanggaran("Siswa yang sedang berlangsung PKL") == ""

    assert parse_urutan("nilai terendah") == "asc"
    assert parse_urutan("nilai terburuk") == "asc"
    assert parse_urutan("nilai terbaik") == "desc"
    assert parse_urutan("nilai tertinggi") == "desc"

    assert mentions_all_scope("nilai terbaik di seluruh kelas") is True
    assert mentions_all_scope("semua kelas XII") is True
    assert mentions_all_scope("satu sekolah") is True
    assert mentions_all_scope("XII RPL 1") is False

    assert parse_pkl_sesi("PKL sesi 2") == 2
    assert parse_pkl_sesi("PKL") == 0
    assert parse_pkl_status("sudah selesai PKL") == "Selesai"
    assert parse_pkl_status("masih sedang berlangsung") == "Sedang berlangsung"


# ------------------------------------------------------------------ 2. Intents, Fast-path & Gemini Rescue
def test_sapaan_fast_path_tanpa_gemini(monkeypatch):
    monkeypatch.setattr(gemini, "enabled", lambda: True)

    def boom(*a, **k):
        raise AssertionError("Gemini tidak boleh dipanggil untuk sapaan/bantuan fast-path")

    monkeypatch.setattr(gemini, "generate", boom)
    for phrase in ("hai", "halo", "terima kasih", "kamu bisa apa?", "Selamat pagi!"):
        intent, mode = intents.understand(phrase)
        assert intent == {"intent": "sapaan", "params": {}}
        assert mode == "aturan"


def test_sapaan_plus_pertanyaan_tetap_ke_intent(monkeypatch):
    monkeypatch.setattr(gemini, "enabled", lambda: False)
    intent, _ = intents.understand("halo, siapa wali kelas XII TITL 6?")
    assert intent["intent"] == "info_wali_kelas"
    assert intent["params"].get("kelas") == "XII-TITL-6"


def test_gemini_tidak_dikenali_diselamatkan_oleh_rule_intent(monkeypatch):
    monkeypatch.setattr(gemini, "enabled", lambda: True)
    monkeypatch.setattr(gemini, "generate", lambda *a, **k: '{"intent": "tidak_dikenali", "params": {}}')

    i1, m1 = intents.understand("saya butuh 3 murid yang melakukan pelanggaran berat")
    assert i1["intent"] == "pelanggaran_siswa"
    assert i1["params"]["tingkat"] == "Berat"
    assert i1["params"]["limit"] == 3
    assert m1 == "aturan"

    i2, _ = intents.understand("berikan saya data 3 murid dengan nilai terbaik di seluruh kelas")
    assert i2["intent"] == "ranking_kelas"
    assert i2["params"]["limit"] == 3
    assert i2["params"]["urutan"] == "desc"

    i3, _ = intents.understand("berapa jumlah siswa per jurusan?")
    assert i3["intent"] == "statistik_sekolah"


def test_sanksi_pelanggaran_sedang_vs_pelanggaran_siswa(monkeypatch):
    monkeypatch.setattr(gemini, "enabled", lambda: False)
    sanksi = intents.rule_intent("Apa sanksi untuk pelanggaran tingkat sedang?")
    assert sanksi["intent"] == "info_sekolah"

    murid = intents.rule_intent("saya butuh 3 murid yang melakukan pelanggaran berat")
    assert murid["intent"] == "pelanggaran_siswa"
    assert murid["params"]["tingkat"] == "Berat"
    assert murid["params"]["limit"] == 3


def test_multi_turn_followup_intents(monkeypatch):
    monkeypatch.setattr(gemini, "enabled", lambda: False)
    hist_rank = [
        {"role": "user", "konten": "ranking nilai XII RPL 1 semester 5"},
        {
            "role": "ai",
            "konten": "Rata-rata tertinggi...",
            "intent": {"intent": "ranking_kelas", "params": {"kelas": "XII-RPL-1", "semester": 5, "urutan": "desc"}},
        },
    ]
    f1, _ = intents.understand("kalau semester 4?", history=hist_rank)
    assert f1["intent"] == "ranking_kelas"
    assert f1["params"]["kelas"] == "XII-RPL-1"
    assert f1["params"]["semester"] == 4

    f2, _ = intents.understand("yang XII RPL 2?", history=hist_rank)
    assert f2["intent"] == "ranking_kelas"
    assert f2["params"]["kelas"] == "XII-RPL-2"
    assert f2["params"]["semester"] == 5

    hist_pel = [
        {"role": "user", "konten": "saya butuh 3 murid yang melakukan pelanggaran berat"},
        {
            "role": "ai",
            "konten": "Ditemukan...",
            "intent": {"intent": "pelanggaran_siswa", "params": {"tingkat": "Berat", "limit": 3}},
        },
    ]
    f3, _ = intents.understand("yang ringan saja?", history=hist_pel)
    assert f3["intent"] == "pelanggaran_siswa"
    assert f3["params"]["tingkat"] == "Ringan"
    assert f3["params"]["limit"] == 3

    # Pertanyaan baru yang berdiri sendiri tidak boleh dibajak oleh riwayat
    f4, _ = intents.understand("ada ekskul apa saja?", history=hist_rank)
    assert f4["intent"] == "info_ekskul"


# ------------------------------------------------------------------ 3. End-to-End Real Dataset
def test_e2e_query_utama_dan_rbac(dataset_open_db, monkeypatch):
    monkeypatch.setattr(gemini, "enabled", lambda: False)

    # 1) 3 murid pelanggaran berat (admin & bk diizinkan, teacher ditolak)
    for role in ("admin", "bk", "kepala_sekolah"):
        out = engine.answer(dataset_open_db, "saya butuh 3 murid yang melakukan pelanggaran berat", role=role)
        assert out["intent"]["intent"] == "pelanggaran_siswa"
        assert out["sensitif"] is True
        assert out["butuh_klarifikasi"] is False
        assert out["tabel"] is not None
        assert len(out["tabel"]["baris"]) == 3
        names = [row[0] for row in out["tabel"]["baris"]]
        assert len(set(names)) == 3  # 3 murid unik
        assert "Bima Umar Pangestu" in names

    out_teacher = engine.answer(dataset_open_db, "saya butuh 3 murid yang melakukan pelanggaran berat", role="teacher")
    assert out_teacher.get("ditolak") is True
    assert out_teacher["sensitif"] is True
    assert out_teacher["tabel"] is None
    assert out_teacher["sumber"] == []
    assert "BK, Kepala Sekolah, dan Admin" in out_teacher["jawaban"]

    # 2) 3 murid nilai terbaik seluruh kelas
    out_top = engine.answer(dataset_open_db, "berikan saya data 3 murid dengan nilai terbaik di seluruh kelas", role="teacher")
    assert out_top["intent"]["intent"] == "ranking_kelas"
    assert out_top["butuh_klarifikasi"] is False
    assert out_top["tabel"] is not None
    assert len(out_top["tabel"]["baris"]) == 3
    assert out_top["tabel"]["baris"][0][1] == "Fani Oktaviani"
    assert out_top["tabel"]["baris"][0][2] == "XII RPL 3"

    # 3) hai (sapaan)
    out_hi = engine.answer(dataset_open_db, "hai", role="teacher")
    assert out_hi["intent"]["intent"] == "sapaan"
    assert out_hi["butuh_klarifikasi"] is False
    assert out_hi["contoh"] == []

    # 4) jumlah siswa per jurusan
    out_stat = engine.answer(dataset_open_db, "berapa jumlah siswa per jurusan?", role="teacher")
    assert out_stat["intent"]["intent"] == "statistik_sekolah"
    assert out_stat["butuh_klarifikasi"] is False
    assert out_stat["tabel"] is not None
    assert len(out_stat["tabel"]["baris"]) == 5
    assert "612" in out_stat["jawaban"]

    # 5) ekskul terpopuler & guru mapel & nama siswa dengan kata 'Bagus' / 'Putra'
    out_eks = engine.answer(dataset_open_db, "ekskul apa yang paling populer semester 5?", role="teacher")
    assert out_eks["tabel"] is not None
    assert out_eks["tabel"]["baris"][0][0] == "NHK (Jepang)"

    out_guru = engine.answer(dataset_open_db, "siapa saja guru Matematika?", role="teacher")
    assert out_guru["intent"]["intent"] == "jadwal_guru"
    assert out_guru["tabel"] is not None
    assert any("Entin Supriatin" in row[0] for row in out_guru["tabel"]["baris"])

    out_bagus = engine.answer(dataset_open_db, "profil Bagus Lestari", role="teacher")
    assert out_bagus["tabel"] is not None and "Bagus Lestari" in out_bagus["jawaban"]


def test_e2e_sql_builder_layer_a_dan_rbac(dataset_open_db, monkeypatch):
    monkeypatch.setattr(gemini, "enabled", lambda: False)

    r_mitra = engine.answer(dataset_open_db, "daftar mitra PKL untuk jurusan RPL", role="teacher")
    assert r_mitra["tabel"] is not None and len(r_mitra["tabel"]["baris"]) == 8
    assert all(row[1] == "RPL" for row in r_mitra["tabel"]["baris"])

    r_gender = engine.answer(dataset_open_db, "daftar siswa perempuan di XII RPL 1", role="teacher")
    assert r_gender["tabel"] is not None
    assert all(row[3] == "P" for row in r_gender["tabel"]["baris"])

    r_avg = engine.answer(dataset_open_db, "rata-rata nilai per jurusan semester 5", role="teacher")
    assert r_avg["tabel"] is not None and len(r_avg["tabel"]["baris"]) == 5

    r_join = engine.answer(dataset_open_db, "siswa XII RPL 1 yang ikut ekskul dan PKL semester 5", role="teacher")
    assert r_join["tabel"] is not None and len(r_join["tabel"]["baris"]) >= 1

    # Teacher mencoba rekap pelanggaran per jurusan -> wajib diblokir RBAC
    r_pel_t = engine.answer(dataset_open_db, "rekap pelanggaran per jurusan", role="teacher")
    assert r_pel_t.get("ditolak") is True and r_pel_t["tabel"] is None and r_pel_t["sumber"] == []

    r_pel_bk = engine.answer(dataset_open_db, "rekap pelanggaran per jurusan", role="bk")
    assert r_pel_bk["sensitif"] is True and r_pel_bk["tabel"] is not None and len(r_pel_bk["tabel"]["baris"]) == 5


# ------------------------------------------------------------------ 4. Validator Security & Layer B
def test_validate_readonly_sql_security_dan_rbac():
    # Query valid + penambahan/pembatasan LIMIT <= 40
    ok1 = validate_readonly_sql("SELECT nama, kelas_kode FROM siswa", "teacher")
    assert ok1.ok is True and ok1.sql.endswith("LIMIT 40") and ok1.ditolak is False

    ok2 = validate_readonly_sql("SELECT nama FROM siswa LIMIT 120", "admin")
    assert ok2.ok is True and "LIMIT 40" in ok2.sql

    ok_cte = validate_readonly_sql(
        "WITH top_s AS (SELECT nis, AVG(nilai) AS r FROM nilai GROUP BY nis) SELECT s.nama, top_s.r FROM top_s JOIN siswa s ON s.nis = top_s.nis LIMIT 5",
        "teacher",
    )
    assert ok_cte.ok is True

    # Teacher diperbolehkan membaca tabel publik jenis_pelanggaran (aturan/sanksi), DILARANG membaca pelanggaran (catatan siswa)
    assert validate_readonly_sql("SELECT nama, sanksi_disarankan FROM jenis_pelanggaran LIMIT 10", "teacher").ok is True
    for bad_rbac in (
        "SELECT * FROM pelanggaran LIMIT 5",
        'SELECT * FROM "pelanggaran" LIMIT 5',
        "SELECT s.nama FROM siswa s JOIN pelanggaran p ON p.nis = s.nis LIMIT 5",
        "SELECT nama FROM siswa WHERE nis IN (SELECT nis FROM pelanggaran) LIMIT 5",
    ):
        v = validate_readonly_sql(bad_rbac, "teacher")
        assert v.ok is False and v.ditolak is True
        assert validate_readonly_sql(bad_rbac, "bk").ok is True
        assert validate_readonly_sql(bad_rbac, "admin").ok is True

    # Tolak mutasi, multi-statement, komentar, dan tabel sistem/terlarang
    for malicious in (
        "DELETE FROM siswa",
        "UPDATE siswa SET nama = 'x'",
        "INSERT INTO siswa (nis, nama) VALUES ('1', 'x')",
        "DROP TABLE siswa",
        "SELECT nama FROM siswa; DROP TABLE siswa",
        "SELECT nama FROM siswa -- komentar",
        "SELECT nama FROM siswa /* komentar */",
        "WITH d AS (DELETE FROM siswa RETURNING *) SELECT * FROM d LIMIT 5",
        "SELECT * FROM users LIMIT 5",
        "SELECT * FROM audit_log LIMIT 5",
        "SELECT * FROM import_batch LIMIT 5",
        "SELECT * FROM chat_sessions LIMIT 5",
        "SELECT * FROM chat_messages LIMIT 5",
        "SELECT * FROM knowledge_document LIMIT 5",
        "SELECT * FROM knowledge_edge LIMIT 5",
        "SELECT * FROM delete_request LIMIT 5",
        "SELECT * FROM pg_catalog.pg_tables LIMIT 5",
        "SELECT pg_sleep(5)",
        "SELECT * FROM information_schema.tables LIMIT 5",
        "SELECT * FROM sqlite_master LIMIT 5",
        "SELECT nama FROM siswa LIMIT 0",
        "SELECT nama FROM siswa LIMIT ALL",
        "SELECT nama FROM siswa FOR UPDATE",
    ):
        res = validate_readonly_sql(malicious, "admin")
        assert res.ok is False, f"Seharusnya ditolak: {malicious}"


def test_sql_builder_layer_b_dan_pg_readonly_timeout(dataset_open_db, monkeypatch):
    monkeypatch.setattr(gemini, "enabled", lambda: True)

    # 1) Layer B sukses menjalankan SELECT aman untuk query fleksibel
    monkeypatch.setattr(
        gemini,
        "generate",
        lambda *a, **k: json.dumps({
            "sql": "SELECT kota, COUNT(*) AS jumlah_mitra FROM perusahaan_pkl GROUP BY kota ORDER BY jumlah_mitra DESC LIMIT 10",
            "ringkasan": "Sebaran mitra PKL berdasarkan kota.",
        }),
    )
    res_ok = engine.answer(dataset_open_db, "kota mana saja yang punya mitra paling banyak?", role="teacher")
    assert res_ok["tabel"] is not None and res_ok["mode"] == "ai"
    assert not res_ok["butuh_klarifikasi"]
    assert all(s["detail"] == [] for s in res_ok["jejak_pikir"])

    # 2) Layer A & Layer B menghasilkan SQL ke tabel pelanggaran untuk teacher -> wajib diblokir RBAC (ditolak=True)
    monkeypatch.setattr(
        gemini,
        "generate",
        lambda *a, **k: json.dumps({
            "sql": "SELECT s.nama, COUNT(*) AS total FROM pelanggaran p JOIN siswa s ON s.nis = p.nis GROUP BY s.nama LIMIT 5",
            "ringkasan": "Rekap kasus.",
        }),
    )
    res_rbac = engine.answer(dataset_open_db, "rekap catatan kasus terbanyak siswa?", role="teacher")
    assert res_rbac.get("ditolak") is True and res_rbac["tabel"] is None and res_rbac["sumber"] == []
    assert res_rbac["mode"] in ("ai", "lokal")
    assert all(s["detail"] == [] for s in res_rbac["jejak_pikir"])

    res_rbac_b = engine.answer(dataset_open_db, "rekap kedisiplinan siswa terbanyak?", role="teacher")
    assert res_rbac_b.get("ditolak") is True and res_rbac_b["tabel"] is None and res_rbac_b["sumber"] == []
    assert res_rbac_b["mode"] == "ai"
    assert all(s["detail"] == [] for s in res_rbac_b["jejak_pikir"])

    # 3) Layer B menghasilkan SQL ke tabel users -> ditolak validator, tidak bocor
    monkeypatch.setattr(
        gemini,
        "generate",
        lambda *a, **k: json.dumps({"sql": "SELECT username, password_hash FROM users LIMIT 5", "ringkasan": "users"}),
    )
    res_users = engine.answer(dataset_open_db, "siapa saja akun login di sistem?", role="admin")
    assert res_users["butuh_klarifikasi"] is True and res_users["tabel"] is None

    # 4) Verifikasi koneksi PostgreSQL mengaktifkan READ ONLY + statement_timeout = '3000ms'
    executed: list[str] = []

    class FakePgResult:
        def mappings(self):
            return self

        def all(self):
            return [{"jumlah": 612}]

    class FakePgConn:
        dialect = type("D", (), {"name": "postgresql"})()

        @contextmanager
        def begin_nested(self):
            yield

        def execute(self, stmt):
            executed.append(str(stmt))
            return FakePgResult()

    class FakePgDb:
        conn = FakePgConn()

        def rows(self, sql, **p):
            return []

    rows = sql_builder._execute_readonly(FakePgDb(), "SELECT COUNT(*) AS jumlah FROM siswa LIMIT 1")
    assert rows == [{"jumlah": 612}]
    assert any("SET LOCAL TRANSACTION READ ONLY" in q for q in executed)
    assert any("SET LOCAL statement_timeout = '3000ms'" in q for q in executed)


# ------------------------------------------------------------------ 5. Smart Suggestions
def test_build_smart_suggestions_rbac_dan_batas():
    for prompt, intent_name in (
        ("lorem ipsum", "tidak_dikenali"),
        ("siapa murid yang melakukan pelanggaran berat?", "pelanggaran_siswa"),
        ("nilai XII TITL 9", "nilai_siswa"),
        ("nilai kelas X RPL 1", "di_luar_cakupan"),
        ("siapa saja PKL?", "penempatan_pkl"),
    ):
        sug_t = intents.build_smart_suggestions(prompt, {"intent": intent_name, "params": {}}, "teacher", None)
        assert 1 <= len(sug_t) <= 3
        assert all("pelanggaran" not in s.lower() for s in sug_t)

        sug_b = intents.build_smart_suggestions(prompt, {"intent": intent_name, "params": {}}, "bk", None)
        assert 1 <= len(sug_b) <= 3


# ------------------------------------------------------------------ 6. Integrasi /chat Multi-Turn & Audit DB
def test_chat_api_multiturn_history_dan_audit(monkeypatch):
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    with eng.begin() as c:
        c.connection.driver_connection.executescript((ROOT / "database/init/01_schema.sql").read_text(encoding="utf-8"))
        for t in ORDER:
            rows = list(csv.reader((ROOT / f"database/dataset_bersih/{t}.csv").open(encoding="utf-8")))
            h = rows[0]
            c.execute(
                text(f"INSERT INTO {t} ({','.join(h)}) VALUES ({','.join(':' + col for col in h)})"),
                [dict(zip(h, row)) for row in rows[1:]],
            )
        c.execute(text(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, nama TEXT, nip TEXT, "
            "role TEXT, password_hash TEXT, wajib_ganti_password INT DEFAULT 0, aktif INT DEFAULT 1, dibuat_pada TEXT)"
        ))
        c.execute(text(
            "CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INT, aksi TEXT, pertanyaan TEXT, "
            "intent_json TEXT, tabel_diakses TEXT, status TEXT, waktu TEXT DEFAULT CURRENT_TIMESTAMP)"
        ))
        c.execute(text(
            "CREATE TABLE chat_sessions (id TEXT PRIMARY KEY, user_id INT NOT NULL, judul TEXT NOT NULL, "
            "pinned INT NOT NULL DEFAULT 0, dibuat_pada TEXT DEFAULT CURRENT_TIMESTAMP, diperbarui_pada TEXT DEFAULT CURRENT_TIMESTAMP)"
        ))
        c.execute(text(
            "CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, "
            "role TEXT NOT NULL, konten TEXT NOT NULL, metadata_json TEXT, dibuat_pada TEXT DEFAULT CURRENT_TIMESTAMP)"
        ))
        c.execute(text("INSERT INTO users (id, username, nama, role, password_hash, wajib_ganti_password) VALUES (1, 'guru1', 'Guru Satu', 'teacher', 'x', 0)"))

    monkeypatch.setattr(chat_routes, "db_engine", eng)
    monkeypatch.setattr(
        queries,
        "AUDIT_CHAT",
        "INSERT INTO audit_log (user_id, aksi, pertanyaan, intent_json, tabel_diakses, status) "
        "VALUES (:user_id, :aksi, :pertanyaan, :intent, :tabel, :status)",
    )
    monkeypatch.setattr(gemini, "enabled", lambda: False)
    chat_routes._hits.clear()
    monkeypatch.setattr(settings, "chat_rate_per_minute", 50)

    app = FastAPI()
    app.include_router(chat_routes.router)
    app.dependency_overrides[auth.active_user] = lambda: {"id": 1, "username": "guru1", "role": "teacher"}
    client = TestClient(app)

    # Turn 1
    r1 = client.post("/chat", json={"pesan": "ranking nilai XII RPL 1 semester 5"})
    assert r1.status_code == 200
    b1 = r1.json()
    sid = b1["sesi_id"]
    assert sid and b1["intent"]["intent"] == "ranking_kelas" and b1["intent"]["params"]["semester"] == 5

    # Turn 2 follow-up pada sesi yang sama -> membaca history 6 pesan terakhir
    r2 = client.post("/chat", json={"pesan": "kalau semester 4?", "sesi_id": sid})
    assert r2.status_code == 200
    b2 = r2.json()
    assert b2["intent"]["intent"] == "ranking_kelas"
    assert b2["intent"]["params"]["kelas"] == "XII-RPL-1"
    assert b2["intent"]["params"]["semester"] == 4
    assert b2["tabel"] is not None

    # Turn 3 RBAC ditolak dicatat di audit_log
    r3 = client.post("/chat", json={"pesan": "saya butuh 3 murid yang melakukan pelanggaran berat", "sesi_id": sid})
    assert r3.status_code == 200
    b3 = r3.json()
    assert b3["sensitif"] is True and b3["tabel"] is None
    with eng.connect() as c:
        aud = c.execute(text("SELECT aksi, status FROM audit_log ORDER BY id DESC LIMIT 1")).one()
    assert aud == ("chat_data_sensitif", "ditolak")


# ------------------------------------------------------------------ 7. SIS v3: Numeric Violation Point Filtering
def test_parse_poin_filter_dan_parse_limit_tidak_tertukar():
    # Exact (=)
    for phrase in (
        "berikan saya daftar siswa dengan total poin pelanggarannya 80",
        "siswa dengan poin pelanggaran 80",
        "poinnya 80",
        "poin = 80",
        "siswa dengan poin 80",
        "80 poin",
    ):
        assert parse_poin_filter(phrase) == ("=", 80, 80), f"Gagal parse '=': {phrase}"

    # >
    for phrase in ("poin di atas 50", "lebih dari 50 poin", "> 50"):
        assert parse_poin_filter(phrase) == (">", 50, 0), f"Gagal parse '>': {phrase}"

    # >=
    for phrase in (
        "siswa dengan poin pelanggaran minimal 75",
        "minimal 75 poin",
        "poin >= 75",
        "75 poin atau lebih",
    ):
        assert parse_poin_filter(phrase) == (">=", 75, 0), f"Gagal parse '>=': {phrase}"

    # <
    for phrase in ("poin di bawah 30", "kurang dari 30 poin", "< 30"):
        assert parse_poin_filter(phrase) == ("<", 30, 0), f"Gagal parse '<': {phrase}"

    # <=
    for phrase in ("maksimal 25 poin", "poin <= 25", "poin maksimal 25"):
        assert parse_poin_filter(phrase) == ("<=", 25, 0), f"Gagal parse '<=': {phrase}"

    # between
    for phrase in (
        "poin pelanggaran antara 50 sampai 80",
        "poin antara 50 dan 80",
        "50-80 poin",
        "poin 80 sampai 50",
    ):
        assert parse_poin_filter(phrase) == ("between", 50, 80), f"Gagal parse 'between': {phrase}"

    # Metrik non-poin tidak boleh salah terbaca sebagai filter poin
    assert parse_poin_filter("alpha lebih dari 5 hari") == ("", 0, 0)
    assert parse_poin_filter("nilai di bawah 75") == ("", 0, 0)
    assert parse_poin_filter("ranking nilai XII RPL 1 semester 5") == ("", 0, 0)

    # parse_limit TIDAK boleh tertukar dengan angka poin (80, 75, 50, 25)
    assert parse_limit("berikan saya daftar siswa dengan total poin pelanggarannya 80") == 0
    assert parse_limit("siswa dengan poin pelanggaran minimal 75") == 0
    assert parse_limit("poin pelanggaran antara 50 sampai 80") == 0
    assert parse_limit("maksimal 25 poin") == 0
    assert parse_limit("poin maksimal 25") == 0
    assert parse_limit("3 siswa dengan total poin pelanggarannya 80") == 3


def test_e2e_pelanggaran_poin_filter_dan_rbac(dataset_open_db, monkeypatch):
    monkeypatch.setattr(gemini, "enabled", lambda: False)

    # 1) Exact = 80 -> tepat 9 siswa di dataset, seluruhnya Total Poin == 80, RBAC berlaku
    q_exact = "berikan saya daftar siswa dengan total poin pelanggarannya 80"
    for role in ("admin", "bk", "kepala_sekolah"):
        out = engine.answer(dataset_open_db, q_exact, role=role)
        assert out["intent"]["intent"] == "pelanggaran_siswa"
        assert out["intent"]["params"].get("poin_op") == "="
        assert out["intent"]["params"].get("poin_min") == 80
        assert out["intent"]["params"].get("poin_max") == 80
        assert "limit" not in out["intent"]["params"]
        assert out["sensitif"] is True
        assert out["butuh_klarifikasi"] is False
        assert out["tabel"] is not None
        assert len(out["tabel"]["baris"]) == 9
        idx_poin = out["tabel"]["kolom"].index("Total Poin")
        assert all(int(row[idx_poin]) == 80 for row in out["tabel"]["baris"])
        assert "9 siswa" in out["jawaban"]
        assert "80 poin" in out["jawaban"]

    out_teacher = engine.answer(dataset_open_db, q_exact, role="teacher")
    assert out_teacher.get("ditolak") is True
    assert out_teacher["sensitif"] is True
    assert out_teacher["tabel"] is None
    assert out_teacher["sumber"] == []

    # 2) Threshold >= 75
    out_min = engine.answer(dataset_open_db, "siswa dengan poin pelanggaran minimal 75", role="admin")
    assert out_min["intent"]["intent"] == "pelanggaran_siswa"
    assert out_min["intent"]["params"].get("poin_op") == ">="
    assert out_min["intent"]["params"].get("poin_min") == 75
    assert out_min["sensitif"] is True
    assert out_min["tabel"] is not None
    assert len(out_min["tabel"]["baris"]) >= 9
    idx_poin_min = out_min["tabel"]["kolom"].index("Total Poin")
    assert all(int(row[idx_poin_min]) >= 75 for row in out_min["tabel"]["baris"])

    # 3) Range between 50..80
    out_rng = engine.answer(dataset_open_db, "poin pelanggaran antara 50 sampai 80", role="bk")
    assert out_rng["intent"]["intent"] == "pelanggaran_siswa"
    assert out_rng["intent"]["params"].get("poin_op") == "between"
    assert out_rng["intent"]["params"].get("poin_min") == 50
    assert out_rng["intent"]["params"].get("poin_max") == 80
    assert out_rng["tabel"] is not None
    assert len(out_rng["tabel"]["baris"]) >= 9
    idx_poin_rng = out_rng["tabel"]["kolom"].index("Total Poin")
    assert all(50 <= int(row[idx_poin_rng]) <= 80 for row in out_rng["tabel"]["baris"])

    # 4) 0-match informative fallback -> sebutkan nilai poin terdekat yang tercatat
    out_zero = engine.answer(dataset_open_db, "total poin pelanggarannya 999", role="admin")
    assert out_zero["intent"]["intent"] == "pelanggaran_siswa"
    assert out_zero["sensitif"] is True
    assert out_zero["butuh_klarifikasi"] is False
    assert out_zero["tabel"] is None
    assert "Tidak ditemukan" in out_zero["jawaban"]
    assert "999 poin" in out_zero["jawaban"]
    assert "paling dekat:" in out_zero["jawaban"]
    assert "100 poin" in out_zero["jawaban"]


# ------------------------------------------------------------------ 8. SIS v3: Ekskul per Kelas/Jurusan & Multi-turn
def test_e2e_ekskul_per_kelas_dan_followup(dataset_open_db, monkeypatch):
    monkeypatch.setattr(gemini, "enabled", lambda: False)

    # 1) Data ekskul siswa kelas XII RPL 1 -> ringkasan ekskul kelas tersebut (BUKAN daftar 19 ekskul generik)
    q1 = "berikan saya data ekskul siswa kelas xii rpl 1"
    out1 = engine.answer(dataset_open_db, q1, role="teacher")
    assert out1["intent"]["intent"] == "info_ekskul"
    assert out1["intent"]["params"].get("kelas") == "XII-RPL-1"
    assert out1["butuh_klarifikasi"] is False
    assert out1["tabel"] is not None
    assert out1["tabel"]["kolom"] == ["Ekskul", "Jumlah Peserta", "Hari", "Waktu", "Pembina"]
    assert "XII RPL 1" in out1["jawaban"]
    assert "Ada 19 ekstrakurikuler" not in out1["jawaban"]
    assert len(out1["tabel"]["baris"]) >= 1
    assert all(int(row[1]) >= 1 for row in out1["tabel"]["baris"])

    # Verifikasi konsistensi terhadap dataset langsung
    with dataset_open_db() as db:
        expected_ringkas = db.rows(queries.EKSKUL_BY_KELAS_RINGKAS, semester=5, kelas="XII-RPL-1", jurusan="")
        expected_peserta = db.rows(
            queries.EKSKUL_PESERTA_BY_KELAS, semester=5, kelas="XII-RPL-1", jurusan="", kode_ekskul=""
        )
    assert len(out1["tabel"]["baris"]) == len(expected_ringkas)

    # 2) Multi-turn follow-up "yang diikuti" & "anggotanya siapa saja" dengan riwayat info_ekskul(XII-RPL-1)
    hist_ekskul = [
        {"role": "user", "konten": q1},
        {"role": "ai", "konten": out1["jawaban"], "intent": out1["intent"]},
    ]

    out_fu1 = engine.answer(dataset_open_db, "yang diikuti", role="teacher", history=hist_ekskul)
    assert out_fu1["intent"]["intent"] == "info_ekskul"
    assert out_fu1["intent"]["params"].get("kelas") == "XII-RPL-1"
    assert out_fu1["butuh_klarifikasi"] is False
    assert "Siswa tidak ditemukan" not in out_fu1["jawaban"]
    assert out_fu1["tabel"] is not None
    assert len(out_fu1["tabel"]["baris"]) == len(expected_ringkas)

    out_fu2 = engine.answer(dataset_open_db, "anggotanya siapa saja", role="teacher", history=hist_ekskul)
    assert out_fu2["intent"]["intent"] == "info_ekskul"
    assert out_fu2["intent"]["params"].get("kelas") == "XII-RPL-1"
    assert out_fu2["butuh_klarifikasi"] is False
    assert "Siswa tidak ditemukan" not in out_fu2["jawaban"]
    assert out_fu2["tabel"] is not None
    assert out_fu2["tabel"]["kolom"] == ["Nama", "Kelas", "Ekskul", "Nilai", "Predikat"]
    assert len(out_fu2["tabel"]["baris"]) == min(len(expected_peserta), 40)
    assert all(row[1] == "XII RPL 1" for row in out_fu2["tabel"]["baris"])

    # 3) Jurusan ekskul & ekskul spesifik per kelas
    out_jur = engine.answer(dataset_open_db, "data ekskul jurusan RPL", role="teacher")
    assert out_jur["intent"]["intent"] == "info_ekskul"
    assert out_jur["intent"]["params"].get("jurusan") == "RPL"
    assert out_jur["tabel"] is not None
    assert out_jur["tabel"]["kolom"] == ["Ekskul", "Jumlah Peserta", "Hari", "Waktu", "Pembina"]
    assert "jurusan RPL" in out_jur["jawaban"]


# ------------------------------------------------------------------ 9. SIS v3: Smart Auto-Titling
def test_titler_deterministic_dan_sanitasi(monkeypatch):
    monkeypatch.setattr(gemini, "enabled", lambda: False)

    cases = [
        ("hai", {"intent": "sapaan", "params": {}}, "Percakapan Baru"),
        (
            "berikan saya daftar siswa dengan total poin pelanggarannya 80",
            {"intent": "pelanggaran_siswa", "params": {"poin_op": "=", "poin_min": 80, "poin_max": 80}},
            "Siswa Poin Pelanggaran 80",
        ),
        (
            "saya butuh 3 murid yang melakukan pelanggaran berat",
            {"intent": "pelanggaran_siswa", "params": {"tingkat": "Berat", "limit": 3}},
            "Pelanggaran Berat Siswa XII",
        ),
        (
            "berikan saya data ekskul siswa kelas xii rpl 1",
            {"intent": "info_ekskul", "params": {"kelas": "XII-RPL-1"}},
            "Ekskul Siswa XII RPL 1",
        ),
        (
            "nilai terendah XII RPL 1",
            {"intent": "ranking_kelas", "params": {"kelas": "XII-RPL-1", "urutan": "asc"}},
            "Peringkat Nilai Terendah XII RPL 1",
        ),
        (
            "jadwal XII TITL 6 hari Senin",
            {"intent": "jadwal_kelas", "params": {"kelas": "XII-TITL-6", "hari": "Senin"}},
            "Jadwal XII TITL 6 Hari Senin",
        ),
        (
            "penempatan PKL XII RPL 1",
            {"intent": "penempatan_pkl", "params": {"kelas": "XII-RPL-1"}},
            "Penempatan PKL XII RPL 1",
        ),
    ]

    for pesan, intent_obj, expected in cases:
        title = titler.generate_session_title(pesan, intent_obj)
        assert title == expected
        assert len(title) <= titler.MAX_TITLE_LEN
        assert not any(ch in title for ch in ('"', "'", "“", "”", "`"))
        assert titler._EMOJI_RE.search(title) is None
        assert not title.endswith((".", "!", "?", ":"))

    # Uji sanitasi output Gemini: kutip, emoji, NIS 8-digit, dan panjang > 60 karakter
    monkeypatch.setattr(gemini, "enabled", lambda: True)
    monkeypatch.setattr(
        gemini,
        "generate",
        lambda *a, **k: '"📊 Laporan Nilai 24251001 Kelas XII RPL 1 Semester 5 Tahun Ajaran Baru Sangat Lengkap Sekali!!!"',
    )
    cleaned = titler.generate_session_title("nilai siswa", {"intent": "nilai_siswa", "params": {}})
    assert len(cleaned) <= titler.MAX_TITLE_LEN
    assert "24251001" not in cleaned
    assert '"' not in cleaned and "!" not in cleaned
    assert titler._EMOJI_RE.search(cleaned) is None


# ------------------------------------------------------------------ 10. SIS v3: Auto-Title Upgrade & Chat Undo API
def _build_v3_api_client(monkeypatch):
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    with eng.begin() as c:
        c.connection.driver_connection.executescript((ROOT / "database/init/01_schema.sql").read_text(encoding="utf-8"))
        for t in ORDER:
            rows = list(csv.reader((ROOT / f"database/dataset_bersih/{t}.csv").open(encoding="utf-8")))
            h = rows[0]
            c.execute(
                text(f"INSERT INTO {t} ({','.join(h)}) VALUES ({','.join(':' + col for col in h)})"),
                [dict(zip(h, row)) for row in rows[1:]],
            )
        c.execute(text(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, nama TEXT, nip TEXT, "
            "role TEXT, password_hash TEXT, wajib_ganti_password INT DEFAULT 0, aktif INT DEFAULT 1, dibuat_pada TEXT)"
        ))
        c.execute(text(
            "CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INT, aksi TEXT, pertanyaan TEXT, "
            "intent_json TEXT, tabel_diakses TEXT, status TEXT, waktu TEXT DEFAULT CURRENT_TIMESTAMP)"
        ))
        c.execute(text(
            "CREATE TABLE chat_sessions (id TEXT PRIMARY KEY, user_id INT NOT NULL, judul TEXT NOT NULL, "
            "pinned INT NOT NULL DEFAULT 0, dibuat_pada TEXT DEFAULT CURRENT_TIMESTAMP, diperbarui_pada TEXT DEFAULT CURRENT_TIMESTAMP)"
        ))
        c.execute(text(
            "CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, "
            "role TEXT NOT NULL, konten TEXT NOT NULL, metadata_json TEXT, dibuat_pada TEXT DEFAULT CURRENT_TIMESTAMP)"
        ))
        c.execute(text(
            "CREATE TABLE knowledge_document (id INTEGER PRIMARY KEY AUTOINCREMENT, nama_file TEXT NOT NULL, "
            "tipe_file TEXT NOT NULL, ukuran_bytes INT NOT NULL, ringkasan TEXT NOT NULL DEFAULT '', "
            "konten_teks TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'aktif', "
            "diunggah_oleh INT, dibuat_pada TEXT DEFAULT CURRENT_TIMESTAMP, dihapus_pada TEXT)"
        ))
        c.execute(text(
            "CREATE TABLE knowledge_node (id INTEGER PRIMARY KEY AUTOINCREMENT, kunci TEXT NOT NULL UNIQUE, "
            "label TEXT NOT NULL, tipe TEXT NOT NULL, sumber TEXT NOT NULL DEFAULT 'dokumen', "
            "document_id INT, metadata_json TEXT, status TEXT NOT NULL DEFAULT 'aktif', "
            "dibuat_pada TEXT DEFAULT CURRENT_TIMESTAMP)"
        ))
        c.execute(text(
            "CREATE TABLE knowledge_edge (id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INT NOT NULL, "
            "target_id INT NOT NULL, relasi TEXT NOT NULL, document_id INT, status TEXT NOT NULL DEFAULT 'aktif', "
            "catatan TEXT NOT NULL DEFAULT '', UNIQUE (source_id, target_id, relasi))"
        ))
        c.execute(text(
            "CREATE TABLE delete_request (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INT NOT NULL, "
            "diajukan_oleh INT NOT NULL, alasan TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'menunggu', "
            "diproses_oleh INT, catatan_admin TEXT, dibuat_pada TEXT DEFAULT CURRENT_TIMESTAMP, diproses_pada TEXT)"
        ))
        c.execute(text(
            "INSERT INTO users (id, username, nama, role, password_hash, wajib_ganti_password) VALUES "
            "(1, 'admin1', 'Admin Satu', 'admin', 'x', 0), "
            "(2, 'guru2', 'Guru Dua', 'teacher', 'x', 0)"
        ))

    monkeypatch.setattr(chat_routes, "db_engine", eng)
    monkeypatch.setattr(
        queries,
        "AUDIT_CHAT",
        "INSERT INTO audit_log (user_id, aksi, pertanyaan, intent_json, tabel_diakses, status) "
        "VALUES (:user_id, :aksi, :pertanyaan, :intent, :tabel, :status)",
    )
    monkeypatch.setattr(queries, "SISWA_FIND", queries.SISWA_FIND.replace(" ILIKE ", " LIKE "))
    monkeypatch.setattr(queries, "GURU_SEARCH", queries.GURU_SEARCH.replace(" ILIKE ", " LIKE "))
    monkeypatch.setattr(gemini, "enabled", lambda: False)
    chat_routes._hits.clear()
    monkeypatch.setattr(settings, "chat_rate_per_minute", 100)

    current_user = {"id": 1, "username": "admin1", "role": "admin"}

    def _conn_override():
        with eng.begin() as conn:
            yield conn

    app = FastAPI()
    app.include_router(chat_routes.router, prefix="/api/v1")
    app.include_router(knowledge_routes.router, prefix="/api/v1")
    app.dependency_overrides[auth.active_user] = lambda: current_user
    app.dependency_overrides[app_db.get_conn] = _conn_override
    return eng, TestClient(app), current_user


def test_chat_api_autotitle_upgrade_dan_undo(monkeypatch):
    _, client, current_user = _build_v3_api_client(monkeypatch)

    # Turn 1: "hai" -> judul "Percakapan Baru", mengembalikan user_message_id & ai_message_id
    r1 = client.post("/api/v1/chat", json={"pesan": "hai"})
    assert r1.status_code == 200
    b1 = r1.json()
    sid = b1["sesi_id"]
    assert sid
    assert b1["judul_sesi"] == "Percakapan Baru"
    assert isinstance(b1["user_message_id"], int) and b1["user_message_id"] >= 1
    assert isinstance(b1["ai_message_id"], int) and b1["ai_message_id"] > b1["user_message_id"]

    # Turn 2: pesan bermakna -> otomatis upgrade judul_sesi
    q2 = "berikan saya data ekskul siswa kelas xii rpl 1"
    r2 = client.post("/api/v1/chat", json={"pesan": q2, "sesi_id": sid})
    assert r2.status_code == 200
    b2 = r2.json()
    assert b2["judul_sesi"] == "Ekskul Siswa XII RPL 1"
    assert isinstance(b2["user_message_id"], int) and b2["user_message_id"] > b1["ai_message_id"]
    assert isinstance(b2["ai_message_id"], int) and b2["ai_message_id"] > b2["user_message_id"]

    # Pastikan judul baru tersimpan di DB & tidak tertimpa pada Turn 3
    q3 = "anggotanya siapa saja"
    r3 = client.post("/api/v1/chat", json={"pesan": q3, "sesi_id": sid})
    assert r3.status_code == 200
    b3 = r3.json()
    assert b3["judul_sesi"] == "Ekskul Siswa XII RPL 1"
    assert b3["intent"]["intent"] == "info_ekskul"
    assert b3["tabel"] is not None and all(row[1] == "XII RPL 1" for row in b3["tabel"]["baris"])

    detail_before = client.get(f"/api/v1/chat/sesi/{sid}").json()
    assert detail_before["sesi"]["judul"] == "Ekskul Siswa XII RPL 1"
    assert len(detail_before["messages"]) == 6

    # Undo dengan AI message ID -> wajib 404
    r_ai_undo = client.post(f"/api/v1/chat/sesi/{sid}/undo", json={"message_id": b2["ai_message_id"]})
    assert r_ai_undo.status_code == 404

    # Undo oleh pengguna lain pada sesi user 1 -> wajib 404 dan pesan tetap utuh
    current_user.update({"id": 2, "username": "guru2", "role": "teacher"})
    r_other = client.post(f"/api/v1/chat/sesi/{sid}/undo", json={"message_id": b2["user_message_id"]})
    assert r_other.status_code == 404
    current_user.update({"id": 1, "username": "admin1", "role": "admin"})

    # Undo dari user_message_id Turn 2 -> menghapus Turn 2 & Turn 3 (4 pesan), menyisakan Turn 1 (2 pesan)
    r_undo = client.post(f"/api/v1/chat/sesi/{sid}/undo", json={"message_id": b2["user_message_id"]})
    assert r_undo.status_code == 200
    u = r_undo.json()
    assert u == {"deleted": 4, "restored_text": q2, "remaining": 2}

    detail_after = client.get(f"/api/v1/chat/sesi/{sid}").json()
    assert len(detail_after["messages"]) == 2
    assert [m["id"] for m in detail_after["messages"]] == [b1["user_message_id"], b1["ai_message_id"]]


# ------------------------------------------------------------------ 11. SIS v3: Knowledge Graph Multi-Type & Relation Filtering
def test_knowledge_graf_multi_tipe_dan_relasi(monkeypatch):
    _, client, _ = _build_v3_api_client(monkeypatch)

    # Filter multi-tipe: jurusan,perusahaan
    res = client.get("/api/v1/knowledge/graf", params={"tipe": "jurusan,perusahaan"})
    assert res.status_code == 200
    body = res.json()

    nodes = body["nodes"]
    edges = body["edges"]
    stats = body["stats"]

    assert len(nodes) > 0
    returned_types = {n["tipe"] for n in nodes}
    assert returned_types == {"jurusan", "perusahaan"}

    node_ids = {n["id"] for n in nodes}
    assert len(edges) > 0
    assert all(e["source"] in node_ids and e["target"] in node_ids for e in edges)
    assert all(e["relasi"] == "mitra_pkl" for e in edges)

    # stats.type_counts harus memuat jumlah penuh tak terfilter untuk semua tipe
    tc = stats["type_counts"]
    assert tc["jurusan"] == 5
    assert tc["perusahaan"] > 0
    assert tc["kelas"] == 17
    assert tc["sekolah"] == 1
    assert tc["guru"] > 0
    assert tc["ekskul"] == 19
    assert sum(tc.values()) == stats["total_nodes"]

    # Filter multi-relasi: memiliki_jurusan,mitra_pkl
    res_rel = client.get("/api/v1/knowledge/graf", params={"relasi": "memiliki_jurusan,mitra_pkl"})
    assert res_rel.status_code == 200
    body_rel = res_rel.json()
    assert len(body_rel["edges"]) > 0
    rel_set = {e["relasi"] for e in body_rel["edges"]}
    assert rel_set == {"memiliki_jurusan", "mitra_pkl"}

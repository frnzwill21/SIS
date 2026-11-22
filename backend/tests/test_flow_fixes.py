"""Uji regresi untuk perbaikan alur keamanan, auth, dan Hybrid Query Engine."""
import base64
import io
import json
import urllib.error
import urllib.request
import zipfile
import zlib
from contextlib import contextmanager

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

from app import auth, main, queries
from app.api import admin_routes, auth_routes, chat_routes, data_routes, knowledge_routes
from app.config import settings
from app.db import get_conn
from app.engine import gemini, graph, handlers, intents, rag
from app.engine.parsing import mentions_unknown_kelas, normalize_kelas, parse_ambang
import app.engine as engine_pkg


def _setup_auth_db(monkeypatch):
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    with eng.begin() as c:
        c.execute(text(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, nama TEXT, nip TEXT, "
            "role TEXT, password_hash TEXT, wajib_ganti_password INT DEFAULT 0, aktif INT DEFAULT 1, dibuat_pada TEXT)"
        ))
        c.execute(text(
            "CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_id INT, aksi TEXT, pertanyaan TEXT, "
            "intent_json TEXT, tabel_diakses TEXT, status TEXT, waktu TEXT DEFAULT CURRENT_TIMESTAMP)"
        ))
        pw_hash = auth.hash_password("SandiLama-2026!")
        c.execute(
            text("INSERT INTO users (id, username, nama, role, password_hash, wajib_ganti_password, aktif) "
                 "VALUES (1,'admin1','Admin Satu','admin',:h,0,1),(2,'guru1','Guru Satu','teacher',:h,0,1)"),
            {"h": pw_hash},
        )
    monkeypatch.setattr(auth, "engine", eng)
    monkeypatch.setattr(auth_routes, "db_engine", eng)
    auth.clear_revocations()
    auth_routes._login_hits.clear()

    app = FastAPI()
    app.include_router(auth_routes.router)
    app.include_router(admin_routes.router)

    def conn_override():
        with eng.begin() as conn:
            yield conn

    app.dependency_overrides[get_conn] = conn_override
    return eng, TestClient(app, raise_server_exceptions=False)


def test_login_audit_rate_limit_dan_logout_revoke(monkeypatch):
    eng, client = _setup_auth_db(monkeypatch)
    monkeypatch.setattr(settings, "login_rate_per_minute", 3)

    # Login gagal dicatat di audit_log
    r_bad = client.post("/auth/login", json={"username": "guru1", "password": "salah"})
    assert r_bad.status_code == 401

    # Login sukses mendapat token
    r_ok = client.post("/auth/login", json={"username": "guru1", "password": "SandiLama-2026!"})
    assert r_ok.status_code == 200
    tok = r_ok.json()["access_token"]
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {tok}"}).status_code == 200

    # Logout mencabut token sehingga tidak bisa dipakai lagi
    assert client.post("/auth/logout", headers={"Authorization": f"Bearer {tok}"}).status_code == 200
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {tok}"}).status_code == 401

    # Rate limit login (percobaan ke-4 pada menit yang sama -> 429)
    assert client.post("/auth/login", json={"username": "guru1", "password": "salah"}).status_code == 401
    assert client.post("/auth/login", json={"username": "guru1", "password": "salah"}).status_code == 429

    with eng.connect() as c:
        aksi = [r[0] for r in c.execute(text("SELECT aksi FROM audit_log ORDER BY id")).all()]
    assert "login_gagal" in aksi and "login_ok" in aksi


def test_ganti_password_kebijakan_dan_cabut_sesi_lain(monkeypatch):
    _, client = _setup_auth_db(monkeypatch)
    t1 = client.post("/auth/login", json={"username": "guru1", "password": "SandiLama-2026!"}).json()["access_token"]
    t2 = client.post("/auth/login", json={"username": "guru1", "password": "SandiLama-2026!"}).json()["access_token"]

    # Kosong & terlalu lemah ("1") ditolak
    for bad_pw in ("", "1", "password123!"):
        r_bad = client.post(
            "/auth/ganti-password",
            json={"password_lama": "SandiLama-2026!", "password_baru": bad_pw},
            headers={"Authorization": f"Bearer {t1}"},
        )
        assert r_bad.status_code == 422

    # Kata sandi kuat diterima; t1 tetap aktif, t2 dicabut
    r_ok = client.post(
        "/auth/ganti-password",
        json={"password_lama": "SandiLama-2026!", "password_baru": "SandiBaru-2026!"},
        headers={"Authorization": f"Bearer {t1}"},
    )
    assert r_ok.status_code == 200
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {t1}"}).status_code == 200
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {t2}"}).status_code == 401


def test_gemini_404_membuka_circuit_breaker(monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "KUNCI-TES")
    gemini.breaker.ok()
    gemini.breaker._open_until = 0.0
    hits = []

    def boom_404(req, timeout=None):
        hits.append(req)
        raise urllib.error.HTTPError(req.full_url, 404, "Not Found", {}, None)

    monkeypatch.setattr(urllib.request, "urlopen", boom_404)
    for _ in range(gemini.FAILURE_THRESHOLD):
        assert gemini.generate("sys", "hi") is None
    before = len(hits)
    assert gemini.generate("sys", "hi") is None and len(hits) == before
    gemini.breaker._open_until = 0.0


def test_intent_alpha_per_siswa_dan_sapaan(monkeypatch):
    monkeypatch.setattr(gemini, "enabled", lambda: False)
    assert intents.rule_intent("Berapa alpha Aditya Ramadhan?")["intent"] == "rekap_kehadiran"
    assert intents.rule_intent("Siapa saja yang alpha lebih dari 5 hari?")["intent"] == "siswa_alpha_tinggi"
    assert intents.rule_intent("halo")["intent"] == "sapaan"
    assert intents.rule_intent("terima kasih")["intent"] == "sapaan"


def test_semester_relatif_mengikuti_periode_berjalan_db(monkeypatch):
    monkeypatch.setattr(gemini, "enabled", lambda: False)

    class Sem6Db:
        def rows(self, sql, **p):
            if "FROM periode_akademik" in sql:
                return [{"semester": 6}]
            return []

    @contextmanager
    def open_db():
        yield Sem6Db()

    out = engine_pkg.answer(open_db, "Siswa XII RPL 1 di bawah KKM semester ini")
    assert out["intent"]["params"]["semester"] == 6
    out_prev = engine_pkg.answer(open_db, "Siswa XII RPL 1 di bawah KKM semester lalu")
    assert out_prev["intent"]["params"]["semester"] == 5


def test_query_siswa_mendukung_nisn():
    assert "s.nisn" in queries.SISWA_SEARCH_WHERE
    assert "s.nisn" in queries.SISWA_FIND


# ---------------------------------------------------------------- regresi audit backend #1-#11
def _setup_full_db(monkeypatch):
    """DB uji SQLite dengan skema users lengkap (termasuk token_version & token_exempt_jti) + guru."""
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    with eng.begin() as c:
        c.execute(text(
            "CREATE TABLE guru (nip TEXT PRIMARY KEY, nama TEXT)"
        ))
        c.execute(text(
            "INSERT INTO guru (nip, nama) VALUES ('19800101', 'Budi Santoso'), ('19800102', 'Ani 100% Wijaya')"
        ))
        c.execute(text(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, nama TEXT, nip TEXT, "
            "role TEXT, password_hash TEXT, wajib_ganti_password INT DEFAULT 0, aktif INT DEFAULT 1, "
            "token_version INT NOT NULL DEFAULT 1, token_exempt_jti TEXT, dibuat_pada TEXT)"
        ))
        c.execute(text(
            "CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_id INT, aksi TEXT, pertanyaan TEXT, "
            "intent_json TEXT, tabel_diakses TEXT, status TEXT, waktu TEXT DEFAULT CURRENT_TIMESTAMP)"
        ))
        pw_hash = auth.hash_password("SandiLama-2026!")
        c.execute(
            text(
                "INSERT INTO users (id, username, nama, role, password_hash, wajib_ganti_password, aktif, token_version) "
                "VALUES (1,'admin1','Admin Satu','admin',:h,0,1,1),(2,'guru1','Guru Satu','teacher',:h,0,1,1)"
            ),
            {"h": pw_hash},
        )
    monkeypatch.setattr(auth, "engine", eng)
    monkeypatch.setattr(auth_routes, "db_engine", eng)
    monkeypatch.setattr(chat_routes, "db_engine", eng)
    monkeypatch.setattr(
        queries,
        "AUDIT_CHAT",
        "INSERT INTO audit_log (user_id, aksi, pertanyaan, intent_json, tabel_diakses, status) "
        "VALUES (:user_id, :aksi, :pertanyaan, :intent, :tabel, :status)",
    )
    auth.clear_revocations()
    auth_routes._login_hits.clear()
    chat_routes._hits.clear()

    app = FastAPI()
    app.include_router(auth_routes.router)
    app.include_router(admin_routes.router)
    app.include_router(chat_routes.router)
    app.include_router(data_routes.router)

    def conn_override():
        with eng.begin() as conn:
            yield conn

    app.dependency_overrides[get_conn] = conn_override
    return eng, TestClient(app, raise_server_exceptions=False)


def test_admin_tidak_bisa_reset_password_sendiri(monkeypatch):
    _, client = _setup_full_db(monkeypatch)
    tok = client.post("/auth/login", json={"username": "admin1", "password": "SandiLama-2026!"}).json()["access_token"]
    r = client.patch("/users/1", json={"reset_password": True}, headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 409
    assert "/akun" in r.json()["detail"]["message"]
    # Sesi admin tetap valid
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {tok}"}).status_code == 200


def test_pencabutan_token_persisten_lintas_reload(monkeypatch):
    _, client = _setup_full_db(monkeypatch)

    # 1) Logout tetap berlaku walau memori pencabutan dikosongkan (simulasi uvicorn --reload)
    tok_logout = client.post("/auth/login", json={"username": "guru1", "password": "SandiLama-2026!"}).json()["access_token"]
    assert client.post("/auth/logout", headers={"Authorization": f"Bearer {tok_logout}"}).status_code == 200
    auth.clear_revocations()
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {tok_logout}"}).status_code == 401

    # 2) Ganti sandi mempertahankan sesi aktif (t1) & mencabut sesi lain (t2) lintas reload
    t1 = client.post("/auth/login", json={"username": "guru1", "password": "SandiLama-2026!"}).json()["access_token"]
    t2 = client.post("/auth/login", json={"username": "guru1", "password": "SandiLama-2026!"}).json()["access_token"]
    r_gp = client.post(
        "/auth/ganti-password",
        json={"password_lama": "SandiLama-2026!", "password_baru": "SandiBaru-2026!"},
        headers={"Authorization": f"Bearer {t1}"},
    )
    assert r_gp.status_code == 200
    auth.clear_revocations()
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {t1}"}).status_code == 200
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {t2}"}).status_code == 401

    # 3) Reset sandi oleh admin mencabut t1 lintas reload
    tok_admin = client.post("/auth/login", json={"username": "admin1", "password": "SandiLama-2026!"}).json()["access_token"]
    r_reset = client.patch("/users/2", json={"reset_password": True}, headers={"Authorization": f"Bearer {tok_admin}"})
    assert r_reset.status_code == 200
    auth.clear_revocations()
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {t1}"}).status_code == 401

    # 4) Nonaktifkan lalu aktifkan ulang oleh admin tidak menghidupkan kembali token lama
    pw_baru = r_reset.json()["password_baru"]
    t3 = client.post("/auth/login", json={"username": "guru1", "password": pw_baru}).json()["access_token"]
    assert client.patch("/users/2", json={"aktif": False}, headers={"Authorization": f"Bearer {tok_admin}"}).status_code == 200
    assert client.patch("/users/2", json={"aktif": True}, headers={"Authorization": f"Bearer {tok_admin}"}).status_code == 200
    auth.clear_revocations()
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {t3}"}).status_code == 401


def test_login_rate_limit_per_ip_rotasi_username_dan_eviksi_bucket(monkeypatch):
    _, client = _setup_full_db(monkeypatch)
    monkeypatch.setattr(settings, "login_rate_per_minute", 2)  # per-IP = 6

    statuses = [
        client.post("/auth/login", json={"username": f"acak{i}", "password": "x"}).status_code
        for i in range(7)
    ]
    assert statuses[:6] == [401] * 6
    assert statuses[6] == 429

    # Simulasi bucket kedaluwarsa -> terhapus saat prune
    auth_routes._login_hits["u:1.2.3.4:lama"] = auth_routes.deque([0.0])
    assert auth_routes._prune_bucket("u:1.2.3.4:lama", 120.0) is None
    assert "u:1.2.3.4:lama" not in auth_routes._login_hits


def test_engine_parse_ambang_hari_dan_tidak_timpa_gemini(monkeypatch):
    assert parse_ambang("Siapa yang alpha 3 hari?") == 3
    assert parse_ambang("alpha lebih dari 5 hari") == 6
    assert parse_ambang("alpha minimal 4 hari") == 4

    monkeypatch.setattr(gemini, "enabled", lambda: True)
    monkeypatch.setattr(
        gemini,
        "generate",
        lambda *a, **k: '{"intent": "siswa_alpha_tinggi", "params": {"ambang": 3}}',
    )
    intent1, _ = intents.understand("Siapa yang alpha 3 hari?")
    assert intent1["params"]["ambang"] == 3
    intent2, _ = intents.understand("siswa alpha 3")
    assert intent2["params"]["ambang"] == 3


def test_engine_kelas_dua_digit_tidak_dikenal_dan_semua_handler():
    assert normalize_kelas("XII TITL 10") is None
    assert mentions_unknown_kelas("Siswa XII TITL 10 di bawah KKM") is True

    class BoomDb:
        def rows(self, *a, **k):
            raise AssertionError("query tidak boleh dijalankan untuk kelas tidak dikenal")

    for fn in (
        handlers.cari_siswa,
        handlers.rekap_kehadiran,
        handlers.pelanggaran_siswa,
        handlers.penempatan_pkl,
        handlers.jadwal_guru,
        handlers.siswa_di_bawah_kkm,
        handlers.siswa_alpha_tinggi,
    ):
        res = fn(BoomDb(), {}, "data XII TITL 10")
        assert res.butuh_klarifikasi and "tidak ada di data" in res.jawaban


def test_gemini_multi_key_failover_dibatasi_max_attempts(monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", ",".join(f"KEY-{i}" for i in range(10)))
    gemini.breaker.ok()
    gemini.breaker._open_until = 0.0
    hits = []

    def boom_429(req, timeout=None):
        hits.append(req.get_header("X-goog-api-key"))
        raise urllib.error.HTTPError(req.full_url, 429, "Too Many Requests", {}, None)

    monkeypatch.setattr(urllib.request, "urlopen", boom_429)
    assert gemini.generate("sys", "hi") is None
    assert len(hits) == gemini.MAX_ATTEMPTS
    gemini.breaker.ok()
    gemini.breaker._open_until = 0.0


def test_audit_log_filter_tanggal_menggunakan_batas_wib(monkeypatch):
    eng, client = _setup_full_db(monkeypatch)
    tok = client.post("/auth/login", json={"username": "admin1", "password": "SandiLama-2026!"}).json()["access_token"]
    with eng.begin() as c:
        c.execute(text("DELETE FROM audit_log"))
        # 2026-11-20 16:59:59 UTC == 2026-11-20 23:59:59 WIB (hari sebelumnya)
        c.execute(text(
            "INSERT INTO audit_log (user_id, aksi, pertanyaan, tabel_diakses, status, waktu) "
            "VALUES (1, 'sebelum_tengah_malam', 'q1', 'users', 'ok', '2026-11-20 16:59:59')"
        ))
        # 2026-11-20 19:30:00 UTC == 2026-11-21 02:30:00 WIB (hari 2026-11-21 WIB!)
        c.execute(text(
            "INSERT INTO audit_log (user_id, aksi, pertanyaan, tabel_diakses, status, waktu) "
            "VALUES (1, 'dini_hari_wib', 'q2', 'users', 'ok', '2026-11-20 19:30:00')"
        ))

    r = client.get(
        "/admin/audit?dari=2026-11-21&sampai=2026-11-21",
        headers={"Authorization": f"Bearer {tok}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["meta"]["total"] == 1
    assert [row["aksi"] for row in body["data"]] == ["dini_hari_wib"]


def test_validasi_input_whitespace_case_insensitive_guru_like_hari_dan_ganti_pw(monkeypatch):
    eng, client = _setup_full_db(monkeypatch)
    tok_admin = client.post("/auth/login", json={"username": "admin1", "password": "SandiLama-2026!"}).json()["access_token"]
    hdr = {"Authorization": f"Bearer {tok_admin}"}

    # Whitespace-only ditolak 422
    assert client.post("/chat", json={"pesan": "   "}, headers=hdr).status_code == 422
    assert client.post("/users", json={"username": "baru1", "nama": "   ", "role": "teacher"}, headers=hdr).status_code == 422

    # Username case-insensitive ditolak 409; nip whitespace dinormalisasi ke None
    assert client.post("/users", json={"username": "Admin1", "nama": "Duplikat", "role": "teacher"}, headers=hdr).status_code == 409
    r_ok = client.post(
        "/users",
        json={"username": "  guru_baru ", "nama": "  Guru Baru  ", "role": "teacher", "nip": "   "},
        headers=hdr,
    )
    assert r_ok.status_code == 201 and r_ok.json()["username"] == "guru_baru"

    # GET /guru meng-escape wildcard '%'
    monkeypatch.setattr(queries, "GURU_SEARCH", queries.GURU_SEARCH.replace(" ILIKE ", " LIKE "))
    r_pct = client.get("/guru?q=%25", headers=hdr)
    assert r_pct.status_code == 200
    assert [g["nama"] for g in r_pct.json()["data"]] == ["Ani 100% Wijaya"]

    # Gemini hari dinormalisasi via parse_hari() (kapital + menolak 'sabtu')
    monkeypatch.setattr(gemini, "enabled", lambda: True)
    monkeypatch.setattr(
        gemini,
        "generate",
        lambda *a, **k: '{"intent": "jadwal_kelas", "params": {"kelas": "XII RPL 1", "hari": "sabtu"}}',
    )
    intent_sabtu, _ = intents.understand("jadwal XII RPL 1 sabtu")
    assert "hari" not in intent_sabtu["params"]

    monkeypatch.setattr(
        gemini,
        "generate",
        lambda *a, **k: '{"intent": "jadwal_kelas", "params": {"kelas": "XII RPL 1", "hari": "senin"}}',
    )
    # Paksa rule_intent tanpa hari agar jalur normalisasi Gemini di intents.py:187-190 ikut teruji langsung
    monkeypatch.setattr(intents, "rule_intent", lambda p: {"intent": "jadwal_kelas", "params": {"kelas": "XII-RPL-1"}})
    intent_senin, _ = intents.understand("jadwal XII RPL 1 senin")
    assert intent_senin["params"]["hari"] == "Senin"

    # ganti_password aman (401, bukan 500) bila baris user hilang/dihapus bersamaan
    import pytest
    from fastapi import HTTPException

    with eng.begin() as c:
        with pytest.raises(HTTPException) as exc_info:
            auth_routes.ganti_password(
                auth_routes.GantiPasswordIn(password_lama="x", password_baru="SandiBaru-2026!"),
                user={"id": 999, "username": "hilang"},
                conn=c,
            )
    assert exc_info.value.status_code == 401

    # ADMIN_AKTIF_LOCK tersedia dengan FOR UPDATE untuk PostgreSQL
    assert "FOR UPDATE" in queries.ADMIN_AKTIF_LOCK


def test_empat_peran_rbac_ubah_role_dan_pembatasan_pelanggaran(monkeypatch):
    eng, client = _setup_full_db(monkeypatch)
    with eng.begin() as c:
        c.execute(text("CREATE TABLE jurusan (kode TEXT PRIMARY KEY, nama_konsentrasi TEXT)"))
        c.execute(text("CREATE TABLE kelas (kode TEXT PRIMARY KEY, nama TEXT, jurusan_kode TEXT, wali_kelas_nip TEXT)"))
        c.execute(text(
            "CREATE TABLE siswa (nis TEXT PRIMARY KEY, nisn TEXT, nama TEXT, jenis_kelamin TEXT, no_absen INT, kelas_kode TEXT)"
        ))
        c.execute(text("CREATE TABLE jenis_pelanggaran (kode TEXT PRIMARY KEY, nama TEXT, tingkat TEXT, poin INT, sanksi_disarankan TEXT)"))
        c.execute(text(
            "CREATE TABLE pelanggaran (id INT PRIMARY KEY, nis TEXT, kode_pelanggaran TEXT, tanggal_kejadian TEXT, catatan TEXT)"
        ))
        c.execute(text("INSERT INTO jurusan VALUES ('RPL', 'Rekayasa Perangkat Lunak')"))
        c.execute(text("INSERT INTO kelas VALUES ('XII-RPL-1', 'XII RPL 1', 'RPL', '19800101')"))
        c.execute(text("INSERT INTO siswa VALUES ('24251001', '0081000001', 'Ahmad Fauzi', 'L', 1, 'XII-RPL-1')"))
        c.execute(text("INSERT INTO jenis_pelanggaran VALUES ('P-S01', 'Membolos', 'Sedang', 15, 'Pembinaan')"))
        c.execute(text("INSERT INTO pelanggaran VALUES (1, '24251001', 'P-S01', '2026-10-01', 'Teguran')"))

    tok_admin = client.post("/auth/login", json={"username": "admin1", "password": "SandiLama-2026!"}).json()["access_token"]
    hdr_admin = {"Authorization": f"Bearer {tok_admin}"}

    # 1) Buat akun bk & kepala_sekolah lewat POST /users
    r_bk = client.post("/users", json={"username": "bk01", "nama": "Guru BK", "role": "bk"}, headers=hdr_admin)
    r_ks = client.post("/users", json={"username": "kepsek01", "nama": "Kepala Sekolah", "role": "kepala_sekolah"}, headers=hdr_admin)
    assert r_bk.status_code == 201 and r_bk.json()["role"] == "bk"
    assert r_ks.status_code == 201 and r_ks.json()["role"] == "kepala_sekolah"

    # Hilangkan wajib_ganti_password agar bisa langsung akses endpoint data
    with eng.begin() as c:
        c.execute(text("UPDATE users SET wajib_ganti_password = 0 WHERE username IN ('bk01', 'kepsek01')"))

    tok_teacher = client.post("/auth/login", json={"username": "guru1", "password": "SandiLama-2026!"}).json()["access_token"]
    tok_bk = client.post("/auth/login", json={"username": "bk01", "password": r_bk.json()["password_awal"]}).json()["access_token"]
    tok_ks = client.post("/auth/login", json={"username": "kepsek01", "password": r_ks.json()["password_awal"]}).json()["access_token"]

    # 2) Pembatasan GET /siswa/{nis}/pelanggaran
    assert client.get("/siswa/24251001/pelanggaran", headers={"Authorization": f"Bearer {tok_teacher}"}).status_code == 403
    assert client.get("/siswa/24251001/pelanggaran", headers={"Authorization": f"Bearer {tok_bk}"}).status_code == 200
    assert client.get("/siswa/24251001/pelanggaran", headers={"Authorization": f"Bearer {tok_ks}"}).status_code == 200
    assert client.get("/siswa/24251001/pelanggaran", headers=hdr_admin).status_code == 200

    # 3) Chat pelanggaran ditolak untuk teacher tanpa menyentuh DB & dicatat status='ditolak'
    monkeypatch.setattr(gemini, "enabled", lambda: False)
    r_chat_t = client.post("/chat", json={"pesan": "pelanggaran XII RPL 1"}, headers={"Authorization": f"Bearer {tok_teacher}"})
    assert r_chat_t.status_code == 200
    body_t = r_chat_t.json()
    assert body_t["sensitif"] is True and body_t["tabel"] is None and body_t["sumber"] == []
    assert "BK, Kepala Sekolah, dan Admin" in body_t["jawaban"]

    with eng.connect() as c:
        row_audit = c.execute(
            text("SELECT aksi, status FROM audit_log WHERE pertanyaan = 'pelanggaran XII RPL 1' ORDER BY id DESC LIMIT 1")
        ).one()
    assert row_audit == ("chat_data_sensitif", "ditolak")

    # 4) Admin tidak bisa menurunkan perannya sendiri, tapi bisa ubah peran user lain & token lama dicabut
    assert client.patch("/users/1", json={"role": "teacher"}, headers=hdr_admin).status_code == 409
    r_promote = client.patch("/users/2", json={"role": "bk"}, headers=hdr_admin)
    assert r_promote.status_code == 200 and r_promote.json()["role"] == "bk"
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {tok_teacher}"}).status_code == 401


def test_pkl_penempatan_paginasi_search_filter_dan_perusahaan_kuota(monkeypatch):
    eng, client = _setup_full_db(monkeypatch)
    with eng.begin() as c:
        c.execute(text("CREATE TABLE kelas (kode TEXT PRIMARY KEY, nama TEXT)"))
        c.execute(text("CREATE TABLE siswa (nis TEXT PRIMARY KEY, nama TEXT, no_absen INT, kelas_kode TEXT)"))
        c.execute(text(
            "CREATE TABLE perusahaan_pkl (kode TEXT PRIMARY KEY, nama TEXT, jurusan_kode TEXT, kota TEXT, "
            "bidang_usaha TEXT, kuota_sesi1 INT, kuota_sesi2 INT, posisi_tersedia TEXT, narahubung TEXT)"
        ))
        c.execute(text(
            "CREATE TABLE penempatan_pkl (nis TEXT PRIMARY KEY, kode_perusahaan TEXT, posisi TEXT, sesi INT, status TEXT)"
        ))
        c.execute(text("INSERT INTO kelas VALUES ('XII-RPL-1', 'XII RPL 1'), ('XII-DKV-1', 'XII DKV 1')"))
        c.execute(text(
            "INSERT INTO siswa VALUES "
            "('24251001', 'Ahmad Fauzi', 1, 'XII-RPL-1'),"
            "('24251002', 'Aisyah Putri', 2, 'XII-RPL-1'),"
            "('24251109', 'Aditya Pratama', 1, 'XII-DKV-1')"
        ))
        c.execute(text(
            "INSERT INTO perusahaan_pkl VALUES "
            "('P01', 'PT Telkom 100% Digital', 'RPL', 'Bandung', 'Telekomunikasi', 5, 5, 'Web Developer', 'Budi'),"
            "('P02', 'PT Pindad Humas', 'DKV', 'Bandung', 'Desain', 4, 4, 'Graphic Designer', 'Siti')"
        ))
        c.execute(text(
            "INSERT INTO penempatan_pkl VALUES "
            "('24251001', 'P01', 'Web Developer', 1, 'Selesai'),"
            "('24251002', 'P01', 'QA Engineer', 2, 'Sedang berlangsung'),"
            "('24251109', 'P02', 'Graphic Designer', 1, 'Selesai')"
        ))

    # Adaptasi SQLite (ILIKE -> LIKE)
    for attr in ("PKL_PENEMPATAN_SUMMARY", "PKL_PENEMPATAN_LIST", "PERUSAHAAN_SEARCH"):
        monkeypatch.setattr(queries, attr, getattr(queries, attr).replace(" ILIKE ", " LIKE "))

    tok = client.post("/auth/login", json={"username": "guru1", "password": "SandiLama-2026!"}).json()["access_token"]
    hdr = {"Authorization": f"Bearer {tok}"}

    # 1) Paginasi + summary
    r1 = client.get("/pkl/penempatan?page=1&page_size=2", headers=hdr)
    assert r1.status_code == 200
    j1 = r1.json()
    assert len(j1["data"]) == 2
    assert j1["meta"] == {"page": 1, "page_size": 2, "total": 3}
    assert j1["summary"] == {"total": 3, "sesi1": 2, "sesi2": 1, "selesai": 2, "berlangsung": 1}

    # 2) Pencarian q + escape wildcard '%'
    r_pct = client.get("/pkl/penempatan?q=%25", headers=hdr)
    assert r_pct.status_code == 200
    assert r_pct.json()["meta"]["total"] == 2
    assert all("100%" in row["perusahaan"] for row in r_pct.json()["data"])

    # 3) Filter status + sesi + kelas
    r_filt = client.get("/pkl/penempatan?kelas=XII-RPL-1&sesi=2&status=Sedang%20berlangsung", headers=hdr)
    assert r_filt.status_code == 200
    assert [r["nis"] for r in r_filt.json()["data"]] == ["24251002"]

    # 4) Perusahaan search + filter jurusan + terisi_sesi1/2
    r_per = client.get("/pkl/perusahaan?jurusan=RPL", headers=hdr)
    assert r_per.status_code == 200
    per_rows = r_per.json()["data"]
    assert len(per_rows) == 1
    assert per_rows[0]["kode"] == "P01"
    assert per_rows[0]["terisi_sesi1"] == 1 and per_rows[0]["terisi_sesi2"] == 1


# ---------------------------------------------------------------- fitur baru: CoT, Chat Sesi, Ringkasan Master, Akun, Knowledge Graph
def _setup_extended_db(monkeypatch):
    """DB uji SQLite lengkap mencakup chat_sessions, knowledge_*, delete_request, dan tabel sekolah."""
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    with eng.begin() as c:
        c.execute(text("CREATE TABLE jurusan (kode TEXT PRIMARY KEY, nama_konsentrasi TEXT, program_keahlian TEXT)"))
        c.execute(text("CREATE TABLE guru (nip TEXT PRIMARY KEY, nama TEXT)"))
        c.execute(text("CREATE TABLE periode_akademik (semester INT PRIMARY KEY, tahun_ajaran TEXT, tipe TEXT, kkm INT, hari_efektif INT, status TEXT)"))
        c.execute(text("CREATE TABLE kelas (kode TEXT PRIMARY KEY, nama TEXT, jurusan_kode TEXT, tingkat INT, tahun_ajaran TEXT, wali_kelas_nip TEXT)"))
        c.execute(text("CREATE TABLE siswa (nis TEXT PRIMARY KEY, nisn TEXT, nama TEXT, jenis_kelamin TEXT, no_absen INT, kelas_kode TEXT)"))
        c.execute(text("CREATE TABLE perusahaan_pkl (kode TEXT PRIMARY KEY, nama TEXT, jurusan_kode TEXT, bidang_usaha TEXT, kota TEXT, kuota_sesi1 INT, kuota_sesi2 INT, posisi_tersedia TEXT, narahubung TEXT)"))
        c.execute(text("CREATE TABLE penempatan_pkl (nis TEXT PRIMARY KEY, kode_perusahaan TEXT, posisi TEXT, sesi INT, pembimbing_perusahaan TEXT, pembimbing_sekolah_nip TEXT, status TEXT)"))
        c.execute(text("CREATE TABLE ekstrakurikuler (kode TEXT PRIMARY KEY, nama TEXT, deskripsi TEXT, hari TEXT, waktu TEXT, ketua_nis TEXT)"))
        c.execute(text("CREATE TABLE pembina_ekskul (kode_ekskul TEXT, urutan INT, nama TEXT, biodata TEXT)"))
        c.execute(text("CREATE TABLE jenis_pelanggaran (kode TEXT PRIMARY KEY, nama TEXT, tingkat TEXT, poin INT, sanksi_disarankan TEXT)"))
        c.execute(text("CREATE TABLE pelanggaran (id INTEGER PRIMARY KEY, nis TEXT, kode_pelanggaran TEXT, tanggal_kejadian TEXT, catatan TEXT)"))
        c.execute(text(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, nama TEXT, nip TEXT, "
            "role TEXT, password_hash TEXT, wajib_ganti_password INT DEFAULT 0, aktif INT DEFAULT 1, "
            "token_version INT NOT NULL DEFAULT 1, token_exempt_jti TEXT, dibuat_pada TEXT DEFAULT '2026-07-01T07:00:00')"
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

        c.execute(text("INSERT INTO jurusan VALUES ('RPL', 'Rekayasa Perangkat Lunak', 'PPLG'), ('DKV', 'Desain Komunikasi Visual', 'DKV')"))
        c.execute(text("INSERT INTO guru VALUES ('19800101', 'Budi Santoso, S.Pd.'), ('19800102', 'Ina Suratma, S.Pd.')"))
        c.execute(text("INSERT INTO periode_akademik VALUES (5, '2026/2027', 'Ganjil', 78, 95, 'berjalan')"))
        c.execute(text("INSERT INTO kelas VALUES ('XII-RPL-1', 'XII RPL 1', 'RPL', 12, '2026/2027', '19800102')"))
        c.execute(text("INSERT INTO siswa VALUES ('24251001', '0081000001', 'Aditya Ramadhan', 'L', 1, 'XII-RPL-1')"))
        c.execute(text("INSERT INTO perusahaan_pkl VALUES ('P01', 'PT Telkom Indonesia', 'RPL', 'Telekomunikasi', 'Bandung', 5, 5, 'Web Developer', 'Andi')"))
        c.execute(text("INSERT INTO penempatan_pkl VALUES ('24251001', 'P01', 'Web Developer', 1, 'Andi', '19800102', 'Selesai')"))
        c.execute(text("INSERT INTO ekstrakurikuler VALUES ('E01', 'Pramuka', 'Gerakan Pramuka', 'Jumat', '14.30', '24251001')"))
        c.execute(text("INSERT INTO pembina_ekskul VALUES ('E01', 1, 'Drs. Bagus', 'Pembina')"))
        c.execute(text("INSERT INTO jenis_pelanggaran VALUES ('P-S01', 'Membolos', 'Sedang', 15, 'Pembinaan')"))
        c.execute(text("INSERT INTO pelanggaran VALUES (1, '24251001', 'P-S01', '2026-10-01', 'Teguran')"))

        pw_hash = auth.hash_password("SandiLama-2026!")
        c.execute(
            text(
                "INSERT INTO users (id, username, nama, nip, role, password_hash, wajib_ganti_password, aktif, token_version) "
                "VALUES (1,'admin1','Admin Satu',NULL,'admin',:h,0,1,1),"
                "(2,'guru1','Ina Suratma','19800102','teacher',:h,0,1,1),"
                "(3,'bk1','Guru BK',NULL,'bk',:h,0,1,1)"
            ),
            {"h": pw_hash},
        )

    monkeypatch.setattr(auth, "engine", eng)
    monkeypatch.setattr(auth_routes, "db_engine", eng)
    monkeypatch.setattr(chat_routes, "db_engine", eng)
    monkeypatch.setattr(
        queries,
        "AUDIT_CHAT",
        "INSERT INTO audit_log (user_id, aksi, pertanyaan, intent_json, tabel_diakses, status) "
        "VALUES (:user_id, :aksi, :pertanyaan, :intent, :tabel, :status)",
    )
    monkeypatch.setattr(queries, "SISWA_FIND", queries.SISWA_FIND.replace(" ILIKE ", " LIKE "))
    monkeypatch.setattr(gemini, "enabled", lambda: False)
    auth.clear_revocations()
    auth_routes._login_hits.clear()
    chat_routes._hits.clear()

    app = FastAPI()
    app.include_router(auth_routes.router)
    app.include_router(admin_routes.router)
    app.include_router(chat_routes.router)
    app.include_router(data_routes.router)
    app.include_router(knowledge_routes.router)

    def conn_override():
        with eng.begin() as conn:
            yield conn

    app.dependency_overrides[get_conn] = conn_override
    return eng, TestClient(app, raise_server_exceptions=False)


def _make_minimal_xlsx(rows: list[list[str]]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        strings: list[str] = []
        str_idx: dict[str, int] = {}
        sheet_rows_xml: list[str] = []
        for r_i, row in enumerate(rows, 1):
            cells_xml: list[str] = []
            for c_i, val in enumerate(row):
                col = chr(ord("A") + c_i)
                if val not in str_idx:
                    str_idx[val] = len(strings)
                    strings.append(val)
                cells_xml.append(f'<c r="{col}{r_i}" t="s"><v>{str_idx[val]}</v></c>')
            sheet_rows_xml.append(f'<row r="{r_i}">{"".join(cells_xml)}</row>')
        sst_items = "".join(f"<si><t>{s}</t></si>" for s in strings)
        zf.writestr(
            "xl/sharedStrings.xml",
            f'<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">{sst_items}</sst>',
        )
        zf.writestr(
            "xl/worksheets/sheet1.xml",
            f'<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{"".join(sheet_rows_xml)}</sheetData></worksheet>',
        )
    return buf.getvalue()


def _make_minimal_pdf(text_content: str) -> bytes:
    stream_body = f"BT /F1 12 Tf 72 720 Td ({text_content}) Tj ET".encode("latin-1")
    compressed = zlib.compress(stream_body)
    return (
        b"%PDF-1.4\n1 0 obj\n<< /Length "
        + str(len(compressed)).encode("ascii")
        + b" /Filter /FlateDecode >>\nstream\n"
        + compressed
        + b"\nendstream\nendobj\n%%EOF\n"
    )


def _assert_clean_trace(out: dict) -> None:
    import re

    assert out["mode"] in ("ai", "lokal")
    assert "gemini" not in json.dumps(out.get("jejak_pikir", []), ensure_ascii=False).lower()
    forbidden_re = re.compile(
        r"\b(?:gemini|sql|rag|rbac|tabel|baris|ranking_kelas|pelanggaran_siswa|info_wali_kelas)\b|cakupan=|panjang_kueri=|intent=",
        re.IGNORECASE,
    )
    for step in out.get("jejak_pikir", []):
        assert step["detail"] == [], f"detail harus kosong: {step}"
        assert step["durasi_ms"] >= 0
        assert not forbidden_re.search(step["judul"]), f"judul teknis: {step['judul']}"
        assert not forbidden_re.search(step["ringkasan"]), f"ringkasan teknis: {step['ringkasan']}"


def test_cot_sql_layering_trace_semua_jalur(monkeypatch):
    monkeypatch.setattr(gemini, "enabled", lambda: False)

    class MockDb:
        def rows(self, sql, **p):
            if "FROM kelas k" in sql:
                return [{"kode": "XII-RPL-1", "nama": "XII RPL 1", "jurusan_kode": "RPL", "tahun_ajaran": "2026/2027", "wali_kelas": "Ina Suratma, S.Pd.", "jumlah_siswa": 36}]
            if "FROM knowledge_document" in sql:
                return [{"nama_file": "panduan_seragam.md", "ringkasan": "Aturan seragam", "konten_teks": "Aturan seragam khusus jurusan RPL memakai jas lab pada hari Rabu."}]
            return []

    @contextmanager
    def open_db():
        yield MockDb()

    # 1) Normal query -> 5 steps alami tanpa detail/jargon
    out_ok = engine_pkg.answer(open_db, "Siapa wali kelas XII RPL 1?", role="teacher")
    assert isinstance(out_ok["total_durasi_ms"], int) and out_ok["total_durasi_ms"] >= 0
    assert out_ok["mode"] == "lokal"
    assert [s["kode"] for s in out_ok["jejak_pikir"]] == [
        "scope_guard", "intent_layer", "rbac_layer", "sql_layer", "compose_layer"
    ]
    assert [s["judul"] for s in out_ok["jejak_pikir"]] == [
        "Memahami Konteks Pertanyaan",
        "Menentukan Arah Pencarian",
        "Memeriksa Hak Akses",
        "Mengumpulkan Data Sekolah",
        "Menyusun Jawaban",
    ]
    assert all(s["status"] == "ok" for s in out_ok["jejak_pikir"])
    _assert_clean_trace(out_ok)

    # 2) Outside scope -> 1 step ditolak
    out_scope = engine_pkg.answer(open_db, "nilai siswa kelas XI RPL 1", role="admin")
    assert len(out_scope["jejak_pikir"]) == 1
    assert out_scope["jejak_pikir"][0]["kode"] == "scope_guard"
    assert out_scope["jejak_pikir"][0]["status"] == "ditolak"
    assert out_scope["mode"] == "lokal"
    _assert_clean_trace(out_scope)

    # 3) RBAC ditolak -> 3 steps, step 3 ditolak
    out_rbac = engine_pkg.answer(open_db, "pelanggaran XII RPL 1", role="teacher")
    assert out_rbac.get("ditolak") is True
    assert [s["kode"] for s in out_rbac["jejak_pikir"]] == ["scope_guard", "intent_layer", "rbac_layer"]
    assert out_rbac["jejak_pikir"][2]["status"] == "ditolak"
    _assert_clean_trace(out_rbac)

    # 4) RAG mencakup knowledge_document saat tersedia
    out_rag = engine_pkg.answer(open_db, "apa aturan seragam khusus jurusan RPL?", role="teacher")
    assert "jas lab" in out_rag["jawaban"].lower()
    assert "knowledge_document" in out_rag["sumber"]
    _assert_clean_trace(out_rag)

    # 5) Mode AI (intent/compose via Gemini) -> mode='ai', jejak tetap bersih tanpa 'Gemini'
    monkeypatch.setattr(gemini, "enabled", lambda: True)
    monkeypatch.setattr(
        gemini,
        "generate",
        lambda sys_p, user_p, **k: (
            '{"intent": "pelanggaran_siswa", "params": {"kelas": "XII RPL 1"}}'
            if "pelanggaran" in user_p.lower()
            else '{"intent": "info_wali_kelas", "params": {"kelas": "XII RPL 1"}}'
        ),
    )
    out_ai = engine_pkg.answer(open_db, "Siapa wali kelas XII RPL 1?", role="teacher")
    assert out_ai["mode"] == "ai"
    _assert_clean_trace(out_ai)
    out_ai_rbac = engine_pkg.answer(open_db, "pelanggaran XII RPL 1", role="teacher")
    assert out_ai_rbac.get("ditolak") is True and out_ai_rbac["mode"] == "ai"
    _assert_clean_trace(out_ai_rbac)
    monkeypatch.setattr(gemini, "enabled", lambda: False)

    # 6) Handler exception -> sql_layer & compose_layer berstatus error tanpa detail teknis
    monkeypatch.setattr(handlers, "run", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("db down")))
    out_err = engine_pkg.answer(open_db, "wali kelas XII RPL 1", role="admin")
    assert out_err["galat"] is True
    assert out_err["jejak_pikir"][3]["kode"] == "sql_layer" and out_err["jejak_pikir"][3]["status"] == "error"
    assert out_err["jejak_pikir"][4]["status"] == "error"
    _assert_clean_trace(out_err)


def test_health_keys_dan_chat_zero_gemini(monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "")
    monkeypatch.setattr(settings, "gemini_send_data", False)
    c_main = TestClient(main.app)
    r_local = c_main.get("/api/v1/health")
    assert r_local.status_code == 200
    h_local = r_local.json()
    assert "ai_engine" in h_local and "ai_kirim_data" in h_local
    assert "gemini" not in h_local and "gemini_kirim_data" not in h_local
    assert h_local["ai_kirim_data"] is False
    assert "lokal" in h_local["ai_engine"].lower()
    assert "gemini" not in json.dumps(h_local).lower()
    for key in ("status", "database", "tahun_ajaran", "rag"):
        assert key in h_local

    monkeypatch.setattr(settings, "gemini_api_key", "KUNCI-TES")
    monkeypatch.setattr(settings, "gemini_send_data", True)
    r_ai = c_main.get("/api/v1/health")
    assert r_ai.status_code == 200
    h_ai = r_ai.json()
    assert h_ai["ai_engine"] == "aktif"
    assert h_ai["ai_kirim_data"] is True
    assert "gemini" not in json.dumps(h_ai).lower()

    # Cek POST /chat (normal, klarifikasi, outside scope, RBAC ditolak) bebas dari kata 'gemini'
    _, client = _setup_extended_db(monkeypatch)
    tok_g = client.post("/auth/login", json={"username": "guru1", "password": "SandiLama-2026!"}).json()["access_token"]
    hdr_g = {"Authorization": f"Bearer {tok_g}"}
    for q in (
        "Siapa wali kelas XII RPL 1?",
        "lorem ipsum",
        "nilai siswa kelas XI RPL 1",
        "pelanggaran XII RPL 1",
    ):
        rc = client.post("/chat", json={"pesan": q}, headers=hdr_g)
        assert rc.status_code == 200
        body = rc.json()
        assert body["mode"] in ("ai", "lokal")
        assert all(s["detail"] == [] for s in body["jejak_pikir"])
        assert "gemini" not in json.dumps(body, ensure_ascii=False).lower()


def test_chat_sessions_history_pin_dan_isolasi_user(monkeypatch):
    _, client = _setup_extended_db(monkeypatch)
    t_guru = client.post("/auth/login", json={"username": "guru1", "password": "SandiLama-2026!"}).json()["access_token"]
    t_bk = client.post("/auth/login", json={"username": "bk1", "password": "SandiLama-2026!"}).json()["access_token"]
    hdr_g = {"Authorization": f"Bearer {t_guru}"}
    hdr_b = {"Authorization": f"Bearer {t_bk}"}

    # 1) POST /chat tanpa sesi_id membuat sesi baru + menyimpan jejak_pikir & total_durasi_ms
    r1 = client.post("/chat", json={"pesan": "Siapa wali kelas XII RPL 1?"}, headers=hdr_g)
    assert r1.status_code == 200
    b1 = r1.json()
    sesi1 = b1["sesi_id"]
    assert sesi1 and b1["judul_sesi"] == "Wali Kelas XII RPL 1"
    assert len(b1["jejak_pikir"]) == 5 and isinstance(b1["total_durasi_ms"], int)

    # 2) Lanjut sesi yang sama
    r2 = client.post("/chat", json={"pesan": "ada ekskul apa saja?", "sesi_id": sesi1}, headers=hdr_g)
    assert r2.status_code == 200 and r2.json()["sesi_id"] == sesi1

    # 3) Buat sesi kedua lalu pin sesi kedua
    r3 = client.post("/chat", json={"pesan": "Siapa saja yang PKL di Telkom?"}, headers=hdr_g)
    sesi2 = r3.json()["sesi_id"]
    rp = client.patch(f"/chat/sesi/{sesi2}", json={"pinned": True, "judul": "Daftar PKL 100% Telkom"}, headers=hdr_g)
    assert rp.status_code == 200
    assert rp.json()["pinned"] is True and rp.json()["judul"] == "Daftar PKL 100% Telkom"

    # 4) GET /chat/sesi urut pinned DESC dan mendukung pencarian escape '%'
    rl = client.get("/chat/sesi", headers=hdr_g)
    assert rl.status_code == 200
    items = rl.json()["data"]
    assert [i["id"] for i in items] == [sesi2, sesi1]
    assert items[1]["jumlah_pesan"] == 4
    r_search = client.get("/chat/sesi?q=%25", headers=hdr_g)
    assert [i["id"] for i in r_search.json()["data"]] == [sesi2]

    # 5) Detail sesi menyimpan pesan & metadata jejak_pikir
    rd = client.get(f"/chat/sesi/{sesi1}", headers=hdr_g)
    assert rd.status_code == 200
    msgs = rd.json()["messages"]
    assert [m["role"] for m in msgs] == ["user", "ai", "user", "ai"]
    assert len(msgs[1]["metadata"]["jejak_pikir"]) == 5

    # 6) Isolasi antar user (bk1 tidak boleh akses sesi guru1)
    assert client.get(f"/chat/sesi/{sesi1}", headers=hdr_b).status_code == 404
    assert client.patch(f"/chat/sesi/{sesi1}", json={"judul": "hack"}, headers=hdr_b).status_code == 404
    assert client.delete(f"/chat/sesi/{sesi1}", headers=hdr_b).status_code == 404
    assert client.post("/chat", json={"pesan": "halo", "sesi_id": sesi1}, headers=hdr_b).status_code == 404

    # 7) DELETE /chat/sesi hanya menghapus sesi tidak disematkan milik user ini
    r_bk_chat = client.post("/chat", json={"pesan": "ada ekskul apa saja?"}, headers=hdr_b)
    assert r_bk_chat.status_code == 200
    r_del_unpinned = client.delete("/chat/sesi", headers=hdr_g)
    assert r_del_unpinned.status_code == 200 and r_del_unpinned.json()["deleted"] == 1
    assert [i["id"] for i in client.get("/chat/sesi", headers=hdr_g).json()["data"]] == [sesi2]
    assert len(client.get("/chat/sesi", headers=hdr_b).json()["data"]) == 1

    # 8) DELETE /chat/sesi/{id} menghapus sesi tertentu
    assert client.delete(f"/chat/sesi/{sesi2}", headers=hdr_g).status_code == 200
    assert client.get(f"/chat/sesi/{sesi2}", headers=hdr_g).status_code == 404


def test_master_ringkasan_dan_endpoint_akun(monkeypatch):
    eng, client = _setup_extended_db(monkeypatch)
    t1 = client.post("/auth/login", json={"username": "guru1", "password": "SandiLama-2026!"}).json()["access_token"]
    t2 = client.post("/auth/login", json={"username": "guru1", "password": "SandiLama-2026!"}).json()["access_token"]
    hdr1 = {"Authorization": f"Bearer {t1}"}

    # 1) GET /master/ringkasan
    rm = client.get("/master/ringkasan", headers=hdr1)
    assert rm.status_code == 200
    assert rm.json()["data"] == {
        "siswa": 1, "kelas": 1, "guru": 2, "penempatan_pkl": 1,
        "perusahaan_pkl": 1, "ekstrakurikuler": 1, "jurusan": 2, "tahun_ajaran": "2026/2027",
    }

    # 2) GET /auth/me menyertakan dibuat_pada dan wali_kelas
    me = client.get("/auth/me", headers=hdr1)
    assert me.status_code == 200
    assert me.json()["dibuat_pada"] == "2026-07-01T07:00:00"
    assert me.json()["wali_kelas"] == ["XII RPL 1"]

    # 3) PATCH /auth/profil
    assert client.patch("/auth/profil", json={"nama": "   "}, headers=hdr1).status_code == 422
    rp = client.patch("/auth/profil", json={"nama": "Ina Suratma, M.Pd."}, headers=hdr1)
    assert rp.status_code == 200 and rp.json()["nama"] == "Ina Suratma, M.Pd."
    assert rp.json()["wali_kelas"] == ["XII RPL 1"]

    # 4) POST /auth/cabut-sesi-lain mempertahankan t1 dan mencabut t2 lintas reload
    rc = client.post("/auth/cabut-sesi-lain", headers=hdr1)
    assert rc.status_code == 200 and rc.json()["status"] == "ok"
    auth.clear_revocations()
    assert client.get("/auth/me", headers=hdr1).status_code == 200
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {t2}"}).status_code == 401

    # 5) GET /auth/aktivitas hanya mengembalikan log keamanan user bersangkutan
    client.post("/chat", json={"pesan": "ada ekskul apa saja?"}, headers=hdr1)
    ra = client.get("/auth/aktivitas", headers=hdr1)
    assert ra.status_code == 200
    aksis = [item["aksi"] for item in ra.json()["data"]]
    assert "login_ok" in aksis and "ubah_profil" in aksis and "cabut_sesi_lain" in aksis
    assert "chat" not in aksis


def test_knowledge_extract_graf_unggah_konflik_dan_persetujuan_hapus(monkeypatch):
    # 1) Uji ekstraksi teks berbagai format stdlib (termasuk xlsx & pdf)
    assert "Aturan PKL" in graph.extract_text("panduan.md", b"# Aturan PKL\nWajib hadir.")
    assert "RPL" in graph.extract_text("info.json", json.dumps({"jurusan": "RPL", "kkm": 78}).encode("utf-8"))
    assert "nama: Aditya" in graph.extract_text("siswa.csv", b"nama,kelas\nAditya,XII RPL 1\n")
    xlsx_bytes = _make_minimal_xlsx([["Jurusan", "Mitra"], ["RPL", "PT Telkom Indonesia"]])
    assert "Jurusan: RPL; Mitra: PT Telkom Indonesia" in graph.extract_text("mitra.xlsx", xlsx_bytes)
    pdf_bytes = _make_minimal_pdf("Panduan PKL SMKN 4 Bandung KKM 80")
    assert "Panduan PKL SMKN 4 Bandung KKM 80" in graph.extract_text("panduan.pdf", pdf_bytes)

    import pytest
    with pytest.raises(ValueError):
        graph.extract_text("kosong.txt", b"")
    with pytest.raises(ValueError):
        graph.extract_text("besar.txt", b"a" * (graph.MAX_FILE_BYTES + 1))
    with pytest.raises(ValueError):
        graph.extract_text("virus.exe", b"MZ")

    # 2) Uji end-to-end API Knowledge Graph & CORS DELETE
    _, client = _setup_extended_db(monkeypatch)
    t_admin = client.post("/auth/login", json={"username": "admin1", "password": "SandiLama-2026!"}).json()["access_token"]
    t_guru = client.post("/auth/login", json={"username": "guru1", "password": "SandiLama-2026!"}).json()["access_token"]
    hdr_a = {"Authorization": f"Bearer {t_admin}"}
    hdr_g = {"Authorization": f"Bearer {t_guru}"}

    # Graf awal terbangun dari tabel sekolah
    rg0 = client.get("/knowledge/graf", headers=hdr_g)
    assert rg0.status_code == 200
    g0 = rg0.json()
    assert any(n["kunci"] == "sekolah:smkn4" for n in g0["nodes"])
    assert any(n["kunci"] == "jurusan:RPL" for n in g0["nodes"])
    assert any(n["kunci"] == "perusahaan:P01" for n in g0["nodes"])
    assert g0["stats"]["total_dokumen"] == 0

    # Guru mengunggah dokumen pertama
    doc1_b64 = base64.b64encode(
        "Panduan PKL jurusan RPL di PT Telkom Indonesia. Tata tertib seragam praktik minimal KKM 78 untuk kelas XII RPL 1.".encode("utf-8")
    ).decode("ascii")
    ru1 = client.post("/knowledge/dokumen", json={"nama_file": "panduan_pkl_2026.md", "konten_base64": doc1_b64}, headers=hdr_g)
    assert ru1.status_code == 201
    b_u1 = ru1.json()
    doc1_id = b_u1["dokumen"]["id"]
    matched_kunci = {m["kunci"] for m in b_u1["matched_entities"]}
    assert "jurusan:RPL" in matched_kunci and "perusahaan:P01" in matched_kunci
    assert b_u1["konflik"] == []

    # Dokumen aktif langsung bisa dicari lewat engine /chat (RAG info_sekolah + fallback dokumen)
    rc_rag = client.post("/chat", json={"pesan": "tata tertib seragam praktik jurusan RPL"}, headers=hdr_g)
    assert rc_rag.status_code == 200
    assert "knowledge_document" in rc_rag.json()["sumber"]
    rc_fallback = client.post("/chat", json={"pesan": "panduan praktik telkom indonesia"}, headers=hdr_g)
    assert rc_fallback.status_code == 200
    assert "knowledge_document" in rc_fallback.json()["sumber"]

    # Unggah dokumen kedua dengan konflik nilai KKM pada konteks RPL
    doc2_b64 = base64.b64encode(
        "Revisi panduan PKL jurusan RPL bersama PT Telkom Indonesia menetapkan nilai KKM minimal 85.".encode("utf-8")
    ).decode("ascii")
    ru2 = client.post("/knowledge/dokumen", json={"nama_file": "revisi_kkm_pkl.txt", "konten_base64": doc2_b64}, headers=hdr_g)
    assert ru2.status_code == 201
    assert len(ru2.json()["konflik"]) == 1
    doc2_id = ru2.json()["dokumen"]["id"]

    # Graf menampilkan konflik pada stats
    rg1 = client.get("/knowledge/graf", headers=hdr_g)
    assert rg1.json()["stats"]["konflik"] >= 1
    assert rg1.json()["stats"]["total_dokumen"] == 2
    assert len(client.get("/knowledge/graf?sertakan_sistem=false", headers=hdr_g).json()["nodes"]) >= 2

    # Guru mengajukan penghapusan doc1 -> status menjadi menunggu_hapus
    ra = client.post(f"/knowledge/dokumen/{doc1_id}/ajukan-hapus", json={"alasan": "Dokumen lama sudah diganti revisi"}, headers=hdr_g)
    assert ra.status_code == 200
    req1_id = ra.json()["request_id"]
    # Duplikat permintaan -> 409
    assert client.post(f"/knowledge/dokumen/{doc1_id}/ajukan-hapus", json={"alasan": "Ajukan ulang"}, headers=hdr_g).status_code == 409

    # Non-admin dilarang melihat atau memproses permintaan hapus maupun DELETE langsung
    assert client.get("/knowledge/permintaan-hapus", headers=hdr_g).status_code == 403
    assert client.post(f"/knowledge/permintaan-hapus/{req1_id}/setuju", headers=hdr_g).status_code == 403
    assert client.delete(f"/knowledge/dokumen/{doc1_id}", headers=hdr_g).status_code == 403

    # Admin menolak permintaan pertama -> status dokumen kembali aktif
    assert len(client.get("/knowledge/permintaan-hapus", headers=hdr_a).json()["data"]) == 1
    rt = client.post(f"/knowledge/permintaan-hapus/{req1_id}/tolak", json={"catatan_admin": "Masih dipakai"}, headers=hdr_a)
    assert rt.status_code == 200
    docs_after_reject = {d["id"]: d for d in client.get("/knowledge/dokumen", headers=hdr_a).json()["data"]}
    assert docs_after_reject[doc1_id]["status"] == "aktif"

    # Ajukan lagi lalu Admin menyetujui -> soft-delete dokumen dan grafnya
    req2_id = client.post(f"/knowledge/dokumen/{doc1_id}/ajukan-hapus", json={"alasan": "Sudah final diganti"}, headers=hdr_g).json()["request_id"]
    rs = client.post(f"/knowledge/permintaan-hapus/{req2_id}/setuju", headers=hdr_a)
    assert rs.status_code == 200
    docs_after_approve = {d["id"]: d for d in client.get("/knowledge/dokumen", headers=hdr_a).json()["data"]}
    assert doc1_id not in docs_after_approve and doc2_id in docs_after_approve

    # Admin hapus langsung doc2 via DELETE
    rd_admin = client.delete(f"/knowledge/dokumen/{doc2_id}", headers=hdr_a)
    assert rd_admin.status_code == 200
    assert client.get("/knowledge/dokumen", headers=hdr_a).json()["data"] == []

    # Verifikasi main.app mendaftarkan DELETE di CORS & router /knowledge
    c_main = TestClient(main.app)
    r_opt = c_main.options(
        "/api/v1/knowledge/dokumen/1",
        headers={"Origin": settings.cors_origins[0], "Access-Control-Request-Method": "DELETE"},
    )
    assert "DELETE" in r_opt.headers.get("access-control-allow-methods", "")


def test_knowledge_entity_matching_tanpa_false_match_dan_dedup(monkeypatch):
    eng, client = _setup_extended_db(monkeypatch)
    with eng.begin() as c:
        c.execute(text("INSERT INTO perusahaan_pkl VALUES ('P02', 'PT Telkom Indonesia', 'DKV', 'Telekomunikasi', 'Bandung', 4, 4, 'UI Designer', 'Budi')"))
        c.execute(text("INSERT INTO perusahaan_pkl VALUES ('D08', 'PT Pindad (Persero) - Humas dan Desain', 'DKV', 'Manufaktur', 'Bandung', 4, 4, 'Graphic Designer', 'Maya')"))
    t_guru = client.post("/auth/login", json={"username": "guru1", "password": "SandiLama-2026!"}).json()["access_token"]
    hdr_g = {"Authorization": f"Bearer {t_guru}"}

    # "humas", "dan", "desain" tidak boleh false-match ke PT Pindad; PT Telkom ganda ter-dedup menjadi 1 entitas
    doc_b64 = base64.b64encode(
        "Laporan divisi humas dan desain media digital teknologi informasi di PT Telkom Indonesia.".encode("utf-8")
    ).decode("ascii")
    res = client.post("/knowledge/dokumen", json={"nama_file": "laporan_humas.md", "konten_base64": doc_b64}, headers=hdr_g)
    assert res.status_code == 201
    matched = res.json()["matched_entities"]
    labels = [m["label"] for m in matched]
    assert labels.count("PT Telkom Indonesia") == 1
    assert all("Pindad" not in lbl for lbl in labels)



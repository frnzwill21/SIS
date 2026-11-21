"""Uji regresi untuk perbaikan alur keamanan, auth, Oracle proxy, dan Hybrid Query Engine."""
import asyncio
import urllib.error
import urllib.request
from contextlib import contextmanager

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

from app import auth, queries
from app.api import admin_routes, auth_routes, chat_routes, data_routes, oracle_routes
from app.config import settings
from app.db import get_conn
from app.engine import gemini, handlers, intents
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
    monkeypatch.setattr(oracle_routes, "db_engine", eng)
    auth.clear_revocations()
    auth_routes._login_hits.clear()

    app = FastAPI()
    app.include_router(auth_routes.router)
    app.include_router(admin_routes.router)
    app.include_router(oracle_routes.router)

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


def test_ganti_password_minimal_1_dan_cabut_sesi_lain(monkeypatch):
    _, client = _setup_auth_db(monkeypatch)
    t1 = client.post("/auth/login", json={"username": "guru1", "password": "SandiLama-2026!"}).json()["access_token"]
    t2 = client.post("/auth/login", json={"username": "guru1", "password": "SandiLama-2026!"}).json()["access_token"]

    # Kosong ditolak
    r_empty = client.post(
        "/auth/ganti-password",
        json={"password_lama": "SandiLama-2026!", "password_baru": ""},
        headers={"Authorization": f"Bearer {t1}"},
    )
    assert r_empty.status_code == 422

    # 1+ karakter diterima; t1 tetap aktif, t2 dicabut
    r_ok = client.post(
        "/auth/ganti-password",
        json={"password_lama": "SandiLama-2026!", "password_baru": "1"},
        headers={"Authorization": f"Bearer {t1}"},
    )
    assert r_ok.status_code == 200
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {t1}"}).status_code == 200
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {t2}"}).status_code == 401


def test_oracle_wajib_login_dan_audit_pelanggaran(monkeypatch):
    eng, client = _setup_auth_db(monkeypatch)
    monkeypatch.setattr(settings, "oracle_allow_anon", False)

    # Tanpa token ditolak 401
    assert client.get("/oracle/pelanggaran").status_code == 401
    assert client.post("/oracle/pelanggaran", json={"nis": "24251001", "kode_pelanggaran": "P-R01"}).status_code == 401

    # Dengan token sah -> berjalan dan tercatat di audit_log
    tok = client.post("/auth/login", json={"username": "guru1", "password": "SandiLama-2026!"}).json()["access_token"]

    async def fake_get_all(path, params=None):
        return [{"id": 1, "nis": "24251001"}]

    async def fake_post(path, payload):
        return {"id_pelanggaran": 1001, "poin_kejadian": 5, "total_poin": 10, "status_pesan": "BERHASIL"}

    monkeypatch.setattr(oracle_routes, "_ords_get_all", fake_get_all)
    monkeypatch.setattr(oracle_routes, "_ords_post", fake_post)

    assert client.get("/oracle/pelanggaran", headers={"Authorization": f"Bearer {tok}"}).status_code == 200
    r_post = client.post(
        "/oracle/pelanggaran",
        json={"nis": "24251001", "kode_pelanggaran": "P-R01", "tanggal_kejadian": "2026-11-20", "catatan": ""},
        headers={"Authorization": f"Bearer {tok}"},
    )
    assert r_post.status_code == 200 and r_post.json()["id_pelanggaran"] == 1001 and r_post.json()["poin_kejadian"] == 5

    with eng.connect() as c:
        aksi = [r[0] for r in c.execute(text("SELECT aksi FROM audit_log ORDER BY id")).all()]
    assert "oracle_baca_pelanggaran" in aksi and "oracle_catat_pelanggaran" in aksi


def test_oracle_ords_pagination_mengikuti_hasMore(monkeypatch):
    calls = []

    async def fake_ords_get(path, params=None):
        calls.append(dict(params or {}))
        offset = (params or {}).get("offset", 0)
        if offset == 0:
            return {"items": [{"id": 1}, {"id": 2}], "hasMore": True}
        return {"items": [{"id": 3}], "hasMore": False}

    monkeypatch.setattr(oracle_routes, "_ords_get", fake_ords_get)
    rows = asyncio.run(oracle_routes._ords_get_all("rekap-akademik", params={"kelas": "XII-RPL-1"}))
    assert [r["id"] for r in rows] == [1, 2, 3]
    assert [c["offset"] for c in calls] == [0, 2]


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
    assert intents.rule_intent("halo")["intent"] == "tidak_dikenali"
    assert intents.rule_intent("terima kasih")["intent"] == "tidak_dikenali"


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
    monkeypatch.setattr(oracle_routes, "db_engine", eng)
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
    app.include_router(oracle_routes.router)
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
        json={"password_lama": "SandiLama-2026!", "password_baru": "1"},
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


def test_health_dan_oracle_status_tidak_membocorkan_url_ords(monkeypatch):
    from app import main

    _, client = _setup_full_db(monkeypatch)
    tok = client.post("/auth/login", json={"username": "guru1", "password": "SandiLama-2026!"}).json()["access_token"]

    async def fake_ok(path, params=None):
        return [{"kode": "XII-RPL-1"}]

    async def fake_fail(path, params=None):
        raise oracle_routes._oracle_error(502, "ORACLE_UNREACHABLE", "down")

    monkeypatch.setattr(oracle_routes, "_ords_get_all", fake_ok)
    r_ok = client.get("/oracle/status", headers={"Authorization": f"Bearer {tok}"})
    assert r_ok.status_code == 200 and "base_url" not in r_ok.json()

    monkeypatch.setattr(oracle_routes, "_ords_get_all", fake_fail)
    r_fail = client.get("/oracle/status", headers={"Authorization": f"Bearer {tok}"})
    assert r_fail.status_code == 200 and r_fail.json()["connected"] is False and "base_url" not in r_fail.json()

    c_main = TestClient(main.app, raise_server_exceptions=False)
    r_health = c_main.get("/api/v1/health")
    assert r_health.status_code == 200 and "oracle_ords" not in r_health.json()


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


def test_oracle_audit_status_gagal_dan_tahan_galat_db_serta_anon_pg_mati(monkeypatch):
    eng, client = _setup_full_db(monkeypatch)
    monkeypatch.setattr(settings, "oracle_allow_anon", False)
    tok = client.post("/auth/login", json={"username": "guru1", "password": "SandiLama-2026!"}).json()["access_token"]

    # 1) GET /oracle/pelanggaran gagal ORDS -> audit tercatat 'gagal'
    async def fake_fail(path, params=None):
        raise oracle_routes._oracle_error(502, "ORACLE_UNREACHABLE", "down")

    monkeypatch.setattr(oracle_routes, "_ords_get_all", fake_fail)
    assert client.get("/oracle/pelanggaran", headers={"Authorization": f"Bearer {tok}"}).status_code == 502

    # 2) POST /oracle/pelanggaran dengan respons logis GAGAL -> audit tercatat 'gagal'
    async def fake_sp_fail(path, payload):
        return {"id_pelanggaran": 0, "poin_kejadian": 0, "total_poin": 0, "status_pesan": "GAGAL: NIS tidak valid"}

    monkeypatch.setattr(oracle_routes, "_ords_post", fake_sp_fail)
    r_logic = client.post(
        "/oracle/pelanggaran",
        json={"nis": "99999999", "kode_pelanggaran": "P-R01", "tanggal_kejadian": "2026-11-20"},
        headers={"Authorization": f"Bearer {tok}"},
    )
    assert r_logic.status_code == 200

    with eng.connect() as c:
        rows = c.execute(
            text("SELECT aksi, status FROM audit_log WHERE aksi LIKE 'oracle_%' ORDER BY id")
        ).all()
    assert rows == [("oracle_baca_pelanggaran", "gagal"), ("oracle_catat_pelanggaran", "gagal")]

    # 3) Galat DB audit setelah SP Oracle commit tidak membuat respons jadi 500
    async def fake_sp_ok(path, payload):
        return {"id_pelanggaran": 55, "poin_kejadian": 15, "total_poin": 30, "status_pesan": "SUKSES"}

    monkeypatch.setattr(oracle_routes, "_ords_post", fake_sp_ok)
    monkeypatch.setattr(oracle_routes, "_audit_oracle", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("pg down")))
    r_ok = client.post(
        "/oracle/pelanggaran",
        json={"nis": "24251001", "kode_pelanggaran": "P-S04", "catatan": "Pembinaan"},
        headers={"Authorization": f"Bearer {tok}"},
    )
    assert r_ok.status_code == 200 and r_ok.json()["id_pelanggaran"] == 55 and r_ok.json()["poin_kejadian"] == 15

    # 4) ORACLE_ALLOW_ANON=1 + header Authorization lama + PG mati -> fallback anon (200), bukan 500
    monkeypatch.setattr(settings, "oracle_allow_anon", True)

    class DeadEngine:
        def connect(self):
            raise RuntimeError("PG connection refused")

    monkeypatch.setattr(auth, "engine", DeadEngine())

    async def fake_ok_list(path, params=None):
        return [{"id": 1}]

    monkeypatch.setattr(oracle_routes, "_ords_get_all", fake_ok_list)
    r_anon = client.get("/oracle/pelanggaran", headers={"Authorization": f"Bearer {tok}"})
    assert r_anon.status_code == 200 and r_anon.json()["data"] == [{"id": 1}]


def test_oracle_ords_get_all_reuses_single_client(monkeypatch):
    seen_clients = []

    async def spy_get(path, params=None):
        seen_clients.append(oracle_routes._ords_client_var.get())
        offset = (params or {}).get("offset", 0)
        if offset == 0:
            return {"items": [{"id": 1}], "hasMore": True}
        return {"items": [{"id": 2}], "hasMore": False}

    monkeypatch.setattr(oracle_routes, "_ords_get", spy_get)
    rows = asyncio.run(oracle_routes._ords_get_all("pelanggaran"))
    assert len(rows) == 2
    assert seen_clients[0] is not None and seen_clients[0] is seen_clients[1]
    assert oracle_routes._ords_client_var.get() is None


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

    # Whitespace-only & tanggal masa depan ditolak 422
    assert client.post("/chat", json={"pesan": "   "}, headers=hdr).status_code == 422
    assert client.post("/oracle/pelanggaran", json={"nis": "  ", "kode_pelanggaran": "P-R01"}, headers=hdr).status_code == 422
    assert client.post("/oracle/pelanggaran", json={"nis": "24251001", "kode_pelanggaran": "   "}, headers=hdr).status_code == 422
    assert client.post(
        "/oracle/pelanggaran",
        json={"nis": "24251001", "kode_pelanggaran": "P-R01", "tanggal_kejadian": "2099-01-01"},
        headers=hdr,
    ).status_code == 422
    assert client.post("/oracle/rekap-akademik", json={"kelas_kode": "   ", "semester": 5}, headers=hdr).status_code == 422
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
                auth_routes.GantiPasswordIn(password_lama="x", password_baru="1"),
                user={"id": 999, "username": "hilang"},
                conn=c,
            )
    assert exc_info.value.status_code == 401

    # ADMIN_AKTIF_LOCK tersedia dengan FOR UPDATE untuk PostgreSQL
    assert "FOR UPDATE" in queries.ADMIN_AKTIF_LOCK

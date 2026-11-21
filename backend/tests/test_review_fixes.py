"""Uji regresi untuk temuan code review. Jalankan dari folder backend:  pytest -q"""
import importlib
import json
import sys

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

from app import auth, queries
from app.config import settings
from app.engine import gemini, handlers, intents
from app.engine.core import Result

compose = sys.modules["app.engine.compose"]  # `app.engine.compose` sebagai atribut adalah FUNGSI (ditimpa __init__)
engine_pkg = sys.modules["app.engine"]

NIS, NISN = "24251001", "0087612943"


class FakeDb:
    def rows(self, sql, **p):
        if "WHERE s.nis" in sql and "FROM siswa s" in sql:
            return [{"nis": NIS, "nisn": NISN, "nama": "Aditya Ramadhan", "jenis_kelamin": "L", "no_absen": 3,
                     "kelas_kode": "XII-RPL-2", "kelas": "XII RPL 2", "wali_kelas": "Budi S.Pd.", "jurusan": "RPL"}]
        if "FROM pelanggaran pl" in sql:
            return [{"pelanggaran": "Membolos", "tingkat": "Sedang", "poin": 25,
                     "tanggal_kejadian": "2026-09-01", "tindak_lanjut": "Panggilan orang tua"}]
        return []


@pytest.fixture
def siswa(monkeypatch):
    s = {"nis": NIS, "nama": "Aditya Ramadhan", "kelas": "XII RPL 2", "no_absen": 3}
    monkeypatch.setattr(handlers.resolver, "find_siswa_in_text", lambda db, pesan, hint=None: [s])


@pytest.fixture
def spy(monkeypatch):
    calls = []
    monkeypatch.setattr(gemini, "enabled", lambda: True)
    monkeypatch.setattr(gemini, "generate", lambda system, prompt, **k: calls.append(prompt) or "Aditya Ramadhan siswa XII RPL 2.")
    return calls


# ---------------------------------------------------------------- privasi: apa yang boleh sampai ke Gemini
def test_default_tidak_mengirim_data_ke_gemini(siswa, spy, monkeypatch):
    monkeypatch.setattr(settings, "gemini_send_data", False)
    teks, mode = compose.compose("profil Aditya", handlers.profil_siswa(FakeDb(), {}, "profil Aditya"))
    assert spy == [] and mode == "aturan"


def test_nis_nisn_tidak_pernah_terkirim(siswa, spy, monkeypatch):
    monkeypatch.setattr(settings, "gemini_send_data", True)
    compose.compose("profil Aditya", handlers.profil_siswa(FakeDb(), {}, "profil Aditya"))
    assert len(spy) == 1
    assert NIS not in spy[0] and NISN not in spy[0]


def test_data_sensitif_tidak_dikirim_ke_gemini(siswa, spy, monkeypatch):
    monkeypatch.setattr(settings, "gemini_send_data", True)
    res = handlers.pelanggaran_siswa(FakeDb(), {}, "pelanggaran Aditya")
    assert res.sensitif
    _, mode = compose.compose("pelanggaran Aditya", res)
    assert spy == [] and mode == "aturan"


def test_id_di_pertanyaan_ikut_disamarkan(siswa, spy, monkeypatch):
    monkeypatch.setattr(settings, "gemini_send_data", True)
    compose.compose(f"profil {NISN}", handlers.profil_siswa(FakeDb(), {}, "x"))
    assert NISN not in spy[0]


# ---------------------------------------------------------------- validator output
RES = Result("Ada 2 siswa di bawah KKM (78) di XII RPL 2 pada semester 5.", ["Nama", "Mapel", "Nilai", "KKM"],
             [["Aditya Ramadhan", "Matematika", 70, 78], ["Siti Aisyah", "Fisika", 75, 78]], ["nilai"])
Q = "siswa XII RPL 2 di bawah KKM semester 5"


@pytest.mark.parametrize("kandidat,harapan", [
    ("Aditya Ramadhan 70 dan Siti Aisyah 75 di bawah KKM 78.", True),
    ("Budi Santoso nilainya 70, di bawah KKM 78.", False),           # nama karangan
    ("Aditya Ramadhan nilainya 99.", False),                          # angka karangan
    ("Aditya Ramadhan nilainya tujuh puluh sembilan.", False),        # angka dalam kata
])
def test_validator(kandidat, harapan):
    assert compose.valid_output(kandidat, Q, RES) is harapan


def test_format_ribuan_indonesia():
    assert compose.numbers("1.200") == compose.numbers("1200")
    assert compose.numbers("80,50") == compose.numbers("80.5")


# ---------------------------------------------------------------- intent: Gemini tidak boleh menimpa teks guru
def _gemini_returns(monkeypatch, payload):
    monkeypatch.setattr(gemini, "enabled", lambda: True)
    monkeypatch.setattr(gemini, "generate", lambda *a, **k: json.dumps(payload))


def test_kelas_dan_semester_dari_teks_menang(monkeypatch):
    _gemini_returns(monkeypatch, {"intent": "siswa_di_bawah_kkm", "params": {"kelas": "XII RPL 3", "semester": 4}})
    intent, mode = intents.understand("Siswa XII RPL 2 yang di bawah KKM semester 5")
    assert mode == "gemini"
    assert intent["params"]["kelas"].upper().endswith("RPL-2") or intent["params"]["kelas"].endswith("2")
    assert intent["params"]["semester"] == 5


def test_nama_karangan_gemini_dibuang(monkeypatch):
    _gemini_returns(monkeypatch, {"intent": "nilai_siswa", "params": {"siswa": "Budi Santoso Wijaya"}})
    intent, _ = intents.understand("nilai Aditya")
    assert "siswa" not in intent["params"]


@pytest.mark.parametrize("params", [
    {"ambang": 99999999999}, {"ambang": -3}, {"semester": 9}, {"semester": True}, {"siswa": ["a", "b"]}, {"kelas": {"x": 1}},
])
def test_parameter_gemini_di_luar_batas_dibuang(monkeypatch, params):
    _gemini_returns(monkeypatch, {"intent": "siswa_alpha_tinggi", "params": params})
    intent, _ = intents.understand("alpha tinggi")
    for k in params:
        assert k not in intent["params"] or intent["params"][k] == intents.rule_intent("alpha tinggi")["params"].get(k)


# ---------------------------------------------------------------- Gemini: header kunci + circuit breaker
def test_kunci_di_header_bukan_url_dan_breaker_membuka(monkeypatch):
    import urllib.error
    import urllib.request

    monkeypatch.setattr(settings, "gemini_api_key", "KUNCI-RAHASIA")
    gemini.breaker.ok(); gemini.breaker._open_until = 0.0
    seen = []

    def boom(req, timeout=None):
        seen.append(req)
        raise urllib.error.URLError("down")

    monkeypatch.setattr(urllib.request, "urlopen", boom)
    for _ in range(gemini.FAILURE_THRESHOLD):
        assert gemini.generate("s", "p") is None
    assert "KUNCI-RAHASIA" not in seen[0].full_url
    assert seen[0].get_header("X-goog-api-key") == "KUNCI-RAHASIA"
    n = len(seen)
    assert gemini.generate("s", "p") is None and len(seen) == n  # sirkuit terbuka: tidak ada panggilan jaringan lagi
    gemini.breaker._open_until = 0.0


# ---------------------------------------------------------------- konfigurasi: secret placeholder ditolak
def test_jwt_secret_placeholder_ditolak(monkeypatch):
    import app.config as cfg

    asli = cfg.settings
    monkeypatch.setenv("JWT_SECRET", "ganti-dengan-string-acak-panjang")
    try:
        with pytest.raises(RuntimeError, match="placeholder"):
            importlib.reload(cfg)
    finally:
        monkeypatch.undo()
        importlib.reload(cfg)
        cfg.settings = asli  # modul lain memegang objek lama; jaga agar tetap satu objek


# ---------------------------------------------------------------- autentikasi: ganti sandi dipaksa di server
def test_active_user_menolak_sandi_sementara():
    with pytest.raises(Exception) as e:
        auth.active_user({"id": 1, "role": "teacher", "wajib_ganti_password": True})
    assert e.value.status_code == 403 and e.value.detail["code"] == "PASSWORD_CHANGE_REQUIRED"
    assert auth.active_user({"id": 1, "role": "teacher", "wajib_ganti_password": False})["id"] == 1


def test_validasi_sandi_baru():
    assert auth.validate_new_password("") is not None
    assert auth.validate_new_password("a" * 80) is not None
    assert auth.validate_new_password("1", "budi") is None
    assert auth.validate_new_password("Sandi-Kuat-2026!", "budi") is None


# ---------------------------------------------------------------- handler: salah-jawab senyap
def test_kelas_tidak_dikenal_tidak_menjawab_seluruh_sekolah(monkeypatch):
    monkeypatch.setattr(handlers, "mentions_unknown_kelas", lambda p: True)

    class Boom:
        def rows(self, *a, **k):
            raise AssertionError("query tidak boleh dijalankan")

    for fn in (handlers.siswa_di_bawah_kkm, handlers.siswa_alpha_tinggi):
        res = fn(Boom(), {}, "nilai XII RPL 9 di bawah KKM")
        assert res.butuh_klarifikasi and "tidak ada di data" in res.jawaban


def test_pkl_banyak_perusahaan_menyebut_perusahaan(monkeypatch):
    monkeypatch.setattr(handlers.resolver, "find_perusahaan",
                        lambda db, pesan, hint=None: [{"kode": "A", "nama": "PLN UP3"}, {"kode": "B", "nama": "PLN Icon Plus"}])

    class Db:
        def rows(self, sql, **p):
            return [{"nama": "Siti", "kelas": "XII RPL 1", "posisi": "Teknisi", "sesi": 1, "status": "Aktif"}]

    res = handlers.penempatan_pkl(Db(), {}, "siapa PKL di PLN")
    assert "Perusahaan" in res.kolom
    assert {r[res.kolom.index("Perusahaan")] for r in res.baris} == {"PLN UP3", "PLN Icon Plus"}
    assert "PLN UP3" not in res.jawaban  # tidak lagi menempelkan perusahaan pertama pada semua baris


@pytest.mark.parametrize("q,tingkat_ada", [
    ("Fasilitas apa yang sedang dibangun?", False),
    ("Apa sanksi untuk pelanggaran tingkat sedang?", True),
    ("Siapa yang keberatan dengan aturan seragam?", False),
])
def test_tingkat_pelanggaran_butuh_konteks(q, tingkat_ada, monkeypatch):
    monkeypatch.setattr(handlers.rag, "retrieve", lambda q, k=3: [("Tata tertib", "isi")])  # tanpa profil_sekolah.json

    class Db:
        def rows(self, sql, **p):
            return [{"kode": "P1", "nama": "Membolos", "tingkat": "Sedang", "poin": 30, "sanksi_disarankan": "Teguran"}] if "jenis_pelanggaran" in sql else []

    res = handlers.info_sekolah(Db(), {}, q)
    assert ("jenis_pelanggaran" in res.sumber) is tingkat_ada


# ---------------------------------------------------------------- engine: galat handler tidak menjatuhkan request
def test_answer_menangkap_galat_handler(monkeypatch):
    from contextlib import contextmanager

    @contextmanager
    def open_db():
        yield FakeDb()

    monkeypatch.setattr(gemini, "enabled", lambda: False)
    monkeypatch.setattr(handlers, "run", lambda *a, **k: (_ for _ in ()).throw(AttributeError("param Gemini bertipe salah")))
    out = engine_pkg.answer(open_db, "nilai Aditya")
    assert out["galat"] is True and out["butuh_klarifikasi"] is True and "kendala" in out["jawaban"]


# ---------------------------------------------------------------- API: audit tahan-gagal, CORS 500, envelope 404, admin
@pytest.fixture
def sqlite_env(monkeypatch):
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    with eng.begin() as c:
        c.execute(text("CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_id INT, aksi TEXT, pertanyaan TEXT, intent_json TEXT, tabel_diakses TEXT, status TEXT, waktu TEXT DEFAULT CURRENT_TIMESTAMP)"))
        c.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, nama TEXT, nip TEXT, role TEXT, password_hash TEXT, wajib_ganti_password INT DEFAULT 1, aktif INT DEFAULT 1, dibuat_pada TEXT)"))
        c.execute(text("INSERT INTO users (id, username, nama, role, password_hash, wajib_ganti_password) VALUES (1,'admin1','Admin Satu','admin','x',0),(2,'guru1','Guru Satu','teacher','x',0)"))
    # versi SQLite dari query yang memakai sintaks khusus PostgreSQL (CAST ... JSONB)
    monkeypatch.setattr(queries, "AUDIT_CHAT", "INSERT INTO audit_log (user_id, aksi, pertanyaan, intent_json, tabel_diakses, status) VALUES (:user_id, :aksi, :pertanyaan, :intent, :tabel, :status)")
    return eng


def _api(eng, monkeypatch, user):
    from app.api import admin_routes, chat_routes
    from app.db import get_conn

    monkeypatch.setattr(chat_routes, "db_engine", eng)
    chat_routes._hits.clear()
    app = FastAPI()
    app.include_router(chat_routes.router)
    app.include_router(admin_routes.router)

    def conn_override():
        with eng.begin() as conn:
            yield conn

    app.dependency_overrides[auth.active_user] = lambda: user
    app.dependency_overrides[auth.require_admin] = lambda: user
    app.dependency_overrides[get_conn] = conn_override
    return TestClient(app, raise_server_exceptions=False)


def _audit_rows(eng):
    with eng.connect() as c:
        return c.execute(text("SELECT aksi, status FROM audit_log ORDER BY id")).all()


def test_audit_tetap_tercatat_saat_engine_gagal(sqlite_env, monkeypatch):
    client = _api(sqlite_env, monkeypatch, {"id": 2, "role": "teacher"})
    monkeypatch.setattr(engine_pkg, "answer", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    assert client.post("/chat", json={"pesan": "pelanggaran Aditya"}).status_code == 500
    assert _audit_rows(sqlite_env) == [("chat", "error")]


def test_chat_sukses_tercatat_dan_rate_limit(sqlite_env, monkeypatch):
    client = _api(sqlite_env, monkeypatch, {"id": 2, "role": "teacher"})
    monkeypatch.setattr(settings, "chat_rate_per_minute", 2)
    monkeypatch.setattr(engine_pkg, "answer", lambda *a, **k: {
        "jawaban": "ok", "tabel": None, "sumber": ["pelanggaran"], "intent": {"intent": "pelanggaran_siswa", "params": {}},
        "mode": "aturan", "sensitif": True, "butuh_klarifikasi": False, "contoh": [], "galat": False})
    assert [client.post("/chat", json={"pesan": "x"}).status_code for _ in range(3)] == [200, 200, 429]
    assert _audit_rows(sqlite_env) == [("chat_data_sensitif", "ok")] * 2


def test_admin_tidak_bisa_menonaktifkan_diri_atau_admin_terakhir(sqlite_env, monkeypatch):
    client = _api(sqlite_env, monkeypatch, {"id": 1, "role": "admin"})
    assert client.patch("/users/1", json={"aktif": False}).status_code == 409
    with sqlite_env.begin() as c:  # admin kedua (aktif) -> menonaktifkan admin 1 oleh admin 2 diizinkan, tapi admin 2 terakhir tidak
        c.execute(text("INSERT INTO users (id, username, nama, role, password_hash, wajib_ganti_password) VALUES (3,'admin2','Admin Dua','admin','x',0)"))
    client2 = _api(sqlite_env, monkeypatch, {"id": 3, "role": "admin"})
    assert client2.patch("/users/1", json={"aktif": False}).status_code == 200
    r = _api(sqlite_env, monkeypatch, {"id": 1, "role": "admin"}).patch("/users/3", json={"aktif": False})
    assert r.status_code == 409 and "terakhir" in r.json()["detail"]["message"]


def test_reset_password_dicatat_tanpa_membocorkan_sandi(sqlite_env, monkeypatch):
    client = _api(sqlite_env, monkeypatch, {"id": 1, "role": "admin"})
    r = client.patch("/users/2", json={"reset_password": True})
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    with sqlite_env.connect() as c:
        row = c.execute(text("SELECT aksi, pertanyaan FROM audit_log")).one()
    assert row[0] == "admin_reset_password" and r.json()["password_baru"] not in row[1]


def test_main_404_berformat_dan_500_punya_header_cors(monkeypatch):
    from app import main

    @main.app.get("/_boom")
    def _boom():
        raise RuntimeError("x")

    c = TestClient(main.app, raise_server_exceptions=False)
    origin = {"Origin": settings.cors_origins[0]}
    r404 = c.get("/tidak-ada", headers=origin)
    assert r404.status_code == 404 and r404.json()["error"]["code"] == "ERROR"
    r500 = c.get("/_boom", headers=origin)
    assert r500.status_code == 500 and r500.json()["error"]["code"] == "INTERNAL"
    assert r500.headers.get("access-control-allow-origin") == origin["Origin"]
    assert r500.headers["cache-control"] == "no-store"

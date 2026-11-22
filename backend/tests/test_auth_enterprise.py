"""Uji kebijakan kata sandi NIST SP 800-63B Rev 4, generator sandi sementara, ganti username, dan foto profil avatar."""
import base64
import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import StaticPool

from app import auth
from app.api import admin_routes, auth_routes
from app.db import get_conn


def _make_png(size: int = 32) -> str:
    payload = b"\x89PNG\r\n\x1a\n" + (b"\x00" * max(8, size - 8))
    return "data:image/png;base64," + base64.b64encode(payload).decode("ascii")


def _make_jpeg(size: int = 32) -> str:
    payload = b"\xff\xd8\xff\xe0" + (b"\x00" * max(12, size - 4))
    return "data:image/jpeg;base64," + base64.b64encode(payload).decode("ascii")


def _make_webp(size: int = 32) -> str:
    payload = b"RIFF\x24\x00\x00\x00WEBP" + (b"\x00" * max(4, size - 12))
    return "data:image/webp;base64," + base64.b64encode(payload).decode("ascii")


def _setup_enterprise_db(monkeypatch, with_foto_col: bool = True):
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    foto_ddl = ", foto_profil TEXT" if with_foto_col else ""
    with eng.begin() as c:
        c.execute(
            text(
                "CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, nama TEXT, nip TEXT, "
                "role TEXT, password_hash TEXT, wajib_ganti_password INT DEFAULT 0, aktif INT DEFAULT 1, "
                f"token_version INT NOT NULL DEFAULT 1, token_exempt_jti TEXT, dibuat_pada TEXT{foto_ddl})"
            )
        )
        c.execute(
            text(
                "CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INT, aksi TEXT, "
                "pertanyaan TEXT, intent_json TEXT, tabel_diakses TEXT, status TEXT, "
                "waktu TEXT DEFAULT CURRENT_TIMESTAMP)"
            )
        )
        pw_hash = auth.hash_password("SandiAwal-2026!")
        c.execute(
            text(
                "INSERT INTO users (id, username, nama, role, password_hash, wajib_ganti_password, aktif, token_version) "
                "VALUES (1,'admin1','Admin Utama','admin',:h,0,1,1),"
                "(2,'guru1','Prof. Ina Suratma, S.Pd.','teacher',:h,0,1,1),"
                "(3,'guru_baru','Budi Santoso, M.Kom.','teacher',:h,1,1,1)"
            ),
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


# ---------------------------------------------------------------- NIST SP 800-63B Rev 4 Password Policy
@pytest.mark.parametrize(
    "pw",
    [
        "",
        "Ab1!xyz",  # < 8 karakter
        "kopi123",  # 7 karakter < 8
        "Ab1!" + ("a" * 69),  # 73 byte > MAX_PASSWORD_BYTES
        "Ab1!" + ("é" * 35),  # 74 byte UTF-8 > MAX_PASSWORD_BYTES
    ],
)
def test_password_policy_rejects_length_violations(pw):
    assert auth.validate_new_password(pw, username="userx", nama="Nama Uji") is not None


@pytest.mark.parametrize(
    "pw",
    [
        "kopipagi",  # 8 karakter sederhana, huruf kecil saja (NIST Rev 4: tanpa aturan kompleksitas)
        "Abcdef12",  # 8 karakter tanpa simbol
        "abcdef1!",  # 8 karakter tanpa huruf besar
        "ABCDEF1!",  # 8 karakter tanpa huruf kecil
        "Abcdef!@",  # 8 karakter tanpa angka
        "Abcdef 1",  # 8 karakter dengan spasi
        "hujan sore",  # passphrase dengan spasi, huruf kecil saja
        "meja kayu baru",  # passphrase multi-kata
        "Ab1!cd2@",  # 8 karakter, 4 kelas
        "Ab1!" + ("a" * 68),  # tepat 72 byte
        "Passphrase2026",  # passphrase dengan angka
        "sandi aman 2026!",  # passphrase dengan spasi & simbol
        "KopiPagi!Hangat",  # passphrase campuran
    ],
)
def test_password_policy_accepts_compliant_passwords(pw):
    assert auth.validate_new_password(pw, username="userx", nama="Nama Uji") is None


@pytest.mark.parametrize(
    "pw",
    [
        "aaaaaaaa",  # karakter tunggal berulang
        "AAAAAAAA",  # kapital tunggal berulang
        "AaAaAaAa",  # tunggal case-insensitive
        "11111111",  # digit tunggal berulang
        "!!!!!!!!",  # simbol tunggal berulang
        "        ",  # spasi berulang
        "abababab",  # pola 2 karakter berulang
        "12121212",  # pola 2 digit berulang
        "abcabcab",  # pola 3 karakter berulang
        "12345678",  # urutan angka naik
        "23456789",  # urutan angka naik
        "87654321",  # urutan angka turun
        "9876543210",  # urutan angka turun panjang
        "abcdefgh",  # urutan alfabet naik
        "ABCDEFGH",  # urutan alfabet naik kapital
        "abcdefghijkl",  # urutan alfabet panjang
        "hgfedcba",  # urutan alfabet turun
        "zyxwvuts",  # urutan alfabet turun dari z
        "qwertyui",  # urutan keyboard baris atas
        "qwertyuiop",  # urutan keyboard penuh
        "poiuytre",  # urutan keyboard terbalik
        "asdfghjk",  # urutan keyboard baris tengah
        "lkjhgfds",  # urutan keyboard baris tengah terbalik
        "!@#$%^&*",  # urutan simbol baris angka
        "12345678!",  # memuat urutan 8 digit
        "Abcdefgh1",  # memuat urutan 8 huruf
    ],
)
def test_password_policy_rejects_repetitive_and_sequential(pw):
    assert auth.validate_new_password(pw, username="userx", nama="Nama Uji") is not None


@pytest.mark.parametrize(
    "weak_pw",
    [
        "password",
        "Password123",
        "Password123!",
        "12345678",
        "123456789",
        "qwertyui",
        "Qwerty123",
        "Qwerty123!",
        "Admin123",
        "Admin123!",
        "Indonesia",
        "indonesia123",
        "Bandung123",
        "bandung ",
        "SMKN4Bandung",
        "smkn4bdg",
        "smkn42026",
        "Welcome123",
        "Letmein123",
        "Rahasia123",
        "rahasia ",
        "Bismillah",
        "bismillah123",
        "Sekolah123",
        "persib123",
    ],
)
def test_password_policy_blocks_common_weak_passwords(weak_pw):
    assert auth.validate_new_password(weak_pw) is not None


def test_common_weak_passwords_contains_school_and_indonesian_terms():
    for term in ("indonesia", "bandung", "smkn4", "rahasia", "bismillah", "qwertyui", "12345678", "password", "admin123"):
        assert term in auth._COMMON_WEAK_PASSWORDS


@pytest.mark.parametrize(
    "uname,valid",
    [
        ("abc", True),
        ("guru.xii_1", True),
        ("A" * 30, True),
        ("admin1", True),
        ("admin2", True),
        ("admin3", True),
        ("guru01", True),
        ("guru10", True),
        ("alijauhari", True),
        ("", False),
        ("ab", False),
        ("a" * 31, False),
        ("a-b", False),
        ("guru.rpl_01-bdg", False),
        (".abc", False),
        ("abc.", False),
        ("...", False),
        ("a..b", False),
        ("guru 1", False),
        ("guru@smk", False),
        ("guru/1", False),
        ("guru\n123", False),
        ("abc\n", False),
    ],
)
def test_validate_username(uname, valid):
    res = auth.validate_username(uname)
    assert (res is None) is valid
    if not valid:
        assert isinstance(res, str) and len(res) > 0
        assert not re.search(r"[\U0001F300-\U0001FAFF\u2600-\u27BF]", res)


def test_admin_dan_auth_username_instagram_rules(monkeypatch):
    eng, client = _setup_enterprise_db(monkeypatch)
    tok_admin = client.post("/auth/login", json={"username": "admin1", "password": "SandiAwal-2026!"}).json()["access_token"]
    tok_guru = client.post("/auth/login", json={"username": "guru1", "password": "SandiAwal-2026!"}).json()["access_token"]
    hdr_admin = {"Authorization": f"Bearer {tok_admin}"}
    hdr_guru = {"Authorization": f"Bearer {tok_guru}"}

    invalid_cases = ["ab", "a" * 31, "a-b", ".abc", "abc.", "a..b", "guru 1"]
    for bad in invalid_cases:
        # POST /users (admin_routes)
        r_admin = client.post(
            "/users",
            json={"username": bad, "nama": "User Uji", "role": "teacher"},
            headers=hdr_admin,
        )
        assert r_admin.status_code == 422, f"POST /users seharusnya menolak {bad!r}"
        if 3 <= len(bad) <= 30:
            assert r_admin.json()["detail"]["code"] == "VALIDATION_ERROR"

        # GET /auth/cek-username
        r_chk = client.get("/auth/cek-username", params={"username": bad}, headers=hdr_guru)
        assert r_chk.status_code == 200
        assert r_chk.json()["available"] is False and r_chk.json()["reason"]

        # PATCH /auth/username
        r_patch = client.patch(
            "/auth/username",
            json={"username_baru": bad, "password_saat_ini": "SandiAwal-2026!"},
            headers=hdr_guru,
        )
        assert r_patch.status_code == 422, f"PATCH /auth/username seharusnya menolak {bad!r}"
        assert r_patch.json()["detail"]["code"] == "VALIDATION_ERROR"

    # Username valid: guru.xii_1 & tepat 30 karakter diterima di admin maupun self-service
    u30_admin = "u" * 30
    u30_guru = "v" * 30
    for ok_admin in ("guru.xii_1", u30_admin):
        r_ok = client.post(
            "/users",
            json={"username": ok_admin, "nama": "User Valid", "role": "teacher"},
            headers=hdr_admin,
        )
        assert r_ok.status_code == 201 and r_ok.json()["username"] == ok_admin

    for ok_guru in ("guru.xii_2", u30_guru):
        r_chk_ok = client.get("/auth/cek-username", params={"username": ok_guru}, headers=hdr_guru)
        assert r_chk_ok.status_code == 200 and r_chk_ok.json() == {"available": True, "reason": None}
        r_patch_ok = client.patch(
            "/auth/username",
            json={"username_baru": ok_guru, "password_saat_ini": "SandiAwal-2026!"},
            headers=hdr_guru,
        )
        assert r_patch_ok.status_code == 200 and r_patch_ok.json()["username"] == ok_guru

    # Verifikasi main.app envelope VALIDATION_ERROR untuk semua kasus tidak valid di POST /api/v1/users
    from app import main

    def _main_conn():
        with eng.begin() as conn:
            yield conn

    prev_overrides = dict(main.app.dependency_overrides)
    main.app.dependency_overrides[auth.require_admin] = lambda: {"id": 1, "username": "admin1", "role": "admin"}
    main.app.dependency_overrides[get_conn] = _main_conn
    main_client = TestClient(main.app, raise_server_exceptions=False)
    try:
        for bad in invalid_cases:
            r_main = main_client.post(
                "/api/v1/users",
                json={"username": bad, "nama": "User Uji", "role": "teacher"},
            )
            assert r_main.status_code == 422
            assert r_main.json()["error"]["code"] == "VALIDATION_ERROR"
    finally:
        main.app.dependency_overrides.clear()
        main.app.dependency_overrides.update(prev_overrides)


def test_password_policy_username_and_nama_tokens_with_academic_titles():
    # Username >= 3 ditolak case-insensitive; < 3 diabaikan aturan username
    assert auth.validate_new_password("Sandi_GURU1_2026!", username="guru1") is not None
    assert auth.validate_new_password("Sandi_ab_2026!", username="ab") is None

    # Token nama >= 4 ditolak, gelar akademik & token < 4 dikecualikan
    nama = "Prof. Ina Suratma, S.Pd., M.Pd., S.Kom., S.ST., M.Hum., M.Kom., S.Ag., S.Sn., S.Or., S.Kep., Drs., Dra."
    assert auth.validate_new_password("SandiSuratma2026!", username="u01", nama=nama) is not None
    assert auth.validate_new_password("SandiIna!2026", username="u01", nama=nama) is None  # "Ina" panjang 3
    assert auth.validate_new_password("ProfSandi!2026", username="u01", nama=nama) is None  # "Prof" gelar
    assert auth.validate_new_password("S.Pd-Kuat-2026", username="u01", nama=nama) is None  # "S.Pd" gelar
    assert auth.validate_new_password("M.Kom-Kuat-2026", username="u01", nama=nama) is None  # "M.Kom" gelar
    assert auth.validate_new_password("DrsDra-Kuat-2026", username="u01", nama=nama) is None  # Drs/Dra gelar


def test_new_password_generator_meets_policy():
    for _ in range(100):
        pw = auth.new_password()
        assert len(pw) == 12
        assert re.search(r"[a-z]", pw)
        assert re.search(r"[A-Z]", pw)
        assert re.search(r"[0-9]", pw)
        assert any(c in "!@#$%&*" for c in pw)
        assert auth.validate_new_password(pw) is None


# ---------------------------------------------------------------- Same-password & nama check in /auth/ganti-password
def test_ganti_password_rejects_same_password_and_nama_token(monkeypatch):
    _, client = _setup_enterprise_db(monkeypatch)
    tok = client.post("/auth/login", json={"username": "guru1", "password": "SandiAwal-2026!"}).json()["access_token"]
    hdr = {"Authorization": f"Bearer {tok}"}

    # Sandi baru mengandung token nama ("suratma") -> 422
    r_nama = client.post(
        "/auth/ganti-password",
        json={"password_lama": "SandiAwal-2026!", "password_baru": "SuratmaKuat-2026!"},
        headers=hdr,
    )
    assert r_nama.status_code == 422

    # Sandi baru sama dengan sandi saat ini -> 422 dengan pesan tepat
    r_same = client.post(
        "/auth/ganti-password",
        json={"password_lama": "SandiAwal-2026!", "password_baru": "SandiAwal-2026!"},
        headers=hdr,
    )
    assert r_same.status_code == 422
    assert r_same.json()["detail"]["code"] == "VALIDATION_ERROR"
    assert r_same.json()["detail"]["message"] == "Kata sandi baru tidak boleh sama dengan kata sandi saat ini."

    # Sandi lama salah meski sandi baru sama -> tetap 400 (tidak membocorkan kecocokan sandi saat ini)
    r_wrong_old = client.post(
        "/auth/ganti-password",
        json={"password_lama": "Salah-2026!", "password_baru": "SandiAwal-2026!"},
        headers=hdr,
    )
    assert r_wrong_old.status_code == 400

    # Sandi urutan sederhana ditolak -> 422
    r_seq = client.post(
        "/auth/ganti-password",
        json={"password_lama": "SandiAwal-2026!", "password_baru": "87654321"},
        headers=hdr,
    )
    assert r_seq.status_code == 422

    # Sandi sederhana 8 karakter tanpa simbol/kapital diterima (NIST SP 800-63B Rev 4)
    r_simple = client.post(
        "/auth/ganti-password",
        json={"password_lama": "SandiAwal-2026!", "password_baru": "kopipagi"},
        headers=hdr,
    )
    assert r_simple.status_code == 200


# ---------------------------------------------------------------- Self-Service Change Username
def test_cek_username_and_patch_username_flow(monkeypatch):
    eng, client = _setup_enterprise_db(monkeypatch)
    tok_guru = client.post("/auth/login", json={"username": "guru1", "password": "SandiAwal-2026!"}).json()["access_token"]
    tok_temp = client.post("/auth/login", json={"username": "guru_baru", "password": "SandiAwal-2026!"}).json()["access_token"]
    hdr_guru = {"Authorization": f"Bearer {tok_guru}"}
    hdr_temp = {"Authorization": f"Bearer {tok_temp}"}

    # Tanpa token -> 401; akun wajib_ganti_password -> 403
    assert client.get("/auth/cek-username?username=baru_ok").status_code == 401
    assert client.patch("/auth/username", json={"username_baru": "baru_ok", "password_saat_ini": "SandiAwal-2026!"}).status_code == 401
    assert client.get("/auth/cek-username?username=baru_ok", headers=hdr_temp).status_code == 403
    assert client.patch(
        "/auth/username",
        json={"username_baru": "baru_ok", "password_saat_ini": "SandiAwal-2026!"},
        headers=hdr_temp,
    ).status_code == 403

    # GET /auth/cek-username: format tidak valid
    r_short = client.get("/auth/cek-username?username=ab", headers=hdr_guru)
    assert r_short.status_code == 200 and r_short.json()["available"] is False and r_short.json()["reason"]

    r_badchars = client.get("/auth/cek-username?username=guru@smk", headers=hdr_guru)
    assert r_badchars.status_code == 200 and r_badchars.json()["available"] is False and r_badchars.json()["reason"]

    # GET /auth/cek-username: sama dengan username sendiri (case-insensitive)
    for own in ("guru1", "GURU1"):
        r_own = client.get(f"/auth/cek-username?username={own}", headers=hdr_guru)
        assert r_own.status_code == 200
        assert r_own.json() == {
            "available": False,
            "reason": "Username ini sudah menjadi username Anda saat ini.",
        }

    # GET /auth/cek-username: sudah dipakai akun lain (case-insensitive)
    r_taken = client.get("/auth/cek-username?username=ADMIN1", headers=hdr_guru)
    assert r_taken.status_code == 200
    assert r_taken.json()["available"] is False
    assert "akun lain" in r_taken.json()["reason"]

    # GET /auth/cek-username: tersedia
    r_avail = client.get("/auth/cek-username?username=ina.suratma_01", headers=hdr_guru)
    assert r_avail.status_code == 200
    assert r_avail.json() == {"available": True, "reason": None}

    # PATCH /auth/username: karakter tidak valid -> 422
    r_inv = client.patch(
        "/auth/username",
        json={"username_baru": "ina suratma!", "password_saat_ini": "SandiAwal-2026!"},
        headers=hdr_guru,
    )
    assert r_inv.status_code == 422
    assert r_inv.json()["detail"]["code"] == "VALIDATION_ERROR"

    # PATCH /auth/username: password saat ini salah -> 400
    r_badpw = client.patch(
        "/auth/username",
        json={"username_baru": "ina.suratma_01", "password_saat_ini": "SalahBanget123"},
        headers=hdr_guru,
    )
    assert r_badpw.status_code == 400
    assert r_badpw.json()["detail"]["code"] == "BAD_REQUEST"
    assert r_badpw.json()["detail"]["message"] == "Kata sandi saat ini salah."

    # PATCH /auth/username: sama dengan username saat ini (case-insensitive) -> 422
    r_same = client.patch(
        "/auth/username",
        json={"username_baru": "GURU1", "password_saat_ini": "SandiAwal-2026!"},
        headers=hdr_guru,
    )
    assert r_same.status_code == 422
    assert r_same.json()["detail"]["message"] == "Username baru harus berbeda dari username saat ini."

    # PATCH /auth/username: konflik case-insensitive dengan akun lain -> 409
    r_conflict = client.patch(
        "/auth/username",
        json={"username_baru": "Admin1", "password_saat_ini": "SandiAwal-2026!"},
        headers=hdr_guru,
    )
    assert r_conflict.status_code == 409
    assert r_conflict.json()["detail"]["code"] == "CONFLICT"
    assert r_conflict.json()["detail"]["message"] == "Username sudah digunakan oleh akun lain."

    # PATCH /auth/username: sukses (dengan trim spasi), sesi lama tetap valid, audit tercatat
    r_ok = client.patch(
        "/auth/username",
        json={"username_baru": "  ina.suratma_01  ", "password_saat_ini": "SandiAwal-2026!"},
        headers=hdr_guru,
    )
    assert r_ok.status_code == 200
    body = r_ok.json()
    assert body["id"] == 2
    assert body["username"] == "ina.suratma_01"
    assert "wali_kelas" in body and "dibuat_pada" in body

    # Token JWT lama (sub=2) tetap aktif dan /auth/me mengembalikan username baru
    r_me = client.get("/auth/me", headers=hdr_guru)
    assert r_me.status_code == 200 and r_me.json()["username"] == "ina.suratma_01"

    # Login memakai username lama gagal, username baru berhasil
    assert client.post("/auth/login", json={"username": "guru1", "password": "SandiAwal-2026!"}).status_code == 401
    assert client.post("/auth/login", json={"username": "ina.suratma_01", "password": "SandiAwal-2026!"}).status_code == 200

    # Audit log mencatat aksi='ganti_username', pertanyaan='guru1 -> ina.suratma_01', tabel_diakses='users'
    with eng.connect() as c:
        row = c.execute(
            text(
                "SELECT aksi, pertanyaan, tabel_diakses, status FROM audit_log "
                "WHERE user_id = 2 AND aksi = 'ganti_username' ORDER BY id DESC LIMIT 1"
            )
        ).one()
    assert row == ("ganti_username", "guru1 -> ina.suratma_01", "users", "ok")


def test_patch_username_handles_integrity_error_race(monkeypatch):
    eng, _ = _setup_enterprise_db(monkeypatch)

    class _RaceConn:
        def __init__(self, real_conn):
            self._conn = real_conn

        def execute(self, stmt, params=None):
            if "UPDATE users SET username" in str(stmt):
                raise IntegrityError("UPDATE users", params, Exception("UNIQUE constraint failed"))
            return self._conn.execute(stmt, params or {})

    with eng.begin() as c:
        with pytest.raises(auth_routes.HTTPException) as exc_info:
            auth_routes.ubah_username(
                auth_routes.UsernamePatchIn(username_baru="baru_race", password_saat_ini="SandiAwal-2026!"),
                user={"id": 2, "username": "guru1", "nama": "Prof. Ina Suratma, S.Pd.", "nip": None, "role": "teacher", "wajib_ganti_password": 0},
                conn=_RaceConn(c),
            )
    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "CONFLICT"
    assert exc_info.value.detail["message"] == "Username sudah digunakan oleh akun lain."


# ---------------------------------------------------------------- Profile Photo API & backward compatibility
def test_minimal_sqlite_users_without_foto_col_still_works(monkeypatch):
    eng, client = _setup_enterprise_db(monkeypatch, with_foto_col=False)
    with eng.connect() as c:
        assert auth.user_has_foto_col(c) is False

    r_login = client.post("/auth/login", json={"username": "admin1", "password": "SandiAwal-2026!"})
    assert r_login.status_code == 200
    assert r_login.json()["user"]["foto_profil"] is None
    hdr = {"Authorization": f"Bearer {r_login.json()['access_token']}"}

    r_me = client.get("/auth/me", headers=hdr)
    assert r_me.status_code == 200 and r_me.json()["foto_profil"] is None

    r_users = client.get("/users", headers=hdr)
    assert r_users.status_code == 200
    assert all(u["foto_profil"] is None for u in r_users.json()["data"])


def test_foto_profil_upload_delete_validation_and_propagation(monkeypatch):
    eng, client = _setup_enterprise_db(monkeypatch, with_foto_col=True)
    with eng.connect() as c:
        assert auth.user_has_foto_col(c) is True

    tok_admin = client.post("/auth/login", json={"username": "admin1", "password": "SandiAwal-2026!"}).json()["access_token"]
    tok_guru = client.post("/auth/login", json={"username": "guru1", "password": "SandiAwal-2026!"}).json()["access_token"]
    tok_temp = client.post("/auth/login", json={"username": "guru_baru", "password": "SandiAwal-2026!"}).json()["access_token"]
    hdr_admin = {"Authorization": f"Bearer {tok_admin}"}
    hdr_guru = {"Authorization": f"Bearer {tok_guru}"}
    hdr_temp = {"Authorization": f"Bearer {tok_temp}"}

    # Akun wajib_ganti_password ditolak 403
    assert client.post("/auth/foto-profil", json={"foto_profil": _make_png()}, headers=hdr_temp).status_code == 403
    assert client.delete("/auth/foto-profil", headers=hdr_temp).status_code == 403

    # PNG, JPEG, dan WebP diterima & dikanonisasi (spasi di base64 dibersihkan)
    png_uri = _make_png()
    png_with_ws = png_uri.replace("base64,", "base64,\n  ") + "\n"
    r_png = client.post("/auth/foto-profil", json={"foto_profil": png_with_ws}, headers=hdr_guru)
    assert r_png.status_code == 200 and r_png.json()["foto_profil"] == png_uri

    jpeg_uri = _make_jpeg()
    r_jpeg = client.post("/auth/foto-profil", json={"foto_profil": jpeg_uri}, headers=hdr_guru)
    assert r_jpeg.status_code == 200 and r_jpeg.json()["foto_profil"] == jpeg_uri

    webp_uri = _make_webp()
    r_webp = client.post("/auth/foto-profil", json={"foto_profil": webp_uri}, headers=hdr_guru)
    assert r_webp.status_code == 200 and r_webp.json()["foto_profil"] == webp_uri

    # Muncul di /auth/me, /auth/login, dan GET /users
    assert client.get("/auth/me", headers=hdr_guru).json()["foto_profil"] == webp_uri
    r_login2 = client.post("/auth/login", json={"username": "guru1", "password": "SandiAwal-2026!"})
    assert r_login2.json()["user"]["foto_profil"] == webp_uri
    users_by_name = {u["username"]: u for u in client.get("/users", headers=hdr_admin).json()["data"]}
    assert users_by_name["guru1"]["foto_profil"] == webp_uri
    assert users_by_name["admin1"]["foto_profil"] is None

    # Hapus foto profil -> NULL lagi
    r_del = client.delete("/auth/foto-profil", headers=hdr_guru)
    assert r_del.status_code == 200 and r_del.json()["foto_profil"] is None
    assert client.get("/auth/me", headers=hdr_guru).json()["foto_profil"] is None
    users_after = {u["username"]: u for u in client.get("/users", headers=hdr_admin).json()["data"]}
    assert users_after["guru1"]["foto_profil"] is None

    # Audit log mencatat ubah_foto_profil & hapus_foto_profil tanpa menyimpan payload gambar
    with eng.connect() as c:
        logs = c.execute(
            text("SELECT aksi, pertanyaan FROM audit_log WHERE user_id = 2 ORDER BY id")
        ).all()
    aksis = [row[0] for row in logs]
    assert "ubah_foto_profil" in aksis and "hapus_foto_profil" in aksis
    assert all("data:image" not in (row[1] or "") for row in logs)


@pytest.mark.parametrize(
    "bad_uri",
    [
        "data:image/svg+xml;base64," + base64.b64encode(b"<svg xmlns='http://www.w3.org/2000/svg'></svg>").decode(),
        "data:image/gif;base64," + base64.b64encode(b"GIF89a" + b"\x00" * 20).decode(),
        "data:text/html;base64," + base64.b64encode(b"<script>alert(1)</script>").decode(),
        "https://example.com/avatar.png",
        "data:image/png;base64,!!!bukan_base64!!!",
        "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n123").decode(),  # < 16 byte
        "data:image/png;base64," + base64.b64encode(b"<svg>palsu_png_bytes</svg>").decode(),  # magic bytes salah
        "data:image/jpeg;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 20).decode(),  # PNG berlabel JPEG
        "data:image/webp;base64," + base64.b64encode(b"RIFF\x24\x00\x00\x00AVI " + b"\x00" * 20).decode(),  # bukan WEBP
        "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"A" * 460_000).decode(),  # > 600_000 char URI
    ],
)
def test_foto_profil_rejects_invalid_or_spoofed_payloads(monkeypatch, bad_uri):
    _, client = _setup_enterprise_db(monkeypatch, with_foto_col=True)
    tok = client.post("/auth/login", json={"username": "guru1", "password": "SandiAwal-2026!"}).json()["access_token"]
    r = client.post(
        "/auth/foto-profil",
        json={"foto_profil": bad_uri},
        headers={"Authorization": f"Bearer {tok}"},
    )
    assert r.status_code == 422

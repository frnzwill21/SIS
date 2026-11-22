"""Uji Hybrid Query Engine terhadap dataset bersih nyata (SQLite sebagai pengganti PostgreSQL).

Jalankan dari folder backend/:   python tests/test_engine.py
Tidak butuh PostgreSQL, FastAPI, maupun Gemini (memakai mode aturan).
"""
import csv
import os
import sqlite3
import sys
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://x:x@localhost/x")
os.environ["JWT_SECRET"] = "x" * 8 + "Rb7!kQ2#vZ9pLm4$Tn6&Wd1^Hs3*Fg5("
os.environ["GEMINI_API_KEY"] = ""  # paksa mode aturan

from app import engine  # noqa: E402
from app.engine.compose import valid_output  # noqa: E402
from app.engine.core import Result, bound, plain  # noqa: E402
from app.engine.parsing import (  # noqa: E402
    mentions_all_scope,
    normalize_kelas,
    parse_ambang,
    parse_limit,
    parse_semester,
    parse_tingkat_pelanggaran,
    parse_urutan,
)

ORDER = ("jurusan guru mapel_jadwal mapel_rapor periode_akademik jenis_pelanggaran predikat_ekskul sesi_pkl kelas guru_mapel "
         "pemetaan_mapel siswa ekstrakurikuler pembina_ekskul perusahaan_pkl nilai kehadiran pelanggaran partisipasi_ekskul "
         "jadwal_pelajaran penempatan_pkl").split()


class SqliteDb:
    def __init__(self) -> None:
        self.c = sqlite3.connect(":memory:")
        self.c.row_factory = sqlite3.Row
        self.c.executescript((ROOT / "database/init/01_schema.sql").read_text(encoding="utf-8"))
        for t in ORDER:
            rows = list(csv.reader((ROOT / f"database/dataset_bersih/{t}.csv").open(encoding="utf-8")))
            h = rows[0]
            self.c.executemany(f"INSERT INTO {t} ({','.join(h)}) VALUES ({','.join('?' * len(h))})", rows[1:])

    def rows(self, sql, **params):
        cur = self.c.execute(sql.replace(" ILIKE ", " LIKE "), bound(sql, params))
        return [{k: plain(v) for k, v in dict(r).items()} for r in cur.fetchall()]


db = SqliteDb()
fail = 0


@contextmanager
def open_db():
    yield db


def check(cond: bool, label: str) -> None:
    global fail
    if not cond:
        fail += 1
    print(("  ok   " if cond else "  GAGAL ") + label)


def ask(q: str, role: str = "admin", history=None) -> dict:
    r = engine.answer(open_db, q, role=role, history=history)
    assert r["mode"] in ("ai", "lokal"), f"mode tidak valid: {r['mode']}"
    for step in r.get("jejak_pikir", []):
        assert step["detail"] == [], f"detail jejak_pikir harus kosong: {step}"
        teks_trace = f"{step['judul']} {step['ringkasan']}".lower()
        assert all(tok not in teks_trace for tok in ("gemini", "sql", "rbac", "ranking_kelas")), f"jargon di trace: {step}"
    print(f"\nQ: {q}\n   intent={r['intent']['intent']} params={r['intent']['params']}\n   A: {r['jawaban'][:230]}")
    return r


print("== parsing")
check(normalize_kelas("XII TITL 6") == "XII-TITL-6" and normalize_kelas("titl6") == "XII-TITL-6", "normalisasi kelas")
check(normalize_kelas("XII TITL 9") is None, "kelas tidak ada -> None")
check(parse_semester("semester 5") == 5 and parse_semester("semester lalu") == 4 and parse_semester("halo") == 0, "semester")
check(parse_ambang("alpha lebih dari 5 hari") == 6 and parse_ambang("alpha minimal 3") == 3, "ambang alpha")
check(parse_limit("saya butuh 3 murid") == 3 and parse_limit("top 5 siswa") == 5 and parse_limit("99 siswa") == 40, "parse_limit")
check(
    parse_tingkat_pelanggaran("pelanggaran berat") == "Berat"
    and parse_tingkat_pelanggaran("Fasilitas apa yang sedang dibangun?") == "",
    "parse_tingkat_pelanggaran",
)
check(parse_urutan("nilai terendah") == "asc" and parse_urutan("nilai terbaik") == "desc", "parse_urutan")
check(mentions_all_scope("di seluruh kelas") and not mentions_all_scope("XII RPL 1"), "mentions_all_scope")

print("\n== intent dan jawaban")
r = ask("Siapa wali kelas XII TITL 6?")
check(r["intent"]["intent"] == "info_wali_kelas" and "Ina Suratma" in r["jawaban"], "wali kelas TITL 6")
r = ask("Siswa XII RPL 2 yang nilainya di bawah KKM semester 5")
check(r["intent"]["intent"] == "siswa_di_bawah_kkm" and r["tabel"] is not None, "di bawah KKM")
r = ask("Siapa saja yang alpha lebih dari 5 hari semester ini?")
check(r["intent"]["intent"] == "siswa_alpha_tinggi" and r["intent"]["params"].get("ambang") == 6, "alpha tinggi")
r = ask("Di mana Aditya Ramadhan PKL?")
check(r["intent"]["intent"] == "penempatan_pkl" and "PLN" in r["jawaban"], "PKL siswa")
r = ask("Apa sanksi untuk pelanggaran tingkat sedang?")
check(r["intent"]["intent"] == "info_sekolah" and r["tabel"] is not None, "sanksi tingkat sedang")
r = ask("ranking nilai XII RPL 1 semester 5")
check(r["intent"]["intent"] == "ranking_kelas" and len(r["tabel"]["baris"]) == 10, "ranking kelas")
r = ask("nilai matematika Aditya Ramadhan")
check(r["intent"]["intent"] == "nilai_siswa" and r["tabel"] is not None, "nilai mapel siswa")
r = ask("kehadiran XII TOI 3 semester 5")
check(r["intent"]["intent"] == "rekap_kehadiran" and r["tabel"] is not None, "kehadiran kelas")
r = ask("jadwal XII TITL 6 hari Senin")
check(r["intent"]["intent"] == "jadwal_kelas" and len(r["tabel"]["baris"]) == 2, "jadwal kelas per hari")
r = ask("apa visi dan misi sekolah?")
check(r["intent"]["intent"] == "info_sekolah" and "visi" in r["jawaban"].lower(), "RAG visi misi")
r = ask("ada ekskul apa saja?")
check(r["intent"]["intent"] == "info_ekskul" and len(r["tabel"]["baris"]) == 19, "daftar ekskul")
r = ask("siapa anggota ekskul Pramuka semester 5")
check(r["intent"]["intent"] == "info_ekskul" and "Pramuka" in r["jawaban"], "anggota ekskul")
r = ask("siapa saja PKL di PLN?")
check(r["intent"]["intent"] == "penempatan_pkl" and r["tabel"] is not None, "PKL per perusahaan")
r = ask("pelanggaran XII RPL 1")
check(r["sensitif"] is True, "pelanggaran kelas ditandai sensitif")

print("\n== SQL Engine v2 analitik, sapaan, multi-turn & RBAC")
r = ask("hai")
check(r["intent"]["intent"] == "sapaan" and not r["butuh_klarifikasi"] and r["contoh"] == [], "sapaan fast-path")
r = ask("saya butuh 3 murid yang melakukan pelanggaran berat", role="admin")
check(
    r["intent"]["intent"] == "pelanggaran_siswa"
    and r["sensitif"] is True
    and r["tabel"] is not None
    and len(r["tabel"]["baris"]) == 3
    and not r["butuh_klarifikasi"],
    "3 murid pelanggaran berat (admin)",
)
r_teacher = ask("saya butuh 3 murid yang melakukan pelanggaran berat", role="teacher")
check(r_teacher.get("ditolak") is True and r_teacher["tabel"] is None and r_teacher["sumber"] == [], "3 murid pelanggaran berat ditolak untuk teacher")
r = ask("berikan saya data 3 murid dengan nilai terbaik di seluruh kelas")
check(
    r["intent"]["intent"] == "ranking_kelas"
    and r["tabel"] is not None
    and len(r["tabel"]["baris"]) == 3
    and "Kelas" in r["tabel"]["kolom"]
    and not r["butuh_klarifikasi"],
    "3 murid nilai terbaik seluruh kelas",
)
r = ask("berapa jumlah siswa per jurusan?")
check(
    r["intent"]["intent"] == "statistik_sekolah"
    and r["tabel"] is not None
    and len(r["tabel"]["baris"]) == 5
    and "612" in r["jawaban"],
    "statistik jumlah siswa per jurusan",
)
r = ask("siapa saja guru Matematika?")
check(r["intent"]["intent"] == "jadwal_guru" and r["tabel"] is not None and len(r["tabel"]["baris"]) >= 1, "guru by mapel")
r = ask("daftar mitra PKL untuk jurusan RPL")
check(r["tabel"] is not None and len(r["tabel"]["baris"]) >= 5 and not r["butuh_klarifikasi"], "mitra PKL by jurusan")
r = ask("rata-rata nilai per jurusan semester 5")
check(r["tabel"] is not None and len(r["tabel"]["baris"]) == 5 and not r["butuh_klarifikasi"], "rata-rata nilai per jurusan")

hist = [
    {"role": "user", "konten": "ranking nilai XII RPL 1 semester 5"},
    {"role": "ai", "konten": "ok", "intent": {"intent": "ranking_kelas", "params": {"kelas": "XII-RPL-1", "semester": 5, "urutan": "desc"}}},
]
r_follow = ask("kalau semester 4?", history=hist)
check(
    r_follow["intent"]["intent"] == "ranking_kelas"
    and r_follow["intent"]["params"].get("kelas") == "XII-RPL-1"
    and r_follow["intent"]["params"].get("semester") == 4
    and r_follow["tabel"] is not None,
    "multi-turn follow-up semester",
)

print("\n== penanganan kasus khusus")
r = ask("nilai siswa kelas XI RPL 1")
check(r["intent"]["intent"] == "di_luar_cakupan", "kelas XI di luar cakupan")
r = ask("wali kelas XII TITL 9")
check("tidak ada" in r["jawaban"].lower() and r["butuh_klarifikasi"], "kelas tidak ada")
r = ask("nilai Budi")
check(r["butuh_klarifikasi"] or r["tabel"] is not None, "nama ambigu / tidak ketemu ditangani")
r = ask("lorem ipsum", role="teacher")
check(
    r["butuh_klarifikasi"]
    and 1 <= len(r["contoh"]) <= 3
    and all("pelanggaran" not in c.lower() for c in r["contoh"]),
    "pertanyaan tidak dikenali -> klarifikasi + smart suggestions RBAC-safe",
)

print("\n== validator output Gemini")
res = Result("Rata-rata 80,5 dari 13 mapel.", ["a"], [[77]])
check(valid_output("Rata-ratanya 80,5 dari 13 mapel.", "nilai?", res), "angka sesuai data diterima")
check(not valid_output("Rata-ratanya 91 dari 13 mapel.", "nilai?", res), "angka karangan ditolak")

print(f"\n{'SEMUA UJI LOLOS' if not fail else str(fail) + ' UJI GAGAL'}")
sys.exit(1 if fail else 0)

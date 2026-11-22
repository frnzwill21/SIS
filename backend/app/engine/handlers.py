"""Satu fungsi per intent: menjalankan query tetap dan membuat jawaban baku (template) + tabel.

Jawaban baku ini selalu benar terhadap data; Gemini (bila aktif) hanya boleh merangkainya ulang dan hasilnya
divalidasi di compose.py.
"""
import re

from .. import queries
from . import rag, resolver
from .core import Db, Result, fmt_num, table_from
from .intents import CONTOH
from .parsing import (
    mentions_all_scope,
    mentions_unknown_kelas,
    parse_gender,
    parse_hari,
    parse_limit,
    parse_pkl_sesi,
    parse_pkl_status,
    parse_poin_filter,
    parse_tingkat_pelanggaran,
    parse_urutan,
)

MAX_BARIS = 40

_RAPOR_TO_JADWAL = {
    "PABP": "PAI",
    "B.SUN": "MULOK",
    "PKWU": "KIK",
}


def _sem_berjalan(db: Db) -> int:
    rows = db.rows(queries.PERIODE_BERJALAN)
    return int(rows[0]["semester"]) if rows else 5


def _potong(rows: list, n: int = MAX_BARIS) -> tuple[list, str]:
    if len(rows) <= n:
        return rows, ""
    return rows[:n], f" (menampilkan {n} dari {len(rows)} baris)"


def _tanya(pesan: str) -> Result:
    return Result(pesan, butuh_klarifikasi=True)


def _has(text: str, pattern: str) -> bool:
    return bool(re.search(pattern, text))


def _kelas_wajib(p: dict, pesan: str, untuk: str) -> Result | None:
    if p.get("kelas"):
        return None
    if mentions_unknown_kelas(pesan):
        return _tanya("Kelas itu tidak ada di data. Kelas XII yang tersedia: RPL 1-3, DKV 1-2, TITL 1-6, TOI 1-3, TAV 1-3.")
    return _tanya(f"Kelas mana yang dimaksud untuk {untuk}? Contoh: XII RPL 2.")


def _satu_siswa(db: Db, p: dict, pesan: str) -> tuple[dict | None, Result | None]:
    rows = resolver.find_siswa_in_text(db, pesan, p.get("siswa"))
    if not rows:
        return None, _tanya("Siswa tidak ditemukan. Tulis nama lengkap atau NIS-nya, misalnya: \"nilai Aditya Ramadhan\".")
    if len(rows) > 1:
        kolom, baris = table_from(rows[:10], [("nama", "Nama"), ("kelas", "Kelas"), ("no_absen", "No absen")])
        return None, Result(
            f"Ada {len(rows)} siswa yang cocok. Sebutkan nama lengkap atau kelasnya.",
            kolom, baris, ["siswa", "kelas"], butuh_klarifikasi=True,
        )
    return rows[0], None


# ------------------------------------------------------------------ sapaan & statistik
def sapaan(db: Db, p: dict, pesan: str) -> Result:  # noqa: ARG001
    low = (pesan or "").lower()
    if _has(low, r"\b(terima\s*kasih|makasih|thanks|thank\s+you|thx)\b"):
        return Result(
            "Sama-sama! Jika ada data kelas XII SMKN 4 Bandung yang ingin dicek lagi "
            "(nilai, KKM, kehadiran, jadwal, PKL, ekskul, atau profil sekolah), silakan tanyakan."
        )
    if _has(low, r"\b(bisa\s+apa|bantu\s+apa|fitur|bantuan|help|menu|panduan|cara\s+pakai|siapa\s+kamu|kamu\s+siapa)\b"):
        return Result(
            "Saya asisten data sekolah kelas XII SMKN 4 Bandung. Saya bisa membantu menjawab pertanyaan seputar:\n"
            "• Profil siswa, daftar wali kelas, dan statistik jumlah siswa per jurusan/kelas\n"
            "• Nilai rapor, peringkat nilai (per kelas, jurusan, atau seluruh kelas XII), dan daftar nilai di bawah KKM\n"
            "• Rekap kehadiran dan siswa dengan alpha tinggi\n"
            "• Jadwal pelajaran kelas, jadwal mengajar guru, dan daftar guru mata pelajaran\n"
            "• Penempatan PKL, kuota mitra industri, dan kegiatan ekstrakurikuler\n"
            "• Profil sekolah, tata tertib, dan dokumen pengetahuan sekolah\n\n"
            "Contoh pertanyaan: \"Berapa jumlah siswa per jurusan?\" atau \"Berikan saya data 3 murid dengan nilai terbaik di seluruh kelas\"."
        )
    return Result(
        "Halo! Ada yang bisa saya bantu terkait data kelas XII SMKN 4 Bandung? "
        "Anda bisa menanyakan statistik jurusan, nilai & KKM, kehadiran, jadwal, wali kelas, PKL, ekskul, atau profil sekolah."
    )


def statistik_sekolah(db: Db, p: dict, pesan: str) -> Result:
    low = pesan.lower()
    if not p.get("kelas") and mentions_unknown_kelas(pesan):
        return _kelas_wajib(p, pesan, "statistik kelas")

    limit = int(p.get("limit") or parse_limit(pesan, default=0) or 0)
    urutan = (p.get("urutan") or parse_urutan(pesan, default="desc")).lower()
    jurusan = p.get("jurusan") or ""

    if _has(low, r"\b(ekskul|ekstrakurikuler|ekstra)\b"):
        sem = int(p.get("semester") or _sem_berjalan(db))
        rows = db.rows(queries.EKSKUL_TERPOPULER, semester=sem)
        if not rows:
            return Result("Belum ada data partisipasi ekstrakurikuler.", sumber=["ekstrakurikuler"])
        if urutan == "asc":
            rows = sorted(rows, key=lambda r: (int(r["jumlah_anggota"] or 0), r["ekskul"]))
        shown = rows[:limit] if limit else _potong(rows)[0]
        kolom, baris = table_from(shown, [("ekskul", "Ekskul"), ("jumlah_anggota", "Jumlah Anggota"), ("hari", "Hari"), ("waktu", "Waktu")])
        label = "paling sedikit anggotanya" if urutan == "asc" else "paling populer"
        return Result(
            f"Ekstrakurikuler {label} pada semester {sem}: {shown[0]['ekskul']} ({shown[0]['jumlah_anggota']} anggota). "
            f"Menampilkan {len(shown)} dari {len(rows)} ekskul.",
            kolom,
            baris,
            ["ekstrakurikuler", "partisipasi_ekskul"],
        )

    if p.get("kelas") or _has(low, r"\b(per\s+kelas|tiap\s+kelas|setiap\s+kelas)\b"):
        rows = db.rows(queries.STATISTIK_SISWA_PER_KELAS, jurusan=jurusan)
        if p.get("kelas"):
            rows = [r for r in rows if r["kode"] == p["kelas"]]
        if not rows:
            return Result("Data statistik kelas tidak ditemukan.", sumber=["kelas", "siswa"])
        shown = rows[:limit] if limit else _potong(rows)[0]
        tot_s = sum(int(r["jumlah_siswa"] or 0) for r in rows)
        tot_l = sum(int(r["laki_laki"] or 0) for r in rows)
        tot_p = sum(int(r["perempuan"] or 0) for r in rows)
        kolom, baris = table_from(
            shown,
            [("kelas", "Kelas"), ("jurusan_kode", "Jurusan"), ("wali_kelas", "Wali Kelas"),
             ("jumlah_siswa", "Jumlah Siswa"), ("laki_laki", "Laki-laki"), ("perempuan", "Perempuan")],
        )
        lok = f" di {rows[0]['kelas']}" if p.get("kelas") else (f" jurusan {jurusan}" if jurusan else " kelas XII")
        return Result(
            f"Statistik siswa{lok}: total {tot_s} siswa ({tot_l} laki-laki, {tot_p} perempuan) di {len(rows)} kelas.",
            kolom,
            baris,
            ["kelas", "siswa", "guru"],
        )

    if _has(low, r"\b(guru|mitra|perusahaan)\b") and not _has(low, r"\b(siswa|murid|jurusan|laki|perempuan)\b"):
        ring = db.rows(queries.MASTER_RINGKASAN)
        if ring:
            r = ring[0]
            kolom = ["Kategori", "Jumlah"]
            baris = [
                ["Siswa Kelas XII", r["siswa"]],
                ["Kelas", r["kelas"]],
                ["Jurusan", r["jurusan"]],
                ["Guru", r["guru"]],
                ["Penempatan PKL", r["penempatan_pkl"]],
                ["Mitra Perusahaan PKL", r["perusahaan_pkl"]],
                ["Ekstrakurikuler", r["ekstrakurikuler"]],
            ]
            return Result(
                f"Ringkasan data SMKN 4 Bandung (kelas XII): {r['siswa']} siswa di {r['kelas']} kelas ({r['jurusan']} jurusan), "
                f"{r['guru']} guru, {r['perusahaan_pkl']} mitra PKL, dan {r['ekstrakurikuler']} ekskul.",
                kolom,
                baris,
                ["siswa", "kelas", "guru", "perusahaan_pkl", "penempatan_pkl", "ekstrakurikuler", "jurusan"],
            )

    rows = db.rows(queries.STATISTIK_SISWA_PER_JURUSAN)
    if jurusan:
        rows = [r for r in rows if r["jurusan_kode"] == jurusan]
    if not rows:
        return Result("Data statistik jurusan belum tersedia.", sumber=["jurusan", "siswa"])
    if urutan == "asc":
        rows = sorted(rows, key=lambda r: (int(r["jumlah_siswa"] or 0), r["jurusan_kode"]))
    tot_k = sum(int(r["jumlah_kelas"] or 0) for r in rows)
    tot_s = sum(int(r["jumlah_siswa"] or 0) for r in rows)
    tot_l = sum(int(r["laki_laki"] or 0) for r in rows)
    tot_p = sum(int(r["perempuan"] or 0) for r in rows)
    top_j = max(rows, key=lambda r: int(r["jumlah_siswa"] or 0))
    shown = rows[:limit] if limit else rows
    kolom, baris = table_from(
        shown,
        [("jurusan_kode", "Kode"), ("jurusan", "Jurusan"), ("jumlah_kelas", "Jumlah Kelas"),
         ("jumlah_siswa", "Jumlah Siswa"), ("laki_laki", "Laki-laki"), ("perempuan", "Perempuan")],
    )
    teks = (
        f"Total ada {tot_s} siswa kelas XII di {tot_k} kelas pada {len(rows)} jurusan "
        f"({tot_l} laki-laki dan {tot_p} perempuan). "
        f"Jurusan terbanyak: {top_j['jurusan']} ({top_j['jumlah_siswa']} siswa)."
    )
    return Result(teks, kolom, baris, ["jurusan", "kelas", "siswa"])


# ------------------------------------------------------------------ siswa
def cari_siswa(db: Db, p: dict, pesan: str) -> Result:
    if not p.get("kelas") and mentions_unknown_kelas(pesan):
        return _kelas_wajib(p, pesan, "daftar siswa")
    low = pesan.lower()
    if _has(low, r"\b(ekskul|ekstrakurikuler|ekstra)\b") and _has(low, r"\b(pkl|magang|prakerin)\b"):
        from . import sql_builder

        sem = int(p.get("semester") or _sem_berjalan(db))
        limit = int(p.get("limit") or parse_limit(pesan, default=0) or MAX_BARIS)
        res_ep = sql_builder._layer_a_ekskul_pkl(db, low, p.get("kelas"), p.get("jurusan") or "", sem, limit)
        if res_ep is not None:
            return res_ep
    if p.get("kelas") and not (p.get("siswa") or resolver.find_siswa_in_text(db, pesan)):
        rows = db.rows(queries.KELAS_SISWA, kelas=p["kelas"])
        gender = parse_gender(pesan)
        if gender:
            rows = [r for r in rows if r["jenis_kelamin"] == gender]
        limit = int(p.get("limit") or parse_limit(pesan, default=0) or 0)
        shown = rows[:limit] if limit else rows
        kolom, baris = table_from(shown, [("no_absen", "No"), ("nis", "NIS"), ("nama", "Nama"), ("jenis_kelamin", "L/P")])
        lbl = " laki-laki" if gender == "L" else (" perempuan" if gender == "P" else "")
        return Result(f"Kelas {p['kelas'].replace('-', ' ')} memiliki {len(rows)} siswa{lbl}.", kolom, baris, ["siswa", "kelas"])
    rows = resolver.find_siswa_in_text(db, pesan, p.get("siswa"))
    if not rows:
        return _tanya("Siswa tidak ditemukan. Coba tulis nama lengkap atau NIS.")
    shown, note = _potong(rows, int(p.get("limit") or 15))
    kolom, baris = table_from(shown, [("nama", "Nama"), ("nis", "NIS"), ("kelas", "Kelas"), ("no_absen", "No absen")])
    return Result(f"Ditemukan {len(rows)} siswa{note}.", kolom, baris, ["siswa", "kelas"])


def profil_siswa(db: Db, p: dict, pesan: str) -> Result:
    s, ask = _satu_siswa(db, p, pesan)
    if ask:
        if not ask.baris and not re.search(r"\b(profil|biodata|siapa|cari|siswa|murid|nis|nisn|data|info)\b|\b\d{6,10}\b", pesan.lower()):
            return tidak_dikenali(db, p, pesan)
        return ask
    d = db.rows(queries.SISWA_DETAIL, nis=s["nis"])[0]
    pkl = (db.rows(queries.SISWA_PKL, nis=s["nis"]) or [None])[0]
    ekskul = db.rows(queries.SISWA_EKSKUL, nis=s["nis"])
    ekskul_nama = sorted({e["ekskul"] for e in ekskul})
    fields = [
        ("Nama", d["nama"]), ("NIS", d["nis"]), ("NISN", d["nisn"]), ("Kelas", d["kelas"]), ("No absen", d["no_absen"]),
        ("Jurusan", d["jurusan"]), ("Wali kelas", d["wali_kelas"]),
    ]
    teks = f"{d['nama']} siswa {d['kelas']}, jurusan {d['jurusan']}, wali kelas {d['wali_kelas']}."
    if pkl:
        fields.append(("PKL", f"{pkl['perusahaan']} - {pkl['posisi']} (sesi {pkl['sesi']}, {pkl['status']})"))
        teks += f" PKL di {pkl['perusahaan']} sebagai {pkl['posisi']} (sesi {pkl['sesi']}, {pkl['status'].lower()})."
    if ekskul_nama:
        fields.append(("Ekskul", ", ".join(ekskul_nama)))
        teks += f" Ekskul: {', '.join(ekskul_nama)}."
    return Result(teks, ["Data", "Isi"], [[a, b] for a, b in fields], ["siswa", "kelas", "guru", "penempatan_pkl", "partisipasi_ekskul"])


def nilai_siswa(db: Db, p: dict, pesan: str) -> Result:
    s, ask = _satu_siswa(db, p, pesan)
    if ask:
        return ask
    sem = int(p.get("semester") or 0)
    mapel = p.get("mapel") or ""
    rows = db.rows(queries.SISWA_NILAI, nis=s["nis"], semester=sem)
    if mapel:
        rows = [r for r in rows if r["kode_mapel"] == mapel]
    if not rows:
        return Result(f"Tidak ada nilai untuk {s['nama']} dengan filter tersebut.", sumber=["nilai"])
    for r in rows:
        r["status"] = "Tuntas" if r["tuntas"] else "Di bawah KKM"
    if mapel:
        kolom, baris = table_from(rows, [("semester", "Semester"), ("nilai", "Nilai"), ("kkm", "KKM"), ("status", "Status")])
        ring = ", ".join(f"semester {r['semester']}: {r['nilai']}" for r in rows)
        return Result(f"Nilai {rows[0]['mapel']} {s['nama']} ({s['kelas']}): {ring}.", kolom, baris, ["nilai", "mapel_rapor", "periode_akademik"])
    if sem:
        kolom, baris = table_from(rows, [("mapel", "Mata pelajaran"), ("nilai", "Nilai"), ("kkm", "KKM"), ("status", "Status")])
        rata = db.rows(queries.SISWA_NILAI_RATA, nis=s["nis"], semester=sem)[0]["rata_rata"]
        bawah = [r for r in rows if not r["tuntas"]]
        teks = f"Nilai {s['nama']} ({s['kelas']}) semester {sem}: rata-rata {fmt_num(rata)} dari {len(rows)} mapel."
        teks += (f" {len(bawah)} mapel di bawah KKM: {', '.join(r['mapel'] for r in bawah)}." if bawah
                 else " Semua mapel tuntas (di atas atau sama dengan KKM).")
        return Result(teks, kolom, baris, ["nilai", "mapel_rapor", "periode_akademik"])
    rata = db.rows(queries.SISWA_NILAI_RATA, nis=s["nis"], semester=0)
    kolom, baris = table_from(rata, [("semester", "Semester"), ("rata_rata", "Rata-rata"), ("jumlah_mapel", "Jumlah mapel")])
    ring = ", ".join(f"semester {r['semester']}: {fmt_num(r['rata_rata'])}" for r in rata)
    return Result(f"Rata-rata nilai {s['nama']} ({s['kelas']}) per semester: {ring}. Sebut semester atau mapel untuk rincian.",
                  kolom, baris, ["nilai", "periode_akademik"])


def ranking_kelas(db: Db, p: dict, pesan: str) -> Result:
    if not p.get("kelas") and mentions_unknown_kelas(pesan):
        return _kelas_wajib(p, pesan, "peringkat nilai")

    sem = int(p.get("semester") or _sem_berjalan(db))
    mapel = p.get("mapel") or ""
    jurusan = p.get("jurusan") or ""
    urutan = (p.get("urutan") or parse_urutan(pesan, default="desc")).lower()
    if any(w in pesan.lower() for w in ("terendah", "terburuk", "paling rendah")):
        urutan = "asc"

    if not p.get("kelas") and _has(
        pesan.lower(), r"\b(per\s+jurusan|tiap\s+jurusan|setiap\s+jurusan|antar\s+jurusan|per\s+kelas|tiap\s+kelas|setiap\s+kelas|antar\s+kelas)\b"
    ):
        from . import sql_builder

        res_avg = sql_builder._layer_a_avg_per_grup(db, pesan.lower(), sem, mapel, urutan)
        if res_avg is not None:
            return res_avg

    limit = max(1, min(int(p.get("limit") or parse_limit(pesan, default=10) or 10), MAX_BARIS))
    label = "terendah" if urutan == "asc" else "tertinggi"
    pos_word = "terbawah" if urutan == "asc" else "teratas"
    mapel_lbl = f" mapel {mapel}" if mapel else ""

    if p.get("kelas"):
        rows = db.rows(queries.RANKING_KELAS, kelas=p["kelas"], semester=sem, mapel=mapel)
        if not rows:
            return Result("Tidak ada data nilai untuk kelas dan semester itu.", sumber=["nilai"])
        if urutan == "asc":
            rows = sorted(rows, key=lambda r: (r["rata_rata"], r["nama"]))
        top = rows[:limit]
        for i, r in enumerate(top, 1):
            r["peringkat"] = i
        kolom, baris = table_from(top, [("peringkat", "Peringkat"), ("nama", "Nama"), ("rata_rata", "Rata-rata")])
        nama_kelas = p["kelas"].replace("-", " ")
        teks = (
            f"Rata-rata nilai{mapel_lbl} {label} di {nama_kelas} semester {sem}: {top[0]['nama']} ({fmt_num(top[0]['rata_rata'])}). "
            f"Tabel menampilkan {len(top)} {pos_word} dari {len(rows)} siswa."
        )
        return Result(teks, kolom, baris, ["nilai", "siswa"])

    rows = db.rows(queries.RANKING_GLOBAL, semester=sem, jurusan=jurusan, kelas="", mapel=mapel)
    if not rows:
        return Result("Tidak ada data nilai untuk kriteria dan semester tersebut.", sumber=["nilai"])
    if urutan == "asc":
        rows = sorted(rows, key=lambda r: (r["rata_rata"], r["nama"]))
    top = rows[:limit]
    for i, r in enumerate(top, 1):
        r["peringkat"] = i
    kolom, baris = table_from(top, [("peringkat", "Peringkat"), ("nama", "Nama"), ("kelas", "Kelas"), ("rata_rata", "Rata-rata")])
    lokasi = f"jurusan {jurusan}" if jurusan else "seluruh kelas XII"
    teks = (
        f"Rata-rata nilai{mapel_lbl} {label} di {lokasi} semester {sem}: {top[0]['nama']} ({top[0]['kelas']}, {fmt_num(top[0]['rata_rata'])}). "
        f"Tabel menampilkan {len(top)} {pos_word} dari {len(rows)} siswa."
    )
    return Result(teks, kolom, baris, ["nilai", "siswa", "kelas"])


def siswa_di_bawah_kkm(db: Db, p: dict, pesan: str) -> Result:
    if not p.get("kelas") and mentions_unknown_kelas(pesan):
        return _kelas_wajib(p, pesan, "daftar siswa di bawah KKM")
    sem = int(p.get("semester") or _sem_berjalan(db))
    jurusan = p.get("jurusan") or ""
    rows = db.rows(queries.DI_BAWAH_KKM, semester=sem, kelas=p.get("kelas") or "", mapel=p.get("mapel") or "")
    if jurusan and not p.get("kelas"):
        rows = [r for r in rows if f"-{jurusan}-" in r["kelas"].replace(" ", "-")]
    lokasi = (
        f" di {p['kelas'].replace('-', ' ')}"
        if p.get("kelas")
        else (f" di jurusan {jurusan}" if jurusan else " di seluruh kelas XII")
    )
    if not rows:
        return Result(f"Tidak ada nilai di bawah KKM{lokasi} pada semester {sem}.", sumber=["nilai", "periode_akademik"])
    siswa = len({(r["nama"], r["kelas"]) for r in rows})
    limit = int(p.get("limit") or parse_limit(pesan, default=0) or MAX_BARIS)
    shown, note = _potong(rows, max(1, min(limit, MAX_BARIS)))
    kolom, baris = table_from(shown, [("nama", "Nama"), ("kelas", "Kelas"), ("mapel", "Mapel"), ("nilai", "Nilai"), ("kkm", "KKM")])
    teks = f"Ada {len(rows)} nilai di bawah KKM ({rows[0]['kkm']}){lokasi} pada semester {sem}, dari {siswa} siswa{note}."
    return Result(teks, kolom, baris, ["nilai", "siswa", "periode_akademik"])


# ------------------------------------------------------------------ kehadiran
def rekap_kehadiran(db: Db, p: dict, pesan: str) -> Result:
    if not p.get("kelas") and mentions_unknown_kelas(pesan):
        return _kelas_wajib(p, pesan, "rekap kehadiran")
    sem = int(p.get("semester") or 0)
    has_name = bool(resolver.find_siswa_in_text(db, pesan, p.get("siswa")))
    if has_name or not p.get("kelas"):
        s, ask = _satu_siswa(db, p, pesan)
        if ask:
            return ask
        rows = db.rows(queries.SISWA_KEHADIRAN, nis=s["nis"])
        if sem:
            rows = [r for r in rows if r["semester"] == sem]
        kolom, baris = table_from(rows, [("semester", "Semester"), ("tahun_ajaran", "Tahun ajaran"), ("sakit", "Sakit"),
                                        ("izin", "Izin"), ("alpha", "Alpha"), ("hadir", "Hadir"), ("hari_efektif", "Hari efektif")])
        total_alpha = sum(r["alpha"] for r in rows)
        return Result(f"Kehadiran {s['nama']} ({s['kelas']}): total alpha {total_alpha} hari pada {len(rows)} semester yang ditampilkan.",
                      kolom, baris, ["kehadiran", "periode_akademik"])
    rows = db.rows(queries.KEHADIRAN_KELAS, kelas=p["kelas"], semester=sem)
    kolom, baris = table_from(rows, [("semester", "Semester"), ("sakit", "Sakit"), ("izin", "Izin"), ("alpha", "Alpha"), ("hadir", "Hadir")])
    return Result(f"Rekap kehadiran seluruh siswa {p['kelas'].replace('-', ' ')} (jumlah hari-siswa per semester).",
                  kolom, baris, ["kehadiran", "siswa"])


def siswa_alpha_tinggi(db: Db, p: dict, pesan: str) -> Result:
    if not p.get("kelas") and mentions_unknown_kelas(pesan):
        return _kelas_wajib(p, pesan, "daftar siswa dengan alpha tinggi")
    low = pesan.lower()
    has_threshold = bool(re.search(r"lebih dari|di atas|diatas|minimal|paling sedikit|tinggi|terbanyak|tertinggi|siapa saja|daftar|sering|>=|>|\d+\s*hari|atau lebih", low)) or bool(p.get("limit"))
    if not has_threshold and resolver.find_siswa_in_text(db, pesan, p.get("siswa")):
        return rekap_kehadiran(db, p, pesan)
    sem = int(p.get("semester") or _sem_berjalan(db))
    limit = int(p.get("limit") or parse_limit(pesan, default=0) or 0)
    ambang = int(p.get("ambang") or (1 if limit else 5))
    jurusan = p.get("jurusan") or ""
    rows = db.rows(queries.ALPHA_TINGGI, semester=sem, ambang=ambang, kelas=p.get("kelas") or "")
    if jurusan and not p.get("kelas"):
        rows = [r for r in rows if f"-{jurusan}-" in r["kelas"].replace(" ", "-")]
    lokasi = (
        f" di {p['kelas'].replace('-', ' ')}"
        if p.get("kelas")
        else (f" di jurusan {jurusan}" if jurusan else " di seluruh kelas XII")
    )
    if not rows:
        return Result(f"Tidak ada siswa dengan alpha {ambang} hari atau lebih{lokasi} pada semester {sem}.", sumber=["kehadiran"])
    shown, note = _potong(rows, max(1, min(limit or MAX_BARIS, MAX_BARIS)))
    kolom, baris = table_from(shown, [("nama", "Nama"), ("kelas", "Kelas"), ("alpha", "Alpha"), ("sakit", "Sakit"), ("izin", "Izin")])
    return Result(f"Ada {len(rows)} siswa dengan alpha {ambang} hari atau lebih{lokasi} pada semester {sem}. "
                  f"Tertinggi: {rows[0]['nama']} ({rows[0]['alpha']} hari){note}.", kolom, baris, ["kehadiran", "siswa"])


# ------------------------------------------------------------------ pelanggaran (sensitif)
def _match_poin(total: int, op: str, pmin: int, pmax: int) -> bool:
    if op == "=":
        return total == pmin
    if op == ">":
        return total > pmin
    if op == ">=":
        return total >= pmin
    if op == "<":
        return total < pmin
    if op == "<=":
        return total <= pmin
    if op == "between":
        return pmin <= total <= pmax
    return True


def _poin_label(op: str, pmin: int, pmax: int) -> str:
    if op == "=":
        return f"tepat {pmin} poin"
    if op == ">":
        return f"lebih dari {pmin} poin"
    if op == ">=":
        return f"minimal {pmin} poin"
    if op == "<":
        return f"kurang dari {pmin} poin"
    if op == "<=":
        return f"maksimal {pmin} poin"
    if op == "between":
        return f"antara {pmin} sampai {pmax} poin"
    return ""


def pelanggaran_siswa(db: Db, p: dict, pesan: str) -> Result:
    if not p.get("kelas") and mentions_unknown_kelas(pesan):
        return _kelas_wajib(p, pesan, "catatan pelanggaran")

    kelas = p.get("kelas") or ""
    jurusan = p.get("jurusan") or ""
    tingkat = p.get("tingkat") or parse_tingkat_pelanggaran(pesan)
    limit = int(p.get("limit") or parse_limit(pesan, default=0) or 0)
    poin_op = str(p.get("poin_op") or "").strip().lower()
    if poin_op:
        poin_min = int(p.get("poin_min") or 0)
        poin_max = int(p.get("poin_max") if p.get("poin_max") is not None else (poin_min if poin_op == "=" else 0))
    else:
        poin_op, poin_min, poin_max = parse_poin_filter(pesan)
    all_scope = mentions_all_scope(pesan)
    low = pesan.lower()
    siswa_hits = resolver.find_siswa_in_text(db, pesan, p.get("siswa"))

    if (
        not siswa_hits
        and not poin_op
        and _has(low, r"\b(per\s+jurusan|tiap\s+jurusan|per\s+kelas|tiap\s+kelas|per\s+tingkat|tiap\s+tingkat|berdasarkan\s+tingkat)\b")
        and not _has(low, r"\b(siswa|murid|anak)\b")
    ):
        from . import sql_builder

        res_group, _ = sql_builder._layer_a_pelanggaran(db, low, "admin", kelas or None, jurusan, tingkat, limit)
        if res_group is not None:
            return res_group

    wants_rank_or_global = (not siswa_hits) and (
        bool(poin_op)
        or bool(tingkat)
        or bool(jurusan)
        or limit > 0
        or all_scope
        or _has(low, r"\b(murid|siswa|terbanyak|terberat|peringkat|ranking|top|rekap|siapa saja)\b")
    )
    if wants_rank_or_global:
        all_rank_rows = db.rows(queries.PELANGGARAN_PER_SISWA_RANK, kelas=kelas, jurusan=jurusan, tingkat=tingkat)
        lok = f" di {kelas.replace('-', ' ')}" if kelas else (f" di jurusan {jurusan}" if jurusan else " di seluruh kelas XII")
        ting_lbl = f" tingkat {tingkat}" if tingkat else ""
        if not all_rank_rows:
            return Result(f"Tidak ada catatan pelanggaran{ting_lbl}{lok}.", sumber=["pelanggaran"], sensitif=True)

        rank_rows = all_rank_rows
        if poin_op:
            poin_lbl = _poin_label(poin_op, poin_min, poin_max)
            rank_rows = [r for r in all_rank_rows if _match_poin(int(r["total_poin"]), poin_op, poin_min, poin_max)]
            if not rank_rows:
                target = poin_min if poin_op != "between" else (poin_min + poin_max) // 2
                unique_pts = sorted({int(r["total_poin"]) for r in all_rank_rows}, key=lambda v: (abs(v - target), v))
                closest = ", ".join(f"{v} poin" for v in unique_pts[:5])
                return Result(
                    f"Tidak ditemukan siswa dengan total poin pelanggaran {poin_lbl}{ting_lbl}{lok}. "
                    f"Total poin pelanggaran tercatat yang paling dekat: {closest}.",
                    sumber=["pelanggaran", "jenis_pelanggaran", "siswa"],
                    sensitif=True,
                )

        urutan = (p.get("urutan") or parse_urutan(pesan, default="desc")).lower()
        if urutan == "asc":
            rank_rows = sorted(rank_rows, key=lambda r: (int(r["total_poin"]), int(r["jumlah_pelanggaran"]), r["nama"]))
        cap = max(1, min(limit or MAX_BARIS, MAX_BARIS))
        shown = rank_rows[:cap]

        detail_rows = db.rows(queries.PELANGGARAN_FILTERED, kelas=kelas, jurusan=jurusan, tingkat=tingkat)
        by_nis: dict[str, list[str]] = {}
        for d in detail_rows:
            by_nis.setdefault(d["nis"], [])
            label_p = f"{d['pelanggaran']} ({d['tingkat']}, {d['poin']} poin)"
            if label_p not in by_nis[d["nis"]]:
                by_nis[d["nis"]].append(label_p)

        for r in shown:
            r["detail_pelanggaran"] = "; ".join(by_nis.get(r["nis"], [])[:3]) or "-"

        kolom, baris = table_from(
            shown,
            [
                ("nama", "Nama"),
                ("kelas", "Kelas"),
                ("detail_pelanggaran", "Pelanggaran"),
                ("jumlah_pelanggaran", "Jumlah"),
                ("total_poin", "Total Poin"),
                ("terakhir", "Terakhir"),
            ],
        )
        note = f" (menampilkan {len(shown)} siswa)" if len(rank_rows) > len(shown) else ""
        if poin_op:
            poin_lbl = _poin_label(poin_op, poin_min, poin_max)
            extra = (
                ""
                if poin_op == "="
                else f" {'Terendah' if urutan == 'asc' else 'Tertinggi'}: {shown[0]['nama']} ({shown[0]['kelas']}, {shown[0]['total_poin']} poin)."
            )
            teks = (
                f"Ditemukan {len(rank_rows)} siswa dengan total poin pelanggaran {poin_lbl}{ting_lbl}{lok}{note}.{extra} "
                "Data ini sensitif; gunakan seperlunya untuk pembinaan."
            )
        else:
            teks = (
                f"Ditemukan {len(rank_rows)} siswa dengan pelanggaran{ting_lbl}{lok}{note}. "
                f"Tertinggi: {shown[0]['nama']} ({shown[0]['kelas']}, {shown[0]['total_poin']} poin). "
                "Data ini sensitif; gunakan seperlunya untuk pembinaan."
            )
        return Result(teks, kolom, baris, ["pelanggaran", "jenis_pelanggaran", "siswa", "kelas"], sensitif=True)

    if kelas and not siswa_hits:
        rows = db.rows(queries.PELANGGARAN_KELAS, kelas=kelas)
        nama = kelas.replace("-", " ")
        if not rows:
            return Result(f"Tidak ada catatan pelanggaran di {nama}.", sumber=["pelanggaran"], sensitif=True)
        kolom, baris = table_from(rows, [("nama", "Nama"), ("pelanggaran", "Pelanggaran"), ("tingkat", "Tingkat"),
                                        ("poin", "Poin"), ("tanggal_kejadian", "Tanggal")])
        return Result(f"Ada {len(rows)} catatan pelanggaran di {nama}. Data ini sensitif; gunakan seperlunya untuk pembinaan.",
                      kolom, baris, ["pelanggaran", "jenis_pelanggaran", "siswa"], sensitif=True)

    s, ask = _satu_siswa(db, p, pesan)
    if ask:
        return ask
    rows = db.rows(queries.SISWA_PELANGGARAN, nis=s["nis"])
    if not rows:
        return Result(f"Tidak ada catatan pelanggaran untuk {s['nama']} ({s['kelas']}).", sumber=["pelanggaran"], sensitif=True)
    kolom, baris = table_from(rows, [("pelanggaran", "Pelanggaran"), ("tingkat", "Tingkat"), ("poin", "Poin"),
                                    ("tanggal_kejadian", "Tanggal"), ("tindak_lanjut", "Tindak lanjut")])
    total = sum(r["poin"] for r in rows)
    return Result(f"{s['nama']} ({s['kelas']}) memiliki {len(rows)} catatan pelanggaran dengan total {total} poin. "
                  "Data ini sensitif; gunakan seperlunya untuk pembinaan.", kolom, baris,
                  ["pelanggaran", "jenis_pelanggaran", "siswa"], sensitif=True)


# ------------------------------------------------------------------ jadwal & wali
def _jam(r: dict) -> str:
    return str(r["jam_mulai"]) if r["jam_mulai"] == r["jam_selesai"] else f"{r['jam_mulai']}-{r['jam_selesai']}"


def jadwal_kelas(db: Db, p: dict, pesan: str) -> Result:
    if not p.get("kelas") and (ask := _kelas_wajib(p, pesan, "jadwal pelajaran")):
        guru = resolver.find_guru(db, pesan, p.get("guru"))
        if guru:
            return jadwal_guru(db, p, pesan)
        return ask
    hari = p.get("hari") or parse_hari(pesan)
    rows = db.rows(queries.JADWAL_KELAS, kelas=p["kelas"], hari=hari)
    for r in rows:
        r["jam"] = _jam(r)
    kolom, baris = table_from(rows, [("hari", "Hari"), ("jam", "Jam ke"), ("mapel", "Mata pelajaran"), ("guru", "Guru"), ("ruangan", "Ruang")])
    lokasi = f" hari {hari}" if hari else ""
    return Result(f"Jadwal {p['kelas'].replace('-', ' ')}{lokasi}: {len(rows)} sesi pelajaran.", kolom, baris, ["jadwal_pelajaran", "guru"])


def _resolve_jadwal_mapel_code(p: dict, pesan: str) -> tuple[str, str]:
    raw_mapel = str(p.get("mapel") or "")
    low = pesan.lower()
    if raw_mapel:
        if raw_mapel in _RAPOR_TO_JADWAL:
            return _RAPOR_TO_JADWAL[raw_mapel], ""
        m_kk = re.search(r"-(KK[1-4])$", raw_mapel)
        if m_kk:
            return m_kk.group(1), ""
        return raw_mapel, ""
    if _has(low, r"\bbk\b|bimbingan\s+konseling|konseling"):
        return "BK", ""
    if _has(low, r"\bmata\s+pelajaran\s+pilihan|\bpilihan\b|\bmp\b"):
        return "MP", ""
    m_kk = re.search(r"\bkk\s*([1-4])\b", low)
    if m_kk:
        return f"KK{m_kk.group(1)}", ""
    if _has(low, r"\bkik\b|kreativitas"):
        return "KIK", ""
    if _has(low, r"\bmulok\b|sunda"):
        return "MULOK", ""
    if _has(low, r"\bpai\b|agama"):
        return "PAI", ""
    return "", ""


def jadwal_guru(db: Db, p: dict, pesan: str) -> Result:
    if not p.get("kelas") and mentions_unknown_kelas(pesan):
        return _kelas_wajib(p, pesan, "jadwal pelajaran")
    guru = resolver.find_guru(db, pesan, p.get("guru"))
    if not guru:
        kode_mapel, q_mapel = _resolve_jadwal_mapel_code(p, pesan)
        if kode_mapel or q_mapel:
            teachers = db.rows(queries.GURU_BY_MAPEL, kode_mapel=kode_mapel, q=q_mapel)
            if teachers:
                hari = p.get("hari") or parse_hari(pesan)
                wants_sched = _has(pesan.lower(), r"\b(jadwal|mengajar|jam|hari|ruang)\b") or bool(hari)
                if wants_sched and kode_mapel:
                    sched = db.rows(queries.JADWAL_BY_MAPEL, kode_mapel=kode_mapel, hari=hari, kelas=p.get("kelas") or "")
                    if sched:
                        for r in sched:
                            r["jam"] = _jam(r)
                        shown, note = _potong(sched)
                        kolom, baris = table_from(
                            shown,
                            [("guru", "Guru"), ("hari", "Hari"), ("jam", "Jam ke"), ("kelas", "Kelas"), ("mapel", "Mata pelajaran"), ("ruangan", "Ruang")],
                        )
                        return Result(
                            f"Jadwal mengajar mapel {sched[0]['mapel']}{(' hari ' + hari) if hari else ''}: {len(sched)} sesi{note}.",
                            kolom,
                            baris,
                            ["jadwal_pelajaran", "guru", "mapel_jadwal", "kelas"],
                        )
                kolom, baris = table_from(teachers, [("guru", "Guru"), ("mapel", "Mata pelajaran")])
                return Result(
                    f"Guru pengampu mata pelajaran {teachers[0]['mapel']}: {', '.join(t['guru'] for t in teachers)}.",
                    kolom,
                    baris,
                    ["guru_mapel", "guru", "mapel_jadwal"],
                )
        return _tanya("Guru tidak ditemukan. Tulis nama guru atau mata pelajaran, atau sebut kelasnya untuk melihat jadwal kelas.")
    if len(guru) > 1:
        kolom, baris = table_from(guru[:10], [("nama", "Nama guru")])
        return Result("Ada beberapa guru yang cocok. Sebutkan nama lengkapnya.", kolom, baris, ["guru"], butuh_klarifikasi=True)
    g = guru[0]
    hari = p.get("hari") or parse_hari(pesan)
    rows = [r for r in db.rows(queries.JADWAL_GURU, nip=g["nip"]) if not hari or r["hari"] == hari]
    if not rows:
        return Result(f"{g['nama']} tidak memiliki jadwal mengajar kelas XII{(' pada hari ' + hari) if hari else ''}.", sumber=["jadwal_pelajaran"])
    for r in rows:
        r["jam"] = _jam(r)
    kolom, baris = table_from(rows, [("hari", "Hari"), ("jam", "Jam ke"), ("kelas", "Kelas"), ("mapel", "Mata pelajaran"), ("ruangan", "Ruang")])
    return Result(f"{g['nama']} mengajar {len(rows)} sesi di kelas XII{(' pada hari ' + hari) if hari else ''}.", kolom, baris, ["jadwal_pelajaran", "kelas"])


def info_wali_kelas(db: Db, p: dict, pesan: str) -> Result:
    kelas_all = db.rows(queries.KELAS_LIST)
    if p.get("kelas"):
        k = next((x for x in kelas_all if x["kode"] == p["kelas"]), None)
        if k:
            return Result(f"Wali kelas {k['nama']} adalah {k['wali_kelas']}.", ["Kelas", "Wali kelas"], [[k["nama"], k["wali_kelas"]]], ["kelas", "guru"])
    if mentions_unknown_kelas(pesan):
        return _kelas_wajib(p, pesan, "wali kelas")
    guru = resolver.find_guru(db, pesan, p.get("guru"))
    if len(guru) == 1:
        rows = db.rows(queries.KELAS_BY_WALI, nip=guru[0]["nip"])
        if rows:
            return Result(f"{guru[0]['nama']} adalah wali kelas {rows[0]['kelas']}.", ["Kelas", "Wali kelas"], [[r["kelas"], r["wali_kelas"]] for r in rows], ["kelas", "guru"])
        return Result(f"{guru[0]['nama']} tidak tercatat sebagai wali kelas XII.", sumber=["kelas", "guru"])
    jurusan = p.get("jurusan") or ""
    if jurusan:
        kelas_all = [k for k in kelas_all if k.get("jurusan_kode") == jurusan]
    kolom, baris = table_from(kelas_all, [("nama", "Kelas"), ("wali_kelas", "Wali kelas"), ("jumlah_siswa", "Jumlah siswa")])
    lok = f" jurusan {jurusan}" if jurusan else ""
    return Result(f"Daftar wali kelas XII{lok} (sebut nama kelas untuk satu kelas saja).", kolom, baris, ["kelas", "guru"])


# ------------------------------------------------------------------ PKL & ekskul
def penempatan_pkl(db: Db, p: dict, pesan: str) -> Result:
    if not p.get("kelas") and mentions_unknown_kelas(pesan):
        return _kelas_wajib(p, pesan, "penempatan PKL")
    low = pesan.lower()
    sesi = int(p.get("sesi") or parse_pkl_sesi(pesan) or 0)
    status = p.get("status") or parse_pkl_status(pesan)
    jurusan = p.get("jurusan") or ""
    limit = int(p.get("limit") or parse_limit(pesan, default=0) or MAX_BARIS)

    if _has(low, r"\b(ekskul|ekstrakurikuler|ekstra)\b"):
        from . import sql_builder

        sem = int(p.get("semester") or _sem_berjalan(db))
        res_ep = sql_builder._layer_a_ekskul_pkl(db, low, p.get("kelas"), jurusan, sem, limit)
        if res_ep is not None:
            return res_ep

    perusahaan = resolver.find_perusahaan(db, pesan, p.get("perusahaan"))
    if perusahaan and not (p.get("siswa") or p.get("kelas")):
        rows = []
        for c in perusahaan:
            if jurusan and c.get("jurusan_kode") != jurusan:
                continue
            for r in db.rows(queries.PKL_PERUSAHAAN, kode=c["kode"]):
                if sesi and int(r.get("sesi") or 0) != sesi:
                    continue
                if status and r.get("status") != status:
                    continue
                r["perusahaan"] = c["nama"]
                rows.append(r)
        nama = perusahaan[0]["nama"] if len(perusahaan) == 1 else f"{len(perusahaan)} perusahaan yang cocok"
        if not rows:
            return Result(f"Belum ada siswa yang ditempatkan di {nama}.", sumber=["penempatan_pkl", "perusahaan_pkl"])
        shown, note = _potong(rows, max(1, min(limit, MAX_BARIS)))
        cols = [("nama", "Nama"), ("kelas", "Kelas"), ("posisi", "Posisi"), ("sesi", "Sesi"), ("status", "Status")]
        if len(perusahaan) > 1:
            cols.insert(2, ("perusahaan", "Perusahaan"))
        kolom, baris = table_from(shown, cols)
        return Result(f"{len(rows)} siswa PKL di {nama}{note}.", kolom, baris, ["penempatan_pkl", "perusahaan_pkl", "siswa"])
    if p.get("kelas") and not resolver.find_siswa_in_text(db, pesan, p.get("siswa")):
        rows = db.rows(queries.PKL_KELAS, kelas=p["kelas"])
        if sesi:
            rows = [r for r in rows if int(r.get("sesi") or 0) == sesi]
        if status:
            rows = [r for r in rows if r.get("status") == status]
        shown, note = _potong(rows, max(1, min(limit, MAX_BARIS)))
        kolom, baris = table_from(shown, [("no_absen", "No"), ("nama", "Nama"), ("perusahaan", "Perusahaan"), ("posisi", "Posisi"), ("sesi", "Sesi"), ("status", "Status")])
        return Result(f"Penempatan PKL {p['kelas'].replace('-', ' ')}: {len(rows)} siswa{note}.", kolom, baris, ["penempatan_pkl", "perusahaan_pkl", "siswa"])

    has_siswa_hint = bool(resolver.find_siswa_in_text(db, pesan, p.get("siswa")))
    if not has_siswa_hint and (jurusan or sesi or status or mentions_all_scope(pesan) or _has(pesan.lower(), r"\b(mitra|perusahaan|kuota)\b")):
        if _has(pesan.lower(), r"\b(mitra|perusahaan|kuota|lowongan|posisi)\b") and not _has(pesan.lower(), r"\b(siswa|murid|siapa)\b"):
            comp = db.rows(queries.PERUSAHAAN_SEARCH, q="", jurusan=jurusan)
            shown, note = _potong(comp, max(1, min(limit, MAX_BARIS)))
            kolom, baris = table_from(
                shown,
                [("nama", "Perusahaan"), ("jurusan_kode", "Jurusan"), ("kota", "Kota"),
                 ("bidang_usaha", "Bidang Usaha"), ("kuota_sesi1", "Kuota S1"), ("kuota_sesi2", "Kuota S2")],
            )
            lok = f" jurusan {jurusan}" if jurusan else ""
            return Result(f"Daftar mitra PKL{lok}: {len(comp)} perusahaan{note}.", kolom, baris, ["perusahaan_pkl"])

        rows = db.rows(queries.PKL_BY_FILTER, kelas="", jurusan=jurusan, sesi=sesi, status=status)
        if not rows:
            return Result("Tidak ada penempatan PKL dengan filter tersebut.", sumber=["penempatan_pkl"])
        shown, note = _potong(rows, max(1, min(limit, MAX_BARIS)))
        kolom, baris = table_from(shown, [("nama", "Nama"), ("kelas", "Kelas"), ("perusahaan", "Perusahaan"), ("posisi", "Posisi"), ("sesi", "Sesi"), ("status", "Status")])
        return Result(f"Ditemukan {len(rows)} penempatan PKL{note}.", kolom, baris, ["penempatan_pkl", "perusahaan_pkl", "siswa", "kelas"])

    s, ask = _satu_siswa(db, p, pesan)
    if ask:
        return ask
    pkl = (db.rows(queries.SISWA_PKL, nis=s["nis"]) or [None])[0]
    if not pkl:
        return Result(f"{s['nama']} belum memiliki penempatan PKL.", sumber=["penempatan_pkl"])
    fields = [("Perusahaan", pkl["perusahaan"]), ("Posisi", pkl["posisi"]), ("Sesi", pkl["sesi"]),
              ("Pembimbing perusahaan", pkl["pembimbing_perusahaan"]), ("Pembimbing sekolah", pkl["pembimbing_sekolah"]), ("Status", pkl["status"])]
    return Result(f"{s['nama']} ({s['kelas']}) PKL di {pkl['perusahaan']} sebagai {pkl['posisi']}, sesi {pkl['sesi']} ({pkl['status'].lower()}). "
                  f"Pembimbing perusahaan: {pkl['pembimbing_perusahaan']}; pembimbing sekolah: {pkl['pembimbing_sekolah']}.",
                  ["Data", "Isi"], [[a, b] for a, b in fields], ["penempatan_pkl", "perusahaan_pkl", "guru"])


def info_ekskul(db: Db, p: dict, pesan: str) -> Result:
    if not p.get("kelas") and mentions_unknown_kelas(pesan):
        return _kelas_wajib(p, pesan, "ekstrakurikuler")

    low = pesan.lower()
    kelas = p.get("kelas") or ""
    jurusan = p.get("jurusan") or ""
    sem = int(p.get("semester") or _sem_berjalan(db))
    limit = int(p.get("limit") or parse_limit(pesan, default=0) or 0)

    if _has(low, r"\b(pkl|magang|prakerin)\b"):
        from . import sql_builder

        res_ep = sql_builder._layer_a_ekskul_pkl(db, low, kelas or None, jurusan, sem, limit or MAX_BARIS)
        if res_ep is not None:
            return res_ep

    e = resolver.find_ekskul(db, pesan, p.get("ekskul"))
    if e:
        if not p.get("ekskul"):
            p["ekskul"] = e["nama"]
        if kelas or jurusan:
            anggota = db.rows(
                queries.EKSKUL_PESERTA_BY_KELAS,
                semester=sem,
                kelas=kelas,
                jurusan=jurusan,
                kode_ekskul=e["kode"],
            )
            lok = f" di {kelas.replace('-', ' ')}" if kelas else f" di jurusan {jurusan}"
            if not anggota:
                return Result(
                    f"Tidak ada siswa{lok} yang mengikuti ekstrakurikuler {e['nama']} pada semester {sem}.",
                    sumber=["ekstrakurikuler", "partisipasi_ekskul", "siswa", "kelas"],
                )
            shown, note = _potong(anggota, max(1, min(limit or MAX_BARIS, MAX_BARIS)))
            kolom, baris = table_from(shown, [("nama", "Nama"), ("kelas", "Kelas"), ("nilai", "Nilai"), ("predikat", "Predikat")])
            teks = (
                f"{e['nama']} (jadwal {e['hari']}, {e['waktu']}; pembina: {e['pembina'] or '-'}): "
                f"terdapat {len(anggota)} anggota{lok} pada semester {sem}{note}."
            )
            return Result(teks, kolom, baris, ["ekstrakurikuler", "pembina_ekskul", "partisipasi_ekskul", "siswa", "kelas"])

        anggota = db.rows(queries.EKSKUL_ANGGOTA, kode=e["kode"], semester=sem)
        shown, note = _potong(anggota, max(1, min(limit or MAX_BARIS, MAX_BARIS)))
        kolom, baris = table_from(shown, [("nama", "Nama"), ("kelas", "Kelas"), ("nilai", "Nilai"), ("predikat", "Predikat")])
        teks = (
            f"{e['nama']}: {e['deskripsi']} Jadwal {e['hari']}, {e['waktu']}. Ketua: {e['ketua'] or '-'}; pembina: {e['pembina'] or '-'}. "
            f"Anggota kelas XII semester {sem}: {len(anggota)} siswa{note}."
        )
        return Result(teks, kolom, baris, ["ekstrakurikuler", "pembina_ekskul", "partisipasi_ekskul", "siswa"])

    rows = resolver.find_siswa_in_text(db, pesan, p.get("siswa"))
    if (kelas or jurusan) and not rows:
        lok = f" di {kelas.replace('-', ' ')}" if kelas else f" di jurusan {jurusan}"
        wants_members = _has(
            low,
            r"\b(anggota(?:nya)?|siapa\s+saja|daftar\s+siswa(?:nya)?|nama\s+siswa(?:nya)?|peserta(?:nya)?|siswanya|rincian(?:nya)?|detail(?:nya)?)\b",
        )
        if wants_members:
            peserta = db.rows(
                queries.EKSKUL_PESERTA_BY_KELAS,
                semester=sem,
                kelas=kelas,
                jurusan=jurusan,
                kode_ekskul="",
            )
            if not peserta:
                return Result(
                    f"Belum ada data peserta ekstrakurikuler{lok} pada semester {sem}.",
                    sumber=["partisipasi_ekskul", "ekstrakurikuler", "siswa", "kelas"],
                )
            shown, note = _potong(peserta, max(1, min(limit or MAX_BARIS, MAX_BARIS)))
            kolom, baris = table_from(
                shown,
                [("nama", "Nama"), ("kelas", "Kelas"), ("ekskul", "Ekskul"), ("nilai", "Nilai"), ("predikat", "Predikat")],
            )
            uniq_siswa = len({(r["nama"], r["kelas"]) for r in peserta})
            uniq_ekskul = len({r["ekskul"] for r in peserta})
            teks = (
                f"Daftar peserta ekstrakurikuler{lok} pada semester {sem}: "
                f"{len(peserta)} partisipasi dari {uniq_siswa} siswa pada {uniq_ekskul} ekskul{note}."
            )
            return Result(teks, kolom, baris, ["partisipasi_ekskul", "ekstrakurikuler", "siswa", "kelas"])

        ringkas = db.rows(queries.EKSKUL_BY_KELAS_RINGKAS, semester=sem, kelas=kelas, jurusan=jurusan)
        if not ringkas:
            return Result(
                f"Belum ada data ekstrakurikuler yang diikuti siswa{lok} pada semester {sem}.",
                sumber=["partisipasi_ekskul", "ekstrakurikuler", "siswa", "kelas"],
            )
        shown, note = _potong(ringkas, max(1, min(limit or MAX_BARIS, MAX_BARIS)))
        kolom, baris = table_from(
            shown,
            [("ekskul", "Ekskul"), ("jumlah_peserta", "Jumlah Peserta"), ("hari", "Hari"), ("waktu", "Waktu"), ("pembina", "Pembina")],
        )
        teks = (
            f"Siswa{lok} mengikuti {len(ringkas)} ekstrakurikuler pada semester {sem} "
            f"(terbanyak: {shown[0]['ekskul']} dengan {shown[0]['jumlah_peserta']} peserta){note}. "
            'Anda dapat menanyakan "anggotanya siapa saja" untuk melihat daftar lengkap siswanya.'
        )
        return Result(teks, kolom, baris, ["partisipasi_ekskul", "ekstrakurikuler", "pembina_ekskul", "siswa", "kelas"])

    if len(rows) > 1:
        _, ask = _satu_siswa(db, p, pesan)
        return ask
    if len(rows) == 1:
        ek = db.rows(queries.SISWA_EKSKUL, nis=rows[0]["nis"])
        if not ek:
            return Result(f"{rows[0]['nama']} tidak tercatat mengikuti ekskul.", sumber=["partisipasi_ekskul"])
        kolom, baris = table_from(ek, [("semester", "Semester"), ("ekskul", "Ekskul"), ("nilai", "Nilai"), ("predikat", "Predikat")])
        return Result(f"Ekskul {rows[0]['nama']}: {', '.join(sorted({x['ekskul'] for x in ek}))}.", kolom, baris, ["partisipasi_ekskul", "ekstrakurikuler"])
    daftar = db.rows(queries.EKSKUL_LIST)
    kolom, baris = table_from(daftar, [("nama", "Ekskul"), ("hari", "Hari"), ("waktu", "Waktu"), ("pembina", "Pembina"), ("ketua", "Ketua")])
    return Result(f"Ada {len(daftar)} ekstrakurikuler. Sebut nama ekskul untuk melihat anggota dan detailnya.", kolom, baris, ["ekstrakurikuler", "pembina_ekskul"])


# ------------------------------------------------------------------ info sekolah (RAG)
def info_sekolah(db: Db, p: dict, pesan: str) -> Result:
    teks, kolom, baris, sumber = "", [], [], ["profil_sekolah"]
    low = pesan.lower()
    konteks = re.search(r"\b(pelanggaran|sanksi|tingkat|poin)\b", low)
    tingkat = next((t for t in ("ringan", "sedang", "berat") if konteks and re.search(rf"\b{t}\b", low)), "")
    if tingkat or ("sanksi" in low and "pelanggaran" in low) or re.search(r"\bjenis\s+pelanggaran\b", low):
        jenis = db.rows(queries.JENIS_PELANGGARAN)
        if tingkat:
            jenis = [j for j in jenis if j["tingkat"].lower() == tingkat]
        kolom, baris = table_from(jenis, [("kode", "Kode"), ("nama", "Pelanggaran"), ("tingkat", "Tingkat"), ("poin", "Poin"), ("sanksi_disarankan", "Sanksi")])
        sumber.append("jenis_pelanggaran")
        teks = f"Ada {len(jenis)} jenis pelanggaran{(' tingkat ' + tingkat) if tingkat else ''} dengan sanksi yang disarankan (tabel). "
    hits = rag.retrieve(p.get("topik") or pesan, k=3)
    if hits:
        teks += "Dari profil sekolah: " + " | ".join(f"{label}: {text[:350]}" for label, text in hits)
    elif not teks:
        return _tanya("Saya tidak menemukan informasi itu di profil sekolah. Coba tanyakan visi misi, tata tertib, prestasi, fasilitas, atau mitra industri.")
    return Result(teks, kolom, baris, sumber)


def tidak_dikenali(db: Db, p: dict, pesan: str) -> Result:  # noqa: ARG001
    return _tanya(
        "Maaf, saya belum paham pertanyaannya. Saya bisa membantu soal siswa, nilai, kehadiran, jadwal, "
        "wali kelas, PKL, ekskul, statistik jurusan, dan profil sekolah (kelas XII). Contoh: "
        + " / ".join(f"\"{c}\"" for c in CONTOH[:3])
    )


HANDLERS = {
    "sapaan": sapaan,
    "statistik_sekolah": statistik_sekolah,
    "cari_siswa": cari_siswa,
    "profil_siswa": profil_siswa,
    "nilai_siswa": nilai_siswa,
    "ranking_kelas": ranking_kelas,
    "siswa_di_bawah_kkm": siswa_di_bawah_kkm,
    "rekap_kehadiran": rekap_kehadiran,
    "siswa_alpha_tinggi": siswa_alpha_tinggi,
    "pelanggaran_siswa": pelanggaran_siswa,
    "jadwal_kelas": jadwal_kelas,
    "jadwal_guru": jadwal_guru,
    "info_wali_kelas": info_wali_kelas,
    "penempatan_pkl": penempatan_pkl,
    "info_ekskul": info_ekskul,
    "info_sekolah": info_sekolah,
    "tidak_dikenali": tidak_dikenali,
}


def run(db: Db, intent: dict, pesan: str) -> Result:
    handler = HANDLERS.get(intent["intent"], tidak_dikenali)
    return handler(db, intent.get("params", {}), pesan)

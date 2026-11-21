"""Satu fungsi per intent: menjalankan query tetap dan membuat jawaban baku (template) + tabel.

Jawaban baku ini selalu benar terhadap data; Gemini (bila aktif) hanya boleh merangkainya ulang dan hasilnya
divalidasi di compose.py.
"""
import re

from .. import queries
from . import rag, resolver
from .core import Db, Result, fmt_num, table_from
from .intents import CONTOH
from .parsing import mentions_unknown_kelas, parse_hari

MAX_BARIS = 40


def _sem_berjalan(db: Db) -> int:
    rows = db.rows(queries.PERIODE_BERJALAN)
    return int(rows[0]["semester"]) if rows else 5


def _potong(rows: list, n: int = MAX_BARIS) -> tuple[list, str]:
    if len(rows) <= n:
        return rows, ""
    return rows[:n], f" (menampilkan {n} dari {len(rows)} baris)"


def _tanya(pesan: str) -> Result:
    return Result(pesan, butuh_klarifikasi=True)


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


# ------------------------------------------------------------------ siswa
def cari_siswa(db: Db, p: dict, pesan: str) -> Result:
    if not p.get("kelas") and mentions_unknown_kelas(pesan):
        return _kelas_wajib(p, pesan, "daftar siswa")
    if p.get("kelas") and not (p.get("siswa") or resolver.find_siswa_in_text(db, pesan)):
        rows = db.rows(queries.KELAS_SISWA, kelas=p["kelas"])
        kolom, baris = table_from(rows, [("no_absen", "No"), ("nis", "NIS"), ("nama", "Nama"), ("jenis_kelamin", "L/P")])
        return Result(f"Kelas {p['kelas'].replace('-', ' ')} memiliki {len(rows)} siswa.", kolom, baris, ["siswa", "kelas"])
    rows = resolver.find_siswa_in_text(db, pesan, p.get("siswa"))
    if not rows:
        return _tanya("Siswa tidak ditemukan. Coba tulis nama lengkap atau NIS.")
    shown, note = _potong(rows, 15)
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
    if (ask := _kelas_wajib(p, pesan, "peringkat nilai")):
        return ask
    sem = int(p.get("semester") or _sem_berjalan(db))
    rows = db.rows(queries.RANKING_KELAS, kelas=p["kelas"], semester=sem, mapel=p.get("mapel") or "")
    if not rows:
        return Result("Tidak ada data nilai untuk kelas dan semester itu.", sumber=["nilai"])
    terendah = any(w in pesan.lower() for w in ("terendah", "terburuk", "paling rendah"))
    if terendah:
        rows = list(reversed(rows))
    top = rows[:10]
    for i, r in enumerate(top, 1):
        r["peringkat"] = i
    kolom, baris = table_from(top, [("peringkat", "Peringkat"), ("nama", "Nama"), ("rata_rata", "Rata-rata")])
    label = "terendah" if terendah else "tertinggi"
    nama_kelas = p["kelas"].replace("-", " ")
    mapel = f" mapel {p['mapel']}" if p.get("mapel") else ""
    teks = (f"Rata-rata nilai{mapel} {label} di {nama_kelas} semester {sem}: {top[0]['nama']} ({fmt_num(top[0]['rata_rata'])}). "
            f"Tabel menampilkan 10 teratas dari {len(rows)} siswa.")
    return Result(teks, kolom, baris, ["nilai", "siswa"])


def siswa_di_bawah_kkm(db: Db, p: dict, pesan: str) -> Result:
    if not p.get("kelas") and mentions_unknown_kelas(pesan):
        return _kelas_wajib(p, pesan, "daftar siswa di bawah KKM")
    sem = int(p.get("semester") or _sem_berjalan(db))
    rows = db.rows(queries.DI_BAWAH_KKM, semester=sem, kelas=p.get("kelas") or "", mapel=p.get("mapel") or "")
    lokasi = f" di {p['kelas'].replace('-', ' ')}" if p.get("kelas") else " di seluruh kelas XII"
    if not rows:
        return Result(f"Tidak ada nilai di bawah KKM{lokasi} pada semester {sem}.", sumber=["nilai", "periode_akademik"])
    siswa = len({(r["nama"], r["kelas"]) for r in rows})
    shown, note = _potong(rows)
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
    has_threshold = bool(re.search(r"lebih dari|di atas|diatas|minimal|paling sedikit|tinggi|terbanyak|tertinggi|siapa saja|daftar|sering|>=|>|\d+\s*hari|atau lebih", low))
    if not has_threshold and resolver.find_siswa_in_text(db, pesan, p.get("siswa")):
        return rekap_kehadiran(db, p, pesan)
    sem = int(p.get("semester") or _sem_berjalan(db))
    ambang = int(p.get("ambang") or 5)
    rows = db.rows(queries.ALPHA_TINGGI, semester=sem, ambang=ambang, kelas=p.get("kelas") or "")
    lokasi = f" di {p['kelas'].replace('-', ' ')}" if p.get("kelas") else " di seluruh kelas XII"
    if not rows:
        return Result(f"Tidak ada siswa dengan alpha {ambang} hari atau lebih{lokasi} pada semester {sem}.", sumber=["kehadiran"])
    shown, note = _potong(rows)
    kolom, baris = table_from(shown, [("nama", "Nama"), ("kelas", "Kelas"), ("alpha", "Alpha"), ("sakit", "Sakit"), ("izin", "Izin")])
    return Result(f"Ada {len(rows)} siswa dengan alpha {ambang} hari atau lebih{lokasi} pada semester {sem}. "
                  f"Tertinggi: {rows[0]['nama']} ({rows[0]['alpha']} hari){note}.", kolom, baris, ["kehadiran", "siswa"])


# ------------------------------------------------------------------ pelanggaran (sensitif)
def pelanggaran_siswa(db: Db, p: dict, pesan: str) -> Result:
    if not p.get("kelas") and mentions_unknown_kelas(pesan):
        return _kelas_wajib(p, pesan, "catatan pelanggaran")
    if p.get("kelas") and not resolver.find_siswa_in_text(db, pesan, p.get("siswa")):
        rows = db.rows(queries.PELANGGARAN_KELAS, kelas=p["kelas"])
        nama = p["kelas"].replace("-", " ")
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


def jadwal_guru(db: Db, p: dict, pesan: str) -> Result:
    if not p.get("kelas") and mentions_unknown_kelas(pesan):
        return _kelas_wajib(p, pesan, "jadwal pelajaran")
    guru = resolver.find_guru(db, pesan, p.get("guru"))
    if not guru:
        return _tanya("Guru tidak ditemukan. Tulis nama guru, atau sebut kelasnya untuk melihat jadwal kelas.")
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
    kolom, baris = table_from(kelas_all, [("nama", "Kelas"), ("wali_kelas", "Wali kelas"), ("jumlah_siswa", "Jumlah siswa")])
    return Result("Daftar wali kelas XII (sebut nama kelas untuk satu kelas saja).", kolom, baris, ["kelas", "guru"])


# ------------------------------------------------------------------ PKL & ekskul
def penempatan_pkl(db: Db, p: dict, pesan: str) -> Result:
    if not p.get("kelas") and mentions_unknown_kelas(pesan):
        return _kelas_wajib(p, pesan, "penempatan PKL")
    perusahaan = resolver.find_perusahaan(db, pesan, p.get("perusahaan"))
    if perusahaan and not (p.get("siswa") or p.get("kelas")):
        rows = []
        for c in perusahaan:
            for r in db.rows(queries.PKL_PERUSAHAAN, kode=c["kode"]):
                r["perusahaan"] = c["nama"]
                rows.append(r)
        nama = perusahaan[0]["nama"] if len(perusahaan) == 1 else f"{len(perusahaan)} perusahaan yang cocok"
        if not rows:
            return Result(f"Belum ada siswa yang ditempatkan di {nama}.", sumber=["penempatan_pkl", "perusahaan_pkl"])
        shown, note = _potong(rows)
        cols = [("nama", "Nama"), ("kelas", "Kelas"), ("posisi", "Posisi"), ("sesi", "Sesi"), ("status", "Status")]
        if len(perusahaan) > 1:  # tabel harus menyebut perusahaannya
            cols.insert(2, ("perusahaan", "Perusahaan"))
        kolom, baris = table_from(shown, cols)
        return Result(f"{len(rows)} siswa PKL di {nama}{note}.", kolom, baris, ["penempatan_pkl", "perusahaan_pkl", "siswa"])
    if p.get("kelas") and not resolver.find_siswa_in_text(db, pesan, p.get("siswa")):
        rows = db.rows(queries.PKL_KELAS, kelas=p["kelas"])
        kolom, baris = table_from(rows, [("no_absen", "No"), ("nama", "Nama"), ("perusahaan", "Perusahaan"), ("posisi", "Posisi"), ("sesi", "Sesi"), ("status", "Status")])
        return Result(f"Penempatan PKL {p['kelas'].replace('-', ' ')}: {len(rows)} siswa.", kolom, baris, ["penempatan_pkl", "perusahaan_pkl", "siswa"])
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
    e = resolver.find_ekskul(db, pesan, p.get("ekskul"))
    if e:
        sem = int(p.get("semester") or _sem_berjalan(db))
        anggota = db.rows(queries.EKSKUL_ANGGOTA, kode=e["kode"], semester=sem)
        shown, note = _potong(anggota)
        kolom, baris = table_from(shown, [("nama", "Nama"), ("kelas", "Kelas"), ("nilai", "Nilai"), ("predikat", "Predikat")])
        teks = (f"{e['nama']}: {e['deskripsi']} Jadwal {e['hari']}, {e['waktu']}. Ketua: {e['ketua'] or '-'}; pembina: {e['pembina'] or '-'}. "
                f"Anggota kelas XII semester {sem}: {len(anggota)} siswa{note}.")
        return Result(teks, kolom, baris, ["ekstrakurikuler", "pembina_ekskul", "partisipasi_ekskul", "siswa"])
    rows = resolver.find_siswa_in_text(db, pesan, p.get("siswa"))
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
    if tingkat or "sanksi" in low and "pelanggaran" in low:
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


def tidak_dikenali(db: Db, p: dict, pesan: str) -> Result:
    return _tanya("Maaf, saya belum paham pertanyaannya. Saya bisa membantu soal siswa, nilai, kehadiran, pelanggaran, jadwal, "
                  "wali kelas, PKL, ekskul, dan profil sekolah (kelas XII). Contoh: " + " / ".join(f"\"{c}\"" for c in CONTOH[:3]))


HANDLERS = {
    "cari_siswa": cari_siswa, "profil_siswa": profil_siswa, "nilai_siswa": nilai_siswa, "ranking_kelas": ranking_kelas,
    "siswa_di_bawah_kkm": siswa_di_bawah_kkm, "rekap_kehadiran": rekap_kehadiran, "siswa_alpha_tinggi": siswa_alpha_tinggi,
    "pelanggaran_siswa": pelanggaran_siswa, "jadwal_kelas": jadwal_kelas, "jadwal_guru": jadwal_guru,
    "info_wali_kelas": info_wali_kelas, "penempatan_pkl": penempatan_pkl, "info_ekskul": info_ekskul,
    "info_sekolah": info_sekolah, "tidak_dikenali": tidak_dikenali,
}


def run(db: Db, intent: dict, pesan: str) -> Result:
    handler = HANDLERS.get(intent["intent"], tidak_dikenali)
    return handler(db, intent.get("params", {}), pesan)

"""Pembacaan teks pertanyaan: kelas, semester, hari, mapel, ambang. Dipakai oleh resolver dan parser aturan."""
import re

JURUSAN_KELAS = {"RPL": 3, "DKV": 2, "TITL": 6, "TOI": 3, "TAV": 3}
KELAS_VALID = {f"XII-{j}-{n}" for j, c in JURUSAN_KELAS.items() for n in range(1, c + 1)}
HARI = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat"]

_KELAS_RE = re.compile(r"\b(?:xii[\s-]*)?(rpl|dkv|titl|toi|tav)[\s-]*(\d+)\b")
_SCOPE_RE = re.compile(r"\bkelas\s*(?:x|xi|10|11)\b|\b(?:x|xi)[\s-]+(?:rpl|dkv|titl|toi|tav)\b")
_SEM_RE = re.compile(r"\bsemester\s*(?:ke[\s-]*)?([1-6])\b")
_HARI_RE = re.compile(r"\b(senin|selasa|rabu|kamis|jum'?at)\b")
_MAPEL = [
    (r"matematika|\bmtk\b", "MAT"),
    (r"bahasa inggris|b\.?\s?inggris|english", "B.ING"),
    (r"bahasa indonesia|b\.?\s?indonesia", "B.IND"),
    (r"bahasa sunda|b\.?\s?sunda|\bmulok\b", "B.SUN"),
    (r"\bsejarah\b", "SEJ"),
    (r"pancasila|\bpkn\b", "PP"),
    (r"pendidikan agama|\bpabp\b|\bpai\b", "PABP"),
    (r"pjok|olahraga|penjas", "PJOK"),
    (r"seni budaya", "SBD"),
    (r"informatika", "INF"),
    (r"pkwu|prakarya|kewirausahaan", "PKWU"),
]
_KK_RE = re.compile(r"\bkk\s*([1-3])\b")
_JUR_RE = re.compile(r"\b(rpl|dkv|titl|toi|tav)\b")


def normalize_kelas(text: str | None) -> str | None:
    """'XII TITL 6', 'titl6', 'xii-rpl-2' -> 'XII-TITL-6'. None bila tidak ada atau bukan kelas yang tersedia."""
    if not text:
        return None
    m = _KELAS_RE.search(text.lower())
    if not m:
        return None
    code = f"XII-{m.group(1).upper()}-{m.group(2)}"
    return code if code in KELAS_VALID else None


def mentions_unknown_kelas(text: str) -> bool:
    """Ada pola kelas tetapi nomornya tidak tersedia (mis. 'XII TITL 9')."""
    m = _KELAS_RE.search(text.lower())
    return bool(m) and normalize_kelas(text) is None


def outside_scope(text: str) -> bool:
    """Pertanyaan tentang kelas X atau XI (belum tersedia)."""
    low = text.lower()
    return bool(_SCOPE_RE.search(low)) and "xii" not in low


def relative_semester_offset(text: str) -> int | None:
    """Kembalikan 0 untuk 'semester ini', -1 untuk 'semester lalu', atau None bila tidak relatif/eksplisit."""
    low = text.lower()
    if _SEM_RE.search(low):
        return None
    if re.search(r"semester\s+(?:ini|sekarang|berjalan)", low):
        return 0
    if re.search(r"semester\s+(?:lalu|kemarin|sebelumnya)", low):
        return -1
    return None


def parse_semester(text: str, current: int = 5) -> int:
    """0 = tidak disebut."""
    low = text.lower()
    m = _SEM_RE.search(low)
    if m:
        return int(m.group(1))
    offset = relative_semester_offset(low)
    if offset is not None:
        return max(current + offset, 1)
    return 0


def parse_hari(text: str) -> str:
    m = _HARI_RE.search(text.lower())
    if not m:
        return ""
    return "Jumat" if m.group(1).startswith("jum") else m.group(1).capitalize()


def parse_jurusan(text: str) -> str:
    m = _JUR_RE.search(text.lower())
    return m.group(1).upper() if m else ""


def parse_mapel(text: str, kelas: str | None = None, jurusan: str = "") -> str:
    """Kode mapel rapor, atau '' bila tidak disebut / tidak bisa ditentukan."""
    low = text.lower()
    for pattern, code in _MAPEL:
        if re.search(pattern, low):
            return code
    m = _KK_RE.search(low)
    if m:
        jur = (kelas.split("-")[1] if kelas else "") or jurusan
        return f"{jur}-KK{m.group(1)}" if jur else ""
    return ""


def parse_ambang(text: str, default: int = 5) -> int:
    low = text.lower()
    m = re.search(r"(?:lebih dari|di atas|diatas|>)\s*(\d+)", low)
    if m:
        return int(m.group(1)) + 1
    m = re.search(r"(?:minimal|paling sedikit|>=)\s*(\d+)", low)
    if m:
        return int(m.group(1))
    m = re.search(r"(\d+)\s*(?:hari)?\s*(?:atau lebih|ke atas)", low)
    if m:
        return int(m.group(1))
    m = re.search(r"(\d+)\s*hari\b", low)
    if m:
        return int(m.group(1))
    return default


_NUM_WORD_MAP = {
    "empat puluh": 40,
    "tiga puluh": 30,
    "dua puluh lima": 25,
    "dua puluh": 20,
    "lima belas": 15,
    "empat belas": 14,
    "tiga belas": 13,
    "dua belas": 12,
    "sebelas": 11,
    "sepuluh": 10,
    "sembilan": 9,
    "delapan": 8,
    "tujuh": 7,
    "enam": 6,
    "lima": 5,
    "empat": 4,
    "tiga": 3,
    "dua": 2,
    "satu": 1,
}
_NUM_WORDS_ALT = "|".join(sorted(_NUM_WORD_MAP, key=len, reverse=True))
_LIMIT_NOUNS = (
    r"siswa|murid|pelajar|anak|guru|kelas|ekskul|perusahaan|mitra|"
    r"teratas|terbaik|tertinggi|terendah|terburuk|terbanyak|terbesar|terkecil|terberat|besar|data|baris"
)


def parse_poin_filter(text: str) -> tuple[str, int, int]:
    """Ekstrak filter angka poin pelanggaran -> (op, pmin, pmax).

    op in ('', '=', '>', '>=', '<', '<=', 'between').
    Untuk '=' dikembalikan ('=', n, n); untuk 'between' dikembalikan ('between', lo, hi);
    untuk '>', '>=', '<', '<=' dikembalikan (op, n, 0).
    """
    low = (text or "").lower()
    has_poin = bool(re.search(r"\bpoin(?:nya)?\b", low))
    has_non_poin_metric = bool(
        re.search(r"\b(alpha|alpa|hari|nilai|kkm|semester|jam|menit|persen|usia|umur|absen)\b", low)
    )
    if not has_poin and has_non_poin_metric:
        return ("", 0, 0)

    # 1. Rentang (between): 'poin 50 sampai 80', 'poin antara 50 dan 80', '50-80 poin'
    for pat in (
        r"\bpoin(?:nya)?(?:\s+pelanggaran(?:nya)?)?\s*(?:antara|dari)?\s*(\d{1,4})\s*"
        r"(?:sampai(?:\s+dengan)?|hingga|s\.?d\.?|dan|-|–)\s*(\d{1,4})\b",
        r"\b(?:antara|dari)\s*(\d{1,4})\s*(?:sampai(?:\s+dengan)?|hingga|s\.?d\.?|dan|-|–)\s*(\d{1,4})\s*poin\b",
        r"\b(\d{1,4})\s*(?:-|–|sampai(?:\s+dengan)?|hingga|s\.?d\.?)\s*(\d{1,4})\s*poin\b",
    ):
        m = re.search(pat, low)
        if m:
            a, b = int(m.group(1)), int(m.group(2))
            return ("between", min(a, b), max(a, b))

    # 2. >= : 'minimal 75 poin', 'poin >= 75', '75 poin atau lebih', 'poin minimal 75'
    for pat in (
        r"\bpoin(?:nya)?(?:\s+pelanggaran(?:nya)?)?\s*(?:>=|minimal|paling\s+sedikit|setidaknya|sekurang[\s-]*kurangnya)\s*(\d{1,4})\b",
        r"(?:>=|\bminimal|\bpaling\s+sedikit|\bsetidaknya|\bsekurang[\s-]*kurangnya)\s*(\d{1,4})\s*poin\b",
        r"\b(\d{1,4})\s*poin\s*(?:atau\s+lebih|ke\s+atas|keatas)\b",
        r"\bpoin(?:nya)?(?:\s+pelanggaran(?:nya)?)?\s*(\d{1,4})\s*(?:atau\s+lebih|ke\s+atas|keatas)\b",
    ):
        m = re.search(pat, low)
        if m:
            return (">=", int(m.group(1)), 0)
    if not has_non_poin_metric:
        m = re.search(r"(?:^|\s)>=\s*(\d{1,4})\b", low)
        if m:
            return (">=", int(m.group(1)), 0)

    # 3. <= : 'maksimal 25 poin', 'poin <= 25', 'poin maksimal 25'
    for pat in (
        r"\bpoin(?:nya)?(?:\s+pelanggaran(?:nya)?)?\s*(?:<=|maksimal|maks\.?|paling\s+banyak|tidak\s+lebih\s+dari|paling\s+tinggi)\s*(\d{1,4})\b",
        r"(?:<=|\bmaksimal|\bmaks\.?|\bpaling\s+banyak|\btidak\s+lebih\s+dari)\s*(\d{1,4})\s*poin\b",
        r"\b(\d{1,4})\s*poin\s*(?:atau\s+kurang|ke\s+bawah|kebawah)\b",
        r"\bpoin(?:nya)?(?:\s+pelanggaran(?:nya)?)?\s*(\d{1,4})\s*(?:atau\s+kurang|ke\s+bawah|kebawah)\b",
    ):
        m = re.search(pat, low)
        if m:
            return ("<=", int(m.group(1)), 0)
    if not has_non_poin_metric:
        m = re.search(r"(?:^|\s)<=\s*(\d{1,4})\b", low)
        if m:
            return ("<=", int(m.group(1)), 0)

    # 4. > : 'poin di atas 50', 'lebih dari 50 poin', '> 50'
    for pat in (
        r"\bpoin(?:nya)?(?:\s+pelanggaran(?:nya)?)?\s*(?:>|di\s+atas|diatas|lebih\s+dari|melebihi|lebih\s+besar\s+dari)\s*(\d{1,4})\b",
        r"(?:>|\bdi\s+atas|\bdiatas|\blebih\s+dari|\bmelebihi|\blebih\s+besar\s+dari)\s*(\d{1,4})\s*poin\b",
    ):
        m = re.search(pat, low)
        if m:
            return (">", int(m.group(1)), 0)
    if not has_non_poin_metric:
        m = re.search(r"(?:^|\s)>\s*(\d{1,4})\b", low)
        if m:
            return (">", int(m.group(1)), 0)

    # 5. < : 'poin di bawah 30', 'kurang dari 30 poin', '< 30'
    for pat in (
        r"\bpoin(?:nya)?(?:\s+pelanggaran(?:nya)?)?\s*(?:<|di\s+bawah|dibawah|kurang\s+dari|lebih\s+kecil\s+dari)\s*(\d{1,4})\b",
        r"(?:<|\bdi\s+bawah|\bdibawah|\bkurang\s+dari|\blebih\s+kecil\s+dari)\s*(\d{1,4})\s*poin\b",
    ):
        m = re.search(pat, low)
        if m:
            return ("<", int(m.group(1)), 0)
    if not has_non_poin_metric:
        m = re.search(r"(?:^|\s)<\s*(\d{1,4})\b", low)
        if m:
            return ("<", int(m.group(1)), 0)

    # 6. = (tepat): 'total poin pelanggarannya 80', 'poin pelanggaran 80', 'poinnya 80', 'poin = 80', 'dengan poin 80'
    if has_poin:
        for pat in (
            r"\bpoin(?:nya)?(?:\s+pelanggaran(?:nya)?)?\s*(?:==|=|sebesar|sebanyak|tepat|adalah|yaitu|:)?\s*(\d{1,4})\b",
            r"\b(\d{1,4})\s*poin\b",
        ):
            m = re.search(pat, low)
            if m:
                n = int(m.group(1))
                return ("=", n, n)

    return ("", 0, 0)


def parse_limit(text: str, default: int = 0) -> int:
    """Ambil batas jumlah baris dari pertanyaan (mis. '3 murid', 'top 5', 'lima siswa'), dibatasi 1..40."""
    low = text.lower()
    # Bersihkan angka yang bukan batas jumlah baris (kelas, semester, sesi, tahun, jam/hari/poin/kkm).
    cleaned = _KELAS_RE.sub(" ", low)
    cleaned = _SEM_RE.sub(" ", cleaned)
    cleaned = _KK_RE.sub(" ", cleaned)
    cleaned = re.sub(r"\bsesi\s*(?:ke[\s-]*)?[12]\b", " ", cleaned)
    cleaned = re.sub(
        r"\bpoin(?:nya)?(?:\s+pelanggaran(?:nya)?)?\s*"
        r"(?:(?:antara|dari)?\s*\d+\s*(?:sampai(?:\s+dengan)?|hingga|s\.?d\.?|dan|-|–)\s*\d+"
        r"|(?:>=|<=|>|<|==|=|di\s+atas|diatas|di\s+bawah|dibawah|lebih\s+dari|kurang\s+dari|"
        r"minimal|maksimal|maks\.?|paling\s+sedikit|paling\s+banyak|sebesar|sebanyak|tepat|adalah|yaitu|:)?\s*\d+)\b",
        " ",
        cleaned,
    )
    cleaned = re.sub(
        r"\b(?:antara|dari)?\s*\d+\s*(?:-|–|sampai(?:\s+dengan)?|hingga|s\.?d\.?|dan)\s*\d+\s*poin\b",
        " ",
        cleaned,
    )
    cleaned = re.sub(
        r"(?:\b(?:minimal|maksimal|maks\.?|lebih\s+dari|kurang\s+dari|di\s+atas|diatas|di\s+bawah|dibawah|"
        r"sebesar|sebanyak|tepat)|>=|<=|>|<|=)\s*\d+\s*poin\b",
        " ",
        cleaned,
    )
    cleaned = re.sub(r"\b(?:kkm|poin|tahun)\s*\d+\b", " ", cleaned)
    cleaned = re.sub(r"\b\d+\s*(?:hari|poin|jam|menit|persen|%)\b", " ", cleaned)
    cleaned = re.sub(r"\b\d{4,}\b", " ", cleaned)

    m = re.search(rf"\b(?:top|peringkat|rank)\s*(\d{{1,3}})\b", cleaned)
    if not m:
        m = re.search(rf"\b(\d{{1,3}})\s*(?:orang\s+)?(?:{_LIMIT_NOUNS})\b", cleaned)
    if not m:
        m = re.search(rf"\b(?:maksimal|maks|sebanyak|sejumlah)\s+(\d{{1,3}})\b", cleaned)
    if m:
        return max(1, min(int(m.group(1)), 40))

    mw = re.search(rf"\btop\s+({_NUM_WORDS_ALT})\b", cleaned)
    if not mw:
        mw = re.search(rf"\b({_NUM_WORDS_ALT})\s*(?:orang\s+)?(?:{_LIMIT_NOUNS})\b", cleaned)
    if mw:
        val = _NUM_WORD_MAP.get(mw.group(1), 0)
        if val:
            return max(1, min(val, 40))
    return default


def parse_tingkat_pelanggaran(text: str) -> str:
    """Kembalikan 'Ringan', 'Sedang', 'Berat', atau '' bila tidak disebut."""
    low = text.lower()
    if re.search(r"\bberat\b", low):
        return "Berat"
    if re.search(r"\bringan\b", low):
        return "Ringan"
    if re.search(r"\bsedang\b", low):
        # Hindari salah baca kata kerja progresif 'sedang dibangun' / 'sedang berlangsung' / 'sedang PKL'.
        if re.search(
            r"\bsedang\s+(?:dibangun|berlangsung|berjalan|pkl|magang|mengajar|belajar|sakit|izin|bertugas|"
            r"cuti|libur|aktif|mencari|menunggu|diproses|terjadi|ada)\b",
            low,
        ):
            return ""
        if re.search(
            r"\b(?:tingkat|kategori|pelanggaran(?:\s+tingkat)?|sanksi(?:\s+pelanggaran)?|poin|yang)\s+sedang\b"
            r"|^\s*sedang(?:\s+saja|\s+aja)?\s*[?!.]*\s*$",
            low,
        ):
            return "Sedang"
    return ""


def parse_urutan(text: str, default: str = "desc") -> str:
    """Kembalikan 'asc' untuk terendah/terburuk, 'desc' untuk tertinggi/terbaik, atau default."""
    low = text.lower()
    if re.search(
        r"\b(terendah|terburuk|paling\s+rendah|paling\s+buruk|paling\s+kecil|paling\s+sedikit|"
        r"tersedikit|terkecil|terbawah|naik|asc)\b",
        low,
    ):
        return "asc"
    if re.search(
        r"\b(tertinggi|terbaik|paling\s+tinggi|paling\s+bagus|paling\s+baik|paling\s+banyak|"
        r"terbanyak|teratas|juara|top|terbesar|terberat|turun|desc)\b",
        low,
    ):
        return "desc"
    return default


def mentions_all_scope(text: str) -> bool:
    """True bila pertanyaan eksplisit menyebut seluruh kelas / satu sekolah."""
    low = text.lower()
    return bool(
        re.search(
            r"\b(seluruh\s+(?:kelas|siswa|murid|sekolah|xii)|"
            r"semua\s+(?:kelas|siswa|murid|jurusan|xii)|"
            r"satu\s+sekolah|se[\s-]*sekolah|sesekolah|"
            r"kelas\s+xii\s+semua|secara\s+keseluruhan|tingkat\s+sekolah|global)\b",
            low,
        )
    )


def parse_pkl_sesi(text: str) -> int:
    """Kembalikan sesi PKL (1 atau 2), atau 0 bila tidak disebut."""
    m = re.search(r"\bsesi\s*(?:ke[\s-]*)?([12])\b", text.lower())
    return int(m.group(1)) if m else 0


def parse_pkl_status(text: str) -> str:
    """Kembalikan 'Selesai', 'Sedang berlangsung', atau '' bila tidak disebut."""
    low = text.lower()
    has_selesai = bool(re.search(r"\b(?:sudah\s+selesai|telah\s+selesai|selesai)\b", low))
    has_berlangsung = bool(
        re.search(r"\b(?:sedang\s+berlangsung|masih\s+berlangsung|berlangsung|belum\s+selesai|masih\s+pkl|sedang\s+pkl)\b", low)
    )
    if has_berlangsung and not (has_selesai and "belum selesai" not in low):
        return "Sedang berlangsung"
    if has_selesai and not has_berlangsung:
        return "Selesai"
    return ""


def parse_gender(text: str) -> str:
    """Kembalikan 'L', 'P', atau '' (termasuk bila keduanya disebut)."""
    low = text.lower()
    has_l = bool(re.search(r"\b(laki[\s-]*laki|laki|pria|cowok)\b", low))
    has_p = bool(re.search(r"\b(perempuan|wanita|cewek|siswi)\b", low))
    if has_l and not has_p:
        return "L"
    if has_p and not has_l:
        return "P"
    return ""


STOP_WORDS = {
    "yang", "dan", "di", "ke", "dari", "untuk", "dengan", "pada", "itu", "ini", "apa", "siapa", "berapa", "bagaimana",
    "adalah", "saja", "semua", "tolong", "mohon", "minta", "tampilkan", "lihat", "tunjukkan", "berikan", "kasih", "cari",
    "carikan", "data", "info", "informasi", "tentang", "mengenai", "punya", "milik", "nya", "lagi", "dong", "ya", "kah",
    "nilai", "nilainya", "rapor", "rata", "rata-rata", "semester", "kelas", "siswa", "murid", "anak", "pak", "bu",
    "bapak", "ibu", "guru", "wali", "jadwal", "mengajar", "pkl", "magang", "prakerin", "ekskul", "ekstrakurikuler", "ekstra",
    "kehadiran", "absensi", "presensi", "hadir", "alpha", "alpa", "sakit", "izin", "bolos", "pelanggaran", "poin", "sanksi",
    "kkm", "remedial", "tuntas", "belum", "tidak", "bawah", "ranking", "peringkat", "tertinggi", "terendah", "terbaik",
    "juara", "teratas", "profil", "biodata", "hari", "lebih", "kurang", "minimal", "tempat", "dimana", "mana", "kapan",
    "xii", "sekolah", "smkn", "bandung", "jurusan", "mapel", "pelajaran", "mata", "lalu", "kemarin", "sebelumnya", "sekarang",
    "berjalan", "senin", "selasa", "rabu", "kamis", "jumat", "jum'at", "pembimbing", "perusahaan", "posisi", "ketua",
    "anggota", "daftar", "list", "semuanya", "setiap", "per", "satu", "dua", "tiga", "ada", "banyak", "jumlah", "total",
    "matematika", "indonesia", "inggris", "sunda", "bahasa", "sejarah", "pancasila", "agama", "olahraga", "informatika",
    # Kata analitik, filter, dan sapaan (agar tidak terbaca sebagai nama orang di resolver.name_tokens)
    "berat", "ringan", "sedang", "melakukan", "butuh", "paling", "seluruh", "terbanyak", "terburuk", "laki", "perempuan",
    "statistik", "rekap", "ringkasan", "saya", "kami", "kita", "kamu", "anda", "mereka", "bantu", "ingin", "mau", "perlu",
    "memiliki", "tercatat", "mendapat", "mendapatkan", "mengikuti", "ikut", "aktif", "berlangsung", "selesai", "sesi",
    "status", "mitra", "industri", "kota", "kuota", "bidang", "usaha", "gender", "kelamin", "jenis", "pria", "wanita",
    "siswi", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "top", "besar", "kecil", "sedikit",
    "tersedikit", "terbesar", "terkecil", "terberat", "terbawah", "terpopuler", "populer", "favorit", "tingkat", "kategori",
    "catatan", "kejadian", "terakhir", "terbaru", "tiap", "hanya", "cuma", "masih", "sudah", "telah", "akan", "pernah",
    "bukan", "jangan", "atau", "serta", "maupun", "seperti", "rincian", "detail", "rekapan", "pengajar", "pembina",
    "peserta", "pelajar", "orang", "kejuruan", "umum", "konsentrasi", "program", "keahlian", "kegiatan", "organisasi",
    "lomba", "prestasi", "fasilitas", "aturan", "peraturan", "tata", "tertib", "melanggar", "ruang", "ruangan", "jam",
    "rpl", "dkv", "titl", "toi", "tav", "kalau", "kalo", "rendah", "tinggi", "baik", "buruk", "dibangun",
    "halo", "hai", "hello", "selamat", "pagi", "siang", "sore", "malam", "terima", "kasih", "makasih", "assalamualaikum",
    "dieksekusi", "diikuti", "pelanggarannya", "poinnya", "totalnya", "anggotanya", "rinciannya", "pesertanya", "terdaftar",
    "tepat", "sampai", "antara", "maksimal", "sebesar", "sebanyak", "sejumlah", "diatas", "dibawah", "atas",
    "siswanya", "daftarnya", "ekskulnya", "kelasnya",
}


def name_tokens(text: str) -> list[str]:
    """Kata-kata yang mungkin bagian dari nama orang/perusahaan setelah membuang kata kunci dan pola kelas."""
    low = _KELAS_RE.sub(" ", text.lower())
    low = _SEM_RE.sub(" ", low)
    toks = re.findall(r"[a-z']+", low)
    return [t for t in toks if len(t) >= 3 and t not in STOP_WORDS]

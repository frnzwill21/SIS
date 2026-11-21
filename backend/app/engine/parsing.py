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


STOP_WORDS = {
    "yang", "dan", "di", "ke", "dari", "untuk", "dengan", "pada", "itu", "ini", "apa", "siapa", "berapa", "bagaimana",
    "adalah", "saja", "semua", "tolong", "mohon", "minta", "tampilkan", "lihat", "tunjukkan", "berikan", "kasih", "cari",
    "carikan", "data", "info", "informasi", "tentang", "mengenai", "punya", "milik", "nya", "lagi", "dong", "ya", "kah",
    "nilai", "nilainya", "rapor", "rata", "rata-rata", "semester", "ini", "kelas", "siswa", "murid", "anak", "pak", "bu",
    "bapak", "ibu", "guru", "wali", "jadwal", "mengajar", "pkl", "magang", "prakerin", "ekskul", "ekstrakurikuler", "ekstra",
    "kehadiran", "absensi", "presensi", "hadir", "alpha", "alpa", "sakit", "izin", "bolos", "pelanggaran", "poin", "sanksi",
    "kkm", "remedial", "tuntas", "belum", "tidak", "bawah", "ranking", "peringkat", "tertinggi", "terendah", "terbaik",
    "juara", "teratas", "profil", "biodata", "hari", "lebih", "kurang", "minimal", "tempat", "dimana", "mana", "kapan",
    "xii", "sekolah", "smkn", "bandung", "jurusan", "mapel", "pelajaran", "mata", "lalu", "kemarin", "sebelumnya", "sekarang",
    "berjalan", "senin", "selasa", "rabu", "kamis", "jumat", "jum'at", "pembimbing", "perusahaan", "posisi", "ketua",
    "anggota", "daftar", "list", "semuanya", "setiap", "per", "satu", "dua", "tiga", "ada", "banyak", "jumlah", "total",
    "matematika", "indonesia", "inggris", "sunda", "bahasa", "sejarah", "pancasila", "agama", "olahraga", "informatika",
}


def name_tokens(text: str) -> list[str]:
    """Kata-kata yang mungkin bagian dari nama orang/perusahaan setelah membuang kata kunci dan pola kelas."""
    low = _KELAS_RE.sub(" ", text.lower())
    low = _SEM_RE.sub(" ", low)
    toks = re.findall(r"[a-z']+", low)
    return [t for t in toks if len(t) >= 3 and t not in STOP_WORDS]

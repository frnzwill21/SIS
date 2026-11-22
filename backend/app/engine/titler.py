"""Penamaan otomatis (Smart Auto-Titling) untuk sesi percakapan chat."""
import re
from typing import Any

from . import gemini

DEFAULT_TITLE = "Percakapan Baru"
MAX_TITLE_LEN = 60

_SYSTEM_PROMPT = (
    "Buat judul percakapan singkat 3-6 kata dalam Bahasa Indonesia (Title Case), "
    "tanpa tanda kutip, tanpa emoji, tanpa titik akhir, dan tanpa nomor NIS/NISN."
)

_ACRONYMS = {
    "xii", "rpl", "dkv", "titl", "toi", "tav", "pkl", "kkm", "bk", "smkn", "smk",
    "pln", "nhk", "pai", "pabp", "pjok", "pkwu", "kik", "mp", "iduka", "os", "ai",
    "kk1", "kk2", "kk3", "kk4", "sql",
}

_LEAD_FILLERS = {
    "tolong", "mohon", "minta", "coba", "bisa", "boleh", "saya", "aku", "kami",
    "butuh", "ingin", "mau", "perlu", "berikan", "tampilkan", "tunjukkan", "lihat",
    "kasih", "carikan", "cari", "apakah", "siapa", "siapakah", "berapa", "apa",
    "bagaimana", "gimana", "dimana", "di", "mana", "ada", "dong", "ya", "nih",
    "halo", "hai", "hi", "hello", "selamat", "pagi", "siang", "sore", "malam",
}

_EMOJI_RE = re.compile(
    "["
    "\U0001F300-\U0001FAFF"
    "\U00002600-\U000027BF"
    "\U0001F1E0-\U0001F1FF"
    "\U0000FE0F"
    "]+",
    flags=re.UNICODE,
)


def _fmt_kelas(kelas: str) -> str:
    return (kelas or "").replace("-", " ").strip()


def _truncate(text: str, max_len: int = MAX_TITLE_LEN) -> str:
    text = " ".join(text.split()).strip()
    if len(text) <= max_len:
        return text
    cut = text[:max_len].rsplit(" ", 1)[0].strip()
    return cut if len(cut) >= 12 else text[:max_len].strip()


def _title_word(word: str) -> str:
    low = word.lower()
    if low in _ACRONYMS:
        return low.upper()
    if low in ("dan", "di", "ke", "dari", "per", "untuk"):
        return low.capitalize()
    return word[:1].upper() + word[1:].lower() if word else ""


def _clean_title(raw: str) -> str:
    if not raw:
        return ""
    first_line = next((ln.strip() for ln in raw.splitlines() if ln.strip()), "")
    s = _EMOJI_RE.sub("", first_line)
    # Hapus kutipan, bullet markdown, simbol tak perlu, dan angka NIS/NISN (6-10 digit)
    s = re.sub(r'^[\s"\'“”‘’`*#\-•:]+', "", s)
    s = re.sub(r'[\s"\'“”‘’`*#.,;!?:\-—]+$', "", s)
    s = s.replace('"', "").replace("'", "").replace("`", "").replace("*", "")
    s = re.sub(r"\b\d{6,10}\b", "", s)
    s = " ".join(s.split()).strip()
    s = _truncate(s, MAX_TITLE_LEN)
    s = s.rstrip(".,;:!?-— ").strip()
    return s


def _summary_from_pesan(pesan: str) -> str:
    cleaned = _EMOJI_RE.sub("", pesan or "")
    cleaned = re.sub(r"\b\d{6,10}\b", " ", cleaned)
    cleaned = re.sub(r"[?!.,;:\"'`()\[\]{}]+", " ", cleaned)
    raw_words = [w for w in cleaned.split() if w]
    while raw_words and raw_words[0].lower() in _LEAD_FILLERS:
        raw_words.pop(0)
    if not raw_words:
        raw_words = [w for w in cleaned.split() if w]
    words = [_title_word(w) for w in raw_words[:6]]
    out = _clean_title(" ".join(words))
    return out or DEFAULT_TITLE


def _clean_entity_name(val: str) -> str:
    s = re.sub(r"\b\d{6,10}\b", "", str(val or "")).strip()
    if not s:
        return ""
    return " ".join(_title_word(w) for w in s.split()[:3])


def _rule_title(pesan: str, intent: dict | None) -> str:
    intent_name = str((intent or {}).get("intent") or "").strip()
    params: dict[str, Any] = dict((intent or {}).get("params") or {})

    if intent_name == "sapaan":
        return DEFAULT_TITLE

    kelas = _fmt_kelas(str(params.get("kelas") or ""))
    jurusan = str(params.get("jurusan") or "").strip().upper()
    scope = kelas or (f"Jurusan {jurusan}" if jurusan else "Siswa XII")

    if intent_name == "pelanggaran_siswa":
        poin_op = str(params.get("poin_op") or "").strip().lower()
        poin_min = params.get("poin_min")
        poin_max = params.get("poin_max")
        tingkat = str(params.get("tingkat") or "").strip().capitalize()
        if poin_op and poin_min is not None:
            if poin_op == "=":
                return _clean_title(f"Siswa Poin Pelanggaran {poin_min}")
            if poin_op == ">":
                return _clean_title(f"Poin Pelanggaran Di Atas {poin_min}")
            if poin_op == ">=":
                return _clean_title(f"Poin Pelanggaran Minimal {poin_min}")
            if poin_op == "<":
                return _clean_title(f"Poin Pelanggaran Di Bawah {poin_min}")
            if poin_op == "<=":
                return _clean_title(f"Poin Pelanggaran Maksimal {poin_min}")
            if poin_op == "between" and poin_max is not None:
                return _clean_title(f"Poin Pelanggaran {poin_min}-{poin_max}")
        if tingkat:
            return _clean_title(f"Pelanggaran {tingkat} {scope}")
        if kelas or jurusan:
            return _clean_title(f"Pelanggaran {scope}")
        siswa = _clean_entity_name(params.get("siswa") or "")
        if siswa:
            return _clean_title(f"Pelanggaran Siswa {siswa}")
        return "Catatan Pelanggaran Siswa"

    if intent_name == "info_ekskul":
        ekskul = str(params.get("ekskul") or "").strip()
        if ekskul and kelas:
            return _clean_title(f"Ekskul {ekskul} {kelas}")
        if ekskul:
            return _clean_title(f"Ekskul {ekskul}")
        if kelas:
            return _clean_title(f"Ekskul Siswa {kelas}")
        if jurusan:
            return _clean_title(f"Ekskul Jurusan {jurusan}")
        siswa = _clean_entity_name(params.get("siswa") or "")
        if siswa:
            return _clean_title(f"Ekskul Siswa {siswa}")
        return "Daftar Ekstrakurikuler Sekolah"

    if intent_name == "ranking_kelas":
        urutan = str(params.get("urutan") or "desc").lower()
        lbl = "Terendah" if urutan == "asc" else "Tertinggi"
        loc = kelas or jurusan or "XII"
        return _clean_title(f"Peringkat Nilai {lbl} {loc}")

    if intent_name == "siswa_di_bawah_kkm":
        loc = kelas or jurusan or "XII"
        return _clean_title(f"Nilai Di Bawah KKM {loc}")

    if intent_name == "nilai_siswa":
        siswa = _clean_entity_name(params.get("siswa") or "")
        mapel = str(params.get("mapel") or "").strip()
        if siswa:
            return _clean_title(f"Nilai Siswa {siswa}")
        if mapel:
            return _clean_title(f"Nilai Mapel {mapel}")
        return _summary_from_pesan(pesan)

    if intent_name == "rekap_kehadiran":
        if kelas:
            return _clean_title(f"Rekap Kehadiran {kelas}")
        siswa = _clean_entity_name(params.get("siswa") or "")
        if siswa:
            return _clean_title(f"Kehadiran Siswa {siswa}")
        return "Rekap Kehadiran Siswa"

    if intent_name == "siswa_alpha_tinggi":
        loc = kelas or jurusan or "XII"
        return _clean_title(f"Siswa Alpha Tinggi {loc}")

    if intent_name == "jadwal_kelas":
        hari = str(params.get("hari") or "").strip().capitalize()
        if kelas and hari:
            return _clean_title(f"Jadwal {kelas} Hari {hari}")
        if kelas:
            return _clean_title(f"Jadwal Pelajaran {kelas}")
        return "Jadwal Pelajaran Kelas"

    if intent_name == "jadwal_guru":
        guru = _clean_entity_name(params.get("guru") or "")
        mapel = str(params.get("mapel") or "").strip()
        if guru:
            return _clean_title(f"Jadwal Mengajar {guru}")
        if mapel:
            return _clean_title(f"Guru Mapel {mapel}")
        return "Jadwal Mengajar Guru"

    if intent_name == "info_wali_kelas":
        if kelas:
            return _clean_title(f"Wali Kelas {kelas}")
        if jurusan:
            return _clean_title(f"Wali Kelas Jurusan {jurusan}")
        return "Daftar Wali Kelas XII"

    if intent_name == "penempatan_pkl":
        perusahaan = str(params.get("perusahaan") or "").strip()
        if kelas:
            return _clean_title(f"Penempatan PKL {kelas}")
        if jurusan:
            return _clean_title(f"Penempatan PKL {jurusan}")
        if perusahaan:
            return _clean_title(f"Siswa PKL {perusahaan}")
        return "Penempatan PKL Siswa"

    if intent_name == "statistik_sekolah":
        if kelas:
            return _clean_title(f"Statistik Siswa {kelas}")
        if jurusan:
            return _clean_title(f"Statistik Jurusan {jurusan}")
        return "Statistik Data Sekolah"

    if intent_name == "cari_siswa":
        if kelas:
            return _clean_title(f"Daftar Siswa {kelas}")
        return _summary_from_pesan(pesan)

    if intent_name == "profil_siswa":
        siswa = _clean_entity_name(params.get("siswa") or "")
        if siswa:
            return _clean_title(f"Profil Siswa {siswa}")
        return _summary_from_pesan(pesan)

    return _summary_from_pesan(pesan)


def generate_session_title(pesan: str, intent: dict | None = None) -> str:
    """Buat judul sesi percakapan singkat & informatif (Gemini cepat bila aktif, fallback deterministik)."""
    intent_name = str((intent or {}).get("intent") or "").strip()
    if intent_name == "sapaan":
        return DEFAULT_TITLE

    if gemini.enabled():
        try:
            prompt = f"Pertanyaan pengguna: {(pesan or '').strip()[:300]}"
            if intent_name:
                prompt += f"\nTopik terdeteksi: {intent_name}"
            raw = gemini.generate(_SYSTEM_PROMPT, prompt, json_mode=False, timeout=3)
            if raw:
                cleaned = _clean_title(raw)
                if len(cleaned) >= 3:
                    return cleaned
        except Exception:  # noqa: BLE001
            pass

    return _rule_title(pesan, intent)

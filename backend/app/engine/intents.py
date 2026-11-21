"""Katalog intent + pemahaman pertanyaan.

Dua jalur menghasilkan intent JSON yang SAMA bentuknya:
  1. Gemini (bila GEMINI_API_KEY diisi) -> JSON -> divalidasi terhadap katalog ini.
  2. Parser aturan (kata kunci) bila Gemini tidak aktif atau gagal.
AI tidak pernah membuat SQL; ia hanya memilih intent dan mengisi parameter.
"""
import json
import re

from . import gemini
from .parsing import (
    mentions_unknown_kelas,
    normalize_kelas,
    parse_ambang,
    parse_hari,
    parse_jurusan,
    parse_mapel,
    parse_semester,
)

INTENTS = {
    "cari_siswa": "Mencari siswa berdasarkan nama/NIS atau melihat daftar siswa satu kelas. params: siswa, kelas",
    "profil_siswa": "Profil satu siswa (kelas, wali kelas, PKL, ekskul). params: siswa",
    "nilai_siswa": "Nilai satu siswa. params: siswa, semester (1-6, opsional), mapel (opsional)",
    "ranking_kelas": "Peringkat rata-rata nilai dalam satu kelas. params: kelas, semester, mapel (opsional)",
    "siswa_di_bawah_kkm": "Siswa dengan nilai di bawah KKM. params: kelas (opsional), semester, mapel (opsional)",
    "rekap_kehadiran": "Rekap sakit/izin/alpha/hadir satu siswa atau satu kelas. params: siswa atau kelas, semester (opsional)",
    "siswa_alpha_tinggi": "Siswa dengan alpha tinggi. params: kelas (opsional), semester, ambang (jumlah hari alpha minimal)",
    "pelanggaran_siswa": "Catatan pelanggaran satu siswa atau satu kelas. params: siswa atau kelas",
    "jadwal_kelas": "Jadwal pelajaran satu kelas. params: kelas, hari (opsional)",
    "jadwal_guru": "Jadwal mengajar satu guru. params: guru",
    "info_wali_kelas": "Wali kelas suatu kelas, atau kelas yang diwalikan seorang guru. params: kelas atau guru",
    "penempatan_pkl": "Penempatan PKL satu siswa, satu kelas, atau satu perusahaan. params: siswa, kelas, atau perusahaan",
    "info_ekskul": "Info ekstrakurikuler, atau anggota satu ekskul. params: ekskul (opsional), siswa (opsional)",
    "info_sekolah": "Profil sekolah, visi misi, tata tertib, sanksi, prestasi, fasilitas, mitra industri. params: topik",
}
PARAM_KEYS = {"siswa", "kelas", "semester", "mapel", "hari", "guru", "perusahaan", "ekskul", "ambang", "topik"}

CONTOH = [
    "Siapa wali kelas XII TITL 6?",
    "Siswa XII RPL 2 yang nilainya di bawah KKM semester 5",
    "Siapa saja yang alpha lebih dari 5 hari semester ini?",
    "Di mana Aditya Ramadhan PKL?",
    "Apa sanksi untuk pelanggaran tingkat sedang?",
]


def _has(text: str, pattern: str) -> bool:
    return bool(re.search(pattern, text))


def rule_intent(pesan: str) -> dict:
    """Parser kata kunci -> {"intent", "params"}. Nama orang diselesaikan kemudian oleh resolver."""
    low = pesan.lower()
    kelas = normalize_kelas(pesan)
    params: dict = {}
    if kelas:
        params["kelas"] = kelas
    sem = parse_semester(pesan)
    if sem:
        params["semester"] = sem
    hari = parse_hari(pesan)
    if hari:
        params["hari"] = hari
    mapel = parse_mapel(pesan, kelas, parse_jurusan(pesan))
    if mapel:
        params["mapel"] = mapel

    def out(name: str) -> dict:
        return {"intent": name, "params": params}

    if _has(low, r"\bwali\b"):
        return out("info_wali_kelas")
    if _has(low, r"\bjadwal\b|\bmengajar\b"):
        return out("jadwal_kelas" if (kelas or mentions_unknown_kelas(pesan)) else "jadwal_guru")
    if _has(low, r"\bpkl\b|magang|prakerin"):
        return out("penempatan_pkl")
    if _has(low, r"ekskul|ekstrakurikuler|\bekstra\b|organisasi"):
        return out("info_ekskul")
    if _has(low, r"sanksi|tata tertib|peraturan|aturan|seragam|\bvisi\b|\bmisi\b|prestasi|akreditasi|fasilitas|"
                 r"sejarah sekolah|alamat sekolah|profil sekolah|kemitraan|iduka|motto|jurusan apa|program keahlian"):
        params["topik"] = pesan
        return out("info_sekolah")
    if _has(low, r"pelanggaran|melanggar|\bpoin\b"):
        return out("pelanggaran_siswa")
    if _has(low, r"\balpha\b|\balpa\b|bolos"):
        if _has(low, r"lebih dari|di atas|diatas|minimal|paling sedikit|tinggi|terbanyak|tertinggi|siapa saja|daftar|sering|>=|>|\d+\s*hari|atau lebih"):
            ambang = parse_ambang(pesan, default=0)
            if ambang:
                params["ambang"] = ambang
            return out("siswa_alpha_tinggi")
        return out("rekap_kehadiran")
    if _has(low, r"kehadiran|absensi|presensi|\bhadir\b|\bsakit\b|\bizin\b"):
        return out("rekap_kehadiran")
    if _has(low, r"kkm|remedial|tidak tuntas|belum tuntas|di bawah"):
        return out("siswa_di_bawah_kkm")
    if _has(low, r"ranking|peringkat|tertinggi|terendah|terbaik|juara|teratas|terburuk"):
        return out("ranking_kelas")
    if _has(low, r"\bnilai|rapor|rata-rata|rata rata"):
        return out("nilai_siswa")
    if _has(low, r"\bcari\b|\bsiapa\b|profil|biodata|\bdata\b|\binfo"):
        return out("profil_siswa" if not kelas else "cari_siswa")
    if _has(low, r"^(?:halo|hai|hi|hello|assalamualaikum|selamat\s+(?:pagi|siang|sore|malam)|terima\s+kasih|makasih|thanks|ok|oke|tes|test|apa\s+kabar)\b"):
        return out("tidak_dikenali")
    return out("profil_siswa")


def _system_prompt() -> str:
    daftar = "\n".join(f"- {k}: {v}" for k, v in INTENTS.items())
    return (
        "Kamu adalah penerjemah pertanyaan guru SMKN 4 Bandung (khusus kelas XII) menjadi JSON intent.\n"
        "Pilih TEPAT SATU intent dari daftar, isi params yang disebut pengguna, jangan mengarang nilai.\n"
        f"Daftar intent:\n{daftar}\n\n"
        "Format keluaran (hanya JSON): {\"intent\": \"<nama>\", \"params\": {\"siswa\": \"...\", \"kelas\": \"XII TITL 6\", "
        "\"semester\": 5, ...}}. Kelas ditulis seperti 'XII TITL 6'. Jika pertanyaan tidak cocok dengan intent mana pun, "
        "keluarkan {\"intent\": \"tidak_dikenali\", \"params\": {}}. Jangan membuat SQL."
    )


_TEXT_KEYS = ("siswa", "guru", "perusahaan", "ekskul", "topik", "mapel", "hari", "kelas")
_GROUNDED = ("kelas", "semester", "ambang", "hari", "mapel")  # nilai yang bisa dibaca deterministik dari teks


def _clean_params(raw: dict) -> dict:
    """Tipe dan batas parameter dari Gemini. Nilai di luar bentuk yang diharapkan dibuang (bukan dicoba diperbaiki)."""
    out: dict = {}
    for key, val in raw.items():
        if key not in PARAM_KEYS or val in (None, "", []) or isinstance(val, bool):
            continue
        if key in ("semester", "ambang"):
            try:
                num = int(val)
            except (TypeError, ValueError):
                continue
            lo, hi = (1, 6) if key == "semester" else (1, 200)  # batas wajar; mencegah integer overflow di SQL
            if lo <= num <= hi:
                out[key] = num
        elif isinstance(val, str) and val.strip():
            out[key] = val.strip()[:100]
    return out


def gemini_intent(pesan: str) -> dict | None:
    raw = gemini.generate(_system_prompt(), pesan, json_mode=True)
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    name = data.get("intent") if isinstance(data, dict) else None
    if name == "tidak_dikenali":
        return {"intent": "tidak_dikenali", "params": {}}
    if name not in INTENTS:
        return None
    return {"intent": name, "params": _clean_params(data["params"] if isinstance(data.get("params"), dict) else {})}


def understand(pesan: str) -> tuple[dict, str]:
    """Kembalikan (intent_json, mode). mode = 'gemini' atau 'aturan'.

    Gemini hanya memilih intent dan melengkapi nama. Parameter yang bisa dibaca pasti dari teks (kelas, semester,
    ambang, hari, mapel) SELALU diambil dari parser aturan; nilai dari Gemini hanya dipakai bila parser tidak
    menemukan apa pun DAN nilainya lolos normalisasi. Dengan begitu halusinasi Gemini tidak bisa mengubah
    kelas/semester yang diketik guru.
    """
    from_rules = rule_intent(pesan)
    parsed = gemini_intent(pesan) if gemini.enabled() else None
    if parsed is None:
        return from_rules, "aturan"
    if parsed["intent"] == "tidak_dikenali":
        return parsed, "gemini"
    params = dict(parsed["params"])
    rule_params = from_rules["params"]
    low = pesan.lower()

    for key in _GROUNDED:
        if key in rule_params:
            params[key] = rule_params[key]
            continue
        cand = params.pop(key, None)
        if cand is None:
            continue
        if key == "kelas":
            cand = normalize_kelas(str(cand))
        elif key == "mapel":  # Gemini cenderung menulis nama mapel; query butuh kodenya
            cand = parse_mapel(str(cand), params.get("kelas", ""), parse_jurusan(pesan))
        elif key == "hari":
            norm = parse_hari(cand) if isinstance(cand, str) else ""
            grounded = bool(norm) and (norm.lower() in low or (norm == "Jumat" and "jum'at" in low))
            cand = norm if grounded else ""
        elif key in ("semester", "ambang"):
            cand = cand if str(cand) in low else None  # angka harus memang tertulis di pertanyaan
        if cand:
            params[key] = cand

    # petunjuk nama dari Gemini harus benar-benar bersumber dari pertanyaan (cegah nama karangan)
    for key in ("siswa", "guru", "perusahaan", "ekskul"):
        hint = params.get(key)
        if isinstance(hint, str) and not all(tok in low for tok in hint.lower().split()):
            params.pop(key)
    return {"intent": parsed["intent"], "params": params}, "gemini"

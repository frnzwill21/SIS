"""Penyusun jawaban + validator output.

Jawaban baku dari handler selalu tersedia dan selalu benar terhadap data. Gemini (opsional) hanya boleh merangkai
ulang jawaban itu menjadi bahasa yang lebih natural, dan hanya bila:
  1. GEMINI_SEND_DATA=1 (sekolah mengizinkan data hasil query dikirim ke layanan eksternal),
  2. hasilnya BUKAN data sensitif (pelanggaran),
  3. identitas (NIS/NISN) sudah dibuang dari teks dan tabel yang dikirim,
  4. rangkaian Gemini lolos validator (angka, nama, dan angka-dalam-kata harus berasal dari data).
Bila salah satu tidak terpenuhi, jawaban baku yang dipakai.
"""
import json
import re

from ..config import settings
from . import gemini
from .core import Result

_NUM = re.compile(r"\d+(?:[.,]\d+)*")
_ID_LIKE = re.compile(r"\b\d{7,12}\b")  # pola NIS/NISN; sesuaikan bila format NIS sekolah lebih pendek
_PRIVATE = {"nis", "nisn"}
_CAP_WORD = re.compile(r"\b[A-Z][a-z]{2,}\b")
_NUM_WORDS = {
    "nol", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas",
    "belas", "puluh", "ratus", "ribu", "seratus", "seribu",
}
# Kata berawal huruf besar yang wajar muncul di kalimat Gemini walau tidak ada di data.
_COMMON_CAPS = {
    "Ada", "Tidak", "Berikut", "Siswa", "Kelas", "Data", "Semester", "Nilai", "Dari", "Untuk", "Pada", "Dalam", "Hasil",
    "Hanya", "Semua", "Jadwal", "Wali", "Guru", "Mata", "Pelajaran", "Jumlah", "Total", "Rata", "Tabel", "Berdasarkan",
    "Menurut", "Sesuai", "Informasi", "Terdapat", "Sebanyak", "Selain", "Sementara", "Jika", "Silakan", "Mohon",
    "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu",
    "Peringkat", "Jurusan", "Ekskul", "Statistik", "Ringkasan", "Laki", "Perempuan", "Sesi", "Selesai", "Berlangsung",
    "Seluruh", "Tertinggi", "Terendah", "Terbaik", "Terbanyak", "Mitra", "RPL", "DKV", "TITL", "TOI", "TAV",
}
_SYSTEM = (
    "Kamu asisten guru SMKN 4 Bandung. Tulis jawaban singkat (maksimal 4 kalimat) dalam bahasa Indonesia yang ramah, "
    "HANYA berdasarkan data yang diberikan. Jangan menambah angka, nama, atau fakta baru. Jangan menyimpulkan karakter siswa. "
    "Tulis semua angka dengan digit. Jangan mengulang seluruh tabel; tabel ditampilkan terpisah."
)


def _norm_num(s: str) -> str:
    if re.fullmatch(r"\d{1,3}(?:\.\d{3})+(?:,\d+)?", s):  # format Indonesia: 1.200 / 1.200,5
        s = s.replace(".", "")
    s = s.replace(",", ".")
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return s


def numbers(text: str) -> set[str]:
    return {_norm_num(n) for n in _NUM.findall(text)}


def _words(text: str) -> set[str]:
    return set(re.findall(r"[a-z]+", text.lower()))


def _vocab(question: str, res: Result) -> set[str]:
    v = _words(question) | _words(res.jawaban)
    for row in res.baris:
        for cell in row:
            v |= _words(str(cell))
    return v


def allowed_numbers(question: str, res: Result) -> set[str]:
    allowed = numbers(question) | numbers(res.jawaban)
    for row in res.baris:
        for cell in row:
            allowed |= numbers(str(cell))
    return allowed


def valid_output(candidate: str, question: str, res: Result) -> bool:
    """Angka, nama (kata berawal huruf besar), dan angka-dalam-kata di jawaban harus berasal dari data.

    Batasan yang diketahui: validator ini TIDAK bisa mendeteksi nilai yang tertukar antar siswa selama kedua angka
    ada di data. Untuk jaminan penuh, jangan memakai Gemini untuk hasil tabel; pakai jawaban baku.
    """
    if not candidate or len(candidate) > 1200:
        return False
    if not numbers(candidate) <= allowed_numbers(question, res):
        return False
    vocab = _vocab(question, res)
    if any(w.lower() not in vocab and w not in _COMMON_CAPS for w in _CAP_WORD.findall(candidate)):
        return False
    if (_words(candidate) & _NUM_WORDS) - vocab:
        return False
    return True


def _redact(text: str) -> str:
    return _ID_LIKE.sub("[ID]", text)


def safe_payload(res: Result) -> dict:
    """Tabel yang boleh dikirim ke Gemini: tanpa kolom NIS/NISN, tanpa baris kunci-nilai NIS/NISN, ID terselubung."""
    keep = [i for i, c in enumerate(res.kolom) if c.strip().lower() not in _PRIVATE]
    rows = res.baris
    if len(res.kolom) == 2 and res.kolom[0].strip().lower() == "data":  # tabel kunci-nilai (profil_siswa, penempatan_pkl)
        rows = [r for r in rows if str(r[0]).strip().lower() not in _PRIVATE]
    clean = [[_redact(r[i]) if isinstance(r[i], str) else r[i] for i in keep] for r in rows[:25]]
    return {"kolom": [res.kolom[i] for i in keep], "baris": clean, "jumlah_baris_total": len(res.baris)}


def compose(question: str, res: Result) -> tuple[str, str]:
    """Kembalikan (teks_jawaban, mode)."""
    if (
        res.butuh_klarifikasi
        or res.sensitif
        or (not res.sumber and not res.baris)
        or not gemini.enabled()
        or not settings.gemini_send_data
    ):
        return res.jawaban, "aturan"
    prompt = (
        f"Pertanyaan guru: {_redact(question)}\n\nJawaban baku (fakta benar): {_redact(res.jawaban)}\n\n"
        f"Data tabel: {json.dumps(safe_payload(res), ensure_ascii=False, default=str)}\n\nTulis jawaban singkat."
    )
    candidate = gemini.generate(_SYSTEM, prompt)
    if candidate and valid_output(candidate.strip(), question, res):
        return candidate.strip(), "gemini"
    return res.jawaban, "aturan"

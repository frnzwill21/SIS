"""Katalog intent + pemahaman pertanyaan.

Dua jalur menghasilkan intent JSON yang SAMA bentuknya:
  1. Gemini (bila GEMINI_API_KEY diisi) -> JSON -> divalidasi terhadap katalog ini.
  2. Parser aturan (kata kunci) bila Gemini tidak aktif atau gagal.
AI tidak pernah membuat SQL di modul ini; ia hanya memilih intent dan mengisi parameter.
"""
import json
import re
from typing import Any

from ..auth import can_view_pelanggaran
from . import gemini
from .parsing import (
    mentions_all_scope,
    mentions_unknown_kelas,
    normalize_kelas,
    parse_ambang,
    parse_hari,
    parse_jurusan,
    parse_limit,
    parse_mapel,
    parse_pkl_sesi,
    parse_pkl_status,
    parse_poin_filter,
    parse_semester,
    parse_tingkat_pelanggaran,
    parse_urutan,
)

INTENTS = {
    "sapaan": "Sapaan, ucapan terima kasih, atau pertanyaan kemampuan asisten. params: kosong",
    "statistik_sekolah": (
        "Statistik atau ringkasan jumlah siswa per jurusan/kelas, sebaran jenis kelamin, "
        "total data sekolah, atau ekskul terpopuler. params: jurusan (opsional), kelas (opsional), "
        "semester (opsional), limit (opsional), urutan (asc/desc, opsional)"
    ),
    "cari_siswa": "Mencari siswa berdasarkan nama/NIS atau melihat daftar siswa satu kelas. params: siswa, kelas",
    "profil_siswa": "Profil satu siswa (kelas, wali kelas, PKL, ekskul). params: siswa",
    "nilai_siswa": "Nilai satu siswa. params: siswa, semester (1-6, opsional), mapel (opsional)",
    "ranking_kelas": (
        "Peringkat rata-rata nilai dalam satu kelas, satu jurusan, atau seluruh kelas XII. "
        "params: kelas (opsional), jurusan (opsional), semester (opsional), mapel (opsional), "
        "limit (1-40, opsional), urutan (asc/desc, opsional)"
    ),
    "siswa_di_bawah_kkm": (
        "Siswa dengan nilai di bawah KKM. params: kelas (opsional), jurusan (opsional), "
        "semester, mapel (opsional), limit (opsional)"
    ),
    "rekap_kehadiran": "Rekap sakit/izin/alpha/hadir satu siswa atau satu kelas. params: siswa atau kelas, semester (opsional)",
    "siswa_alpha_tinggi": (
        "Siswa dengan alpha tinggi. params: kelas (opsional), jurusan (opsional), semester, "
        "ambang (jumlah hari alpha minimal), limit (opsional)"
    ),
    "pelanggaran_siswa": (
        "Catatan atau peringkat pelanggaran siswa (per siswa, kelas, jurusan, tingkat, filter angka poin, atau seluruh sekolah). "
        "params: siswa (opsional), kelas (opsional), jurusan (opsional), tingkat (Ringan/Sedang/Berat, opsional), "
        "poin_op (=/>/>=/</<=/between, opsional), poin_min (int, opsional), poin_max (int, opsional), limit (opsional)"
    ),
    "jadwal_kelas": "Jadwal pelajaran satu kelas. params: kelas, hari (opsional)",
    "jadwal_guru": "Jadwal mengajar atau daftar guru pengampu mata pelajaran. params: guru (opsional), mapel (opsional), hari (opsional)",
    "info_wali_kelas": "Wali kelas suatu kelas, atau kelas yang diwalikan seorang guru. params: kelas atau guru",
    "penempatan_pkl": (
        "Penempatan PKL satu siswa, satu kelas, jurusan, sesi/status, atau satu perusahaan. "
        "params: siswa, kelas, jurusan, perusahaan, sesi (1/2), status, limit (opsional)"
    ),
    "info_ekskul": (
        "Info ekstrakurikuler, daftar ekskul yang diikuti siswa per kelas/jurusan, atau anggota satu ekskul. "
        "params: kelas (opsional), jurusan (opsional), semester (opsional), ekskul (opsional), siswa (opsional), limit (opsional)"
    ),
    "info_sekolah": "Profil sekolah, visi misi, tata tertib, sanksi, prestasi, fasilitas, mitra industri. params: topik",
}
PARAM_KEYS = {
    "siswa", "kelas", "jurusan", "semester", "mapel", "hari", "guru",
    "perusahaan", "ekskul", "ambang", "topik", "limit", "tingkat", "urutan", "sesi", "status",
    "poin_op", "poin_min", "poin_max",
}

CONTOH = [
    "Siapa wali kelas XII TITL 6?",
    "Berikan saya data 3 murid dengan nilai terbaik di seluruh kelas",
    "Berapa jumlah siswa per jurusan?",
]

_DATA_DOMAIN_RE = re.compile(
    r"\b(nilai|rapor|kkm|remedial|ranking|peringkat|juara|terbaik|tertinggi|terendah|terburuk|"
    r"alpha|alpa|hadir|kehadiran|absensi|presensi|sakit|izin|bolos|"
    r"pelanggaran|pelanggarannya|melanggar|poin|poinnya|sanksi|tata tertib|peraturan|aturan|seragam|"
    r"jadwal|mengajar|wali|guru|pengajar|"
    r"pkl|magang|prakerin|perusahaan|mitra|"
    r"ekskul|ekstrakurikuler|ekstra|organisasi|"
    r"siswa|murid|pelajar|kelas|jurusan|statistik|rekap|ringkasan|jumlah|berapa|total|"
    r"visi|misi|prestasi|fasilitas|akreditasi|sejarah|alamat|motto|"
    r"xii|rpl|dkv|titl|toi|tav|matematika|mtk|inggris|indonesia|sunda|mulok|pancasila|pkn|agama|pabp|pai|pjok|informatika|pkwu|kik)\b"
)

_GREETING_RE = re.compile(
    r"^(?:halo+|hai+|hi+|hello+|hey+|hei+|assalamu'?alaikum(?:\s+warahmatullahi\s+wabarakatuh)?|"
    r"wa'?alaikumussalam|salam(?:\s+sejahtera)?|selamat\s+(?:pagi|siang|sore|malam)|"
    r"pagi+|siang+|sore+|malam+|permisi+|tes+|test+|cek+|apa\s+kabar|"
    r"terima\s+kasih(?:\s+banyak)?|terimakasih(?:\s+banyak)?|makasih(?:\s+banyak)?|"
    r"thanks|thank\s+you|thx|ok|oke+|siap|baik|mantap|sip|noted)"
    r"(?:\s+(?:pak|bu|bapak|ibu|admin|asisten|bot|kak|min|ya|nih|dong|semua))*"
    r"(?:\s+(?:apa\s+kabar|gimana\s+kabarnya))?$"
)

_HELP_RE = re.compile(
    r"^(?:kamu|anda|bot|asisten|sistem|ai)?\s*(?:bisa|dapat|mampu)?\s*"
    r"(?:bantu\s+apa(?:\s+saja)?|bisa\s+apa(?:\s+saja)?|ngapain(?:\s+aja)?|"
    r"fiturnya?\s+apa(?:\s+saja)?|punya\s+fitur\s+apa|"
    r"bantuan|help|menu|panduan(?:\s+(?:chat|penggunaan|pakai))?|cara\s+(?:pakai|bertanya|menggunakan)|"
    r"siapa\s+(?:kamu|anda)|kamu\s+siapa|perkenalkan\s+diri)"
    r"(?:\s+(?:saja|aja|ya|dong|sih|ini))?$"
)


def _has(text: str, pattern: str) -> bool:
    return bool(re.search(pattern, text))


def _is_greeting_or_help(pesan: str) -> bool:
    """Fast-path untuk sapaan, ucapan terima kasih, atau pertanyaan kemampuan asisten."""
    norm = re.sub(r"[!?.,~\"'()]+", " ", (pesan or "").lower())
    norm = " ".join(norm.split())
    if not norm:
        return False
    if _HELP_RE.fullmatch(norm):
        return True
    if _DATA_DOMAIN_RE.search(norm):
        return False
    if _GREETING_RE.fullmatch(norm):
        return True
    # Sapaan singkat kombinasi seperti "halo, kamu bisa apa?"
    stripped = re.sub(r"^(?:halo+|hai+|hi+|hello+|selamat\s+(?:pagi|siang|sore|malam))\s*", "", norm).strip()
    if stripped and _HELP_RE.fullmatch(stripped):
        return True
    return False


def _mapel_guru_keyword(low: str) -> bool:
    return bool(
        re.search(
            r"\b(bk|bimbingan\s+konseling|konseling|pilihan|produktif|kejuruan|kk\s*[1-4]|"
            r"pai|pabp|mulok|kik|pkwu|matematika|mtk|inggris|indonesia|sunda|pancasila|pkn|pp|agama)\b",
            low,
        )
    )


def rule_intent(pesan: str) -> dict:
    """Parser kata kunci -> {"intent", "params"}. Nama orang diselesaikan kemudian oleh resolver."""
    if _is_greeting_or_help(pesan):
        return {"intent": "sapaan", "params": {}}

    low = pesan.lower()
    kelas = normalize_kelas(pesan)
    unknown_k = mentions_unknown_kelas(pesan)
    jurusan = "" if (kelas or unknown_k) else parse_jurusan(pesan)

    params: dict[str, Any] = {}
    if kelas:
        params["kelas"] = kelas
    elif jurusan:
        params["jurusan"] = jurusan
    sem = parse_semester(pesan)
    if sem:
        params["semester"] = sem
    hari = parse_hari(pesan)
    if hari:
        params["hari"] = hari
    mapel = parse_mapel(pesan, kelas, jurusan or parse_jurusan(pesan))
    if mapel:
        params["mapel"] = mapel
    limit = parse_limit(pesan)
    if limit:
        params["limit"] = limit
    tingkat = parse_tingkat_pelanggaran(pesan)
    if tingkat:
        params["tingkat"] = tingkat
    urutan = parse_urutan(pesan, default="")
    if urutan:
        params["urutan"] = urutan
    sesi = parse_pkl_sesi(pesan)
    if sesi:
        params["sesi"] = sesi
    pkl_status = parse_pkl_status(pesan)
    if pkl_status:
        params["status"] = pkl_status
    poin_op, poin_min, poin_max = parse_poin_filter(pesan)
    if poin_op:
        params["poin_op"] = poin_op
        params["poin_min"] = poin_min
        if poin_max or poin_op in ("=", "between"):
            params["poin_max"] = poin_max

    def out(name: str) -> dict:
        return {"intent": name, "params": params}

    if _has(low, r"\bwali\b"):
        return out("info_wali_kelas")
    if _has(low, r"\bjadwal\b|\bmengajar\b"):
        return out("jadwal_kelas" if (kelas or unknown_k) else "jadwal_guru")
    if _has(low, r"\bguru\b|\bpengajar\b") and (mapel or _mapel_guru_keyword(low)) and not _has(
        low, r"\b(jumlah|berapa|total|statistik|rekap)\b"
    ):
        return out("jadwal_guru")
    if _has(low, r"\bpkl\b|magang|prakerin"):
        return out("penempatan_pkl")
    if _has(low, r"ekskul|ekstrakurikuler|\bekstra\b|organisasi"):
        if _has(
            low,
            r"terpopuler|populer|terbanyak|paling\s+banyak|paling\s+sedikit|tersedikit|statistik|rekap|jumlah\s+anggota|ranking|peringkat",
        ) and not _has(low, r"\borganisasi\b"):
            return out("statistik_sekolah")
        return out("info_ekskul")
    if _has(
        low,
        r"tata tertib|peraturan|aturan|seragam|\bvisi\b|\bmisi\b|prestasi|akreditasi|fasilitas|"
        r"sejarah sekolah|alamat sekolah|profil sekolah|kemitraan|iduka|motto|jurusan apa|program keahlian",
    ):
        params["topik"] = pesan
        return out("info_sekolah")
    if _has(low, r"sanksi|jenis\s+pelanggaran|macam\s+pelanggaran") and not _has(
        low, r"\b(siapa|siswa|murid|anak|kelas|xii|melakukan|kena|tercatat)\b"
    ) and not kelas and not jurusan and not limit:
        params["topik"] = pesan
        return out("info_sekolah")
    if _has(low, r"pelanggaran|melanggar|\bpoin(?:nya)?\b"):
        return out("pelanggaran_siswa")
    if _has(low, r"\balpha\b|\balpa\b|bolos"):
        if (
            _has(
                low,
                r"lebih dari|di atas|diatas|minimal|paling sedikit|tinggi|terbanyak|tertinggi|siapa saja|daftar|sering|>=|>|\d+\s*hari|atau lebih",
            )
            or limit
        ):
            ambang = parse_ambang(pesan, default=0)
            if ambang:
                params["ambang"] = ambang
            return out("siswa_alpha_tinggi")
        return out("rekap_kehadiran")
    if _has(low, r"kehadiran|absensi|presensi|\bhadir\b|\bsakit\b|\bizin\b"):
        return out("rekap_kehadiran")
    if _has(low, r"kkm|remedial|tidak tuntas|belum tuntas|di bawah"):
        return out("siswa_di_bawah_kkm")
    if _has(low, r"\b(statistik|rekapitulasi|ringkasan|distribusi|sebaran|komposisi|perbandingan)\b") and not _has(
        low, r"\bnilai|rapor|kkm|pelanggaran\b"
    ):
        return out("statistik_sekolah")
    if (
        _has(low, r"\b(berapa|jumlah|total|ada berapa)\b")
        and _has(low, r"\b(siswa|murid|kelas|jurusan|guru|mitra|perusahaan|laki|perempuan|pria|wanita)\b")
        and not kelas
        and not _has(low, r"\bnilai|rapor|kkm|alpha|pelanggaran|poin\b")
    ):
        return out("statistik_sekolah")
    if (
        _has(low, r"\b(per\s+jurusan|tiap\s+jurusan|setiap\s+jurusan|per\s+kelas|tiap\s+kelas|setiap\s+kelas)\b")
        and not kelas
        and not _has(low, r"\bnilai|rapor|kkm|rata[\s-]*rata|pkl|pelanggaran\b")
    ):
        return out("statistik_sekolah")
    if _has(low, r"ranking|peringkat|tertinggi|terendah|terbaik|juara|teratas|terburuk"):
        params["urutan"] = urutan or "desc"
        return out("ranking_kelas")
    if _has(low, r"\bnilai|rapor|rata-rata|rata rata"):
        return out("nilai_siswa")
    if _has(low, r"\bcari\b|\bsiapa\b|profil|biodata|\bdata\b|\binfo"):
        return out("profil_siswa" if not kelas else "cari_siswa")
    return out("profil_siswa")


def _system_prompt() -> str:
    daftar = "\n".join(f"- {k}: {v}" for k, v in INTENTS.items())
    return (
        "Kamu adalah penerjemah pertanyaan guru SMKN 4 Bandung (khusus kelas XII) menjadi JSON intent.\n"
        "Pilih TEPAT SATU intent dari daftar, isi params yang disebut pengguna, jangan mengarang nilai.\n"
        f"Daftar intent:\n{daftar}\n\n"
        "Format keluaran (hanya JSON): {\"intent\": \"<nama>\", \"params\": {\"siswa\": \"...\", \"kelas\": \"XII TITL 6\", "
        "\"jurusan\": \"RPL\", \"semester\": 5, \"limit\": 3, \"tingkat\": \"Berat\", \"poin_op\": \"=\", "
        "\"poin_min\": 80, \"poin_max\": 80, \"urutan\": \"desc\", ...}}. "
        "Kelas ditulis seperti 'XII TITL 6'. Jika pertanyaan tidak cocok dengan intent mana pun, "
        "keluarkan {\"intent\": \"tidak_dikenali\", \"params\": {}}. Jangan membuat SQL."
    )


_GROUNDED = (
    "kelas", "jurusan", "semester", "ambang", "hari", "mapel",
    "limit", "tingkat", "urutan", "sesi", "status", "poin_op", "poin_min", "poin_max",
)
_VALID_POIN_OPS = {"=", ">", ">=", "<", "<=", "between"}


def _clean_params(raw: dict) -> dict:
    """Tipe dan batas parameter dari Gemini. Nilai di luar bentuk yang diharapkan dibuang (bukan dicoba diperbaiki)."""
    out: dict[str, Any] = {}
    for key, val in raw.items():
        if key not in PARAM_KEYS or val in (None, "", []) or isinstance(val, bool):
            continue
        if key in ("semester", "ambang", "limit", "sesi", "poin_min", "poin_max"):
            try:
                num = int(val)
            except (TypeError, ValueError):
                continue
            bounds = {
                "semester": (1, 6),
                "ambang": (1, 200),
                "limit": (1, 40),
                "sesi": (1, 2),
                "poin_min": (0, 2000),
                "poin_max": (0, 2000),
            }
            lo, hi = bounds[key]
            if lo <= num <= hi:
                out[key] = num
        elif key == "poin_op":
            if isinstance(val, str) and val.strip().lower() in _VALID_POIN_OPS:
                out[key] = val.strip().lower()
        elif isinstance(val, str) and val.strip():
            out[key] = val.strip()[:100]
    return out


def _history_context_text(history: list[dict] | None) -> str:
    if not history:
        return ""
    lines = []
    for item in history[-6:]:
        role = item.get("role", "user")
        txt = str(item.get("konten") or item.get("content") or "").strip()
        if not txt:
            continue
        intent_meta = item.get("intent")
        suffix = ""
        if isinstance(intent_meta, dict) and intent_meta.get("intent"):
            suffix = f" [intent={intent_meta['intent']}, params={json.dumps(intent_meta.get('params', {}), ensure_ascii=False)}]"
        lines.append(f"{role}: {txt[:180]}{suffix}")
    return "\n".join(lines)


def gemini_intent(pesan: str, history: list[dict] | None = None) -> dict | None:
    ctx = _history_context_text(history)
    prompt = f"Konteks percakapan sebelumnya:\n{ctx}\n\nPertanyaan terbaru:\n{pesan}" if ctx else pesan
    raw = gemini.generate(_system_prompt(), prompt, json_mode=True)
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


def _last_valid_intent(history: list[dict] | None) -> tuple[dict | None, str]:
    if not history:
        return None, ""
    last_user = ""
    for item in reversed(history):
        role = item.get("role")
        if not last_user and role == "user":
            last_user = str(item.get("konten") or item.get("content") or "").strip()
        intent_obj = item.get("intent")
        if (
            role == "ai"
            and isinstance(intent_obj, dict)
            and intent_obj.get("intent") not in (None, "", "tidak_dikenali", "sapaan", "di_luar_cakupan")
        ):
            return intent_obj, last_user
    return None, last_user


def _resolve_with_history(pesan: str, current: dict, history: list[dict] | None) -> dict:
    """Gabungkan modifier lanjutan pendek (mis. 'kalau semester 4?', 'yang XII RPL 2?', 'yang berat saja?') dengan konteks sebelumnya."""
    prev_intent, _ = _last_valid_intent(history)
    if not prev_intent:
        return current
    low = pesan.lower().strip()
    words = low.split()
    if len(words) > 9:
        return current

    cur_name = current["intent"]
    cur_params = dict(current.get("params") or {})
    prev_name = prev_intent["intent"]
    prev_params = dict(prev_intent.get("params") or {})

    has_connector = _has(low, r"^(?:kalau|kalo|bagaimana|gimana|yang|untuk|nah|terus|lalu|dan|coba|ubah|ganti)\b")
    has_modifier = any(
        k in cur_params
        for k in ("semester", "kelas", "jurusan", "tingkat", "hari", "mapel", "limit", "urutan", "sesi", "status", "poin_op")
    )

    is_detail_followup = (
        cur_name in ("profil_siswa", "cari_siswa")
        and len(words) <= 6
        and not _has(low, r"\b(profil|biodata|nis|nisn)\b")
        and _has(
            low,
            r"^(?:yang\s+diikuti(?:\s+apa\s+saja)?|apa\s+saja\s+yang\s+diikuti|"
            r"siapa\s+saja(?:\s+(?:anggota|peserta|siswa|murid)(?:nya)?)?|"
            r"(?:siapa\s+saja\s+)?(?:anggota|peserta|siswa|murid)(?:nya)?(?:\s+siapa\s+saja)?|"
            r"daftar\s+(?:siswa|murid|anggota|peserta)(?:nya)?|"
            r"(?:nama[\s-]*)?(?:siswa|murid|anggota|peserta)(?:nya)?|"
            r"rincian(?:nya)?|detail(?:nya)?|selengkapnya|lebih\s+rinci)\s*[?!.]*$",
        )
    )
    is_generic_followup = (
        cur_name == "profil_siswa"
        and not _has(low, r"\b(profil|biodata|siapa)\b")
        and (has_modifier or has_connector)
    )
    is_same_domain_followup = (
        cur_name == prev_name
        and has_connector
        and not mentions_all_scope(pesan)
        and any(k in prev_params for k in ("kelas", "jurusan", "semester", "limit", "tingkat", "mapel", "ekskul", "poin_op"))
    )
    is_sanksi_to_tingkat = (
        prev_name == "info_sekolah"
        and "tingkat" in cur_params
        and len(words) <= 6
        and _has(low, r"\b(ringan|sedang|berat)\b")
    )

    if not (is_detail_followup or is_generic_followup or is_same_domain_followup or is_sanksi_to_tingkat):
        return current

    merged = dict(prev_params)
    if "kelas" in cur_params:
        merged.pop("jurusan", None)
        merged.pop("siswa", None)
    elif "jurusan" in cur_params:
        merged.pop("kelas", None)
        merged.pop("siswa", None)
    elif mentions_all_scope(pesan):
        merged.pop("kelas", None)
        merged.pop("jurusan", None)
    if "poin_op" in cur_params:
        merged.pop("poin_op", None)
        merged.pop("poin_min", None)
        merged.pop("poin_max", None)
    merged.update(cur_params)
    target_intent = "info_sekolah" if is_sanksi_to_tingkat else prev_name
    if target_intent == "info_sekolah":
        merged["topik"] = f"sanksi pelanggaran tingkat {cur_params['tingkat']}"
    return {"intent": target_intent, "params": merged}


def understand(pesan: str, history: list[dict] | None = None) -> tuple[dict, str]:
    """Kembalikan (intent_json, mode). mode = 'gemini' atau 'aturan'.

    Fast-path sapaan berjalan sebelum Gemini (<1ms). Bila Gemini menjawab 'tidak_dikenali' namun parser aturan
    menemukan intent yang jelas (bukan 'tidak_dikenali'/'profil_siswa'), hasil parser aturan yang dipakai.
    """
    if _is_greeting_or_help(pesan):
        return {"intent": "sapaan", "params": {}}, "aturan"

    raw_rules = rule_intent(pesan)
    from_rules = _resolve_with_history(pesan, raw_rules, history)
    resolved_from_history = raw_rules["intent"] != from_rules["intent"]
    parsed = gemini_intent(pesan, history=history) if gemini.enabled() else None
    if parsed is None:
        return from_rules, "aturan"
    if parsed["intent"] == "tidak_dikenali":
        if from_rules["intent"] not in ("tidak_dikenali", "profil_siswa"):
            return from_rules, "aturan"
        return parsed, "gemini"
    if parsed["intent"] == "sapaan" and from_rules["intent"] not in ("tidak_dikenali", "profil_siswa", "sapaan"):
        return from_rules, "aturan"
    if resolved_from_history and parsed["intent"] in ("profil_siswa", "cari_siswa") and from_rules["intent"] not in ("profil_siswa", "cari_siswa"):
        return from_rules, "aturan"

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
        elif key == "jurusan":
            cand = parse_jurusan(str(cand))
            cand = cand if cand and cand.lower() in low and not params.get("kelas") else ""
        elif key == "mapel":
            cand = parse_mapel(str(cand), params.get("kelas", ""), params.get("jurusan") or parse_jurusan(pesan))
        elif key == "hari":
            norm = parse_hari(cand) if isinstance(cand, str) else ""
            grounded = bool(norm) and (norm.lower() in low or (norm == "Jumat" and "jum'at" in low))
            cand = norm if grounded else ""
        elif key in ("semester", "ambang", "sesi"):
            cand = cand if str(cand) in low else None
        elif key == "limit":
            cand = cand if (str(cand) in low or parse_limit(pesan)) else None
        elif key == "tingkat":
            norm_t = parse_tingkat_pelanggaran(str(cand))
            cand = norm_t if norm_t and norm_t.lower() in low else ""
        elif key == "urutan":
            cand = cand.lower() if isinstance(cand, str) and cand.lower() in ("asc", "desc") else ""
        elif key == "status":
            cand = parse_pkl_status(str(cand))
        elif key == "poin_op":
            p_op, _, _ = parse_poin_filter(pesan)
            cand = cand if isinstance(cand, str) and cand in _VALID_POIN_OPS and p_op == cand else ""
        elif key in ("poin_min", "poin_max"):
            cand = cand if (params.get("poin_op") and str(cand) in low) else None
        if cand or (key in ("poin_min", "poin_max") and cand == 0 and params.get("poin_op")):
            params[key] = cand

    for key in ("siswa", "guru", "perusahaan", "ekskul"):
        if key in rule_params:
            params[key] = rule_params[key]
            continue
        hint = params.get(key)
        if isinstance(hint, str) and not all(tok in low for tok in hint.lower().split()):
            params.pop(key)
    return {"intent": parsed["intent"], "params": params}, "gemini"


def build_smart_suggestions(pesan: str, intent: dict | str, role: str = "admin", result: Any = None) -> list[str]:
    """Bangun maksimal 3 saran pertanyaan cerdas yang terverifikasi SQL dan patuh RBAC."""
    allow_pelanggaran = can_view_pelanggaran(role)
    intent_name = intent.get("intent", "") if isinstance(intent, dict) else str(intent or "")
    low = (pesan or "").lower()

    def _finish(candidates: list[str]) -> list[str]:
        out: list[str] = []
        for item in candidates:
            if not allow_pelanggaran and "pelanggaran" in item.lower():
                continue
            if item not in out:
                out.append(item)
            if len(out) >= 3:
                break
        return out

    # 1. Klarifikasi nama siswa/guru ambigu langsung dari baris hasil DB
    baris = getattr(result, "baris", None) or []
    kolom = getattr(result, "kolom", None) or []
    if baris and kolom and kolom[0] == "Nama":
        prefix_map = {
            "nilai_siswa": "Nilai",
            "rekap_kehadiran": "Kehadiran",
            "penempatan_pkl": "Di mana",
            "pelanggaran_siswa": "Pelanggaran",
            "profil_siswa": "Profil",
        }
        prefix = prefix_map.get(intent_name, "Profil")
        suffix = " PKL?" if intent_name == "penempatan_pkl" else ""
        has_kelas_col = "Kelas" in kolom
        kelas_idx = kolom.index("Kelas") if has_kelas_col else -1
        dynamic: list[str] = []
        for row in baris[:3]:
            nama = str(row[0])
            kls = f" {row[kelas_idx]}" if has_kelas_col and row[kelas_idx] else ""
            dynamic.append(f"{prefix} {nama}{kls}{suffix}".strip())
        if dynamic:
            return _finish(dynamic)

    # 2. Kelas tidak dikenal (mis. XII TITL 9) -> tawarkan kelas valid di jurusan tsb
    if mentions_unknown_kelas(pesan):
        jur = parse_jurusan(pesan) or "TITL"
        sample_kelas = {
            "RPL": ("XII RPL 1", "XII RPL 2"),
            "DKV": ("XII DKV 1", "XII DKV 2"),
            "TITL": ("XII TITL 6", "XII TITL 1"),
            "TOI": ("XII TOI 1", "XII TOI 3"),
            "TAV": ("XII TAV 1", "XII TAV 3"),
        }.get(jur, ("XII RPL 1", "XII TITL 6"))
        return _finish([
            f"Siapa wali kelas {sample_kelas[0]}?",
            f"Siswa {sample_kelas[1]} yang nilainya di bawah KKM semester 5",
            f"Jadwal {sample_kelas[0]} hari Senin",
        ])

    # 3. Pertanyaan di luar cakupan (kelas X/XI)
    if intent_name == "di_luar_cakupan":
        return _finish([
            "Berikan saya data 3 murid dengan nilai terbaik di seluruh kelas",
            "Berapa jumlah siswa per jurusan?",
            "Siswa XII RPL 2 yang nilainya di bawah KKM semester 5",
        ])

    # 4. Topik pelanggaran / tata tertib (patuh RBAC)
    if intent_name == "pelanggaran_siswa" or _has(low, r"pelanggaran|melanggar|sanksi|tata tertib|poin|nakal"):
        if allow_pelanggaran:
            return _finish([
                "Saya butuh 3 murid yang melakukan pelanggaran berat",
                "Pelanggaran siswa XII RPL 1",
                "Apa sanksi untuk pelanggaran tingkat sedang?",
            ])
        return _finish([
            "Apa tata tertib kehadiran dan seragam sekolah?",
            "Visi dan misi SMKN 4 Bandung",
            "Siapa wali kelas XII TITL 6?",
        ])

    # 5. Nilai / KKM / Ranking
    if intent_name in ("nilai_siswa", "ranking_kelas", "siswa_di_bawah_kkm") or _has(low, r"nilai|rapor|kkm|ranking|peringkat"):
        return _finish([
            "Berikan saya data 3 murid dengan nilai terbaik di seluruh kelas",
            "Siswa XII RPL 2 yang nilainya di bawah KKM semester 5",
            "Rata-rata nilai siswa per jurusan semester 5",
        ])

    # 6. Kehadiran / Alpha
    if intent_name in ("rekap_kehadiran", "siswa_alpha_tinggi") or _has(low, r"alpha|alpa|hadir|kehadiran|absen|sakit|izin"):
        return _finish([
            "Siapa saja yang alpha lebih dari 5 hari semester ini?",
            "Rekap kehadiran XII TOI 3 semester 5",
            "Berapa jumlah siswa per kelas?",
        ])

    # 7. PKL
    if intent_name == "penempatan_pkl" or _has(low, r"\bpkl\b|magang|prakerin|perusahaan|mitra"):
        return _finish([
            "Siapa saja yang PKL di PLN?",
            "Daftar mitra PKL untuk jurusan RPL",
            "Penempatan PKL kelas XII RPL 1",
        ])

    # 8. Ekskul
    if intent_name == "info_ekskul" or _has(low, r"ekskul|ekstrakurikuler|\bekstra\b"):
        return _finish([
            "Ekskul apa yang paling populer semester 5?",
            "Ada ekskul apa saja?",
            "Siapa anggota ekskul Pramuka semester 5?",
        ])

    # 9. Jadwal / Guru / Wali Kelas
    if intent_name in ("jadwal_kelas", "jadwal_guru", "info_wali_kelas") or _has(low, r"jadwal|guru|wali|mengajar"):
        return _finish([
            "Siapa saja guru Matematika?",
            "Jadwal XII TITL 6 hari Senin",
            "Siapa wali kelas XII TITL 6?",
        ])

    # 10. Default umum
    defaults = [
        "Berapa jumlah siswa per jurusan?",
        "Berikan saya data 3 murid dengan nilai terbaik di seluruh kelas",
        "Saya butuh 3 murid yang melakukan pelanggaran berat"
        if allow_pelanggaran
        else "Siswa XII RPL 2 yang nilainya di bawah KKM semester 5",
    ]
    return _finish(defaults)

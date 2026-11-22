"""Hybrid Query Engine: pertanyaan -> intent JSON -> validasi/resolver -> query tetap / SQL Builder / RAG -> jawaban."""
import logging
import time
from collections.abc import Callable
from contextlib import AbstractContextManager

from ..auth import can_view_pelanggaran
from . import handlers, rag, sql_builder
from .compose import compose
from .core import Db, Result
from .intents import build_smart_suggestions, understand
from .parsing import mentions_unknown_kelas, outside_scope, relative_semester_offset

log = logging.getLogger("uvicorn.error")

# Pabrik "ruang kerja DB": `with open_db() as db:`. Koneksi hanya dibuka selama query dijalankan, TIDAK selama
# panggilan Gemini (understand/compose) yang bisa memakan detik demi detik.
OpenDb = Callable[[], AbstractContextManager[Db]]

_RBAC_DENIAL_MSG = (
    "Maaf, data pelanggaran siswa bersifat sensitif dan hanya dapat diakses oleh BK, Kepala Sekolah, "
    "dan Admin. Anda tetap dapat menanyakan peraturan tata tertib atau jenis sanksi sekolah."
)


def _step(
    langkah: int,
    kode: str,
    judul: str,
    status: str,
    ringkasan: str,
    detail: list[str],
    t0: float,
) -> dict:
    return {
        "langkah": langkah,
        "kode": kode,
        "judul": judul,
        "status": status,
        "ringkasan": ringkasan,
        "detail": detail,
        "durasi_ms": max(0, int(round((time.perf_counter() - t0) * 1000))),
    }


def _total_ms(total_t0: float) -> int:
    return max(0, int(round((time.perf_counter() - total_t0) * 1000)))


def _public_mode(*modes: str) -> str:
    return "ai" if "gemini" in modes else "lokal"


def _rbac_denied_response(intent: dict, mode: str, jejak: list[dict], total_t0: float) -> dict:
    return {
        "jawaban": _RBAC_DENIAL_MSG,
        "tabel": None,
        "sumber": [],
        "intent": intent,
        "mode": mode,
        "sensitif": True,
        "butuh_klarifikasi": False,
        "contoh": [],
        "galat": False,
        "ditolak": True,
        "jejak_pikir": jejak,
        "total_durasi_ms": _total_ms(total_t0),
    }


def answer(
    open_db: OpenDb,
    pesan: str,
    role: str = "admin",
    history: list[dict] | None = None,
) -> dict:
    """Jawab satu pertanyaan. Mengembalikan dict siap dikirim sebagai JSON (lihat dokumen 03, POST /chat)."""
    total_t0 = time.perf_counter()
    jejak: list[dict] = []
    pesan = " ".join(pesan.split())

    # 1. Validasi Cakupan Data (Scope Guard)
    t1 = time.perf_counter()
    if outside_scope(pesan):
        jejak.append(
            _step(
                1,
                "scope_guard",
                "Memahami Konteks Pertanyaan",
                "ditolak",
                "Pertanyaan berada di luar cakupan data siswa kelas XII SMKN 4 Bandung.",
                [],
                t1,
            )
        )
        scope_intent = {"intent": "di_luar_cakupan", "params": {}}
        return {
            "jawaban": "Data yang tersedia saat ini baru kelas XII. Kelas X dan XI akan menyusul.",
            "tabel": None,
            "sumber": [],
            "intent": scope_intent,
            "mode": "lokal",
            "sensitif": False,
            "butuh_klarifikasi": False,
            "contoh": build_smart_suggestions(pesan, scope_intent, role, None),
            "galat": False,
            "jejak_pikir": jejak,
            "total_durasi_ms": _total_ms(total_t0),
        }

    unknown_kelas = mentions_unknown_kelas(pesan)
    jejak.append(
        _step(
            1,
            "scope_guard",
            "Memahami Konteks Pertanyaan",
            "ok",
            "Memastikan pertanyaan sesuai dengan ruang lingkup data sekolah kelas XII.",
            [],
            t1,
        )
    )

    # 2. Penentuan Arah Pertanyaan
    t2 = time.perf_counter()
    intent, mode_intent = understand(pesan, history=history)  # tanpa koneksi DB
    if unknown_kelas and intent["intent"] not in ("tidak_dikenali", "sapaan"):
        intent["params"].pop("kelas", None)
    status2 = "klarifikasi" if intent["intent"] == "tidak_dikenali" else "ok"
    ringkasan2 = (
        "Pertanyaan masih terlalu umum sehingga perlu diperjelas terlebih dahulu."
        if status2 == "klarifikasi"
        else "Menangkap maksud pertanyaan dan menyiapkan informasi yang relevan."
    )
    jejak.append(_step(2, "intent_layer", "Menentukan Arah Pencarian", status2, ringkasan2, [], t2))

    # 3. Pemeriksaan Hak Akses
    t3 = time.perf_counter()
    is_sensitif_intent = intent["intent"] == "pelanggaran_siswa"
    if is_sensitif_intent and not can_view_pelanggaran(role):
        jejak.append(
            _step(
                3,
                "rbac_layer",
                "Memeriksa Hak Akses",
                "ditolak",
                "Akses ke informasi sensitif ini dibatasi sesuai peran akun Anda.",
                [],
                t3,
            )
        )
        return _rbac_denied_response(intent, _public_mode(mode_intent), jejak, total_t0)
    jejak.append(
        _step(
            3,
            "rbac_layer",
            "Memeriksa Hak Akses",
            "ok",
            "Memverifikasi izin akses Anda terhadap informasi yang diminta.",
            [],
            t3,
        )
    )

    # 4. Pengumpulan Data Sekolah
    t4 = time.perf_counter()
    galat = False
    mode_sql = "aturan"
    try:
        if intent["intent"] == "sapaan":
            result = handlers.sapaan(None, intent.get("params", {}), pesan)  # type: ignore[arg-type]
        else:
            with open_db() as db:  # koneksi hanya selama handler berjalan
                rel_sem = relative_semester_offset(pesan)
                if rel_sem is not None and intent["intent"] not in ("tidak_dikenali", "sapaan"):
                    intent["params"]["semester"] = max(handlers._sem_berjalan(db) + rel_sem, 1)
                with rag.use_db(db):
                    result = handlers.run(db, intent, pesan)
                if (
                    intent["intent"] == "info_sekolah"
                    and "Dokumen: " in result.jawaban
                    and "knowledge_document" not in result.sumber
                ):
                    result.sumber.append("knowledge_document")

                # Cadangan Safe SQL Builder Layer A (deterministik) & RAG dokumen & Layer B (Gemini Read-Only SQL)
                if result.butuh_klarifikasi and not result.baris and not unknown_kelas:
                    res_a, ditolak_a = sql_builder.try_deterministic(db, pesan, role=role, intent=intent)
                    if ditolak_a:
                        jejak.append(
                            _step(
                                4,
                                "sql_layer",
                                "Mengumpulkan Data Sekolah",
                                "ditolak",
                                "Akses ke informasi sensitif ini dibatasi sesuai peran akun Anda.",
                                [],
                                t4,
                            )
                        )
                        return _rbac_denied_response(intent, _public_mode(mode_intent), jejak, total_t0)
                    if res_a is not None:
                        result = res_a

                if (
                    result.butuh_klarifikasi
                    and not result.baris
                    and not unknown_kelas
                    and intent["intent"] in ("profil_siswa", "tidak_dikenali")
                ):
                    doc_hits = rag.retrieve_docs(db, pesan, k=3)
                    if doc_hits:
                        teks_doc = "Dari dokumen pengetahuan: " + " | ".join(
                            f"{lbl}: {txt[:350]}" for lbl, txt in doc_hits
                        )
                        result = Result(teks_doc, sumber=["knowledge_document"])

                if result.butuh_klarifikasi and not result.baris and not unknown_kelas:
                    res_b, ditolak_b = sql_builder.try_gemini_sql(db, pesan, role=role)
                    if ditolak_b:
                        jejak.append(
                            _step(
                                4,
                                "sql_layer",
                                "Mengumpulkan Data Sekolah",
                                "ditolak",
                                "Akses ke informasi sensitif ini dibatasi sesuai peran akun Anda.",
                                [],
                                t4,
                            )
                        )
                        return _rbac_denied_response(intent, _public_mode(mode_intent, "gemini"), jejak, total_t0)
                    if res_b is not None:
                        result = res_b
                        mode_sql = "gemini"
    except Exception:  # noqa: BLE001 - satu intent rusak tidak boleh menjatuhkan seluruh request
        log.exception("Handler gagal (intent=%s)", intent.get("intent"))
        galat = True
        result = Result(
            "Maaf, terjadi kendala saat mengambil data. Coba ulangi atau ubah pertanyaannya.",
            butuh_klarifikasi=True,
        )

    if galat:
        status4 = "error"
        ringkasan4 = "Terjadi kendala saat mengambil informasi sekolah yang diminta."
    elif result.butuh_klarifikasi:
        status4 = "klarifikasi"
        ringkasan4 = "Belum menemukan data yang tepat sehingga perlu informasi tambahan."
    elif intent["intent"] == "sapaan":
        status4 = "ok"
        ringkasan4 = "Menyiapkan respons sapaan dan panduan singkat tanpa pencarian data."
    elif "knowledge_document" in (result.sumber or []) or intent["intent"] == "info_sekolah":
        status4 = "ok"
        ringkasan4 = "Menelusuri informasi dan pedoman sekolah yang relevan."
    elif result.baris:
        status4 = "ok"
        ringkasan4 = "Mengambil dan memeriksa catatan data sekolah yang relevan."
    else:
        status4 = "ok"
        ringkasan4 = "Memeriksa dan mencocokkan catatan data sekolah terkait."
    jejak.append(_step(4, "sql_layer", "Mengumpulkan Data Sekolah", status4, ringkasan4, [], t4))

    # 5. Penyusunan Jawaban
    t5 = time.perf_counter()
    teks, mode_jawaban = compose(pesan, result)  # tanpa koneksi DB
    status5 = "error" if galat else ("klarifikasi" if result.butuh_klarifikasi else "ok")
    if galat:
        ringkasan5 = "Menyiapkan pesan pemberitahuan atas kendala yang terjadi."
    elif result.sensitif:
        ringkasan5 = "Menyusun jawaban dari data internal secara langsung."
    elif result.butuh_klarifikasi:
        ringkasan5 = "Menyiapkan pertanyaan klarifikasi beserta saran topik terkait."
    elif mode_jawaban == "gemini":
        ringkasan5 = "Merangkai jawaban yang ringkas, jelas, dan mudah dipahami."
    else:
        ringkasan5 = "Menyusun jawaban dari data internal secara langsung."
    jejak.append(_step(5, "compose_layer", "Menyusun Jawaban", status5, ringkasan5, [], t5))

    smart_contoh = build_smart_suggestions(pesan, intent, role, result) if result.butuh_klarifikasi else []
    return {
        "jawaban": teks,
        "tabel": result.tabel(),
        "sumber": result.sumber,
        "intent": intent,
        "mode": _public_mode(mode_intent, mode_jawaban, mode_sql),
        "sensitif": result.sensitif,
        "butuh_klarifikasi": result.butuh_klarifikasi,
        "contoh": smart_contoh,
        "galat": galat,
        "jejak_pikir": jejak,
        "total_durasi_ms": _total_ms(total_t0),
    }

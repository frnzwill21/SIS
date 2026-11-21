"""Hybrid Query Engine: pertanyaan -> intent JSON -> validasi/resolver -> query tetap atau RAG -> jawaban."""
import logging
from collections.abc import Callable
from contextlib import AbstractContextManager

from . import handlers
from .compose import compose
from .core import Db, Result
from .intents import CONTOH, understand
from .parsing import mentions_unknown_kelas, outside_scope, relative_semester_offset

log = logging.getLogger("uvicorn.error")

# Pabrik "ruang kerja DB": `with open_db() as db:`. Koneksi hanya dibuka selama query dijalankan, TIDAK selama
# panggilan Gemini (understand/compose) yang bisa memakan detik demi detik.
OpenDb = Callable[[], AbstractContextManager[Db]]


def answer(open_db: OpenDb, pesan: str) -> dict:
    """Jawab satu pertanyaan. Mengembalikan dict siap dikirim sebagai JSON (lihat dokumen 03, POST /chat)."""
    pesan = " ".join(pesan.split())
    if outside_scope(pesan):
        return {
            "jawaban": "Data yang tersedia saat ini baru kelas XII. Kelas X dan XI akan menyusul.",
            "tabel": None, "sumber": [], "intent": {"intent": "di_luar_cakupan", "params": {}},
            "mode": "aturan", "sensitif": False, "butuh_klarifikasi": False, "contoh": CONTOH, "galat": False,
        }
    intent, mode_intent = understand(pesan)  # tanpa koneksi DB
    if mentions_unknown_kelas(pesan) and intent["intent"] not in ("tidak_dikenali",):
        intent["params"].pop("kelas", None)

    galat = False
    try:
        with open_db() as db:  # koneksi hanya selama handler berjalan
            rel_sem = relative_semester_offset(pesan)
            if rel_sem is not None and intent["intent"] not in ("tidak_dikenali",):
                intent["params"]["semester"] = max(handlers._sem_berjalan(db) + rel_sem, 1)
            result = handlers.run(db, intent, pesan)
    except Exception:  # noqa: BLE001 - satu intent rusak tidak boleh menjatuhkan seluruh request
        log.exception("Handler gagal (intent=%s)", intent.get("intent"))
        galat = True
        result = Result("Maaf, terjadi kendala saat mengambil data. Coba ulangi atau ubah pertanyaannya.", butuh_klarifikasi=True)

    teks, mode_jawaban = compose(pesan, result)  # tanpa koneksi DB
    return {
        "jawaban": teks,
        "tabel": result.tabel(),
        "sumber": result.sumber,
        "intent": intent,
        "mode": "gemini" if "gemini" in (mode_intent, mode_jawaban) else "aturan",
        "sensitif": result.sensitif,
        "butuh_klarifikasi": result.butuh_klarifikasi,
        "contoh": CONTOH if result.butuh_klarifikasi else [],
        "galat": galat,
    }

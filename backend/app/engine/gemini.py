"""Klien Gemini lewat REST (tanpa SDK). Mengembalikan None bila kunci kosong, sirkuit terbuka, atau panggilan gagal,
supaya engine otomatis memakai mode aturan.

Perbaikan: kunci API lewat header (bukan query string yang ikut tercatat di log/proxy), timeout lebih pendek,
dan circuit breaker agar Gemini yang down/lambat tidak membuat SETIAP request menunggu timeout dua kali."""
import json
import logging
import threading
import time
import urllib.error
import urllib.request

from ..config import settings

log = logging.getLogger("uvicorn.error")
_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

DEFAULT_TIMEOUT = 8          # detik, per panggilan (sebelumnya 25 x 2 panggilan per pertanyaan)
MAX_ATTEMPTS = 3             # batas rotasi kunci per request agar tidak looping puluhan kunci
MAX_TOTAL_SECONDS = 10.0     # batas total waktu dinding per panggilan sebelum fallback mode aturan
FAILURE_THRESHOLD = 3        # gagal beruntun sebelum sirkuit dibuka
COOLDOWN_SECONDS = 60        # lama Gemini dilewati saat sirkuit terbuka


class _Breaker:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._fails = 0
        self._open_until = 0.0

    def allow(self) -> bool:
        with self._lock:
            return time.monotonic() >= self._open_until

    def ok(self) -> None:
        with self._lock:
            self._fails = 0

    def fail(self) -> None:
        with self._lock:
            self._fails += 1
            if self._fails >= FAILURE_THRESHOLD:
                self._open_until = time.monotonic() + COOLDOWN_SECONDS
                self._fails = 0
                log.warning("Gemini gagal %d kali beruntun; dilewati %d dtk (mode aturan).", FAILURE_THRESHOLD, COOLDOWN_SECONDS)


breaker = _Breaker()
_key_idx = 0
_key_lock = threading.Lock()


def _api_keys() -> list[str]:
    return [k.strip() for k in settings.gemini_api_key.split(",") if k.strip()]


def _next_keys() -> list[str]:
    """Urutan kunci rotasi (round-robin) agar beban tersebar dan failover otomatis saat limit."""
    global _key_idx
    keys = _api_keys()
    if len(keys) <= 1:
        return keys
    with _key_lock:
        start = _key_idx % len(keys)
        _key_idx = (start + 1) % len(keys)
    return keys[start:] + keys[:start]


def enabled() -> bool:
    return bool(_api_keys())


def generate(system: str, prompt: str, json_mode: bool = False, timeout: int = DEFAULT_TIMEOUT) -> str | None:
    if not enabled() or not breaker.allow():
        return None
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0, **({"responseMimeType": "application/json"} if json_mode else {})},
    }
    raw_body = json.dumps(body).encode("utf-8")
    url = _URL.format(model=settings.gemini_model)
    should_trip = False
    deadline = time.monotonic() + MAX_TOTAL_SECONDS
    attempts = _next_keys()[:MAX_ATTEMPTS]

    for idx, api_key in enumerate(attempts):
        remaining = deadline - time.monotonic()
        if idx > 0 and remaining <= 0.5:
            log.warning("Gemini melebihi anggaran waktu %.1f dtk; beralih ke mode aturan.", MAX_TOTAL_SECONDS)
            break
        per_call_timeout = min(timeout, max(1.0, remaining)) if idx > 0 else min(timeout, MAX_TOTAL_SECONDS)
        req = urllib.request.Request(
            url,
            data=raw_body,
            headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=per_call_timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            breaker.ok()
            return text
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "ignore")[:300]
            log.warning("Gemini HTTP %s (model %s): %s", exc.code, settings.gemini_model, detail)
            if exc.code in (400, 401, 403, 404, 429) or exc.code >= 500:
                should_trip = True
            if exc.code in (401, 403, 429) or exc.code >= 500:
                continue  # coba kunci berikutnya di pool
            break
        except (urllib.error.URLError, TimeoutError, KeyError, IndexError, json.JSONDecodeError, OSError) as exc:
            log.warning("Gemini gagal (%s): %s", type(exc).__name__, exc)
            should_trip = True
            break

    if should_trip:
        breaker.fail()
    return None

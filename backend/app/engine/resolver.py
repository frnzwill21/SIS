"""Entity resolver: nama dalam teks -> baris database yang pasti (siswa, guru, ekskul, perusahaan)."""
import re

from .. import queries
from .core import Db
from .parsing import name_tokens

_GENERIC_COMPANY = {"pt", "persero", "tbk", "cv", "indonesia", "jawa", "barat", "kota", "bandung", "jabar", "unit", "up3"}


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", " ", s.lower()).strip()


def find_siswa(db: Db, query: str) -> list[dict]:
    """Cocokkan semua kata dalam `query` ke nama siswa (urutan bebas). Query boleh nama atau NIS."""
    query = (query or "").strip()
    if not query:
        return []
    if query.isdigit():
        return db.rows(queries.SISWA_FIND, q=query)
    toks = [t for t in re.findall(r"[a-zA-Z']+", query.lower()) if len(t) >= 2]
    if not toks:
        return []
    seed = max(toks, key=len)
    rows = db.rows(queries.SISWA_FIND, q=seed)
    return [r for r in rows if all(t in r["nama"].lower() for t in toks)]


def find_siswa_in_text(db: Db, text: str, explicit: str | None = None) -> list[dict]:
    """Utamakan nama dari Gemini (`explicit`); bila kosong atau tidak ketemu, coba kata-kata dalam teks."""
    if explicit:
        rows = find_siswa(db, explicit)
        if rows:
            return rows
    digits = re.findall(r"\b\d{6,10}\b", text)
    for d in digits:
        rows = find_siswa(db, d)
        if rows:
            return rows
    toks = name_tokens(text)
    if not toks:
        return []
    rows = find_siswa(db, " ".join(toks))
    if rows:
        return rows
    for t in sorted(toks, key=len, reverse=True):  # cadangan: satu kata terpanjang
        if len(t) >= 4:
            rows = find_siswa(db, t)
            if rows:
                return rows
    return []


def find_guru(db: Db, text: str, explicit: str | None = None) -> list[dict]:
    cands = [explicit] if explicit else []
    toks = name_tokens(text)
    if toks:
        cands.append(" ".join(toks))
        cands += sorted(toks, key=len, reverse=True)
    seen = set()
    for c in cands:
        if not c or c in seen or len(c) < 3:
            continue
        seen.add(c)
        escaped = c.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        rows = db.rows(queries.GURU_SEARCH, q=escaped)
        if rows:
            if len(rows) > 1 and " " in c:
                words = c.lower().split()
                narrowed = [r for r in rows if all(w in r["nama"].lower() for w in words)]
                rows = narrowed or rows
            return rows
    return []


def find_ekskul(db: Db, text: str, explicit: str | None = None) -> dict | None:
    low = _norm(" ".join(x for x in (explicit, text) if x))
    best, best_len = None, 0
    for e in db.rows(queries.EKSKUL_LIST):
        name = _norm(e["nama"])
        if name and name in low and len(name) > best_len:
            best, best_len = e, len(name)
            continue
        for w in name.split():
            if len(w) >= 5 and w in low and len(w) > best_len and w not in {"seni", "bahasa"}:
                best, best_len = e, len(w)
    return best


def find_perusahaan(db: Db, text: str, explicit: str | None = None) -> list[dict]:
    """Semua perusahaan dengan skor kecocokan tertinggi (nama yang sama bisa ada untuk beberapa jurusan)."""
    low = _norm(" ".join(x for x in (explicit, text) if x))
    scored = []
    for p in db.rows(queries.PERUSAHAAN_LIST):
        words = [w for w in _norm(p["nama"]).split() if len(w) >= 3 and w not in _GENERIC_COMPANY]
        hits = [w for w in words if re.search(rf"\b{re.escape(w)}\b", low)]
        if hits:
            scored.append((sum(len(w) for w in hits), p))
    if not scored:
        return []
    best = max(s for s, _ in scored)
    return [p for s, p in scored if s == best]

"""Knowledge Graph engine: ekstraksi teks dokumen (stdlib), graf entitas sekolah, dan deteksi konflik."""
import csv
import io
import json
import re
import zipfile
import zlib
from collections import Counter
from pathlib import Path
from typing import Any
import xml.etree.ElementTree as ET

from sqlalchemy import Connection, inspect, text

MAX_FILE_BYTES = 5 * 1024 * 1024  # 5 MB
SUPPORTED_EXTENSIONS = {".md", ".txt", ".json", ".csv", ".xlsx", ".pdf"}

_STOP_TOPICS = {
    "yang", "dan", "atau", "dari", "untuk", "dengan", "pada", "dalam", "oleh", "adalah", "akan", "bisa",
    "dapat", "harus", "wajib", "tidak", "bukan", "juga", "serta", "sebagai", "tentang", "mengenai",
    "tahun", "ajaran", "smkn", "bandung", "negeri", "sekolah", "siswa", "guru", "kelas", "data",
    "nomor", "tanggal", "bulan", "hari", "jam", "pukul", "pada", "saat", "bagi", "para", "semua",
    "setiap", "seluruh", "sudah", "belum", "masih", "agar", "supaya", "jika", "bila", "apabila",
    "tersebut", "berikut", "seperti", "antara", "lain", "melalui", "kepada", "terhadap", "karena",
    "maka", "yaitu", "yakni", "hal", "ini", "itu", "ada", "secara", "lebih", "kurang", "minimal",
    "maksimal", "sesuai", "berdasarkan", "dokumen", "lampiran", "perihal", "catatan", "keterangan",
}

_GENERIC_ENTITY_WORDS = {
    "pt", "persero", "tbk", "cv", "indonesia", "jawa", "barat", "kota", "bandung", "jabar",
    "unit", "up3", "teknik", "rekayasa", "industri", "negeri", "smk", "smkn", "xii",
    "dan", "atau", "dari", "divisi", "humas", "desain", "bagian", "bidang", "kantor",
    "cabang", "pusat", "daerah", "wilayah", "nasional", "teknologi", "informasi", "komunikasi",
    "marketing", "communication", "digital", "service", "sistem", "media",
}

_PDF_SKIP_WORDS = {
    "obj", "endobj", "stream", "endstream", "xref", "trailer", "startxref",
    "flatedecode", "type", "font", "page", "pages", "catalog", "procset", "mediabox",
}


def file_extension(nama_file: str) -> str:
    return Path(nama_file or "").suffix.lower()


def _decode_text(raw_bytes: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            text_val = raw_bytes.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        text_val = raw_bytes.decode("utf-8", errors="replace")
    return text_val.replace("\r\n", "\n").replace("\r", "\n").strip()


def _flatten_json(node: Any, prefix: str = "") -> list[str]:
    lines: list[str] = []
    if isinstance(node, dict):
        for k, v in node.items():
            key = f"{prefix} > {k}" if prefix else str(k)
            if isinstance(v, (dict, list)):
                lines.extend(_flatten_json(v, key))
            else:
                lines.append(f"{key}: {v}")
    elif isinstance(node, list):
        for i, item in enumerate(node, 1):
            if isinstance(item, (dict, list)):
                lines.extend(_flatten_json(item, f"{prefix}[{i}]" if prefix else f"item {i}"))
            else:
                lines.append(f"{prefix}: {item}" if prefix else str(item))
    else:
        lines.append(f"{prefix}: {node}" if prefix else str(node))
    return lines


def _extract_json(raw_bytes: bytes) -> str:
    try:
        data = json.loads(_decode_text(raw_bytes))
    except json.JSONDecodeError as exc:
        raise ValueError("Format file JSON tidak valid.") from exc
    return "\n".join(_flatten_json(data)).strip()


def _extract_csv(raw_bytes: bytes) -> str:
    content = _decode_text(raw_bytes)
    reader = list(csv.reader(io.StringIO(content)))
    rows = [[c.strip() for c in r] for r in reader if any(c.strip() for c in r)]
    if not rows:
        return ""
    if len(rows) == 1:
        return " | ".join(c for c in rows[0] if c)
    header = rows[0]
    lines = []
    use_header = len(header) >= 2 and all(len(h) <= 60 for h in header)
    for r in rows[1:]:
        if use_header:
            pairs = [f"{header[i] if i < len(header) and header[i] else f'kolom_{i+1}'}: {val}"
                     for i, val in enumerate(r) if val]
            if pairs:
                lines.append("; ".join(pairs))
        else:
            joined = " | ".join(c for c in r if c)
            if joined:
                lines.append(joined)
    if not lines:
        return " | ".join(c for c in header if c)
    return "\n".join(lines)


def _xml_tag(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def _col_index(cell_ref: str) -> int:
    letters = "".join(ch for ch in cell_ref if ch.isalpha()).upper()
    idx = 0
    for ch in letters:
        idx = idx * 26 + (ord(ch) - ord("A") + 1)
    return max(0, idx - 1)


def _extract_xlsx(raw_bytes: bytes) -> str:
    max_uncompressed = 20 * 1024 * 1024
    total_read = 0
    try:
        with zipfile.ZipFile(io.BytesIO(raw_bytes)) as zf:
            names = set(zf.namelist())
            shared_strings: list[str] = []
            if "xl/sharedStrings.xml" in names:
                data = zf.read("xl/sharedStrings.xml")
                total_read += len(data)
                if total_read > max_uncompressed:
                    raise ValueError("Berkas XLSX terlalu besar saat diekstrak.")
                root = ET.fromstring(data)
                for si in root.iter():
                    if _xml_tag(si.tag) == "si":
                        txt = "".join(t.text or "" for t in si.iter() if _xml_tag(t.tag) == "t")
                        shared_strings.append(txt)

            sheet_names = sorted(
                (n for n in names if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n)),
                key=lambda s: int(re.search(r"(\d+)", s).group(1)),
            )
            if not sheet_names:
                raise ValueError("Tidak ada worksheet di dalam file XLSX.")

            lines: list[str] = []
            for sname in sheet_names:
                data = zf.read(sname)
                total_read += len(data)
                if total_read > max_uncompressed:
                    raise ValueError("Berkas XLSX terlalu besar saat diekstrak.")
                root = ET.fromstring(data)
                sheet_rows: list[list[str]] = []
                for row_el in root.iter():
                    if _xml_tag(row_el.tag) != "row":
                        continue
                    row_vals: dict[int, str] = {}
                    fallback_idx = 0
                    for cell in row_el:
                        if _xml_tag(cell.tag) != "c":
                            continue
                        ref = cell.attrib.get("r", "")
                        c_idx = _col_index(ref) if ref else fallback_idx
                        fallback_idx = c_idx + 1
                        ctype = cell.attrib.get("t", "")
                        val = ""
                        if ctype == "inlineStr":
                            val = "".join(t.text or "" for t in cell.iter() if _xml_tag(t.tag) == "t")
                        else:
                            v_el = next((ch for ch in cell if _xml_tag(ch.tag) == "v"), None)
                            if v_el is not None and v_el.text is not None:
                                raw_v = v_el.text.strip()
                                if ctype == "s":
                                    try:
                                        val = shared_strings[int(raw_v)]
                                    except (ValueError, IndexError):
                                        val = raw_v
                                else:
                                    val = raw_v
                        val = val.strip()
                        if val:
                            row_vals[c_idx] = val
                    if row_vals:
                        max_c = max(row_vals)
                        sheet_rows.append([row_vals.get(i, "") for i in range(max_c + 1)])

                if len(sheet_rows) >= 2 and all(len(h) <= 60 for h in sheet_rows[0]):
                    header = sheet_rows[0]
                    for r in sheet_rows[1:]:
                        pairs = [
                            f"{header[i] if i < len(header) and header[i] else f'kolom_{i+1}'}: {v}"
                            for i, v in enumerate(r) if v
                        ]
                        if pairs:
                            lines.append("; ".join(pairs))
                else:
                    for r in sheet_rows:
                        joined = " | ".join(v for v in r if v)
                        if joined:
                            lines.append(joined)
            return "\n".join(lines).strip()
    except (zipfile.BadZipFile, ET.ParseError) as exc:
        raise ValueError("Format file XLSX rusak atau tidak valid.") from exc


def _unescape_pdf_literal(raw: bytes) -> str:
    out = bytearray()
    i = 0
    n = len(raw)
    escapes = {
        ord("n"): 10, ord("r"): 13, ord("t"): 9, ord("b"): 8, ord("f"): 12,
        ord("("): 40, ord(")"): 41, ord("\\"): 92,
    }
    while i < n:
        b = raw[i]
        if b == 92 and i + 1 < n:
            nxt = raw[i + 1]
            if nxt in escapes:
                out.append(escapes[nxt])
                i += 2
                continue
            if nxt in (10, 13):  # line continuation
                i += 2
                if nxt == 13 and i < n and raw[i] == 10:
                    i += 1
                continue
            if 48 <= nxt <= 55:  # octal \ddd
                oct_digits = bytes([nxt])
                j = i + 2
                while j < n and len(oct_digits) < 3 and 48 <= raw[j] <= 55:
                    oct_digits += bytes([raw[j]])
                    j += 1
                out.append(int(oct_digits, 8) & 0xFF)
                i = j
                continue
        out.append(b)
        i += 1
    data = bytes(out)
    if data.startswith(b"\xfe\xff"):
        return data[2:].decode("utf-16-be", errors="replace")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("latin-1", errors="replace")


def _extract_pdf_stream_text(stream_bytes: bytes) -> list[str]:
    pieces: list[str] = []
    # Extract (...) literals inside Tj/TJ/'/" or BT..ET blocks
    i = 0
    n = len(stream_bytes)
    while i < n:
        if stream_bytes[i] == 40:  # '('
            depth = 1
            j = i + 1
            while j < n and depth > 0:
                c = stream_bytes[j]
                if c == 92:  # '\'
                    j += 2
                    continue
                if c == 40:
                    depth += 1
                elif c == 41:
                    depth -= 1
                j += 1
            if depth == 0:
                txt = _unescape_pdf_literal(stream_bytes[i + 1 : j - 1])
                if txt and any(ch.isalnum() for ch in txt):
                    pieces.append(txt)
                i = j
                continue
        i += 1

    if not pieces:
        # Hex-encoded strings before Tj/TJ
        for m in re.finditer(rb"<([0-9A-Fa-f\s]{4,})>\s*(?:Tj|TJ)", stream_bytes):
            hex_clean = re.sub(rb"\s+", b"", m.group(1))
            if len(hex_clean) % 2 != 0:
                continue
            try:
                raw = bytes.fromhex(hex_clean.decode("ascii"))
            except ValueError:
                continue
            if raw.startswith(b"\xfe\xff"):
                txt = raw[2:].decode("utf-16-be", errors="ignore")
            elif len(raw) >= 4 and sum(1 for k in range(0, len(raw), 2) if raw[k] == 0) >= len(raw) // 3:
                txt = raw.decode("utf-16-be", errors="ignore")
            else:
                txt = raw.decode("utf-8", errors="ignore")
            txt = "".join(ch for ch in txt if ch.isprintable() or ch in "\n\t ")
            if txt.strip():
                pieces.append(txt.strip())
    return pieces


def _extract_pdf(raw_bytes: bytes) -> str:
    head = raw_bytes[:1024]
    if b"%PDF" not in head:
        raise ValueError("Format file PDF tidak valid.")

    chunks: list[str] = []
    for m in re.finditer(rb"stream\r?\n(.*?)\r?\n?endstream", raw_bytes, re.DOTALL):
        payload = m.group(1)
        decompressed: bytes | None = None
        for candidate in (payload, payload.strip(b"\r\n")):
            try:
                decompressed = zlib.decompress(candidate)
                break
            except zlib.error:
                continue
        target = decompressed if decompressed is not None else payload
        if b"BT" in target or b"Tj" in target or b"TJ" in target or b"(" in target:
            pieces = _extract_pdf_stream_text(target)
            if pieces:
                chunks.append(" ".join(pieces))

    if not chunks:
        # Fallback regex atas konten teks terbaca
        for m in re.finditer(rb"[A-Za-z0-9][A-Za-z0-9 ,.;:()/\-_%]{8,}", raw_bytes):
            s = m.group(0).decode("latin-1", errors="ignore").strip()
            low_tokens = {w.lower() for w in re.findall(r"[a-zA-Z]+", s)}
            if low_tokens and not (low_tokens <= _PDF_SKIP_WORDS):
                chunks.append(s)

    text_out = re.sub(r"[ \t]+", " ", "\n".join(chunks))
    text_out = re.sub(r"\n{3,}", "\n\n", text_out).strip()
    if not text_out:
        raise ValueError("PDF tidak memiliki teks yang dapat diekstrak (kemungkinan hasil pindai gambar).")
    return text_out


def extract_text(nama_file: str, raw_bytes: bytes) -> str:
    """Ekstrak teks polos dari berkas .md, .txt, .json, .csv, .xlsx, atau .pdf (maks 5 MB, stdlib saja)."""
    if not raw_bytes:
        raise ValueError("Berkas kosong.")
    if len(raw_bytes) > MAX_FILE_BYTES:
        raise ValueError("Ukuran berkas melebihi batas maksimal 5 MB.")
    ext = file_extension(nama_file)
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError("Format berkas tidak didukung. Gunakan .md, .txt, .json, .csv, .xlsx, atau .pdf.")

    if ext in (".md", ".txt"):
        out = _decode_text(raw_bytes)
    elif ext == ".json":
        out = _extract_json(raw_bytes)
    elif ext == ".csv":
        out = _extract_csv(raw_bytes)
    elif ext == ".xlsx":
        out = _extract_xlsx(raw_bytes)
    else:
        out = _extract_pdf(raw_bytes)

    out = out.strip()
    if not out:
        raise ValueError("Tidak ada teks yang berhasil diekstrak dari berkas ini.")
    return out


# ------------------------------------------------------------------ Graph DB Helpers
def _is_pg(conn: Connection) -> bool:
    return conn.dialect.name == "postgresql"


def _has_table(conn: Connection, table_name: str) -> bool:
    try:
        return bool(inspect(conn).has_table(table_name))
    except Exception:  # noqa: BLE001
        return False


def _upsert_node(
    conn: Connection,
    kunci: str,
    label: str,
    tipe: str,
    sumber: str = "dokumen",
    document_id: int | None = None,
    metadata: dict | None = None,
    status: str = "aktif",
) -> int:
    meta_json = json.dumps(metadata or {}, ensure_ascii=False)
    meta_expr = "CAST(:meta AS JSONB)" if _is_pg(conn) else ":meta"
    row = conn.execute(
        text(
            f"INSERT INTO knowledge_node (kunci, label, tipe, sumber, document_id, metadata_json, status) "
            f"VALUES (:kunci, :label, :tipe, :sumber, :doc_id, {meta_expr}, :status) "
            f"ON CONFLICT (kunci) DO UPDATE SET "
            f"label = EXCLUDED.label, "
            f"tipe = EXCLUDED.tipe, "
            f"sumber = EXCLUDED.sumber, "
            f"metadata_json = EXCLUDED.metadata_json, "
            f"document_id = CASE WHEN knowledge_node.status = 'dihapus' THEN EXCLUDED.document_id "
            f"ELSE COALESCE(knowledge_node.document_id, EXCLUDED.document_id) END, "
            f"status = CASE "
            f"WHEN knowledge_node.status = 'dihapus' THEN EXCLUDED.status "
            f"WHEN EXCLUDED.status = 'konflik' THEN 'konflik' "
            f"ELSE knowledge_node.status END "
            f"RETURNING id"
        ),
        {
            "kunci": kunci[:140],
            "label": label,
            "tipe": tipe[:30],
            "sumber": sumber[:20],
            "doc_id": document_id,
            "meta": meta_json,
            "status": status[:20],
        },
    ).first()
    return int(row[0])


def _upsert_edge(
    conn: Connection,
    source_id: int,
    target_id: int,
    relasi: str,
    document_id: int | None = None,
    status: str = "aktif",
    catatan: str = "",
) -> None:
    if source_id == target_id:
        return
    conn.execute(
        text(
            "INSERT INTO knowledge_edge (source_id, target_id, relasi, document_id, status, catatan) "
            "VALUES (:src, :tgt, :rel, :doc_id, :status, :catatan) "
            "ON CONFLICT (source_id, target_id, relasi) DO UPDATE SET "
            "document_id = CASE WHEN knowledge_edge.status = 'dihapus' THEN EXCLUDED.document_id "
            "ELSE COALESCE(knowledge_edge.document_id, EXCLUDED.document_id) END, "
            "status = CASE "
            "WHEN knowledge_edge.status = 'dihapus' THEN EXCLUDED.status "
            "WHEN EXCLUDED.status = 'konflik' THEN 'konflik' "
            "ELSE knowledge_edge.status END, "
            "catatan = CASE WHEN EXCLUDED.catatan <> '' THEN EXCLUDED.catatan ELSE knowledge_edge.catatan END"
        ),
        {
            "src": source_id,
            "tgt": target_id,
            "rel": relasi[:60],
            "doc_id": document_id,
            "status": status[:20],
            "catatan": catatan,
        },
    )


def build_base_graph(conn: Connection) -> dict[str, int]:
    """Bangun/sinkronkan graf dasar SMKN 4 Bandung dari tabel master sekolah (idempoten)."""
    if not (_has_table(conn, "knowledge_node") and _has_table(conn, "knowledge_edge")):
        return {"nodes": 0, "edges": 0}

    school_id = _upsert_node(
        conn,
        "sekolah:smkn4",
        "SMK Negeri 4 Bandung",
        "sekolah",
        sumber="sistem",
        metadata={"npsn": "20219144", "kota": "Bandung", "akreditasi": "A"},
    )
    node_count = 1
    edge_count = 0
    jurusan_ids: dict[str, int] = {}
    kelas_ids: dict[str, int] = {}
    wali_nips: set[str] = set()

    if _has_table(conn, "jurusan"):
        for r in conn.execute(text("SELECT kode, nama_konsentrasi, program_keahlian FROM jurusan ORDER BY kode")).mappings():
            nid = _upsert_node(
                conn,
                f"jurusan:{r['kode']}",
                f"{r['kode']} - {r['nama_konsentrasi']}",
                "jurusan",
                sumber="sistem",
                metadata={"kode": r["kode"], "nama_konsentrasi": r["nama_konsentrasi"], "program_keahlian": r["program_keahlian"]},
            )
            jurusan_ids[r["kode"]] = nid
            _upsert_edge(conn, school_id, nid, "memiliki_jurusan")
            node_count += 1
            edge_count += 1

    if _has_table(conn, "kelas"):
        for r in conn.execute(text("SELECT kode, nama, jurusan_kode, tahun_ajaran, wali_kelas_nip FROM kelas ORDER BY kode")).mappings():
            nid = _upsert_node(
                conn,
                f"kelas:{r['kode']}",
                r["nama"],
                "kelas",
                sumber="sistem",
                metadata={"kode": r["kode"], "jurusan_kode": r["jurusan_kode"], "tahun_ajaran": r["tahun_ajaran"]},
            )
            kelas_ids[r["kode"]] = nid
            parent = jurusan_ids.get(r["jurusan_kode"], school_id)
            _upsert_edge(conn, parent, nid, "memiliki_kelas")
            if r["wali_kelas_nip"]:
                wali_nips.add(r["wali_kelas_nip"])
            node_count += 1
            edge_count += 1

    if _has_table(conn, "guru"):
        guru_ids: dict[str, int] = {}
        for r in conn.execute(text("SELECT nip, nama FROM guru ORDER BY nama")).mappings():
            nid = _upsert_node(
                conn,
                f"guru:{r['nip']}",
                r["nama"],
                "guru",
                sumber="sistem",
                metadata={"nip": r["nip"]},
            )
            guru_ids[r["nip"]] = nid
            node_count += 1
            if r["nip"] not in wali_nips:
                _upsert_edge(conn, school_id, nid, "tenaga_pendidik")
                edge_count += 1
        if _has_table(conn, "kelas"):
            for r in conn.execute(text("SELECT kode, wali_kelas_nip FROM kelas WHERE wali_kelas_nip IS NOT NULL")).mappings():
                gid = guru_ids.get(r["wali_kelas_nip"])
                kid = kelas_ids.get(r["kode"])
                if gid and kid:
                    _upsert_edge(conn, gid, kid, "wali_kelas")
                    edge_count += 1

    if _has_table(conn, "perusahaan_pkl"):
        for r in conn.execute(
            text("SELECT kode, nama, jurusan_kode, bidang_usaha, kota, posisi_tersedia FROM perusahaan_pkl ORDER BY kode")
        ).mappings():
            nid = _upsert_node(
                conn,
                f"perusahaan:{r['kode']}",
                r["nama"],
                "perusahaan",
                sumber="sistem",
                metadata={
                    "kode": r["kode"],
                    "jurusan_kode": r["jurusan_kode"],
                    "bidang_usaha": r["bidang_usaha"],
                    "kota": r["kota"],
                    "posisi_tersedia": r["posisi_tersedia"],
                },
            )
            parent = jurusan_ids.get(r["jurusan_kode"], school_id)
            _upsert_edge(conn, parent, nid, "mitra_pkl")
            node_count += 1
            edge_count += 1

    if _has_table(conn, "ekstrakurikuler"):
        for r in conn.execute(text("SELECT kode, nama, hari, waktu FROM ekstrakurikuler ORDER BY kode")).mappings():
            nid = _upsert_node(
                conn,
                f"ekskul:{r['kode']}",
                r["nama"],
                "ekskul",
                sumber="sistem",
                metadata={"kode": r["kode"], "hari": r["hari"], "waktu": r["waktu"]},
            )
            _upsert_edge(conn, school_id, nid, "memiliki_ekskul")
            node_count += 1
            edge_count += 1

    return {"nodes": node_count, "edges": edge_count}


def ensure_base_graph(conn: Connection) -> None:
    if not _has_table(conn, "knowledge_node"):
        return
    cnt = conn.execute(text("SELECT COUNT(*) FROM knowledge_node WHERE sumber = 'sistem' AND status <> 'dihapus'")).scalar_one()
    if int(cnt or 0) == 0:
        build_base_graph(conn)


def _summarize(text_val: str, max_len: int = 320) -> str:
    cleaned = re.sub(r"[#*_`]+", " ", text_val or "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if len(cleaned) <= max_len:
        return cleaned
    cut = cleaned[:max_len].rsplit(" ", 1)[0].strip()
    return (cut or cleaned[:max_len]) + "..."


def _extract_topics(text_val: str, limit: int = 5) -> list[str]:
    tokens = [
        t for t in re.findall(r"[a-zA-Z][a-zA-Z0-9-]{3,}", text_val.lower())
        if t not in _STOP_TOPICS and not t.isdigit()
    ]
    if not tokens:
        return []
    counts = Counter(tokens)
    topics: list[str] = []
    for word, _ in counts.most_common(limit * 2):
        if len(topics) >= limit:
            break
        topics.append(word.capitalize())
    return topics


def _match_system_nodes(conn: Connection, text_val: str) -> list[dict]:
    low = re.sub(r"\s+", " ", text_val.lower())
    rows = conn.execute(
        text(
            "SELECT id, kunci, label, tipe, metadata_json FROM knowledge_node "
            "WHERE sumber = 'sistem' AND status <> 'dihapus' ORDER BY id"
        )
    ).mappings().all()
    matched: list[dict] = []
    for r in rows:
        meta = r["metadata_json"]
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except json.JSONDecodeError:
                meta = {}
        meta = meta or {}
        tipe = r["tipe"]
        label = r["label"] or ""
        hit = False
        if tipe == "sekolah":
            hit = bool(re.search(r"\bsmkn?\s*4\b|\bsmk\s+negeri\s+4\b", low))
        elif tipe == "jurusan":
            kode = str(meta.get("kode") or "").lower()
            kons = str(meta.get("nama_konsentrasi") or "").lower()
            hit = bool((kode and re.search(rf"\b{re.escape(kode)}\b", low)) or (kons and kons in low))
        elif tipe == "kelas":
            kode = str(meta.get("kode") or "").lower()
            nama = label.lower()
            hit = bool((nama and re.search(rf"\b{re.escape(nama)}\b", low)) or (kode and kode in low))
        elif tipe == "guru":
            # Cocokkan nama lengkap tanpa gelar (atau minimal 2 kata pertama yang unik)
            clean_name = re.sub(r",.*$", "", label).strip().lower()
            clean_name = re.sub(r"^(drs|dr|ir|h|hj)\.?\s+", "", clean_name)
            parts = [w for w in re.findall(r"[a-z]{3,}", clean_name)]
            if len(parts) >= 2:
                hit = all(re.search(rf"\b{re.escape(w)}\b", low) for w in parts[:2])
            elif len(parts) == 1 and len(parts[0]) >= 5:
                hit = bool(re.search(rf"\b{re.escape(parts[0])}\b", low))
        elif tipe == "perusahaan":
            core_raw = label.split(" - ", 1)[0]
            core_tokens = [
                w for w in re.findall(r"[a-z0-9]+", core_raw.lower())
                if w not in {"pt", "cv", "persero", "tbk"}
            ]
            core_phrase = " ".join(core_tokens)
            words = list(dict.fromkeys(w for w in core_tokens if len(w) >= 3 and w not in _GENERIC_ENTITY_WORDS))
            if core_phrase and re.search(rf"\b{re.escape(core_phrase)}\b", low):
                hit = True
            elif len(words) >= 2:
                hits_count = sum(1 for w in words if re.search(rf"\b{re.escape(w)}\b", low))
                hit = hits_count >= 2
            elif len(words) == 1 and len(words[0]) >= 4:
                hit = bool(re.search(rf"\b{re.escape(words[0])}\b", low))
        elif tipe == "ekskul":
            name_low = label.lower()
            hit = bool(len(name_low) >= 4 and re.search(rf"\b{re.escape(name_low)}\b", low))
        if hit:
            matched.append({"id": int(r["id"]), "kunci": r["kunci"], "label": label, "tipe": tipe})
    return matched


def _sentence_numbers(text_val: str) -> list[tuple[set[str], set[str]]]:
    """Kumpulkan pasangan (kata_kunci_konteks, angka) per kalimat untuk mendeteksi kontradiksi faktual."""
    out: list[tuple[set[str], set[str]]] = []
    for sent in re.split(r"[.\n;]+", text_val):
        nums = set(re.findall(r"\b\d+(?:[.,:]\d+)?\b", sent))
        if not nums:
            continue
        words = {
            w for w in re.findall(r"[a-z]{3,}", sent.lower())
            if w not in _STOP_TOPICS
        }
        if words:
            out.append((words, nums))
    return out


def _detect_conflicts(
    conn: Connection,
    doc_id: int,
    nama_file: str,
    text_val: str,
    matched_entities: list[dict],
) -> list[dict]:
    """Deteksi duplikasi nama berkas atau perbedaan angka faktual pada konteks topik/entitas yang sama."""
    existing_docs = conn.execute(
        text(
            "SELECT id, nama_file, konten_teks FROM knowledge_document "
            "WHERE id <> :doc_id AND status IN ('aktif', 'menunggu_hapus') ORDER BY id DESC"
        ),
        {"doc_id": doc_id},
    ).mappings().all()

    new_sents = _sentence_numbers(text_val)
    entity_tokens = {
        w
        for m in matched_entities
        for w in re.findall(r"[a-z0-9]{3,}", m["label"].lower())
        if w not in _GENERIC_ENTITY_WORDS
    }
    stem_new = Path(nama_file).stem.lower().strip()
    conflicts: list[dict] = []

    for other in existing_docs:
        other_id = int(other["id"])
        other_name = other["nama_file"]
        reason = ""
        if other_name.lower().strip() == nama_file.lower().strip() or Path(other_name).stem.lower().strip() == stem_new:
            reason = f"Nama dokumen serupa atau menggantikan '{other_name}'."
        else:
            other_sents = _sentence_numbers(other["konten_teks"] or "")
            for w_new, n_new in new_sents:
                for w_old, n_old in other_sents:
                    shared = w_new & w_old
                    if (len(shared) >= 2 or (shared & entity_tokens)) and n_new != n_old:
                        sample_terms = ", ".join(sorted(shared)[:3])
                        reason = (
                            f"Perbedaan nilai angka ({', '.join(sorted(n_new)[:2])} vs {', '.join(sorted(n_old)[:2])}) "
                            f"pada konteks '{sample_terms}' terhadap '{other_name}'."
                        )
                        break
                if reason:
                    break
        if reason:
            conflicts.append({"document_id": other_id, "nama_file": other_name, "alasan": reason})
    return conflicts


def process_document_into_graph(
    conn: Connection,
    doc_id: int,
    nama_file: str,
    text_val: str,
    user_id: int,
) -> dict:
    """Ekstrak ringkasan, entitas sekolah cocok, topik utama, dan potensi konflik ke Knowledge Graph."""
    ensure_base_graph(conn)
    ringkasan = _summarize(text_val)
    matched = _match_system_nodes(conn, f"{nama_file}\n{text_val}")
    topics = _extract_topics(text_val, limit=5)
    conflicts = _detect_conflicts(conn, doc_id, nama_file, text_val, matched)

    doc_node_id = _upsert_node(
        conn,
        f"dokumen:{doc_id}",
        nama_file,
        "dokumen",
        sumber="dokumen",
        document_id=doc_id,
        metadata={
            "doc_id": doc_id,
            "nama_file": nama_file,
            "ringkasan": ringkasan[:200],
            "diunggah_oleh": user_id,
        },
        status="aktif",
    )

    rel_count = 0
    for ent in matched:
        _upsert_edge(conn, doc_node_id, ent["id"], "menyebut", document_id=doc_id, status="aktif")
        rel_count += 1

    if not matched:
        school_row = conn.execute(
            text("SELECT id FROM knowledge_node WHERE kunci = 'sekolah:smkn4' AND status <> 'dihapus'")
        ).first()
        if school_row:
            _upsert_edge(conn, doc_node_id, int(school_row[0]), "terkait_sekolah", document_id=doc_id, status="aktif")
            rel_count += 1

    for t in topics:
        slug = re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")
        if not slug:
            continue
        t_id = _upsert_node(
            conn,
            f"topik:{slug}",
            t,
            "topik",
            sumber="dokumen",
            document_id=doc_id,
            metadata={"topik": t},
            status="aktif",
        )
        _upsert_edge(conn, doc_node_id, t_id, "membahas", document_id=doc_id, status="aktif")
        rel_count += 1

    for conf in conflicts:
        other_row = conn.execute(
            text("SELECT id FROM knowledge_node WHERE kunci = :k AND status <> 'dihapus'"),
            {"k": f"dokumen:{conf['document_id']}"},
        ).first()
        if other_row:
            _upsert_edge(
                conn,
                doc_node_id,
                int(other_row[0]),
                "potensi_konflik",
                document_id=doc_id,
                status="konflik",
                catatan=conf["alasan"],
            )
            rel_count += 1

    return {
        "ringkasan": ringkasan,
        "matched_entities": matched,
        "topics": topics,
        "konflik": conflicts,
        "jumlah_relasi": rel_count,
    }

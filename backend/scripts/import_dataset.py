"""Buat skema dan muat dataset bersih ke PostgreSQL.

Pemakaian (dari folder backend/):
    python -m scripts.import_dataset            # buat skema bila belum ada, muat bila tabel siswa kosong
    python -m scripts.import_dataset --reset    # HAPUS semua (termasuk akun), buat ulang, muat ulang
"""
import argparse
import csv
import sys

from .common import DATASET_DIR, EXPECTED_ROWS, LOAD_ORDER, SQL_DIR, connect


def table_exists(cur, name: str) -> bool:
    cur.execute("SELECT to_regclass(%s)", (f"public.{name}",))
    return cur.fetchone()[0] is not None


_EXTENSION_DDL = """
CREATE TABLE IF NOT EXISTS chat_sessions (
    id               VARCHAR(36) PRIMARY KEY,
    user_id          INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    judul            VARCHAR(160) NOT NULL,
    pinned           BOOLEAN NOT NULL DEFAULT FALSE,
    dibuat_pada      TIMESTAMPTZ NOT NULL DEFAULT now(),
    diperbarui_pada  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions (user_id, pinned DESC, diperbarui_pada DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
    id             BIGSERIAL PRIMARY KEY,
    session_id     VARCHAR(36) NOT NULL REFERENCES chat_sessions (id) ON DELETE CASCADE,
    role           VARCHAR(10) NOT NULL CHECK (role IN ('user', 'ai')),
    konten         TEXT NOT NULL,
    metadata_json  JSONB,
    dibuat_pada    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages (session_id, id);

CREATE TABLE IF NOT EXISTS knowledge_document (
    id             SERIAL PRIMARY KEY,
    nama_file      TEXT NOT NULL,
    tipe_file      VARCHAR(20) NOT NULL,
    ukuran_bytes   INTEGER NOT NULL,
    ringkasan      TEXT NOT NULL DEFAULT '',
    konten_teks    TEXT NOT NULL DEFAULT '',
    status         VARCHAR(25) NOT NULL DEFAULT 'aktif' CHECK (status IN ('diproses', 'aktif', 'menunggu_hapus', 'dihapus')),
    diunggah_oleh  INTEGER REFERENCES users (id),
    dibuat_pada    TIMESTAMPTZ NOT NULL DEFAULT now(),
    dihapus_pada   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS knowledge_node (
    id             SERIAL PRIMARY KEY,
    kunci          VARCHAR(140) NOT NULL UNIQUE,
    label          TEXT NOT NULL,
    tipe           VARCHAR(30) NOT NULL,
    sumber         VARCHAR(20) NOT NULL DEFAULT 'dokumen',
    document_id    INTEGER REFERENCES knowledge_document (id) ON DELETE SET NULL,
    metadata_json  JSONB,
    status         VARCHAR(20) NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif', 'saran', 'konflik', 'dihapus')),
    dibuat_pada    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_edge (
    id           SERIAL PRIMARY KEY,
    source_id    INTEGER NOT NULL REFERENCES knowledge_node (id) ON DELETE CASCADE,
    target_id    INTEGER NOT NULL REFERENCES knowledge_node (id) ON DELETE CASCADE,
    relasi       VARCHAR(60) NOT NULL,
    document_id  INTEGER REFERENCES knowledge_document (id) ON DELETE SET NULL,
    status       VARCHAR(20) NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif', 'saran', 'konflik', 'dihapus')),
    catatan      TEXT NOT NULL DEFAULT '',
    UNIQUE (source_id, target_id, relasi)
);

CREATE TABLE IF NOT EXISTS delete_request (
    id             SERIAL PRIMARY KEY,
    document_id    INTEGER NOT NULL REFERENCES knowledge_document (id) ON DELETE CASCADE,
    diajukan_oleh  INTEGER NOT NULL REFERENCES users (id),
    alasan         TEXT NOT NULL,
    status         VARCHAR(20) NOT NULL DEFAULT 'menunggu' CHECK (status IN ('menunggu', 'disetujui', 'ditolak')),
    diproses_oleh  INTEGER REFERENCES users (id),
    catatan_admin  TEXT,
    dibuat_pada    TIMESTAMPTZ NOT NULL DEFAULT now(),
    diproses_pada  TIMESTAMPTZ
);
"""


def ensure_schema(conn, reset: bool = False) -> None:
    with conn.cursor() as cur:
        if reset:
            cur.execute("DROP SCHEMA public CASCADE")
            cur.execute("CREATE SCHEMA public")
        if not table_exists(cur, "siswa"):
            for name in ("01_schema.sql", "02_system.sql"):
                cur.execute((SQL_DIR / name).read_text(encoding="utf-8"))
            print("Skema dibuat.")
        if table_exists(cur, "users"):
            # Migrasi idempoten untuk volume DB lama: pencabutan JWT persisten, keunikan username, & 4 peran (ref/06)
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1")
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS token_exempt_jti VARCHAR(64)")
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS foto_profil TEXT")
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username_lower ON users (LOWER(username))")
            cur.execute("ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(20)")
            cur.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check")
            cur.execute(
                "ALTER TABLE users ADD CONSTRAINT users_role_check "
                "CHECK (role IN ('admin', 'kepala_sekolah', 'bk', 'teacher'))"
            )
            cur.execute(_EXTENSION_DDL)
    conn.commit()


def is_loaded(conn) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM siswa")
        return cur.fetchone()[0] > 0


def load_all(conn, who: str = "import_dataset") -> dict:
    """Muat 21 CSV dalam satu transaksi: gagal berarti tidak ada yang berubah."""
    counts = {}
    with conn.cursor() as cur:
        for table in LOAD_ORDER:
            path = DATASET_DIR / f"{table}.csv"
            with path.open(encoding="utf-8", newline="") as fh:
                header = next(csv.reader(fh))
            cols = ", ".join(header)
            with path.open("rb") as fh, cur.copy(
                f"COPY {table} ({cols}) FROM STDIN WITH (FORMAT csv, HEADER true)"
            ) as copy:
                while chunk := fh.read(65536):
                    copy.write(chunk)
            cur.execute(f"SELECT count(*) FROM {table}")
            counts[table] = cur.fetchone()[0]
        bad = {t: (n, EXPECTED_ROWS[t]) for t, n in counts.items() if n != EXPECTED_ROWS[t]}
        if bad:
            conn.rollback()
            raise SystemExit(f"Jumlah baris tidak sesuai (dimuat, diharapkan): {bad}")
        cur.execute(
            "INSERT INTO import_batch (dijalankan_oleh, nama_file, jumlah_baris, status) VALUES (%s, %s, %s, %s)",
            (who, "dataset_bersih (21 CSV)", sum(counts.values()), "berhasil"),
        )
    conn.commit()
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--reset", action="store_true", help="hapus semua data dan akun, lalu muat ulang")
    args = parser.parse_args()

    conn = connect()
    ensure_schema(conn, reset=args.reset)
    if is_loaded(conn):
        print("Dataset sudah terisi; lewati. Pakai --reset untuk memuat ulang.")
        return
    counts = load_all(conn)
    for table in LOAD_ORDER:
        print(f"  {table:20s} {counts[table]:>7,}")
    print("Dataset berhasil dimuat.")


if __name__ == "__main__":
    sys.exit(main())

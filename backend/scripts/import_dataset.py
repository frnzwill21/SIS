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
            # Migrasi idempoten untuk volume DB lama: pencabutan JWT persisten + keunikan username case-insensitive
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1")
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS token_exempt_jti VARCHAR(64)")
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username_lower ON users (LOWER(username))")
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

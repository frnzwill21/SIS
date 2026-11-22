"""Buat 13 akun sampel sesuai ref/06: 3 admin, 1 bk, 1 kepala_sekolah, dan 8 teacher dengan kata sandi awal acak.

Kata sandi ditulis SEKALI ke seed_output/seed_credentials.txt (diabaikan Git) dan wajib diganti saat login pertama.
10 guru penerima akun SEMENTARA = wali kelas 10 kelas pertama (berdasarkan kode kelas), sampai pemilik proyek
mengonfirmasi daftar guru. Ganti dengan: python -m scripts.seed_users --nips-file daftar_nip.txt (satu NIP per baris).
"""
import argparse
import secrets
import sys
from datetime import datetime

import bcrypt

from .common import SEED_OUTPUT_DIR, connect

ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # tanpa karakter yang mirip
N_ADMIN, N_TEACHER = 3, 10


def new_password(length: int = 12) -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(length))


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def teacher_nips(cur, nips_file: str | None) -> list[str]:
    if nips_file:
        with open(nips_file, encoding="utf-8") as fh:
            nips = [line.strip() for line in fh if line.strip()]
    else:
        cur.execute("SELECT wali_kelas_nip FROM kelas ORDER BY kode LIMIT %s", (N_TEACHER,))
        nips = [r[0] for r in cur.fetchall()]
    if len(nips) != N_TEACHER:
        raise SystemExit(f"Butuh tepat {N_TEACHER} NIP guru, ditemukan {len(nips)}.")
    return nips


def seed(conn, nips_file: str | None = None) -> list[tuple[str, str, str]]:
    """Kembalikan daftar (username, role, kata_sandi) untuk akun yang BARU dibuat."""
    created = []
    with conn.cursor() as cur:
        plan = [(f"admin{i}", f"Admin {i}", None, "admin") for i in range(1, N_ADMIN + 1)]
        for i, nip in enumerate(teacher_nips(cur, nips_file), 1):
            cur.execute("SELECT nama FROM guru WHERE nip = %s", (nip,))
            row = cur.fetchone()
            if not row:
                raise SystemExit(f"NIP {nip} tidak ada di tabel guru.")
            role = "bk" if i == 1 else ("kepala_sekolah" if i == 2 else "teacher")
            plan.append((f"guru{i:02d}", row[0], nip, role))
        for username, nama, nip, role in plan:
            cur.execute("SELECT 1 FROM users WHERE username = %s", (username,))
            if cur.fetchone():
                continue
            password = new_password()
            cur.execute(
                "INSERT INTO users (username, nama, nip, role, password_hash) VALUES (%s, %s, %s, %s, %s)",
                (username, nama, nip, role, hash_password(password)),
            )
            created.append((username, role, password))
    conn.commit()
    return created


def write_credentials(created: list[tuple[str, str, str]]) -> None:
    if not created:
        return
    SEED_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    path = SEED_OUTPUT_DIR / "seed_credentials.txt"
    with path.open("a", encoding="utf-8") as fh:
        fh.write(f"# {datetime.now():%Y-%m-%d %H:%M} - wajib ganti kata sandi saat login pertama\n")
        for username, role, password in created:
            fh.write(f"{username}\t{role}\t{password}\n")
    print(f"{len(created)} akun dibuat. Kata sandi awal: {path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--nips-file", help="berkas berisi 10 NIP guru penerima akun teacher")
    args = parser.parse_args()
    conn = connect()
    created = seed(conn, args.nips_file)
    if created:
        write_credentials(created)
    else:
        print("Semua akun sudah ada; tidak ada yang dibuat.")


if __name__ == "__main__":
    sys.exit(main())

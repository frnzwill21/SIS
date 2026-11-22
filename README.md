# Panduan Menjalankan SIS (SMKN 4 Bandung, Kelas XII)

## A. Jalur Docker (satu perintah, disarankan untuk kamu)

Prasyarat: Docker Desktop menyala.

1. Salin env: `cp .env.example .env` (Windows: `copy .env.example .env`)
2. Edit `.env`: isi `POSTGRES_PASSWORD` dan `JWT_SECRET` (teks acak panjang). `GEMINI_API_KEY` boleh kosong.
3. Jalankan: `docker compose up --build`
4. Tunggu sampai log backend menulis proses impor selesai (kali pertama: skema, 21 tabel, akun).
5. Buka:
   - Aplikasi: http://localhost:3000
   - Dokumentasi API: http://localhost:8000/docs
   - Cek kesehatan: http://localhost:8000/api/v1/health
   - DBeaver: host `localhost`, port `5432`, database/user/password sesuai `.env`
6. Kata sandi akun: buka `backend/seed_output/seed_credentials.txt` (admin1..3, guru01..10). Login pertama diminta ganti kata sandi.

Berhenti: `Ctrl+C` lalu `docker compose down`. Reset total termasuk data: `docker compose down -v`.

## B. Jalur manual (untuk anggota tim, via cmd)

Prasyarat: Python 3.11+, Node 20+, dan PostgreSQL 16 (boleh dari Docker saja: `docker compose up db`).

Backend:
```
cd backend
python -m venv .venv
.venv\Scripts\activate          (Linux/Mac: source .venv/bin/activate)
pip install -r requirements.txt
```
Buat `.env` di root proyek (dari `.env.example`), aktifkan baris `DATABASE_URL=postgresql+psycopg://USER:PASS@localhost:5432/sis`, lalu:
```
python -m scripts.bootstrap     # skema + impor 21 CSV + buat akun (sekali saja)
uvicorn app.main:app --reload --port 8000
```
Frontend (terminal kedua):
```
cd frontend
npm install
npm run dev
```
Buka http://localhost:3000. Jika alamat backend berbeda, set `NEXT_PUBLIC_API_URL` (contoh `http://localhost:8000/api/v1`) sebelum `npm run dev`.

## C. Mengaktifkan Gemini (opsional)

Isi `GEMINI_API_KEY` di `.env`, restart backend. Tanpa kunci, chat tetap jalan dengan pembaca pertanyaan berbasis aturan. Cek di `/api/v1/health` (field `gemini`). NIS/NISN tidak pernah dikirim ke Gemini.

## D. Cek cepat setelah jalan

1. Login `admin1` berhasil, lalu ganti kata sandi.
2. Menu Kelas menampilkan 17 kelas; Siswa menampilkan 612 siswa total.
3. Tanya di chat: "Siapa wali kelas XII TITL 6?" (jawab Ina Suratma).
4. Tanya: "Siswa XII RPL 1 yang nilainya di bawah KKM", hasil berupa tabel.
5. Tanya soal pelanggaran siswa: muncul penanda data sensitif, dan baris baru di Admin > Audit log.
6. Tanya "kelas XI": ditolak karena di luar cakupan.

## E. Masalah umum

- `JWT_SECRET`/`POSTGRES_PASSWORD` error saat compose: belum diisi di `.env`.
- Port 5432/8000/3000 terpakai: matikan aplikasi lain atau ubah mapping port di `docker-compose.yml`.
- Frontend "Tidak bisa menghubungi server": backend belum siap, atau `NEXT_PUBLIC_API_URL` salah. Nilai itu ditanam saat build, jadi ubah lalu `docker compose up --build frontend`.
- Login ditolak (CORS): pastikan `CORS_ORIGINS` memuat alamat frontend persis (`http://localhost:3000`).
- Data tidak masuk: `docker compose down -v` lalu naikkan lagi untuk impor ulang dari nol.
- Lupa kata sandi: admin lain bisa reset di menu Admin > Akun.

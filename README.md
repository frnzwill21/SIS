# School Intelligence System (SIS) - SMKN 4 Bandung

Sistem kecerdasan institusi dan ruang kerja analitik berbasis AI untuk SMKN 4 Bandung, menggabungkan **Hybrid Query Engine (Gemini 3.5 Flash Lite + RAG)**, **PostgreSQL 16**, dan **Next.js**.

---

## Cara Menjalankan (Docker Compose)

Seluruh layanan (**PostgreSQL 16**, **FastAPI Backend**, dan **Next.js Frontend**) dijalankan melalui Docker Compose agar konsisten di semua komputer tanpa perlu instalasi Python, Node.js, PostgreSQL, maupun WSL secara manual.

### 1. Prasyarat
- [Git](https://git-scm.com/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (pastikan aplikasi Docker Desktop dalam status *Engine running*)

### 2. Instalasi Pertama Kali
- **Di Windows (1 klik):** klik dua kali [setup.bat](setup.bat) — otomatis membuat `.env` dengan kredensial acak kuat lalu menjalankan `docker compose up --build -d`.
- **Lewat terminal (Windows / macOS / Linux):**
  ```bash
  cp .env.example .env
  # Isi POSTGRES_PASSWORD dan JWT_SECRET pada .env, lalu:
  docker compose up --build -d
  ```

### 3. Menjalankan Sehari-hari
- **Di Windows:** klik dua kali [run.bat](run.bat)
- **Lewat terminal:** `docker compose up -d`

### 4. Alamat Layanan
- **Aplikasi Frontend**: [http://localhost:3000](http://localhost:3000)
- **Dokumentasi Interaktif API**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **Pemeriksaan Kesehatan Sistem**: [http://localhost:8000/api/v1/health](http://localhost:8000/api/v1/health)
- **PostgreSQL (DBeaver)**: `localhost:5432`

*Perintah berguna:*
- Melihat log live: `docker compose logs -f`
- Menghentikan layanan: `docker compose down`
- Reset database dari nol: `docker compose down -v`

---

## Akun Pengguna

Sistem menyediakan 13 akun bawaan (3 akun Administrator dan 10 akun Guru).

Demi keamanan dan privasi, rincian kredensial akun awal **tidak dicantumkan di repositori publik**. Kredensial awal hanya dihasilkan secara lokal pada saat instalasi pertama dan disimpan di direktori lokal:
```text
backend/seed_output/seed_credentials.txt
```
*(Direktori ini otomatis diabaikan oleh Git melalui `.gitignore`).*

Setiap pengguna diwajibkan memperbarui kata sandi pada saat pertama kali masuk ke sistem.


---

## Tumpukan Teknologi & Arsitektur

- **Frontend**: Next.js 14, React 18, TypeScript, Tailwind CSS, Lucide Icons.
- **Backend**: FastAPI, Uvicorn, SQLAlchemy 2, Psycopg 3, Pydantic 2, PyJWT.
- **AI Engine**: Hybrid Query Engine ditenagai oleh Google Gemini (`gemini-3.5-flash-lite`) dan RAG Leksikal BM25/IDF atas dokumen profil sekolah.
- **Database**: PostgreSQL 16 (21 tabel data akademik, 3 tabel sistem & audit).

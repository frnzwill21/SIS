-- Tabel sistem (bukan bagian dataset): akun, audit, riwayat impor. PostgreSQL.

CREATE TABLE users (
    id                    SERIAL PRIMARY KEY,
    username              VARCHAR(50) NOT NULL UNIQUE,
    nama                  TEXT NOT NULL,
    nip                   VARCHAR(30) REFERENCES guru (nip),
    role                  VARCHAR(10) NOT NULL CHECK (role IN ('admin', 'teacher')),
    password_hash         TEXT NOT NULL,
    wajib_ganti_password  BOOLEAN NOT NULL DEFAULT TRUE,
    aktif                 BOOLEAN NOT NULL DEFAULT TRUE,
    token_version         INTEGER NOT NULL DEFAULT 1,
    token_exempt_jti      VARCHAR(64),
    dibuat_pada           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_users_username_lower ON users (LOWER(username));

CREATE TABLE audit_log (
    id             BIGSERIAL PRIMARY KEY,
    user_id        INTEGER REFERENCES users (id),
    waktu          TIMESTAMPTZ NOT NULL DEFAULT now(),
    aksi           VARCHAR(50) NOT NULL,
    pertanyaan     TEXT,
    intent_json    JSONB,
    tabel_diakses  TEXT,
    status         VARCHAR(20) NOT NULL DEFAULT 'ok'
);
CREATE INDEX idx_audit_waktu ON audit_log (waktu DESC);

CREATE TABLE import_batch (
    id               SERIAL PRIMARY KEY,
    waktu            TIMESTAMPTZ NOT NULL DEFAULT now(),
    dijalankan_oleh  TEXT NOT NULL,
    nama_file        TEXT NOT NULL,
    jumlah_baris     INTEGER NOT NULL,
    status           VARCHAR(20) NOT NULL
);

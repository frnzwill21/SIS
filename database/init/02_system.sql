-- Tabel sistem (bukan bagian dataset): akun, audit, riwayat impor. PostgreSQL.

CREATE TABLE users (
    id                    SERIAL PRIMARY KEY,
    username              VARCHAR(50) NOT NULL UNIQUE,
    nama                  TEXT NOT NULL,
    nip                   VARCHAR(30) REFERENCES guru (nip),
    role                  VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'kepala_sekolah', 'bk', 'teacher')),
    password_hash         TEXT NOT NULL,
    wajib_ganti_password  BOOLEAN NOT NULL DEFAULT TRUE,
    aktif                 BOOLEAN NOT NULL DEFAULT TRUE,
    token_version         INTEGER NOT NULL DEFAULT 1,
    token_exempt_jti      VARCHAR(64),
    foto_profil           TEXT,
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

-- ---------------------------------------------------------------- Riwayat percakapan (chat_sessions & chat_messages)
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

-- ---------------------------------------------------------------- Knowledge Graph & persetujuan penghapusan dokumen
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

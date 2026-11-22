-- SIS SMKN 4 Bandung - skema data sekolah kelas XII (21 tabel).
-- Nama tabel dan kolom sama persis dengan CSV di database/dataset_bersih.
-- Kompatibel PostgreSQL 16 (dipakai di Docker dan manual).

CREATE TABLE jurusan (
    kode              VARCHAR(10) PRIMARY KEY,
    nama_konsentrasi  TEXT NOT NULL,
    program_keahlian  TEXT NOT NULL
);

CREATE TABLE guru (
    nip   VARCHAR(30) PRIMARY KEY,
    nama  TEXT NOT NULL
);

CREATE TABLE mapel_jadwal (
    kode  VARCHAR(20) PRIMARY KEY,
    nama  TEXT NOT NULL
);

CREATE TABLE mapel_rapor (
    kode           VARCHAR(20) PRIMARY KEY,
    nama           TEXT NOT NULL,
    kelompok       VARCHAR(20) NOT NULL CHECK (kelompok IN ('umum', 'kejuruan')),
    berlaku_untuk  VARCHAR(10) NOT NULL
);

CREATE TABLE periode_akademik (
    semester      SMALLINT PRIMARY KEY CHECK (semester BETWEEN 1 AND 6),
    tahun_ajaran  VARCHAR(9) NOT NULL,
    tipe          VARCHAR(10) NOT NULL CHECK (tipe IN ('Ganjil', 'Genap')),
    kkm           SMALLINT NOT NULL CHECK (kkm BETWEEN 0 AND 100),
    hari_efektif  SMALLINT NOT NULL CHECK (hari_efektif > 0),
    status        VARCHAR(20) NOT NULL
);

CREATE TABLE jenis_pelanggaran (
    kode               VARCHAR(10) PRIMARY KEY,
    nama               TEXT NOT NULL,
    tingkat            VARCHAR(20) NOT NULL,
    poin               SMALLINT NOT NULL CHECK (poin >= 0),
    sanksi_disarankan  TEXT NOT NULL
);

CREATE TABLE predikat_ekskul (
    predikat    VARCHAR(2) PRIMARY KEY,
    nilai_min   SMALLINT NOT NULL,
    nilai_maks  SMALLINT NOT NULL,
    keterangan  TEXT NOT NULL,
    deskripsi   TEXT NOT NULL
);

CREATE TABLE sesi_pkl (
    sesi             SMALLINT PRIMARY KEY,
    tahun_ajaran     VARCHAR(9) NOT NULL,
    tanggal_mulai    DATE NOT NULL,
    tanggal_selesai  DATE NOT NULL,
    aturan           TEXT NOT NULL
);

CREATE TABLE kelas (
    kode            VARCHAR(20) PRIMARY KEY,
    nama            VARCHAR(20) NOT NULL UNIQUE,
    jurusan_kode    VARCHAR(10) NOT NULL REFERENCES jurusan (kode),
    tingkat         SMALLINT NOT NULL CHECK (tingkat IN (10, 11, 12)),
    tahun_ajaran    VARCHAR(9) NOT NULL,
    wali_kelas_nip  VARCHAR(30) NOT NULL REFERENCES guru (nip)
);

CREATE TABLE guru_mapel (
    nip                VARCHAR(30) NOT NULL REFERENCES guru (nip),
    kode_mapel_jadwal  VARCHAR(20) NOT NULL REFERENCES mapel_jadwal (kode),
    PRIMARY KEY (nip, kode_mapel_jadwal)
);

-- kode_rapor boleh berisi templat {JURUSAN}-KK1 (tanpa FK)
CREATE TABLE pemetaan_mapel (
    kode_jadwal  VARCHAR(20) PRIMARY KEY REFERENCES mapel_jadwal (kode),
    kode_rapor   VARCHAR(30) NOT NULL,
    jenis        VARCHAR(20) NOT NULL,
    catatan      TEXT NOT NULL
);

CREATE TABLE siswa (
    nis            VARCHAR(20) PRIMARY KEY,
    nisn           VARCHAR(20) NOT NULL UNIQUE,
    nama           TEXT NOT NULL,
    jenis_kelamin  CHAR(1) NOT NULL CHECK (jenis_kelamin IN ('L', 'P')),
    no_absen       SMALLINT NOT NULL CHECK (no_absen > 0),
    kelas_kode     VARCHAR(20) NOT NULL REFERENCES kelas (kode),
    status         VARCHAR(20) NOT NULL,
    sumber_data    VARCHAR(20) NOT NULL,
    UNIQUE (kelas_kode, no_absen)
);
CREATE INDEX idx_siswa_kelas ON siswa (kelas_kode);

CREATE TABLE ekstrakurikuler (
    kode       VARCHAR(10) PRIMARY KEY,
    nama       TEXT NOT NULL,
    deskripsi  TEXT NOT NULL,
    hari       VARCHAR(30) NOT NULL,
    waktu      VARCHAR(50) NOT NULL,
    ketua_nis  VARCHAR(20) NOT NULL REFERENCES siswa (nis)
);

CREATE TABLE pembina_ekskul (
    kode_ekskul  VARCHAR(10) NOT NULL REFERENCES ekstrakurikuler (kode),
    urutan       SMALLINT NOT NULL,
    nama         TEXT NOT NULL,
    biodata      TEXT NOT NULL,
    PRIMARY KEY (kode_ekskul, urutan)
);

CREATE TABLE perusahaan_pkl (
    kode            VARCHAR(10) PRIMARY KEY,
    nama            TEXT NOT NULL,
    jurusan_kode    VARCHAR(10) NOT NULL REFERENCES jurusan (kode),
    bidang_usaha    TEXT NOT NULL,
    alamat          TEXT NOT NULL,
    kota            TEXT NOT NULL,
    kuota_sesi1     SMALLINT NOT NULL CHECK (kuota_sesi1 >= 0),
    kuota_sesi2     SMALLINT NOT NULL CHECK (kuota_sesi2 >= 0),
    posisi_tersedia TEXT NOT NULL,
    narahubung      TEXT NOT NULL,
    telepon         VARCHAR(40) NOT NULL,
    sumber_data     VARCHAR(20) NOT NULL
);

CREATE TABLE nilai (
    nis        VARCHAR(20) NOT NULL REFERENCES siswa (nis),
    semester   SMALLINT NOT NULL REFERENCES periode_akademik (semester),
    kode_mapel VARCHAR(20) NOT NULL REFERENCES mapel_rapor (kode),
    nilai      SMALLINT NOT NULL CHECK (nilai BETWEEN 0 AND 100),
    PRIMARY KEY (nis, semester, kode_mapel)
);
CREATE INDEX idx_nilai_nis_sem ON nilai (nis, semester);

CREATE TABLE kehadiran (
    nis       VARCHAR(20) NOT NULL REFERENCES siswa (nis),
    semester  SMALLINT NOT NULL REFERENCES periode_akademik (semester),
    sakit     SMALLINT NOT NULL CHECK (sakit >= 0),
    izin      SMALLINT NOT NULL CHECK (izin >= 0),
    alpha     SMALLINT NOT NULL CHECK (alpha >= 0),
    hadir     SMALLINT NOT NULL CHECK (hadir >= 0),
    PRIMARY KEY (nis, semester)
);

CREATE TABLE pelanggaran (
    id                INTEGER PRIMARY KEY,
    nis               VARCHAR(20) NOT NULL REFERENCES siswa (nis),
    kode_pelanggaran  VARCHAR(10) NOT NULL REFERENCES jenis_pelanggaran (kode),
    tanggal_kejadian  DATE NOT NULL,
    catatan           TEXT
);
CREATE INDEX idx_pelanggaran_nis ON pelanggaran (nis);
CREATE INDEX idx_pelanggaran_tanggal ON pelanggaran (tanggal_kejadian);

CREATE TABLE partisipasi_ekskul (
    nis          VARCHAR(20) NOT NULL REFERENCES siswa (nis),
    semester     SMALLINT NOT NULL REFERENCES periode_akademik (semester),
    kode_ekskul  VARCHAR(10) NOT NULL REFERENCES ekstrakurikuler (kode),
    nilai        SMALLINT NOT NULL CHECK (nilai BETWEEN 0 AND 100),
    predikat     VARCHAR(2) NOT NULL REFERENCES predikat_ekskul (predikat),
    PRIMARY KEY (nis, semester, kode_ekskul)
);

CREATE TABLE jadwal_pelajaran (
    id           VARCHAR(10) PRIMARY KEY,
    kelas_kode   VARCHAR(20) NOT NULL REFERENCES kelas (kode),
    hari         VARCHAR(10) NOT NULL CHECK (hari IN ('Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat')),
    jam_mulai    SMALLINT NOT NULL CHECK (jam_mulai >= 1),
    jam_selesai  SMALLINT NOT NULL,
    kode_mapel   VARCHAR(20) NOT NULL REFERENCES mapel_jadwal (kode),
    nip_guru     VARCHAR(30) NOT NULL REFERENCES guru (nip),
    ruangan      VARCHAR(20) NOT NULL,
    sumber_data  VARCHAR(20) NOT NULL,
    CHECK (jam_selesai >= jam_mulai)
);
CREATE INDEX idx_jadwal_kelas ON jadwal_pelajaran (kelas_kode, hari);
CREATE INDEX idx_jadwal_guru ON jadwal_pelajaran (nip_guru, hari);

CREATE TABLE penempatan_pkl (
    nis                     VARCHAR(20) PRIMARY KEY REFERENCES siswa (nis),
    kode_perusahaan         VARCHAR(10) NOT NULL REFERENCES perusahaan_pkl (kode),
    posisi                  TEXT NOT NULL,
    sesi                    SMALLINT NOT NULL REFERENCES sesi_pkl (sesi),
    pembimbing_perusahaan   TEXT NOT NULL,
    pembimbing_sekolah_nip  VARCHAR(30) NOT NULL REFERENCES guru (nip),
    status                  VARCHAR(30) NOT NULL,
    sumber_data             VARCHAR(20) NOT NULL
);

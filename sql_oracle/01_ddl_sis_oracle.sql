-- 1. Tabel Master Jurusan
CREATE TABLE jurusan (
    kode              VARCHAR2(10)  NOT NULL,
    nama_konsentrasi  VARCHAR2(100) NOT NULL,
    program_keahlian  VARCHAR2(100) NOT NULL,
    CONSTRAINT pk_jurusan PRIMARY KEY (kode)
);

-- 2. Tabel Master Guru
CREATE TABLE guru (
    nip               VARCHAR2(30)  NOT NULL,
    nama              VARCHAR2(120) NOT NULL,
    CONSTRAINT pk_guru PRIMARY KEY (nip)
);

-- 3. Tabel Master Kelas
CREATE TABLE kelas (
    kode              VARCHAR2(20)  NOT NULL,
    nama              VARCHAR2(20)  NOT NULL,
    jurusan_kode      VARCHAR2(10)  NOT NULL,
    tingkat           NUMBER(2)     NOT NULL,
    tahun_ajaran      VARCHAR2(9)   NOT NULL,
    wali_kelas_nip    VARCHAR2(30)  NOT NULL,
    CONSTRAINT pk_kelas PRIMARY KEY (kode),
    CONSTRAINT uq_kelas_nama UNIQUE (nama),
    CONSTRAINT ck_kelas_tingkat CHECK (tingkat IN (10, 11, 12)),
    CONSTRAINT fk_kelas_jurusan FOREIGN KEY (jurusan_kode) REFERENCES jurusan (kode),
    CONSTRAINT fk_kelas_wali FOREIGN KEY (wali_kelas_nip) REFERENCES guru (nip)
);

-- 4. Tabel Master Siswa
CREATE TABLE siswa (
    nis               VARCHAR2(20)  NOT NULL,
    nisn              VARCHAR2(20)  NOT NULL,
    nama              VARCHAR2(120) NOT NULL,
    jenis_kelamin     CHAR(1)       NOT NULL,
    no_absen          NUMBER(3)     NOT NULL,
    kelas_kode        VARCHAR2(20)  NOT NULL,
    status            VARCHAR2(20)  NOT NULL,
    sumber_data       VARCHAR2(20)  NOT NULL,
    CONSTRAINT pk_siswa PRIMARY KEY (nis),
    CONSTRAINT uq_siswa_nisn UNIQUE (nisn),
    CONSTRAINT uq_siswa_kelas_absen UNIQUE (kelas_kode, no_absen),
    CONSTRAINT ck_siswa_jk CHECK (jenis_kelamin IN ('L', 'P')),
    CONSTRAINT ck_siswa_absen CHECK (no_absen > 0),
    CONSTRAINT fk_siswa_kelas FOREIGN KEY (kelas_kode) REFERENCES kelas (kode)
);

CREATE INDEX idx_siswa_kelas ON siswa (kelas_kode);

-- 5. Tabel Master Periode Akademik
CREATE TABLE periode_akademik (
    semester          NUMBER(1)     NOT NULL,
    tahun_ajaran      VARCHAR2(9)   NOT NULL,
    tipe              VARCHAR2(10)  NOT NULL,
    kkm               NUMBER(3)     NOT NULL,
    hari_efektif      NUMBER(3)     NOT NULL,
    status            VARCHAR2(20)  NOT NULL,
    CONSTRAINT pk_periode_akademik PRIMARY KEY (semester),
    CONSTRAINT ck_periode_semester CHECK (semester BETWEEN 1 AND 6),
    CONSTRAINT ck_periode_tipe CHECK (tipe IN ('Ganjil', 'Genap')),
    CONSTRAINT ck_periode_kkm CHECK (kkm BETWEEN 0 AND 100),
    CONSTRAINT ck_periode_hari CHECK (hari_efektif > 0)
);

-- 6. Tabel Master Mata Pelajaran Rapor
CREATE TABLE mapel_rapor (
    kode              VARCHAR2(20)  NOT NULL,
    nama              VARCHAR2(120) NOT NULL,
    kelompok          VARCHAR2(20)  NOT NULL,
    berlaku_untuk     VARCHAR2(10)  NOT NULL,
    CONSTRAINT pk_mapel_rapor PRIMARY KEY (kode),
    CONSTRAINT ck_mapel_kelompok CHECK (kelompok IN ('umum', 'kejuruan'))
);

-- 7. Tabel Transaksional Nilai Rapor Siswa
CREATE TABLE nilai (
    nis               VARCHAR2(20)  NOT NULL,
    semester          NUMBER(1)     NOT NULL,
    kode_mapel        VARCHAR2(20)  NOT NULL,
    nilai             NUMBER(3)     NOT NULL,
    CONSTRAINT pk_nilai PRIMARY KEY (nis, semester, kode_mapel),
    CONSTRAINT ck_nilai_rentang CHECK (nilai BETWEEN 0 AND 100),
    CONSTRAINT fk_nilai_siswa FOREIGN KEY (nis) REFERENCES siswa (nis),
    CONSTRAINT fk_nilai_periode FOREIGN KEY (semester) REFERENCES periode_akademik (semester),
    CONSTRAINT fk_nilai_mapel FOREIGN KEY (kode_mapel) REFERENCES mapel_rapor (kode)
);

CREATE INDEX idx_nilai_nis_sem ON nilai (nis, semester);

-- 8. Tabel Referensi Jenis Pelanggaran
CREATE TABLE jenis_pelanggaran (
    kode              VARCHAR2(10)  NOT NULL,
    nama              VARCHAR2(200) NOT NULL,
    tingkat           VARCHAR2(20)  NOT NULL,
    poin              NUMBER(3)     NOT NULL,
    sanksi_disarankan VARCHAR2(250) NOT NULL,
    CONSTRAINT pk_jenis_pelanggaran PRIMARY KEY (kode),
    CONSTRAINT ck_jp_tingkat CHECK (tingkat IN ('Ringan', 'Sedang', 'Berat')),
    CONSTRAINT ck_jp_poin CHECK (poin >= 0)
);

-- 9. Tabel Transaksional Pelanggaran Siswa (Event Log Atomik 3NF)
CREATE TABLE pelanggaran (
    id                NUMBER(10)    NOT NULL,
    nis               VARCHAR2(20)  NOT NULL,
    kode_pelanggaran  VARCHAR2(10)  NOT NULL,
    tanggal_kejadian  DATE          NOT NULL,
    catatan           VARCHAR2(250),
    CONSTRAINT pk_pelanggaran PRIMARY KEY (id),
    CONSTRAINT fk_pel_siswa FOREIGN KEY (nis) REFERENCES siswa (nis),
    CONSTRAINT fk_pel_jenis FOREIGN KEY (kode_pelanggaran) REFERENCES jenis_pelanggaran (kode)
);

CREATE INDEX idx_pelanggaran_nis ON pelanggaran (nis);
CREATE INDEX idx_pelanggaran_tanggal ON pelanggaran (tanggal_kejadian);

-- Sequence untuk ID Pelanggaran baru (seed data menggunakan ID < 1000)
CREATE SEQUENCE seq_pelanggaran
    START WITH 1000
    INCREMENT BY 1
    NOCACHE
    NOCYCLE;

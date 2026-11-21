-- =============================================================================
-- SIS SMKN 4 Bandung — Stored Functions & Stored Procedures (Oracle PL/SQL 3NF)
-- Pair 1 (Transaksional BK/Kesiswaan):
--   - SF_HITUNG_POIN_PELANGGARAN
--   - SP_CATAT_PELANGGARAN
-- Pair 2 (Analitik Akademik & Kedisiplinan):
--   - SF_STATUS_KKM
--   - SP_REKAP_AKADEMIK_KELAS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Stored Function 1: SF_HITUNG_POIN_PELANGGARAN
-- Menghitung total akumulasi poin pelanggaran seorang siswa secara dinamis dari
-- tabel PELANGGARAN JOIN JENIS_PELANGGARAN (desain ternormalisasi 3NF).
-- Mengembalikan -1 jika NIS tidak valid/tidak ditemukan.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sf_hitung_poin_pelanggaran (
    p_nis IN VARCHAR2
) RETURN NUMBER IS
    v_exists     NUMBER := 0;
    v_total_poin NUMBER := 0;
BEGIN
    IF TRIM(p_nis) IS NULL THEN
        RETURN -1;
    END IF;

    SELECT COUNT(*)
      INTO v_exists
      FROM siswa
     WHERE nis = TRIM(p_nis);

    IF v_exists = 0 THEN
        RETURN -1;
    END IF;

    SELECT NVL(SUM(jp.poin), 0)
      INTO v_total_poin
      FROM pelanggaran pl
      JOIN jenis_pelanggaran jp ON jp.kode = pl.kode_pelanggaran
     WHERE pl.nis = TRIM(p_nis);

    RETURN v_total_poin;
END sf_hitung_poin_pelanggaran;
/

-- -----------------------------------------------------------------------------
-- 2. Stored Procedure 1: SP_CATAT_PELANGGARAN
-- Mencatat satu kejadian pelanggaran siswa secara atomik (3NF), memvalidasi
-- NIS, kode pelanggaran, dan tanggal kejadian (tidak melebihi hari ini),
-- menyimpan catatan khusus (opsional, NULL bila memakai sanksi standar),
-- melakukan COMMIT, lalu menghitung total poin siswa melalui
-- SF_HITUNG_POIN_PELANGGARAN.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_catat_pelanggaran (
    p_nis              IN  VARCHAR2,
    p_kode_pelanggaran IN  VARCHAR2,
    p_tanggal_kejadian IN  DATE     DEFAULT TRUNC(SYSDATE),
    p_catatan          IN  VARCHAR2 DEFAULT NULL,
    p_id_pelanggaran   OUT NUMBER,
    p_poin_kejadian    OUT NUMBER,
    p_total_poin       OUT NUMBER,
    p_status_pesan     OUT VARCHAR2
) IS
    v_nama_siswa       siswa.nama%TYPE;
    v_nama_pelanggaran jenis_pelanggaran.nama%TYPE;
    v_poin_satuan      jenis_pelanggaran.poin%TYPE;
    v_tanggal_final    DATE;
    v_catatan_final    pelanggaran.catatan%TYPE;
BEGIN
    p_id_pelanggaran := 0;
    p_poin_kejadian  := 0;
    p_total_poin     := 0;

    -- Validasi input wajib
    IF TRIM(p_nis) IS NULL THEN
        p_status_pesan := 'GAGAL: NIS siswa wajib diisi.';
        RETURN;
    END IF;

    IF TRIM(p_kode_pelanggaran) IS NULL THEN
        p_status_pesan := 'GAGAL: Kode pelanggaran wajib diisi.';
        RETURN;
    END IF;

    v_tanggal_final := NVL(TRUNC(p_tanggal_kejadian), TRUNC(SYSDATE));
    IF v_tanggal_final > TRUNC(SYSDATE) THEN
        p_status_pesan := 'GAGAL: Tanggal kejadian tidak boleh melebihi hari ini.';
        RETURN;
    END IF;

    -- Validasi keberadaan siswa
    BEGIN
        SELECT nama
          INTO v_nama_siswa
          FROM siswa
         WHERE nis = TRIM(p_nis);
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            p_status_pesan := 'GAGAL: Siswa dengan NIS "' || TRIM(p_nis) || '" tidak ditemukan.';
            RETURN;
    END;

    -- Validasi keberadaan jenis pelanggaran & ambil bobot poin
    BEGIN
        SELECT nama, poin
          INTO v_nama_pelanggaran, v_poin_satuan
          FROM jenis_pelanggaran
         WHERE kode = TRIM(p_kode_pelanggaran);
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            p_status_pesan := 'GAGAL: Kode pelanggaran "' || TRIM(p_kode_pelanggaran) || '" tidak ditemukan.';
            RETURN;
    END;

    -- Di Oracle, string kosong/spasi setelah TRIM otomatis bernilai NULL
    v_catatan_final := SUBSTR(TRIM(p_catatan), 1, 250);

    -- Ambil ID baru dari sequence dan simpan kejadian atomik ke PELANGGARAN
    SELECT seq_pelanggaran.NEXTVAL
      INTO p_id_pelanggaran
      FROM dual;

    INSERT INTO pelanggaran (
        id,
        nis,
        kode_pelanggaran,
        tanggal_kejadian,
        catatan
    ) VALUES (
        p_id_pelanggaran,
        TRIM(p_nis),
        TRIM(p_kode_pelanggaran),
        v_tanggal_final,
        v_catatan_final
    );

    COMMIT;

    p_poin_kejadian := v_poin_satuan;
    p_total_poin    := sf_hitung_poin_pelanggaran(TRIM(p_nis));
    IF p_total_poin < 0 THEN
        p_total_poin := p_poin_kejadian;
    END IF;

    p_status_pesan := 'SUKSES: Kejadian "' || v_nama_pelanggaran ||
                      '" untuk ' || v_nama_siswa ||
                      ' pada ' || TO_CHAR(v_tanggal_final, 'YYYY-MM-DD') ||
                      ' tersimpan (#' || p_id_pelanggaran ||
                      ', +' || p_poin_kejadian || ' poin, akumulasi ' ||
                      p_total_poin || ' poin).';
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_id_pelanggaran := 0;
        p_poin_kejadian  := 0;
        p_total_poin     := 0;
        p_status_pesan   := 'KESALAHAN SISTEM: ' || SQLERRM;
END sp_catat_pelanggaran;
/

-- -----------------------------------------------------------------------------
-- 3. Stored Function 2: SF_STATUS_KKM
-- Menentukan predikat ketuntasan nilai terhadap KKM pada PERIODE_AKADEMIK.
-- Mengembalikan 'TUNTAS' jika nilai >= KKM, selain itu 'BELUM TUNTAS'.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sf_status_kkm (
    p_nilai    IN NUMBER,
    p_semester IN NUMBER
) RETURN VARCHAR2 IS
    v_kkm NUMBER := 80;
BEGIN
    BEGIN
        SELECT kkm
          INTO v_kkm
          FROM periode_akademik
         WHERE semester = p_semester;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            v_kkm := 80;
    END;

    IF p_nilai >= v_kkm THEN
        RETURN 'TUNTAS';
    ELSE
        RETURN 'BELUM TUNTAS';
    END IF;
END sf_status_kkm;
/

-- -----------------------------------------------------------------------------
-- 4. Stored Procedure 2: SP_REKAP_AKADEMIK_KELAS
-- Menghitung rekapitulasi evaluasi akademik & kedisiplinan per kelas dan semester:
-- rata-rata nilai kelas, jumlah nilai belum tuntas (via SF_STATUS_KKM), serta
-- total akumulasi poin pelanggaran siswa (JOIN JENIS_PELANGGARAN).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_rekap_akademik_kelas (
    p_kelas_kode             IN  VARCHAR2,
    p_semester               IN  NUMBER,
    p_nama_kelas             OUT VARCHAR2,
    p_kkm                    OUT NUMBER,
    p_jumlah_siswa           OUT NUMBER,
    p_rata_rata_kelas        OUT NUMBER,
    p_jumlah_belum_tuntas    OUT NUMBER,
    p_total_poin_pelanggaran OUT NUMBER,
    p_status_pesan           OUT VARCHAR2
) IS
BEGIN
    p_nama_kelas             := '-';
    p_kkm                    := 0;
    p_jumlah_siswa           := 0;
    p_rata_rata_kelas        := 0;
    p_jumlah_belum_tuntas    := 0;
    p_total_poin_pelanggaran := 0;

    -- Validasi kelas
    BEGIN
        SELECT nama
          INTO p_nama_kelas
          FROM kelas
         WHERE kode = TRIM(p_kelas_kode);
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            p_status_pesan := 'GAGAL: Kode kelas "' || TRIM(p_kelas_kode) || '" tidak ditemukan.';
            RETURN;
    END;

    -- Validasi periode akademik & ambil nilai KKM
    BEGIN
        SELECT kkm
          INTO p_kkm
          FROM periode_akademik
         WHERE semester = p_semester;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            p_status_pesan := 'GAGAL: Periode akademik Semester ' || NVL(TO_CHAR(p_semester), 'NULL') || ' tidak ditemukan.';
            RETURN;
    END;

    -- Hitung jumlah siswa di kelas
    SELECT COUNT(*)
      INTO p_jumlah_siswa
      FROM siswa
     WHERE kelas_kode = TRIM(p_kelas_kode);

    -- Hitung rata-rata nilai kelas & jumlah nilai belum tuntas menggunakan SF_STATUS_KKM
    SELECT NVL(ROUND(AVG(n.nilai), 2), 0),
           NVL(SUM(CASE WHEN sf_status_kkm(n.nilai, n.semester) = 'BELUM TUNTAS' THEN 1 ELSE 0 END), 0)
      INTO p_rata_rata_kelas,
           p_jumlah_belum_tuntas
      FROM nilai n
      JOIN siswa s ON s.nis = n.nis
     WHERE s.kelas_kode = TRIM(p_kelas_kode)
       AND n.semester   = p_semester;

    -- Hitung total akumulasi poin pelanggaran siswa di kelas tersebut (3NF JOIN)
    SELECT NVL(SUM(jp.poin), 0)
      INTO p_total_poin_pelanggaran
      FROM pelanggaran pl
      JOIN jenis_pelanggaran jp ON jp.kode = pl.kode_pelanggaran
      JOIN siswa s ON s.nis = pl.nis
     WHERE s.kelas_kode = TRIM(p_kelas_kode);

    p_status_pesan := 'Rekapitulasi kelas ' || p_nama_kelas ||
                      ' Semester ' || p_semester ||
                      ' (KKM ' || p_kkm || '): ' ||
                      p_jumlah_siswa || ' siswa, rata-rata ' ||
                      TO_CHAR(p_rata_rata_kelas, 'FM990.00') || ', ' ||
                      p_jumlah_belum_tuntas || ' nilai belum tuntas, akumulasi ' ||
                      p_total_poin_pelanggaran || ' poin pelanggaran.';
EXCEPTION
    WHEN OTHERS THEN
        p_status_pesan := 'KESALAHAN SISTEM: ' || SQLERRM;
END sp_rekap_akademik_kelas;
/

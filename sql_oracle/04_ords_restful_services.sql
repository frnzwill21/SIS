-- =============================================================================
-- SIS SMKN 4 Bandung — Publikasi ORDS RESTful Services (Panduan Bab 3)
-- Module    : sis_kik_api
-- Base Path : /api/v1/
-- Base URL  : https://iacademy.oracle.com/ords/id_b885_plsql_s69/api/v1/
-- Catatan   : Tidak menyentuh module lama (kik, oracle.example.hr)
-- =============================================================================

BEGIN
    -- 1. Definisikan Module sis_kik_api
    ORDS.DEFINE_MODULE(
        p_module_name    => 'sis_kik_api',
        p_base_path      => '/api/v1/',
        p_items_per_page => 100,
        p_status         => 'PUBLISHED',
        p_comments       => 'RESTful API Integrasi Stored Procedure SIS SMKN 4 Bandung (Proyek KIK)'
    );

    -- -------------------------------------------------------------------------
    -- 2. Template: pelanggaran (GET Collection + POST SP_CATAT_PELANGGARAN)
    -- -------------------------------------------------------------------------
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'sis_kik_api',
        p_pattern     => 'pelanggaran',
        p_comments    => 'Endpoint daftar dan pencatatan pelanggaran siswa (3NF)'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'sis_kik_api',
        p_pattern        => 'pelanggaran',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_collection_feed,
        p_items_per_page => 100,
        p_source         => q'[
SELECT pl.id,
       pl.nis,
       s.nama AS nama_siswa,
       s.kelas_kode,
       k.nama AS nama_kelas,
       pl.kode_pelanggaran,
       jp.nama AS nama_pelanggaran,
       jp.tingkat,
       jp.poin,
       sf_hitung_poin_pelanggaran(pl.nis) AS total_poin_siswa,
       TO_CHAR(pl.tanggal_kejadian, 'YYYY-MM-DD') AS tanggal_kejadian,
       pl.catatan,
       NVL(pl.catatan, jp.sanksi_disarankan) AS tindak_lanjut
  FROM pelanggaran pl
  JOIN siswa s ON s.nis = pl.nis
  JOIN kelas k ON k.kode = s.kelas_kode
  JOIN jenis_pelanggaran jp ON jp.kode = pl.kode_pelanggaran
 ORDER BY pl.tanggal_kejadian DESC, pl.id DESC
]'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name   => 'sis_kik_api',
        p_pattern       => 'pelanggaran',
        p_method        => 'POST',
        p_source_type   => ORDS.source_type_plsql,
        p_mimes_allowed => 'application/json',
        p_source        => q'[
DECLARE
    v_tanggal   DATE := TRUNC(SYSDATE);
    v_tgl_str   VARCHAR2(30) := TRIM(:tanggal_kejadian);
    v_tgl_valid BOOLEAN := TRUE;
BEGIN
    IF v_tgl_str IS NOT NULL THEN
        BEGIN
            v_tanggal := TO_DATE(v_tgl_str, 'FXYYYY-MM-DD');
        EXCEPTION
            WHEN OTHERS THEN
                v_tgl_valid := FALSE;
        END;
    END IF;

    IF NOT v_tgl_valid THEN
        :id_pelanggaran := 0;
        :poin_kejadian  := 0;
        :total_poin     := 0;
        :status_pesan   := 'GAGAL: Format tanggal kejadian harus YYYY-MM-DD.';
    ELSE
        sp_catat_pelanggaran(
            p_nis              => :nis,
            p_kode_pelanggaran => :kode_pelanggaran,
            p_tanggal_kejadian => v_tanggal,
            p_catatan          => :catatan,
            p_id_pelanggaran   => :id_pelanggaran,
            p_poin_kejadian    => :poin_kejadian,
            p_total_poin       => :total_poin,
            p_status_pesan     => :status_pesan
        );
    END IF;
END;
]'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'sis_kik_api',
        p_pattern            => 'pelanggaran',
        p_method             => 'POST',
        p_name               => 'id_pelanggaran',
        p_bind_variable_name => 'id_pelanggaran',
        p_source_type        => 'RESPONSE',
        p_param_type         => 'INT',
        p_access_method      => 'OUT'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'sis_kik_api',
        p_pattern            => 'pelanggaran',
        p_method             => 'POST',
        p_name               => 'poin_kejadian',
        p_bind_variable_name => 'poin_kejadian',
        p_source_type        => 'RESPONSE',
        p_param_type         => 'INT',
        p_access_method      => 'OUT'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'sis_kik_api',
        p_pattern            => 'pelanggaran',
        p_method             => 'POST',
        p_name               => 'total_poin',
        p_bind_variable_name => 'total_poin',
        p_source_type        => 'RESPONSE',
        p_param_type         => 'INT',
        p_access_method      => 'OUT'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'sis_kik_api',
        p_pattern            => 'pelanggaran',
        p_method             => 'POST',
        p_name               => 'status_pesan',
        p_bind_variable_name => 'status_pesan',
        p_source_type        => 'RESPONSE',
        p_param_type         => 'STRING',
        p_access_method      => 'OUT'
    );

    -- -------------------------------------------------------------------------
    -- 3. Template: rekap-akademik (GET Detail KKM + POST SP_REKAP_AKADEMIK_KELAS)
    -- -------------------------------------------------------------------------
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'sis_kik_api',
        p_pattern     => 'rekap-akademik',
        p_comments    => 'Endpoint detail nilai KKM dan rekapitulasi akademik kelas'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'sis_kik_api',
        p_pattern        => 'rekap-akademik',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_collection_feed,
        p_items_per_page => 200,
        p_source         => q'[
SELECT n.nis,
       s.nama AS nama_siswa,
       s.no_absen,
       s.kelas_kode,
       k.nama AS nama_kelas,
       n.semester,
       pa.tahun_ajaran,
       pa.kkm,
       n.kode_mapel,
       m.nama AS nama_mapel,
       m.kelompok,
       n.nilai,
       sf_status_kkm(n.nilai, n.semester) AS status_kkm
  FROM nilai n
  JOIN siswa s ON s.nis = n.nis
  JOIN kelas k ON k.kode = s.kelas_kode
  JOIN mapel_rapor m ON m.kode = n.kode_mapel
  JOIN periode_akademik pa ON pa.semester = n.semester
 WHERE (:kelas IS NULL OR s.kelas_kode = :kelas)
   AND (:semester IS NULL OR n.semester = TO_NUMBER(:semester))
 ORDER BY s.kelas_kode, s.no_absen, m.kelompok, n.kode_mapel
]'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name   => 'sis_kik_api',
        p_pattern       => 'rekap-akademik',
        p_method        => 'POST',
        p_source_type   => ORDS.source_type_plsql,
        p_mimes_allowed => 'application/json',
        p_source        => q'[
BEGIN
    sp_rekap_akademik_kelas(
        p_kelas_kode             => :kelas_kode,
        p_semester               => TO_NUMBER(:semester),
        p_nama_kelas             => :nama_kelas,
        p_kkm                    => :kkm,
        p_jumlah_siswa           => :jumlah_siswa,
        p_rata_rata_kelas        => :rata_rata_kelas,
        p_jumlah_belum_tuntas    => :jumlah_belum_tuntas,
        p_total_poin_pelanggaran => :total_poin_pelanggaran,
        p_status_pesan           => :status_pesan
    );
END;
]'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'sis_kik_api',
        p_pattern            => 'rekap-akademik',
        p_method             => 'POST',
        p_name               => 'nama_kelas',
        p_bind_variable_name => 'nama_kelas',
        p_source_type        => 'RESPONSE',
        p_param_type         => 'STRING',
        p_access_method      => 'OUT'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'sis_kik_api',
        p_pattern            => 'rekap-akademik',
        p_method             => 'POST',
        p_name               => 'kkm',
        p_bind_variable_name => 'kkm',
        p_source_type        => 'RESPONSE',
        p_param_type         => 'INT',
        p_access_method      => 'OUT'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'sis_kik_api',
        p_pattern            => 'rekap-akademik',
        p_method             => 'POST',
        p_name               => 'jumlah_siswa',
        p_bind_variable_name => 'jumlah_siswa',
        p_source_type        => 'RESPONSE',
        p_param_type         => 'INT',
        p_access_method      => 'OUT'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'sis_kik_api',
        p_pattern            => 'rekap-akademik',
        p_method             => 'POST',
        p_name               => 'rata_rata_kelas',
        p_bind_variable_name => 'rata_rata_kelas',
        p_source_type        => 'RESPONSE',
        p_param_type         => 'DOUBLE',
        p_access_method      => 'OUT'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'sis_kik_api',
        p_pattern            => 'rekap-akademik',
        p_method             => 'POST',
        p_name               => 'jumlah_belum_tuntas',
        p_bind_variable_name => 'jumlah_belum_tuntas',
        p_source_type        => 'RESPONSE',
        p_param_type         => 'INT',
        p_access_method      => 'OUT'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'sis_kik_api',
        p_pattern            => 'rekap-akademik',
        p_method             => 'POST',
        p_name               => 'total_poin_pelanggaran',
        p_bind_variable_name => 'total_poin_pelanggaran',
        p_source_type        => 'RESPONSE',
        p_param_type         => 'INT',
        p_access_method      => 'OUT'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'sis_kik_api',
        p_pattern            => 'rekap-akademik',
        p_method             => 'POST',
        p_name               => 'status_pesan',
        p_bind_variable_name => 'status_pesan',
        p_source_type        => 'RESPONSE',
        p_param_type         => 'STRING',
        p_access_method      => 'OUT'
    );

    -- -------------------------------------------------------------------------
    -- 4. Master Lookup Endpoints (untuk dropdown formulir web)
    -- -------------------------------------------------------------------------
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'sis_kik_api',
        p_pattern     => 'master/siswa',
        p_comments    => 'Daftar siswa SIS terdaftar di Oracle APEX'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'sis_kik_api',
        p_pattern        => 'master/siswa',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_collection_feed,
        p_items_per_page => 100,
        p_source         => q'[
SELECT s.nis,
       s.nisn,
       s.nama,
       s.jenis_kelamin,
       s.no_absen,
       s.kelas_kode,
       k.nama AS nama_kelas,
       s.status
  FROM siswa s
  JOIN kelas k ON k.kode = s.kelas_kode
 ORDER BY s.kelas_kode, s.no_absen
]'
    );

    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'sis_kik_api',
        p_pattern     => 'master/jenis-pelanggaran',
        p_comments    => 'Katalog jenis pelanggaran tata tertib SMKN 4 Bandung'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'sis_kik_api',
        p_pattern        => 'master/jenis-pelanggaran',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_collection_feed,
        p_items_per_page => 100,
        p_source         => q'[
SELECT kode,
       nama,
       tingkat,
       poin,
       sanksi_disarankan
  FROM jenis_pelanggaran
 ORDER BY CASE tingkat WHEN 'Ringan' THEN 1 WHEN 'Sedang' THEN 2 ELSE 3 END, kode
]'
    );

    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'sis_kik_api',
        p_pattern     => 'master/kelas',
        p_comments    => 'Daftar kelas XII beserta jumlah siswa terdaftar'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'sis_kik_api',
        p_pattern        => 'master/kelas',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_collection_feed,
        p_items_per_page => 100,
        p_source         => q'[
SELECT k.kode,
       k.nama,
       k.jurusan_kode,
       j.nama_konsentrasi,
       k.tingkat,
       k.tahun_ajaran,
       k.wali_kelas_nip,
       g.nama AS nama_wali_kelas,
       (SELECT COUNT(*) FROM siswa s WHERE s.kelas_kode = k.kode) AS jumlah_siswa
  FROM kelas k
  JOIN jurusan j ON j.kode = k.jurusan_kode
  JOIN guru g ON g.nip = k.wali_kelas_nip
 ORDER BY jumlah_siswa DESC, k.kode
]'
    );

    COMMIT;
END;
/

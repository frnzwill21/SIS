-- =============================================================================
-- SIS SMKN 4 Bandung — Reset Objek SIS Sebelum Instalasi Ulang (Skema 3NF)
-- Workspace : id_b885_plsql_s69 (https://iacademy.oracle.com)
-- Catatan   : Hanya menghapus module REST 'sis_kik_api', SP/SF SIS, dan 9 tabel
--             SIS. Tidak menyentuh EMP, DEPT, maupun module 'kik'.
-- =============================================================================

DECLARE
    PROCEDURE safe_exec(p_sql IN VARCHAR2) IS
    BEGIN
        EXECUTE IMMEDIATE p_sql;
    EXCEPTION
        WHEN OTHERS THEN
            -- Abaikan jika objek memang belum ada (ORA-00942, ORA-02289, ORA-04043)
            IF SQLCODE NOT IN (-942, -2289, -4043) THEN
                RAISE;
            END IF;
    END;
BEGIN
    BEGIN
        ORDS.DELETE_MODULE(p_module_name => 'sis_kik_api');
        COMMIT;
    EXCEPTION
        WHEN OTHERS THEN
            NULL;
    END;

    safe_exec('DROP PROCEDURE sp_catat_pelanggaran');
    safe_exec('DROP PROCEDURE sp_rekap_akademik_kelas');
    safe_exec('DROP FUNCTION sf_hitung_poin_pelanggaran');
    safe_exec('DROP FUNCTION sf_status_kkm');
    safe_exec('DROP SEQUENCE seq_pelanggaran');

    safe_exec('DROP TABLE pelanggaran CASCADE CONSTRAINTS');
    safe_exec('DROP TABLE jenis_pelanggaran CASCADE CONSTRAINTS');
    safe_exec('DROP TABLE nilai CASCADE CONSTRAINTS');
    safe_exec('DROP TABLE mapel_rapor CASCADE CONSTRAINTS');
    safe_exec('DROP TABLE periode_akademik CASCADE CONSTRAINTS');
    safe_exec('DROP TABLE siswa CASCADE CONSTRAINTS');
    safe_exec('DROP TABLE kelas CASCADE CONSTRAINTS');
    safe_exec('DROP TABLE guru CASCADE CONSTRAINTS');
    safe_exec('DROP TABLE jurusan CASCADE CONSTRAINTS');
END;
/

"""Semua query data sekolah: SQL tetap dengan parameter bernama (tidak ada SQL bebas dari AI).

Dipakai oleh router API dan nanti oleh Hybrid Query Engine. Hanya SELECT; rata-rata dan lulus/tidak KKM
dihitung di sini, bukan disimpan di tabel.
"""

KELAS_LIST = """
SELECT k.kode, k.nama, k.jurusan_kode, k.tahun_ajaran, COALESCE(g.nama, '-') AS wali_kelas, COUNT(s.nis) AS jumlah_siswa
FROM kelas k
LEFT JOIN guru g ON g.nip = k.wali_kelas_nip
LEFT JOIN siswa s ON s.kelas_kode = k.kode
GROUP BY k.kode, k.nama, k.jurusan_kode, k.tahun_ajaran, g.nama
ORDER BY k.kode
"""

KELAS_SISWA = """
SELECT nis, nisn, nama, jenis_kelamin, no_absen
FROM siswa WHERE kelas_kode = :kelas ORDER BY no_absen
"""

KELAS_EXISTS = "SELECT 1 FROM kelas WHERE kode = :kelas"

SISWA_SEARCH_WHERE = """
WHERE (CAST(:q AS TEXT) = ''
       OR s.nama ILIKE '%' || CAST(:q AS TEXT) || '%' ESCAPE '\\'
       OR s.nis LIKE CAST(:q AS TEXT) || '%' ESCAPE '\\'
       OR s.nisn LIKE CAST(:q AS TEXT) || '%' ESCAPE '\\')
  AND (CAST(:kelas AS TEXT) = '' OR s.kelas_kode = CAST(:kelas AS TEXT))
"""

SISWA_SEARCH_COUNT = "SELECT COUNT(*) FROM siswa s " + SISWA_SEARCH_WHERE

SISWA_SEARCH = (
    """
SELECT s.nis, s.nisn, s.nama, s.jenis_kelamin, s.no_absen, s.kelas_kode, k.nama AS kelas
FROM siswa s JOIN kelas k ON k.kode = s.kelas_kode
"""
    + SISWA_SEARCH_WHERE
    + " ORDER BY s.kelas_kode, s.no_absen LIMIT :limit OFFSET :offset"
)

SISWA_DETAIL = """
SELECT s.nis, s.nisn, s.nama, s.jenis_kelamin, s.no_absen, s.kelas_kode, k.nama AS kelas,
       COALESCE(g.nama, '-') AS wali_kelas, j.nama_konsentrasi AS jurusan
FROM siswa s
JOIN kelas k ON k.kode = s.kelas_kode
LEFT JOIN guru g ON g.nip = k.wali_kelas_nip
JOIN jurusan j ON j.kode = k.jurusan_kode
WHERE s.nis = :nis
"""

SISWA_PKL = """
SELECT pp.kode_perusahaan, p.nama AS perusahaan, pp.posisi, pp.sesi, pp.pembimbing_perusahaan,
       COALESCE(gu.nama, '-') AS pembimbing_sekolah, pp.status
FROM penempatan_pkl pp
JOIN perusahaan_pkl p ON p.kode = pp.kode_perusahaan
LEFT JOIN guru gu ON gu.nip = pp.pembimbing_sekolah_nip
WHERE pp.nis = :nis
"""

SISWA_EKSKUL = """
SELECT pe.semester, e.kode, e.nama AS ekskul, pe.nilai, pe.predikat
FROM partisipasi_ekskul pe JOIN ekstrakurikuler e ON e.kode = pe.kode_ekskul
WHERE pe.nis = :nis ORDER BY pe.semester, e.nama
"""

SISWA_NILAI = """
SELECT n.semester, n.kode_mapel, m.nama AS mapel, m.kelompok, n.nilai, p.kkm,
       CASE WHEN n.nilai >= p.kkm THEN 1 ELSE 0 END AS tuntas
FROM nilai n
JOIN mapel_rapor m ON m.kode = n.kode_mapel
JOIN periode_akademik p ON p.semester = n.semester
WHERE n.nis = :nis AND (CAST(:semester AS INTEGER) = 0 OR n.semester = CAST(:semester AS INTEGER))
ORDER BY n.semester, m.kelompok DESC, m.nama
"""

SISWA_NILAI_RATA = """
SELECT n.semester, ROUND(AVG(n.nilai), 2) AS rata_rata, COUNT(*) AS jumlah_mapel
FROM nilai n
WHERE n.nis = :nis AND (CAST(:semester AS INTEGER) = 0 OR n.semester = CAST(:semester AS INTEGER))
GROUP BY n.semester ORDER BY n.semester
"""

SISWA_KEHADIRAN = """
SELECT k.semester, p.tahun_ajaran, p.tipe, k.sakit, k.izin, k.alpha, k.hadir, p.hari_efektif
FROM kehadiran k JOIN periode_akademik p ON p.semester = k.semester
WHERE k.nis = :nis ORDER BY k.semester
"""

SISWA_PELANGGARAN = """
SELECT pl.id, jp.kode, jp.nama AS pelanggaran, jp.tingkat, jp.poin,
       pl.tanggal_kejadian, COALESCE(NULLIF(TRIM(pl.catatan), ''), jp.sanksi_disarankan) AS tindak_lanjut
FROM pelanggaran pl JOIN jenis_pelanggaran jp ON jp.kode = pl.kode_pelanggaran
WHERE pl.nis = :nis ORDER BY pl.tanggal_kejadian DESC, pl.id DESC
"""

JADWAL_KELAS = """
SELECT j.hari, j.jam_mulai, j.jam_selesai, j.kode_mapel, m.nama AS mapel, g.nama AS guru, j.ruangan
FROM jadwal_pelajaran j
JOIN mapel_jadwal m ON m.kode = j.kode_mapel
JOIN guru g ON g.nip = j.nip_guru
WHERE j.kelas_kode = :kelas AND (CAST(:hari AS TEXT) = '' OR j.hari = CAST(:hari AS TEXT))
ORDER BY CASE j.hari WHEN 'Senin' THEN 1 WHEN 'Selasa' THEN 2 WHEN 'Rabu' THEN 3 WHEN 'Kamis' THEN 4 WHEN 'Jumat' THEN 5 ELSE 6 END,
         j.jam_mulai
"""

USER_BY_USERNAME = """
SELECT id, username, nama, nip, role, password_hash, wajib_ganti_password, aktif
FROM users WHERE LOWER(username) = LOWER(:username)
"""

USER_BY_USERNAME_TV = """
SELECT id, username, nama, nip, role, password_hash, wajib_ganti_password, aktif, token_version
FROM users WHERE LOWER(username) = LOWER(:username)
"""

USER_BY_ID = "SELECT id, username, nama, nip, role, wajib_ganti_password, aktif FROM users WHERE id = :id"
USER_BY_ID_TV = (
    "SELECT id, username, nama, nip, role, wajib_ganti_password, aktif, token_version, token_exempt_jti "
    "FROM users WHERE id = :id"
)
USER_BY_ID_TV_ONLY = (
    "SELECT id, username, nama, nip, role, wajib_ganti_password, aktif, token_version "
    "FROM users WHERE id = :id"
)
USER_AUTH_BY_ID = "SELECT id, username, password_hash, aktif FROM users WHERE id = :id"

USER_SET_PASSWORD = "UPDATE users SET password_hash = :hash, wajib_ganti_password = FALSE WHERE id = :id"
USER_BUMP_TOKEN_VERSION = (
    "UPDATE users SET token_version = token_version + 1, token_exempt_jti = :exempt_jti WHERE id = :id"
)
USER_BUMP_TOKEN_VERSION_ONLY = "UPDATE users SET token_version = token_version + 1 WHERE id = :id"

AUDIT_INSERT = """
INSERT INTO audit_log (user_id, aksi, pertanyaan, tabel_diakses, status)
VALUES (:user_id, :aksi, :pertanyaan, :tabel, 'ok')
"""

AUDIT_INSERT_STATUS = """
INSERT INTO audit_log (user_id, aksi, pertanyaan, tabel_diakses, status)
VALUES (:user_id, :aksi, :pertanyaan, :tabel, :status)
"""

# ---------------------------------------------------------------- tambahan untuk Hybrid Query Engine
PERIODE_BERJALAN = "SELECT semester FROM periode_akademik WHERE status = 'berjalan'"

SISWA_FIND = """
SELECT s.nis, s.nama, s.no_absen, k.nama AS kelas, s.kelas_kode
FROM siswa s JOIN kelas k ON k.kode = s.kelas_kode
WHERE s.nama ILIKE '%' || CAST(:q AS TEXT) || '%'
   OR s.nis = CAST(:q AS TEXT)
   OR s.nisn = CAST(:q AS TEXT)
ORDER BY s.nama LIMIT 50
"""

GURU_SEARCH = """
SELECT nip, nama FROM guru WHERE nama ILIKE '%' || CAST(:q AS TEXT) || '%' ESCAPE '\\' ORDER BY nama LIMIT 50
"""

KELAS_BY_WALI = """
SELECT k.nama AS kelas, g.nama AS wali_kelas FROM kelas k JOIN guru g ON g.nip = k.wali_kelas_nip
WHERE g.nip = :nip ORDER BY k.kode
"""

RANKING_KELAS = """
SELECT s.no_absen, s.nama, ROUND(AVG(n.nilai), 2) AS rata_rata
FROM nilai n JOIN siswa s ON s.nis = n.nis
WHERE s.kelas_kode = :kelas AND n.semester = CAST(:semester AS INTEGER)
  AND (CAST(:mapel AS TEXT) = '' OR n.kode_mapel = CAST(:mapel AS TEXT))
GROUP BY s.no_absen, s.nama
ORDER BY rata_rata DESC, s.nama
"""

DI_BAWAH_KKM = """
SELECT s.nama, k.nama AS kelas, m.nama AS mapel, n.nilai, p.kkm
FROM nilai n
JOIN siswa s ON s.nis = n.nis
JOIN kelas k ON k.kode = s.kelas_kode
JOIN mapel_rapor m ON m.kode = n.kode_mapel
JOIN periode_akademik p ON p.semester = n.semester
WHERE n.semester = CAST(:semester AS INTEGER) AND n.nilai < p.kkm
  AND (CAST(:kelas AS TEXT) = '' OR s.kelas_kode = CAST(:kelas AS TEXT))
  AND (CAST(:mapel AS TEXT) = '' OR n.kode_mapel = CAST(:mapel AS TEXT))
ORDER BY (p.kkm - n.nilai) DESC, s.nama
"""

ALPHA_TINGGI = """
SELECT s.nama, k2.nama AS kelas, kh.alpha, kh.sakit, kh.izin
FROM kehadiran kh
JOIN siswa s ON s.nis = kh.nis
JOIN kelas k2 ON k2.kode = s.kelas_kode
WHERE kh.semester = CAST(:semester AS INTEGER) AND kh.alpha >= CAST(:ambang AS INTEGER)
  AND (CAST(:kelas AS TEXT) = '' OR s.kelas_kode = CAST(:kelas AS TEXT))
ORDER BY kh.alpha DESC, s.nama
"""

KEHADIRAN_KELAS = """
SELECT k.semester, SUM(k.sakit) AS sakit, SUM(k.izin) AS izin, SUM(k.alpha) AS alpha, SUM(k.hadir) AS hadir
FROM kehadiran k JOIN siswa s ON s.nis = k.nis
WHERE s.kelas_kode = :kelas AND (CAST(:semester AS INTEGER) = 0 OR k.semester = CAST(:semester AS INTEGER))
GROUP BY k.semester ORDER BY k.semester
"""

PELANGGARAN_KELAS = """
SELECT s.nama, jp.nama AS pelanggaran, jp.tingkat, jp.poin, pl.tanggal_kejadian,
       COALESCE(NULLIF(TRIM(pl.catatan), ''), jp.sanksi_disarankan) AS tindak_lanjut
FROM pelanggaran pl
JOIN siswa s ON s.nis = pl.nis
JOIN jenis_pelanggaran jp ON jp.kode = pl.kode_pelanggaran
WHERE s.kelas_kode = :kelas ORDER BY pl.tanggal_kejadian DESC, jp.poin DESC, s.nama
"""

JADWAL_GURU = """
SELECT j.hari, j.jam_mulai, j.jam_selesai, k.nama AS kelas, m.nama AS mapel, j.ruangan
FROM jadwal_pelajaran j
JOIN kelas k ON k.kode = j.kelas_kode
JOIN mapel_jadwal m ON m.kode = j.kode_mapel
WHERE j.nip_guru = :nip
ORDER BY CASE j.hari WHEN 'Senin' THEN 1 WHEN 'Selasa' THEN 2 WHEN 'Rabu' THEN 3 WHEN 'Kamis' THEN 4 WHEN 'Jumat' THEN 5 ELSE 6 END,
         j.jam_mulai
"""

PKL_KELAS = """
SELECT s.no_absen, s.nama, p.nama AS perusahaan, pp.posisi, pp.sesi, pp.status
FROM penempatan_pkl pp
JOIN siswa s ON s.nis = pp.nis
JOIN perusahaan_pkl p ON p.kode = pp.kode_perusahaan
WHERE s.kelas_kode = :kelas ORDER BY s.no_absen
"""

PKL_PERUSAHAAN = """
SELECT s.nama, k.nama AS kelas, pp.posisi, pp.sesi, pp.status
FROM penempatan_pkl pp
JOIN siswa s ON s.nis = pp.nis
JOIN kelas k ON k.kode = s.kelas_kode
WHERE pp.kode_perusahaan = :kode ORDER BY k.kode, s.no_absen
"""

PERUSAHAAN_LIST = """
SELECT p.kode, p.nama, p.jurusan_kode, p.kota, p.bidang_usaha, p.kuota_sesi1, p.kuota_sesi2,
       p.posisi_tersedia, p.narahubung
FROM perusahaan_pkl p ORDER BY p.kode
"""

EKSKUL_LIST = """
SELECT e.kode, e.nama, e.deskripsi, e.hari, e.waktu, COALESCE(s.nama, '-') AS ketua,
       (SELECT pb.nama FROM pembina_ekskul pb WHERE pb.kode_ekskul = e.kode AND pb.urutan = 1) AS pembina
FROM ekstrakurikuler e LEFT JOIN siswa s ON s.nis = e.ketua_nis ORDER BY e.nama
"""

EKSKUL_ANGGOTA = """
SELECT s.nama, k.nama AS kelas, pe.nilai, pe.predikat
FROM partisipasi_ekskul pe
JOIN siswa s ON s.nis = pe.nis
JOIN kelas k ON k.kode = s.kelas_kode
WHERE pe.kode_ekskul = :kode AND pe.semester = CAST(:semester AS INTEGER)
ORDER BY pe.nilai DESC, s.nama
"""

JENIS_PELANGGARAN = "SELECT kode, nama, tingkat, poin, sanksi_disarankan FROM jenis_pelanggaran ORDER BY poin DESC, kode"

AUDIT_CHAT = """
INSERT INTO audit_log (user_id, aksi, pertanyaan, intent_json, tabel_diakses, status)
VALUES (:user_id, :aksi, :pertanyaan, CAST(:intent AS JSONB), :tabel, :status)
"""

USERS_LIST = "SELECT id, username, nama, nip, role, wajib_ganti_password, aktif, dibuat_pada FROM users ORDER BY role, username"
USER_INSERT = """
INSERT INTO users (username, nama, nip, role, password_hash) VALUES (:username, :nama, :nip, :role, :hash)
RETURNING id
"""
USER_UPDATE_AKTIF = "UPDATE users SET aktif = :aktif WHERE id = :id"
USER_RESET_PASSWORD = "UPDATE users SET password_hash = :hash, wajib_ganti_password = TRUE WHERE id = :id"

AUDIT_LIST = """
SELECT a.id, a.waktu, u.username, a.aksi, a.pertanyaan, a.tabel_diakses, a.status
FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
WHERE (CAST(:username AS TEXT) = '' OR u.username = CAST(:username AS TEXT))
  AND (CAST(:dari AS TIMESTAMPTZ) IS NULL OR a.waktu >= CAST(:dari AS TIMESTAMPTZ))
  AND (CAST(:sampai AS TIMESTAMPTZ) IS NULL OR a.waktu < CAST(:sampai AS TIMESTAMPTZ))
ORDER BY a.waktu DESC, a.id DESC LIMIT :limit OFFSET :offset
"""

AUDIT_COUNT = """
SELECT COUNT(*) FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
WHERE (CAST(:username AS TEXT) = '' OR u.username = CAST(:username AS TEXT))
  AND (CAST(:dari AS TIMESTAMPTZ) IS NULL OR a.waktu >= CAST(:dari AS TIMESTAMPTZ))
  AND (CAST(:sampai AS TIMESTAMPTZ) IS NULL OR a.waktu < CAST(:sampai AS TIMESTAMPTZ))
"""

AUDIT_LIST_GENERIC = """
SELECT a.id, a.waktu, u.username, a.aksi, a.pertanyaan, a.tabel_diakses, a.status
FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
WHERE (:username = '' OR u.username = :username)
  AND (:dari IS NULL OR a.waktu >= :dari)
  AND (:sampai IS NULL OR a.waktu < :sampai)
ORDER BY a.waktu DESC, a.id DESC LIMIT :limit OFFSET :offset
"""

AUDIT_COUNT_GENERIC = """
SELECT COUNT(*) FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
WHERE (:username = '' OR u.username = :username)
  AND (:dari IS NULL OR a.waktu >= :dari)
  AND (:sampai IS NULL OR a.waktu < :sampai)
"""

ADMIN_AKTIF_LAIN = "SELECT COUNT(*) FROM users WHERE role = 'admin' AND aktif AND id <> :id"
ADMIN_AKTIF_LOCK = "SELECT id FROM users WHERE role = 'admin' AND aktif FOR UPDATE"

IMPORT_LIST = "SELECT id, waktu, dijalankan_oleh, nama_file, jumlah_baris, status FROM import_batch ORDER BY waktu DESC LIMIT 50"

PKL_PENEMPATAN_LIST = """
SELECT s.nis, s.nama, k.nama AS kelas, p.nama AS perusahaan, pp.posisi, pp.sesi, pp.status
FROM penempatan_pkl pp
JOIN siswa s ON s.nis = pp.nis
JOIN kelas k ON k.kode = s.kelas_kode
JOIN perusahaan_pkl p ON p.kode = pp.kode_perusahaan
WHERE (CAST(:kelas AS TEXT) = '' OR s.kelas_kode = CAST(:kelas AS TEXT))
  AND (CAST(:sesi AS INTEGER) = 0 OR pp.sesi = CAST(:sesi AS INTEGER))
ORDER BY k.kode, s.no_absen
"""

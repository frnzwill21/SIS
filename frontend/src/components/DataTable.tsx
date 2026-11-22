import type { Row } from '@/lib/api';

const HEADER_MAP: Record<string, string> = {
  id: 'ID',
  nis: 'NIS',
  nisn: 'NISN',
  nip: 'NIP',
  nip_guru: 'NIP Guru',
  kkm: 'KKM',
  pkl: 'PKL',
  jk: 'JK',
  no_absen: 'No. Absen',
  kode: 'Kode',
  kode_mapel: 'Kode Mapel',
  kode_perusahaan: 'Kode Perusahaan',
  kode_pelanggaran: 'Kode Pelanggaran',
  kode_ekskul: 'Kode Ekskul',
  kelas_kode: 'Kode Kelas',
  jurusan_kode: 'Kode Jurusan',
  jam_mulai: 'Jam Mulai',
  jam_selesai: 'Jam Selesai',
  jam_ke: 'Jam Ke',
  tindak_lanjut: 'Tindak Lanjut',
  sanksi_disarankan: 'Sanksi Disarankan',
  rata_rata: 'Rata-rata',
  rata_nilai: 'Rata-rata Nilai',
  tahun_ajaran: 'Tahun Ajaran',
  nama_file: 'Nama Berkas',
  dijalankan_oleh: 'Dijalankan Oleh',
  jumlah_baris: 'Jumlah Baris',
  jumlah_mapel: 'Jumlah Mapel',
  jumlah_siswa: 'Jumlah Siswa',
  jumlah_pesan: 'Jumlah Pesan',
  jumlah_pelanggaran: 'Jumlah Pelanggaran',
  tabel_diakses: 'Tabel Diakses',
  tanggal_kejadian: 'Tanggal Kejadian',
  tanggal_mulai: 'Tanggal Mulai',
  tanggal_selesai: 'Tanggal Selesai',
  hari_efektif: 'Hari Efektif',
  jenis_kelamin: 'Jenis Kelamin',
  wali_kelas: 'Wali Kelas',
  wali_kelas_nip: 'NIP Wali Kelas',
  pembimbing_perusahaan: 'Pembimbing Perusahaan',
  pembimbing_sekolah: 'Pembimbing Sekolah',
  pembimbing_sekolah_nip: 'NIP Pembimbing Sekolah',
  bidang_usaha: 'Bidang Usaha',
  posisi_tersedia: 'Posisi Tersedia',
  kuota_sesi1: 'Kuota Sesi 1',
  kuota_sesi2: 'Kuota Sesi 2',
  terisi_sesi1: 'Terisi Sesi 1',
  terisi_sesi2: 'Terisi Sesi 2',
  total_poin: 'Total Poin',
  nama_konsentrasi: 'Konsentrasi Keahlian',
  program_keahlian: 'Program Keahlian',
  dibuat_pada: 'Dibuat Pada',
  diperbarui_pada: 'Diperbarui Pada',
  wajib_ganti_password: 'Wajib Ganti Sandi',
  mata_pelajaran: 'Mata Pelajaran',
  mapel: 'Mata Pelajaran',
  ekskul: 'Ekstrakurikuler',
  ruangan: 'Ruang',
  nama_guru: 'Nama Guru',
  nama_siswa: 'Nama Siswa',
  nama_kelas: 'Nama Kelas',
  nama_perusahaan: 'Nama Perusahaan',
  waktu: 'Waktu',
  username: 'Username',
  aksi: 'Aksi',
  pertanyaan: 'Pertanyaan',
  status: 'Status',
};

const ACRONYMS = new Set([
  'id',
  'nis',
  'nisn',
  'nip',
  'kkm',
  'pkl',
  'jk',
  'rpl',
  'dkv',
  'titl',
  'toi',
  'tav',
  'ai',
  'sql',
]);

function formatHeader(rawKey: string): string {
  const trimmed = rawKey.trim();
  if (!trimmed) return '—';
  const norm = trimmed.toLowerCase().replace(/[\s-]+/g, '_');
  if (HEADER_MAP[norm]) return HEADER_MAP[norm];

  // Pertahankan label singkat dengan garis miring seperti L/P
  if (trimmed.includes('/') && !trimmed.includes('_')) {
    return trimmed;
  }

  return trimmed
    .replace(/_/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      if (word.includes('-')) {
        return word
          .split('-')
          .map((part, idx) =>
            idx === 0
              ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
              : part.toLowerCase()
          )
          .join('-');
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

const WRAP_COLUMNS = new Set([
  'deskripsi',
  'pertanyaan',
  'tindak_lanjut',
  'keterangan',
  'alamat',
  'catatan',
  'sanksi',
  'sanksi_disarankan',
  'jawaban',
  'alasan',
  'posisi',
  'ringkasan',
  'nama_file',
  'tabel_diakses',
  'perusahaan',
  'pelanggaran',
  'mata_pelajaran',
  'mapel',
  'posisi_tersedia',
  'bidang_usaha',
  'aturan',
  'program_keahlian',
  'nama_konsentrasi',
]);

type TabelEngine = { kolom: string[]; baris: unknown[][] };

function formatCell(val: unknown): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'boolean') return val ? 'Ya' : 'Tidak';
  if (typeof val === 'string') {
    const t = val.trim();
    if (!t || t === '-') return '—';
    return val;
  }
  return String(val);
}

function cellClass(colName: string, text: string, hasTopBorder: boolean): string {
  const norm = colName.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const borderClass = hasTopBorder ? 'border-t border-[var(--border-subtle)]' : '';
  const padClass = 'px-[var(--table-cell-px)] py-[var(--table-cell-py)]';

  if (WRAP_COLUMNS.has(norm) || text.length > 56) {
    return `${borderClass} ${padClass} min-w-[13rem] max-w-[26rem] whitespace-normal break-words leading-relaxed`;
  }
  if (text.length > 32) {
    return `${borderClass} ${padClass} min-w-[10rem] max-w-[20rem] whitespace-normal leading-snug`;
  }
  return `${borderClass} ${padClass} whitespace-nowrap`;
}

export default function DataTable({
  rows,
  empty = 'Tidak ada data.',
  ariaLabel = 'Tabel data',
}: {
  rows: Row[] | TabelEngine | null | undefined;
  empty?: string;
  ariaLabel?: string;
}) {
  if (!rows) return <p className="text-sm text-[var(--text-secondary)]">{empty}</p>;

  // Dukungan untuk format tabel dari Hybrid Query Engine: { kolom: [...], baris: [[...], ...] }
  if (!Array.isArray(rows) && 'kolom' in rows && Array.isArray(rows.kolom)) {
    if (!rows.baris?.length) return <p className="text-sm text-[var(--text-secondary)]">{empty}</p>;
    return (
      <div
        role="region"
        tabIndex={0}
        aria-label={ariaLabel}
        className="max-h-[65vh] overflow-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ink)]/30"
      >
        <table className="min-w-full border-separate border-spacing-0 text-left text-sm tabular-nums text-[var(--text-primary)]">
          <thead className="sticky top-0 z-10 bg-[var(--bg-elevated)] text-xs font-semibold tracking-tight text-[var(--text-secondary)]">
            <tr>
              {rows.kolom.map((c, idx) => (
                <th
                  key={idx}
                  scope="col"
                  className="whitespace-nowrap border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]"
                >
                  {formatHeader(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.baris.map((r, i) => (
              <tr
                key={i}
                className="transition-colors hover:bg-[var(--bg-elevated)]/65"
              >
                {r.map((val, j) => {
                  const text = formatCell(val);
                  const colName = rows.kolom[j] ?? '';
                  return (
                    <td key={j} className={cellClass(colName, text, i > 0)}>
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (!Array.isArray(rows) || !rows.length) {
    return <p className="text-sm text-[var(--text-secondary)]">{empty}</p>;
  }
  const cols = Object.keys(rows[0]);
  return (
    <div
      role="region"
      tabIndex={0}
      aria-label={ariaLabel}
      className="max-h-[65vh] overflow-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ink)]/30"
    >
      <table className="min-w-full border-separate border-spacing-0 text-left text-sm tabular-nums text-[var(--text-primary)]">
        <thead className="sticky top-0 z-10 bg-[var(--bg-elevated)] text-xs font-semibold tracking-tight text-[var(--text-secondary)]">
          <tr>
            {cols.map((c) => (
              <th
                key={c}
                scope="col"
                className="whitespace-nowrap border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]"
              >
                {formatHeader(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              className="transition-colors hover:bg-[var(--bg-elevated)]/65"
            >
              {cols.map((c) => {
                const text = formatCell(r[c]);
                return (
                  <td key={c} className={cellClass(c, text, i > 0)}>
                    {text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

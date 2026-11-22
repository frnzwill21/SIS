'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { canViewPelanggaran, Row, session } from '@/lib/api';
import DataTable from '@/components/DataTable';
import { useLoad, Status } from '@/components/useLoad';

const ALL_TABS = ['Ringkasan', 'Nilai', 'Kehadiran', 'Pelanggaran', 'Ekskul', 'PKL'] as const;
type Tab = (typeof ALL_TABS)[number];

export default function ProfilSiswa() {
  const { nis } = useParams<{ nis: string }>();
  const encNis = encodeURIComponent(nis);
  const [tab, setTab] = useState<Tab>('Ringkasan');
  const [semester, setSemester] = useState(0);
  const [allowPelanggaran, setAllowPelanggaran] = useState(false);

  useEffect(() => {
    const allowed = canViewPelanggaran(session.user()?.role);
    setAllowPelanggaran(allowed);
    if (!allowed && tab === 'Pelanggaran') {
      setTab('Ringkasan');
    }
  }, [tab]);

  const tabs = allowPelanggaran ? ALL_TABS : ALL_TABS.filter((t) => t !== 'Pelanggaran');
  const profil = useLoad<{ data: Record<string, any> }>(`/siswa/${encNis}`);
  const nilai = useLoad<{ data: Row[]; rata_rata_per_semester: Row[] }>(
    tab === 'Nilai' ? `/siswa/${encNis}/nilai?semester=${semester}` : null
  );
  const hadir = useLoad<{ data: Row[] }>(tab === 'Kehadiran' ? `/siswa/${encNis}/kehadiran` : null);
  const langgar = useLoad<{ data: Row[] }>(
    allowPelanggaran && tab === 'Pelanggaran' ? `/siswa/${encNis}/pelanggaran` : null
  );
  const p = profil.data?.data;

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/siswa"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Kembali ke Data Siswa</span>
        </Link>
      </div>
      <Status loading={profil.loading} error={profil.error} />
      {!profil.loading && !profil.error && p && (
        <>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">
            {p.nama}{' '}
            <span className="text-sm font-normal text-[var(--text-secondary)]">· {p.kelas ?? p.kelas_kode}</span>
          </h1>
          <div className="flex flex-wrap gap-1.5">
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  tab === t
                    ? 'bg-[var(--accent-ink)] text-[var(--accent-ink-fg)]'
                    : 'border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          {tab === 'Ringkasan' && (
            <dl className="card grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">NIS</dt>
                <dd className="mt-0.5 font-mono text-sm text-[var(--text-primary)]">{String(p.nis ?? '-')}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">NISN</dt>
                <dd className="mt-0.5 font-mono text-sm text-[var(--text-primary)]">{String(p.nisn ?? '-')}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                  Nama Lengkap
                </dt>
                <dd className="mt-0.5 text-sm font-medium text-[var(--text-primary)]">{String(p.nama ?? '-')}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                  Jenis Kelamin
                </dt>
                <dd className="mt-0.5 text-sm text-[var(--text-primary)]">
                  {p.jenis_kelamin === 'L'
                    ? 'Laki-laki'
                    : p.jenis_kelamin === 'P'
                    ? 'Perempuan'
                    : String(p.jenis_kelamin ?? '-')}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Kelas</dt>
                <dd className="mt-0.5 text-sm text-[var(--text-primary)]">
                  {String(p.kelas ?? p.kelas_kode ?? '-')}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                  No. Absen
                </dt>
                <dd className="mt-0.5 text-sm text-[var(--text-primary)]">{String(p.no_absen ?? '-')}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                  Konsentrasi Keahlian
                </dt>
                <dd className="mt-0.5 text-sm text-[var(--text-primary)]">{String(p.jurusan ?? '-')}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                  Wali Kelas
                </dt>
                <dd className="mt-0.5 text-sm text-[var(--text-primary)]">{String(p.wali_kelas ?? '-')}</dd>
              </div>
            </dl>
          )}
          {tab === 'Nilai' && (
            <div className="space-y-3">
              <select
                className="input max-w-xs"
                value={semester}
                onChange={(e) => setSemester(Number(e.target.value))}
              >
                <option value={0}>Semua semester</option>
                {[1, 2, 3, 4, 5, 6].map((s) => (
                  <option key={s} value={s}>
                    Semester {s}
                  </option>
                ))}
              </select>
              <Status loading={nilai.loading} error={nilai.error} />
              {!nilai.loading && !nilai.error && nilai.data != null && (
                <>
                  <h2 className="text-sm font-medium text-[var(--text-primary)]">Rata-rata per semester</h2>
                  <DataTable rows={nilai.data.rata_rata_per_semester} />
                  <h2 className="text-sm font-medium text-[var(--text-primary)]">Rincian nilai mata pelajaran</h2>
                  {nilai.data.data.length === 0 ? (
                    <p className="text-sm text-[var(--text-secondary)]">Tidak ada data nilai.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-sm">
                      <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
                        <thead className="bg-[var(--bg-elevated)] text-xs uppercase tracking-wide text-[var(--text-secondary)]">
                          <tr>
                            <th className="border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]">Sem</th>
                            <th className="border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]">Kode</th>
                            <th className="border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]">Mata Pelajaran</th>
                            <th className="border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]">Kelompok</th>
                            <th className="border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)] text-right">Nilai</th>
                            <th className="border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)] text-right">KKM</th>
                            <th className="border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)] text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {nilai.data.data.map((r, idx) => {
                            const isTuntas = Number(r.tuntas) === 1 || Number(r.nilai) >= Number(r.kkm);
                            return (
                              <tr
                                key={`${String(r.semester)}-${String(r.kode_mapel)}-${idx}`}
                                className="transition-colors hover:bg-[var(--bg-elevated)]/65"
                              >
                                <td className="border-t border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-cell-py)] text-[var(--text-secondary)]">
                                  {String(r.semester)}
                                </td>
                                <td className="border-t border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-cell-py)] font-mono text-xs text-[var(--text-secondary)]">
                                  {String(r.kode_mapel)}
                                </td>
                                <td className="border-t border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-cell-py)] text-[var(--text-primary)]">
                                  {String(r.mapel)}
                                </td>
                                <td className="border-t border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-cell-py)] text-[var(--text-secondary)]">
                                  {String(r.kelompok)}
                                </td>
                                <td
                                  className={`border-t border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-cell-py)] text-right font-semibold ${
                                    isTuntas
                                      ? 'text-[var(--text-primary)]'
                                      : 'text-rose-600 dark:text-rose-400'
                                  }`}
                                >
                                  {String(r.nilai)}
                                </td>
                                <td className="border-t border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-cell-py)] text-right text-[var(--text-secondary)]">
                                  {String(r.kkm)}
                                </td>
                                <td className="border-t border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-cell-py)] text-center">
                                  <span
                                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${
                                      isTuntas
                                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                        : 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                                    }`}
                                  >
                                    {isTuntas ? 'Tuntas' : 'Belum Tuntas'}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {tab === 'Kehadiran' && (
            <>
              <Status loading={hadir.loading} error={hadir.error} />
              {!hadir.loading && !hadir.error && hadir.data != null && <DataTable rows={hadir.data.data} />}
            </>
          )}
          {tab === 'Pelanggaran' && (
            <>
              <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                Data sensitif. Akses halaman ini tercatat dalam log sistem.
              </p>
              <Status loading={langgar.loading} error={langgar.error} />
              {!langgar.loading && !langgar.error && langgar.data != null && (
                <DataTable rows={langgar.data.data} empty="Tidak ada catatan pelanggaran." />
              )}
            </>
          )}
          {tab === 'Ekskul' && <DataTable rows={(p.ekskul as Row[]) ?? []} empty="Tidak mengikuti ekskul." />}
          {tab === 'PKL' &&
            (p.pkl ? (
              <DataTable rows={[p.pkl as Row]} />
            ) : (
              <p className="text-sm text-[var(--text-secondary)]">Belum ada penempatan PKL.</p>
            ))}
        </>
      )}
    </div>
  );
}

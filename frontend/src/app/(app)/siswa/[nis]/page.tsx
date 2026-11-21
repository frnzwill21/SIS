'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Row } from '@/lib/api';
import DataTable from '@/components/DataTable';
import { useLoad, Status } from '@/components/useLoad';

const TABS = ['Ringkasan', 'Nilai', 'Kehadiran', 'Pelanggaran', 'Ekskul', 'PKL'] as const;
type Tab = (typeof TABS)[number];

export default function ProfilSiswa() {
  const { nis } = useParams<{ nis: string }>();
  const encNis = encodeURIComponent(nis);
  const [tab, setTab] = useState<Tab>('Ringkasan');
  const [semester, setSemester] = useState(0);
  const profil = useLoad<{ data: Record<string, any> }>(`/siswa/${encNis}`);
  const nilai = useLoad<{ data: Row[]; rata_rata_per_semester: Row[] }>(
    tab === 'Nilai' ? `/siswa/${encNis}/nilai?semester=${semester}` : null
  );
  const hadir = useLoad<{ data: Row[] }>(tab === 'Kehadiran' ? `/siswa/${encNis}/kehadiran` : null);
  const langgar = useLoad<{ data: Row[] }>(tab === 'Pelanggaran' ? `/siswa/${encNis}/pelanggaran` : null);
  const p = profil.data?.data;

  return (
    <div className="space-y-3">
      <div>
        <Link
          href="/siswa"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-blue-700"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Kembali ke Data Siswa</span>
        </Link>
      </div>
      <Status loading={profil.loading} error={profil.error} />
      {!profil.loading && !profil.error && p && (
        <>
          <h1 className="text-lg font-semibold">
            {p.nama} <span className="text-sm font-normal text-slate-500">· {p.kelas ?? p.kelas_kode}</span>
          </h1>
          <div className="flex flex-wrap gap-1">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`rounded px-3 py-1.5 text-sm ${
                  tab === t ? 'bg-brand-600 text-white' : 'bg-white border border-slate-300 hover:bg-slate-100'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          {tab === 'Ringkasan' && (
            <dl className="card grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">NIS</dt>
                <dd className="mt-0.5 font-mono text-sm text-slate-900">{String(p.nis ?? '-')}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">NISN</dt>
                <dd className="mt-0.5 font-mono text-sm text-slate-900">{String(p.nisn ?? '-')}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nama Lengkap</dt>
                <dd className="mt-0.5 text-sm font-medium text-slate-900">{String(p.nama ?? '-')}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Jenis Kelamin</dt>
                <dd className="mt-0.5 text-sm text-slate-800">
                  {p.jenis_kelamin === 'L' ? 'Laki-laki' : p.jenis_kelamin === 'P' ? 'Perempuan' : String(p.jenis_kelamin ?? '-')}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Kelas</dt>
                <dd className="mt-0.5 text-sm text-slate-800">{String(p.kelas ?? p.kelas_kode ?? '-')}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">No. Absen</dt>
                <dd className="mt-0.5 text-sm text-slate-800">{String(p.no_absen ?? '-')}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Konsentrasi Keahlian</dt>
                <dd className="mt-0.5 text-sm text-slate-800">{String(p.jurusan ?? '-')}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Wali Kelas</dt>
                <dd className="mt-0.5 text-sm text-slate-800">{String(p.wali_kelas ?? '-')}</dd>
              </div>
            </dl>
          )}
          {tab === 'Nilai' && (
            <div className="space-y-3">
              <select className="input max-w-xs" value={semester} onChange={(e) => setSemester(Number(e.target.value))}>
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
                  <h2 className="text-sm font-medium">Rata-rata per semester</h2>
                  <DataTable rows={nilai.data.rata_rata_per_semester} />
                  <h2 className="text-sm font-medium">Rincian nilai mata pelajaran</h2>
                  {nilai.data.data.length === 0 ? (
                    <p className="text-sm text-slate-500">Tidak ada data nilai.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                      <table className="min-w-full text-left text-sm">
                        <thead className="bg-slate-100 text-xs uppercase text-slate-600">
                          <tr>
                            <th className="px-3 py-2">Sem</th>
                            <th className="px-3 py-2">Kode</th>
                            <th className="px-3 py-2">Mata Pelajaran</th>
                            <th className="px-3 py-2">Kelompok</th>
                            <th className="px-3 py-2 text-right">Nilai</th>
                            <th className="px-3 py-2 text-right">KKM</th>
                            <th className="px-3 py-2 text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {nilai.data.data.map((r, idx) => {
                            const isTuntas = Number(r.tuntas) === 1 || Number(r.nilai) >= Number(r.kkm);
                            return (
                              <tr key={`${String(r.semester)}-${String(r.kode_mapel)}-${idx}`} className="border-t border-slate-100 hover:bg-slate-50">
                                <td className="px-3 py-1.5">{String(r.semester)}</td>
                                <td className="px-3 py-1.5 font-mono text-xs text-blue-700">{String(r.kode_mapel)}</td>
                                <td className="px-3 py-1.5">{String(r.mapel)}</td>
                                <td className="px-3 py-1.5 text-slate-600">{String(r.kelompok)}</td>
                                <td className={`px-3 py-1.5 text-right font-semibold ${isTuntas ? 'text-slate-900' : 'text-rose-600'}`}>
                                  {String(r.nilai)}
                                </td>
                                <td className="px-3 py-1.5 text-right text-slate-500">{String(r.kkm)}</td>
                                <td className="px-3 py-1.5 text-center">
                                  <span
                                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${
                                      isTuntas
                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                        : 'border-rose-200 bg-rose-50 text-rose-700'
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
              <p className="rounded bg-amber-50 p-2.5 text-sm text-amber-800">
                Data sensitif. Akses halaman ini tercatat dalam log sistem. Pencatatan pelanggaran baru dilakukan melalui halaman{' '}
                <Link href="/kedisiplinan" className="font-semibold underline">
                  Kedisiplinan
                </Link>
                .
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
              <p className="text-sm text-slate-500">Belum ada penempatan PKL.</p>
            ))}
        </>
      )}
    </div>
  );
}

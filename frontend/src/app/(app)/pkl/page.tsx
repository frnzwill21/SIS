'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Row } from '@/lib/api';
import DataTable from '@/components/DataTable';
import { useLoad, Status } from '@/components/useLoad';

export default function Pkl() {
  const [kelas, setKelas] = useState('');
  const [sesi, setSesi] = useState(0);
  const [tab, setTab] = useState<'penempatan' | 'perusahaan'>('penempatan');
  const kl = useLoad<{ data: Row[] }>('/kelas');
  const pen = useLoad<{ data: Row[] }>(
    tab === 'penempatan' ? `/pkl/penempatan?kelas=${encodeURIComponent(kelas)}&sesi=${sesi}` : null
  );
  const per = useLoad<{ data: Row[] }>(tab === 'perusahaan' ? '/pkl/perusahaan' : null);
  const cur = tab === 'penempatan' ? pen : per;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={tab === 'penempatan' ? 'btn' : 'btn-ghost'} onClick={() => setTab('penempatan')}>
          Penempatan
        </button>
        <button type="button" className={tab === 'perusahaan' ? 'btn' : 'btn-ghost'} onClick={() => setTab('perusahaan')}>
          Perusahaan
        </button>
        {tab === 'penempatan' && (
          <>
            <select
              className="input max-w-xs"
              value={kelas}
              onChange={(e) => setKelas(e.target.value)}
              disabled={kl.loading && !kl.data}
            >
              <option value="">Semua kelas</option>
              {kl.data?.data.map((k) => (
                <option key={String(k.kode)} value={String(k.kode)}>
                  {String(k.nama)}
                </option>
              ))}
            </select>
            <select className="input max-w-[160px]" value={sesi} onChange={(e) => setSesi(Number(e.target.value))}>
              <option value={0}>Semua sesi</option>
              <option value={1}>Sesi 1</option>
              <option value={2}>Sesi 2</option>
            </select>
          </>
        )}
      </div>
      {tab === 'penempatan' && kl.error && (
        <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">
          Daftar filter kelas gagal dimuat: {kl.error}
        </p>
      )}
      <Status loading={cur.loading} error={cur.error} />
      {tab === 'penempatan' ? (
        !pen.loading && !pen.error && pen.data != null && (
          pen.data.data.length ? (
            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase text-slate-600">
                  <tr>
                    <th className="px-3 py-2">NIS</th>
                    <th className="px-3 py-2">Nama</th>
                    <th className="px-3 py-2">Kelas</th>
                    <th className="px-3 py-2">Perusahaan</th>
                    <th className="px-3 py-2">Posisi</th>
                    <th className="px-3 py-2">Sesi</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pen.data.data.map((r, idx) => (
                    <tr
                      key={`${String(r.nis)}-${String(r.sesi ?? '')}-${idx}`}
                      className="border-t border-slate-100 hover:bg-slate-50"
                    >
                      <td className="px-3 py-1.5 font-mono text-xs">{String(r.nis)}</td>
                      <td className="px-3 py-1.5">
                        <Link
                          className="text-brand-700 hover:underline"
                          href={`/siswa/${encodeURIComponent(String(r.nis))}`}
                        >
                          {String(r.nama)}
                        </Link>
                      </td>
                      <td className="px-3 py-1.5">{String(r.kelas ?? '-')}</td>
                      <td className="px-3 py-1.5">{String(r.perusahaan ?? '-')}</td>
                      <td className="px-3 py-1.5">{String(r.posisi ?? '-')}</td>
                      <td className="px-3 py-1.5">{String(r.sesi ?? '-')}</td>
                      <td className="px-3 py-1.5">{String(r.status ?? '-')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Tidak ada data penempatan PKL.</p>
          )
        )
      ) : (
        !per.loading && !per.error && per.data != null && <DataTable rows={per.data.data} />
      )}
    </div>
  );
}

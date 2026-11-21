'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Row } from '@/lib/api';
import { useLoad, Status } from '@/components/useLoad';

export default function SiswaList() {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [kelas, setKelas] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const kelasList = useLoad<{ data: Row[] }>('/kelas');
  const { data, error, loading } = useLoad<{ data: Row[]; meta: { total: number; page_size: number } }>(
    `/siswa?q=${encodeURIComponent(debouncedQ)}&kelas=${encodeURIComponent(kelas)}&page=${page}&page_size=25`
  );
  const total = data?.meta.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <input
          className="input max-w-xs"
          placeholder="Cari nama / NIS / NISN"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="input max-w-xs"
          value={kelas}
          onChange={(e) => {
            setKelas(e.target.value);
            setPage(1);
          }}
          disabled={kelasList.loading && !kelasList.data}
        >
          <option value="">Semua kelas</option>
          {kelasList.data?.data.map((k) => (
            <option key={String(k.kode)} value={String(k.kode)}>
              {String(k.nama)}
            </option>
          ))}
        </select>
      </div>
      {kelasList.error && (
        <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">
          Daftar filter kelas gagal dimuat: {kelasList.error}
        </p>
      )}
      <Status loading={loading} error={error} />
      {!loading && !error && data != null && (
        <>
          <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-xs uppercase text-slate-600">
                <tr>
                  <th className="px-3 py-2">Nama</th>
                  <th className="px-3 py-2">NIS</th>
                  <th className="px-3 py-2">NISN</th>
                  <th className="px-3 py-2">Kelas</th>
                  <th className="px-3 py-2">JK</th>
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                      Tidak ada siswa yang sesuai pencarian.
                    </td>
                  </tr>
                ) : (
                  data.data.map((s) => (
                    <tr key={String(s.nis)} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-1.5">
                        <Link
                          className="text-brand-700 hover:underline"
                          href={`/siswa/${encodeURIComponent(String(s.nis))}`}
                        >
                          {String(s.nama)}
                        </Link>
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs">{String(s.nis)}</td>
                      <td className="px-3 py-1.5 font-mono text-xs text-slate-600">{String(s.nisn ?? '-')}</td>
                      <td className="px-3 py-1.5">{String(s.kelas ?? s.kelas_kode ?? '-')}</td>
                      <td className="px-3 py-1.5">{String(s.jenis_kelamin ?? '-')}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <button
              type="button"
              className="btn-ghost"
              disabled={loading || page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Sebelumnya
            </button>
            <span>
              Halaman {page} dari {pages} ({total} siswa)
            </span>
            <button
              type="button"
              className="btn-ghost"
              disabled={loading || page >= pages}
              onClick={() => setPage(page + 1)}
            >
              Berikutnya
            </button>
          </div>
        </>
      )}
    </div>
  );
}

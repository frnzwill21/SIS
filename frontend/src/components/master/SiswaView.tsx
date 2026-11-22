'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Row } from '@/lib/api';
import { useLoad, Status } from '@/components/useLoad';

export default function SiswaView() {
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
        <label htmlFor="siswa-search" className="sr-only">
          Cari siswa berdasarkan nama, NIS, atau NISN
        </label>
        <input
          id="siswa-search"
          name="q"
          type="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          className="input max-w-xs"
          placeholder="Cari nama / NIS / NISN"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label htmlFor="siswa-kelas-filter" className="sr-only">
          Filter kelas siswa
        </label>
        <select
          id="siswa-kelas-filter"
          name="kelas"
          className="input select-branded max-w-xs"
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
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
          Daftar filter kelas gagal dimuat: {kelasList.error}
        </p>
      )}
      <Status loading={loading} error={error} />
      {!loading && !error && data != null && (
        <>
          <div
            tabIndex={0}
            role="region"
            aria-label="Tabel data siswa kelas XII"
            className="overflow-x-auto overscroll-x-contain rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ink)]/30"
          >
            <table className="min-w-full border-separate border-spacing-0 text-left text-sm tabular-nums">
              <thead className="sticky top-0 z-10 bg-[var(--bg-elevated)] text-xs uppercase tracking-wide text-[var(--text-secondary)]">
                <tr>
                  <th scope="col" className="border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]">Nama</th>
                  <th scope="col" className="border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]">NIS</th>
                  <th scope="col" className="border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]">NISN</th>
                  <th scope="col" className="border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]">Kelas</th>
                  <th scope="col" className="border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]">JK</th>
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-[var(--text-secondary)]">
                      Tidak ada siswa yang sesuai pencarian.
                    </td>
                  </tr>
                ) : (
                  data.data.map((s, idx) => {
                    const rowBorder = idx > 0 ? 'border-t border-[var(--border-subtle)]' : '';
                    return (
                      <tr key={String(s.nis)} className="transition-colors hover:bg-[var(--bg-elevated)]/65">
                        <td className={`${rowBorder} px-[var(--table-cell-px)] py-[var(--table-cell-py)]`}>
                          <Link
                            className="font-medium text-[var(--text-primary)] underline decoration-[var(--border-subtle)] underline-offset-2 hover:decoration-[var(--text-primary)]"
                            href={`/siswa/${encodeURIComponent(String(s.nis))}`}
                          >
                            {String(s.nama)}
                          </Link>
                        </td>
                        <td className={`${rowBorder} whitespace-nowrap px-[var(--table-cell-px)] py-[var(--table-cell-py)] font-mono text-xs text-[var(--text-primary)]`}>
                          {String(s.nis)}
                        </td>
                        <td className={`${rowBorder} whitespace-nowrap px-[var(--table-cell-px)] py-[var(--table-cell-py)] font-mono text-xs text-[var(--text-secondary)]`}>
                          {String(s.nisn ?? '—')}
                        </td>
                        <td className={`${rowBorder} whitespace-nowrap px-[var(--table-cell-px)] py-[var(--table-cell-py)] text-[var(--text-primary)]`}>
                          {String(s.kelas ?? s.kelas_kode ?? '—')}
                        </td>
                        <td className={`${rowBorder} whitespace-nowrap px-[var(--table-cell-px)] py-[var(--table-cell-py)] text-[var(--text-secondary)]`}>
                          {String(s.jenis_kelamin ?? '—')}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button
              type="button"
              className="btn-ghost"
              disabled={loading || page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Sebelumnya
            </button>
            <span className="text-[var(--text-secondary)]">
              Halaman <strong className="text-[var(--text-primary)]">{page}</strong> dari {pages} ({total} siswa)
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

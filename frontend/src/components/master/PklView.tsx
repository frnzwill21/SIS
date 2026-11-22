'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, Briefcase, CheckCircle2, Clock, RotateCcw, Search, Users } from 'lucide-react';
import { Row } from '@/lib/api';
import { useLoad, Status } from '@/components/useLoad';

type PenempatanResponse = {
  data: Row[];
  meta: { page: number; page_size: number; total: number };
  summary: { total: number; sesi1: number; sesi2: number; selesai: number; berlangsung: number };
};

const JURUSAN_OPTIONS = ['RPL', 'DKV', 'TITL', 'TOI', 'TAV'] as const;

export default function PklView() {
  const [tab, setTab] = useState<'penempatan' | 'perusahaan'>('penempatan');

  // Filter & paginasi Penempatan
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [kelas, setKelas] = useState('');
  const [sesi, setSesi] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Filter Perusahaan
  const [perQ, setPerQ] = useState('');
  const [debouncedPerQ, setDebouncedPerQ] = useState('');
  const [jurusan, setJurusan] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedPerQ(perQ.trim());
    }, 300);
    return () => clearTimeout(t);
  }, [perQ]);

  const kl = useLoad<{ data: Row[] }>('/kelas');

  const penParams = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  if (debouncedQ) penParams.set('q', debouncedQ);
  if (kelas) penParams.set('kelas', kelas);
  if (sesi) penParams.set('sesi', String(sesi));
  if (statusFilter) penParams.set('status', statusFilter);

  const pen = useLoad<PenempatanResponse>(
    tab === 'penempatan' ? `/pkl/penempatan?${penParams.toString()}` : null
  );

  const perParams = new URLSearchParams();
  if (debouncedPerQ) perParams.set('q', debouncedPerQ);
  if (jurusan) perParams.set('jurusan', jurusan);
  const perQueryStr = perParams.toString();

  const per = useLoad<{ data: Row[] }>(
    tab === 'perusahaan' ? `/pkl/perusahaan${perQueryStr ? `?${perQueryStr}` : ''}` : null
  );

  const cur = tab === 'penempatan' ? pen : per;
  const total = pen.data?.meta.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const summary = pen.data?.summary;
  const startIdx = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIdx = Math.min(page * pageSize, total);
  const hasPenFilters = Boolean(q.trim() || kelas || sesi || statusFilter);
  const hasPerFilters = Boolean(perQ.trim() || jurusan);

  function resetPenempatanFilters() {
    setQ('');
    setDebouncedQ('');
    setKelas('');
    setSesi(0);
    setStatusFilter('');
    setPage(1);
  }

  function lihatSiswaPerusahaan(namaPerusahaan: string) {
    setKelas('');
    setSesi(0);
    setStatusFilter('');
    setQ(namaPerusahaan);
    setDebouncedQ(namaPerusahaan);
    setPage(1);
    setTab('penempatan');
  }

  return (
    <div className="space-y-4">
      {/* Sub-tab Penempatan vs Perusahaan */}
      <div
        role="tablist"
        aria-label="Bagian Data PKL"
        className="flex flex-nowrap items-center gap-1 overflow-x-auto overscroll-x-contain border-b border-[var(--border-subtle)]"
      >
        <button
          type="button"
          id="pkl-tab-penempatan"
          role="tab"
          aria-selected={tab === 'penempatan'}
          onClick={() => setTab('penempatan')}
          className={`relative flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-2.5 text-sm transition-colors ${
            tab === 'penempatan'
              ? 'font-semibold text-[var(--text-primary)]'
              : 'font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          <Users className="h-4 w-4 shrink-0" />
          <span>Penempatan Siswa</span>
          {tab === 'penempatan' && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-[2.5px] bg-[var(--accent-ink)]"
            />
          )}
        </button>

        <button
          type="button"
          id="pkl-tab-perusahaan"
          role="tab"
          aria-selected={tab === 'perusahaan'}
          onClick={() => setTab('perusahaan')}
          className={`relative flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-2.5 text-sm transition-colors ${
            tab === 'perusahaan'
              ? 'font-semibold text-[var(--text-primary)]'
              : 'font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          <Building2 className="h-4 w-4 shrink-0" />
          <span>Perusahaan Mitra</span>
          {tab === 'perusahaan' && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-[2.5px] bg-[var(--accent-ink)]"
            />
          )}
        </button>
      </div>

      {/* PANEL PENEMPATAN */}
      {tab === 'penempatan' && (
        <div role="tabpanel" aria-labelledby="pkl-tab-penempatan" className="space-y-4">
          {/* KPI Summary Bar */}
          {summary && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="card flex items-center gap-3 p-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)]">
                  <Briefcase className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">
                    Total Penempatan
                  </p>
                  <p className="text-lg font-bold text-[var(--text-primary)]">{summary.total}</p>
                </div>
              </div>

              <div className="card flex items-center gap-3 p-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)]">
                  <Users className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">
                    Sesi 1 / Sesi 2
                  </p>
                  <p className="text-lg font-bold text-[var(--text-primary)]">
                    {summary.sesi1} <span className="text-sm font-normal text-[var(--text-secondary)]">/</span>{' '}
                    {summary.sesi2}
                  </p>
                </div>
              </div>

              <div className="card flex items-center gap-3 p-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">
                    Selesai
                  </p>
                  <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{summary.selesai}</p>
                </div>
              </div>

              <div className="card flex items-center gap-3 p-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <Clock className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">
                    Berlangsung
                  </p>
                  <p className="text-lg font-bold text-amber-700 dark:text-amber-400">{summary.berlangsung}</p>
                </div>
              </div>
            </div>
          )}

          {/* Toolbar Pencarian & Filter */}
          <div className="card grid grid-cols-1 gap-2.5 p-3.5 sm:grid-cols-2 lg:grid-cols-12">
            <div className="relative lg:col-span-4">
              <label htmlFor="pkl-penempatan-search" className="sr-only">
                Cari penempatan PKL berdasarkan nama, NIS, perusahaan, atau posisi
              </label>
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-secondary)]" />
              <input
                id="pkl-penempatan-search"
                name="pkl_q"
                type="search"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                className="input !pl-9"
                placeholder="Cari nama, NIS, perusahaan, posisi…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>

            <label htmlFor="pkl-kelas-filter" className="sr-only">
              Filter kelas
            </label>
            <select
              id="pkl-kelas-filter"
              name="kelas"
              className="input select-branded lg:col-span-2"
              value={kelas}
              onChange={(e) => {
                setKelas(e.target.value);
                setPage(1);
              }}
              disabled={kl.loading && !kl.data}
            >
              <option value="">Semua kelas</option>
              {kl.data?.data.map((k) => (
                <option key={String(k.kode)} value={String(k.kode)}>
                  {String(k.nama)}
                </option>
              ))}
            </select>

            <label htmlFor="pkl-sesi-filter" className="sr-only">
              Filter sesi PKL
            </label>
            <select
              id="pkl-sesi-filter"
              name="sesi"
              className="input select-branded lg:col-span-2"
              value={sesi}
              onChange={(e) => {
                setSesi(Number(e.target.value));
                setPage(1);
              }}
            >
              <option value={0}>Semua sesi</option>
              <option value={1}>Sesi 1</option>
              <option value={2}>Sesi 2</option>
            </select>

            <label htmlFor="pkl-status-filter" className="sr-only">
              Filter status PKL
            </label>
            <select
              id="pkl-status-filter"
              name="status"
              className="input select-branded lg:col-span-2"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Semua status</option>
              <option value="Sedang berlangsung">Sedang berlangsung</option>
              <option value="Selesai">Selesai</option>
            </select>

            <div className="flex items-center gap-2 lg:col-span-2">
              <label htmlFor="pkl-page-size" className="sr-only">
                Baris per halaman
              </label>
              <select
                id="pkl-page-size"
                name="page_size"
                className="input select-branded"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
              >
                <option value={25}>25 / hal</option>
                <option value={50}>50 / hal</option>
                <option value={100}>100 / hal</option>
              </select>

              {hasPenFilters && (
                <button
                  type="button"
                  onClick={resetPenempatanFilters}
                  className="btn-ghost inline-flex shrink-0 items-center gap-1 px-2.5 py-2 text-xs"
                  title="Reset semua filter"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span className="sr-only sm:not-sr-only">Reset</span>
                </button>
              )}
            </div>
          </div>

          {kl.error && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
              Daftar filter kelas gagal dimuat: {kl.error}
            </p>
          )}

          <Status loading={pen.loading} error={pen.error} />

          {!pen.loading && !pen.error && pen.data != null && (
            <>
              <div
                tabIndex={0}
                role="region"
                aria-label="Tabel penempatan PKL siswa"
                className="max-h-[60vh] overflow-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-sm"
              >
                <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-[var(--bg-elevated)] text-xs uppercase tracking-wide text-[var(--text-secondary)]">
                    <tr>
                      <th className="whitespace-nowrap border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]">NIS</th>
                      <th className="whitespace-nowrap border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]">
                        Nama Siswa
                      </th>
                      <th className="whitespace-nowrap border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]">Kelas</th>
                      <th className="whitespace-nowrap border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]">
                        Perusahaan
                      </th>
                      <th className="whitespace-nowrap border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]">Posisi</th>
                      <th className="whitespace-nowrap border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)] text-center">
                        Sesi
                      </th>
                      <th className="whitespace-nowrap border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pen.data.data.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-[var(--text-secondary)]">
                          Tidak ada data penempatan PKL yang cocok dengan filter saat ini.
                        </td>
                      </tr>
                    ) : (
                      pen.data.data.map((r, idx) => {
                        const statusText = String(r.status ?? '-');
                        const isSelesai = statusText.toLowerCase() === 'selesai';
                        const perusahaanText = String(r.perusahaan ?? '-');
                        const posisiText = String(r.posisi ?? '-');
                        return (
                          <tr
                            key={`${String(r.nis)}-${String(r.sesi ?? '')}-${idx}`}
                            className="transition-colors hover:bg-[var(--bg-elevated)]/65"
                          >
                            <td className="whitespace-nowrap border-t border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-cell-py)] font-mono text-xs text-[var(--text-secondary)]">
                              {String(r.nis)}
                            </td>
                            <td className="whitespace-nowrap border-t border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-cell-py)] font-medium">
                              <Link
                                className="text-[var(--text-primary)] underline decoration-[var(--border-subtle)] underline-offset-2 hover:decoration-[var(--text-primary)]"
                                href={`/siswa/${encodeURIComponent(String(r.nis))}`}
                              >
                                {String(r.nama)}
                              </Link>
                            </td>
                            <td className="whitespace-nowrap border-t border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-cell-py)] text-[var(--text-secondary)]">
                              {String(r.kelas ?? '-')}
                            </td>
                            <td
                              className="max-w-[240px] truncate border-t border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-cell-py)] text-[var(--text-primary)]"
                              title={perusahaanText}
                            >
                              {perusahaanText}
                            </td>
                            <td
                              className="max-w-[200px] truncate border-t border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-cell-py)] text-[var(--text-secondary)]"
                              title={posisiText}
                            >
                              {posisiText}
                            </td>
                            <td className="whitespace-nowrap border-t border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-cell-py)] text-center">
                              <span className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-0.5 text-xs font-semibold text-[var(--text-primary)]">
                                Sesi {String(r.sesi ?? '-')}
                              </span>
                            </td>
                            <td className="whitespace-nowrap border-t border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-cell-py)]">
                              <span
                                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                                  isSelesai
                                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                    : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                                }`}
                              >
                                {statusText}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Footer Paginasi */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--text-secondary)]">
                <span>
                  Menampilkan <strong className="text-[var(--text-primary)]">{startIdx}–{endIdx}</strong> dari{' '}
                  <strong className="text-[var(--text-primary)]">{total}</strong> penempatan
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={pen.loading || page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Sebelumnya
                  </button>
                  <span className="text-xs sm:text-sm">
                    Halaman <strong className="text-[var(--text-primary)]">{page}</strong> / {pages}
                  </span>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={pen.loading || page >= pages}
                    onClick={() => setPage((p) => Math.min(pages, p + 1))}
                  >
                    Berikutnya
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* PANEL PERUSAHAAN */}
      {tab === 'perusahaan' && (
        <div role="tabpanel" aria-labelledby="pkl-tab-perusahaan" className="space-y-4">
          <div className="card flex flex-wrap items-center gap-2.5 p-3.5">
            <div className="relative min-w-[220px] max-w-md flex-1">
              <label htmlFor="pkl-perusahaan-search" className="sr-only">
                Cari perusahaan mitra PKL, bidang usaha, kota, atau posisi
              </label>
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-secondary)]" />
              <input
                id="pkl-perusahaan-search"
                name="perusahaan_q"
                type="search"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                className="input !pl-9"
                placeholder="Cari perusahaan, bidang usaha, kota, posisi…"
                value={perQ}
                onChange={(e) => setPerQ(e.target.value)}
              />
            </div>

            <label htmlFor="pkl-jurusan-filter" className="sr-only">
              Filter jurusan perusahaan
            </label>
            <select
              id="pkl-jurusan-filter"
              name="jurusan"
              className="input select-branded max-w-[180px]"
              value={jurusan}
              onChange={(e) => setJurusan(e.target.value)}
            >
              <option value="">Semua jurusan</option>
              {JURUSAN_OPTIONS.map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </select>

            {hasPerFilters && (
              <button
                type="button"
                onClick={() => {
                  setPerQ('');
                  setDebouncedPerQ('');
                  setJurusan('');
                }}
                className="btn-ghost inline-flex items-center gap-1 text-xs"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reset</span>
              </button>
            )}
          </div>

          <Status loading={cur.loading} error={cur.error} />

          {!per.loading && !per.error && per.data != null && (
            <div
              tabIndex={0}
              role="region"
              aria-label="Tabel perusahaan mitra PKL"
              className="max-h-[62vh] overflow-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-sm"
            >
              <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
                <thead className="sticky top-0 z-10 bg-[var(--bg-elevated)] text-xs uppercase tracking-wide text-[var(--text-secondary)]">
                  <tr>
                    <th className="whitespace-nowrap border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]">Kode</th>
                    <th className="whitespace-nowrap border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]">
                      Perusahaan
                    </th>
                    <th className="whitespace-nowrap border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]">Jurusan</th>
                    <th className="whitespace-nowrap border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]">
                      Bidang &amp; Kota
                    </th>
                    <th className="whitespace-nowrap border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)] text-center">
                      Sesi 1
                    </th>
                    <th className="whitespace-nowrap border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)] text-center">
                      Sesi 2
                    </th>
                    <th className="whitespace-nowrap border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]">
                      Posisi Tersedia
                    </th>
                    <th className="whitespace-nowrap border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)] text-right">
                      Aksi
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {per.data.data.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-[var(--text-secondary)]">
                        Tidak ada perusahaan mitra yang cocok dengan pencarian.
                      </td>
                    </tr>
                  ) : (
                    per.data.data.map((p) => {
                      const nama = String(p.nama ?? '-');
                      const terisi1 = Number(p.terisi_sesi1 ?? 0);
                      const kuota1 = Number(p.kuota_sesi1 ?? 0);
                      const terisi2 = Number(p.terisi_sesi2 ?? 0);
                      const kuota2 = Number(p.kuota_sesi2 ?? 0);
                      const posisi = String(p.posisi_tersedia ?? '-');
                      return (
                        <tr key={String(p.kode)} className="transition-colors hover:bg-[var(--bg-elevated)]/65">
                          <td className="whitespace-nowrap border-t border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-cell-py)] font-mono text-xs text-[var(--text-secondary)]">
                            {String(p.kode)}
                          </td>
                          <td className="max-w-[230px] border-t border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-cell-py)]">
                            <p className="truncate font-medium text-[var(--text-primary)]" title={nama}>
                              {nama}
                            </p>
                            {p.narahubung && (
                              <p
                                className="truncate text-xs text-[var(--text-secondary)]"
                                title={String(p.narahubung)}
                              >
                                PIC: {String(p.narahubung)}
                              </p>
                            )}
                          </td>
                          <td className="whitespace-nowrap border-t border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-cell-py)]">
                            <span className="inline-flex rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-0.5 text-xs font-semibold text-[var(--text-primary)]">
                              {String(p.jurusan_kode ?? '-')}
                            </span>
                          </td>
                          <td className="max-w-[200px] border-t border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-cell-py)]">
                            <p
                              className="truncate text-[var(--text-primary)]"
                              title={String(p.bidang_usaha ?? '-')}
                            >
                              {String(p.bidang_usaha ?? '-')}
                            </p>
                            <p className="text-xs text-[var(--text-secondary)]">{String(p.kota ?? '-')}</p>
                          </td>
                          <td className="whitespace-nowrap border-t border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-cell-py)] text-center font-mono text-xs">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 font-semibold ${
                                terisi1 >= kuota1 && kuota1 > 0
                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                  : 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                              }`}
                            >
                              {terisi1}/{kuota1}
                            </span>
                          </td>
                          <td className="whitespace-nowrap border-t border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-cell-py)] text-center font-mono text-xs">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 font-semibold ${
                                terisi2 >= kuota2 && kuota2 > 0
                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                  : 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                              }`}
                            >
                              {terisi2}/{kuota2}
                            </span>
                          </td>
                          <td
                            className="max-w-[220px] truncate border-t border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-cell-py)] text-xs text-[var(--text-secondary)]"
                            title={posisi}
                          >
                            {posisi}
                          </td>
                          <td className="whitespace-nowrap border-t border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-cell-py)] text-right">
                            <button
                              type="button"
                              onClick={() => lihatSiswaPerusahaan(nama)}
                              className="btn-ghost text-xs"
                            >
                              Lihat Siswa
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

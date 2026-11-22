'use client';

import { useMemo, useState } from 'react';
import { Calendar, Clock, LayoutGrid, List, RotateCcw, Search, UserCheck, Users, X } from 'lucide-react';
import { Row } from '@/lib/api';
import { useLoad, Status } from '@/components/useLoad';

type ViewMode = 'tabel' | 'kartu';

const HARI_OPTIONS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'] as const;

function cleanText(val: unknown, fallback = '—'): string {
  if (val === null || val === undefined) return fallback;
  const s = String(val).trim();
  return !s || s === '-' ? fallback : s;
}

export default function EkskulView() {
  const { data, error, loading } = useLoad<{ data: Row[] }>('/ekskul');
  const [q, setQ] = useState('');
  const [hariFilter, setHariFilter] = useState('');
  const [view, setView] = useState<ViewMode>('tabel');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const rows = data?.data ?? [];

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const day = hariFilter.trim().toLowerCase();
    return rows.filter((item) => {
      if (day && !String(item.hari ?? '').toLowerCase().includes(day)) {
        return false;
      }
      if (!query) return true;
      const hay = [
        item.kode,
        item.nama,
        item.deskripsi,
        item.hari,
        item.waktu,
        item.pembina,
        item.ketua,
      ]
        .map((v) => String(v ?? '').toLowerCase())
        .join(' ');
      return hay.includes(query);
    });
  }, [rows, q, hariFilter]);

  const hasFilters = Boolean(q.trim() || hariFilter);

  function toggleExpand(kode: string) {
    setExpanded((prev) => ({ ...prev, [kode]: !prev[kode] }));
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--text-secondary)]">
        Daftar kegiatan ekstrakurikuler, jadwal latihan, pembina, dan ketua aktif SMKN 4 Bandung.
      </p>

      {/* Toolbar Pencarian, Filter Hari & Toggle Tampilan */}
      <div className="card flex flex-col gap-3 p-3.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <label htmlFor="ekskul-search" className="sr-only">
              Cari kegiatan ekstrakurikuler
            </label>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
            />
            <input
              id="ekskul-search"
              name="q"
              type="search"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari nama ekskul, kode, pembina, atau ketua…"
              className={`input pl-9 [&::-webkit-search-cancel-button]:appearance-none ${q ? 'pr-9' : ''}`}
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ('')}
                aria-label="Hapus pencarian ekstrakurikuler"
                className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <label htmlFor="ekskul-hari-filter" className="sr-only">
            Filter hari latihan
          </label>
          <select
            id="ekskul-hari-filter"
            name="hari"
            value={hariFilter}
            onChange={(e) => setHariFilter(e.target.value)}
            className="input select-branded w-full sm:w-44"
          >
            <option value="">Semua hari</option>
            {HARI_OPTIONS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>

          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setQ('');
                setHariFilter('');
              }}
              className="btn-ghost inline-flex shrink-0 items-center gap-1.5 text-xs"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reset</span>
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 lg:justify-end">
          {!loading && !error && data != null && (
            <span className="text-xs tabular-nums text-[var(--text-secondary)]">
              {hasFilters ? `${filtered.length} dari ${rows.length} ekskul` : `${rows.length} ekskul`}
            </span>
          )}

          <div
            role="group"
            aria-label="Mode tampilan"
            className="inline-flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-0.5"
          >
            <button
              type="button"
              aria-pressed={view === 'tabel'}
              onClick={() => setView('tabel')}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                view === 'tabel'
                  ? 'bg-[var(--accent-ink)] text-[var(--accent-ink-fg)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <List className="h-3.5 w-3.5" />
              <span>Tabel</span>
            </button>
            <button
              type="button"
              aria-pressed={view === 'kartu'}
              onClick={() => setView('kartu')}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                view === 'kartu'
                  ? 'bg-[var(--accent-ink)] text-[var(--accent-ink-fg)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span>Kartu Ringkas</span>
            </button>
          </div>
        </div>
      </div>

      <Status loading={loading} error={error} />

      {!loading && !error && data != null && (
        filtered.length === 0 ? (
          <div className="card space-y-2 py-10 text-center">
            <p className="text-sm text-[var(--text-secondary)]">
              Tidak ada kegiatan ekstrakurikuler yang cocok dengan filter saat ini.
            </p>
            {hasFilters && (
              <button
                type="button"
                onClick={() => {
                  setQ('');
                  setHariFilter('');
                }}
                className="btn-ghost text-xs"
              >
                Tampilkan semua ekstrakurikuler
              </button>
            )}
          </div>
        ) : view === 'tabel' ? (
          <div
            role="region"
            tabIndex={0}
            aria-label="Tabel kegiatan ekstrakurikuler"
            className="max-h-[68vh] overflow-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ink)]/30"
          >
            <table className="min-w-[620px] w-full border-separate border-spacing-0 text-left text-sm md:min-w-full md:table-fixed">
              <colgroup>
                <col className="md:w-[46%]" />
                <col className="md:w-[27%]" />
                <col className="md:w-[27%]" />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-[var(--bg-elevated)] text-xs font-semibold tracking-tight text-[var(--text-secondary)]">
                <tr>
                  <th
                    scope="col"
                    className="border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]"
                  >
                    Kegiatan Ekstrakurikuler
                  </th>
                  <th
                    scope="col"
                    className="border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]"
                  >
                    Jadwal Latihan
                  </th>
                  <th
                    scope="col"
                    className="border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]"
                  >
                    Pembina &amp; Ketua
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, idx) => {
                  const kode = cleanText(item.kode, `row-${idx}`);
                  const nama = cleanText(item.nama);
                  const deskripsi = cleanText(item.deskripsi, '');
                  const hari = cleanText(item.hari);
                  const waktu = cleanText(item.waktu);
                  const pembina = cleanText(item.pembina);
                  const ketua = cleanText(item.ketua);
                  const isExpanded = Boolean(expanded[kode]);
                  const canExpand = deskripsi.length > 80;
                  const topBorder = idx > 0 ? 'border-t border-[var(--border-subtle)]' : '';

                  return (
                    <tr key={kode} className="align-top transition-colors hover:bg-[var(--bg-elevated)]/55">
                      <td className={`${topBorder} px-[var(--table-cell-px)] py-3`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-[var(--text-primary)]">{nama}</span>
                          <span className="inline-flex items-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[11px] font-medium tabular-nums text-[var(--text-secondary)]">
                            {kode}
                          </span>
                        </div>
                        {deskripsi && (
                          <div className="mt-1.5">
                            <p
                              className={`text-xs leading-relaxed text-[var(--text-secondary)] ${
                                isExpanded ? '' : 'line-clamp-2'
                              }`}
                            >
                              {deskripsi}
                            </p>
                            {canExpand && (
                              <button
                                type="button"
                                aria-expanded={isExpanded}
                                onClick={() => toggleExpand(kode)}
                                className="mt-1 text-xs font-medium text-[var(--text-primary)] underline decoration-[var(--border-subtle)] underline-offset-2 transition-colors hover:decoration-[var(--text-primary)]"
                              >
                                {isExpanded ? 'Ringkas' : 'Selengkapnya'}
                              </button>
                            )}
                          </div>
                        )}
                      </td>

                      <td className={`${topBorder} px-[var(--table-cell-px)] py-3`}>
                        <div className="flex flex-col items-start gap-1.5">
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-0.5 text-xs font-medium text-[var(--text-primary)]">
                            <Calendar aria-hidden="true" className="h-3 w-3 shrink-0 text-[var(--text-secondary)]" />
                            <span>{hari}</span>
                          </span>
                          <span className="inline-flex items-center gap-1.5 text-xs tabular-nums text-[var(--text-secondary)]">
                            <Clock aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                            <span>{waktu}</span>
                          </span>
                        </div>
                      </td>

                      <td className={`${topBorder} px-[var(--table-cell-px)] py-3`}>
                        <div className="space-y-1">
                          <p className="font-semibold text-[var(--text-primary)]">{pembina}</p>
                          <p className="text-xs text-[var(--text-secondary)]">
                            Ketua: <span className="font-medium text-[var(--text-primary)]">{ketua}</span>
                          </p>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((item, idx) => {
              const kode = cleanText(item.kode, `card-${idx}`);
              const nama = cleanText(item.nama);
              const deskripsi = cleanText(item.deskripsi, '');
              const hari = cleanText(item.hari);
              const waktu = cleanText(item.waktu);
              const pembina = cleanText(item.pembina);
              const ketua = cleanText(item.ketua);
              const isExpanded = Boolean(expanded[kode]);
              const canExpand = deskripsi.length > 96;

              return (
                <article
                  key={kode}
                  className="card flex flex-col justify-between gap-4 p-4 transition-colors hover:border-[var(--text-muted)]"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="text-base font-semibold leading-snug text-[var(--text-primary)]">
                        {nama}
                      </h2>
                      <span className="inline-flex shrink-0 items-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums text-[var(--text-secondary)]">
                        {kode}
                      </span>
                    </div>

                    {deskripsi && (
                      <div>
                        <p
                          className={`text-xs leading-relaxed text-[var(--text-secondary)] ${
                            isExpanded ? '' : 'line-clamp-2'
                          }`}
                        >
                          {deskripsi}
                        </p>
                        {canExpand && (
                          <button
                            type="button"
                            aria-expanded={isExpanded}
                            onClick={() => toggleExpand(kode)}
                            className="mt-1 text-xs font-medium text-[var(--text-primary)] underline decoration-[var(--border-subtle)] underline-offset-2 hover:decoration-[var(--text-primary)]"
                          >
                            {isExpanded ? 'Ringkas' : 'Selengkapnya'}
                          </button>
                        )}
                      </div>
                    )}

                    <div className="flex flex-col items-start gap-1.5 pt-0.5">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-0.5 text-xs font-medium text-[var(--text-primary)]">
                        <Calendar aria-hidden="true" className="h-3 w-3 shrink-0 text-[var(--text-secondary)]" />
                        <span>{hari}</span>
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-xs tabular-nums text-[var(--text-secondary)]">
                        <Clock aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                        <span>{waktu}</span>
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1 border-t border-[var(--border-subtle)] pt-3 text-xs">
                    <div className="flex items-center gap-1.5 text-[var(--text-primary)]">
                      <UserCheck aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                      <span className="font-semibold">{pembina}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                      <Users aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                      <span>
                        Ketua: <span className="font-medium text-[var(--text-primary)]">{ketua}</span>
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';
import { Row } from '@/lib/api';
import DataTable from '@/components/DataTable';
import { useLoad, Status } from '@/components/useLoad';

export default function GuruView() {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [selected, setSelected] = useState<{ nip: string; nama: string } | null>(null);
  const scheduleRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (selected) {
      scheduleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selected]);

  const guruList = useLoad<{ data: Row[] }>(`/guru?q=${encodeURIComponent(debouncedQ)}`);
  const jadwal = useLoad<{ data: Row[] }>(
    selected ? `/guru/${encodeURIComponent(selected.nip)}/jadwal` : null
  );

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--text-secondary)]">
        Cari nama guru lalu pilih salah satu untuk melihat jadwal mengajarnya di kelas XII.
      </p>

      <div>
        <label htmlFor="guru-search" className="sr-only">
          Cari nama guru
        </label>
        <input
          id="guru-search"
          name="q"
          type="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          className="input max-w-sm"
          placeholder="Cari nama guru (mis. Ina, Budi)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <Status loading={guruList.loading} error={guruList.error} />

      {!guruList.loading && !guruList.error && guruList.data != null && (
        <div
          tabIndex={0}
          role="region"
          aria-label="Tabel daftar guru"
          className="overflow-x-auto overscroll-x-contain rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ink)]/30"
        >
          <table className="min-w-full border-separate border-spacing-0 text-left text-sm tabular-nums">
            <thead className="sticky top-0 z-10 bg-[var(--bg-elevated)] text-xs uppercase tracking-wide text-[var(--text-secondary)]">
              <tr>
                <th scope="col" className="border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]">NIP</th>
                <th scope="col" className="border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]">Nama Guru</th>
                <th scope="col" className="border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)] text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {guruList.data.data.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-8 text-center text-[var(--text-secondary)]">
                    Tidak ada guru yang cocok dengan pencarian.
                  </td>
                </tr>
              ) : (
                guruList.data.data.map((g, idx) => {
                  const nip = String(g.nip);
                  const nama = String(g.nama);
                  const isSelected = selected?.nip === nip;
                  const rowBorder = idx > 0 ? 'border-t border-[var(--border-subtle)]' : '';
                  return (
                    <tr
                      key={nip}
                      className={`transition-colors ${
                        isSelected ? 'bg-[var(--bg-elevated)]' : 'hover:bg-[var(--bg-elevated)]/65'
                      }`}
                    >
                      <td className={`${rowBorder} whitespace-nowrap px-[var(--table-cell-px)] py-[var(--table-cell-py)] font-mono text-xs text-[var(--text-secondary)]`}>
                        {nip}
                      </td>
                      <td className={`${rowBorder} px-[var(--table-cell-px)] py-[var(--table-cell-py)] font-medium text-[var(--text-primary)]`}>
                        {nama}
                      </td>
                      <td className={`${rowBorder} whitespace-nowrap px-[var(--table-cell-px)] py-[var(--table-cell-py)] text-right`}>
                        <button
                          type="button"
                          className={isSelected ? 'btn text-xs' : 'btn-ghost text-xs'}
                          onClick={() => setSelected({ nip, nama })}
                        >
                          {isSelected ? 'Sedang dilihat' : 'Lihat Jadwal'}
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

      {selected && (
        <section ref={scheduleRef} className="card space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                Jadwal Mengajar — {selected.nama}
              </h2>
              <p className="font-mono text-xs text-[var(--text-secondary)]">NIP: {selected.nip}</p>
            </div>
            <button type="button" className="btn-ghost text-xs" onClick={() => setSelected(null)}>
              Tutup
            </button>
          </div>
          <Status loading={jadwal.loading} error={jadwal.error} />
          {!jadwal.loading && !jadwal.error && jadwal.data != null && (
            <DataTable
              rows={jadwal.data.data}
              empty="Guru ini tidak memiliki jadwal mengajar di kelas XII."
            />
          )}
        </section>
      )}
    </div>
  );
}

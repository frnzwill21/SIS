'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Row } from '@/lib/api';
import DataTable from '@/components/DataTable';
import { useLoad, Status } from '@/components/useLoad';

export default function KelasView() {
  const [sel, setSel] = useState('');
  const [hari, setHari] = useState('');
  const list = useLoad<{ data: Row[] }>('/kelas');
  const jadwal = useLoad<{ data: Row[] }>(
    sel ? `/kelas/${encodeURIComponent(sel)}/jadwal?hari=${encodeURIComponent(hari)}` : null
  );
  const siswa = useLoad<{ data: Row[] }>(sel ? `/kelas/${encodeURIComponent(sel)}/siswa` : null);

  const selectedKelasRow = list.data?.data.find((k) => String(k.kode) === sel);
  const selectedLabel = selectedKelasRow ? String(selectedKelasRow.nama) : sel;

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--text-secondary)]">
        Klik baris kelas di bawah atau gunakan filter dropdown untuk melihat jadwal pelajaran dan daftar siswa.
      </p>
      <Status loading={list.loading} error={list.error} />
      {!list.loading && !list.error && list.data != null && (
        <div
          tabIndex={0}
          role="region"
          aria-label="Tabel daftar kelas XII"
          className="overflow-x-auto overscroll-x-contain rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ink)]/30"
        >
          <table className="min-w-full border-separate border-spacing-0 text-left text-sm tabular-nums">
            <thead className="bg-[var(--bg-elevated)] text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              <tr>
                <th scope="col" className="w-[18%] whitespace-nowrap border-b border-[var(--border-subtle)] px-4 py-3">
                  Kelas
                </th>
                <th scope="col" className="w-[13%] whitespace-nowrap border-b border-[var(--border-subtle)] px-4 py-3">
                  Jurusan
                </th>
                <th scope="col" className="w-[17%] whitespace-nowrap border-b border-[var(--border-subtle)] px-4 py-3">
                  Tahun Ajaran
                </th>
                <th scope="col" className="min-w-[12rem] border-b border-[var(--border-subtle)] px-4 py-3">
                  Wali Kelas
                </th>
                <th scope="col" className="w-[10%] whitespace-nowrap border-b border-[var(--border-subtle)] px-4 py-3 text-right">
                  Siswa
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data.data.map((k, idx) => {
                const kode = String(k.kode);
                const active = sel === kode;
                const rowBorder = idx > 0 ? 'border-t border-[var(--border-subtle)]' : '';
                return (
                  <tr
                    key={kode}
                    onClick={() => setSel(kode)}
                    className={`cursor-pointer transition-colors ${
                      active
                        ? 'bg-[var(--bg-elevated)] font-medium text-[var(--text-primary)]'
                        : 'hover:bg-[var(--bg-elevated)]/65'
                    }`}
                  >
                    <td className={`${rowBorder} whitespace-nowrap px-4 py-3 font-medium text-[var(--text-primary)]`}>
                      {String(k.nama)}
                    </td>
                    <td className={`${rowBorder} whitespace-nowrap px-4 py-3 text-[var(--text-primary)]`}>
                      {String(k.jurusan_kode ?? '-')}
                    </td>
                    <td className={`${rowBorder} whitespace-nowrap px-4 py-3 text-[var(--text-secondary)]`}>
                      {String(k.tahun_ajaran ?? '-')}
                    </td>
                    <td className={`${rowBorder} min-w-[12rem] whitespace-normal px-4 py-3 leading-snug text-[var(--text-primary)]`}>
                      {String(k.wali_kelas ?? '-')}
                    </td>
                    <td className={`${rowBorder} whitespace-nowrap px-4 py-3 text-right font-mono text-xs tabular-nums text-[var(--text-primary)]`}>
                      {String(k.jumlah_siswa ?? 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <label htmlFor="kelas-select" className="sr-only">
          Pilih kelas
        </label>
        <select
          id="kelas-select"
          name="kelas"
          className="input select-branded max-w-xs"
          value={sel}
          onChange={(e) => {
            setSel(e.target.value);
            if (!e.target.value) setHari('');
          }}
        >
          <option value="">Pilih kelas…</option>
          {list.data?.data.map((k) => (
            <option key={String(k.kode)} value={String(k.kode)}>
              {String(k.nama)}
            </option>
          ))}
        </select>
        <label htmlFor="kelas-hari-filter" className="sr-only">
          Filter hari jadwal pelajaran
        </label>
        <select
          id="kelas-hari-filter"
          name="hari"
          className="input select-branded max-w-xs"
          value={hari}
          onChange={(e) => setHari(e.target.value)}
          disabled={!sel}
          title={!sel ? 'Pilih kelas terlebih dahulu' : undefined}
        >
          <option value="">Semua hari</option>
          {['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'].map((h) => (
            <option key={h}>{h}</option>
          ))}
        </select>
      </div>
      {sel && (
        <>
          <h2 className="font-semibold text-[var(--text-primary)]">
            Jadwal — {selectedLabel}
            {hari ? ` (${hari})` : ''}
          </h2>
          <Status loading={jadwal.loading} error={jadwal.error} />
          {!jadwal.loading && !jadwal.error && jadwal.data != null && <DataTable rows={jadwal.data.data} />}

          <h2 className="font-semibold text-[var(--text-primary)]">Daftar siswa — {selectedLabel}</h2>
          <Status loading={siswa.loading} error={siswa.error} />
          {!siswa.loading && !siswa.error && siswa.data != null && (
            siswa.data.data.length ? (
              <div
                tabIndex={0}
                role="region"
                aria-label={`Tabel daftar siswa ${selectedLabel}`}
                className="overflow-x-auto overscroll-x-contain rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ink)]/30"
              >
                <table className="min-w-full border-separate border-spacing-0 text-left text-sm tabular-nums">
                  <thead className="sticky top-0 z-10 bg-[var(--bg-elevated)] text-xs uppercase tracking-wide text-[var(--text-secondary)]">
                    <tr>
                      <th scope="col" className="border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]">No</th>
                      <th scope="col" className="border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]">Nama</th>
                      <th scope="col" className="border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]">NIS</th>
                      <th scope="col" className="border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]">NISN</th>
                      <th scope="col" className="border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]">JK</th>
                    </tr>
                  </thead>
                  <tbody>
                    {siswa.data.data.map((s, idx) => {
                      const rowBorder = idx > 0 ? 'border-t border-[var(--border-subtle)]' : '';
                      return (
                        <tr key={String(s.nis)} className="transition-colors hover:bg-[var(--bg-elevated)]/65">
                          <td className={`${rowBorder} whitespace-nowrap px-[var(--table-cell-px)] py-[var(--table-cell-py)] text-[var(--text-secondary)]`}>
                            {String(s.no_absen ?? '—')}
                          </td>
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
                          <td className={`${rowBorder} whitespace-nowrap px-[var(--table-cell-px)] py-[var(--table-cell-py)] text-[var(--text-secondary)]`}>
                            {String(s.jenis_kelamin ?? '—')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-[var(--text-secondary)]">Tidak ada data siswa.</p>
            )
          )}
        </>
      )}
    </div>
  );
}

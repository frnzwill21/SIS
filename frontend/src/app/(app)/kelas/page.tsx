'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Row } from '@/lib/api';
import DataTable from '@/components/DataTable';
import { useLoad, Status } from '@/components/useLoad';

export default function Kelas() {
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
      <p className="text-xs text-slate-500">
        Klik baris kelas di bawah atau gunakan filter dropdown untuk melihat jadwal pelajaran dan daftar siswa.
      </p>
      <Status loading={list.loading} error={list.error} />
      {!list.loading && !list.error && list.data != null && (
        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-xs uppercase text-slate-600">
              <tr>
                <th className="px-3 py-2">Kelas</th>
                <th className="px-3 py-2">Jurusan</th>
                <th className="px-3 py-2">Tahun Ajaran</th>
                <th className="px-3 py-2">Wali Kelas</th>
                <th className="px-3 py-2 text-right">Siswa</th>
              </tr>
            </thead>
            <tbody>
              {list.data.data.map((k) => {
                const kode = String(k.kode);
                const active = sel === kode;
                return (
                  <tr
                    key={kode}
                    onClick={() => setSel(kode)}
                    className={`cursor-pointer border-t border-slate-100 transition-colors ${
                      active ? 'bg-blue-50/70 font-medium text-blue-900' : 'hover:bg-slate-50'
                    }`}
                  >
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-blue-700">{String(k.nama)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{String(k.jurusan_kode ?? '-')}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{String(k.tahun_ajaran ?? '-')}</td>
                    <td className="whitespace-nowrap px-3 py-2">{String(k.wali_kelas ?? '-')}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{String(k.jumlah_siswa ?? 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <select
          className="input max-w-xs"
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
        <select
          className="input max-w-xs disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
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
          <h2 className="font-medium">
            Jadwal — {selectedLabel}
            {hari ? ` (${hari})` : ''}
          </h2>
          <Status loading={jadwal.loading} error={jadwal.error} />
          {!jadwal.loading && !jadwal.error && jadwal.data != null && <DataTable rows={jadwal.data.data} />}

          <h2 className="font-medium">Daftar siswa — {selectedLabel}</h2>
          <Status loading={siswa.loading} error={siswa.error} />
          {!siswa.loading && !siswa.error && siswa.data != null && (
            siswa.data.data.length ? (
              <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-100 text-xs uppercase text-slate-600">
                    <tr>
                      <th className="px-3 py-2">No</th>
                      <th className="px-3 py-2">Nama</th>
                      <th className="px-3 py-2">NIS</th>
                      <th className="px-3 py-2">NISN</th>
                      <th className="px-3 py-2">JK</th>
                    </tr>
                  </thead>
                  <tbody>
                    {siswa.data.data.map((s) => (
                      <tr key={String(s.nis)} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-1.5">{String(s.no_absen ?? '-')}</td>
                        <td className="px-3 py-1.5">
                          <Link
                            className="text-brand-700 hover:underline"
                            href={`/siswa/${encodeURIComponent(String(s.nis))}`}
                          >
                            {String(s.nama)}
                          </Link>
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs">{String(s.nis)}</td>
                        <td className="px-3 py-1.5 font-mono text-xs">{String(s.nisn ?? '-')}</td>
                        <td className="px-3 py-1.5">{String(s.jenis_kelamin ?? '-')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Tidak ada data siswa.</p>
            )
          )}
        </>
      )}
    </div>
  );
}

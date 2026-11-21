'use client';
import { useEffect, useRef, useState } from 'react';
import { Row } from '@/lib/api';
import DataTable from '@/components/DataTable';
import { useLoad, Status } from '@/components/useLoad';

export default function GuruPage() {
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
      <p className="text-xs text-slate-500">
        Cari nama guru lalu pilih salah satu untuk melihat jadwal mengajarnya di kelas XII.
      </p>

      <input
        className="input max-w-sm"
        placeholder="Cari nama guru (mis. Ina, Budi)…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <Status loading={guruList.loading} error={guruList.error} />

      {!guruList.loading && !guruList.error && guruList.data != null && (
        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-xs uppercase text-slate-600">
              <tr>
                <th className="px-3 py-2">NIP</th>
                <th className="px-3 py-2">Nama Guru</th>
                <th className="px-3 py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {guruList.data.data.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-slate-500">
                    Tidak ada guru yang cocok dengan pencarian.
                  </td>
                </tr>
              ) : (
                guruList.data.data.map((g) => {
                  const nip = String(g.nip);
                  const nama = String(g.nama);
                  const isSelected = selected?.nip === nip;
                  return (
                    <tr
                      key={nip}
                      className={`border-t border-slate-100 ${isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50'}`}
                    >
                      <td className="px-3 py-2 font-mono text-xs text-slate-600">{nip}</td>
                      <td className="px-3 py-2 font-medium text-slate-900">{nama}</td>
                      <td className="px-3 py-2 text-right">
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
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Jadwal Mengajar — {selected.nama}</h2>
              <p className="text-xs text-slate-500 font-mono">NIP: {selected.nip}</p>
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

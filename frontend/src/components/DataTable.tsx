import type { Row } from '@/lib/api';

const label = (k: string) => k.replace(/_/g, ' ');

const WRAP_COLUMNS = new Set([
  'deskripsi',
  'pertanyaan',
  'tindak_lanjut',
  'keterangan',
  'alamat',
  'catatan',
  'sanksi',
  'sanksi_disarankan',
  'jawaban',
  'alasan',
  'posisi',
]);

type TabelEngine = { kolom: string[]; baris: unknown[][] };

function formatCell(val: unknown): string {
  if (val === null || val === undefined || val === '') return '-';
  if (typeof val === 'boolean') return val ? 'Ya' : 'Tidak';
  return String(val);
}

function cellClass(colName: string, text: string): string {
  const shouldWrap = WRAP_COLUMNS.has(colName.toLowerCase()) || text.length > 60;
  return shouldWrap
    ? 'max-w-md whitespace-normal break-words px-3 py-1.5'
    : 'whitespace-nowrap px-3 py-1.5';
}

export default function DataTable({
  rows,
  empty = 'Tidak ada data.',
}: {
  rows: Row[] | TabelEngine | null | undefined;
  empty?: string;
}) {
  if (!rows) return <p className="text-sm text-slate-500">{empty}</p>;

  // Dukungan untuk format tabel dari Hybrid Query Engine: { kolom: [...], baris: [[...], ...] }
  if (!Array.isArray(rows) && 'kolom' in rows && Array.isArray(rows.kolom)) {
    if (!rows.baris?.length) return <p className="text-sm text-slate-500">{empty}</p>;
    return (
      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-100 text-xs uppercase text-slate-600">
            <tr>
              {rows.kolom.map((c, idx) => (
                <th key={idx} className="whitespace-nowrap px-3 py-2">
                  {label(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.baris.map((r, i) => (
              <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                {r.map((val, j) => {
                  const text = formatCell(val);
                  const colName = rows.kolom[j] ?? '';
                  return (
                    <td key={j} className={cellClass(colName, text)}>
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (!Array.isArray(rows) || !rows.length) return <p className="text-sm text-slate-500">{empty}</p>;
  const cols = Object.keys(rows[0]);
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-100 text-xs uppercase text-slate-600">
          <tr>
            {cols.map((c) => (
              <th key={c} className="whitespace-nowrap px-3 py-2">
                {label(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
              {cols.map((c) => {
                const text = formatCell(r[c]);
                return (
                  <td key={c} className={cellClass(c, text)}>
                    {text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

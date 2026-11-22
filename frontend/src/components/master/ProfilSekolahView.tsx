'use client';
import { useLoad, Status } from '@/components/useLoad';

const SECTION_LABELS: Record<string, string> = {
  identitas_sekolah: 'Identitas Sekolah',
  sejarah: 'Sejarah',
  visi_dan_misi: 'Visi & Misi',
  program_dan_konsentrasi_keahlian: 'Program & Konsentrasi Keahlian',
  sarana_dan_fasilitas: 'Sarana & Fasilitas',
  ekstrakurikuler_dan_organisasi: 'Ekstrakurikuler & Organisasi',
  peraturan_dan_tata_tertib: 'Peraturan & Tata Tertib',
  prestasi_dan_mitra_industri: 'Prestasi & Mitra Industri',
};

function formatKey(key: string): string {
  return SECTION_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderValue(val: unknown): JSX.Element {
  if (val === null || val === undefined || val === '') {
    return <span className="text-[var(--text-secondary)]">-</span>;
  }
  if (Array.isArray(val)) {
    return (
      <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--text-primary)]">
        {val.map((item, idx) => (
          <li key={idx}>{typeof item === 'object' && item !== null ? renderValue(item) : String(item)}</li>
        ))}
      </ul>
    );
  }
  if (typeof val === 'object') {
    return (
      <dl className="space-y-2">
        {Object.entries(val as Record<string, unknown>).map(([k, v]) => (
          <div key={k} className="border-t border-[var(--border-subtle)] pt-2 first:border-0 first:pt-0">
            <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              {formatKey(k)}
            </dt>
            <dd className="mt-0.5 text-sm text-[var(--text-primary)]">{renderValue(v)}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span className="whitespace-pre-line text-sm text-[var(--text-primary)]">{String(val)}</span>;
}

export default function ProfilSekolahView() {
  const { data, error, loading } = useLoad<{ data: Record<string, unknown> }>('/sekolah/profil');
  const profil = data?.data;

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--text-secondary)]">
        Informasi resmi identitas, program keahlian, sarana, dan tata tertib SMKN 4 Bandung.
      </p>

      <Status loading={loading} error={error} />

      {!loading && !error && profil && (
        Object.keys(profil).length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)]">Data profil sekolah belum tersedia.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {Object.entries(profil).map(([sectionKey, sectionVal]) => (
              <section key={sectionKey} className="card space-y-2.5">
                <h2 className="border-b border-[var(--border-subtle)] pb-2 text-base font-semibold text-[var(--text-primary)]">
                  {formatKey(sectionKey)}
                </h2>
                {renderValue(sectionVal)}
              </section>
            ))}
          </div>
        )
      )}
    </div>
  );
}

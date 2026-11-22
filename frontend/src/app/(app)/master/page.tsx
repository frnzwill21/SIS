'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowRight,
  Briefcase,
  Building2,
  Calendar,
  FolderKanban,
  Search,
  UserCheck,
  Users,
} from 'lucide-react';
import { useLoad } from '@/components/useLoad';

type MasterRingkasan = {
  siswa: number;
  kelas: number;
  guru: number;
  penempatan_pkl: number;
  perusahaan_pkl: number;
  ekstrakurikuler: number;
  jurusan: number;
  tahun_ajaran: string;
};

const TAB_REDIRECTS: Record<string, string> = {
  siswa: '/siswa',
  kelas: '/kelas',
  guru: '/guru',
  pkl: '/pkl',
  ekskul: '/ekskul',
  profil: '/profil-sekolah',
};

type DirectoryItem = {
  key: string;
  title: string;
  href: string;
  icon: typeof Users;
  description: string;
  keywords: string;
  badge: (summary: MasterRingkasan | undefined) => string;
};

const DIRECTORY_ITEMS: DirectoryItem[] = [
  {
    key: 'siswa',
    title: 'Data Siswa',
    href: '/siswa',
    icon: Users,
    description:
      'Direktori siswa kelas XII beserta NIS/NISN, riwayat nilai rapor, rekap kehadiran, pelanggaran, dan portofolio.',
    keywords: 'siswa murid nis nisn kelas xii nilai rapor absensi',
    badge: (s) => (s ? `${s.siswa} siswa` : 'Kelas XII'),
  },
  {
    key: 'kelas',
    title: 'Kelas & Jadwal',
    href: '/kelas',
    icon: FolderKanban,
    description:
      'Daftar rombongan belajar kelas XII, konsentrasi keahlian, wali kelas, anggota rombel, dan jadwal pelajaran.',
    keywords: 'kelas rombel jadwal pelajaran wali jurusan',
    badge: (s) => (s ? `${s.kelas} kelas · ${s.jurusan} jurusan` : 'Rombel XII'),
  },
  {
    key: 'guru',
    title: 'Guru & Jadwal',
    href: '/guru',
    icon: UserCheck,
    description:
      'Direktori pendidik SMKN 4 Bandung dilengkapi pencarian NIP dan rincian jadwal mengajar di kelas XII.',
    keywords: 'guru pendidik nip jadwal mengajar mapel',
    badge: (s) => (s ? `${s.guru} guru` : 'Pendidik'),
  },
  {
    key: 'pkl',
    title: 'Penempatan PKL',
    href: '/pkl',
    icon: Briefcase,
    description:
      'Pemetaan Praktik Kerja Lapangan sesi 1 & sesi 2, posisi kerja siswa, status pelaksanaan, dan mitra industri.',
    keywords: 'pkl prakerin magang industri perusahaan mitra sesi',
    badge: (s) => (s ? `${s.penempatan_pkl} penempatan · ${s.perusahaan_pkl} mitra` : 'Mitra IDUKA'),
  },
  {
    key: 'ekskul',
    title: 'Ekstrakurikuler',
    href: '/ekskul',
    icon: Calendar,
    description:
      'Daftar kegiatan ekstrakurikuler, pembina, jadwal pertemuan, dan partisipasi keanggotaan siswa.',
    keywords: 'ekskul ekstrakurikuler organisasi pembina kegiatan',
    badge: (s) => (s ? `${s.ekstrakurikuler} ekskul` : 'Pembinaan'),
  },
  {
    key: 'profil',
    title: 'Profil Sekolah',
    href: '/profil-sekolah',
    icon: Building2,
    description:
      'Identitas resmi SMKN 4 Bandung, sejarah, visi & misi, program keahlian, sarana prasarana, dan tata tertib.',
    keywords: 'profil sekolah smkn 4 bandung visi misi tata tertib fasilitas',
    badge: () => 'Informasi Resmi',
  },
];

function MasterDirectoryContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [query, setQuery] = useState('');

  const tabParam = searchParams.get('tab');
  const redirectTarget = tabParam ? TAB_REDIRECTS[tabParam] ?? null : null;

  useEffect(() => {
    if (redirectTarget) {
      router.replace(redirectTarget);
    }
  }, [redirectTarget, router]);

  const { data, loading, error } = useLoad<{ data: MasterRingkasan }>(
    redirectTarget ? null : '/master/ringkasan'
  );
  const summary = data?.data;

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return DIRECTORY_ITEMS;
    return DIRECTORY_ITEMS.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.keywords.toLowerCase().includes(q)
    );
  }, [query]);

  if (redirectTarget) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <p className="text-sm text-[var(--text-secondary)]">Mengalihkan ke halaman data master…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">
            Pilih Daftar Data Master
          </h2>
          <p className="text-sm text-[var(--text-secondary)]">
            Telusuri data induk akademik, pendidik, kemitraan industri, dan profil resmi SMKN 4 Bandung.
          </p>
        </div>

        <div className="relative w-full sm:w-72">
          <label htmlFor="master-search" className="sr-only">
            Cari kategori data master
          </label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-secondary)]"
          />
          <input
            id="master-search"
            name="q"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari daftar data master…"
            aria-label="Cari kategori data master"
            className="input !pl-9"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-700 dark:text-amber-300">
          Ringkasan jumlah entri belum dapat dimuat ({error}). Semua menu tetap dapat dibuka.
        </div>
      )}

      {filteredItems.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center">
          <p className="text-sm text-[var(--text-secondary)]">
            Tidak ada kategori data master yang cocok dengan &ldquo;{query}&rdquo;.
          </p>
          <button
            type="button"
            onClick={() => setQuery('')}
            className="btn-ghost mt-3 text-xs"
          >
            Tampilkan semua kategori
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.key}
                href={item.href}
                className="group flex flex-col justify-between rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[var(--text-secondary)]/50 hover:shadow-md"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)]">
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]">
                      {loading && !summary ? 'Memuat…' : item.badge(summary)}
                    </span>
                  </div>

                  <h3 className="mt-4 text-base font-semibold text-[var(--text-primary)]">
                    {item.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-secondary)]">
                    {item.description}
                  </p>
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-[var(--border-subtle)] pt-3 text-xs font-medium text-[var(--text-primary)]">
                  <span>Buka daftar</span>
                  <ArrowRight className="h-4 w-4 text-[var(--text-secondary)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--text-primary)]" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function MasterPage() {
  return (
    <Suspense fallback={<p className="text-sm text-[var(--text-secondary)]">Memuat data master…</p>}>
      <MasterDirectoryContent />
    </Suspense>
  );
}

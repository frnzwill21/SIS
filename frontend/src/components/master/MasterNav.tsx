'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Users,
  FolderKanban,
  UserCheck,
  Briefcase,
  Calendar,
  Building2,
} from 'lucide-react';

export type MasterTabKey = 'siswa' | 'kelas' | 'guru' | 'pkl' | 'ekskul' | 'profil';

export const MASTER_ITEMS: {
  key: MasterTabKey;
  label: string;
  href: string;
  icon: typeof Users;
}[] = [
  { key: 'siswa', label: 'Data Siswa', href: '/siswa', icon: Users },
  { key: 'kelas', label: 'Kelas & Jadwal', href: '/kelas', icon: FolderKanban },
  { key: 'guru', label: 'Guru & Jadwal', href: '/guru', icon: UserCheck },
  { key: 'pkl', label: 'Penempatan PKL', href: '/pkl', icon: Briefcase },
  { key: 'ekskul', label: 'Ekstrakurikuler', href: '/ekskul', icon: Calendar },
  { key: 'profil', label: 'Profil Sekolah', href: '/profil-sekolah', icon: Building2 },
];

export default function MasterNav({ active }: { active: MasterTabKey }) {
  const router = useRouter();
  const current = MASTER_ITEMS.find((item) => item.key === active) ?? MASTER_ITEMS[0];
  const CurrentIcon = current.icon;

  return (
    <nav
      aria-label="Navigasi Data Master"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3 shadow-sm"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
        <Link
          href="/master"
          className="inline-flex items-center gap-1.5 font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
        >
          <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
          <span>Semua Data Master</span>
        </Link>
        <span aria-hidden="true" className="text-[var(--text-secondary)] opacity-50">
          /
        </span>
        <span className="inline-flex min-w-0 items-center gap-1.5 font-semibold text-[var(--text-primary)]">
          <CurrentIcon className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
          <span className="truncate">{current.label}</span>
        </span>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="master-quick-switch" className="sr-only">
          Pindah kategori data master
        </label>
        <select
          id="master-quick-switch"
          name="master_nav"
          value={active}
          onChange={(e) => {
            const target = MASTER_ITEMS.find((item) => item.key === e.target.value);
            if (target) router.push(target.href);
          }}
          className="input select-branded w-auto min-w-[180px] text-xs sm:text-sm"
        >
          {MASTER_ITEMS.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
    </nav>
  );
}

'use client';

import KineticConstellation from '@/components/chat/KineticConstellation';

export default function AppLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-full min-h-[240px] w-full flex-1 flex-col items-center justify-center gap-3 px-4 py-10 text-center"
    >
      <div className="inline-flex items-center gap-2.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2.5 shadow-sm">
        <KineticConstellation mode="loader" size="sm" />
        <span className="text-xs font-medium tracking-tight text-[var(--text-secondary)]">
          Memuat halaman...
        </span>
      </div>
      <progress className="sr-only" aria-label="Memuat halaman" />
    </div>
  );
}

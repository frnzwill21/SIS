'use client';

import {
  CheckCircle2,
  ChevronRight,
  HelpCircle,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import KineticConstellation, {
  ConstellationState,
} from '@/components/chat/KineticConstellation';

export type ThinkingStep = {
  langkah: number;
  kode: string;
  judul: string;
  status: 'ok' | 'klarifikasi' | 'ditolak' | 'error';
  ringkasan: string;
  detail?: string[];
  durasi_ms: number;
};

export type LiveStepperItem = {
  langkah: number;
  kode: string;
  judul: string;
  state: 'active' | 'done';
  status?: ThinkingStep['status'];
  ringkasan?: string;
  detail?: string[];
  durasi_ms?: number;
};

export const PIPELINE_STAGES = [
  {
    langkah: 1,
    kode: 'scope_guard',
    judul: 'Memahami Konteks Pertanyaan',
    activeSubtitle: 'Memeriksa kesesuaian pertanyaan dengan cakupan data sekolah…',
    phase: 'thinking' as ConstellationState,
  },
  {
    langkah: 2,
    kode: 'intent_layer',
    judul: 'Menentukan Arah Pencarian',
    activeSubtitle: 'Menangkap maksud pertanyaan dan menyiapkan informasi…',
    phase: 'thinking' as ConstellationState,
  },
  {
    langkah: 3,
    kode: 'rbac_layer',
    judul: 'Memeriksa Hak Akses',
    activeSubtitle: 'Memverifikasi izin akses Anda terhadap data…',
    phase: 'thinking' as ConstellationState,
  },
  {
    langkah: 4,
    kode: 'sql_layer',
    judul: 'Mengumpulkan Data Sekolah',
    activeSubtitle: 'Mengambil dan memeriksa data terkait pertanyaan…',
    phase: 'sql' as ConstellationState,
  },
  {
    langkah: 5,
    kode: 'compose_layer',
    judul: 'Menyusun Jawaban',
    activeSubtitle: 'Merangkai jawaban yang ringkas dan mudah dipahami…',
    phase: 'thinking' as ConstellationState,
  },
] as const;

const LEGACY_TITLE_TO_CODE: Record<string, string> = {
  'validasi cakupan data': 'scope_guard',
  'klasifikasi intent & parameter': 'intent_layer',
  'pemeriksaan hak akses (rbac)': 'rbac_layer',
  'eksekusi sql / rag layer': 'sql_layer',
  'penyusunan & validasi output': 'compose_layer',
};

const JARGON_PATTERN =
  /\b(sql|rag|rbac|intent|query|database|baris tabel|terklasifikasi|melalui mode|tidak dikirim ke|lolos validasi|baku lokal|template|layer|tanpa query|sql builder)\b/i;

const SNAKE_TOKEN_PATTERN = /[a-z0-9]+_[a-z0-9_]+/i;

function hasTechnicalJargon(text: string): boolean {
  return (
    JARGON_PATTERN.test(text) ||
    SNAKE_TOKEN_PATTERN.test(text) ||
    /\bdirangkai\s+\S+\s+dan\b/i.test(text) ||
    /\buntuk peran\s+['"]/i.test(text)
  );
}

function humanizeStageSummary(
  kode: string,
  status: ThinkingStep['status'] | undefined,
  rawSummary: string
): string {
  const lower = rawSummary.toLowerCase();

  switch (kode) {
    case 'scope_guard':
      if (status === 'ditolak' || lower.includes('luar cakupan') || lower.includes('x/xi')) {
        return 'Pertanyaan berada di luar cakupan data siswa kelas XII SMKN 4 Bandung.';
      }
      return 'Memastikan pertanyaan sesuai dengan ruang lingkup data sekolah kelas XII.';
    case 'intent_layer':
      if (
        status === 'klarifikasi' ||
        lower.includes('klarifikasi') ||
        lower.includes('belum mengarah')
      ) {
        return 'Pertanyaan masih terlalu umum sehingga perlu diperjelas terlebih dahulu.';
      }
      return 'Menangkap maksud pertanyaan dan menyiapkan informasi yang relevan.';
    case 'rbac_layer':
      if (status === 'ditolak' || lower.includes('ditolak')) {
        return 'Akses ke informasi sensitif ini dibatasi sesuai peran akun Anda.';
      }
      return 'Memverifikasi izin akses Anda terhadap informasi yang diminta.';
    case 'sql_layer':
      if (status === 'ditolak' || lower.includes('ditolak')) {
        return 'Permintaan dibatasi karena menyentuh data sensitif di luar izin akun Anda.';
      }
      if (status === 'error' || lower.includes('kendala')) {
        return 'Terjadi kendala saat mengambil data yang diminta.';
      }
      if (status === 'klarifikasi' || lower.includes('klarifikasi')) {
        return 'Data awal belum mencukupi sehingga diperlukan keterangan tambahan.';
      }
      if (lower.includes('sapaan') || lower.includes('tanpa query')) {
        return 'Menyiapkan respons sapaan secara langsung.';
      }
      return 'Mengumpulkan dan memeriksa data sekolah yang relevan.';
    case 'compose_layer':
      if (status === 'error') {
        return 'Menyiapkan informasi kendala pemrosesan permintaan.';
      }
      if (
        lower.includes('sensitif') ||
        lower.includes('tidak dikirim') ||
        lower.includes('lokal saja')
      ) {
        return 'Menyusun jawaban dari data internal secara langsung.';
      }
      if (status === 'klarifikasi' || lower.includes('klarifikasi')) {
        return 'Menyiapkan pesan klarifikasi beserta contoh pertanyaan.';
      }
      return 'Merangkai jawaban yang ringkas, jelas, dan mudah dipahami.';
    default:
      return hasTechnicalJargon(rawSummary)
        ? 'Memproses informasi terkait pertanyaan Anda.'
        : rawSummary;
  }
}

/**
 * Membersihkan judul dan ringkasan tahap berpikir (termasuk riwayat lama di basis data)
 * agar bebas dari istilah teknis internal atau nama penyedia layanan.
 */
export function humanizeTraceStep<
  T extends {
    kode: string;
    judul: string;
    status?: ThinkingStep['status'];
    ringkasan?: string;
  },
>(step: T): T {
  const rawTitle = typeof step.judul === 'string' ? step.judul : '';
  const mappedCode =
    LEGACY_TITLE_TO_CODE[rawTitle.trim().toLowerCase()] ?? step.kode;
  const stage = PIPELINE_STAGES.find((s) => s.kode === mappedCode);
  const judul = stage
    ? stage.judul
    : hasTechnicalJargon(rawTitle)
    ? 'Memproses Tahap'
    : rawTitle;

  if (!step.ringkasan) {
    return { ...step, kode: mappedCode, judul };
  }

  const trimmed = step.ringkasan.trim();
  const isLegacyScope =
    mappedCode === 'scope_guard' &&
    /menyebut kelas|dalam cakupan data kelas xii/i.test(trimmed);
  const isLegacyCompose =
    mappedCode === 'compose_layer' &&
    /terhadap hasil query|klarifikasi terpandu/i.test(trimmed);
  const needsRewrite =
    hasTechnicalJargon(trimmed) || isLegacyScope || isLegacyCompose;

  return {
    ...step,
    kode: mappedCode,
    judul,
    ringkasan: needsRewrite
      ? humanizeStageSummary(mappedCode, step.status, trimmed)
      : step.ringkasan,
  };
}

const FLOW_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export function formatDurationId(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '< 0,1 dtk';
  if (ms < 100) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1).replace('.', ',')} dtk`;
}

export function constellationStateForStep(step: ThinkingStep): ConstellationState {
  if (step.status === 'ditolak' || step.status === 'error') return 'error';
  if (step.status === 'klarifikasi') return 'clarify';
  if (step.kode === 'sql_layer') return 'sql';
  return 'thinking';
}

function statusMeta(status: ThinkingStep['status']) {
  switch (status) {
    case 'ok':
      return {
        label: 'Terverifikasi',
        Icon: CheckCircle2,
        badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
        iconColor: 'text-emerald-600 dark:text-emerald-400',
        lineColor: 'bg-emerald-500/45 dark:bg-emerald-400/40',
      };
    case 'klarifikasi':
      return {
        label: 'Klarifikasi',
        Icon: HelpCircle,
        badge: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
        iconColor: 'text-amber-600 dark:text-amber-400',
        lineColor: 'bg-amber-500/45 dark:bg-amber-400/40',
      };
    case 'ditolak':
      return {
        label: 'Ditolak',
        Icon: ShieldAlert,
        badge: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
        iconColor: 'text-rose-600 dark:text-rose-400',
        lineColor: 'bg-rose-500/45 dark:bg-rose-400/40',
      };
    default:
      return {
        label: 'Error',
        Icon: XCircle,
        badge: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
        iconColor: 'text-rose-600 dark:text-rose-400',
        lineColor: 'bg-rose-500/45 dark:bg-rose-400/40',
      };
  }
}

/**
 * Stepper vertikal sekuensial langsung (top-to-bottom) saat AI sedang memproses
 * dan memverifikasi setiap tahap penalaran.
 */
export function SequentialThinkingStepper({
  steps,
  totalStages = PIPELINE_STAGES.length,
  constellationState,
}: {
  steps: LiveStepperItem[];
  totalStages?: number;
  constellationState: ConstellationState;
}) {
  const prefersReduced = Boolean(useReducedMotion());
  const normalizedSteps = steps.map((step) => humanizeTraceStep(step));
  const currentStep = normalizedSteps[normalizedSteps.length - 1];
  const headerLabel = currentStep
    ? currentStep.state === 'active'
      ? `${currentStep.judul}…`
      : 'Menyelesaikan verifikasi…'
    : 'Memproses pertanyaan…';
  const progressCount = Math.min(
    normalizedSteps.length,
    Math.max(totalStages, normalizedSteps.length)
  );

  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
      transition={{ duration: prefersReduced ? 0 : 0.2, ease: FLOW_EASE }}
      className="flex items-start gap-3"
      role="status"
      aria-live="polite"
    >
      <KineticConstellation state={constellationState} size="sm" className="mt-0.5" />

      <div className="min-w-0 flex-1 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
          <span className="text-xs font-medium text-[var(--text-secondary)]">
            {headerLabel}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
            {String(progressCount).padStart(2, '0')}/{String(Math.max(totalStages, progressCount)).padStart(2, '0')}
          </span>
        </div>

        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/55 px-3.5 py-3 text-xs">
          <ol className="space-y-3">
            {normalizedSteps.map((step, idx) => {
              const isDone = step.state === 'done';
              const isLastRendered = idx === normalizedSteps.length - 1;
              const isSqlActive = !isDone && step.kode === 'sql_layer';
              const sm = statusMeta(step.status ?? 'ok');
              const StepIcon = sm.Icon;
              const showConnector = isDone && !isLastRendered;
              const defaultStage = PIPELINE_STAGES.find((s) => s.kode === step.kode);
              const subtitle = isDone
                ? step.ringkasan
                : defaultStage?.activeSubtitle || step.ringkasan;

              return (
                <motion.li
                  key={`${step.langkah}-${step.kode}`}
                  initial={prefersReduced ? false : { opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: prefersReduced ? 0 : 0.22,
                    delay: prefersReduced || idx === 0 ? 0 : 0.08,
                    ease: FLOW_EASE,
                  }}
                  className="relative flex gap-3"
                >
                  {/* Garis penghubung vertikal menggambar halus ke bawah saat tahap selesai */}
                  {showConnector && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute left-[9.5px] top-5 bottom-[-12px] w-px overflow-hidden bg-[var(--border-subtle)]/50"
                    >
                      <motion.span
                        initial={prefersReduced ? { scaleY: 1 } : { scaleY: 0 }}
                        animate={{ scaleY: 1 }}
                        transition={{
                          duration: prefersReduced ? 0 : 0.22,
                          ease: FLOW_EASE,
                        }}
                        style={{ transformOrigin: 'top' }}
                        className={`block h-full w-full ${sm.lineColor}`}
                      />
                    </span>
                  )}

                  {/* Simpul indikator tahap */}
                  <div className="relative mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--bg-surface)] ring-1 ring-[var(--border-subtle)]">
                    {isDone ? (
                      <motion.span
                        initial={prefersReduced ? false : { scale: 0.65, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{
                          type: 'spring',
                          stiffness: 460,
                          damping: 26,
                        }}
                        className="flex items-center justify-center"
                      >
                        <StepIcon className={`h-3.5 w-3.5 ${sm.iconColor}`} />
                      </motion.span>
                    ) : (
                      <span className="relative flex h-3 w-3 items-center justify-center">
                        {!prefersReduced && (
                          <motion.span
                            animate={{ scale: [0.9, 1.65, 0.9], opacity: [0.55, 0, 0.55] }}
                            transition={{
                              duration: isSqlActive ? 1.15 : 1.5,
                              repeat: Infinity,
                              ease: 'easeInOut',
                            }}
                            className={`absolute inset-0 rounded-full ${
                              isSqlActive
                                ? 'bg-emerald-500/40 dark:bg-emerald-400/40'
                                : 'bg-[var(--accent-ink)]/30'
                            }`}
                          />
                        )}
                        <span
                          className={`relative h-2 w-2 rounded-full ${
                            isSqlActive
                              ? 'bg-emerald-600 dark:bg-emerald-400'
                              : 'bg-[var(--accent-ink)]'
                          }`}
                        />
                      </span>
                    )}
                  </div>

                  {/* Detail tahap */}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                          {String(step.langkah).padStart(2, '0')}
                        </span>
                        <span
                          className={`font-semibold ${
                            isDone ? 'text-[var(--text-primary)]' : 'text-[var(--text-primary)]'
                          }`}
                        >
                          {step.judul}
                        </span>
                        {isDone && step.status && step.status !== 'ok' && (
                          <span
                            className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${sm.badge}`}
                          >
                            {sm.label}
                          </span>
                        )}
                      </div>

                      {isDone && typeof step.durasi_ms === 'number' ? (
                        <motion.span
                          initial={prefersReduced ? false : { opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ duration: 0.16 }}
                          className="font-mono text-[11px] tabular-nums text-[var(--text-secondary)]"
                        >
                          {step.durasi_ms} ms
                        </motion.span>
                      ) : !isDone ? (
                        <span className="font-mono text-[10px] tracking-wide text-[var(--text-muted)] uppercase">
                          Memproses
                        </span>
                      ) : null}
                    </div>

                    {subtitle && (
                      <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                        {subtitle}
                      </p>
                    )}
                  </div>
                </motion.li>
              );
            })}
          </ol>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Jejak penalaran terlipat (collapsible) pada pesan AI yang sudah selesai.
 */
export function ThinkingTrace({
  steps,
  totalMs,
}: {
  steps: ThinkingStep[];
  totalMs?: number;
}) {
  const normalizedSteps = steps.map((step) => humanizeTraceStep(step));
  const resolvedMs =
    typeof totalMs === 'number'
      ? totalMs
      : normalizedSteps.reduce((acc, s) => acc + (Number.isFinite(s.durasi_ms) ? s.durasi_ms : 0), 0);

  return (
    <details className="sis-disclosure group mb-2.5">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg py-0.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] select-none [&::-webkit-details-marker]:hidden">
        <span>Berpikir selama {formatDurationId(resolvedMs)}</span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-open:rotate-90" />
      </summary>

      <div className="mt-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 px-3.5 py-3 text-xs">
        <ol className="space-y-3">
          {normalizedSteps.map((step, idx) => {
            const sm = statusMeta(step.status);
            const StepIcon = sm.Icon;
            const isLast = idx === normalizedSteps.length - 1;
            return (
              <li key={`${step.langkah}-${step.kode}`} className="relative flex gap-3">
                {!isLast && (
                  <span
                    aria-hidden="true"
                    className="absolute left-[9.5px] top-5 bottom-[-12px] w-px bg-[var(--border-subtle)]"
                  />
                )}
                <div className="relative mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--bg-surface)] ring-1 ring-[var(--border-subtle)]">
                  <StepIcon className={`h-3.5 w-3.5 ${sm.iconColor}`} />
                </div>

                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[11px] tabular-nums text-[var(--text-secondary)]">
                        {String(step.langkah).padStart(2, '0')}
                      </span>
                      <span className="font-semibold text-[var(--text-primary)]">
                        {step.judul}
                      </span>
                      {step.status !== 'ok' && (
                        <span
                          className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${sm.badge}`}
                        >
                          {sm.label}
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-[11px] tabular-nums text-[var(--text-secondary)]">
                      {step.durasi_ms} ms
                    </span>
                  </div>

                  {step.ringkasan && (
                    <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                      {step.ringkasan}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </details>
  );
}

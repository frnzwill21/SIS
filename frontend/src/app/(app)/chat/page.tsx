'use client';
import { FormEvent, KeyboardEvent, Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowUp,
  ArrowUpRight,
  Check,
  Copy,
  CornerDownRight,
  Database,
  Undo2,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { api, canViewPelanggaran, ChatMode, normalizeChatMode, Role, Row, session, User } from '@/lib/api';
import { preferences } from '@/lib/preferences';
import DataTable from '@/components/DataTable';
import KineticConstellation, { ConstellationState } from '@/components/chat/KineticConstellation';
import ChatIntroOverlay from '@/components/chat/ChatIntroOverlay';
import {
  constellationStateForStep,
  humanizeTraceStep,
  LiveStepperItem,
  PIPELINE_STAGES,
  SequentialThinkingStepper,
  ThinkingStep,
  ThinkingTrace,
} from '@/components/chat/SequentialThinkingStepper';

type TabelEngine = { kolom: string[]; baris: unknown[][] };

type Msg = {
  id?: number;
  clientKey?: string;
  role: 'user' | 'ai';
  text: string;
  dibuat_pada?: string;
  isError?: boolean;
  tabel?: Row[] | TabelEngine | null;
  sumber?: string[];
  sensitif?: boolean;
  mode?: ChatMode;
  intentName?: string | null;
  butuh_klarifikasi?: boolean;
  contoh?: string[];
  jejak_pikir?: ThinkingStep[];
  total_durasi_ms?: number;
};

type ChatApiResponse = {
  jawaban: string;
  tabel?: Row[] | TabelEngine | null;
  sumber?: string[];
  intent?: unknown;
  mode?: ChatMode | string;
  sensitif?: boolean;
  butuh_klarifikasi?: boolean;
  contoh?: string[];
  sesi_id?: string | null;
  judul_sesi?: string | null;
  user_message_id?: number | null;
  ai_message_id?: number | null;
  jejak_pikir?: ThinkingStep[];
  total_durasi_ms?: number;
};

type UndoTurnResponse = {
  deleted: number;
  restored_text: string;
  remaining: number;
};

type SessionMessageApi = {
  id: number;
  role: 'user' | 'ai';
  konten: string;
  metadata?: Record<string, unknown> | string | null;
  dibuat_pada?: string;
};

type SessionDetailResponse = {
  sesi: { id: string; judul: string; pinned: boolean };
  messages: SessionMessageApi[];
};

const MAX_PESAN = 500;
const WELCOME_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getIntentName(intent: unknown): string | null {
  if (!intent || typeof intent !== 'object') return null;
  const raw = (intent as { intent?: unknown }).intent;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function formatWibTime(iso?: string): string | null {
  if (!iso) return null;
  const normalized =
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(iso) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso)
      ? `${iso.replace(' ', 'T')}Z`
      : iso;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const formatted = new Intl.DateTimeFormat('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Jakarta',
    }).format(d);
    return `${formatted.replace(':', '.')} WIB`;
  } catch {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}.${mm} WIB`;
  }
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    return true;
  } catch {
    return false;
  }
}

function buildWaitingSteps(activeIdx: number): LiveStepperItem[] {
  const clamped = Math.max(0, Math.min(activeIdx, PIPELINE_STAGES.length - 1));
  return PIPELINE_STAGES.slice(0, clamped + 1).map((stage, idx) =>
    idx < clamped
      ? {
          langkah: stage.langkah,
          kode: stage.kode,
          judul: stage.judul,
          state: 'done' as const,
          status: 'ok' as const,
        }
      : {
          langkah: stage.langkah,
          kode: stage.kode,
          judul: stage.judul,
          state: 'active' as const,
          ringkasan: stage.activeSubtitle,
        }
  );
}

function toLiveStep(step: ThinkingStep, state: 'active' | 'done'): LiveStepperItem {
  const clean = humanizeTraceStep(step);
  if (state === 'done') {
    return {
      langkah: clean.langkah,
      kode: clean.kode,
      judul: clean.judul,
      state: 'done',
      status: clean.status,
      ringkasan: clean.ringkasan,
      durasi_ms: clean.durasi_ms,
    };
  }
  const preset = PIPELINE_STAGES.find((s) => s.kode === clean.kode);
  return {
    langkah: clean.langkah,
    kode: clean.kode,
    judul: clean.judul,
    state: 'active',
    ringkasan: preset?.activeSubtitle ?? clean.ringkasan,
  };
}

function getTimeGreeting(date = new Date()): string {
  const h = date.getHours();
  if (h >= 4 && h < 11) return 'Selamat pagi';
  if (h >= 11 && h < 15) return 'Selamat siang';
  if (h >= 15 && h < 18) return 'Selamat sore';
  return 'Selamat malam';
}

function getFirstName(user: User | null): string {
  const raw = (user?.nama || user?.username || '').trim();
  if (!raw) return 'Rekan';
  const parts = raw.split(/\s+/);
  if (parts.length > 1 && /^(dr|drs|dra|h|hj|ir|prof)\.?$/i.test(parts[0])) {
    return parts[1].replace(/[.,]+$/, '');
  }
  return parts[0].replace(/[.,]+$/, '');
}

type SuggestionChip = { label: string; prompt: string };

function getRoleSuggestions(role?: Role | null): SuggestionChip[] {
  if (role === 'bk') {
    return [
      { label: 'Catatan Pelanggaran', prompt: 'Catatan pelanggaran siswa kelas XII RPL 1' },
      { label: 'Alpha Tinggi', prompt: 'Siapa saja yang alpha lebih dari 5 hari semester ini?' },
      { label: 'Sanksi Tata Tertib', prompt: 'Apa sanksi untuk pelanggaran tingkat sedang?' },
      { label: 'Penempatan PKL', prompt: 'Siapa saja siswa yang ditempatkan PKL di PLN?' },
    ];
  }
  if (role === 'kepala_sekolah') {
    return [
      { label: 'Evaluasi KKM', prompt: 'Siswa XII RPL 1 yang nilainya di bawah KKM semester 5' },
      { label: 'Alpha Tinggi', prompt: 'Siapa saja yang alpha lebih dari 5 hari semester ini?' },
      { label: 'Catatan Pelanggaran', prompt: 'Catatan pelanggaran siswa kelas XII RPL 1' },
      { label: 'Penempatan PKL', prompt: 'Siapa saja siswa yang ditempatkan PKL di PLN?' },
    ];
  }
  if (role === 'admin') {
    return [
      { label: 'Wali Kelas', prompt: 'Siapa wali kelas XII TITL 6?' },
      { label: 'Evaluasi KKM', prompt: 'Siswa XII RPL 1 yang nilainya di bawah KKM semester 5' },
      { label: 'Catatan Pelanggaran', prompt: 'Catatan pelanggaran siswa kelas XII RPL 1' },
      { label: 'Penempatan PKL', prompt: 'Siapa saja siswa yang ditempatkan PKL di PLN?' },
    ];
  }
  return [
    { label: 'Jadwal Kelas', prompt: 'Jadwal pelajaran XII TITL 6 hari Senin' },
    { label: 'Evaluasi KKM', prompt: 'Siswa XII RPL 1 yang nilainya di bawah KKM semester 5' },
    { label: 'Wali Kelas', prompt: 'Siapa wali kelas XII TITL 6?' },
    canViewPelanggaran(role)
      ? { label: 'Pelanggaran', prompt: 'Catatan pelanggaran siswa kelas XII RPL 1' }
      : { label: 'Penempatan PKL', prompt: 'Siapa saja siswa yang ditempatkan PKL di PLN?' },
  ];
}

function parseMeta(raw: SessionMessageApi['metadata']): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return typeof raw === 'object' ? raw : null;
}

function mapSessionMessage(m: SessionMessageApi): Msg {
  const meta = parseMeta(m.metadata);
  return {
    id: m.id,
    role: m.role,
    text: m.konten,
    dibuat_pada: m.dibuat_pada,
    tabel: (meta?.tabel as Row[] | TabelEngine | null | undefined) ?? null,
    sumber: Array.isArray(meta?.sumber) ? (meta.sumber as string[]) : undefined,
    mode: normalizeChatMode(meta?.mode),
    intentName: getIntentName(meta?.intent),
    sensitif: Boolean(meta?.sensitif),
    butuh_klarifikasi: Boolean(meta?.butuh_klarifikasi),
    contoh: Array.isArray(meta?.contoh) ? (meta.contoh as string[]) : undefined,
    jejak_pikir: Array.isArray(meta?.jejak_pikir)
      ? (meta.jejak_pikir as ThinkingStep[]).map(humanizeTraceStep)
      : undefined,
    total_durasi_ms: typeof meta?.total_durasi_ms === 'number' ? meta.total_durasi_ms : undefined,
  };
}

function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  async function handleCopy() {
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`inline-flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] ${className}`}
      title="Salin jawaban"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
          <span>Disalin</span>
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          <span>Salin</span>
        </>
      )}
    </button>
  );
}

function UserMessageActionBar({
  text,
  dibuatPada,
  undoDisabled,
  onUndo,
}: {
  text: string;
  dibuatPada?: string;
  undoDisabled: boolean;
  onUndo: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeLabel = formatWibTime(dibuatPada);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  async function handleCopy() {
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1800);
    }
  }

  return (
    <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
      {timeLabel && <span className="tabular-nums">{timeLabel}</span>}

      <button
        type="button"
        onClick={handleCopy}
        aria-label="Salin pesan"
        title="Salin pesan"
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>

      <button
        type="button"
        disabled={undoDisabled}
        onClick={onUndo}
        aria-label="Tarik kembali pesan ini"
        title="Tarik kembali & edit"
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Undo2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ChatContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sesiParam = searchParams.get('sesi');
  const prefersReduced = Boolean(useReducedMotion());

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [activeSesiId, setActiveSesiId] = useState<string | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);
  const [sessionError, setSessionError] = useState('');
  const [undoError, setUndoError] = useState('');
  const [undoing, setUndoing] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [greeting, setGreeting] = useState('Selamat datang');
  const [enterToSend, setEnterToSend] = useState(true);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [liveSteps, setLiveSteps] = useState<LiveStepperItem[]>([]);
  const [liveTotalStages, setLiveTotalStages] = useState<number>(PIPELINE_STAGES.length);
  const [liveConstellation, setLiveConstellation] = useState<ConstellationState>('thinking');

  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const busyRef = useRef(false);
  const undoingRef = useRef(false);
  const epochRef = useRef(0);
  const clientKeySeqRef = useRef(0);
  const loadedSesiRef = useRef<string | null>(null);
  const activeSesiRef = useRef<string | null>(null);
  const waitingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const undoErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    activeSesiRef.current = activeSesiId;
  }, [activeSesiId]);

  useEffect(() => {
    setCurrentUser(session.user());
    setGreeting(getTimeGreeting());
    setEnterToSend(preferences.get().enterToSend);
    setHydrated(true);
    return preferences.subscribe((prefs) => {
      setEnterToSend(prefs.enterToSend);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (waitingTimerRef.current) {
        clearInterval(waitingTimerRef.current);
        waitingTimerRef.current = null;
      }
      if (undoErrorTimerRef.current) {
        clearTimeout(undoErrorTimerRef.current);
        undoErrorTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth' });
  }, [msgs, busy, liveSteps, prefersReduced]);

  function stopWaitingCycle() {
    if (waitingTimerRef.current) {
      clearInterval(waitingTimerRef.current);
      waitingTimerRef.current = null;
    }
  }

  function showUndoError(message: string) {
    setUndoError(message);
    if (undoErrorTimerRef.current) {
      clearTimeout(undoErrorTimerRef.current);
    }
    undoErrorTimerRef.current = setTimeout(() => {
      setUndoError('');
      undoErrorTimerRef.current = null;
    }, 4500);
  }

  // Sinkronisasi ?sesi=<id> dari URL
  useEffect(() => {
    if (!hydrated) return;

    if (!sesiParam) {
      if (loadedSesiRef.current !== null || activeSesiRef.current !== null) {
        epochRef.current += 1;
        busyRef.current = false;
        undoingRef.current = false;
        stopWaitingCycle();
        setBusy(false);
        setUndoing(false);
        setLiveSteps([]);
        loadedSesiRef.current = null;
        activeSesiRef.current = null;
        setActiveSesiId(null);
        setMsgs([]);
        setSessionError('');
        setUndoError('');
        setLoadingSession(false);
      }
      return;
    }

    if (sesiParam === loadedSesiRef.current) {
      return;
    }

    let alive = true;
    const myEpoch = ++epochRef.current;
    busyRef.current = false;
    undoingRef.current = false;
    stopWaitingCycle();
    setBusy(false);
    setUndoing(false);
    setLiveSteps([]);
    setLoadingSession(true);
    setSessionError('');
    setUndoError('');

    api<SessionDetailResponse>(`/chat/sesi/${encodeURIComponent(sesiParam)}`)
      .then((res) => {
        if (!alive || epochRef.current !== myEpoch) return;
        loadedSesiRef.current = res.sesi?.id ?? sesiParam;
        setActiveSesiId(res.sesi?.id ?? sesiParam);
        setMsgs(Array.isArray(res.messages) ? res.messages.map(mapSessionMessage) : []);
      })
      .catch((e) => {
        if (!alive || epochRef.current !== myEpoch) return;
        loadedSesiRef.current = sesiParam;
        setActiveSesiId(null);
        setMsgs([]);
        setSessionError((e as Error).message || 'Percakapan tidak ditemukan.');
      })
      .finally(() => {
        if (alive && epochRef.current === myEpoch) {
          setLoadingSession(false);
        }
      });

    return () => {
      alive = false;
    };
  }, [hydrated, sesiParam]);

  // Tangani event `sis-chat` (Percakapan Baru atau sis_pending_q dari Knowledge Graph)
  useEffect(() => {
    if (!hydrated) return;

    const handle = () => {
      if (sessionStorage.getItem('sis_reset_chat')) {
        sessionStorage.removeItem('sis_reset_chat');
        sessionStorage.removeItem('sis_chat_history');
        epochRef.current += 1;
        busyRef.current = false;
        undoingRef.current = false;
        stopWaitingCycle();
        loadedSesiRef.current = null;
        activeSesiRef.current = null;
        setBusy(false);
        setUndoing(false);
        setLiveSteps([]);
        setMsgs([]);
        setInput('');
        setSessionError('');
        setUndoError('');
        setLoadingSession(false);
        setActiveSesiId(null);
        if (sesiParam) {
          router.replace('/chat');
        }
      }
      if (!busyRef.current) {
        const q = sessionStorage.getItem('sis_pending_q');
        if (q) {
          sessionStorage.removeItem('sis_pending_q');
          kirim(q);
        }
      }
    };

    handle();
    window.addEventListener('sis-chat', handle);
    return () => window.removeEventListener('sis-chat', handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, sesiParam]);

  async function kirim(pesan: string) {
    const textKirim = pesan.trim().slice(0, MAX_PESAN);
    if (!textKirim || busyRef.current || undoingRef.current) return;
    busyRef.current = true;
    const myEpoch = epochRef.current;
    const targetSesiId = activeSesiRef.current;
    const userClientKey = `local-u-${++clientKeySeqRef.current}`;
    const userTimestamp = new Date().toISOString();

    setSessionError('');
    setUndoError('');
    setMsgs((m) => [
      ...m,
      {
        clientKey: userClientKey,
        role: 'user',
        text: textKirim,
        dibuat_pada: userTimestamp,
      },
    ]);
    setInput('');
    setLiveTotalStages(PIPELINE_STAGES.length);
    setLiveConstellation(PIPELINE_STAGES[0].phase);
    setLiveSteps(buildWaitingSteps(0));
    setBusy(true);

    stopWaitingCycle();
    let waitStageIdx = 0;
    waitingTimerRef.current = setInterval(() => {
      if (epochRef.current !== myEpoch) {
        stopWaitingCycle();
        return;
      }
      if (waitStageIdx < PIPELINE_STAGES.length - 1) {
        waitStageIdx += 1;
        setLiveConstellation(PIPELINE_STAGES[waitStageIdx].phase);
        setLiveSteps(buildWaitingSteps(waitStageIdx));
      }
    }, 680);

    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();

    try {
      const r = await api<ChatApiResponse>('/chat', {
        method: 'POST',
        body: { pesan: textKirim, sesi_id: targetSesiId ?? null },
      });
      stopWaitingCycle();
      if (epochRef.current !== myEpoch) return;

      const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      const intentName = getIntentName(r.intent);
      const isSapaan = intentName === 'sapaan';
      const steps = Array.isArray(r.jejak_pikir)
        ? r.jejak_pikir.map(humanizeTraceStep)
        : [];
      const prefersReducedNow =
        prefersReduced ||
        (typeof window !== 'undefined' &&
          Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches));

      // Putar seluruh tahap jejak_pikir secara sekuensial ke bawah dengan metadata & durasi nyata
      if (!isSapaan && !prefersReducedNow && steps.length > 0) {
        setLiveTotalStages(steps.length);
        const startIdx = Math.min(waitStageIdx, steps.length - 1);
        const remainingCount = steps.length - startIdx;
        const perStepMs = Math.min(310, Math.max(210, Math.floor(1320 / Math.max(remainingCount, 1))));
        const activeMs = Math.round(perStepMs * 0.45);
        const settleMs = Math.round(perStepMs * 0.55);

        for (let idx = startIdx; idx < steps.length; idx++) {
          if (epochRef.current !== myEpoch) return;
          const step = steps[idx];
          const donePrefix = steps.slice(0, idx).map((s) => toLiveStep(s, 'done'));

          setLiveConstellation(constellationStateForStep(step));
          setLiveSteps([...donePrefix, toLiveStep(step, 'active')]);

          if (idx === 0 && waitStageIdx === 0) {
            await sleep(Math.max(85, Math.min(activeMs, 180 - elapsedMs)));
          } else {
            await sleep(activeMs);
          }
          if (epochRef.current !== myEpoch) return;

          setLiveSteps([...donePrefix, toLiveStep(step, 'done')]);
          const isLast = idx === steps.length - 1;
          await sleep(isLast ? 240 : settleMs);
        }
        if (epochRef.current !== myEpoch) return;
      }

      const aiClientKey = `local-a-${++clientKeySeqRef.current}`;
      const aiTimestamp = new Date().toISOString();

      setMsgs((prev) => {
        const updated = prev.map((item) =>
          item.clientKey === userClientKey && typeof r.user_message_id === 'number'
            ? { ...item, id: r.user_message_id }
            : item
        );
        return [
          ...updated,
          {
            id: typeof r.ai_message_id === 'number' ? r.ai_message_id : undefined,
            clientKey: aiClientKey,
            role: 'ai',
            text: r.jawaban,
            dibuat_pada: aiTimestamp,
            tabel: r.tabel,
            sumber: r.sumber,
            sensitif: r.sensitif,
            mode: normalizeChatMode(r.mode),
            intentName,
            butuh_klarifikasi: r.butuh_klarifikasi,
            contoh: r.contoh,
            jejak_pikir: Array.isArray(r.jejak_pikir)
              ? r.jejak_pikir.map(humanizeTraceStep)
              : undefined,
            total_durasi_ms: r.total_durasi_ms,
          },
        ];
      });

      if (r.sesi_id) {
        loadedSesiRef.current = r.sesi_id;
        setActiveSesiId(r.sesi_id);
        activeSesiRef.current = r.sesi_id;
        if (sesiParam !== r.sesi_id) {
          router.replace(`/chat?sesi=${encodeURIComponent(r.sesi_id)}`);
        }
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('sis-sessions-updated'));
        }
      }
    } catch (e) {
      stopWaitingCycle();
      if (epochRef.current !== myEpoch) return;
      const errClientKey = `local-e-${++clientKeySeqRef.current}`;
      setMsgs((m) => [
        ...m,
        {
          clientKey: errClientKey,
          role: 'ai',
          text: (e as Error).message,
          dibuat_pada: new Date().toISOString(),
          isError: true,
        },
      ]);
    } finally {
      stopWaitingCycle();
      if (epochRef.current === myEpoch) {
        busyRef.current = false;
        setBusy(false);
        setLiveSteps([]);
        if (typeof window !== 'undefined' && sessionStorage.getItem('sis_pending_q')) {
          setTimeout(() => window.dispatchEvent(new Event('sis-chat')), 0);
        }
      }
    }
  }

  async function handleUndo(msgIndex: number) {
    if (busyRef.current || undoingRef.current) return;
    const target = msgs[msgIndex];
    if (!target || target.role !== 'user') return;

    undoingRef.current = true;
    setUndoing(true);
    setUndoError('');
    const myEpoch = epochRef.current;

    try {
      let restoredText = target.text;
      const currentSesiId = activeSesiRef.current;

      if (currentSesiId && typeof target.id === 'number') {
        const res = await api<UndoTurnResponse>(
          `/chat/sesi/${encodeURIComponent(currentSesiId)}/undo`,
          {
            method: 'POST',
            body: { message_id: target.id },
          }
        );
        if (epochRef.current !== myEpoch) return;
        if (typeof res?.restored_text === 'string' && res.restored_text.length > 0) {
          restoredText = res.restored_text;
        }
      }

      const nextMsgs = msgs.slice(0, msgIndex);
      setMsgs(nextMsgs);
      setInput(restoredText);

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('sis-sessions-updated'));
      }

      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.focus();
          const len = ta.value.length;
          ta.setSelectionRange(len, len);
        }
      });
    } catch (e) {
      if (epochRef.current !== myEpoch) return;
      showUndoError((e as Error).message || 'Gagal menarik kembali pesan.');
    } finally {
      if (epochRef.current === myEpoch) {
        undoingRef.current = false;
        setUndoing(false);
      }
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    kirim(input);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key !== 'Enter') return;

    if (enterToSend) {
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        kirim(input);
      }
    } else if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      kirim(input);
    }
  }

  const firstName = getFirstName(currentUser);
  const suggestions = getRoleSuggestions(currentUser?.role);
  const isWelcome = hydrated && !loadingSession && !sessionError && msgs.length === 0;

  const composerBox = (
    <div className="mx-auto w-full max-w-3xl">
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 shadow-sm transition-colors focus-within:border-[var(--text-secondary)]"
      >
        <label htmlFor="chat-composer-input" className="visually-hidden">
          Pertanyaan untuk asisten sekolah
        </label>
        <textarea
          ref={textareaRef}
          id="chat-composer-input"
          name="pesan"
          rows={1}
          maxLength={MAX_PESAN}
          aria-label="Pertanyaan untuk asisten sekolah"
          className="chat-composer-input resize-none bg-transparent text-sm leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/70 focus:outline-none"
          placeholder="Tanyakan jadwal pelajaran, nilai KKM, rekap kehadiran, PKL, atau dokumen sekolah…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />

        <div className="mt-2 flex items-center justify-between border-t border-[var(--border-subtle)] pt-2">
          <div className="flex items-center gap-2">
            {input.length >= 400 && (
              <span
                className={`font-mono text-[11px] font-medium tabular-nums ${
                  input.length >= MAX_PESAN
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {input.length}/{MAX_PESAN}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <span className="hidden text-[11px] text-[var(--text-secondary)] sm:inline">
              {enterToSend ? 'Enter kirim · Shift+Enter baris baru' : 'Ctrl/Cmd+Enter kirim'}
            </span>
            <button
              type="submit"
              disabled={busy || undoing || !input.trim()}
              aria-label="Kirim pertanyaan"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent-ink)] text-[var(--accent-ink-fg)] transition-all hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </div>
      </form>
    </div>
  );

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <ChatIntroOverlay />

      {isWelcome ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-region px-4 py-8 sm:px-6">
          <div className="flex min-h-full flex-col">
            <div className="mx-auto my-auto flex w-full max-w-3xl flex-col items-center text-center">
              <motion.div
                initial={prefersReduced ? false : { opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: prefersReduced ? 0 : 0.36, ease: WELCOME_EASE }}
              >
                <KineticConstellation state="idle" size="lg" />
              </motion.div>

              <motion.h2
                initial={prefersReduced ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: prefersReduced ? 0 : 0.36,
                  delay: prefersReduced ? 0 : 0.06,
                  ease: WELCOME_EASE,
                }}
                className="mt-5 text-2xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-[26px]"
              >
                {greeting}, {firstName}
              </motion.h2>

              <motion.p
                initial={prefersReduced ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: prefersReduced ? 0 : 0.36,
                  delay: prefersReduced ? 0 : 0.12,
                  ease: WELCOME_EASE,
                }}
                className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--text-secondary)]"
              >
                Asisten intelijen sekolah untuk kelas XII SMKN 4 Bandung. Ajukan pertanyaan seputar jadwal, nilai KKM,
                kehadiran, penempatan PKL, maupun dokumen sekolah.
              </motion.p>

              <motion.div
                initial={prefersReduced ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: prefersReduced ? 0 : 0.38,
                  delay: prefersReduced ? 0 : 0.18,
                  ease: WELCOME_EASE,
                }}
                className="mt-7 w-full text-left"
              >
                {composerBox}
              </motion.div>

              <motion.div
                initial={prefersReduced ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: prefersReduced ? 0 : 0.38,
                  delay: prefersReduced ? 0 : 0.24,
                  ease: WELCOME_EASE,
                }}
                className="mt-5 grid w-full max-w-3xl grid-cols-1 gap-2.5 sm:grid-cols-2"
              >
                {suggestions.map((s) => (
                  <button
                    key={s.prompt}
                    type="button"
                    disabled={busy || undoing}
                    onClick={() => kirim(s.prompt)}
                    className="group flex items-start justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3 text-left transition-all hover:border-[var(--text-secondary)]/60 hover:bg-[var(--bg-elevated)]/70 disabled:cursor-not-allowed disabled:opacity-50"
                    title={s.prompt}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold tracking-wide text-[var(--text-muted)] uppercase">
                        {s.label}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs font-medium leading-snug text-[var(--text-primary)]">
                        {s.prompt}
                      </p>
                    </div>
                    <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[var(--text-primary)]" />
                  </button>
                ))}
              </motion.div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-region px-4 sm:px-6">
            {!hydrated || loadingSession ? (
              <div className="mx-auto flex max-w-3xl items-center gap-3 py-8 text-sm text-[var(--text-secondary)]">
                <KineticConstellation mode="loader" size="sm" />
                <span>Memuat riwayat percakapan…</span>
              </div>
            ) : sessionError ? (
              <div className="mx-auto max-w-xl py-10">
                <div className="space-y-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-5 text-center">
                  <p className="text-sm font-medium text-rose-700 dark:text-rose-300">{sessionError}</p>
                  <button
                    type="button"
                    onClick={() => {
                      loadedSesiRef.current = null;
                      setSessionError('');
                      setActiveSesiId(null);
                      setMsgs([]);
                      router.replace('/chat');
                    }}
                    className="btn-ghost text-xs"
                  >
                    Mulai Percakapan Baru
                  </button>
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-3xl space-y-9 py-6">
                {msgs.map((m, i) => {
                  const msgKey = m.clientKey ?? (typeof m.id === 'number' ? `msg-${m.id}` : `idx-${i}`);

                  if (m.role === 'user') {
                    return (
                      <div key={msgKey} className="group flex flex-col items-end gap-1.5">
                        <div className="max-w-[82%] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-2.5 text-sm leading-relaxed text-[var(--text-primary)]">
                          <p className="whitespace-pre-wrap break-words">{m.text}</p>
                        </div>

                        <UserMessageActionBar
                          text={m.text}
                          dibuatPada={m.dibuat_pada}
                          undoDisabled={busy || undoing}
                          onUndo={() => handleUndo(i)}
                        />
                      </div>
                    );
                  }

                  const hasTable =
                    m.tabel && (Array.isArray(m.tabel) ? m.tabel.length > 0 : (m.tabel.baris?.length ?? 0) > 0);
                  const isSapaan = m.intentName === 'sapaan';
                  const showTrace = !isSapaan && Array.isArray(m.jejak_pikir) && m.jejak_pikir.length > 0;
                  const fallbackSuggestions = Array.isArray(m.contoh) ? m.contoh.slice(0, 3) : [];
                  const avatarState: ConstellationState = m.isError
                    ? 'error'
                    : m.butuh_klarifikasi
                    ? 'clarify'
                    : 'done';

                  return (
                    <div key={msgKey} className="flex items-start gap-3">
                      <KineticConstellation state={avatarState} size="sm" className="mt-0.5" />

                      <div className="min-w-0 flex-1 space-y-3">
                        {showTrace && m.jejak_pikir && (
                          <ThinkingTrace steps={m.jejak_pikir} totalMs={m.total_durasi_ms} />
                        )}

                        <div
                          className={`text-sm leading-relaxed ${
                            m.isError
                              ? 'rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-rose-800 dark:text-rose-200'
                              : 'text-[var(--text-primary)]'
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words">{m.text}</p>
                        </div>

                        {m.sensitif && (
                          <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                            <AlertTriangle className="h-4 w-4 shrink-0" />
                            <span>Data sensitif. Pertanyaan dan akses ini dicatat di Audit Log sistem.</span>
                          </div>
                        )}

                        {hasTable && m.tabel && <DataTable rows={m.tabel} />}

                        {fallbackSuggestions.length > 0 && (
                          <div className="space-y-1.5 pt-0.5">
                            <p className="text-[11px] font-medium text-[var(--text-secondary)]">
                              Mungkin maksud Anda:
                            </p>
                            <ul className="space-y-1">
                              {fallbackSuggestions.map((c, k) => (
                                <li key={k}>
                                  <button
                                    type="button"
                                    disabled={busy || undoing}
                                    onClick={() => kirim(c)}
                                    className="group inline-flex max-w-full items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-left text-xs text-[var(--text-primary)] transition-colors hover:border-[var(--text-secondary)]/60 hover:bg-[var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--text-primary)]" />
                                    <span className="truncate">{c}</span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {!m.isError && (
                          <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
                            <CopyButton text={m.text} />

                            {Array.isArray(m.sumber) && m.sumber.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
                                  <Database className="h-3 w-3" />
                                  <span>Sumber:</span>
                                </span>
                                {m.sumber.map((src) => (
                                  <span
                                    key={src}
                                    className="inline-flex items-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-0.5 font-mono text-[11px] text-[var(--text-secondary)]"
                                  >
                                    {src}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                <AnimatePresence mode="wait">
                  {busy && liveSteps.length > 0 && (
                    <SequentialThinkingStepper
                      key="live-thinking-stepper"
                      steps={liveSteps}
                      totalStages={liveTotalStages}
                      constellationState={liveConstellation}
                    />
                  )}
                </AnimatePresence>

                <div ref={endRef} />
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-transparent px-4 pb-4 pt-2 sm:px-6">
            {undoError && (
              <div
                role="alert"
                className="mx-auto mb-2 flex w-full max-w-3xl items-center justify-between gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300"
              >
                <span className="flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>{undoError}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setUndoError('')}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  Tutup
                </button>
              </div>
            )}
            {composerBox}
          </div>
        </>
      )}
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full min-h-0 flex-1 items-center justify-center px-4 text-sm text-[var(--text-secondary)]">
          Memuat ruang percakapan…
        </div>
      }
    >
      <ChatContent />
    </Suspense>
  );
}

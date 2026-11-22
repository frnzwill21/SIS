'use client';

import { DragEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  FileText,
  GitFork,
  Layers,
  Network,
  RefreshCw,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { api, session, User } from '@/lib/api';
import { preferences, TableDensity } from '@/lib/preferences';
import ConfirmDialog from '@/components/ConfirmDialog';
import KnowledgeGraphCanvas, { GraphEdge, GraphNode } from '@/components/knowledge/KnowledgeGraphCanvas';

type GraphStats = {
  total_nodes: number;
  total_edges: number;
  total_dokumen: number;
  menunggu_hapus: number;
  konflik: number;
  type_counts?: Record<string, number>;
};

type GraphResponse = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
};

type KnowledgeDoc = {
  id: number;
  nama_file: string;
  tipe_file: string;
  ukuran_bytes: number;
  ringkasan: string;
  status: string;
  pengunggah: string;
  dibuat_pada: string;
  jumlah_relasi: number;
};

type DeleteRequestItem = {
  id: number;
  document_id: number;
  nama_file: string;
  pemohon: string;
  alasan: string;
  status: string;
  dibuat_pada: string;
  diproses_oleh_nama?: string | null;
  diproses_pada?: string | null;
};

type UploadResult = {
  dokumen: KnowledgeDoc;
  matched_entities?: unknown[];
  konflik?: unknown[];
};

type TabKey = 'graf' | 'dokumen' | 'hapus';

const ALLOWED_EXTENSIONS = ['.md', '.txt', '.json', '.csv', '.xlsx', '.pdf'];
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDateWib(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(d);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Gagal membaca berkas dari perangkat Anda.'));
    reader.readAsDataURL(file);
  });
}

function formatEntityLabel(item: unknown): string {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') {
    const obj = item as Record<string, unknown>;
    const label = obj.label ?? obj.nama ?? obj.kunci ?? obj.entity ?? '';
    const tipe = obj.tipe ? ` (${String(obj.tipe)})` : '';
    return `${String(label)}${tipe}`.trim() || JSON.stringify(item);
  }
  return String(item);
}

function formatConflictLabel(item: unknown): string {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') {
    const obj = item as Record<string, unknown>;
    const msg = obj.alasan ?? obj.catatan ?? obj.pesan ?? obj.detail ?? obj.deskripsi ?? obj.label;
    if (msg) return String(msg);
    return JSON.stringify(item);
  }
  return String(item);
}

function docStatusBadge(status: string) {
  switch (status) {
    case 'aktif':
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-3 w-3" />
          Aktif
        </span>
      );
    case 'menunggu_hapus':
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
          <Clock className="h-3 w-3" />
          Menunggu Hapus
        </span>
      );
    case 'diproses':
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/15 px-2 py-0.5 text-[11px] font-semibold text-sky-700 dark:text-sky-300">
          Diproses
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
          {status}
        </span>
      );
  }
}

function requestStatusBadge(status: string) {
  switch (status) {
    case 'menunggu':
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
          <Clock className="h-3 w-3" />
          Menunggu
        </span>
      );
    case 'disetujui':
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-3 w-3" />
          Disetujui
        </span>
      );
    case 'ditolak':
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300">
          <XCircle className="h-3 w-3" />
          Ditolak
        </span>
      );
    default:
      return <span className="text-xs text-[var(--text-secondary)]">{status}</span>;
  }
}

export default function KnowledgePage() {
  const [user, setUser] = useState<User | null>(null);
  const [density, setDensity] = useState<TableDensity>('comfortable');
  const [activeTab, setActiveTab] = useState<TabKey>('graf');

  // Graf state
  const [grafData, setGrafData] = useState<GraphResponse | null>(null);
  const [grafLoading, setGrafLoading] = useState(true);
  const [grafError, setGrafError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [stableTypeCounts, setStableTypeCounts] = useState<Record<string, number>>({});
  const [includeSystem, setIncludeSystem] = useState(true);

  // Dokumen state
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docsError, setDocsError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [actionBanner, setActionBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Permintaan Hapus state (admin)
  const [requests, setRequests] = useState<DeleteRequestItem[]>([]);
  const [reqsLoading, setReqsLoading] = useState(false);
  const [reqsError, setReqsError] = useState('');

  // Dialog states
  const [requestDeleteDoc, setRequestDeleteDoc] = useState<KnowledgeDoc | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteReasonErr, setDeleteReasonErr] = useState('');
  const [directDeleteDoc, setDirectDeleteDoc] = useState<KnowledgeDoc | null>(null);
  const [reviewAction, setReviewAction] = useState<{
    req: DeleteRequestItem;
    decision: 'setuju' | 'tolak';
  } | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    setUser(session.user());
    setDensity(preferences.get().tableDensity);
    return preferences.subscribe((p) => setDensity(p.tableDensity));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 260);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const isAdmin = user?.role === 'admin';

  const selectedTypesParam = useMemo(
    () => Array.from(new Set(selectedTypes.map((t) => t.trim().toLowerCase()).filter(Boolean))).join(','),
    [selectedTypes]
  );

  const loadGraf = useCallback(async () => {
    setGrafLoading(true);
    setGrafError('');
    try {
      const qs = new URLSearchParams({
        tipe: selectedTypesParam,
        q: debouncedQuery,
        sertakan_sistem: String(includeSystem),
      });
      const res = await api<GraphResponse>(`/knowledge/graf?${qs.toString()}`);
      setGrafData(res);
      const backendCounts = res.stats?.type_counts;
      if (backendCounts && typeof backendCounts === 'object') {
        const normalized: Record<string, number> = {};
        for (const [k, v] of Object.entries(backendCounts)) {
          const key = k.trim().toLowerCase();
          if (key) normalized[key] = Number(v) || 0;
        }
        setStableTypeCounts(normalized);
      } else if (!selectedTypesParam) {
        const counted: Record<string, number> = {};
        for (const n of res.nodes ?? []) {
          const t = n.tipe.toLowerCase();
          counted[t] = (counted[t] ?? 0) + 1;
        }
        setStableTypeCounts(counted);
      }
    } catch (e) {
      setGrafError((e as Error).message);
    } finally {
      setGrafLoading(false);
    }
  }, [selectedTypesParam, debouncedQuery, includeSystem]);

  const loadDocs = useCallback(async () => {
    setDocsLoading(true);
    setDocsError('');
    try {
      const res = await api<{ data: KnowledgeDoc[] }>('/knowledge/dokumen');
      setDocs(res.data ?? []);
    } catch (e) {
      setDocsError((e as Error).message);
    } finally {
      setDocsLoading(false);
    }
  }, []);

  const loadRequests = useCallback(async () => {
    if (!isAdmin) return;
    setReqsLoading(true);
    setReqsError('');
    try {
      const res = await api<{ data: DeleteRequestItem[] }>('/knowledge/permintaan-hapus');
      setRequests(res.data ?? []);
    } catch (e) {
      setReqsError((e as Error).message);
    } finally {
      setReqsLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    loadGraf();
  }, [loadGraf]);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  useEffect(() => {
    if (isAdmin) loadRequests();
  }, [isAdmin, loadRequests]);

  const refreshAll = useCallback(() => {
    return Promise.all([loadGraf(), loadDocs(), ...(isAdmin ? [loadRequests()] : [])]);
  }, [loadGraf, loadDocs, isAdmin, loadRequests]);

  const handleFileUpload = async (file: File | null | undefined) => {
    if (!file || uploading) return;
    setActionBanner(null);
    setUploadResult(null);

    const lower = file.name.toLowerCase();
    const extValid = ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
    if (!extValid) {
      setActionBanner({
        kind: 'err',
        text: `Format berkas "${file.name}" tidak didukung. Gunakan: ${ALLOWED_EXTENSIONS.join(', ')}.`,
      });
      return;
    }
    if (file.size === 0) {
      setActionBanner({ kind: 'err', text: `Berkas "${file.name}" kosong (0 byte).` });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setActionBanner({
        kind: 'err',
        text: `Ukuran berkas "${file.name}" (${formatBytes(file.size)}) melebihi batas maksimal 5 MB.`,
      });
      return;
    }

    setUploading(true);
    try {
      const konten_base64 = await fileToBase64(file);
      const res = await api<UploadResult>('/knowledge/dokumen', {
        method: 'POST',
        body: { nama_file: file.name, konten_base64 },
        timeoutMs: 60000,
      });
      setUploadResult(res);
      if (res.dokumen) {
        setDocs((prev) => [res.dokumen, ...prev.filter((d) => d.id !== res.dokumen.id)]);
      }
      setActionBanner({
        kind: 'ok',
        text: `Dokumen "${res.dokumen?.nama_file || file.name}" berhasil diproses ke dalam Knowledge Graph.`,
      });
      await Promise.all([loadGraf(), loadDocs(), ...(isAdmin ? [loadRequests()] : [])]);
    } catch (e) {
      setActionBanner({ kind: 'err', text: (e as Error).message });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFileUpload(file);
  };

  const confirmRequestDelete = async () => {
    if (!requestDeleteDoc || dialogBusy) return;
    const trimmed = deleteReason.trim();
    if (trimmed.length < 3 || trimmed.length > 300) {
      setDeleteReasonErr('Alasan penghapusan harus diisi antara 3 hingga 300 karakter.');
      return;
    }
    setDialogBusy(true);
    setDeleteReasonErr('');
    try {
      await api(`/knowledge/dokumen/${requestDeleteDoc.id}/ajukan-hapus`, {
        method: 'POST',
        body: { alasan: trimmed },
      });
      setActionBanner({
        kind: 'ok',
        text: `Permintaan hapus untuk "${requestDeleteDoc.nama_file}" telah dikirim ke Admin untuk ditinjau.`,
      });
      setRequestDeleteDoc(null);
      setDeleteReason('');
      await refreshAll();
    } catch (e) {
      setDeleteReasonErr((e as Error).message);
    } finally {
      setDialogBusy(false);
    }
  };

  const confirmDirectDelete = async () => {
    if (!directDeleteDoc || dialogBusy) return;
    setDialogBusy(true);
    try {
      const deletedId = directDeleteDoc.id;
      await api(`/knowledge/dokumen/${deletedId}`, { method: 'DELETE' });
      setUploadResult((prev) => (prev?.dokumen?.id === deletedId ? null : prev));
      setDocs((prev) => prev.filter((d) => d.id !== deletedId));
      setActionBanner({
        kind: 'ok',
        text: `Dokumen "${directDeleteDoc.nama_file}" beserta entitas terkait telah dihapus.`,
      });
      setDirectDeleteDoc(null);
      await Promise.all([loadGraf(), loadDocs(), ...(isAdmin ? [loadRequests()] : [])]);
    } catch (e) {
      setActionBanner({ kind: 'err', text: (e as Error).message });
      setDirectDeleteDoc(null);
    } finally {
      setDialogBusy(false);
    }
  };

  const confirmReviewDecision = async () => {
    if (!reviewAction || dialogBusy) return;
    setDialogBusy(true);
    try {
      const deletedId = reviewAction.decision === 'setuju' ? reviewAction.req.document_id : null;
      const endpoint =
        reviewAction.decision === 'setuju'
          ? `/knowledge/permintaan-hapus/${reviewAction.req.id}/setuju`
          : `/knowledge/permintaan-hapus/${reviewAction.req.id}/tolak`;
      await api(endpoint, { method: 'POST' });
      if (deletedId !== null) {
        setUploadResult((prev) => (prev?.dokumen?.id === deletedId ? null : prev));
        setDocs((prev) => prev.filter((d) => d.id !== deletedId));
      }
      setActionBanner({
        kind: 'ok',
        text:
          reviewAction.decision === 'setuju'
            ? `Permintaan disetujui: dokumen "${reviewAction.req.nama_file}" telah dihapus.`
            : `Permintaan hapus untuk "${reviewAction.req.nama_file}" ditolak dan dokumen dipulihkan ke status aktif.`,
      });
      setReviewAction(null);
      await Promise.all([loadGraf(), loadDocs(), ...(isAdmin ? [loadRequests()] : [])]);
    } catch (e) {
      setActionBanner({ kind: 'err', text: (e as Error).message });
      setReviewAction(null);
    } finally {
      setDialogBusy(false);
    }
  };

  const tabs = useMemo(() => {
    const base: Array<{ key: TabKey; label: string; icon: typeof Network; badge?: number }> = [
      { key: 'graf', label: 'Visualisasi Graf', icon: Network },
      { key: 'dokumen', label: 'Dokumen Pengetahuan', icon: FileText, badge: docs.length || undefined },
    ];
    if (isAdmin) {
      const pendingCount =
        grafData?.stats?.menunggu_hapus ?? requests.filter((r) => r.status === 'menunggu').length;
      base.push({
        key: 'hapus',
        label: 'Permintaan Hapus',
        icon: Trash2,
        badge: pendingCount > 0 ? pendingCount : undefined,
      });
    }
    return base;
  }, [isAdmin, docs.length, grafData?.stats?.menunggu_hapus, requests]);

  const handleTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, currentIdx: number) => {
    let nextIdx: number | null = null;
    if (e.key === 'ArrowRight') nextIdx = (currentIdx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') nextIdx = (currentIdx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = tabs.length - 1;
    if (nextIdx !== null) {
      e.preventDefault();
      const target = tabs[nextIdx];
      setActiveTab(target.key);
      tabRefs.current[target.key]?.focus();
    }
  };

  const stats = grafData?.stats ?? {
    total_nodes: grafData?.nodes?.length ?? 0,
    total_edges: grafData?.edges?.length ?? 0,
    total_dokumen: docs.length,
    menunggu_hapus: requests.filter((r) => r.status === 'menunggu').length,
    konflik: 0,
  };

  const cellPad = density === 'compact' ? 'px-3 py-1.5' : 'px-4 py-3';
  const sortedRequests = useMemo(() => {
    return [...requests].sort((a, b) => {
      if (a.status === 'menunggu' && b.status !== 'menunggu') return -1;
      if (a.status !== 'menunggu' && b.status === 'menunggu') return 1;
      return b.id - a.id;
    });
  }, [requests]);

  return (
    <div className="mx-auto w-full max-w-7xl min-w-0 space-y-5">
      {/* Header & Refresh */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold tracking-tight text-[var(--text-primary)]">
            Knowledge Graph &amp; Dokumen Pengetahuan
          </h2>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            Peta keterhubungan entitas SMKN 4 Bandung (Jurusan, Kelas, Guru, Mitra PKL, Ekskul) beserta dokumen tambahan untuk AI.
          </p>
        </div>
        <button
          type="button"
          onClick={refreshAll}
          disabled={grafLoading || docsLoading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] shadow-sm transition-colors hover:bg-[var(--bg-elevated)] disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${grafLoading || docsLoading ? 'animate-spin' : ''}`} />
          <span>Muat Ulang</span>
        </button>
      </div>

      {/* Top KPI Strip */}
      <div className={`grid grid-cols-2 gap-3 ${isAdmin ? 'sm:grid-cols-3 lg:grid-cols-5' : 'sm:grid-cols-4'}`}>
        <div className="flex min-h-[84px] min-w-0 flex-col justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 shadow-sm">
          <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
            <span className="truncate">Total Entitas</span>
            <Network className="h-4 w-4 shrink-0 opacity-70" />
          </div>
          <p className="mt-1.5 text-2xl font-bold tracking-tight tabular-nums text-[var(--text-primary)]">
            {stats.total_nodes}
          </p>
        </div>

        <div className="flex min-h-[84px] min-w-0 flex-col justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 shadow-sm">
          <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
            <span className="truncate">Total Relasi</span>
            <GitFork className="h-4 w-4 shrink-0 opacity-70" />
          </div>
          <p className="mt-1.5 text-2xl font-bold tracking-tight tabular-nums text-[var(--text-primary)]">
            {stats.total_edges}
          </p>
        </div>

        <div className="flex min-h-[84px] min-w-0 flex-col justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 shadow-sm">
          <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
            <span className="truncate">Dokumen</span>
            <Layers className="h-4 w-4 shrink-0 opacity-70" />
          </div>
          <p className="mt-1.5 text-2xl font-bold tracking-tight tabular-nums text-[var(--text-primary)]">
            {stats.total_dokumen}
          </p>
        </div>

        <div className="flex min-h-[84px] min-w-0 flex-col justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 shadow-sm">
          <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
            <span className="truncate">Konflik / Saran</span>
            <AlertTriangle className={`h-4 w-4 shrink-0 ${stats.konflik > 0 ? 'text-rose-500' : 'opacity-70'}`} />
          </div>
          <p
            className={`mt-1.5 text-2xl font-bold tracking-tight tabular-nums ${
              stats.konflik > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-[var(--text-primary)]'
            }`}
          >
            {stats.konflik}
          </p>
        </div>

        {isAdmin && (
          <button
            type="button"
            onClick={() => setActiveTab('hapus')}
            title="Lihat permintaan hapus dokumen yang menunggu persetujuan"
            className="col-span-2 flex min-h-[84px] min-w-0 flex-col justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 text-left shadow-sm transition-colors hover:border-[var(--accent-ink)] sm:col-span-1"
          >
            <div className="flex w-full items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
              <span className="truncate">Hapus Menunggu</span>
              <Clock className={`h-4 w-4 shrink-0 ${stats.menunggu_hapus > 0 ? 'text-amber-500' : 'opacity-70'}`} />
            </div>
            <p
              className={`mt-1.5 text-2xl font-bold tracking-tight tabular-nums ${
                stats.menunggu_hapus > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--text-primary)]'
              }`}
            >
              {stats.menunggu_hapus}
            </p>
          </button>
        )}
      </div>

      {/* Tabs Navigation */}
      <div className="border-b border-[var(--border-subtle)]">
        <div
          role="tablist"
          aria-label="Navigasi Knowledge Graph"
          className="flex flex-wrap items-center gap-1"
        >
          {tabs.map((t, idx) => {
            const Icon = t.icon;
            const selected = activeTab === t.key;
            return (
              <button
                key={t.key}
                ref={(el) => {
                  tabRefs.current[t.key] = el;
                }}
                id={`knowledge-tab-${t.key}`}
                type="button"
                role="tab"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActiveTab(t.key)}
                onKeyDown={(e) => handleTabKeyDown(e, idx)}
                className={`relative flex shrink-0 items-center gap-2 rounded-t-lg px-3.5 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ink)] ${
                  selected
                    ? 'text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{t.label}</span>
                {t.badge !== undefined && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
                      t.key === 'hapus'
                        ? 'bg-amber-500/20 text-amber-800 dark:text-amber-300'
                        : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
                    }`}
                  >
                    {t.badge}
                  </span>
                )}
                {selected && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 border-b-2 border-[var(--accent-ink)]"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Global Feedback Banner */}
      {actionBanner && (
        <div
          role="status"
          className={`flex items-start justify-between gap-3 rounded-xl border p-3 text-sm ${
            actionBanner.kind === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-200'
          }`}
        >
          <div className="flex items-start gap-2">
            {actionBanner.kind === 'ok' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span>{actionBanner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionBanner(null)}
            aria-label="Tutup notifikasi"
            className="rounded p-0.5 opacity-70 hover:opacity-100"
          >
            <XCircle className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Tab Panel 1: Visualisasi Graf */}
      <div
        role="tabpanel"
        aria-labelledby="knowledge-tab-graf"
        hidden={activeTab !== 'graf'}
        tabIndex={activeTab === 'graf' ? 0 : undefined}
        className="min-w-0"
      >
        {activeTab === 'graf' && (
          <div className="min-w-0 space-y-3">
            {grafError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">
                Gagal memuat data graf: {grafError}
              </div>
            )}
            <KnowledgeGraphCanvas
              nodes={grafData?.nodes ?? []}
              edges={grafData?.edges ?? []}
              loading={grafLoading}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              selectedTypes={selectedTypes}
              onTypesChange={setSelectedTypes}
              typeCounts={stableTypeCounts}
              includeSystem={includeSystem}
              onIncludeSystemChange={setIncludeSystem}
            />
          </div>
        )}
      </div>

      {/* Tab Panel 2: Dokumen Pengetahuan */}
      <div
        role="tabpanel"
        aria-labelledby="knowledge-tab-dokumen"
        hidden={activeTab !== 'dokumen'}
        tabIndex={activeTab === 'dokumen' ? 0 : undefined}
        className="min-w-0"
      >
        {activeTab === 'dokumen' && (
          <div className="min-w-0 space-y-5">
            {/* Upload Widget */}
            <div
              onDragEnter={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragOver(false);
              }}
              onDrop={handleDrop}
              className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
                dragOver
                  ? 'border-[var(--accent-ink)] bg-[var(--bg-elevated)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.txt,.json,.csv,.xlsx,.pdf"
                className="sr-only"
                id="knowledge-doc-upload"
                disabled={uploading}
                onChange={(e) => handleFileUpload(e.target.files?.[0])}
              />
              <div className="mx-auto flex max-w-lg flex-col items-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)]">
                  {uploading ? (
                    <RefreshCw className="h-5 w-5 animate-spin" />
                  ) : (
                    <Upload className="h-5 w-5" />
                  )}
                </div>
                <h3 className="mt-3 text-sm font-semibold text-[var(--text-primary)]">
                  {uploading ? 'Mengekstrak teks & memetakan entitas graf…' : 'Unggah Dokumen Pengetahuan'}
                </h3>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  Seret dan lepas berkas di sini, atau pilih dari perangkat. Mendukung{' '}
                  <span className="font-mono">.md, .txt, .json, .csv, .xlsx, .pdf</span> (maks. 5 MB).
                </p>
                <label
                  htmlFor="knowledge-doc-upload"
                  className={`mt-4 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[var(--accent-ink)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink-fg)] shadow-sm transition-opacity hover:opacity-90 ${
                    uploading ? 'pointer-events-none opacity-50' : ''
                  }`}
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  <span>{uploading ? 'Sedang Memproses…' : 'Pilih Berkas Dokumen'}</span>
                </label>
              </div>
            </div>

            {/* Extracted Summary & Matched Entities after upload */}
            {uploadResult && (
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 shadow-sm space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    <h4 className="text-sm font-semibold text-[var(--text-primary)]">
                      Hasil Ekstraksi: {uploadResult.dokumen?.nama_file}
                    </h4>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('graf')}
                    className="text-xs font-semibold text-[var(--text-primary)] underline underline-offset-4 hover:opacity-80"
                  >
                    Lihat di Visualisasi Graf →
                  </button>
                </div>

                {uploadResult.dokumen?.ringkasan && (
                  <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 text-xs leading-relaxed text-[var(--text-primary)]">
                    {uploadResult.dokumen.ringkasan}
                  </p>
                )}

                {Array.isArray(uploadResult.matched_entities) && uploadResult.matched_entities.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                      Entitas Sekolah Terkait ({uploadResult.matched_entities.length})
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {uploadResult.matched_entities.map((ent, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-0.5 text-xs font-medium text-[var(--text-primary)]"
                        >
                          {formatEntityLabel(ent)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {Array.isArray(uploadResult.konflik) && uploadResult.konflik.length > 0 && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      <span>Terdeteksi Potensi Konflik / Tumpang Tindih ({uploadResult.konflik.length})</span>
                    </p>
                    <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs text-amber-800 dark:text-amber-200">
                      {uploadResult.konflik.map((k, idx) => (
                        <li key={idx}>{formatConflictLabel(k)}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Uploaded Documents Table */}
            <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-sm">
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  Daftar Dokumen Pengetahuan ({docs.length})
                </h3>
                {!isAdmin && (
                  <span className="text-[11px] text-[var(--text-secondary)]">
                    Penghapusan dokumen memerlukan persetujuan Admin
                  </span>
                )}
              </div>

              {docsLoading && docs.length === 0 ? (
                <div className="p-6 text-sm text-[var(--text-secondary)]">Memuat daftar dokumen…</div>
              ) : docsError ? (
                <div className="p-6 text-sm text-rose-600 dark:text-rose-400">{docsError}</div>
              ) : docs.length === 0 ? (
                <div className="p-8 text-center">
                  <FileText className="mx-auto h-8 w-8 text-[var(--text-secondary)] opacity-50" />
                  <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">Belum ada dokumen pengetahuan</p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    Unggah panduan sekolah, jadwal tambahan, atau profil mitra dalam format Markdown, PDF, XLSX, CSV, atau JSON.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                      <tr>
                        <th className={cellPad}>Dokumen</th>
                        <th className={cellPad}>Ringkasan</th>
                        <th className={cellPad}>Relasi</th>
                        <th className={cellPad}>Pengunggah</th>
                        <th className={cellPad}>Diunggah</th>
                        <th className={cellPad}>Status</th>
                        <th className={`${cellPad} text-right`}>Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)]">
                      {docs.map((doc) => {
                        const isPendingDelete = doc.status === 'menunggu_hapus';
                        return (
                          <tr key={doc.id} className="hover:bg-[var(--bg-elevated)]/60">
                            <td className={cellPad}>
                              <div className="flex items-center gap-2">
                                <span className="rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-[var(--text-secondary)]">
                                  {doc.tipe_file}
                                </span>
                                <div>
                                  <p className="font-medium text-[var(--text-primary)]">{doc.nama_file}</p>
                                  <p className="text-[11px] text-[var(--text-secondary)]">
                                    {formatBytes(doc.ukuran_bytes)}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className={`${cellPad} max-w-md text-xs text-[var(--text-secondary)]`}>
                              <p className="line-clamp-2 leading-relaxed">{doc.ringkasan || '—'}</p>
                            </td>
                            <td className={`${cellPad} whitespace-nowrap font-mono text-xs text-[var(--text-primary)]`}>
                              {doc.jumlah_relasi ?? 0}
                            </td>
                            <td className={`${cellPad} whitespace-nowrap text-xs text-[var(--text-primary)]`}>
                              {doc.pengunggah || '—'}
                            </td>
                            <td className={`${cellPad} whitespace-nowrap text-xs text-[var(--text-secondary)]`}>
                              {formatDateWib(doc.dibuat_pada)}
                            </td>
                            <td className={`${cellPad} whitespace-nowrap`}>{docStatusBadge(doc.status)}</td>
                            <td className={`${cellPad} whitespace-nowrap text-right`}>
                              {isAdmin ? (
                                <button
                                  type="button"
                                  onClick={() => setDirectDeleteDoc(doc)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-500/20 dark:text-rose-300"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  <span>Hapus</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={isPendingDelete}
                                  onClick={() => {
                                    setRequestDeleteDoc(doc);
                                    setDeleteReason('');
                                    setDeleteReasonErr('');
                                  }}
                                  className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] hover:border-amber-500/50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  <span>{isPendingDelete ? 'Diajukan' : 'Ajukan Hapus'}</span>
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Tab Panel 3: Permintaan Hapus (Admin Only) */}
      {isAdmin && (
        <div
          role="tabpanel"
          aria-labelledby="knowledge-tab-hapus"
          hidden={activeTab !== 'hapus'}
          tabIndex={activeTab === 'hapus' ? 0 : undefined}
          className="min-w-0"
        >
          {activeTab === 'hapus' && (
            <div className="min-w-0 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-sm">
              <div className="border-b border-[var(--border-subtle)] px-4 py-3">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  Tinjauan Permintaan Hapus Dokumen ({sortedRequests.length})
                </h3>
                <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                  Setujui untuk menghapus dokumen beserta simpul dan relasinya dari Knowledge Graph, atau tolak untuk memulihkan status aktif.
                </p>
              </div>

              {reqsLoading && sortedRequests.length === 0 ? (
                <div className="p-6 text-sm text-[var(--text-secondary)]">Memuat permintaan hapus…</div>
              ) : reqsError ? (
                <div className="p-6 text-sm text-rose-600 dark:text-rose-400">{reqsError}</div>
              ) : sortedRequests.length === 0 ? (
                <div className="p-8 text-center">
                  <CheckCircle2 className="mx-auto h-8 w-8 text-[var(--text-secondary)] opacity-50" />
                  <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">Tidak ada permintaan hapus</p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    Semua pengajuan penghapusan dokumen dari guru atau staf akan muncul di sini.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                      <tr>
                        <th className={cellPad}>Dokumen</th>
                        <th className={cellPad}>Pemohon</th>
                        <th className={cellPad}>Alasan</th>
                        <th className={cellPad}>Diajukan</th>
                        <th className={cellPad}>Status</th>
                        <th className={cellPad}>Diproses</th>
                        <th className={`${cellPad} text-right`}>Tindakan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)]">
                      {sortedRequests.map((req) => (
                        <tr key={req.id} className="hover:bg-[var(--bg-elevated)]/60">
                          <td className={`${cellPad} font-medium text-[var(--text-primary)]`}>{req.nama_file}</td>
                          <td className={`${cellPad} whitespace-nowrap text-xs text-[var(--text-primary)]`}>
                            {req.pemohon}
                          </td>
                          <td className={`${cellPad} max-w-md text-xs text-[var(--text-secondary)]`}>
                            <p className="whitespace-pre-wrap break-words">{req.alasan}</p>
                          </td>
                          <td className={`${cellPad} whitespace-nowrap text-xs text-[var(--text-secondary)]`}>
                            {formatDateWib(req.dibuat_pada)}
                          </td>
                          <td className={`${cellPad} whitespace-nowrap`}>{requestStatusBadge(req.status)}</td>
                          <td className={`${cellPad} whitespace-nowrap text-xs text-[var(--text-secondary)]`}>
                            {req.diproses_oleh_nama ? (
                              <div>
                                <p className="text-[var(--text-primary)]">{req.diproses_oleh_nama}</p>
                                <p className="text-[11px]">{formatDateWib(req.diproses_pada)}</p>
                              </div>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className={`${cellPad} whitespace-nowrap text-right`}>
                            {req.status === 'menunggu' ? (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setReviewAction({ req, decision: 'setuju' })}
                                  className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-500/20 dark:text-rose-300"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  <span>Setujui &amp; Hapus</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setReviewAction({ req, decision: 'tolak' })}
                                  className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--accent-ink)]"
                                >
                                  <XCircle className="h-3.5 w-3.5" />
                                  <span>Tolak</span>
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-[var(--text-secondary)]">Selesai</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Dialog: Ajukan Hapus (Non-Admin) */}
      <ConfirmDialog
        open={Boolean(requestDeleteDoc)}
        title="Ajukan Penghapusan Dokumen"
        description={
          requestDeleteDoc
            ? `Pengajuan hapus untuk "${requestDeleteDoc.nama_file}" akan ditinjau oleh Admin sebelum dokumen dihapus dari Knowledge Graph.`
            : ''
        }
        confirmLabel="Kirim Pengajuan"
        cancelLabel="Batal"
        busy={dialogBusy}
        onCancel={() => {
          if (!dialogBusy) setRequestDeleteDoc(null);
        }}
        onConfirm={confirmRequestDelete}
      >
        <div className="space-y-1.5">
          <label
            htmlFor="delete-request-reason"
            className="block text-xs font-medium text-[var(--text-primary)]"
          >
            Alasan penghapusan <span className="text-rose-600">*</span>
          </label>
          <textarea
            id="delete-request-reason"
            name="alasan"
            rows={3}
            minLength={3}
            maxLength={300}
            required
            value={deleteReason}
            onChange={(e) => {
              setDeleteReason(e.target.value);
              if (deleteReasonErr) setDeleteReasonErr('');
            }}
            placeholder="Jelaskan alasan penghapusan (min. 3 karakter, mis. dokumen sudah digantikan versi terbaru)..."
            className="input resize-y"
          />
          <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
            <span>Minimal 3 karakter, maksimal 300 karakter.</span>
            <span>{deleteReason.trim().length}/300</span>
          </div>
          {deleteReasonErr && (
            <p className="text-xs font-medium text-rose-600 dark:text-rose-400">{deleteReasonErr}</p>
          )}
        </div>
      </ConfirmDialog>

      {/* Dialog: Hapus Langsung (Admin) */}
      <ConfirmDialog
        open={Boolean(directDeleteDoc)}
        title="Hapus Dokumen Pengetahuan"
        description={
          directDeleteDoc
            ? `Hapus "${directDeleteDoc.nama_file}"? Dokumen dan simpul/relasi yang berasal khusus dari dokumen ini akan dinonaktifkan dari Knowledge Graph.`
            : ''
        }
        confirmLabel="Ya, Hapus Dokumen"
        cancelLabel="Batal"
        destructive
        busy={dialogBusy}
        onCancel={() => {
          if (!dialogBusy) setDirectDeleteDoc(null);
        }}
        onConfirm={confirmDirectDelete}
      />

      {/* Dialog: Tinjau Permintaan Hapus (Admin) */}
      <ConfirmDialog
        open={Boolean(reviewAction)}
        title={reviewAction?.decision === 'setuju' ? 'Setujui & Hapus Dokumen' : 'Tolak Permintaan Hapus'}
        description={
          reviewAction
            ? reviewAction.decision === 'setuju'
              ? `Setujui pengajuan dari ${reviewAction.req.pemohon} dan hapus dokumen "${reviewAction.req.nama_file}" beserta entitas terkait?`
              : `Tolak pengajuan dari ${reviewAction.req.pemohon} dan kembalikan dokumen "${reviewAction.req.nama_file}" menjadi aktif?`
            : ''
        }
        confirmLabel={reviewAction?.decision === 'setuju' ? 'Setujui & Hapus' : 'Tolak Pengajuan'}
        cancelLabel="Batal"
        destructive={reviewAction?.decision === 'setuju'}
        busy={dialogBusy}
        onCancel={() => {
          if (!dialogBusy) setReviewAction(null);
        }}
        onConfirm={confirmReviewDecision}
      />
    </div>
  );
}

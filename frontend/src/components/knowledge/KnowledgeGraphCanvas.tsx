'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Compass,
  FileText,
  FolderTree,
  Info,
  Layers,
  Maximize2,
  MessageSquare,
  Pause,
  Play,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { preferences } from '@/lib/preferences';

export type GraphNode = {
  id: string;
  kunci: string;
  label: string;
  tipe: string;
  sumber: string;
  status: string;
  metadata?: Record<string, unknown>;
  document_id?: number | null;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  relasi: string;
  status: string;
  catatan?: string;
  document_id?: number | null;
};

type SimNode = {
  id: string;
  node: GraphNode;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  degree: number;
  color: string;
  isHub: boolean;
  fx: number | null;
  fy: number | null;
};

type SimEdge = {
  edge: GraphEdge;
  sourceIdx: number;
  targetIdx: number;
};

type ForceSettings = {
  repelForce: number;
  linkDistance: number;
  centerForce: number;
  showLabels: boolean;
  showArrows: boolean;
};

type ThemePalette = {
  isDark: boolean;
  bgCanvas: string;
  bgSurface: string;
  textPrimary: string;
  textSecondary: string;
  borderSubtle: string;
  accentInk: string;
  accentInkFg: string;
  edgeIdle: string;
  gridDot: string;
};

type TypeVisual = {
  label: string;
  color: string;
  darkColor: string;
  badgeClass: string;
};

type PanelMode = 'direktori' | 'inspektor';

type LabelCandidate = {
  x: number;
  y: number;
  text: string;
  alpha: number;
  bold: boolean;
  fontSize: number;
  priority: number;
  forceDraw: boolean;
};

type ConnectionItem = {
  edge: GraphEdge;
  neighbor: GraphNode;
  direction: 'out' | 'in';
};

const DEFAULT_FORCES: ForceSettings = {
  repelForce: 6800,
  linkDistance: 175,
  centerForce: 0.0022,
  showLabels: true,
  showArrows: false,
};

const TYPE_CONFIG: Record<string, TypeVisual> = {
  sekolah: {
    label: 'Sekolah',
    color: '#18181B',
    darkColor: '#F4F4F5',
    badgeClass: 'bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900 border-zinc-700/30',
  },
  jurusan: {
    label: 'Jurusan',
    color: '#4F46E5',
    darkColor: '#818CF8',
    badgeClass: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30',
  },
  kelas: {
    label: 'Kelas',
    color: '#0284C7',
    darkColor: '#38BDF8',
    badgeClass: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  },
  guru: {
    label: 'Guru',
    color: '#0D9488',
    darkColor: '#2DD4BF',
    badgeClass: 'bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30',
  },
  perusahaan: {
    label: 'Mitra PKL',
    color: '#D97706',
    darkColor: '#FBBF24',
    badgeClass: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30',
  },
  ekskul: {
    label: 'Ekskul',
    color: '#7C3AED',
    darkColor: '#A78BFA',
    badgeClass: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30',
  },
  dokumen: {
    label: 'Dokumen',
    color: '#E11D48',
    darkColor: '#FB7185',
    badgeClass: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
  },
  topik: {
    label: 'Topik',
    color: '#65A30D',
    darkColor: '#A3E635',
    badgeClass: 'bg-lime-500/15 text-lime-800 dark:text-lime-300 border-lime-500/30',
  },
};

const DEFAULT_TYPE_VISUAL: TypeVisual = {
  label: 'Entitas',
  color: '#71717A',
  darkColor: '#A1A1AA',
  badgeClass: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border-zinc-500/30',
};

const KNOWN_TYPE_ORDER = ['sekolah', 'jurusan', 'kelas', 'guru', 'perusahaan', 'ekskul', 'dokumen', 'topik'];
const MIN_SCALE = 0.2;
const MAX_SCALE = 3.2;

function getTypeVisual(tipe: string): TypeVisual {
  return (
    TYPE_CONFIG[tipe.toLowerCase()] ?? {
      ...DEFAULT_TYPE_VISUAL,
      label: tipe ? tipe.charAt(0).toUpperCase() + tipe.slice(1) : 'Entitas',
    }
  );
}

function readThemePalette(): ThemePalette {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return {
      isDark: false,
      bgCanvas: '#FAF9F6',
      bgSurface: '#FFFFFF',
      textPrimary: '#18181B',
      textSecondary: '#52525B',
      borderSubtle: '#E4E4E0',
      accentInk: '#18181B',
      accentInkFg: '#FAF9F6',
      edgeIdle: 'rgba(113, 113, 122, 0.26)',
      gridDot: 'rgba(113, 113, 122, 0.16)',
    };
  }
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const explicit = root.dataset.theme;
  const osDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  const isDark = explicit === 'dark' || (explicit !== 'light' && osDark);

  const pick = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    isDark,
    bgCanvas: pick('--bg-canvas', isDark ? '#141413' : '#FAF9F6'),
    bgSurface: pick('--bg-surface', isDark ? '#1B1B1E' : '#FFFFFF'),
    textPrimary: pick('--text-primary', isDark ? '#F4F4F5' : '#18181B'),
    textSecondary: pick('--text-secondary', isDark ? '#A1A1AA' : '#52525B'),
    borderSubtle: pick('--border-subtle', isDark ? '#27272A' : '#E4E4E0'),
    accentInk: pick('--accent-ink', isDark ? '#F4F4F5' : '#18181B'),
    accentInkFg: pick('--accent-ink-fg', isDark ? '#141413' : '#FAF9F6'),
    edgeIdle: isDark ? 'rgba(161, 161, 170, 0.22)' : 'rgba(113, 113, 122, 0.26)',
    gridDot: isDark ? 'rgba(255, 255, 255, 0.065)' : 'rgba(24, 24, 27, 0.07)',
  };
}

function truncateLabel(text: string, max = 22): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function buildAiQuestion(node: GraphNode): string {
  const label = node.label;
  switch (node.tipe.toLowerCase()) {
    case 'kelas':
      return `Tampilkan wali kelas, jadwal pelajaran, atau ringkasan siswa kelas ${label}`;
    case 'guru':
      return `Bagaimana jadwal mengajar guru ${label}?`;
    case 'perusahaan':
      return `Siapa saja siswa yang ditempatkan PKL di ${label} dan apa posisinya?`;
    case 'ekskul':
      return `Informasi kegiatan, pembina, dan anggota ekstrakurikuler ${label}`;
    case 'jurusan':
      return `Jelaskan informasi program keahlian ${label} di SMKN 4 Bandung`;
    case 'dokumen':
      return `Ringkas informasi penting dari dokumen ${label}`;
    default:
      return `Jelaskan informasi tentang ${label} di SMKN 4 Bandung`;
  }
}

function formatMetaKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatMetaValue(val: unknown): string {
  if (val === null || val === undefined || val === '') return '—';
  if (typeof val === 'boolean') return val ? 'Ya' : 'Tidak';
  if (Array.isArray(val)) return val.map((v) => String(v)).join(', ');
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

function formatRelationTitle(relasi: string): string {
  return relasi.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return hex;
}

/**
 * Inisialisasi posisi berbasis sektor klaster agar graf langsung tertata tanpa menggumpal:
 * sekolah di pusat, 5 jurusan di r=260, kelas & perusahaan di sektor jurusannya,
 * wali kelas di dekat kelasnya, ekskul & guru non-wali di busur luar lapang, dokumen/topik di dekat simpul terhubung.
 */
function computeSectorLayout(nodes: GraphNode[], edges: GraphEdge[]): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  const byId = new Map<string, GraphNode>();
  for (const n of nodes) byId.set(n.id, n);

  const sekolahNodes = nodes.filter((n) => n.tipe.toLowerCase() === 'sekolah');
  const jurusanNodes = nodes
    .filter((n) => n.tipe.toLowerCase() === 'jurusan')
    .sort((a, b) => a.kunci.localeCompare(b.kunci));
  const kelasNodes = nodes.filter((n) => n.tipe.toLowerCase() === 'kelas');
  const perusahaanNodes = nodes.filter((n) => n.tipe.toLowerCase() === 'perusahaan');
  const guruNodes = nodes.filter((n) => n.tipe.toLowerCase() === 'guru');
  const ekskulNodes = nodes.filter((n) => n.tipe.toLowerCase() === 'ekskul');
  const dokumenNodes = nodes.filter((n) => n.tipe.toLowerCase() === 'dokumen');
  const topikNodes = nodes.filter((n) => n.tipe.toLowerCase() === 'topik');

  // 1. Sekolah di pusat
  sekolahNodes.forEach((n, i) => {
    pos.set(n.id, { x: i * 48, y: 0 });
  });

  // 2. Jurusan merata pada lingkaran r = 260
  const jurusanAngles = new Map<string, number>();
  const jurusanCodeAngles = new Map<string, number>();
  const jCount = Math.max(1, jurusanNodes.length);
  const sectorSpan = (Math.PI * 2) / jCount;

  jurusanNodes.forEach((n, idx) => {
    const angle = -Math.PI / 2 + idx * sectorSpan;
    pos.set(n.id, { x: Math.cos(angle) * 260, y: Math.sin(angle) * 260 });
    jurusanAngles.set(n.id, angle);
    const code = String(n.metadata?.kode || n.kunci.split(':')[1] || '')
      .trim()
      .toUpperCase();
    if (code) jurusanCodeAngles.set(code, angle);
  });

  // Peta relasi bantu
  const nodeNeighbors = new Map<string, string[]>();
  const kelasParentJurusanAngle = new Map<string, number>();
  const compParentJurusanAngle = new Map<string, number>();
  const waliToKelasId = new Map<string, string>();
  const docNeighbors = new Map<string, string[]>();
  const topicNeighbors = new Map<string, string[]>();

  const pushNb = (m: Map<string, string[]>, k: string, v: string) => {
    const arr = m.get(k);
    if (arr) arr.push(v);
    else m.set(k, [v]);
  };

  for (const e of edges) {
    pushNb(nodeNeighbors, e.source, e.target);
    pushNb(nodeNeighbors, e.target, e.source);

    const src = byId.get(e.source);
    const tgt = byId.get(e.target);
    if (!src || !tgt) continue;
    const st = src.tipe.toLowerCase();
    const tt = tgt.tipe.toLowerCase();

    if (st === 'jurusan' && tt === 'kelas' && jurusanAngles.has(src.id)) {
      kelasParentJurusanAngle.set(tgt.id, jurusanAngles.get(src.id)!);
    } else if (st === 'jurusan' && tt === 'perusahaan' && jurusanAngles.has(src.id)) {
      compParentJurusanAngle.set(tgt.id, jurusanAngles.get(src.id)!);
    } else if (st === 'guru' && tt === 'kelas' && e.relasi === 'wali_kelas') {
      if (!waliToKelasId.has(src.id)) waliToKelasId.set(src.id, tgt.id);
    } else if (st === 'dokumen') {
      pushNb(docNeighbors, src.id, tgt.id);
      if (tt === 'topik') pushNb(topicNeighbors, tgt.id, src.id);
    } else if (tt === 'dokumen') {
      pushNb(docNeighbors, tgt.id, src.id);
      if (st === 'topik') pushNb(topicNeighbors, src.id, tgt.id);
    }
  }

  // Fallback metadata.jurusan_kode bila edge belum tersedia
  for (const k of kelasNodes) {
    if (!kelasParentJurusanAngle.has(k.id)) {
      const code = String(k.metadata?.jurusan_kode || '').trim().toUpperCase();
      if (code && jurusanCodeAngles.has(code)) {
        kelasParentJurusanAngle.set(k.id, jurusanCodeAngles.get(code)!);
      }
    }
  }
  for (const p of perusahaanNodes) {
    if (!compParentJurusanAngle.has(p.id)) {
      const code = String(p.metadata?.jurusan_kode || '').trim().toUpperCase();
      if (code && jurusanCodeAngles.has(code)) {
        compParentJurusanAngle.set(p.id, jurusanCodeAngles.get(code)!);
      }
    }
  }

  // 3. Kelas di dalam busur dalam sektor jurusannya
  const kelasBuckets = new Map<string, GraphNode[]>();
  for (const k of kelasNodes) {
    const ang = kelasParentJurusanAngle.get(k.id);
    const key = ang !== undefined ? ang.toFixed(4) : 'none';
    const arr = kelasBuckets.get(key);
    if (arr) arr.push(k);
    else kelasBuckets.set(key, [k]);
  }
  for (const [key, list] of kelasBuckets.entries()) {
    if (key === 'none') {
      list.forEach((n, i) => {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / Math.max(1, list.length);
        const r = 380 + (i % 2) * 48;
        pos.set(n.id, { x: Math.cos(a) * r, y: Math.sin(a) * r });
      });
    } else {
      const baseAngle = Number(key);
      const spread = Math.min(sectorSpan * 0.68, Math.max(0.24, list.length * 0.14));
      list.forEach((n, i) => {
        const frac = list.length === 1 ? 0 : i / (list.length - 1) - 0.5;
        const a = baseAngle + frac * spread;
        const r = 395 + (i % 2) * 44;
        pos.set(n.id, { x: Math.cos(a) * r, y: Math.sin(a) * r });
      });
    }
  }

  // 4. Mitra PKL (perusahaan) di busur luar sektor jurusannya
  const compBuckets = new Map<string, GraphNode[]>();
  for (const p of perusahaanNodes) {
    const ang = compParentJurusanAngle.get(p.id);
    const key = ang !== undefined ? ang.toFixed(4) : 'none';
    const arr = compBuckets.get(key);
    if (arr) arr.push(p);
    else compBuckets.set(key, [p]);
  }
  for (const [key, list] of compBuckets.entries()) {
    if (key === 'none') {
      list.forEach((n, i) => {
        const a = -Math.PI / 2 + 0.15 + (i * Math.PI * 2) / Math.max(1, list.length);
        const r = 490 + (i % 2) * 52;
        pos.set(n.id, { x: Math.cos(a) * r, y: Math.sin(a) * r });
      });
    } else {
      const baseAngle = Number(key);
      const spread = Math.min(sectorSpan * 0.78, Math.max(0.32, list.length * 0.11));
      list.forEach((n, i) => {
        const frac = list.length === 1 ? 0 : i / (list.length - 1) - 0.5;
        const a = baseAngle + frac * spread;
        const r = 515 + (i % 3) * 46;
        pos.set(n.id, { x: Math.cos(a) * r, y: Math.sin(a) * r });
      });
    }
  }

  // 5. Guru: wali kelas dekat kelasnya; guru lain di busur luar yang lapang
  const nonWaliGurus: GraphNode[] = [];
  const kelasWaliCount = new Map<string, number>();
  for (const g of guruNodes) {
    const kelasId = waliToKelasId.get(g.id);
    const kPos = kelasId ? pos.get(kelasId) : undefined;
    if (kelasId && kPos) {
      const seen = kelasWaliCount.get(kelasId) ?? 0;
      kelasWaliCount.set(kelasId, seen + 1);
      const kAng = Math.atan2(kPos.y, kPos.x) + seen * 0.14;
      const kDist = Math.hypot(kPos.x, kPos.y) + 74;
      pos.set(g.id, { x: Math.cos(kAng) * kDist, y: Math.sin(kAng) * kDist });
    } else {
      nonWaliGurus.push(g);
    }
  }

  nonWaliGurus.forEach((g, idx) => {
    const a = -Math.PI / 2 + 0.18 + (idx * Math.PI * 2) / Math.max(1, nonWaliGurus.length);
    const r = 685 + (idx % 2) * 56;
    pos.set(g.id, { x: Math.cos(a) * r, y: Math.sin(a) * r });
  });

  // 6. Ekskul di busur luar terpisah antar sektor
  ekskulNodes.forEach((ek, idx) => {
    const a = -Math.PI / 2 + sectorSpan * 0.5 + (idx * Math.PI * 2) / Math.max(1, ekskulNodes.length);
    const r = 585 + (idx % 2) * 52;
    pos.set(ek.id, { x: Math.cos(a) * r, y: Math.sin(a) * r });
  });

  // 7. Dokumen di sekitar sentroid entitas terkait
  dokumenNodes.forEach((doc, idx) => {
    const nbs = (docNeighbors.get(doc.id) ?? []).filter((nid) => pos.has(nid));
    if (nbs.length > 0) {
      let cx = 0;
      let cy = 0;
      for (const nid of nbs) {
        const p = pos.get(nid)!;
        cx += p.x;
        cy += p.y;
      }
      cx /= nbs.length;
      cy /= nbs.length;
      const dist = Math.hypot(cx, cy);
      if (dist < 40) {
        const a = -Math.PI / 3 + idx * 1.15;
        pos.set(doc.id, { x: Math.cos(a) * 320, y: Math.sin(a) * 320 });
      } else {
        const ang = Math.atan2(cy, cx) + ((idx % 3) - 1) * 0.18;
        const r = Math.min(540, Math.max(250, dist + 115));
        pos.set(doc.id, { x: Math.cos(ang) * r, y: Math.sin(ang) * r });
      }
    } else {
      const a = -Math.PI / 4 + idx * 1.05;
      pos.set(doc.id, { x: Math.cos(a) * 330, y: Math.sin(a) * 330 });
    }
  });

  // 8. Topik di sekitar dokumen yang membahasnya
  topikNodes.forEach((top, idx) => {
    const parents = (topicNeighbors.get(top.id) ?? nodeNeighbors.get(top.id) ?? []).filter((nid) =>
      pos.has(nid)
    );
    if (parents.length > 0) {
      const base = pos.get(parents[0])!;
      const baseAng = Math.atan2(base.y, base.x);
      const baseR = Math.hypot(base.x, base.y);
      const fan = ((idx % 5) - 2) * 0.28;
      const r = baseR + 95 + (idx % 2) * 24;
      pos.set(top.id, { x: Math.cos(baseAng + fan) * r, y: Math.sin(baseAng + fan) * r });
    } else {
      const a = idx * 1.3;
      pos.set(top.id, { x: Math.cos(a) * 410, y: Math.sin(a) * 410 });
    }
  });

  // 9. Tipe lain yang tidak terduga
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  nodes.forEach((n, idx) => {
    if (!pos.has(n.id)) {
      const r = 340 + 36 * Math.sqrt(idx + 1);
      const a = idx * goldenAngle;
      pos.set(n.id, { x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
  });

  return pos;
}

export default function KnowledgeGraphCanvas({
  nodes,
  edges,
  loading = false,
  searchQuery,
  onSearchChange,
  selectedTypes,
  onTypesChange,
  typeCounts,
  includeSystem,
  onIncludeSystemChange,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  loading?: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedTypes: string[];
  onTypesChange: (next: string[]) => void;
  typeCounts?: Record<string, number>;
  includeSystem: boolean;
  onIncludeSystemChange: (val: boolean) => void;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [forcesOpen, setForcesOpen] = useState(false);
  const [forces, setForces] = useState<ForceSettings>(DEFAULT_FORCES);
  const [physicsPaused, setPhysicsPaused] = useState(false);
  const [panelMode, setPanelMode] = useState<PanelMode>('direktori');
  const [dirFilter, setDirFilter] = useState('');
  const [expandedBranches, setExpandedBranches] = useState<Record<string, boolean>>({
    jurusan: true,
    ekskul: false,
    guru: false,
    guru_wali: true,
    guru_lain: false,
    dokumen: true,
  });
  const [cursorStyle, setCursorStyle] = useState<'grab' | 'grabbing' | 'pointer'>('grab');
  const [isDarkTheme, setIsDarkTheme] = useState(false);
  const [liveAnnouncement, setLiveAnnouncement] = useState('');

  // State simulasi dan kamera di ref agar loop 60fps berjalan tanpa memicu re-render React
  const simNodesRef = useRef<SimNode[]>([]);
  const simNodeIndexRef = useRef<Map<string, number>>(new Map());
  const simEdgesRef = useRef<SimEdge[]>([]);
  const alphaRef = useRef(1);
  const needsDrawRef = useRef(true);
  const sizeRef = useRef({ width: 840, height: 540 });
  const cameraRef = useRef({ x: 420, y: 270, scale: 0.9 });
  const paletteRef = useRef<ThemePalette>(readThemePalette());
  const forcesRef = useRef<ForceSettings>(DEFAULT_FORCES);
  const physicsPausedRef = useRef(false);
  const driftTimeRef = useRef(0);
  const lastFrameTsRef = useRef<number | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const neighborIdsRef = useRef<Set<string>>(new Set());
  const connectedEdgeIdsRef = useRef<Set<string>>(new Set());
  const matchingIdsRef = useRef<Set<string> | null>(null);
  const reducedMotionRef = useRef(false);

  const gestureRef = useRef<{
    kind: 'pan' | 'node';
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startCamX: number;
    startCamY: number;
    nodeIdx?: number;
    nodeStartX?: number;
    nodeStartY?: number;
    moved: boolean;
  } | null>(null);

  forcesRef.current = forces;
  physicsPausedRef.current = physicsPaused;

  // Map cepat untuk Inspector, Direktori, & lookup
  const nodeById = useMemo(() => {
    const m = new Map<string, GraphNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  const activeId = hoveredId ?? selectedId;

  const { neighborIds, connectedEdgeIds } = useMemo(() => {
    const nSet = new Set<string>();
    const eSet = new Set<string>();
    if (!activeId) return { neighborIds: nSet, connectedEdgeIds: eSet };
    nSet.add(activeId);
    for (const e of edges) {
      if (e.source === activeId) {
        nSet.add(e.target);
        eSet.add(e.id);
      } else if (e.target === activeId) {
        nSet.add(e.source);
        eSet.add(e.id);
      }
    }
    return { neighborIds: nSet, connectedEdgeIds: eSet };
  }, [activeId, edges]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const matchingIds = useMemo(() => {
    if (!normalizedQuery) return null;
    const set = new Set<string>();
    for (const n of nodes) {
      const metaText = n.metadata ? JSON.stringify(n.metadata).toLowerCase() : '';
      if (
        n.label.toLowerCase().includes(normalizedQuery) ||
        n.kunci.toLowerCase().includes(normalizedQuery) ||
        n.tipe.toLowerCase().includes(normalizedQuery) ||
        metaText.includes(normalizedQuery)
      ) {
        set.add(n.id);
      }
    }
    return set;
  }, [nodes, normalizedQuery]);

  selectedIdRef.current = selectedId;
  hoveredIdRef.current = hoveredId;
  neighborIdsRef.current = neighborIds;
  connectedEdgeIdsRef.current = connectedEdgeIds;
  matchingIdsRef.current = matchingIds;
  needsDrawRef.current = true;

  const normalizedSelectedTypes = useMemo(
    () => Array.from(new Set(selectedTypes.map((t) => t.trim().toLowerCase()).filter(Boolean))),
    [selectedTypes]
  );

  const selectedTypeSet = useMemo(() => new Set(normalizedSelectedTypes), [normalizedSelectedTypes]);

  const toggleEntityType = useCallback(
    (tipe: string) => {
      const lower = tipe.toLowerCase();
      const exists = selectedTypeSet.has(lower);
      const next = exists
        ? normalizedSelectedTypes.filter((t) => t !== lower)
        : [...normalizedSelectedTypes, lower];
      onTypesChange(next);
    },
    [normalizedSelectedTypes, selectedTypeSet, onTypesChange]
  );

  // Hitung jenis node & jumlahnya untuk chips (stabil saat terfilter) & legend kanvas
  const visibleTypeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of nodes) {
      const t = n.tipe.toLowerCase();
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return counts;
  }, [nodes]);

  const hasStableTypeCounts = useMemo(
    () => Boolean(typeCounts && Object.keys(typeCounts).length > 0),
    [typeCounts]
  );

  const presentTypes = useMemo(() => {
    const ordered = [...KNOWN_TYPE_ORDER];
    for (const t of visibleTypeCounts.keys()) {
      if (!ordered.includes(t)) ordered.push(t);
    }
    if (typeCounts) {
      for (const rawKey of Object.keys(typeCounts)) {
        const t = rawKey.trim().toLowerCase();
        if (t && !ordered.includes(t)) ordered.push(t);
      }
    }
    return ordered.map((t) => ({
      tipe: t,
      count: hasStableTypeCounts ? (typeCounts?.[t] ?? 0) : (visibleTypeCounts.get(t) ?? 0),
      visibleCount: visibleTypeCounts.get(t) ?? 0,
      visual: getTypeVisual(t),
    }));
  }, [visibleTypeCounts, typeCounts, hasStableTypeCounts]);

  const totalAllCount = useMemo(() => {
    if (hasStableTypeCounts && typeCounts) {
      return Object.values(typeCounts).reduce((acc, val) => acc + (Number(val) || 0), 0);
    }
    return nodes.length;
  }, [hasStableTypeCounts, typeCounts, nodes.length]);

  const relationCaption = useMemo(() => {
    const statsText = `${nodes.length} simpul · ${edges.length} relasi`;
    if (normalizedSelectedTypes.length === 0) {
      return `Menampilkan seluruh jaringan entitas & relasi — ${statsText}`;
    }
    const labels = normalizedSelectedTypes.map((t) => getTypeVisual(t).label);
    return `Menampilkan tipe ${labels.join(' + ')} — ${statsText}`;
  }, [normalizedSelectedTypes, nodes.length, edges.length]);

  const quickAccessNodes = useMemo(() => {
    const primary = nodes.filter((n) => ['sekolah', 'jurusan', 'dokumen'].includes(n.tipe.toLowerCase()));
    if (primary.length > 0) return primary.slice(0, 10);
    const deg = new Map<string, number>();
    for (const e of edges) {
      deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
      deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
    }
    return [...nodes]
      .sort((a, b) => (deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0) || a.label.localeCompare(b.label, 'id'))
      .slice(0, 8);
  }, [nodes, edges]);

  const selectedNode = selectedId ? nodeById.get(selectedId) ?? null : null;

  const selectedConnections = useMemo(() => {
    if (!selectedNode) return [];
    const list: ConnectionItem[] = [];
    for (const e of edges) {
      if (e.source === selectedNode.id) {
        const nb = nodeById.get(e.target);
        if (nb) list.push({ edge: e, neighbor: nb, direction: 'out' });
      } else if (e.target === selectedNode.id) {
        const nb = nodeById.get(e.source);
        if (nb) list.push({ edge: e, neighbor: nb, direction: 'in' });
      }
    }
    return list;
  }, [selectedNode, edges, nodeById]);

  const groupedSelectedConnections = useMemo(() => {
    const groups = new Map<string, ConnectionItem[]>();
    for (const item of selectedConnections) {
      const key = item.edge.relasi;
      const arr = groups.get(key);
      if (arr) arr.push(item);
      else groups.set(key, [item]);
    }
    return Array.from(groups.entries()).map(([relasi, items]) => ({
      relasi,
      title: formatRelationTitle(relasi),
      items: items.sort((a, b) => a.neighbor.label.localeCompare(b.neighbor.label, 'id')),
    }));
  }, [selectedConnections]);

  const selectedBreadcrumb = useMemo(() => {
    if (!selectedNode) return [];
    const schoolNode = nodes.find((n) => n.tipe.toLowerCase() === 'sekolah') ?? null;
    const findLinkedNode = (nodeId: string, relasi: string, wantSide: 'source' | 'target', tipeFilter?: string) => {
      for (const e of edges) {
        if (e.relasi !== relasi) continue;
        if (wantSide === 'source' && e.target === nodeId) {
          const cand = nodeById.get(e.source);
          if (cand && (!tipeFilter || cand.tipe.toLowerCase() === tipeFilter)) return cand;
        } else if (wantSide === 'target' && e.source === nodeId) {
          const cand = nodeById.get(e.target);
          if (cand && (!tipeFilter || cand.tipe.toLowerCase() === tipeFilter)) return cand;
        }
      }
      return null;
    };
    const findJurusanForNode = (n: GraphNode) => {
      const byEdge =
        findLinkedNode(n.id, 'memiliki_kelas', 'source', 'jurusan') ??
        findLinkedNode(n.id, 'mitra_pkl', 'source', 'jurusan');
      if (byEdge) return byEdge;
      const code = String(n.metadata?.jurusan_kode || '').trim().toUpperCase();
      if (!code) return null;
      return (
        nodes.find(
          (cand) =>
            cand.tipe.toLowerCase() === 'jurusan' &&
            (String(cand.metadata?.kode || '').toUpperCase() === code ||
              cand.kunci.toUpperCase() === `JURUSAN:${code}`)
        ) ?? null
      );
    };

    const trail: GraphNode[] = [];
    const pushUnique = (n: GraphNode | null) => {
      if (n && !trail.some((t) => t.id === n.id)) trail.push(n);
    };

    const tipe = selectedNode.tipe.toLowerCase();
    if (tipe === 'sekolah') {
      pushUnique(selectedNode);
    } else if (tipe === 'jurusan') {
      pushUnique(schoolNode);
      pushUnique(selectedNode);
    } else if (tipe === 'kelas' || tipe === 'perusahaan') {
      pushUnique(schoolNode);
      pushUnique(findJurusanForNode(selectedNode));
      pushUnique(selectedNode);
    } else if (tipe === 'guru') {
      pushUnique(schoolNode);
      const waliKelas = findLinkedNode(selectedNode.id, 'wali_kelas', 'target', 'kelas');
      if (waliKelas) {
        pushUnique(findJurusanForNode(waliKelas));
        pushUnique(waliKelas);
      }
      pushUnique(selectedNode);
    } else if (tipe === 'ekskul') {
      pushUnique(schoolNode);
      pushUnique(selectedNode);
    } else if (tipe === 'dokumen') {
      const linkedSchool = findLinkedNode(selectedNode.id, 'terkait_sekolah', 'target', 'sekolah');
      pushUnique(linkedSchool ?? schoolNode);
      pushUnique(selectedNode);
    } else if (tipe === 'topik') {
      const doc = findLinkedNode(selectedNode.id, 'membahas', 'source', 'dokumen');
      if (doc) {
        pushUnique(schoolNode);
        pushUnique(doc);
      }
      pushUnique(selectedNode);
    } else {
      pushUnique(schoolNode);
      pushUnique(selectedNode);
    }
    return trail;
  }, [selectedNode, nodes, edges, nodeById]);

  const metadataEntries = useMemo(() => {
    if (!selectedNode?.metadata) return [];
    return Object.entries(selectedNode.metadata).filter(
      ([, val]) => val !== null && val !== undefined && val !== '' && (!Array.isArray(val) || val.length > 0)
    );
  }, [selectedNode]);

  // Struktur hierarki Direktori untuk panel kanan
  const directoryTree = useMemo(() => {
    const q = dirFilter.trim().toLowerCase();
    const matchesText = (n: GraphNode, extra = '') => {
      if (!q) return true;
      return `${n.label} ${n.kunci} ${n.tipe} ${extra}`.toLowerCase().includes(q);
    };

    const schoolNode = nodes.find((n) => n.tipe.toLowerCase() === 'sekolah') ?? null;
    const jurusans = nodes
      .filter((n) => n.tipe.toLowerCase() === 'jurusan')
      .sort((a, b) => a.label.localeCompare(b.label, 'id'));
    const allKelas = nodes
      .filter((n) => n.tipe.toLowerCase() === 'kelas')
      .sort((a, b) => a.label.localeCompare(b.label, 'id'));
    const allPerusahaan = nodes
      .filter((n) => n.tipe.toLowerCase() === 'perusahaan')
      .sort((a, b) => a.label.localeCompare(b.label, 'id'));
    const allEkskul = nodes
      .filter((n) => n.tipe.toLowerCase() === 'ekskul')
      .sort((a, b) => a.label.localeCompare(b.label, 'id'));
    const allGuru = nodes
      .filter((n) => n.tipe.toLowerCase() === 'guru')
      .sort((a, b) => a.label.localeCompare(b.label, 'id'));
    const allDokumen = nodes
      .filter((n) => n.tipe.toLowerCase() === 'dokumen')
      .sort((a, b) => a.label.localeCompare(b.label, 'id'));
    const allTopik = nodes
      .filter((n) => n.tipe.toLowerCase() === 'topik')
      .sort((a, b) => a.label.localeCompare(b.label, 'id'));

    const jurusanById = new Map(jurusans.map((j) => [j.id, j]));
    const jurusanByCode = new Map<string, GraphNode>();
    for (const j of jurusans) {
      const c = String(j.metadata?.kode || j.kunci.split(':')[1] || '')
        .trim()
        .toUpperCase();
      if (c) jurusanByCode.set(c, j);
    }

    const kelasByJurusan = new Map<string, GraphNode[]>();
    const compByJurusan = new Map<string, GraphNode[]>();
    const waliKelasLabelsByGuru = new Map<string, string[]>();
    const topicsByDoc = new Map<string, GraphNode[]>();

    const assignedKelas = new Set<string>();
    const assignedComp = new Set<string>();
    const assignedTopic = new Set<string>();

    for (const e of edges) {
      const src = nodeById.get(e.source);
      const tgt = nodeById.get(e.target);
      if (!src || !tgt) continue;
      if (e.relasi === 'memiliki_kelas' && jurusanById.has(src.id) && tgt.tipe.toLowerCase() === 'kelas') {
        const list = kelasByJurusan.get(src.id) ?? [];
        if (!list.some((x) => x.id === tgt.id)) list.push(tgt);
        kelasByJurusan.set(src.id, list);
        assignedKelas.add(tgt.id);
      } else if (e.relasi === 'mitra_pkl' && jurusanById.has(src.id) && tgt.tipe.toLowerCase() === 'perusahaan') {
        const list = compByJurusan.get(src.id) ?? [];
        if (!list.some((x) => x.id === tgt.id)) list.push(tgt);
        compByJurusan.set(src.id, list);
        assignedComp.add(tgt.id);
      } else if (e.relasi === 'wali_kelas' && src.tipe.toLowerCase() === 'guru' && tgt.tipe.toLowerCase() === 'kelas') {
        const arr = waliKelasLabelsByGuru.get(src.id) ?? [];
        if (!arr.includes(tgt.label)) arr.push(tgt.label);
        waliKelasLabelsByGuru.set(src.id, arr);
      } else if (e.relasi === 'membahas' && src.tipe.toLowerCase() === 'dokumen' && tgt.tipe.toLowerCase() === 'topik') {
        const list = topicsByDoc.get(src.id) ?? [];
        if (!list.some((x) => x.id === tgt.id)) list.push(tgt);
        topicsByDoc.set(src.id, list);
        assignedTopic.add(tgt.id);
      }
    }

    for (const k of allKelas) {
      if (assignedKelas.has(k.id)) continue;
      const code = String(k.metadata?.jurusan_kode || '').trim().toUpperCase();
      const j = code ? jurusanByCode.get(code) : undefined;
      if (j) {
        const list = kelasByJurusan.get(j.id) ?? [];
        list.push(k);
        kelasByJurusan.set(j.id, list);
        assignedKelas.add(k.id);
      }
    }
    for (const p of allPerusahaan) {
      if (assignedComp.has(p.id)) continue;
      const code = String(p.metadata?.jurusan_kode || '').trim().toUpperCase();
      const j = code ? jurusanByCode.get(code) : undefined;
      if (j) {
        const list = compByJurusan.get(j.id) ?? [];
        list.push(p);
        compByJurusan.set(j.id, list);
        assignedComp.add(p.id);
      }
    }

    const jurusanBranches = jurusans
      .map((j) => {
        const rawKelas = (kelasByJurusan.get(j.id) ?? []).sort((a, b) => a.label.localeCompare(b.label, 'id'));
        const rawComps = (compByJurusan.get(j.id) ?? []).sort((a, b) => a.label.localeCompare(b.label, 'id'));
        const jSelfMatch = matchesText(j);
        const kelas = q && !jSelfMatch ? rawKelas.filter((k) => matchesText(k)) : rawKelas;
        const perusahaan = q && !jSelfMatch ? rawComps.filter((p) => matchesText(p)) : rawComps;
        if (q && !jSelfMatch && kelas.length === 0 && perusahaan.length === 0) return null;
        return {
          jurusan: j,
          kelas,
          perusahaan,
          totalChildren: rawKelas.length + rawComps.length,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const orphanKelas = allKelas.filter((k) => !assignedKelas.has(k.id) && matchesText(k));
    const orphanComp = allPerusahaan.filter((p) => !assignedComp.has(p.id) && matchesText(p));
    const ekskulItems = allEkskul.filter((e) => matchesText(e));

    const waliGurus = allGuru
      .filter((g) => waliKelasLabelsByGuru.has(g.id))
      .map((g) => ({ node: g, kelasLabel: waliKelasLabelsByGuru.get(g.id)!.join(', ') }))
      .filter((item) => matchesText(item.node, item.kelasLabel));
    const otherGurus = allGuru
      .filter((g) => !waliKelasLabelsByGuru.has(g.id))
      .filter((g) => matchesText(g));

    const docBranches = allDokumen
      .map((d) => {
        const rawTopics = (topicsByDoc.get(d.id) ?? []).sort((a, b) => a.label.localeCompare(b.label, 'id'));
        const dSelfMatch = matchesText(d);
        const topics = q && !dSelfMatch ? rawTopics.filter((t) => matchesText(t)) : rawTopics;
        if (q && !dSelfMatch && topics.length === 0) return null;
        return {
          doc: d,
          topics,
          totalTopics: rawTopics.length,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const orphanTopics = allTopik.filter((t) => !assignedTopic.has(t.id) && matchesText(t));

    return {
      hasFilter: Boolean(q),
      schoolNode: schoolNode && matchesText(schoolNode) ? schoolNode : null,
      jurusanBranches,
      orphanKelas,
      orphanComp,
      ekskulItems,
      waliGurus,
      otherGurus,
      totalGuru: waliGurus.length + otherGurus.length,
      docBranches,
      orphanTopics,
    };
  }, [nodes, edges, nodeById, dirFilter]);

  // Sinkronkan perubahan tema live (Light <-> Dark) & reduced-motion
  useEffect(() => {
    paletteRef.current = readThemePalette();
    setIsDarkTheme(paletteRef.current.isDark);
    needsDrawRef.current = true;

    const refreshPalette = () => {
      paletteRef.current = readThemePalette();
      const pal = paletteRef.current;
      setIsDarkTheme(pal.isDark);
      for (const sn of simNodesRef.current) {
        const vis = getTypeVisual(sn.node.tipe);
        sn.color = pal.isDark ? vis.darkColor : vis.color;
      }
      needsDrawRef.current = true;
    };

    const unsubPrefs = preferences.subscribe(() => {
      requestAnimationFrame(refreshPalette);
    });

    const mo = new MutationObserver(refreshPalette);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    const mqMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (mqMotion) {
      reducedMotionRef.current = mqMotion.matches;
      const onMotion = (e: MediaQueryListEvent) => {
        reducedMotionRef.current = e.matches;
        needsDrawRef.current = true;
      };
      mqMotion.addEventListener?.('change', onMotion);
      return () => {
        unsubPrefs();
        mo.disconnect();
        mqMotion.removeEventListener?.('change', onMotion);
      };
    }

    return () => {
      unsubPrefs();
      mo.disconnect();
    };
  }, []);

  // Pastikan selectedId valid saat filter berubah
  useEffect(() => {
    if (selectedId && !nodes.some((n) => n.id === selectedId)) {
      setSelectedId(null);
    }
  }, [nodes, selectedId]);

  const getNodeRenderPos = useCallback((sn: SimNode, idx: number) => {
    const isPinned =
      sn.fx !== null ||
      sn.id === selectedIdRef.current ||
      sn.id === hoveredIdRef.current;
    if (isPinned || physicsPausedRef.current || reducedMotionRef.current) {
      return { x: sn.x, y: sn.y };
    }
    const amp = sn.node.tipe.toLowerCase() === 'sekolah' ? 1.1 : 3.2;
    const t = driftTimeRef.current;
    return {
      x: sn.x + Math.sin(t * 0.72 + idx * 1.37) * amp,
      y: sn.y + Math.cos(t * 0.61 + idx * 2.13) * amp,
    };
  }, []);

  // Fit seluruh jaring ke viewport kanvas
  const fitToView = useCallback(() => {
    const snList = simNodesRef.current;
    const { width, height } = sizeRef.current;
    if (snList.length === 0) {
      cameraRef.current = { x: width / 2, y: height / 2, scale: 1 };
      setZoomPercent(100);
      needsDrawRef.current = true;
      return;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const n of snList) {
      if (n.x - n.radius < minX) minX = n.x - n.radius;
      if (n.x + n.radius > maxX) maxX = n.x + n.radius;
      if (n.y - n.radius < minY) minY = n.y - n.radius;
      if (n.y + n.radius > maxY) maxY = n.y + n.radius;
    }
    const pad = 76;
    const graphW = Math.max(200, maxX - minX + pad * 2);
    const graphH = Math.max(200, maxY - minY + pad * 2);
    const nextScale = Math.max(MIN_SCALE, Math.min(1.25, Math.min(width / graphW, height / graphH)));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    cameraRef.current = {
      x: width / 2 - cx * nextScale,
      y: height / 2 - cy * nextScale,
      scale: nextScale,
    };
    setZoomPercent(Math.round(nextScale * 100));
    needsDrawRef.current = true;
  }, []);

  const centerOnNode = useCallback((nodeId: string) => {
    const idx = simNodeIndexRef.current.get(nodeId);
    if (idx === undefined) return;
    const sn = simNodesRef.current[idx];
    if (!sn) return;
    const { width, height } = sizeRef.current;
    const targetScale = Math.max(cameraRef.current.scale, 1.02);
    cameraRef.current = {
      x: width / 2 - sn.x * targetScale,
      y: height / 2 - sn.y * targetScale,
      scale: targetScale,
    };
    setZoomPercent(Math.round(targetScale * 100));
    needsDrawRef.current = true;
  }, []);

  const selectNode = useCallback(
    (id: string | null, shouldCenter = false, openInspector = false) => {
      setSelectedId(id);
      if (id) {
        if (openInspector) setPanelMode('inspektor');
        const node = nodeById.get(id);
        if (node) {
          const deg = edges.filter((e) => e.source === id || e.target === id).length;
          setLiveAnnouncement(
            `Simpul ${node.label} (${getTypeVisual(node.tipe).label}) dipilih, memiliki ${deg} relasi.`
          );
        }
        if (shouldCenter) centerOnNode(id);
      } else {
        setLiveAnnouncement('Pilihan simpul dibersihkan.');
      }
      needsDrawRef.current = true;
    },
    [nodeById, edges, centerOnNode]
  );

  // Fungsi satu langkah integrasi fisika (warm-up + interaksi)
  const stepPhysics = useCallback((alpha: number) => {
    const sn = simNodesRef.current;
    const se = simEdgesRef.current;
    const nLen = sn.length;
    if (nLen === 0) return 0;

    const { repelForce, linkDistance, centerForce } = forcesRef.current;
    const damping = 0.84;

    // 1. Gaya tolak Coulomb antar simpul dengan pemisahan minimum yang lega
    for (let i = 0; i < nLen; i++) {
      const a = sn[i];
      for (let j = i + 1; j < nLen; j++) {
        const b = sn[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 1) {
          dx = ((i % 7) - 3) * 0.9 + 0.35;
          dy = ((j % 5) - 2) * 0.9 + 0.25;
          distSq = dx * dx + dy * dy;
        }
        if (distSq > 1600000) continue;

        const minSep = a.radius + b.radius + 46;
        const dist = Math.sqrt(distSq);
        let mag = (repelForce * alpha) / Math.max(distSq, 120);
        if (dist < minSep) {
          mag += ((minSep - dist) / minSep) * 2.8 * alpha;
        }
        mag = Math.min(mag, 24);
        const fx = (dx / dist) * mag;
        const fy = (dy / dist) * mag;

        if (a.fx === null) {
          a.vx += fx;
          a.vy += fy;
        }
        if (b.fx === null) {
          b.vx -= fx;
          b.vy -= fy;
        }
      }
    }

    // 2. Gaya pegas Hooke sepanjang relasi
    for (let k = 0; k < se.length; k++) {
      const link = se[k];
      const a = sn[link.sourceIdx];
      const b = sn[link.targetIdx];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 1;
      const tA = a.node.tipe.toLowerCase();
      const tB = b.node.tipe.toLowerCase();
      const hasType = (t: string) => tA === t || tB === t;
      const ideal =
        hasType('sekolah') && hasType('jurusan')
          ? linkDistance * 1.45
          : hasType('sekolah') && (hasType('ekskul') || hasType('guru'))
          ? linkDistance * 2.05
          : hasType('jurusan') && (hasType('kelas') || hasType('perusahaan'))
          ? linkDistance * 1.05
          : linkDistance * 0.88 + (a.radius + b.radius) * 0.9;
      const diff = dist - ideal;
      const springK = 0.032 * (0.35 + alpha * 0.65);
      const fx = (dx / dist) * diff * springK;
      const fy = (dy / dist) * diff * springK;

      if (a.fx === null) {
        a.vx += fx;
        a.vy += fy;
      }
      if (b.fx === null) {
        b.vx -= fx;
        b.vy -= fy;
      }
    }

    // 3. Gaya gravitasi lembut ke pusat (0, 0) & integrasi kecepatan
    let maxSpeed = 0;
    for (let i = 0; i < nLen; i++) {
      const a = sn[i];
      if (a.fx !== null && a.fy !== null) {
        a.x = a.fx;
        a.y = a.fy;
        a.vx = 0;
        a.vy = 0;
        continue;
      }
      const tipe = a.node.tipe.toLowerCase();
      const hubGravity =
        tipe === 'sekolah'
          ? centerForce * 12
          : tipe === 'ekskul' || tipe === 'guru' || tipe === 'perusahaan'
          ? centerForce * 0.4
          : centerForce * 0.65;
      a.vx += -a.x * hubGravity * (0.4 + alpha * 0.6);
      a.vy += -a.y * hubGravity * (0.4 + alpha * 0.6);

      a.vx *= damping;
      a.vy *= damping;

      const speed = Math.hypot(a.vx, a.vy);
      if (speed > 24) {
        a.vx = (a.vx / speed) * 24;
        a.vy = (a.vy / speed) * 24;
      }
      if (speed > maxSpeed) maxSpeed = speed;

      a.x += a.vx;
      a.y += a.vy;
    }

    return maxSpeed;
  }, []);

  // Bangun ulang graph simulasi saat `nodes` / `edges` berubah
  useEffect(() => {
    const prevMap = new Map<string, SimNode>();
    for (const old of simNodesRef.current) {
      prevMap.set(old.id, old);
    }

    const degreeMap = new Map<string, number>();
    for (const n of nodes) degreeMap.set(n.id, 0);
    for (const e of edges) {
      if (degreeMap.has(e.source)) degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
      if (degreeMap.has(e.target)) degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
    }

    const sectorPositions = computeSectorLayout(nodes, edges);
    const pal = paletteRef.current;

    const nextNodes: SimNode[] = nodes.map((n) => {
      const prev = prevMap.get(n.id);
      const deg = degreeMap.get(n.id) ?? 0;
      const tipe = n.tipe.toLowerCase();
      const vis = getTypeVisual(tipe);
      const baseR = 5 + Math.sqrt(deg) * 2.35;
      const typeBoost = tipe === 'sekolah' ? 6 : tipe === 'jurusan' ? 3 : tipe === 'dokumen' ? 2.2 : 0;
      const radius = Math.max(6, Math.min(24, baseR + typeBoost));
      const isHub = tipe === 'sekolah' || tipe === 'jurusan' || tipe === 'dokumen' || deg >= 5;

      const initPos = sectorPositions.get(n.id) ?? { x: 0, y: 0 };
      const x = prev ? prev.x : initPos.x;
      const y = prev ? prev.y : initPos.y;

      return {
        id: n.id,
        node: n,
        x,
        y,
        vx: prev ? prev.vx * 0.4 : 0,
        vy: prev ? prev.vy * 0.4 : 0,
        radius,
        degree: deg,
        color: pal.isDark ? vis.darkColor : vis.color,
        isHub,
        fx: null,
        fy: null,
      };
    });

    const idxMap = new Map<string, number>();
    nextNodes.forEach((sn, i) => idxMap.set(sn.id, i));

    const nextEdges: SimEdge[] = [];
    for (const e of edges) {
      const sIdx = idxMap.get(e.source);
      const tIdx = idxMap.get(e.target);
      if (sIdx !== undefined && tIdx !== undefined && sIdx !== tIdx) {
        nextEdges.push({ edge: e, sourceIdx: sIdx, targetIdx: tIdx });
      }
    }

    simNodesRef.current = nextNodes;
    simNodeIndexRef.current = idxMap;
    simEdgesRef.current = nextEdges;

    const warmTicks = prevMap.size === 0 ? 75 : 30;
    for (let t = 0; t < warmTicks; t++) {
      stepPhysics(Math.max(0.22, 1 - t / (warmTicks + 24)));
    }
    alphaRef.current = reducedMotionRef.current || physicsPausedRef.current ? 0 : 0.4;
    needsDrawRef.current = true;
    fitToView();
  }, [nodes, edges, stepPhysics, fitToView]);

  // ResizeObserver untuk menyesuaikan DPR & ukuran kanvas
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let wasHidden = false;
    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) {
        wasHidden = true;
        return;
      }
      const w = Math.max(300, Math.floor(rect.width));
      const h = Math.max(400, Math.floor(rect.height));
      const prev = sizeRef.current;
      if (prev.width !== w || prev.height !== h) {
        cameraRef.current.x += (w - prev.width) / 2;
        cameraRef.current.y += (h - prev.height) / 2;
        sizeRef.current = { width: w, height: h };
        needsDrawRef.current = true;
      }
      if (wasHidden) {
        wasHidden = false;
        fitToView();
      }
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [fitToView]);

  // Wheel zoom terpusat di kursor
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      const cam = cameraRef.current;
      const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, cam.scale * factor));
      const ratio = nextScale / cam.scale;

      cameraRef.current = {
        x: mx - (mx - cam.x) * ratio,
        y: my - (my - cam.y) * ratio,
        scale: nextScale,
      };
      setZoomPercent(Math.round(nextScale * 100));
      needsDrawRef.current = true;
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // Loop animasi 60fps Canvas 2D + fisika + micro-drift ambient
  useEffect(() => {
    let rafId = 0;

    const renderFrame = (now: number) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        rafId = requestAnimationFrame(renderFrame);
        return;
      }

      const dt = lastFrameTsRef.current !== null ? Math.min(0.05, Math.max(0, (now - lastFrameTsRef.current) / 1000)) : 0.016;
      lastFrameTsRef.current = now;

      const ambientActive = !physicsPausedRef.current && !reducedMotionRef.current && simNodesRef.current.length > 0;
      if (ambientActive) {
        driftTimeRef.current += dt;
        needsDrawRef.current = true;
      }

      const alpha = alphaRef.current;
      const isDraggingNode = gestureRef.current?.kind === 'node';
      if ((!physicsPausedRef.current && alpha > 0.004) || isDraggingNode) {
        const maxSpeed = stepPhysics(Math.max(alpha, isDraggingNode ? 0.45 : 0));
        if (!isDraggingNode) {
          alphaRef.current = alpha * 0.985;
          if (alphaRef.current < 0.006 && maxSpeed < 0.04) {
            alphaRef.current = 0;
          }
        }
        needsDrawRef.current = true;
      }

      if (needsDrawRef.current) {
        needsDrawRef.current = false;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const { width, height } = sizeRef.current;
          const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
          const targetW = Math.round(width * dpr);
          const targetH = Math.round(height * dpr);
          if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
          }

          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          const pal = paletteRef.current;
          const cam = cameraRef.current;
          const snList = simNodesRef.current;
          const seList = simEdgesRef.current;
          const active = hoveredIdRef.current ?? selectedIdRef.current;
          const nbSet = neighborIdsRef.current;
          const eSet = connectedEdgeIdsRef.current;
          const matchSet = matchingIdsRef.current;
          const { showLabels, showArrows } = forcesRef.current;

          // Hitung posisi tampilan (settled pos + ambient sinusoidal micro-drift)
          const renderPositions = new Array<{ x: number; y: number }>(snList.length);
          for (let i = 0; i < snList.length; i++) {
            renderPositions[i] = getNodeRenderPos(snList[i], i);
          }

          // 1. Latar & titik kisi editorial halus
          ctx.fillStyle = pal.bgCanvas;
          ctx.fillRect(0, 0, width, height);

          const gridStep = Math.max(16, 26 * cam.scale);
          if (gridStep >= 14) {
            const offsetX = ((cam.x % gridStep) + gridStep) % gridStep;
            const offsetY = ((cam.y % gridStep) + gridStep) % gridStep;
            ctx.fillStyle = pal.gridDot;
            for (let gx = offsetX; gx < width; gx += gridStep) {
              for (let gy = offsetY; gy < height; gy += gridStep) {
                ctx.fillRect(gx - 0.75, gy - 0.75, 1.5, 1.5);
              }
            }
          }

          // 2. Gambar Relasi (Edges)
          for (let i = 0; i < seList.length; i++) {
            const link = seList[i];
            const a = snList[link.sourceIdx];
            const b = snList[link.targetIdx];
            const posA = renderPositions[link.sourceIdx];
            const posB = renderPositions[link.targetIdx];
            if (!a || !b || !posA || !posB) continue;

            const ax = cam.x + posA.x * cam.scale;
            const ay = cam.y + posA.y * cam.scale;
            const bx = cam.x + posB.x * cam.scale;
            const by = cam.y + posB.y * cam.scale;

            const minX = Math.min(ax, bx);
            const maxX = Math.max(ax, bx);
            const minY = Math.min(ay, by);
            const maxY = Math.max(ay, by);
            if (maxX < -40 || minX > width + 40 || maxY < -40 || minY > height + 40) continue;

            const isConnected = active ? eSet.has(link.edge.id) : false;
            const isKonflik = link.edge.status === 'konflik';
            const isSaran = link.edge.status === 'saran';

            ctx.save();
            if (active && !isConnected) {
              ctx.globalAlpha = 0.1;
            } else if (matchSet && !active) {
              const bothMatch = matchSet.has(a.id) || matchSet.has(b.id);
              ctx.globalAlpha = bothMatch ? 0.85 : 0.12;
            } else {
              ctx.globalAlpha = isConnected ? 0.92 : 1;
            }

            ctx.beginPath();
            if (isKonflik) ctx.setLineDash([5, 4]);
            else if (isSaran) ctx.setLineDash([3, 3]);
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.strokeStyle = isKonflik ? '#E11D48' : isConnected ? pal.accentInk : pal.edgeIdle;
            ctx.lineWidth = isConnected ? 1.85 : isKonflik ? 1.5 : 1;
            ctx.stroke();

            if ((showArrows || isConnected) && (!active || isConnected)) {
              const dx = bx - ax;
              const dy = by - ay;
              const dist = Math.hypot(dx, dy);
              const targetR = b.radius * cam.scale + 3;
              if (dist > targetR + 10) {
                const ux = dx / dist;
                const uy = dy / dist;
                const tipX = bx - ux * targetR;
                const tipY = by - uy * targetR;
                const arrowLen = isConnected ? 7 : 5.5;
                const angle = Math.atan2(dy, dx);
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(tipX, tipY);
                ctx.lineTo(
                  tipX - arrowLen * Math.cos(angle - Math.PI / 6),
                  tipY - arrowLen * Math.sin(angle - Math.PI / 6)
                );
                ctx.lineTo(
                  tipX - arrowLen * Math.cos(angle + Math.PI / 6),
                  tipY - arrowLen * Math.sin(angle + Math.PI / 6)
                );
                ctx.closePath();
                ctx.fillStyle = isKonflik ? '#E11D48' : isConnected ? pal.accentInk : pal.textSecondary;
                ctx.fill();
              }
            }

            if (isConnected) {
              const mx = (ax + bx) / 2;
              const my = (ay + by) / 2;
              const relText = truncateLabel(link.edge.relasi.replace(/_/g, ' '), 20);
              ctx.setLineDash([]);
              ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
              const tw = ctx.measureText(relText).width;
              const pillW = tw + 12;
              const pillH = 16;
              ctx.fillStyle = pal.bgSurface;
              ctx.strokeStyle = isKonflik ? '#E11D48' : pal.borderSubtle;
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.roundRect(mx - pillW / 2, my - pillH / 2, pillW, pillH, 5);
              ctx.fill();
              ctx.stroke();
              ctx.fillStyle = isKonflik ? '#E11D48' : pal.textPrimary;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(relText, mx, my + 0.5);
            }
            ctx.restore();
          }

          // 3. Gambar Simpul (Nodes)
          const labelsToDraw: LabelCandidate[] = [];

          const drawOrder = snList
            .map((sn, idx) => ({
              sn,
              idx,
              priority:
                sn.id === selectedIdRef.current
                  ? 3
                  : sn.id === hoveredIdRef.current
                  ? 2
                  : active && nbSet.has(sn.id)
                  ? 1
                  : matchSet && matchSet.has(sn.id)
                  ? 1
                  : 0,
            }))
            .sort((a, b) => a.priority - b.priority || a.idx - b.idx);

          for (let i = 0; i < drawOrder.length; i++) {
            const { sn, idx } = drawOrder[i];
            const pos = renderPositions[idx];
            const sx = cam.x + pos.x * cam.scale;
            const sy = cam.y + pos.y * cam.scale;
            const sr = Math.max(3.5, sn.radius * Math.min(1.45, Math.max(0.65, Math.sqrt(cam.scale))));

            if (sx + sr + 70 < 0 || sx - sr - 70 > width || sy + sr + 50 < 0 || sy - sr - 50 > height) {
              continue;
            }

            const isSelected = selectedIdRef.current === sn.id;
            const isHovered = hoveredIdRef.current === sn.id;
            const isNeighbor = active ? nbSet.has(sn.id) : false;
            const isMatch = matchSet ? matchSet.has(sn.id) : false;
            const isKonflik = sn.node.status === 'konflik';
            const isSaran = sn.node.status === 'saran';
            const tipe = sn.node.tipe.toLowerCase();
            const isRoot = tipe === 'sekolah';

            let nodeAlpha = 1;
            if (active) {
              nodeAlpha = isNeighbor ? 1 : 0.16;
            } else if (matchSet && !isMatch) {
              nodeAlpha = 0.18;
            }

            const fillColor = isRoot ? pal.accentInk : sn.color;

            ctx.save();
            ctx.globalAlpha = nodeAlpha;

            if (isSelected || isHovered || isMatch) {
              ctx.beginPath();
              ctx.arc(sx, sy, sr + (isSelected ? 7 : 5), 0, Math.PI * 2);
              ctx.fillStyle = hexToRgba(
                isSelected ? (pal.isDark ? '#F4F4F5' : '#18181B') : isMatch ? '#F59E0B' : sn.color,
                isSelected ? 0.2 : 0.16
              );
              ctx.fill();
            }

            if (isKonflik || isSaran) {
              ctx.beginPath();
              ctx.arc(sx, sy, sr + 4, 0, Math.PI * 2);
              ctx.setLineDash([4, 3]);
              ctx.strokeStyle = isKonflik ? '#E11D48' : '#F59E0B';
              ctx.lineWidth = 1.6;
              ctx.stroke();
              ctx.setLineDash([]);
            }

            ctx.beginPath();
            ctx.arc(sx, sy, sr, 0, Math.PI * 2);
            ctx.fillStyle = fillColor;
            ctx.fill();
            ctx.strokeStyle = isSelected ? pal.accentInk : pal.bgCanvas;
            ctx.lineWidth = isSelected ? 2.2 : 1.4;
            ctx.stroke();

            let labelAlpha = 0;
            if (isSelected || isHovered || isNeighbor || isMatch) {
              labelAlpha = 1;
            } else if (showLabels && (!active || isNeighbor)) {
              if (sn.isHub) {
                labelAlpha = Math.max(0.65, Math.min(1, (cam.scale - 0.22) * 2.2));
              } else if (sn.degree >= 2) {
                labelAlpha = Math.max(0, Math.min(1, (cam.scale - 0.56) * 2.4));
              } else {
                labelAlpha = Math.max(0, Math.min(1, (cam.scale - 0.78) * 2.3));
              }
            }

            if (active && !isNeighbor) {
              labelAlpha = 0;
            } else if (matchSet && !isMatch && !active) {
              labelAlpha *= 0.25;
            }

            if (labelAlpha > 0.06) {
              const priority = isSelected
                ? 100
                : isHovered
                ? 90
                : isRoot
                ? 82
                : active && isNeighbor
                ? 72
                : matchSet && isMatch
                ? 68
                : tipe === 'jurusan' || tipe === 'dokumen'
                ? 52 + sn.degree
                : sn.isHub
                ? 36 + sn.degree
                : sn.degree;

              labelsToDraw.push({
                x: sx,
                y: sy + sr + 7,
                text: truncateLabel(sn.node.label, isSelected || isHovered ? 28 : 22),
                alpha: labelAlpha,
                bold: isRoot || tipe === 'jurusan' || isSelected || isHovered,
                fontSize: isRoot ? 12 : isSelected || isHovered ? 11.5 : 10.5,
                priority,
                forceDraw: isSelected || isHovered,
              });
            }

            ctx.restore();
          }

          // 4. Gambar Label dengan Screen-Space Collision Culling berdasarkan prioritas
          labelsToDraw.sort((a, b) => b.priority - a.priority || b.alpha - a.alpha);
          const placedBoxes: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

          for (let i = 0; i < labelsToDraw.length; i++) {
            const lbl = labelsToDraw[i];
            ctx.save();
            ctx.font = `${lbl.bold ? '600' : '500'} ${lbl.fontSize}px ui-sans-serif, system-ui, sans-serif`;
            const tw = ctx.measureText(lbl.text).width;
            const padX = 10;
            const padY = 6;
            const box = {
              x1: lbl.x - tw / 2 - padX,
              y1: lbl.y - padY,
              x2: lbl.x + tw / 2 + padX,
              y2: lbl.y + lbl.fontSize * 1.25 + padY,
            };

            const overlaps = placedBoxes.some(
              (b) => box.x1 < b.x2 && box.x2 > b.x1 && box.y1 < b.y2 && box.y2 > b.y1
            );
            if (!lbl.forceDraw && overlaps) {
              ctx.restore();
              continue;
            }

            placedBoxes.push(box);
            ctx.globalAlpha = lbl.alpha;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.lineJoin = 'round';
            ctx.lineWidth = 3.6;
            ctx.strokeStyle = pal.bgCanvas;
            ctx.strokeText(lbl.text, lbl.x, lbl.y);
            ctx.fillStyle = lbl.bold ? pal.textPrimary : pal.textSecondary;
            ctx.fillText(lbl.text, lbl.x, lbl.y);
            ctx.restore();
          }
        }
      }

      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, [stepPhysics, getNodeRenderPos]);

  // Hit-testing node pada koordinat layar relatif terhadap canvas
  const findNodeAtClientPos = useCallback(
    (clientX: number, clientY: number): number => {
      const canvas = canvasRef.current;
      if (!canvas) return -1;
      const rect = canvas.getBoundingClientRect();
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      const cam = cameraRef.current;
      const wx = (sx - cam.x) / cam.scale;
      const wy = (sy - cam.y) / cam.scale;

      const snList = simNodesRef.current;
      const hitPad = 7 / cam.scale;
      const active = hoveredIdRef.current ?? selectedIdRef.current;
      const nbSet = neighborIdsRef.current;

      for (let pass = 0; pass < 2; pass++) {
        for (let i = snList.length - 1; i >= 0; i--) {
          const sn = snList[i];
          const isTop =
            sn.id === selectedIdRef.current || sn.id === hoveredIdRef.current || (active && nbSet.has(sn.id));
          if ((pass === 0 && !isTop) || (pass === 1 && isTop)) continue;
          const pos = getNodeRenderPos(sn, i);
          const dist = Math.hypot(wx - pos.x, wy - pos.y);
          if (dist <= sn.radius + hitPad) return i;
        }
      }
      return -1;
    },
    [getNodeRenderPos]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const hitIdx = findNodeAtClientPos(e.clientX, e.clientY);

    if (hitIdx >= 0) {
      const sn = simNodesRef.current[hitIdx];
      sn.fx = sn.x;
      sn.fy = sn.y;
      gestureRef.current = {
        kind: 'node',
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startCamX: cameraRef.current.x,
        startCamY: cameraRef.current.y,
        nodeIdx: hitIdx,
        nodeStartX: sn.x,
        nodeStartY: sn.y,
        moved: false,
      };
      setCursorStyle('grabbing');
    } else {
      gestureRef.current = {
        kind: 'pan',
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startCamX: cameraRef.current.x,
        startCamY: cameraRef.current.y,
        moved: false,
      };
      setCursorStyle('grabbing');
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gestureRef.current;
    if (g && g.pointerId === e.pointerId) {
      const dx = e.clientX - g.startClientX;
      const dy = e.clientY - g.startClientY;
      if (!g.moved && Math.hypot(dx, dy) >= 4) {
        g.moved = true;
      }
      if (!g.moved) return;

      if (g.kind === 'pan') {
        cameraRef.current.x = g.startCamX + dx;
        cameraRef.current.y = g.startCamY + dy;
        needsDrawRef.current = true;
      } else if (
        g.kind === 'node' &&
        g.nodeIdx !== undefined &&
        g.nodeStartX !== undefined &&
        g.nodeStartY !== undefined
      ) {
        const sn = simNodesRef.current[g.nodeIdx];
        if (sn) {
          sn.fx = g.nodeStartX + dx / cameraRef.current.scale;
          sn.fy = g.nodeStartY + dy / cameraRef.current.scale;
          sn.x = sn.fx;
          sn.y = sn.fy;
          if (!physicsPausedRef.current) {
            alphaRef.current = Math.max(alphaRef.current, 0.55);
          }
          needsDrawRef.current = true;
        }
      }
      return;
    }

    const hitIdx = findNodeAtClientPos(e.clientX, e.clientY);
    const nextHoverId = hitIdx >= 0 ? simNodesRef.current[hitIdx].id : null;
    if (nextHoverId !== hoveredIdRef.current) {
      setHoveredId(nextHoverId);
      setCursorStyle(nextHoverId ? 'pointer' : 'grab');
      needsDrawRef.current = true;
    }
  };

  const handlePointerUpOrCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gestureRef.current = null;

    if (g.kind === 'node' && g.nodeIdx !== undefined) {
      const sn = simNodesRef.current[g.nodeIdx];
      if (sn) {
        sn.fx = null;
        sn.fy = null;
        if (g.moved) {
          if (!physicsPausedRef.current) {
            alphaRef.current = Math.max(alphaRef.current, 0.35);
          }
        } else {
          const nextId = selectedIdRef.current === sn.id ? null : sn.id;
          selectNode(nextId, false, Boolean(nextId));
        }
      }
    } else if (g.kind === 'pan' && !g.moved) {
      selectNode(null, false, false);
    }

    const hitIdx = findNodeAtClientPos(e.clientX, e.clientY);
    setCursorStyle(hitIdx >= 0 ? 'pointer' : 'grab');
    needsDrawRef.current = true;
  };

  const zoomBy = (factor: number) => {
    const { width, height } = sizeRef.current;
    const cx = width / 2;
    const cy = height / 2;
    const cam = cameraRef.current;
    const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, cam.scale * factor));
    const ratio = nextScale / cam.scale;
    cameraRef.current = {
      x: cx - (cx - cam.x) * ratio,
      y: cy - (cy - cam.y) * ratio,
      scale: nextScale,
    };
    setZoomPercent(Math.round(nextScale * 100));
    needsDrawRef.current = true;
  };

  const updateForce = <K extends keyof ForceSettings>(key: K, val: ForceSettings[K]) => {
    setForces((prev) => ({ ...prev, [key]: val }));
    if (key === 'repelForce' || key === 'linkDistance' || key === 'centerForce') {
      alphaRef.current = Math.max(alphaRef.current, 0.65);
    }
    needsDrawRef.current = true;
  };

  const resetForcesAndReheat = () => {
    setForces(DEFAULT_FORCES);
    const sectorPos = computeSectorLayout(nodes, edges);
    for (const sn of simNodesRef.current) {
      const p = sectorPos.get(sn.id);
      if (p) {
        sn.x = p.x;
        sn.y = p.y;
      }
      sn.vx = 0;
      sn.vy = 0;
      sn.fx = null;
      sn.fy = null;
    }
    for (let t = 0; t < 110; t++) {
      stepPhysics(Math.max(0.24, 1 - t / 135));
    }
    alphaRef.current = reducedMotionRef.current || physicsPausedRef.current ? 0 : 0.45;
    fitToView();
    needsDrawRef.current = true;
  };

  const handleAskAi = (node: GraphNode) => {
    const prompt = buildAiQuestion(node);
    try {
      sessionStorage.setItem('sis_pending_q', prompt);
      sessionStorage.removeItem('sis_reset_chat');
    } catch {
      /* abaikan */
    }
    router.push('/chat');
  };

  const toggleBranch = (key: string) => {
    setExpandedBranches((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const isBranchOpen = (key: string, defaultOpen = false) => {
    if (directoryTree.hasFilter) return true;
    return expandedBranches[key] ?? defaultOpen;
  };

  const renderDirectoryLeaf = (node: GraphNode, sublabel?: string) => {
    const vis = getTypeVisual(node.tipe);
    const active = selectedId === node.id;
    return (
      <div
        key={node.id}
        className={`group flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors ${
          active
            ? 'bg-[var(--bg-elevated)] font-semibold text-[var(--text-primary)] ring-1 ring-[var(--border-subtle)]'
            : 'text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]/70'
        }`}
      >
        <button
          type="button"
          onClick={() => selectNode(node.id, true, false)}
          className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left"
          title={`Fokus ke ${node.label}`}
        >
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 rounded-full"
            style={{
              backgroundColor:
                node.tipe.toLowerCase() === 'sekolah'
                  ? 'var(--accent-ink)'
                  : isDarkTheme
                  ? vis.darkColor
                  : vis.color,
            }}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{node.label}</span>
            {sublabel && (
              <span className="block truncate text-[10px] font-normal text-[var(--text-secondary)]">
                Wali: {sublabel}
              </span>
            )}
          </span>
        </button>
        <button
          type="button"
          onClick={() => selectNode(node.id, true, true)}
          aria-label={`Lihat detail ${node.label} di Inspektor`}
          title="Buka di Inspektor"
          className={`shrink-0 rounded p-1 text-[var(--text-secondary)] transition-opacity hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] ${
            active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
          }`}
        >
          <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    );
  };

  return (
    <div className="min-w-0 space-y-3">
      {/* Live region aksesibilitas */}
      <div className="visually-hidden" aria-live="polite">
        {liveAnnouncement}
      </div>

      {/* Filter Toolbar */}
      <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="relative min-w-[220px] flex-1 max-w-md">
            <label htmlFor="kg-node-search" className="visually-hidden">
              Cari simpul pada knowledge graph
            </label>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-secondary)]"
            />
            <input
              id="kg-node-search"
              name="kg_node_search"
              type="search"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Cari simpul graf (nama, kelas, guru, mitra, topik)..."
              aria-label="Cari simpul pada knowledge graph"
              className="input !pl-9 !pr-8"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                aria-label="Hapus pencarian"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label
              htmlFor="kg-include-system"
              className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-[var(--text-secondary)] select-none"
            >
              <input
                id="kg-include-system"
                name="kg_include_system"
                type="checkbox"
                checked={includeSystem}
                onChange={(e) => onIncludeSystemChange(e.target.checked)}
                className="h-4 w-4 rounded border-[var(--border-subtle)] accent-[var(--accent-ink)]"
              />
              <span>Sertakan entitas sekolah induk</span>
            </label>

            {matchingIds && (
              <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1 text-xs font-medium tabular-nums text-[var(--text-primary)]">
                {matchingIds.size} simpul cocok
              </span>
            )}
          </div>
        </div>

        {/* Multi-Select Filter Chips per Tipe Entitas */}
        <div className="flex flex-col gap-2 border-t border-[var(--border-subtle)]/70 pt-2.5">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter tipe entitas">
            <span className="mr-1 inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              <Layers className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Tipe Entitas</span>
            </span>

            <button
              type="button"
              onClick={() => onTypesChange([])}
              aria-pressed={normalizedSelectedTypes.length === 0}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                normalizedSelectedTypes.length === 0
                  ? 'border-[var(--accent-ink)] bg-[var(--accent-ink)] text-[var(--accent-ink-fg)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {normalizedSelectedTypes.length === 0 && (
                <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
              )}
              <span>Semua</span>
              <span className="tabular-nums opacity-75">({totalAllCount})</span>
            </button>

            {presentTypes.map(({ tipe, count, visual }) => {
              const active = selectedTypeSet.has(tipe);
              return (
                <button
                  key={tipe}
                  type="button"
                  onClick={() => toggleEntityType(tipe)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    active
                      ? 'border-[var(--accent-ink)] bg-[var(--accent-ink)] text-[var(--accent-ink-fg)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {active ? (
                    <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{
                        backgroundColor:
                          tipe === 'sekolah' ? 'currentColor' : isDarkTheme ? visual.darkColor : visual.color,
                      }}
                    />
                  )}
                  <span>{visual.label}</span>
                  {(count > 0 || active) && <span className="tabular-nums opacity-75">({count})</span>}
                </button>
              );
            })}

            {normalizedSelectedTypes.length > 0 && (
              <>
                <span className="ml-1 inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--text-primary)]">
                  {normalizedSelectedTypes.length} dipilih
                </span>
                <button
                  type="button"
                  onClick={() => onTypesChange([])}
                  className="inline-flex items-center gap-1 rounded-full border border-transparent px-2 py-1 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                  <span>Reset filter</span>
                </button>
              </>
            )}
          </div>

          {/* 1-line micro-caption of active entity filter */}
          <p className="min-w-0 text-[11px] leading-snug text-[var(--text-secondary)]">
            {relationCaption}
          </p>
        </div>
      </div>

      {/* Main Split: HTML5 Canvas 2D Graph + Right-Hand Dual-Mode Panel (Direktori | Inspektor) */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-sm lg:h-[652px]">
          {/* Header Controls Bar */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2">
            <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
              <Compass className="h-3.5 w-3.5 shrink-0" />
              <span>Seret simpul untuk menarik jaring · Seret latar untuk geser · Gulir untuk zoom</span>
            </div>

            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => zoomBy(0.82)}
                aria-label="Perkecil graf"
                title="Perkecil"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:opacity-80"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-[46px] text-center font-mono text-xs tabular-nums text-[var(--text-secondary)]">
                {zoomPercent}%
              </span>
              <button
                type="button"
                onClick={() => zoomBy(1.22)}
                aria-label="Perbesar graf"
                title="Perbesar"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:opacity-80"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={fitToView}
                aria-label="Pas ke layar"
                title="Pas ke layar"
                className="ml-1 inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-xs font-medium text-[var(--text-primary)] hover:opacity-80"
              >
                <Maximize2 className="h-3 w-3" />
                <span className="hidden sm:inline">Fit</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setPhysicsPaused((prev) => {
                    const next = !prev;
                    physicsPausedRef.current = next;
                    lastFrameTsRef.current = null;
                    needsDrawRef.current = true;
                    return next;
                  });
                }}
                aria-label={physicsPaused ? 'Aktifkan gerak graf' : 'Jeda gerak graf'}
                title={physicsPaused ? 'Aktifkan gerak ambient graf' : 'Jeda gerak ambient graf'}
                className="ml-1 inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-xs font-medium text-[var(--text-primary)] hover:opacity-80"
              >
                {physicsPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                <span className="hidden sm:inline">{physicsPaused ? 'Aktifkan Gerak' : 'Jeda Gerak'}</span>
              </button>
              <button
                type="button"
                onClick={() => setForcesOpen((v) => !v)}
                aria-expanded={forcesOpen}
                aria-controls="kg-forces-panel"
                className={`ml-1 inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors ${
                  forcesOpen
                    ? 'border-[var(--accent-ink)] bg-[var(--accent-ink)] text-[var(--accent-ink-fg)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:opacity-80'
                }`}
              >
                <SlidersHorizontal className="h-3 w-3" />
                <span className="hidden sm:inline">Pengaturan Gaya</span>
              </button>
            </div>
          </div>

          {/* Interactive Canvas Container */}
          <div
            ref={containerRef}
            className="relative h-[500px] w-full overflow-hidden bg-[var(--bg-canvas)] sm:h-[560px] lg:h-auto lg:min-h-0 lg:flex-1"
          >
            <canvas
              ref={canvasRef}
              tabIndex={0}
              role="img"
              aria-label={`Graf pengetahuan interaktif dengan ${nodes.length} simpul dan ${edges.length} relasi. Gunakan klik/seret atau direktori dan inspektor di samping untuk menjelajahi simpul.`}
              style={{
                cursor: cursorStyle,
                touchAction: 'none',
                WebkitUserSelect: 'none',
                userSelect: 'none',
              }}
              className={`block h-full w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-ink)] ${
                loading || nodes.length === 0 ? 'invisible pointer-events-none' : ''
              }`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUpOrCancel}
              onPointerCancel={handlePointerUpOrCancel}
              onPointerLeave={() => {
                if (!gestureRef.current && hoveredIdRef.current) {
                  setHoveredId(null);
                  setCursorStyle('grab');
                  needsDrawRef.current = true;
                }
              }}
              onKeyDown={(e) => {
                if (e.key === '+' || e.key === '=') {
                  e.preventDefault();
                  zoomBy(1.18);
                } else if (e.key === '-') {
                  e.preventDefault();
                  zoomBy(0.84);
                } else if (e.key === '0') {
                  e.preventDefault();
                  fitToView();
                } else if (e.key === 'Escape' && selectedId) {
                  e.preventDefault();
                  selectNode(null, false, false);
                }
              }}
            />

            {loading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--bg-canvas)] text-sm text-[var(--text-secondary)]">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--border-subtle)] border-t-[var(--accent-ink)]" />
                <span>Menjalankan simulasi graf pengetahuan…</span>
              </div>
            )}

            {!loading && nodes.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--bg-canvas)] p-6 text-center">
                <Info className="h-8 w-8 text-[var(--text-secondary)] opacity-60" />
                <p className="text-sm font-medium text-[var(--text-primary)]">Belum ada simpul yang sesuai filter</p>
                <p className="max-w-sm text-xs text-[var(--text-secondary)]">
                  Coba ubah kata kunci pencarian, pilih tipe entitas lain, atau aktifkan entitas sekolah induk.
                </p>
              </div>
            )}

            {/* Collapsible Obsidian-Style Forces Popover */}
            {forcesOpen && (
              <div
                id="kg-forces-panel"
                className="absolute right-3 top-3 z-20 w-64 space-y-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/95 p-3.5 shadow-xl backdrop-blur-sm"
              >
                <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2">
                  <span className="text-xs font-semibold text-[var(--text-primary)]">Pengaturan Gaya (Forces)</span>
                  <button
                    type="button"
                    onClick={() => setForcesOpen(false)}
                    aria-label="Tutup pengaturan gaya"
                    className="rounded p-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="space-y-3 text-xs">
                  <label htmlFor="kg-force-repel" className="block space-y-1">
                    <div className="flex justify-between text-[var(--text-secondary)]">
                      <span>Gaya Tolak (Repel)</span>
                      <span className="font-mono tabular-nums text-[var(--text-primary)]">{forces.repelForce}</span>
                    </div>
                    <input
                      id="kg-force-repel"
                      name="kg_force_repel"
                      type="range"
                      min={1500}
                      max={14000}
                      step={250}
                      value={forces.repelForce}
                      onChange={(e) => updateForce('repelForce', Number(e.target.value))}
                      className="w-full"
                    />
                  </label>

                  <label htmlFor="kg-force-link" className="block space-y-1">
                    <div className="flex justify-between text-[var(--text-secondary)]">
                      <span>Jarak Tautan (Link)</span>
                      <span className="font-mono tabular-nums text-[var(--text-primary)]">{forces.linkDistance}px</span>
                    </div>
                    <input
                      id="kg-force-link"
                      name="kg_force_link"
                      type="range"
                      min={80}
                      max={320}
                      step={10}
                      value={forces.linkDistance}
                      onChange={(e) => updateForce('linkDistance', Number(e.target.value))}
                      className="w-full"
                    />
                  </label>

                  <label htmlFor="kg-force-center" className="block space-y-1">
                    <div className="flex justify-between text-[var(--text-secondary)]">
                      <span>Gaya Pusat (Center)</span>
                      <span className="font-mono tabular-nums text-[var(--text-primary)]">
                        {forces.centerForce.toFixed(4)}
                      </span>
                    </div>
                    <input
                      id="kg-force-center"
                      name="kg_force_center"
                      type="range"
                      min={0.0005}
                      max={0.015}
                      step={0.0005}
                      value={forces.centerForce}
                      onChange={(e) => updateForce('centerForce', Number(e.target.value))}
                      className="w-full"
                    />
                  </label>

                  <div className="space-y-1.5 border-t border-[var(--border-subtle)] pt-2">
                    <label
                      htmlFor="kg-show-labels"
                      className="flex cursor-pointer items-center justify-between text-[var(--text-primary)]"
                    >
                      <span>Tampilkan label simpul</span>
                      <input
                        id="kg-show-labels"
                        name="kg_show_labels"
                        type="checkbox"
                        checked={forces.showLabels}
                        onChange={(e) => updateForce('showLabels', e.target.checked)}
                        className="h-3.5 w-3.5"
                      />
                    </label>
                    <label
                      htmlFor="kg-show-arrows"
                      className="flex cursor-pointer items-center justify-between text-[var(--text-primary)]"
                    >
                      <span>Tampilkan panah arah</span>
                      <input
                        id="kg-show-arrows"
                        name="kg_show_arrows"
                        type="checkbox"
                        checked={forces.showArrows}
                        onChange={(e) => updateForce('showArrows', e.target.checked)}
                        className="h-3.5 w-3.5"
                      />
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={resetForcesAndReheat}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-1.5 text-xs font-medium text-[var(--text-primary)] hover:opacity-80"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>Reset Gaya &amp; Kocok Ulang</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Legend Strip */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2 text-[11px] text-[var(--text-secondary)]">
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
              {presentTypes
                .filter((t) => t.visibleCount > 0)
                .map(({ tipe, visual }) => (
                  <span key={tipe} className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{
                        backgroundColor:
                          tipe === 'sekolah'
                            ? 'var(--accent-ink)'
                            : isDarkTheme
                            ? visual.darkColor
                            : visual.color,
                      }}
                    />
                    <span>{visual.label}</span>
                  </span>
                ))}
            </div>
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-dashed border-rose-500" />
                <span>Konflik / Saran</span>
              </span>
            </div>
          </div>
        </div>

        {/* Right-Hand Dual-Mode Panel: Direktori | Inspektor */}
        <aside
          aria-label="Direktori dan Inspektor Simpul"
          className="flex h-[520px] min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-sm lg:h-[652px] lg:w-[350px] xl:w-[380px]"
        >
          {/* Segmented Switcher */}
          <div className="shrink-0 border-b border-[var(--border-subtle)] p-2.5">
            <div
              role="tablist"
              aria-label="Mode panel samping graf"
              className="grid grid-cols-2 gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={panelMode === 'direktori'}
                onClick={() => setPanelMode('direktori')}
                className={`flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                  panelMode === 'direktori'
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <FolderTree className="h-3.5 w-3.5" />
                <span>Direktori</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={panelMode === 'inspektor'}
                onClick={() => setPanelMode('inspektor')}
                className={`flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                  panelMode === 'inspektor'
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Inspektor</span>
                {selectedNode && (
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                )}
              </button>
            </div>
          </div>

          {panelMode === 'direktori' ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {/* Mini Search Filter */}
              <div className="shrink-0 border-b border-[var(--border-subtle)] px-3 py-2.5">
                <div className="relative">
                  <label htmlFor="kg-dir-filter" className="visually-hidden">
                    Saring direktori entitas knowledge graph
                  </label>
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-secondary)]"
                  />
                  <input
                    id="kg-dir-filter"
                    name="kg_dir_filter"
                    type="search"
                    value={dirFilter}
                    onChange={(e) => setDirFilter(e.target.value)}
                    placeholder="Saring direktori entitas…"
                    aria-label="Saring direktori entitas knowledge graph"
                    className="input !py-1.5 !pl-8 !pr-7 text-xs"
                  />
                  {dirFilter && (
                    <button
                      type="button"
                      onClick={() => setDirFilter('')}
                      aria-label="Bersihkan saringan direktori"
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Hierarchical Collapsible Directory Tree */}
              <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-auto scroll-region p-3">
                {nodes.length === 0 ? (
                  <p className="py-6 text-center text-xs text-[var(--text-secondary)]">
                    Tidak ada simpul untuk ditampilkan.
                  </p>
                ) : (
                  <>
                    {/* Root Sekolah */}
                    {directoryTree.schoolNode && (
                      <div>{renderDirectoryLeaf(directoryTree.schoolNode)}</div>
                    )}

                    {/* Cabang Jurusan -> Kelas & Mitra PKL */}
                    {directoryTree.jurusanBranches.length > 0 && (
                      <div className="space-y-1">
                        <button
                          type="button"
                          onClick={() => toggleBranch('jurusan')}
                          className="flex w-full items-center justify-between rounded-md px-1.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]/70 hover:text-[var(--text-primary)]"
                        >
                          <span className="flex items-center gap-1.5">
                            {isBranchOpen('jurusan', true) ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                            <span>Jurusan</span>
                          </span>
                          <span className="rounded-full bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] tabular-nums">
                            {directoryTree.jurusanBranches.length}
                          </span>
                        </button>

                        {isBranchOpen('jurusan', true) && (
                          <div className="ml-2 space-y-1 border-l border-[var(--border-subtle)] pl-2">
                            {directoryTree.jurusanBranches.map(({ jurusan, kelas, perusahaan, totalChildren }) => {
                              const jKey = `j:${jurusan.id}`;
                              const open = isBranchOpen(jKey, false);
                              return (
                                <div key={jurusan.id} className="space-y-0.5">
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => toggleBranch(jKey)}
                                      aria-label={open ? `Tutup ${jurusan.label}` : `Buka ${jurusan.label}`}
                                      className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                                    >
                                      {open ? (
                                        <ChevronDown className="h-3 w-3" />
                                      ) : (
                                        <ChevronRight className="h-3 w-3" />
                                      )}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => selectNode(jurusan.id, true, false)}
                                      className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors ${
                                        selectedId === jurusan.id
                                          ? 'bg-[var(--bg-elevated)] font-semibold text-[var(--text-primary)]'
                                          : 'font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]/70'
                                      }`}
                                    >
                                      <span className="flex min-w-0 items-center gap-1.5">
                                        <span
                                          aria-hidden="true"
                                          className="h-2 w-2 shrink-0 rounded-full"
                                          style={{
                                            backgroundColor: isDarkTheme
                                              ? TYPE_CONFIG.jurusan.darkColor
                                              : TYPE_CONFIG.jurusan.color,
                                          }}
                                        />
                                        <span className="truncate">{jurusan.label}</span>
                                      </span>
                                      <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--text-secondary)]">
                                        {totalChildren}
                                      </span>
                                    </button>
                                  </div>

                                  {open && (
                                    <div className="ml-5 space-y-1.5 border-l border-[var(--border-subtle)] pl-2 py-0.5">
                                      {kelas.length > 0 && (
                                        <div className="space-y-0.5">
                                          <p className="px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                                            Kelas ({kelas.length})
                                          </p>
                                          {kelas.map((k) => renderDirectoryLeaf(k))}
                                        </div>
                                      )}
                                      {perusahaan.length > 0 && (
                                        <div className="space-y-0.5">
                                          <p className="px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                                            Mitra PKL ({perusahaan.length})
                                          </p>
                                          {perusahaan.map((p) => renderDirectoryLeaf(p))}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Kelas atau Mitra PKL tanpa jurusan induk di tampilan terfilter */}
                    {directoryTree.orphanKelas.length > 0 && (
                      <div className="space-y-1">
                        <p className="px-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                          Kelas ({directoryTree.orphanKelas.length})
                        </p>
                        <div className="ml-2 space-y-0.5 border-l border-[var(--border-subtle)] pl-2">
                          {directoryTree.orphanKelas.map((k) => renderDirectoryLeaf(k))}
                        </div>
                      </div>
                    )}

                    {directoryTree.orphanComp.length > 0 && (
                      <div className="space-y-1">
                        <p className="px-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                          Mitra PKL ({directoryTree.orphanComp.length})
                        </p>
                        <div className="ml-2 space-y-0.5 border-l border-[var(--border-subtle)] pl-2">
                          {directoryTree.orphanComp.map((p) => renderDirectoryLeaf(p))}
                        </div>
                      </div>
                    )}

                    {/* Ekstrakurikuler */}
                    {directoryTree.ekskulItems.length > 0 && (
                      <div className="space-y-1">
                        <button
                          type="button"
                          onClick={() => toggleBranch('ekskul')}
                          className="flex w-full items-center justify-between rounded-md px-1.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]/70 hover:text-[var(--text-primary)]"
                        >
                          <span className="flex items-center gap-1.5">
                            {isBranchOpen('ekskul', false) ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                            <span>Ekstrakurikuler</span>
                          </span>
                          <span className="rounded-full bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] tabular-nums">
                            {directoryTree.ekskulItems.length}
                          </span>
                        </button>
                        {isBranchOpen('ekskul', false) && (
                          <div className="ml-2 space-y-0.5 border-l border-[var(--border-subtle)] pl-2">
                            {directoryTree.ekskulItems.map((ek) => renderDirectoryLeaf(ek))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Tenaga Pendidik -> Wali Kelas & Guru Lainnya */}
                    {directoryTree.totalGuru > 0 && (
                      <div className="space-y-1">
                        <button
                          type="button"
                          onClick={() => toggleBranch('guru')}
                          className="flex w-full items-center justify-between rounded-md px-1.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]/70 hover:text-[var(--text-primary)]"
                        >
                          <span className="flex items-center gap-1.5">
                            {isBranchOpen('guru', false) ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                            <span>Tenaga Pendidik</span>
                          </span>
                          <span className="rounded-full bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] tabular-nums">
                            {directoryTree.totalGuru}
                          </span>
                        </button>

                        {isBranchOpen('guru', false) && (
                          <div className="ml-2 space-y-1.5 border-l border-[var(--border-subtle)] pl-2">
                            {directoryTree.waliGurus.length > 0 && (
                              <div className="space-y-0.5">
                                <button
                                  type="button"
                                  onClick={() => toggleBranch('guru_wali')}
                                  className="flex w-full items-center justify-between rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                                >
                                  <span className="flex items-center gap-1">
                                    {isBranchOpen('guru_wali', true) ? (
                                      <ChevronDown className="h-3 w-3" />
                                    ) : (
                                      <ChevronRight className="h-3 w-3" />
                                    )}
                                    <span>Wali Kelas</span>
                                  </span>
                                  <span className="font-mono tabular-nums">{directoryTree.waliGurus.length}</span>
                                </button>
                                {isBranchOpen('guru_wali', true) && (
                                  <div className="space-y-0.5 pl-1">
                                    {directoryTree.waliGurus.map(({ node, kelasLabel }) =>
                                      renderDirectoryLeaf(node, kelasLabel)
                                    )}
                                  </div>
                                )}
                              </div>
                            )}

                            {directoryTree.otherGurus.length > 0 && (
                              <div className="space-y-0.5">
                                <button
                                  type="button"
                                  onClick={() => toggleBranch('guru_lain')}
                                  className="flex w-full items-center justify-between rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                                >
                                  <span className="flex items-center gap-1">
                                    {isBranchOpen('guru_lain', false) ? (
                                      <ChevronDown className="h-3 w-3" />
                                    ) : (
                                      <ChevronRight className="h-3 w-3" />
                                    )}
                                    <span>Guru Lainnya</span>
                                  </span>
                                  <span className="font-mono tabular-nums">{directoryTree.otherGurus.length}</span>
                                </button>
                                {isBranchOpen('guru_lain', false) && (
                                  <div className="space-y-0.5 pl-1">
                                    {directoryTree.otherGurus.map((g) => renderDirectoryLeaf(g))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Dokumen Pengetahuan -> Topik */}
                    {(directoryTree.docBranches.length > 0 || directoryTree.orphanTopics.length > 0) && (
                      <div className="space-y-1">
                        <button
                          type="button"
                          onClick={() => toggleBranch('dokumen')}
                          className="flex w-full items-center justify-between rounded-md px-1.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]/70 hover:text-[var(--text-primary)]"
                        >
                          <span className="flex items-center gap-1.5">
                            {isBranchOpen('dokumen', true) ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                            <span>Dokumen Pengetahuan</span>
                          </span>
                          <span className="rounded-full bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] tabular-nums">
                            {directoryTree.docBranches.length}
                          </span>
                        </button>

                        {isBranchOpen('dokumen', true) && (
                          <div className="ml-2 space-y-1 border-l border-[var(--border-subtle)] pl-2">
                            {directoryTree.docBranches.map(({ doc, topics, totalTopics }) => {
                              const dKey = `d:${doc.id}`;
                              const open = isBranchOpen(dKey, true);
                              return (
                                <div key={doc.id} className="space-y-0.5">
                                  <div className="flex items-center gap-1">
                                    {totalTopics > 0 && (
                                      <button
                                        type="button"
                                        onClick={() => toggleBranch(dKey)}
                                        aria-label={open ? `Tutup topik ${doc.label}` : `Buka topik ${doc.label}`}
                                        className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                                      >
                                        {open ? (
                                          <ChevronDown className="h-3 w-3" />
                                        ) : (
                                          <ChevronRight className="h-3 w-3" />
                                        )}
                                      </button>
                                    )}
                                    <div className="min-w-0 flex-1">{renderDirectoryLeaf(doc)}</div>
                                  </div>
                                  {open && topics.length > 0 && (
                                    <div className="ml-5 space-y-0.5 border-l border-[var(--border-subtle)] pl-2">
                                      {topics.map((t) => renderDirectoryLeaf(t))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                            {directoryTree.orphanTopics.map((t) => renderDirectoryLeaf(t))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 px-3.5 py-2.5 text-[11px] text-[var(--text-secondary)]">
                Klik entitas untuk memfokuskan pada kanvas ·{' '}
                <strong className="tabular-nums text-[var(--text-primary)]">{nodes.length}</strong> simpul
              </div>
            </div>
          ) : !selectedNode ? (
            <div className="flex min-h-0 flex-1 flex-col justify-between overflow-y-auto overscroll-auto scroll-region p-5">
              <div className="space-y-3">
                <div>
                  <h2 className="text-sm font-semibold text-[var(--text-primary)]">Inspektor Simpul Graf</h2>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                    Klik simpul pada jaring graf untuk melihat jejak hierarki, metadata, relasi terkelompok, status konflik, atau langsung bertanya kepada AI.
                  </p>
                </div>

                {quickAccessNodes.length > 0 && (
                  <div className="space-y-2 pt-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                      Akses Cepat Simpul Utama
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {quickAccessNodes.map((n) => {
                        const vis = getTypeVisual(n.tipe);
                        return (
                          <button
                            key={n.id}
                            type="button"
                            onClick={() => selectNode(n.id, true, true)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--accent-ink)]"
                          >
                            <span
                              aria-hidden="true"
                              className="h-2 w-2 rounded-full"
                              style={{
                                backgroundColor:
                                  n.tipe.toLowerCase() === 'sekolah'
                                    ? 'var(--accent-ink)'
                                    : isDarkTheme
                                    ? vis.darkColor
                                    : vis.color,
                              }}
                            />
                            <span className="max-w-[160px] truncate">{n.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-6 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 text-xs text-[var(--text-secondary)]">
                Menampilkan <strong className="tabular-nums text-[var(--text-primary)]">{nodes.length}</strong> simpul dan{' '}
                <strong className="tabular-nums text-[var(--text-primary)]">{edges.length}</strong> relasi aktif.
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {/* Inspector Header + Breadcrumb */}
              <div className="shrink-0 border-b border-[var(--border-subtle)] p-4">
                {selectedBreadcrumb.length > 1 && (
                  <nav aria-label="Jejak hierarki simpul" className="mb-2.5 flex flex-wrap items-center gap-1 text-[11px]">
                    {selectedBreadcrumb.map((crumb, idx) => {
                      const isCurrent = idx === selectedBreadcrumb.length - 1;
                      return (
                        <span key={crumb.id} className="inline-flex items-center gap-1">
                          {idx > 0 && (
                            <ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
                          )}
                          {isCurrent ? (
                            <span
                              aria-current="location"
                              className="max-w-[150px] truncate font-semibold text-[var(--text-primary)]"
                              title={crumb.label}
                            >
                              {crumb.label}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => selectNode(crumb.id, true, true)}
                              className="max-w-[130px] truncate rounded px-1 py-0.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                              title={crumb.label}
                            >
                              {crumb.label}
                            </button>
                          )}
                        </span>
                      );
                    })}
                  </nav>
                )}

                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                        getTypeVisual(selectedNode.tipe).badgeClass
                      }`}
                    >
                      {getTypeVisual(selectedNode.tipe).label}
                    </span>
                    <span className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
                      {selectedNode.sumber === 'dokumen' ? 'Dari Dokumen' : 'Sistem Sekolah'}
                    </span>
                    {selectedNode.status !== 'aktif' && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                          selectedNode.status === 'konflik'
                            ? 'border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300'
                            : 'border-amber-500/30 bg-amber-500/15 text-amber-800 dark:text-amber-300'
                        }`}
                      >
                        <AlertTriangle className="h-3 w-3" />
                        <span className="capitalize">{selectedNode.status}</span>
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => selectNode(null, false, false)}
                    aria-label="Bersihkan pilihan simpul"
                    className="rounded-lg p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <h3 className="mt-2.5 text-base font-bold leading-snug text-[var(--text-primary)]">
                  {selectedNode.label}
                </h3>
                <p className="mt-0.5 break-all font-mono text-[11px] text-[var(--text-secondary)]">
                  {selectedNode.kunci}
                </p>

                <button
                  type="button"
                  onClick={() => handleAskAi(selectedNode)}
                  className="mt-3.5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent-ink)] px-3.5 py-2 text-xs font-semibold text-[var(--accent-ink-fg)] shadow-sm transition-opacity hover:opacity-90"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span>Tanya AI tentang ini</span>
                </button>
              </div>

              {/* Scrollable Inspector Body */}
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-auto scroll-region p-4">
                <div>
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                    Metadata Entitas
                  </h4>
                  {metadataEntries.length === 0 ? (
                    <p className="mt-1.5 text-xs text-[var(--text-secondary)]">Tidak ada metadata tambahan.</p>
                  ) : (
                    <dl className="mt-2 space-y-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2.5">
                      {metadataEntries.map(([k, v]) => (
                        <div key={k} className="flex items-start justify-between gap-3 text-xs">
                          <dt className="shrink-0 text-[var(--text-secondary)]">{formatMetaKey(k)}</dt>
                          <dd className="break-words text-right font-medium text-[var(--text-primary)]">
                            {formatMetaValue(v)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>

                <div>
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                    Relasi Terhubung ({selectedConnections.length})
                  </h4>

                  {groupedSelectedConnections.length === 0 ? (
                    <p className="mt-1.5 text-xs text-[var(--text-secondary)]">Belum memiliki relasi terlihat.</p>
                  ) : (
                    <div className="mt-2 space-y-3">
                      {groupedSelectedConnections.map((group) => (
                        <div key={group.relasi} className="space-y-1.5">
                          <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--text-secondary)]">
                            <span>{group.title}</span>
                            <span className="rounded-full bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] tabular-nums">
                              {group.items.length}
                            </span>
                          </div>
                          <ul className="space-y-1.5">
                            {group.items.map(({ edge, neighbor, direction }) => {
                              const nbVis = getTypeVisual(neighbor.tipe);
                              const isEdgeKonflik = edge.status === 'konflik';
                              return (
                                <li key={`${edge.id}-${direction}`}>
                                  <button
                                    type="button"
                                    onClick={() => selectNode(neighbor.id, true, true)}
                                    className={`w-full rounded-lg border p-2.5 text-left transition-colors hover:border-[var(--accent-ink)] ${
                                      isEdgeKonflik
                                        ? 'border-rose-500/40 bg-rose-500/10'
                                        : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]'
                                    }`}
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="flex min-w-0 items-center gap-2">
                                        <span
                                          aria-hidden="true"
                                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                                          style={{
                                            backgroundColor:
                                              neighbor.tipe.toLowerCase() === 'sekolah'
                                                ? 'var(--accent-ink)'
                                                : isDarkTheme
                                                ? nbVis.darkColor
                                                : nbVis.color,
                                          }}
                                        />
                                        <span className="truncate text-xs font-semibold text-[var(--text-primary)]">
                                          {neighbor.label}
                                        </span>
                                      </span>
                                      <span className="inline-flex shrink-0 items-center gap-1 text-[10px] text-[var(--text-secondary)]">
                                        <span>{nbVis.label}</span>
                                        <ArrowRight className="h-3.5 w-3.5" />
                                      </span>
                                    </div>
                                    {isEdgeKonflik && (
                                      <p className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                                        <AlertTriangle className="h-3 w-3" />
                                        <span>Potensi Konflik</span>
                                      </p>
                                    )}
                                    {edge.catatan && (
                                      <p className="mt-1 flex items-start gap-1 text-[11px] text-rose-700 dark:text-rose-300">
                                        <FileText className="mt-0.5 h-3 w-3 shrink-0" />
                                        <span>{edge.catatan}</span>
                                      </p>
                                    )}
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

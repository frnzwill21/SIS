'use client';
import { FormEvent, ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ApiError, api, ROLE_WORKSPACE_LABELS, roleLabel, session, User } from '@/lib/api';
import { preferences } from '@/lib/preferences';
import SisBrandMark from '@/components/SisBrandMark';
import UserAvatar from '@/components/UserAvatar';
import ConfirmDialog from '@/components/ConfirmDialog';
import RouteTransitionLoader from '@/components/ui/RouteTransitionLoader';
import {
  ArrowLeft,
  Check,
  Database,
  Lock,
  LogOut,
  MessageSquare,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  User as UserIcon,
  X,
} from 'lucide-react';

type ChatSessionItem = {
  id: string;
  judul: string;
  pinned: boolean;
  dibuat_pada: string;
  diperbarui_pada: string;
  jumlah_pesan?: number;
};

const MASTER_PREFIXES = ['/master', '/siswa', '/kelas', '/guru', '/pkl', '/ekskul', '/profil-sekolah'];

function isMasterRoute(pathname: string): boolean {
  return MASTER_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function getHeaderTitle(path: string): string {
  if (path === '/chat') return 'AI School Assistant';
  if (path.startsWith('/knowledge')) return 'Knowledge Graph';
  if (path.startsWith('/akun')) return 'Pengaturan Akun';
  if (path === '/master') return 'Master Data Sekolah';
  if (path.startsWith('/siswa')) return 'Master · Data Siswa Kelas XII';
  if (path.startsWith('/kelas')) return 'Master · Kelas & Jadwal Pelajaran';
  if (path.startsWith('/guru')) return 'Master · Guru & Jadwal Mengajar';
  if (path.startsWith('/pkl')) return 'Master · Penempatan & Mitra PKL';
  if (path.startsWith('/ekskul')) return 'Master · Kegiatan Ekstrakurikuler';
  if (path.startsWith('/profil-sekolah')) return 'Master · Profil SMKN 4 Bandung';
  if (path.startsWith('/admin')) return 'User Management & Audit';
  return 'SIS SMKN 4 Bandung';
}

function groupSessionsByDate(items: ChatSessionItem[]): {
  today: ChatSessionItem[];
  week: ChatSessionItem[];
  older: ChatSessionItem[];
} {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const sevenDaysAgo = startOfToday - 7 * 24 * 60 * 60 * 1000;

  const today: ChatSessionItem[] = [];
  const week: ChatSessionItem[] = [];
  const older: ChatSessionItem[] = [];

  for (const s of items) {
    const raw = s.diperbarui_pada || s.dibuat_pada;
    const t = raw ? new Date(raw).getTime() : 0;
    if (!Number.isFinite(t) || t <= 0) {
      older.push(s);
    } else if (t >= startOfToday) {
      today.push(s);
    } else if (t >= sevenDaysAgo) {
      week.push(s);
    } else {
      older.push(s);
    }
  }

  return { today, week, older };
}

const RETURN_ROUTE_KEY = 'sis_return_route';
const VALID_AKUN_TABS = new Set(['profil', 'keamanan', 'preferensi', 'privasi']);

function RouteTracker({ path, isAkunRoute }: { path: string; isAkunRoute: boolean }) {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();

  useEffect(() => {
    if (isAkunRoute || !path.startsWith('/') || path.startsWith('/login')) return;
    const full = qs ? `${path}?${qs}` : path;
    try {
      sessionStorage.setItem(RETURN_ROUTE_KEY, full);
    } catch {
      /* abaikan */
    }
  }, [path, qs, isAkunRoute]);

  return null;
}

function SettingsSidebarNav({ collapsed }: { collapsed: boolean }) {
  const searchParams = useSearchParams();
  const rawTab = searchParams.get('tab');
  const activeTab = rawTab && VALID_AKUN_TABS.has(rawTab) ? rawTab : 'profil';
  const [returnHref, setReturnHref] = useState('/chat');

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(RETURN_ROUTE_KEY);
      if (
        saved &&
        saved.startsWith('/') &&
        !saved.startsWith('//') &&
        !saved.startsWith('/akun') &&
        !saved.startsWith('/login')
      ) {
        setReturnHref(saved);
      }
    } catch {
      /* abaikan */
    }
  }, []);

  const labelClass = `whitespace-nowrap transition-opacity duration-150 ${
    collapsed ? 'pointer-events-none opacity-0' : 'opacity-100'
  }`;

  const items = [
    { key: 'profil', label: 'Profil', icon: UserIcon },
    { key: 'keamanan', label: 'Keamanan & Sesi', icon: Shield },
    { key: 'preferensi', label: 'Preferensi Tampilan & AI', icon: SlidersHorizontal },
    { key: 'privasi', label: 'Privasi & Data Percakapan', icon: Lock },
  ] as const;

  return (
    <>
      <div className="p-3">
        <Link
          href={returnHref}
          title="Kembali ke Aplikasi"
          className="flex h-10 w-full items-center gap-3 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] pl-[13px] pr-3 text-sm font-medium text-[var(--text-primary)] shadow-sm transition-colors hover:bg-[var(--bg-elevated)] active:scale-[0.98]"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          <span aria-hidden={collapsed} className={labelClass}>
            Kembali ke Aplikasi
          </span>
        </Link>
      </div>

      <nav
        aria-label="Navigasi pengaturan akun"
        className={`min-h-0 flex-1 space-y-1 overflow-x-hidden overscroll-contain px-3 py-2 ${
          collapsed ? 'overflow-y-hidden' : 'overflow-y-auto scroll-region'
        }`}
      >
        <p
          aria-hidden={collapsed}
          className={`h-4 overflow-hidden px-2 text-[11px] font-semibold tracking-wider text-[var(--text-muted)] uppercase ${labelClass}`}
        >
          Pengaturan
        </p>

        {items.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.key;
          return (
            <Link
              key={item.key}
              href={`/akun?tab=${item.key}`}
              aria-current={active ? 'page' : undefined}
              title={item.label}
              className={`flex h-9 items-center gap-3 overflow-hidden rounded-lg pl-[14px] pr-3 text-sm transition-colors ${
                active
                  ? 'bg-[var(--bg-elevated)] font-semibold text-[var(--text-primary)]'
                  : 'font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]/70 hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span aria-hidden={collapsed} className={labelClass}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}

function SidebarMenu({
  collapsed,
  path,
  isAdmin,
}: {
  collapsed: boolean;
  path: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeSesiId = path === '/chat' ? searchParams.get('sesi') : null;

  const [sessions, setSessions] = useState<ChatSessionItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [savingRename, setSavingRename] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ChatSessionItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const cancelingEditRef = useRef(false);
  const fetchSeqRef = useRef(0);

  const loadSessions = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    try {
      const res = await api<{ data: ChatSessionItem[] }>('/chat/sesi?limit=50');
      if (seq === fetchSeqRef.current && Array.isArray(res?.data)) {
        setSessions(res.data);
      }
    } catch {
      /* backend sesi belum siap atau gangguan sementara; sidebar tetap aman */
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions, activeSesiId]);

  useEffect(() => {
    const onSessionsUpdated = () => {
      loadSessions();
    };
    window.addEventListener('sis-sessions-updated', onSessionsUpdated);
    return () => window.removeEventListener('sis-sessions-updated', onSessionsUpdated);
  }, [loadSessions]);

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.judul.toLowerCase().includes(q));
  }, [sessions, searchQuery]);

  const pinnedSessions = useMemo(
    () => filteredSessions.filter((s) => Boolean(s.pinned)),
    [filteredSessions]
  );
  const unpinnedSessions = useMemo(
    () => filteredSessions.filter((s) => !s.pinned),
    [filteredSessions]
  );
  const groupedUnpinned = useMemo(
    () => groupSessionsByDate(unpinnedSessions),
    [unpinnedSessions]
  );

  async function togglePin(item: ChatSessionItem) {
    const nextPinned = !item.pinned;
    setSessions((prev) =>
      prev.map((s) => (s.id === item.id ? { ...s, pinned: nextPinned } : s))
    );
    try {
      await api(`/chat/sesi/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        body: { pinned: nextPinned },
      });
      await loadSessions();
    } catch {
      await loadSessions();
    }
  }

  function startRename(item: ChatSessionItem) {
    cancelingEditRef.current = false;
    setEditingId(item.id);
    setEditingTitle(item.judul);
  }

  function cancelRename() {
    cancelingEditRef.current = true;
    setEditingId(null);
    setEditingTitle('');
  }

  async function commitRename(item: ChatSessionItem) {
    if (cancelingEditRef.current) {
      cancelingEditRef.current = false;
      return;
    }
    const trimmed = editingTitle.trim();
    if (!trimmed || trimmed === item.judul) {
      setEditingId(null);
      return;
    }
    setSavingRename(true);
    try {
      await api(`/chat/sesi/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        body: { judul: trimmed.slice(0, 160) },
      });
      setSessions((prev) =>
        prev.map((s) => (s.id === item.id ? { ...s, judul: trimmed.slice(0, 160) } : s))
      );
      setEditingId(null);
      await loadSessions();
    } catch {
      setEditingId(null);
    } finally {
      setSavingRename(false);
    }
  }

  async function confirmDeleteSession() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    const targetId = deleteTarget.id;
    try {
      await api(`/chat/sesi/${encodeURIComponent(targetId)}`, { method: 'DELETE' });
      setDeleteTarget(null);
      setSessions((prev) => prev.filter((s) => s.id !== targetId));
      if (activeSesiId === targetId) {
        try {
          sessionStorage.setItem('sis_reset_chat', '1');
        } catch {
          /* abaikan */
        }
        window.dispatchEvent(new Event('sis-chat'));
        router.replace('/chat');
      }
      await loadSessions();
    } catch {
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  const navClass = (active: boolean) =>
    `flex h-9 items-center gap-3 overflow-hidden rounded-lg pl-[14px] pr-3 text-sm transition-colors ${
      active
        ? 'bg-[var(--bg-elevated)] font-semibold text-[var(--text-primary)]'
        : 'font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]/70 hover:text-[var(--text-primary)]'
    }`;

  const labelClass = `whitespace-nowrap transition-opacity duration-150 ${
    collapsed ? 'pointer-events-none opacity-0' : 'opacity-100'
  }`;

  const onMaster = isMasterRoute(path);
  const onChatRoot = path === '/chat' && !activeSesiId;

  const renderSessionRow = (s: ChatSessionItem) => {
    const isActive = activeSesiId === s.id;
    const isEditing = editingId === s.id;

    if (isEditing) {
      return (
        <form
          key={s.id}
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            commitRename(s);
          }}
          className="flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1"
        >
          <label htmlFor={`rename-session-${s.id}`} className="visually-hidden">
            Judul percakapan baru
          </label>
          <input
            id={`rename-session-${s.id}`}
            name="judul"
            type="text"
            value={editingTitle}
            maxLength={160}
            disabled={savingRename}
            autoFocus
            onChange={(e) => setEditingTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                cancelRename();
              }
            }}
            onBlur={() => commitRename(s)}
            className="min-w-0 flex-1 bg-transparent text-xs text-[var(--text-primary)] focus:outline-none"
          />
          <button
            type="submit"
            disabled={savingRename}
            onMouseDown={(e) => e.preventDefault()}
            aria-label="Simpan judul"
            className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={savingRename}
            onMouseDown={(e) => {
              e.preventDefault();
              cancelRename();
            }}
            aria-label="Batal ubah judul"
            className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </form>
      );
    }

    return (
      <div
        key={s.id}
        className={`group relative flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs transition-colors ${
          isActive
            ? 'bg-[var(--bg-elevated)] font-semibold text-[var(--text-primary)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]/70 hover:text-[var(--text-primary)]'
        }`}
      >
        <Link
          href={`/chat?sesi=${encodeURIComponent(s.id)}`}
          aria-current={isActive ? 'page' : undefined}
          tabIndex={collapsed ? -1 : undefined}
          title={s.judul}
          className="flex min-w-0 flex-1 items-center gap-2 py-0.5"
        >
          {s.pinned ? (
            <Pin className="h-3 w-3 shrink-0 text-[var(--text-secondary)]" />
          ) : (
            <MessageSquare className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
          )}
          <span className="truncate">{s.judul}</span>
        </Link>

        <div
          className={`flex shrink-0 items-center gap-0.5 transition-opacity ${
            isActive
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100'
          }`}
        >
          <button
            type="button"
            tabIndex={collapsed ? -1 : undefined}
            onClick={() => togglePin(s)}
            title={s.pinned ? 'Lepas pin' : 'Sematkan percakapan'}
            aria-label={s.pinned ? `Lepas pin ${s.judul}` : `Sematkan ${s.judul}`}
            className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
          >
            {s.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
          </button>
          <button
            type="button"
            tabIndex={collapsed ? -1 : undefined}
            onClick={() => startRename(s)}
            title="Ubah judul"
            aria-label={`Ubah judul ${s.judul}`}
            className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            tabIndex={collapsed ? -1 : undefined}
            onClick={() => setDeleteTarget(s)}
            title="Hapus percakapan"
            aria-label={`Hapus ${s.judul}`}
            className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    );
  };

  const renderGroup = (label: string, list: ChatSessionItem[]) => {
    if (list.length === 0) return null;
    return (
      <div className="space-y-0.5">
        <p className="px-2 pt-1.5 text-[10px] font-medium tracking-wide text-[var(--text-muted)] uppercase whitespace-nowrap">
          {label}
        </p>
        {list.map(renderSessionRow)}
      </div>
    );
  };

  return (
    <>
      <nav
        aria-label="Navigasi utama"
        className={`min-h-0 flex-1 space-y-5 overflow-x-hidden overscroll-contain px-3 py-2 ${
          collapsed ? 'overflow-y-hidden' : 'overflow-y-auto scroll-region'
        }`}
      >
        {/* Menu Utama */}
        <div className="space-y-1">
          <p
            aria-hidden={collapsed}
            className={`h-4 overflow-hidden px-2 text-[11px] font-semibold tracking-wider text-[var(--text-muted)] uppercase ${labelClass}`}
          >
            Menu Utama
          </p>

          <Link
            href="/chat"
            aria-current={path === '/chat' ? 'page' : undefined}
            className={navClass(onChatRoot)}
            title="Tanya AI"
          >
            <MessageSquare className="h-4 w-4 shrink-0" />
            <span aria-hidden={collapsed} className={labelClass}>
              Tanya AI
            </span>
          </Link>

          <Link
            href="/knowledge"
            aria-current={path.startsWith('/knowledge') ? 'page' : undefined}
            className={navClass(path.startsWith('/knowledge'))}
            title="Knowledge Graph"
          >
            <Network className="h-4 w-4 shrink-0" />
            <span aria-hidden={collapsed} className={labelClass}>
              Knowledge Graph
            </span>
          </Link>
        </div>

        {/* Administrasi */}
        <div className="space-y-1 border-t border-[var(--border-subtle)] pt-3">
          <p
            aria-hidden={collapsed}
            className={`h-4 overflow-hidden px-2 text-[11px] font-semibold tracking-wider text-[var(--text-muted)] uppercase ${labelClass}`}
          >
            Administrasi
          </p>

          <Link
            href="/master"
            aria-current={onMaster ? 'page' : undefined}
            className={navClass(onMaster)}
            title="Master Data Sekolah"
          >
            <Database className="h-4 w-4 shrink-0" />
            <span aria-hidden={collapsed} className={labelClass}>
              Master
            </span>
          </Link>

          {isAdmin && (
            <Link
              href="/admin"
              aria-current={path.startsWith('/admin') ? 'page' : undefined}
              className={navClass(path.startsWith('/admin'))}
              title="User Management & Audit"
            >
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span aria-hidden={collapsed} className={labelClass}>
                User Management
              </span>
            </Link>
          )}
        </div>

        {/* Disematkan & Histori Percakapan */}
        {sessions.length > 0 && (
          <div
            aria-hidden={collapsed}
            className={`space-y-3 border-t border-[var(--border-subtle)] pt-3 transition-opacity duration-150 ${
              collapsed ? 'pointer-events-none opacity-0 select-none' : 'opacity-100'
            }`}
          >
            {sessions.length > 5 && (
              <div className="relative">
                <label htmlFor="sidebar-session-search" className="visually-hidden">
                  Cari riwayat percakapan
                </label>
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  id="sidebar-session-search"
                  name="q"
                  type="search"
                  tabIndex={collapsed ? -1 : undefined}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari percakapan…"
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-1.5 pl-8 pr-2.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-ink)] focus:outline-none"
                />
              </div>
            )}

            {pinnedSessions.length > 0 && (
              <div className="space-y-1">
                <p className="px-2 text-[11px] font-semibold tracking-wider text-[var(--text-muted)] uppercase whitespace-nowrap">
                  Disematkan
                </p>
                <div className="space-y-0.5">{pinnedSessions.map(renderSessionRow)}</div>
              </div>
            )}

            {unpinnedSessions.length > 0 && (
              <div className="space-y-1">
                <p className="px-2 text-[11px] font-semibold tracking-wider text-[var(--text-muted)] uppercase whitespace-nowrap">
                  Histori Percakapan
                </p>
                <div className="space-y-1">
                  {renderGroup('Hari ini', groupedUnpinned.today)}
                  {renderGroup('7 hari terakhir', groupedUnpinned.week)}
                  {renderGroup('Lebih lama', groupedUnpinned.older)}
                </div>
              </div>
            )}

            {filteredSessions.length === 0 && searchQuery.trim() !== '' && (
              <p className="px-2 text-xs text-[var(--text-muted)]">
                Tidak ada percakapan yang cocok.
              </p>
            )}
          </div>
        )}
      </nav>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Hapus percakapan?"
        description={
          deleteTarget
            ? `Percakapan "${deleteTarget.judul}" beserta seluruh riwayat pesannya akan dihapus permanen.`
            : undefined
        }
        confirmLabel="Hapus"
        cancelLabel="Batal"
        destructive
        busy={deleting}
        onConfirm={confirmDeleteSession}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null);
        }}
      />
    </>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const path = usePathname();

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('sis-shell-locked');
    return () => {
      root.classList.remove('sis-shell-locked');
    };
  }, []);

  useEffect(() => {
    preferences.applyToDom(preferences.get());
    const unsub = preferences.subscribe(() => {});
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setCollapsed(true);
    }
    return unsub;
  }, []);

  useEffect(() => {
    const syncUserFromStorage = () => {
      const updated = session.user();
      if (updated) setUser(updated);
    };
    window.addEventListener('sis-user-updated', syncUserFromStorage);
    window.addEventListener('storage', syncUserFromStorage);
    return () => {
      window.removeEventListener('sis-user-updated', syncUserFromStorage);
      window.removeEventListener('storage', syncUserFromStorage);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const token = session.token();
    const cached = session.user();

    async function verifySession() {
      if (!token) {
        window.location.replace('/login');
        return;
      }

      if (cached) {
        setUser(cached);
      }

      try {
        const fresh = await api<User>('/auth/me');
        if (!alive) return;
        session.save(token, fresh);
        setUser(fresh);
        if (fresh.wajib_ganti_password && path !== '/akun') {
          window.location.replace('/akun');
          return;
        }
        if (path.startsWith('/admin') && fresh.role !== 'admin') {
          window.location.replace('/chat');
          return;
        }
        setAuthReady(true);
      } catch (err) {
        if (!alive) return;
        if ((err instanceof ApiError && err.status === 401) || !session.token()) {
          return;
        }
        if (cached) {
          if (cached.wajib_ganti_password && path !== '/akun') {
            window.location.replace('/akun');
            return;
          }
          if (path.startsWith('/admin') && cached.role !== 'admin') {
            window.location.replace('/chat');
            return;
          }
          setAuthReady(true);
        } else {
          window.location.replace('/login');
        }
      }
    }

    verifySession();
    return () => {
      alive = false;
    };
  }, [path]);

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST', timeoutMs: 5000 });
    } catch {
      /* tetap keluar di sisi klien */
    }
    session.clear();
    window.location.href = '/login';
  }

  if (!authReady || !user) return null;

  const isAkunRoute = path === '/akun' || path.startsWith('/akun/');
  if (user.wajib_ganti_password && !isAkunRoute) return null;
  if (path.startsWith('/admin') && user.role !== 'admin') return null;

  const isAdmin = user.role === 'admin';
  const workspaceLabel = ROLE_WORKSPACE_LABELS[user.role] || 'Workspace';

  // Mode terisolasi hanya ketika wajib mengganti kata sandi sementara
  if (isAkunRoute && user.wajib_ganti_password) {
    return (
      <div className="fixed inset-0 flex h-dvh w-full max-w-full flex-col overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)]">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <SisBrandMark size="sm" />
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">
                SIS SMKN 4
              </span>
              <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                SMKN 4 Bandung · Wajib Ganti Kata Sandi
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={logout}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-500/20 dark:text-rose-300"
          >
            <LogOut className="h-4 w-4" />
            <span>Keluar</span>
          </button>
        </header>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-contain scroll-region p-6">
          <div className="m-auto w-full max-w-md">{children}</div>
        </main>
      </div>
    );
  }

  const isChatRoute = path === '/chat' || path.startsWith('/chat/');
  const labelOpacity = collapsed ? 'pointer-events-none opacity-0' : 'opacity-100';

  return (
    <div className="fixed inset-0 flex h-dvh w-full max-w-full overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <Suspense fallback={null}>
        <RouteTracker path={path} isAkunRoute={isAkunRoute} />
      </Suspense>

      {/* SIDEBAR */}
      <aside
        className={`flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-r border-[var(--border-subtle)] bg-[var(--bg-sidebar)] transition-[width] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none ${
          collapsed ? 'w-[68px]' : 'w-[268px]'
        }`}
      >
        {/* Header Brand & Collapse Toggle */}
        <div className="flex h-12 shrink-0 items-center border-b border-[var(--border-subtle)] px-3">
          <Link
            href="/chat"
            tabIndex={collapsed ? -1 : undefined}
            aria-hidden={collapsed}
            className={`flex items-center overflow-hidden whitespace-nowrap transition-opacity duration-150 ${
              collapsed
                ? 'pointer-events-none w-0 flex-none opacity-0'
                : 'min-w-0 flex-1 pr-2 opacity-100'
            }`}
          >
            <div className="flex w-[188px] shrink-0 items-center gap-2.5">
              <SisBrandMark size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold leading-none tracking-tight text-[var(--text-primary)]">
                  SIS SMKN 4
                </p>
                <p className="mt-0.5 truncate text-[10px] font-semibold leading-tight tracking-wider text-[var(--text-secondary)] uppercase">
                  {workspaceLabel}
                </p>
              </div>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="flex h-9 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            title={collapsed ? 'Perluas sidebar' : 'Ciutkan sidebar'}
            aria-label={collapsed ? 'Perluas sidebar' : 'Ciutkan sidebar'}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        {isAkunRoute ? (
          <Suspense
            fallback={
              <nav aria-label="Navigasi pengaturan akun" className="min-h-0 flex-1 space-y-1 overscroll-contain px-3 py-2" />
            }
          >
            <SettingsSidebarNav collapsed={collapsed} />
          </Suspense>
        ) : (
          <>
            {/* Primary Action: + Percakapan Baru */}
            <div className="p-3">
              <Link
                href="/chat"
                onClick={() => {
                  try {
                    sessionStorage.setItem('sis_reset_chat', '1');
                  } catch {
                    /* abaikan */
                  }
                  window.dispatchEvent(new Event('sis-chat'));
                }}
                title="Percakapan Baru"
                className="flex h-10 w-full items-center gap-3 overflow-hidden rounded-xl bg-[var(--accent-ink)] pl-[14px] pr-3 text-sm font-medium text-[var(--accent-ink-fg)] shadow-sm transition-colors hover:opacity-90 active:scale-[0.98]"
              >
                <Plus className="h-4 w-4 shrink-0" />
                <span
                  aria-hidden={collapsed}
                  className={`whitespace-nowrap transition-opacity duration-150 ${labelOpacity}`}
                >
                  Percakapan Baru
                </span>
              </Link>
            </div>

            {/* Navigasi + Histori Percakapan (useSearchParams dibungkus Suspense untuk Next 14) */}
            <Suspense
              fallback={
                <nav
                  aria-label="Navigasi utama"
                  className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-3 py-2"
                />
              }
            >
              <SidebarMenu collapsed={collapsed} path={path} isAdmin={isAdmin} />
            </Suspense>
          </>
        )}

        {/* Sidebar Footer */}
        <div className="border-t border-[var(--border-subtle)] p-3">
          <div className={`flex ${collapsed ? 'flex-col items-start gap-1.5' : 'items-center gap-1.5'}`}>
            <Link
              href="/akun"
              aria-current={isAkunRoute ? 'page' : undefined}
              title="Pengaturan Akun"
              className={`flex h-11 items-center gap-2.5 overflow-hidden rounded-xl pl-1.5 pr-2 transition-colors ${
                isAkunRoute
                  ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                  : 'hover:bg-[var(--bg-elevated)]/70'
              } ${collapsed ? 'w-11' : 'min-w-0 flex-1'}`}
            >
              <UserAvatar
                nama={user.nama}
                username={user.username}
                fotoProfil={user.foto_profil}
                size="sm"
              />
              <div
                aria-hidden={collapsed}
                className={`flex min-w-0 flex-col whitespace-nowrap text-left transition-opacity duration-150 ${labelOpacity}`}
              >
                <span className="truncate text-xs font-semibold text-[var(--text-primary)]">
                  {user.nama}
                </span>
                <span className="text-[11px] text-[var(--text-secondary)]">
                  {roleLabel(user.role)}
                </span>
              </div>
            </Link>

            <button
              type="button"
              onClick={logout}
              className={`flex h-9 shrink-0 items-center overflow-hidden rounded-lg text-[var(--text-muted)] transition-colors hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400 ${
                collapsed ? 'w-11 pl-[14px]' : 'w-9 justify-center'
              }`}
              title="Keluar"
              aria-label="Keluar"
            >
              <LogOut className="h-4 w-4 shrink-0" />
            </button>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <h1 className="truncate text-sm font-semibold tracking-tight text-[var(--text-primary)]">
              {getHeaderTitle(path)}
            </h1>
          </div>
        </header>

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <RouteTransitionLoader />
          <main
            className={
              isChatRoute
                ? 'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'
                : 'min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain scroll-region p-4 sm:p-6'
            }
          >
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

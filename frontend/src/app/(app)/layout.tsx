'use client';
import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { API, ApiError, api, session, User } from '@/lib/api';
import { setOracleAnonMode } from '@/lib/oracleApi';
import {
  MessageSquare,
  Users,
  FolderKanban,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  ShieldCheck,
  ShieldAlert,
  LogOut,
  LogIn,
  ArrowLeft,
  Calendar,
  Briefcase,
  School,
  FileSpreadsheet,
  UserCheck,
  Building2,
} from 'lucide-react';

const ORACLE_ROUTES = ['/kedisiplinan', '/rekap-akademik'];

function isOracleRoute(pathname: string): boolean {
  return ORACLE_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

type HealthInfo = {
  status: string;
  database?: string;
  tahun_ajaran?: string;
  gemini: string;
  gemini_kirim_data?: boolean;
  oracle_public?: boolean;
};

export default function AppLayout({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [anonOracleMode, setAnonOracleMode] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const path = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setCollapsed(true);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const token = session.token();
    const cached = session.user();

    async function fetchHealth(): Promise<HealthInfo | null> {
      return fetch(`${API}/health`)
        .then((r) => (r.ok ? (r.json() as Promise<HealthInfo>) : null))
        .catch(() => null);
    }

    async function verifySession() {
      if (!token) {
        const h = await fetchHealth();
        if (!alive) return;
        if (h) setHealth(h);

        if (isOracleRoute(path) && h?.oracle_public) {
          setOracleAnonMode(true);
          setUser(null);
          setAnonOracleMode(true);
          setAuthReady(true);
          return;
        }
        setOracleAnonMode(false);
        window.location.replace('/login');
        return;
      }

      if (cached) {
        setUser(cached);
        setAnonOracleMode(false);
      }

      const [healthRes, meRes] = await Promise.allSettled([fetchHealth(), api<User>('/auth/me')]);
      if (!alive) return;

      const h = healthRes.status === 'fulfilled' ? healthRes.value : null;
      if (h) setHealth(h);

      if (meRes.status === 'fulfilled') {
        const fresh = meRes.value;
        session.save(token, fresh);
        setOracleAnonMode(false);
        setUser(fresh);
        setAnonOracleMode(false);
        if (fresh.wajib_ganti_password && path !== '/akun') {
          window.location.replace('/akun');
          return;
        }
        if (path.startsWith('/admin') && fresh.role !== 'admin') {
          window.location.replace('/chat');
          return;
        }
        setAuthReady(true);
        return;
      }

      // /auth/me gagal
      const err = meRes.reason;
      if ((err instanceof ApiError && err.status === 401) || !session.token()) {
        // 401 sudah ditangani api() -> clear & redirect /login; jangan mount halaman dengan cache basi
        return;
      }

      if (isOracleRoute(path) && h?.oracle_public && h?.database !== 'ok') {
        setOracleAnonMode(true);
        setUser(null);
        setAnonOracleMode(true);
        setAuthReady(true);
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
        setOracleAnonMode(false);
        setAuthReady(true);
      } else {
        window.location.replace('/login');
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
    setOracleAnonMode(false);
    session.clear();
    window.location.href = '/login';
  }

  if (!authReady || (!user && !anonOracleMode)) return null;

  const isAkunRoute = path === '/akun' || path.startsWith('/akun/');
  if (user?.wajib_ganti_password && !isAkunRoute) return null;
  if (path.startsWith('/admin') && user?.role !== 'admin') return null;

  const isAdmin = user?.role === 'admin';
  const tahunAjaran = health?.tahun_ajaran || '2026/2027';

  if (isAkunRoute) {
    const mustChangePassword = Boolean(user?.wajib_ganti_password);
    return (
      <div className="flex min-h-screen w-full flex-col bg-[#F8FAFC]">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-blue-600 text-white shadow-sm shadow-blue-200">
              <img src="/images/logo.png" alt="Logo SMKN 4 Bandung" className="h-full w-full object-cover" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-bold tracking-tight text-slate-900">School Intelligence System</span>
              <span className="text-[11px] font-medium text-slate-500">SMKN 4 Bandung · Pengaturan Akun</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!mustChangePassword && (
              <Link
                href="/chat"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Kembali</span>
              </Link>
            )}
            <button
              type="button"
              onClick={logout}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-100"
            >
              <LogOut className="h-4 w-4" />
              <span>Keluar</span>
            </button>
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center p-6">
          {children}
        </main>
      </div>
    );
  }

  const navClass = (active: boolean) =>
    `flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
      active ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
    } ${collapsed ? 'justify-center' : ''}`;

  const userInitials = (user?.nama || user?.username || '?').slice(0, 2).toUpperCase();

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F8FAFC]">
      {/* SIDEBAR */}
      <aside
        className={`flex shrink-0 flex-col border-r border-slate-200 bg-white transition-all duration-300 ease-in-out ${
          collapsed ? 'w-20' : 'w-64'
        }`}
      >
        {/* Brand / School identity */}
        <div
          className={`flex min-h-16 items-center border-b border-slate-100 py-2.5 ${
            collapsed ? 'justify-center px-2' : 'justify-between gap-2 px-3.5'
          }`}
        >
          {!collapsed && (
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-blue-600 text-white shadow-sm shadow-blue-200">
                <img src="/images/logo.png" alt="Logo SMKN 4 Bandung" className="h-full w-full object-cover" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold leading-tight tracking-tight text-slate-900">
                  School Intelligence System
                </p>
                <p className="mt-0.5 text-[10px] font-semibold tracking-wider text-blue-600 uppercase">
                  {anonOracleMode ? 'Akses Terbatas' : isAdmin ? 'Admin Workspace' : 'Teacher Portal'}
                </p>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            title={collapsed ? 'Perluas sidebar' : 'Ciutkan sidebar'}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        {/* School & Academic Year */}
        {!collapsed ? (
          <div className="mx-3 mt-3 flex items-center justify-between rounded-xl border border-slate-200/80 bg-slate-50/70 p-2.5">
            <div className="flex flex-col truncate">
              <span className="truncate text-xs font-semibold text-slate-800">SMKN 4 Bandung</span>
              <span className="text-[11px] text-slate-500">Tahun Ajaran {tahunAjaran}</span>
            </div>
            <School className="h-4 w-4 shrink-0 text-slate-400" />
          </div>
        ) : (
          <div
            className="mx-auto mt-3 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600"
            title={`SMKN 4 Bandung · Tahun Ajaran ${tahunAjaran}`}
          >
            <School className="h-4 w-4" />
          </div>
        )}

        {/* Primary Action: New Chat (hanya bila login) */}
        {!anonOracleMode && (
          <div className="p-3">
            <Link
              href="/chat"
              onClick={() => {
                sessionStorage.setItem('sis_reset_chat', '1');
                if (path === '/chat') window.dispatchEvent(new Event('sis-chat'));
              }}
              title="Percakapan Baru"
              className={`flex items-center gap-2 rounded-xl bg-blue-600 font-medium text-white shadow-sm shadow-blue-200 transition-all hover:bg-blue-700 active:scale-[0.98] ${
                collapsed ? 'mx-auto h-10 w-10 justify-center p-0' : 'px-3.5 py-2.5 text-sm'
              }`}
            >
              <Plus className="h-4 w-4 shrink-0" />
              {!collapsed && <span>Percakapan Baru</span>}
            </Link>
          </div>
        )}

        {/* Navigations */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-5">
          {!anonOracleMode && (
            <div className="space-y-1">
              {!collapsed && <p className="px-2 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Menu Utama</p>}

              <Link href="/chat" className={navClass(path === '/chat')} title="Tanya AI">
                <MessageSquare className="h-4 w-4 shrink-0" />
                {!collapsed && <span>Tanya AI</span>}
              </Link>

              <Link href="/siswa" className={navClass(path.startsWith('/siswa'))} title="Data Siswa">
                <Users className="h-4 w-4 shrink-0" />
                {!collapsed && <span>Data Siswa</span>}
              </Link>

              <Link href="/kelas" className={navClass(path.startsWith('/kelas'))} title="Kelas & Jadwal">
                <FolderKanban className="h-4 w-4 shrink-0" />
                {!collapsed && <span>Kelas &amp; Jadwal</span>}
              </Link>

              <Link href="/guru" className={navClass(path.startsWith('/guru'))} title="Guru & Jadwal Mengajar">
                <UserCheck className="h-4 w-4 shrink-0" />
                {!collapsed && <span>Guru &amp; Jadwal</span>}
              </Link>

              <Link href="/pkl" className={navClass(path.startsWith('/pkl'))} title="Penempatan PKL">
                <Briefcase className="h-4 w-4 shrink-0" />
                {!collapsed && <span>Penempatan PKL</span>}
              </Link>

              <Link href="/ekskul" className={navClass(path.startsWith('/ekskul'))} title="Ekstrakurikuler">
                <Calendar className="h-4 w-4 shrink-0" />
                {!collapsed && <span>Ekstrakurikuler</span>}
              </Link>

              <Link href="/profil-sekolah" className={navClass(path.startsWith('/profil-sekolah'))} title="Profil Sekolah">
                <Building2 className="h-4 w-4 shrink-0" />
                {!collapsed && <span>Profil Sekolah</span>}
              </Link>
            </div>
          )}

          {/* Kedisiplinan & Akademik */}
          <div className="space-y-1">
            {!collapsed && (
              <p className="px-2 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
                Kedisiplinan &amp; Akademik
              </p>
            )}

            <Link href="/kedisiplinan" className={navClass(path.startsWith('/kedisiplinan'))} title="Kedisiplinan">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              {!collapsed && <span>Kedisiplinan</span>}
            </Link>

            <Link href="/rekap-akademik" className={navClass(path.startsWith('/rekap-akademik'))} title="Rekap Akademik">
              <FileSpreadsheet className="h-4 w-4 shrink-0" />
              {!collapsed && <span>Rekap Akademik</span>}
            </Link>
          </div>

          {/* Administrasi (PostgreSQL lokal, khusus admin) */}
          {!anonOracleMode && isAdmin && (
            <div className="space-y-1">
              {!collapsed && (
                <p className="px-2 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
                  Administrasi
                </p>
              )}

              <Link href="/admin" className={navClass(path.startsWith('/admin'))} title="User Management & Audit">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                {!collapsed && <span>User Management</span>}
              </Link>
            </div>
          )}

          {/* Quick suggestions (hanya saat login) */}
          {!anonOracleMode && !collapsed && (
            <div className="space-y-1 pt-1">
              <p className="px-2 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Topik Populer</p>
              <div className="space-y-0.5">
                {[
                  'Siapa wali kelas XII TITL 6?',
                  'Siswa XII RPL 1 yang nilainya di bawah KKM',
                  'Siapa saja yang alpha lebih dari 5 hari semester ini?',
                  'Siapa saja PKL di PLN?',
                ].map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      sessionStorage.setItem('sis_pending_q', item);
                      if (path === '/chat') window.dispatchEvent(new Event('sis-chat'));
                      else router.push('/chat');
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  >
                    <MessageSquare className="h-3 w-3 shrink-0 text-slate-400" />
                    <span className="truncate">{item}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar Footer */}
        <div className="border-t border-slate-100 p-3 space-y-2">
          {anonOracleMode ? (
            <Link
              href="/login"
              className={`btn flex w-full items-center justify-center gap-2 ${collapsed ? 'px-0' : ''}`}
              title="Masuk ke Akun SIS"
            >
              <LogIn className="h-4 w-4 shrink-0" />
              {!collapsed && <span>Masuk (Login)</span>}
            </Link>
          ) : (
            user && (
              <div
                className={
                  collapsed
                    ? 'flex flex-col items-center gap-2 pt-1'
                    : 'flex items-center justify-between gap-2 pt-1'
                }
              >
                <Link
                  href="/akun"
                  title="Pengaturan Akun"
                  className={`flex items-center gap-2.5 rounded-xl p-1.5 transition-colors hover:bg-slate-100 ${
                    collapsed ? 'justify-center' : 'min-w-0 flex-1'
                  }`}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 font-bold text-xs text-blue-700">
                    {userInitials}
                  </div>
                  {!collapsed && (
                    <div className="flex min-w-0 flex-col text-left">
                      <span className="truncate text-xs font-semibold text-slate-900">{user.nama}</span>
                      <span className="text-[11px] text-slate-500 capitalize">{user.role}</span>
                    </div>
                  )}
                </Link>

                <button
                  type="button"
                  onClick={logout}
                  className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  title="Keluar"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            )
          )}
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200/80 bg-white px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <h1 className="truncate text-base font-bold text-slate-900">
              {path === '/chat' && 'AI School Assistant'}
              {path.startsWith('/siswa') && 'Data Siswa Kelas XII'}
              {path.startsWith('/kelas') && 'Kelas & Jadwal Pelajaran'}
              {path.startsWith('/guru') && 'Guru & Jadwal Mengajar'}
              {path.startsWith('/pkl') && 'Penempatan & Mitra PKL'}
              {path.startsWith('/ekskul') && 'Kegiatan Ekstrakurikuler'}
              {path.startsWith('/profil-sekolah') && 'Profil SMKN 4 Bandung'}
              {path.startsWith('/kedisiplinan') && 'Kedisiplinan & Pelanggaran Siswa'}
              {path.startsWith('/rekap-akademik') && 'Rekapitulasi Akademik & KKM'}
              {path.startsWith('/admin') && 'User Management & Audit'}
            </h1>
          </div>
        </header>

        {/* Dynamic page content */}
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}

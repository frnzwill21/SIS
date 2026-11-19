'use client';
import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { API, api, session, User } from '@/lib/api';
import {
  GraduationCap,
  MessageSquare,
  Users,
  FolderKanban,
  Settings,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  ShieldCheck,
  LogOut,
  Calendar,
  Briefcase,
  Sparkles,
  School,
  FileSpreadsheet
} from 'lucide-react';

export default function AppLayout({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [health, setHealth] = useState<{ status: string; gemini: string; gemini_kirim_data?: boolean } | null>(null);
  const path = usePathname();
  const router = useRouter();

  useEffect(() => {
    const u = session.user();
    if (!session.token() || !u) {
      window.location.replace('/login');
      return;
    }
    setUser(u);
    if (u.wajib_ganti_password && path !== '/akun') {
      window.location.replace('/akun');
    } else if (path.startsWith('/admin') && u.role !== 'admin') {
      window.location.replace('/chat'); // cermin kebijakan backend; backend tetap penegak utamanya
    }
  }, [path]);

  useEffect(() => {
    fetch(`${API}/health`).then((r) => r.json()).then(setHealth).catch(() => setHealth(null));
  }, []);

  async function logout() {
    try { await api('/auth/logout', { method: 'POST', timeoutMs: 5000 }); } catch { /* tetap keluar di sisi klien */ }
    session.clear();
    window.location.href = '/login';
  }

  if (!user) return null;

  const isAdmin = user.role === 'admin';

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F8FAFC]">
      {/* SIDEBAR */}
      <aside
        className={`flex flex-col border-r border-slate-200 bg-white transition-all duration-300 ease-in-out ${
          collapsed ? 'w-20' : 'w-64'
        }`}
      >
        {/* Brand / School identity */}
        <div className="flex h-16 items-center justify-between border-b border-slate-100 px-4">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm shadow-blue-200">
              <img src="../../assets/images/image.png" />
            </div>
            {!collapsed && (
              <div className="flex flex-col truncate">
                <span className="text-sm font-bold tracking-tight text-slate-900">School Intelligent System</span>
                <span className="text-[10px] font-semibold tracking-wider text-blue-600 uppercase">
                  {isAdmin ? 'Admin Workspace' : 'Teacher Portal'}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            title={collapsed ? 'Perluas sidebar' : 'Ciutkan sidebar'}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        {/* School & Academic Year Switcher */}
        {!collapsed ? (
          <div className="mx-3 mt-3 flex items-center justify-between rounded-xl border border-slate-200/80 bg-slate-50/70 p-2.5">
            <div className="flex flex-col truncate">
              <span className="truncate text-xs font-semibold text-slate-800">SMKN 4 Bandung</span>
              <span className="text-[11px] text-slate-500">Tahun Ajaran 2026/2027</span>
            </div>
            <School className="h-4 w-4 shrink-0 text-slate-400" />
          </div>
        ) : (
          <div className="mx-auto mt-3 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
            <School className="h-4 w-4" />
          </div>
        )}

        {/* Primary Action: New Chat */}
        <div className="p-3">
          <Link
            href="/chat"
            onClick={() => {
              sessionStorage.setItem('sis_reset_chat', '1');
              if (path === '/chat') window.dispatchEvent(new Event('sis-chat'));
            }}
            className={`flex items-center gap-2 rounded-xl bg-blue-600 font-medium text-white shadow-sm shadow-blue-200 transition-all hover:bg-blue-700 active:scale-[0.98] ${
              collapsed ? 'h-10 w-10 justify-center p-0' : 'px-3.5 py-2.5 text-sm'
            }`}
          >
            <Plus className="h-4 w-4 shrink-0" />
            {!collapsed && <span>Percakapan Baru</span>}
          </Link>
        </div>

        {/* Navigations */}
        <div className="flex-1 overflow-y-auto px-3 py-1 space-y-6">
          {/* Main Menu */}
          <div className="space-y-1">
            {!collapsed && <p className="px-2 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Menu Utama</p>}
            
            <Link
              href="/chat"
              className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
                path === '/chat'
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              } ${collapsed ? 'justify-center' : ''}`}
              title="Tanya AI"
            >
              <MessageSquare className="h-4 w-4 shrink-0" />
              {!collapsed && <span>Tanya AI</span>}
            </Link>

            <Link
              href="/siswa"
              className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
                path.startsWith('/siswa')
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              } ${collapsed ? 'justify-center' : ''}`}
              title="Data Siswa"
            >
              <Users className="h-4 w-4 shrink-0" />
              {!collapsed && <span>Data Siswa</span>}
            </Link>

            <Link
              href="/kelas"
              className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
                path.startsWith('/kelas')
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              } ${collapsed ? 'justify-center' : ''}`}
              title="Kelas & Jadwal"
            >
              <FolderKanban className="h-4 w-4 shrink-0" />
              {!collapsed && <span>Kelas & Jadwal</span>}
            </Link>

            <Link
              href="/pkl"
              className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
                path.startsWith('/pkl')
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              } ${collapsed ? 'justify-center' : ''}`}
              title="Penempatan PKL"
            >
              <Briefcase className="h-4 w-4 shrink-0" />
              {!collapsed && <span>Penempatan PKL</span>}
            </Link>

            <Link
              href="/ekskul"
              className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
                path.startsWith('/ekskul')
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              } ${collapsed ? 'justify-center' : ''}`}
              title="Ekstrakurikuler"
            >
              <Calendar className="h-4 w-4 shrink-0" />
              {!collapsed && <span>Ekstrakurikuler</span>}
            </Link>

            {isAdmin && (
              <Link
                href="/admin"
                className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
                  path.startsWith('/admin')
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                } ${collapsed ? 'justify-center' : ''}`}
                title="User Management & Audit"
              >
                <ShieldCheck className="h-4 w-4 shrink-0" />
                {!collapsed && <span>User Management</span>}
              </Link>
            )}
          </div>

          {/* Quick suggestions / Recent sample */}
          {!collapsed && (
            <div className="space-y-1 pt-2">
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
                    onClick={() => {
                      sessionStorage.setItem('sis_pending_q', item);
                      if (path === '/chat') window.dispatchEvent(new Event('sis-chat'));
                      else router.push('/chat');
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  >
                    <MessageSquare className="h-3 w-3 text-slate-400" />
                    <span className="truncate">{item}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar Footer */}
        <div className="border-t border-slate-100 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 pt-1">
            <Link
              href="/akun"
              className={`flex flex-1 items-center gap-2.5 rounded-xl p-1.5 transition-colors hover:bg-slate-100 ${
                collapsed ? 'justify-center' : ''
              }`}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 font-bold text-xs text-blue-700">
                {user.nama.slice(0, 2).toUpperCase()}
              </div>
              {!collapsed && (
                <div className="flex flex-col truncate text-left">
                  <span className="truncate text-xs font-semibold text-slate-900">{user.nama}</span>
                  <span className="text-[11px] text-slate-500 capitalize">{user.role}</span>
                </div>
              )}
            </Link>

            {/* selalu terlihat: komputer sekolah dipakai bergantian, keluar tidak boleh bergantung pada sidebar terbuka */}
            <button onClick={logout} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Keluar">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white px-6">
          <div className="flex items-center gap-2.5">
            <h1 className="text-base font-bold text-slate-900">
              {path === '/chat' && 'AI School Assistant'}
              {path.startsWith('/siswa') && 'Data Siswa Kelas XII'}
              {path.startsWith('/kelas') && 'Kelas & Jadwal Pelajaran'}
              {path.startsWith('/pkl') && 'Penempatan & Mitra PKL'}
              {path.startsWith('/ekskul') && 'Kegiatan Ekstrakurikuler'}
              {path.startsWith('/admin') && 'User Management & Audit'}
              {path.startsWith('/akun') && 'Pengaturan Akun'}
            </h1>
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 border border-blue-200/60">
              BETA
            </span>
          </div>

        </header>

        {/* Dynamic page content */}
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}

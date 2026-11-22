'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  FileSpreadsheet,
  History,
  KeyRound,
  RotateCcw,
  Search,
  UserCheck,
  UserPlus,
  Users,
  UserX,
  X,
} from 'lucide-react';
import { api, Role, roleLabel, Row, session, User } from '@/lib/api';
import DataTable from '@/components/DataTable';
import ConfirmDialog from '@/components/ConfirmDialog';
import UserAvatar from '@/components/UserAvatar';
import Combobox, { ComboboxOption } from '@/components/ui/Combobox';
import RoleSelect, { ROLE_META, ROLE_OPTIONS } from '@/components/ui/RoleSelect';
import { useLoad, Status } from '@/components/useLoad';

type Tab = 'akun' | 'audit' | 'impor';
type RoleFilter = 'all' | Role;

type PendingUserAction = {
  user: Row;
  body: { aktif?: boolean; role?: Role; reset_password?: boolean };
  title: string;
  description: string;
  confirmLabel: string;
  destructive: boolean;
};

type BannerInfo = {
  message: string;
  tempPassword?: string;
};

const ADMIN_TABS: { key: Tab; label: string; icon: typeof Users }[] = [
  { key: 'akun', label: 'Manajemen Akun', icon: Users },
  { key: 'audit', label: 'Audit Log', icon: History },
  { key: 'impor', label: 'Riwayat Impor', icon: FileSpreadsheet },
];

const INSTAGRAM_USERNAME_REGEX = /^(?!\.)(?!.*\.\.)[a-zA-Z0-9._]{3,30}(?<!\.)$/;

function validateUsernameFormat(raw: string): string | null {
  const u = raw.trim();
  if (u.length < 3) return 'Username minimal 3 karakter.';
  if (u.length > 30) return 'Username maksimal 30 karakter.';
  if (!/^[a-zA-Z0-9._]+$/.test(u)) {
    return 'Username hanya boleh berisi huruf, angka, titik (.), atau garis bawah (_).';
  }
  if (u.startsWith('.') || u.endsWith('.')) {
    return 'Username tidak boleh diawali atau diakhiri dengan titik (.).';
  }
  if (u.includes('..')) {
    return 'Username tidak boleh mengandung dua titik berurutan (..).';
  }
  if (!INSTAGRAM_USERNAME_REGEX.test(u)) {
    return 'Format username tidak valid.';
  }
  return null;
}

export default function Admin() {
  const [me, setMe] = useState<User | null>(null);
  const [checkedAuth, setCheckedAuth] = useState(false);

  const [tab, setTab] = useState<Tab>('akun');
  const [tick, setTick] = useState(0);
  const [info, setInfo] = useState<BannerInfo | null>(null);
  const [copiedPass, setCopiedPass] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const [usernameErr, setUsernameErr] = useState('');
  const [namaErr, setNamaErr] = useState('');
  const [creating, setCreating] = useState(false);
  const [actingId, setActingId] = useState<number | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingUserAction | null>(null);
  const [f, setF] = useState<{ username: string; nama: string; role: Role; nip: string }>({
    username: '',
    nama: '',
    role: 'teacher',
    nip: '',
  });
  const usernameRef = useRef<HTMLInputElement>(null);
  const namaRef = useRef<HTMLInputElement>(null);

  // Filter tabel Manajemen Akun
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');

  // Filter & paginasi Audit Log
  const [auditUser, setAuditUser] = useState('');
  const [debouncedAuditUser, setDebouncedAuditUser] = useState('');
  const [auditDari, setAuditDari] = useState('');
  const [auditSampai, setAuditSampai] = useState('');
  const [auditPage, setAuditPage] = useState(1);

  useEffect(() => {
    setMe(session.user());
    setCheckedAuth(true);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedAuditUser(auditUser.trim());
      setAuditPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [auditUser]);

  const isAdmin = checkedAuth && me?.role === 'admin';

  const auditParams = new URLSearchParams({ page: String(auditPage), page_size: '50' });
  if (debouncedAuditUser) auditParams.set('user', debouncedAuditUser);
  if (auditDari) auditParams.set('dari', auditDari);
  if (auditSampai) auditParams.set('sampai', auditSampai);

  const users = useLoad<{ data: Row[] }>(isAdmin && tab === 'akun' ? `/users?t=${tick}` : null);
  const guruList = useLoad<{ data: Row[] }>(isAdmin && tab === 'akun' ? '/guru' : null);
  const audit = useLoad<{ data: Row[]; meta: { page: number; page_size: number; total: number } }>(
    isAdmin && tab === 'audit' ? `/admin/audit?${auditParams.toString()}` : null
  );
  const impor = useLoad<{ data: Row[] }>(isAdmin && tab === 'impor' ? '/admin/impor' : null);
  const cur = tab === 'akun' ? users : tab === 'audit' ? audit : impor;
  const gurus = guruList.data?.data ?? [];

  const guruOptions: ComboboxOption[] = useMemo(
    () =>
      gurus.map((g) => {
        const nip = String(g.nip);
        const nama = String(g.nama);
        return {
          value: nip,
          label: nama,
          sublabel: `NIP ${nip}`,
        };
      }),
    [gurus]
  );

  const allUsers = users.data?.data ?? [];

  const roleCounts = useMemo(() => {
    const counts: Record<Role, number> = {
      teacher: 0,
      bk: 0,
      kepala_sekolah: 0,
      admin: 0,
    };
    for (const u of allUsers) {
      const r = String(u.role) as Role;
      if (r in counts) counts[r] += 1;
    }
    return counts;
  }, [allUsers]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    return allUsers.filter((u) => {
      if (roleFilter !== 'all' && String(u.role) !== roleFilter) {
        return false;
      }
      if (!q) return true;
      const username = String(u.username ?? '').toLowerCase();
      const nama = String(u.nama ?? '').toLowerCase();
      const nip = String(u.nip ?? '').toLowerCase();
      return username.includes(q) || nama.includes(q) || nip.includes(q);
    });
  }, [allUsers, userSearch, roleFilter]);

  if (!isAdmin) return null;

  const auditTotal = audit.data?.meta.total ?? 0;
  const auditPages = Math.max(1, Math.ceil(auditTotal / 50));
  const hasUserFilters = Boolean(userSearch.trim() || roleFilter !== 'all');

  function handleSelectGuru(nextNip: string) {
    const prevGuru = gurus.find((g) => String(g.nip) === f.nip);
    const nextGuru = gurus.find((g) => String(g.nip) === nextNip);
    const nextGuruNama = nextGuru ? String(nextGuru.nama) : '';
    const prevGuruNama = prevGuru ? String(prevGuru.nama) : '';
    const shouldSyncName = !f.nama.trim() || (prevGuruNama !== '' && f.nama === prevGuruNama);
    setF((prev) => ({
      ...prev,
      nip: nextNip,
      nama: shouldSyncName ? nextGuruNama : prev.nama,
    }));
    if (shouldSyncName && nextGuruNama.trim()) {
      setNamaErr('');
    }
  }

  async function buat(e: FormEvent) {
    e.preventDefault();
    if (creating) return;
    setErrMsg('');
    setCopiedPass(false);

    const trimmedUsername = f.username.trim();
    const uErr = validateUsernameFormat(trimmedUsername);
    if (uErr) {
      setUsernameErr(uErr);
      usernameRef.current?.focus();
      return;
    }
    setUsernameErr('');

    const trimmedNama = f.nama.trim();
    if (!trimmedNama) {
      setNamaErr('Nama lengkap wajib diisi.');
      namaRef.current?.focus();
      return;
    }
    setNamaErr('');

    setCreating(true);
    try {
      const payload = {
        username: trimmedUsername,
        nama: trimmedNama,
        role: f.role,
        nip: f.role === 'admin' ? null : f.nip.trim() || null,
      };
      const r = await api('/users', { method: 'POST', body: payload });
      setInfo({
        message: `Akun ${r.username} dibuat. Kata sandi awal (catat sekarang, tidak ditampilkan lagi): ${r.password_awal}`,
        tempPassword: r.password_awal ? String(r.password_awal) : undefined,
      });
      setF({ username: '', nama: '', role: 'teacher', nip: '' });
      setUsernameErr('');
      setNamaErr('');
      if (usernameRef.current) usernameRef.current.setCustomValidity('');
      setTick((prev) => prev + 1);
    } catch (err) {
      setErrMsg((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  function requestUbah(u: Row, body: { aktif?: boolean; role?: Role; reset_password?: boolean }) {
    const uid = Number(u.id);
    if (actingId !== null || uid === me?.id) return;
    const uname = String(u.username);
    if (body.reset_password) {
      setPendingAction({
        user: u,
        body,
        title: `Reset Kata Sandi "${uname}"`,
        description:
          'Kata sandi sementara baru akan dibuat dan sesi login aktif akun ini akan segera dicabut.',
        confirmLabel: 'Reset Kata Sandi',
        destructive: true,
      });
    } else if (body.role) {
      setPendingAction({
        user: u,
        body,
        title: `Ubah Peran "${uname}"`,
        description: `Ubah peran akun ini menjadi "${roleLabel(
          body.role
        )}"? Sesi login aktif akun ini akan dicabut agar hak akses baru berlaku.`,
        confirmLabel: 'Ubah Peran',
        destructive: false,
      });
    } else if (body.aktif === false) {
      setPendingAction({
        user: u,
        body,
        title: `Nonaktifkan "${uname}"`,
        description: 'Akun ini tidak akan bisa login dan semua sesi aktifnya akan segera dicabut.',
        confirmLabel: 'Nonaktifkan',
        destructive: true,
      });
    } else {
      setPendingAction({
        user: u,
        body,
        title: `Aktifkan "${uname}"`,
        description: `Aktifkan kembali akses login untuk akun "${uname}"?`,
        confirmLabel: 'Aktifkan',
        destructive: false,
      });
    }
  }

  async function confirmUbah() {
    if (!pendingAction) return;
    const { user: u, body } = pendingAction;
    const uid = Number(u.id);
    const uname = String(u.username);

    setErrMsg('');
    setCopiedPass(false);
    setActingId(uid);
    try {
      const r = await api(`/users/${uid}`, { method: 'PATCH', body });
      if (r.password_baru) {
        setInfo({
          message: `Kata sandi baru untuk ${uname} (catat sekarang): ${r.password_baru}`,
          tempPassword: String(r.password_baru),
        });
      } else if (r.role) {
        setInfo({
          message: `Peran akun ${uname} berhasil diubah menjadi ${roleLabel(r.role)}.`,
        });
      } else {
        setInfo({
          message: `Status akun ${uname} berhasil diperbarui.`,
        });
      }
      setTick((prev) => prev + 1);
      setPendingAction(null);
    } catch (err) {
      setErrMsg((err as Error).message);
      setPendingAction(null);
    } finally {
      setActingId(null);
    }
  }

  async function copyTempPassword() {
    if (!info?.tempPassword) return;
    try {
      await navigator.clipboard.writeText(info.tempPassword);
      setCopiedPass(true);
      setTimeout(() => setCopiedPass(false), 2000);
    } catch {
      /* abaikan bila clipboard ditolak browser */
    }
  }

  function switchTab(nextTab: Tab) {
    setTab(nextTab);
    setInfo(null);
    setErrMsg('');
  }

  return (
    <div className="space-y-4">
      {/* Tab Navigasi Admin */}
      <div
        role="tablist"
        aria-label="Bagian administrasi"
        className="flex flex-wrap gap-2 border-b border-[var(--border-subtle)] pb-3"
      >
        {ADMIN_TABS.map((t, idx) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              id={`admin-tab-${t.key}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="admin-tabpanel"
              tabIndex={active ? 0 : -1}
              className={active ? 'btn' : 'btn-ghost'}
              onClick={() => switchTab(t.key)}
              onKeyDown={(e) => {
                let nextIdx: number | null = null;
                if (e.key === 'ArrowRight') nextIdx = (idx + 1) % ADMIN_TABS.length;
                else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + ADMIN_TABS.length) % ADMIN_TABS.length;
                else if (e.key === 'Home') nextIdx = 0;
                else if (e.key === 'End') nextIdx = ADMIN_TABS.length - 1;
                if (nextIdx !== null) {
                  e.preventDefault();
                  const next = ADMIN_TABS[nextIdx];
                  switchTab(next.key);
                  document.getElementById(`admin-tab-${next.key}`)?.focus();
                }
              }}
            >
              <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      <div id="admin-tabpanel" role="tabpanel" aria-labelledby={`admin-tab-${tab}`} className="space-y-4">

      {/* Notifikasi Sukses & Sandi Sementara */}
      {info && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-200"
        >
          <p className="min-w-0 flex-1 break-words">{info.message}</p>
          <div className="flex shrink-0 items-center gap-1.5">
            {info.tempPassword && (
              <button
                type="button"
                onClick={copyTempPassword}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-500/15 dark:text-emerald-200"
              >
                {copiedPass ? (
                  <>
                    <Check aria-hidden="true" className="h-3.5 w-3.5" />
                    <span>Tersalin</span>
                  </>
                ) : (
                  <>
                    <Copy aria-hidden="true" className="h-3.5 w-3.5" />
                    <span>Salin Sandi</span>
                  </>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => setInfo(null)}
              aria-label="Tutup pemberitahuan"
              className="rounded-lg p-1 text-emerald-800/70 transition-colors hover:bg-emerald-500/15 hover:text-emerald-900 dark:text-emerald-200/70 dark:hover:text-emerald-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {errMsg && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-800 dark:text-rose-200"
        >
          <p className="min-w-0 flex-1 break-words">{errMsg}</p>
          <button
            type="button"
            onClick={() => setErrMsg('')}
            aria-label="Tutup pesan kesalahan"
            className="shrink-0 rounded-lg p-1 text-rose-800/70 transition-colors hover:bg-rose-500/15 dark:text-rose-200/70"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* FORM BUAT AKUN */}
      {tab === 'akun' && (
        <form onSubmit={buat} noValidate aria-labelledby="admin-create-heading" className="card space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border-subtle)] pb-3">
            <div>
              <h2 id="admin-create-heading" className="text-sm font-semibold text-[var(--text-primary)]">
                Buat Akun Pengguna Baru
              </h2>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                Kata sandi awal dibuat otomatis dan wajib diganti saat login pertama.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label
                htmlFor="admin-create-username"
                className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]"
              >
                Username <span aria-hidden="true" className="text-rose-500">*</span>
              </label>
              <input
                ref={usernameRef}
                id="admin-create-username"
                name="username"
                className="input"
                placeholder="Masukkan username"
                minLength={3}
                maxLength={30}
                pattern="[a-zA-Z0-9._]{3,30}"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                title="3–30 karakter: huruf, angka, titik (.), atau garis bawah (_), tanpa titik di awal/akhir atau berurutan"
                aria-invalid={Boolean(usernameErr)}
                aria-describedby={usernameErr ? 'admin-create-username-error' : undefined}
                value={f.username}
                onChange={(e) => {
                  const nextVal = e.target.value;
                  setF({ ...f, username: nextVal });
                  const trimmed = nextVal.trim();
                  if (usernameRef.current) {
                    const customErr = trimmed ? validateUsernameFormat(trimmed) : null;
                    usernameRef.current.setCustomValidity(customErr ?? '');
                  }
                  if (usernameErr) {
                    setUsernameErr(trimmed ? validateUsernameFormat(trimmed) ?? '' : '');
                  }
                }}
                disabled={creating}
                required
              />
              {usernameErr && (
                <p
                  id="admin-create-username-error"
                  role="alert"
                  className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400"
                >
                  {usernameErr}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="admin-create-nama"
                className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]"
              >
                Nama <span aria-hidden="true" className="text-rose-500">*</span>
              </label>
              <input
                ref={namaRef}
                id="admin-create-nama"
                name="nama"
                className="input"
                placeholder="Masukkan nama"
                maxLength={120}
                aria-invalid={Boolean(namaErr)}
                aria-describedby={namaErr ? 'admin-create-nama-error' : undefined}
                value={f.nama}
                onChange={(e) => {
                  setF({ ...f, nama: e.target.value });
                  if (namaErr && e.target.value.trim()) setNamaErr('');
                }}
                disabled={creating}
                required
              />
              {namaErr && (
                <p
                  id="admin-create-nama-error"
                  role="alert"
                  className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400"
                >
                  {namaErr}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="admin-create-role"
                className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]"
              >
                Peran
              </label>
              <RoleSelect
                id="admin-create-role"
                name="role"
                value={f.role}
                onChange={(nextRole) => {
                  setF((prev) => ({
                    ...prev,
                    role: nextRole,
                    nip: nextRole === 'admin' ? '' : prev.nip,
                  }));
                }}
                disabled={creating}
              />
            </div>

            <div>
              <label
                htmlFor="admin-create-guru"
                className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]"
              >
                Tautkan Guru / NIP{' '}
                <span className="font-normal text-[var(--text-muted)]">(opsional)</span>
              </label>
              <Combobox
                id="admin-create-guru"
                name="nip"
                options={guruOptions}
                value={f.role === 'admin' ? '' : f.nip}
                onChange={handleSelectGuru}
                disabled={creating || f.role === 'admin' || (guruList.loading && gurus.length === 0)}
                loading={guruList.loading}
                placeholder={
                  f.role === 'admin'
                    ? 'Khusus peran non-Admin'
                    : 'Cari nama guru atau NIP…'
                }
                emptyText="Daftar guru belum tersedia."
                noMatchText="Tidak ada guru yang cocok."
                clearLabel="Lepas tautan guru"
                title={
                  f.role === 'admin'
                    ? 'NIP hanya untuk peran Guru / BK / Kepala Sekolah'
                    : 'Pilih guru dari daftar induk'
                }
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-3">
            <button type="submit" className="btn" disabled={creating}>
              <UserPlus aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span>{creating ? 'Membuat…' : 'Buat Akun'}</span>
            </button>
          </div>
        </form>
      )}

      {/* FILTER AUDIT LOG */}
      {tab === 'audit' && (
        <div className="card flex flex-wrap items-end gap-3">
          <div>
            <label
              htmlFor="audit-filter-user"
              className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
            >
              Username
            </label>
            <input
              id="audit-filter-user"
              name="audit_user"
              className="input w-44"
              placeholder="Username persis"
              value={auditUser}
              onChange={(e) => setAuditUser(e.target.value)}
            />
          </div>
          <div>
            <label
              htmlFor="audit-filter-dari"
              className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
            >
              Dari tanggal
            </label>
            <input
              id="audit-filter-dari"
              name="audit_dari"
              type="date"
              className="input w-40"
              value={auditDari}
              max={auditSampai || undefined}
              onChange={(e) => {
                setAuditDari(e.target.value);
                setAuditPage(1);
              }}
            />
          </div>
          <div>
            <label
              htmlFor="audit-filter-sampai"
              className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
            >
              Sampai tanggal
            </label>
            <input
              id="audit-filter-sampai"
              name="audit_sampai"
              type="date"
              className="input w-40"
              value={auditSampai}
              min={auditDari || undefined}
              onChange={(e) => {
                setAuditSampai(e.target.value);
                setAuditPage(1);
              }}
            />
          </div>
          {(auditUser || auditDari || auditSampai) && (
            <button
              type="button"
              className="btn-ghost inline-flex items-center gap-1.5 text-xs"
              onClick={() => {
                setAuditUser('');
                setDebouncedAuditUser('');
                setAuditDari('');
                setAuditSampai('');
                setAuditPage(1);
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reset filter</span>
            </button>
          )}
        </div>
      )}

      <Status loading={cur.loading} error={cur.error} />

      {/* DAFTAR AKUN PENGGUNA */}
      {tab === 'akun' && !users.loading && !users.error && users.data != null && (
        allUsers.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)]">Belum ada akun terdaftar.</p>
        ) : (
          <div className="space-y-3">
            {/* Toolbar Pencarian & Filter Peran */}
            <div className="card space-y-3 p-3.5">
              <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative min-w-0 flex-1 sm:max-w-sm">
                  <label htmlFor="admin-user-search" className="sr-only">
                    Cari akun pengguna berdasarkan nama, username, atau NIP
                  </label>
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
                  />
                  <input
                    id="admin-user-search"
                    name="user_search"
                    type="search"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Cari nama, @username, atau NIP…"
                    className={`input pl-9 [&::-webkit-search-cancel-button]:appearance-none ${userSearch ? 'pr-9' : ''}`}
                  />
                  {userSearch && (
                    <button
                      type="button"
                      onClick={() => setUserSearch('')}
                      aria-label="Hapus pencarian akun"
                      className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs tabular-nums text-[var(--text-secondary)]">
                    Menampilkan <strong className="text-[var(--text-primary)]">{filteredUsers.length}</strong> dari{' '}
                    <strong className="text-[var(--text-primary)]">{allUsers.length}</strong> akun
                  </span>
                  {hasUserFilters && (
                    <button
                      type="button"
                      onClick={() => {
                        setUserSearch('');
                        setRoleFilter('all');
                      }}
                      className="btn-ghost inline-flex items-center gap-1 px-2.5 py-1 text-xs"
                    >
                      <RotateCcw className="h-3 w-3" />
                      <span>Reset</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter berdasarkan peran">
                <button
                  type="button"
                  aria-pressed={roleFilter === 'all'}
                  onClick={() => setRoleFilter('all')}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    roleFilter === 'all'
                      ? 'border-[var(--accent-ink)] bg-[var(--accent-ink)] text-[var(--accent-ink-fg)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <span>Semua</span>
                  <span className="tabular-nums opacity-80">{allUsers.length}</span>
                </button>

                {ROLE_OPTIONS.map((opt) => {
                  const active = roleFilter === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setRoleFilter((prev) => (prev === opt.value ? 'all' : opt.value))}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        active
                          ? opt.pillActiveClass
                          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${opt.dotClass}`} />
                      <span>{opt.label}</span>
                      <span className="tabular-nums opacity-75">{roleCounts[opt.value]}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {filteredUsers.length === 0 ? (
              <div className="card space-y-2 py-10 text-center">
                <p className="text-sm text-[var(--text-secondary)]">
                  Tidak ada akun yang cocok dengan filter pencarian saat ini.
                </p>
                {hasUserFilters && (
                  <button
                    type="button"
                    onClick={() => {
                      setUserSearch('');
                      setRoleFilter('all');
                    }}
                    className="btn-ghost text-xs"
                  >
                    Tampilkan semua akun
                  </button>
                )}
              </div>
            ) : (
              <div
                role="region"
                tabIndex={0}
                aria-label="Tabel daftar akun pengguna"
                className="overflow-x-auto overscroll-x-contain rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ink)]/30"
              >
                <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-[var(--bg-elevated)] text-xs font-semibold tracking-tight text-[var(--text-secondary)]">
                    <tr>
                      <th
                        scope="col"
                        className="whitespace-nowrap border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]"
                      >
                        Pengguna
                      </th>
                      <th
                        scope="col"
                        className="whitespace-nowrap border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]"
                      >
                        Peran
                      </th>
                      <th
                        scope="col"
                        className="whitespace-nowrap border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]"
                      >
                        NIP
                      </th>
                      <th
                        scope="col"
                        className="whitespace-nowrap border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)]"
                      >
                        Status
                      </th>
                      <th
                        scope="col"
                        className="whitespace-nowrap border-b border-[var(--border-subtle)] px-[var(--table-cell-px)] py-[var(--table-head-py)] text-right"
                      >
                        Aksi
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((u, idx) => {
                      const uid = Number(u.id);
                      const uname = String(u.username);
                      const nama = String(u.nama);
                      const userRole = String(u.role) as Role;
                      const roleMeta = ROLE_META[userRole];
                      const fotoProfil = typeof u.foto_profil === 'string' ? u.foto_profil : null;
                      const isSelf = uid === me?.id;
                      const isBusy = actingId === uid;
                      const aktif = Boolean(u.aktif);
                      const wajib = Boolean(u.wajib_ganti_password);
                      const topBorder = idx > 0 ? 'border-t border-[var(--border-subtle)]' : '';

                      return (
                        <tr key={String(u.id)} className="transition-colors hover:bg-[var(--bg-elevated)]/55">
                          <td className={`${topBorder} px-[var(--table-cell-px)] py-2.5`}>
                            <div className="flex min-w-[200px] items-center gap-3">
                              <UserAvatar nama={nama} username={uname} fotoProfil={fotoProfil} size="sm" />
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="truncate font-semibold text-[var(--text-primary)]">
                                    {nama}
                                  </span>
                                  {isSelf && (
                                    <span className="inline-flex shrink-0 items-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-primary)]">
                                      Anda
                                    </span>
                                  )}
                                </div>
                                <p className="truncate font-mono text-xs text-[var(--text-secondary)]">
                                  @{uname}
                                </p>
                              </div>
                            </div>
                          </td>

                          <td className={`${topBorder} whitespace-nowrap px-[var(--table-cell-px)] py-2.5`}>
                            {isSelf ? (
                              <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)]">
                                {roleMeta && (
                                  <span
                                    aria-hidden="true"
                                    className={`h-2 w-2 shrink-0 rounded-full ${roleMeta.dotClass}`}
                                  />
                                )}
                                <span>{roleLabel(userRole)}</span>
                              </span>
                            ) : (
                              <RoleSelect
                                size="sm"
                                value={userRole}
                                disabled={actingId !== null}
                                ariaLabel={`Ubah peran ${uname}`}
                                onChange={(nextRole) => {
                                  if (nextRole !== u.role) requestUbah(u, { role: nextRole });
                                }}
                              />
                            )}
                          </td>

                          <td
                            className={`${topBorder} whitespace-nowrap px-[var(--table-cell-px)] py-2.5 font-mono text-xs tabular-nums text-[var(--text-secondary)]`}
                          >
                            {u.nip ? String(u.nip) : '—'}
                          </td>

                          <td className={`${topBorder} whitespace-nowrap px-[var(--table-cell-px)] py-2.5`}>
                            <div className="flex flex-col items-start gap-1">
                              <span
                                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                                  aktif
                                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                    : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
                                }`}
                              >
                                <span
                                  aria-hidden="true"
                                  className={`h-1.5 w-1.5 rounded-full ${
                                    aktif ? 'bg-emerald-500' : 'bg-[var(--text-muted)]'
                                  }`}
                                />
                                <span>{aktif ? 'Aktif' : 'Nonaktif'}</span>
                              </span>
                              {wajib && (
                                <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium text-amber-700 dark:text-amber-300">
                                  <KeyRound aria-hidden="true" className="h-3 w-3 shrink-0" />
                                  <span>Sandi sementara</span>
                                </span>
                              )}
                            </div>
                          </td>

                          <td className={`${topBorder} whitespace-nowrap px-[var(--table-cell-px)] py-2.5 text-right`}>
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                className={`btn-ghost inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1 text-xs ${
                                  !isSelf && aktif
                                    ? 'hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-700 dark:hover:text-rose-300'
                                    : !isSelf && !aktif
                                    ? 'hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-300'
                                    : ''
                                }`}
                                disabled={isSelf || actingId !== null}
                                title={isSelf ? 'Tidak dapat menonaktifkan akun Anda sendiri' : undefined}
                                onClick={() => requestUbah(u, { aktif: !aktif })}
                              >
                                {aktif ? (
                                  <UserX aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                                ) : (
                                  <UserCheck aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                                )}
                                <span>
                                  {isBusy ? 'Memproses…' : aktif ? 'Nonaktifkan' : 'Aktifkan'}
                                  <span className="sr-only"> akun {uname}</span>
                                </span>
                              </button>

                              <button
                                type="button"
                                className="btn-ghost inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1 text-xs"
                                disabled={isSelf || actingId !== null}
                                title={isSelf ? 'Gunakan Pengaturan Akun untuk ubah sandi sendiri' : undefined}
                                onClick={() => requestUbah(u, { reset_password: true })}
                              >
                                <KeyRound aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                                <span>
                                  Reset Sandi<span className="sr-only"> akun {uname}</span>
                                </span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      )}

      {tab !== 'akun' && !cur.loading && !cur.error && cur.data != null && (
        <DataTable
          rows={cur.data.data}
          ariaLabel={tab === 'audit' ? 'Tabel log audit sistem' : 'Tabel riwayat impor dataset'}
        />
      )}

      {tab === 'audit' && !audit.loading && !audit.error && audit.data != null && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-secondary)]">
          <button
            type="button"
            className="btn-ghost"
            disabled={audit.loading || auditPage <= 1}
            onClick={() => setAuditPage(auditPage - 1)}
          >
            Sebelumnya
          </button>
          <span className="tabular-nums">
            Halaman <strong className="text-[var(--text-primary)]">{auditPage}</strong> dari {auditPages} ({auditTotal}{' '}
            log)
          </span>
          <button
            type="button"
            className="btn-ghost"
            disabled={audit.loading || auditPage >= auditPages}
            onClick={() => setAuditPage(auditPage + 1)}
          >
            Berikutnya
          </button>
        </div>
      )}

      </div>

      <ConfirmDialog
        open={pendingAction !== null}
        title={pendingAction?.title ?? ''}
        description={pendingAction?.description}
        confirmLabel={pendingAction?.confirmLabel ?? 'Konfirmasi'}
        destructive={pendingAction?.destructive ?? false}
        busy={actingId !== null}
        onConfirm={confirmUbah}
        onCancel={() => {
          if (actingId === null) setPendingAction(null);
        }}
      />
    </div>
  );
}

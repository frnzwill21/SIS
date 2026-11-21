'use client';
import { FormEvent, useEffect, useState } from 'react';
import { KeyRound, ShieldAlert } from 'lucide-react';
import { api, session, User } from '@/lib/api';

export default function Akun() {
  const [user, setUser] = useState<User | null>(null);
  const [lama, setLama] = useState('');
  const [baru, setBaru] = useState('');
  const [konfirmasi, setKonfirmasi] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const cached = session.user();
    if (cached) setUser(cached);
    const token = session.token();
    if (!token) return;
    api<User>('/auth/me')
      .then((fresh) => {
        if (!alive) return;
        session.save(token, fresh);
        setUser(fresh);
      })
      .catch(() => { /* ditangani oleh interceptor api() */ });
    return () => {
      alive = false;
    };
  }, []);

  const wajib = Boolean(user?.wajib_ganti_password);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    setErr('');
    if (baru.length < 1) {
      setErr('Kata sandi baru minimal 1 karakter.');
      return;
    }
    if (baru !== konfirmasi) {
      setErr('Konfirmasi kata sandi baru tidak cocok.');
      return;
    }
    setBusy(true);
    let redirecting = false;
    try {
      const res = await api<{ ok?: boolean; access_token?: string; user?: User }>('/auth/ganti-password', {
        method: 'POST',
        body: { password_lama: lama, password_baru: baru },
      });
      const u = res?.user || user || session.user();
      const t = res?.access_token || session.token();
      if (u && t) {
        const updated = { ...u, wajib_ganti_password: false };
        session.save(t, updated);
        setUser(updated);
      }
      setMsg('Kata sandi berhasil diganti.');
      setLama('');
      setBaru('');
      setKonfirmasi('');
      if (wajib) {
        redirecting = true;
        window.location.href = '/chat';
      }
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      if (!redirecting) setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <div className="card space-y-5 p-6 shadow-sm">
        {/* User Identity */}
        {user && (
          <div className="flex items-center gap-3.5 border-b border-slate-100 pb-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">
              {(user.nama || user.username || '?').slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold text-slate-900">{user.nama}</p>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${
                    user.role === 'admin'
                      ? 'bg-blue-50 text-blue-700 border border-blue-200/70'
                      : 'bg-slate-100 text-slate-700 border border-slate-200/70'
                  }`}
                >
                  {user.role === 'admin' ? 'Admin' : 'Guru'}
                </span>
              </div>
              <p className="truncate text-xs text-slate-500">
                @{user.username}
                {user.nip ? ` · NIP ${user.nip}` : ''}
              </p>
            </div>
          </div>
        )}

        {/* Password Form */}
        <form onSubmit={submit} className="space-y-4">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-blue-600" />
            <h1 className="text-base font-semibold text-slate-900">Ganti Kata Sandi</h1>
          </div>

          {wajib && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p>Kata sandi sementara wajib diganti terlebih dahulu sebelum mengakses menu lain.</p>
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="password-lama" className="block text-xs font-medium text-slate-700">
              Kata sandi saat ini
            </label>
            <input
              id="password-lama"
              className="input"
              type="password"
              autoComplete="current-password"
              placeholder="Masukkan kata sandi saat ini"
              value={lama}
              onChange={(e) => setLama(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password-baru" className="block text-xs font-medium text-slate-700">
              Kata sandi baru
            </label>
            <input
              id="password-baru"
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder="Kata sandi baru (min. 1 karakter)"
              minLength={1}
              value={baru}
              onChange={(e) => setBaru(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password-konfirmasi" className="block text-xs font-medium text-slate-700">
              Konfirmasi kata sandi baru
            </label>
            <input
              id="password-konfirmasi"
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder="Ulangi kata sandi baru"
              minLength={1}
              value={konfirmasi}
              onChange={(e) => setKonfirmasi(e.target.value)}
              required
            />
          </div>

          <p className="text-xs text-slate-500">Minimal 1 karakter dan tidak boleh memuat username Anda.</p>

          {msg && (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-sm text-emerald-700">{msg}</p>
          )}
          {err && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-sm text-rose-700">{err}</p>
          )}

          <button type="submit" className="btn w-full" disabled={busy}>
            {busy ? 'Menyimpan…' : 'Simpan Kata Sandi'}
          </button>
        </form>
      </div>
    </div>
  );
}

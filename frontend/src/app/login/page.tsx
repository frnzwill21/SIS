'use client';
import { FormEvent, useEffect, useState } from 'react';
import { Eye, EyeOff, Lock, User as UserIcon } from 'lucide-react';
import { api, session, User } from '@/lib/api';
import { preferences } from '@/lib/preferences';
import SisBrandMark from '@/components/SisBrandMark';

export default function Login() {
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    preferences.applyToDom(preferences.get());
    const unsub = preferences.subscribe(() => {});
    const token = session.token();
    const u = session.user();
    if (token && u) {
      window.location.replace(u.wajib_ganti_password ? '/akun' : '/chat');
    }
    return unsub;
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api<{ access_token: string; user: User }>('/auth/login', {
        method: 'POST',
        body: { username, password },
      });
      try {
        sessionStorage.removeItem('sis_chat_history');
        if (!r.user.wajib_ganti_password) {
          sessionStorage.setItem('sis_just_logged_in', '1');
        }
      } catch {
        /* abaikan */
      }
      session.save(r.access_token, r.user);
      window.location.href = r.user.wajib_ganti_password ? '/akun' : '/chat';
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg-canvas)] px-4 py-8 text-[var(--text-primary)]">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center text-center">
          <SisBrandMark size="lg" />
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-[var(--text-primary)]">
            School Intelligence System
          </h1>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6 shadow-sm">
          <div className="space-y-1.5">
            <label
              htmlFor="username"
              className="block text-xs font-medium text-[var(--text-secondary)]"
            >
              Username
            </label>
            <div className="relative">
              <UserIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                id="username"
                name="username"
                type="text"
                className="input pl-9"
                placeholder="Masukkan username"
                autoComplete="username"
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                enterKeyHint="next"
                value={username}
                onChange={(e) => setU(e.target.value)}
                autoFocus
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="password"
              className="block text-xs font-medium text-[var(--text-secondary)]"
            >
              Kata sandi
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                className="input pl-9 pr-10"
                placeholder="Masukkan kata sandi"
                autoComplete="current-password"
                enterKeyHint="done"
                value={password}
                onChange={(e) => setP(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                aria-pressed={showPassword}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 text-sm text-rose-700 dark:text-rose-300"
            >
              {error}
            </p>
          )}

          <button type="submit" className="btn w-full py-2.5" disabled={busy}>
            {busy ? 'Masuk…' : 'Masuk'}
          </button>
        </form>
      </div>
    </main>
  );
}

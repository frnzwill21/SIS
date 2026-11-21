'use client';
import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { API, api, session, User } from '@/lib/api';

export default function Login() {
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [oraclePublic, setOraclePublic] = useState(false);

  useEffect(() => {
    const token = session.token();
    const u = session.user();
    if (token && u) {
      window.location.replace(u.wajib_ganti_password ? '/akun' : '/chat');
      return;
    }
    fetch(`${API}/health`)
      .then((r) => r.json())
      .then((h) => setOraclePublic(Boolean(h?.oracle_public)))
      .catch(() => setOraclePublic(false));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const r = await api<{ access_token: string; user: User }>('/auth/login', { method: 'POST', body: { username, password } });
      try { sessionStorage.removeItem('sis_chat_history'); } catch { /* abaikan */ }
      session.save(r.access_token, r.user);
      window.location.href = r.user.wajib_ganti_password ? '/akun' : '/chat';
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-3">
        <form onSubmit={submit} className="card w-full space-y-4">
          <div>
            <h1 className="text-xl font-semibold text-brand-900">School Intelligence System</h1>
            <p className="text-sm text-slate-500">SMKN 4 Bandung · Kelas XII</p>
          </div>
          <input className="input" placeholder="Username" value={username} onChange={(e) => setU(e.target.value)} autoFocus required />
          <input className="input" type="password" placeholder="Kata sandi" value={password} onChange={(e) => setP(e.target.value)} required />
          {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
          <button className="btn w-full" disabled={busy}>{busy ? 'Masuk…' : 'Masuk'}</button>
        </form>

        {oraclePublic && (
          <div className="card space-y-2.5 bg-white/90">
            <p className="text-xs text-slate-500">
              Akses cepat kedisiplinan &amp; rekap:
            </p>
            <Link
              href="/kedisiplinan"
              className="btn-ghost flex w-full items-center justify-center gap-2 border-blue-200 text-blue-700 hover:bg-blue-50 hover:border-blue-300 font-medium"
            >
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span>Buka Kedisiplinan &amp; Rekap Akademik</span>
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}

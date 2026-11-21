'use client';
import { FormEvent, useEffect, useState } from 'react';
import { api, Row, session, User } from '@/lib/api';
import DataTable from '@/components/DataTable';
import { useLoad, Status } from '@/components/useLoad';

type Tab = 'akun' | 'audit' | 'impor';

export default function Admin() {
  const [me, setMe] = useState<User | null>(null);
  const [checkedAuth, setCheckedAuth] = useState(false);

  const [tab, setTab] = useState<Tab>('akun');
  const [tick, setTick] = useState(0);
  const [info, setInfo] = useState('');
  const [errMsg, setErrMsg] = useState('');
  const [creating, setCreating] = useState(false);
  const [actingId, setActingId] = useState<number | null>(null);
  const [f, setF] = useState({ username: '', nama: '', role: 'teacher', nip: '' });

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

  if (!isAdmin) return null;

  const auditTotal = audit.data?.meta.total ?? 0;
  const auditPages = Math.max(1, Math.ceil(auditTotal / 50));

  async function buat(e: FormEvent) {
    e.preventDefault();
    if (creating) return;
    setErrMsg('');
    setCreating(true);
    try {
      const payload = {
        username: f.username.trim(),
        nama: f.nama.trim(),
        role: f.role,
        nip: f.role === 'admin' ? null : f.nip.trim() || null,
      };
      const r = await api('/users', { method: 'POST', body: payload });
      setInfo(`Akun ${r.username} dibuat. Kata sandi awal (catat sekarang, tidak ditampilkan lagi): ${r.password_awal}`);
      setF({ username: '', nama: '', role: 'teacher', nip: '' });
      setTick((prev) => prev + 1);
    } catch (err) {
      setErrMsg((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function ubah(u: Row, body: { aktif?: boolean; reset_password?: boolean }) {
    const uid = Number(u.id);
    if (actingId !== null || uid === me?.id) return;
    const uname = String(u.username);
    const promptText = body.reset_password
      ? `Reset kata sandi untuk akun "${uname}"? Sesi login aktif akun ini akan segera dicabut.`
      : body.aktif === false
      ? `Nonaktifkan akun "${uname}"? Akun ini tidak akan bisa login.`
      : `Aktifkan kembali akun "${uname}"?`;
    if (typeof window !== 'undefined' && !window.confirm(promptText)) return;

    setErrMsg('');
    setActingId(uid);
    try {
      const r = await api(`/users/${uid}`, { method: 'PATCH', body });
      setInfo(
        r.password_baru
          ? `Kata sandi baru untuk ${uname} (catat sekarang): ${r.password_baru}`
          : `Status akun ${uname} berhasil diperbarui.`
      );
      setTick((prev) => prev + 1);
    } catch (err) {
      setErrMsg((err as Error).message);
    } finally {
      setActingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(['akun', 'audit', 'impor'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={tab === t ? 'btn' : 'btn-ghost'}
            onClick={() => {
              setTab(t);
              setInfo('');
              setErrMsg('');
            }}
          >
            {t === 'akun' ? 'Akun' : t === 'audit' ? 'Audit log' : 'Riwayat impor'}
          </button>
        ))}
      </div>
      {info && <p className="rounded border border-emerald-200 bg-emerald-50 p-2.5 text-sm text-emerald-900 break-all">{info}</p>}
      {errMsg && <p className="rounded border border-rose-200 bg-rose-50 p-2.5 text-sm text-rose-800 break-all">{errMsg}</p>}

      {tab === 'akun' && (
        <form onSubmit={buat} className="card grid gap-2 sm:grid-cols-5">
          <input
            className="input"
            placeholder="Username (3–50 kar.)"
            minLength={3}
            maxLength={50}
            pattern="[a-zA-Z0-9._-]+"
            title="Hanya huruf, angka, titik, garis bawah, atau tanda hubung (3–50 karakter)"
            value={f.username}
            onChange={(e) => setF({ ...f, username: e.target.value })}
            disabled={creating}
            required
          />
          <input
            className="input"
            placeholder="Nama lengkap"
            maxLength={120}
            value={f.nama}
            onChange={(e) => setF({ ...f, nama: e.target.value })}
            disabled={creating}
            required
          />
          <select
            className="input"
            value={f.role}
            onChange={(e) => {
              const nextRole = e.target.value;
              setF((prev) => ({
                ...prev,
                role: nextRole,
                nip: nextRole === 'admin' ? '' : prev.nip,
              }));
            }}
            disabled={creating}
          >
            <option value="teacher">Guru</option>
            <option value="admin">Admin</option>
          </select>
          <select
            className="input disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            value={f.role === 'admin' ? '' : f.nip}
            onChange={(e) => {
              const nextNip = e.target.value;
              const prevGuru = gurus.find((g) => String(g.nip) === f.nip);
              const nextGuru = gurus.find((g) => String(g.nip) === nextNip);
              const nextGuruNama = nextGuru ? String(nextGuru.nama) : '';
              const prevGuruNama = prevGuru ? String(prevGuru.nama) : '';
              setF((prev) => {
                const shouldSyncName = !prev.nama.trim() || (prevGuruNama !== '' && prev.nama === prevGuruNama);
                return {
                  ...prev,
                  nip: nextNip,
                  nama: shouldSyncName ? nextGuruNama : prev.nama,
                };
              });
            }}
            disabled={creating || f.role === 'admin' || (guruList.loading && gurus.length === 0)}
            title={f.role === 'admin' ? 'NIP hanya untuk peran Guru' : 'Pilih guru dari daftar induk'}
          >
            <option value="">
              {f.role === 'admin'
                ? 'Khusus peran Guru'
                : guruList.loading && gurus.length === 0
                ? 'Memuat daftar guru…'
                : '— Pilih Guru / NIP (opsional) —'}
            </option>
            {gurus.map((g) => {
              const nip = String(g.nip);
              const nama = String(g.nama);
              return (
                <option key={nip} value={nip}>
                  {nama} ({nip})
                </option>
              );
            })}
          </select>
          <button type="submit" className="btn" disabled={creating}>
            {creating ? 'Membuat…' : 'Buat akun'}
          </button>
        </form>
      )}

      {tab === 'audit' && (
        <div className="card flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Username</label>
            <input
              className="input w-44"
              placeholder="Username persis"
              value={auditUser}
              onChange={(e) => setAuditUser(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Dari tanggal</label>
            <input
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
            <label className="block text-xs text-slate-500 mb-1">Sampai tanggal</label>
            <input
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
              className="btn-ghost"
              onClick={() => {
                setAuditUser('');
                setDebouncedAuditUser('');
                setAuditDari('');
                setAuditSampai('');
                setAuditPage(1);
              }}
            >
              Reset filter
            </button>
          )}
        </div>
      )}

      <Status loading={cur.loading} error={cur.error} />
      {tab === 'akun' && !users.loading && !users.error && users.data != null && (
        users.data.data.length === 0 ? (
          <p className="text-sm text-slate-500">Belum ada akun terdaftar.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-xs uppercase text-slate-600">
                <tr>
                  <th className="px-3 py-2">Username</th>
                  <th className="px-3 py-2">Nama</th>
                  <th className="px-3 py-2">Peran</th>
                  <th className="px-3 py-2">NIP</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {users.data.data.map((u) => {
                  const uid = Number(u.id);
                  const isSelf = uid === me?.id;
                  const isBusy = actingId === uid;
                  const aktif = Boolean(u.aktif);
                  const wajib = Boolean(u.wajib_ganti_password);
                  return (
                    <tr key={String(u.id)} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-800">
                        {String(u.username)}
                        {isSelf && (
                          <span className="ml-1.5 rounded bg-blue-50 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-blue-700">
                            Anda
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-900">
                        {String(u.nama)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                        {u.role === 'admin' ? 'Admin' : 'Guru'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-600">
                        {u.nip ? String(u.nip) : '-'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${
                              aktif
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-slate-200 bg-slate-100 text-slate-600'
                            }`}
                          >
                            {aktif ? 'Aktif' : 'Nonaktif'}
                          </span>
                          {wajib && (
                            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                              Sandi Sementara
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            className="btn-ghost text-xs"
                            disabled={isSelf || actingId !== null}
                            title={isSelf ? 'Tidak dapat menonaktifkan akun Anda sendiri' : undefined}
                            onClick={() => ubah(u, { aktif: !aktif })}
                          >
                            {isBusy ? 'Memproses…' : aktif ? 'Nonaktifkan' : 'Aktifkan'}
                          </button>
                          <button
                            type="button"
                            className="btn-ghost text-xs"
                            disabled={isSelf || actingId !== null}
                            title={isSelf ? 'Gunakan Pengaturan Akun untuk ubah sandi sendiri' : undefined}
                            onClick={() => ubah(u, { reset_password: true })}
                          >
                            Reset Kata Sandi
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
      {tab !== 'akun' && !cur.loading && !cur.error && cur.data != null && <DataTable rows={cur.data.data} />}

      {tab === 'audit' && !audit.loading && !audit.error && audit.data != null && (
        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            className="btn-ghost"
            disabled={audit.loading || auditPage <= 1}
            onClick={() => setAuditPage(auditPage - 1)}
          >
            Sebelumnya
          </button>
          <span>
            Halaman {auditPage} dari {auditPages} ({auditTotal} log)
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
  );
}

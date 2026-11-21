export const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

export type User = { id: number; username: string; nama: string; nip: string | null; role: 'admin' | 'teacher'; wajib_ganti_password: boolean };
export type Row = Record<string, string | number | boolean | null>;

const KEY = 'sis_token';
const USER = 'sis_user';

export const session = {
  token: (): string | null => { try { return localStorage.getItem(KEY); } catch { return null; } },
  user: (): User | null => { try { const s = localStorage.getItem(USER); return s ? (JSON.parse(s) as User) : null; } catch { return null; } },
  save: (token: string, user: User) => {
    try {
      const prev = session.user();
      if (prev && prev.id !== user.id) {
        sessionStorage.removeItem('sis_chat_history');
      }
      localStorage.setItem(KEY, token);
      localStorage.setItem(USER, JSON.stringify(user));
    } catch { /* abaikan */ }
  },
  clear: () => {
    try {
      localStorage.removeItem(KEY);
      localStorage.removeItem(USER);
      sessionStorage.removeItem('sis_chat_history');
    } catch { /* abaikan */ }
  },
};

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = session.token();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 30000); // jangan menggantung bila Gemini/DB lambat
  try {
    res = await fetch(`${API}${path}`, { method: init.method || 'GET', headers, signal: ctrl.signal, body: init.body ? JSON.stringify(init.body) : undefined });
  } catch (e) {
    throw new ApiError(0, (e as Error).name === 'AbortError' ? 'Server terlalu lama menjawab. Coba lagi.' : 'Tidak bisa menghubungi server. Pastikan backend berjalan.');
  } finally {
    clearTimeout(timer);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 403 && json?.error?.code === 'PASSWORD_CHANGE_REQUIRED' && typeof window !== 'undefined') {
      const u = session.user();
      const t = session.token();
      if (u && t) session.save(t, { ...u, wajib_ganti_password: true });
      if (window.location.pathname !== '/akun') window.location.href = '/akun';
    }
    if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/login')) {
      session.clear();
      window.location.href = '/login';
    }
    const baseMsg = json?.error?.message || `Kesalahan ${res.status}`;
    const firstDetail =
      res.status === 422 && Array.isArray(json?.error?.details) && json.error.details[0]?.msg
        ? String(json.error.details[0].msg)
        : '';
    throw new ApiError(res.status, firstDetail ? `${baseMsg} (${firstDetail})` : baseMsg);
  }
  return json as T;
}

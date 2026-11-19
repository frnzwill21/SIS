'use client';
import { FormEvent, useRef, useState, useEffect } from 'react';
import { api, Row } from '@/lib/api';
import DataTable from '@/components/DataTable';
import {
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Send,
  Paperclip,
  Calendar,
  GraduationCap,
  Users,
  Building,
  AlertTriangle,
  Bot,
  User as UserIcon,
  HelpCircle,
  FileText
} from 'lucide-react';

type TabelEngine = { kolom: string[]; baris: unknown[][] };

type Msg = {
  role: 'user' | 'ai';
  text: string;
  tabel?: Row[] | TabelEngine | null;
  sumber?: string[];
  sensitif?: boolean;
  mode?: string;
  butuh_klarifikasi?: boolean;
  contoh?: string[];
};

const SUGGESTIONS = [
  {
    topic: 'Akademik & Jadwal',
    icon: Calendar,
    color: 'text-indigo-600 bg-indigo-50 border-indigo-100',
    title: 'Jadwal Kelas',
    prompt: 'Jadwal pelajaran XII TITL 6 hari Senin' // satu pertanyaan = satu intent; gabungan dua intent belum didukung engine
  },
  {
    topic: 'Nilai & Kelulusan',
    icon: GraduationCap,
    color: 'text-blue-600 bg-blue-50 border-blue-100',
    title: 'Evaluasi Nilai KKM',
    prompt: 'Siswa XII RPL 1 yang nilainya di bawah KKM pada semester 5'
  },
  {
    topic: 'Kemitraan Industri',
    icon: Building,
    color: 'text-emerald-600 bg-emerald-50 border-emerald-100',
    title: 'Penempatan PKL Siswa',
    prompt: 'Siapa saja siswa yang ditempatkan PKL di PLN dan apa posisinya?'
  }
];

export default function Chat() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false); // `busy` (state) basi di dalam handler event sidebar & klik ganda cepat

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, busy]);

  // Perintah dari sidebar: "Percakapan Baru" dan "Topik Populer"
  useEffect(() => {
    const handle = () => {
      if (sessionStorage.getItem('sis_reset_chat')) {
        sessionStorage.removeItem('sis_reset_chat');
        setMsgs([]);
        setInput('');
      }
      const q = sessionStorage.getItem('sis_pending_q');
      if (q) {
        sessionStorage.removeItem('sis_pending_q');
        kirim(q);
      }
    };
    handle();
    window.addEventListener('sis-chat', handle);
    return () => window.removeEventListener('sis-chat', handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function kirim(pesan: string) {
    if (!pesan.trim() || busyRef.current) return;
    busyRef.current = true;
    const textKirim = pesan.trim();
    setMsgs((m) => [...m, { role: 'user', text: textKirim }]);
    setInput('');
    setBusy(true);

    try {
      const r = await api('/chat', { method: 'POST', body: { pesan: textKirim } });
      setMsgs((m) => [
        ...m,
        {
          role: 'ai',
          text: r.jawaban,
          tabel: r.tabel,
          sumber: r.sumber,
          sensitif: r.sensitif,
          mode: r.mode,
          butuh_klarifikasi: r.butuh_klarifikasi,
          contoh: r.contoh
        }
      ]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'ai', text: (e as Error).message }]);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    kirim(input);
  };

  return (
    <div className="flex h-full flex-col justify-between">
      {/* Scrollable messages / welcome container */}
      <div className="flex-1 overflow-y-auto pb-4">
        {msgs.length === 0 ? (
          /* HERO WELCOME SCREEN (Sesuai Frame 13:2 Figma) */
          <div className="mx-auto flex max-w-3xl flex-col items-center justify-center pt-8 text-center">

            {/* Suggested cards */}
            <div className="mt-8 grid w-full grid-cols-1 gap-3.5 text-left sm:grid-cols-3">
              {SUGGESTIONS.map((s, idx) => {
                const Icon = s.icon;
                return (
                  <button
                    key={idx}
                    onClick={() => kirim(s.prompt)}
                    className="group flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm transition-all hover:border-blue-300 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <div className={`flex h-8 w-8 items-center justify-center rounded-xl border ${s.color}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <ArrowRight className="h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-1 group-hover:text-blue-600" />
                      </div>
                      <h4 className="mt-3 text-xs font-bold text-slate-900">{s.title}</h4>
                      <p className="mt-1 text-xs text-slate-500 line-clamp-2 italic leading-relaxed">
                        &quot;{s.prompt}&quot;
                      </p>
                    </div>
                    <span className="mt-3 text-[10px] font-medium text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity">
                      Klik untuk bertanya &rarr;
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          /* CONVERSATION BUBBLES */
          <div className="mx-auto max-w-3xl space-y-4 py-2">
            {msgs.map((m, i) => (
              <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.role === 'ai' && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-sm shadow-blue-200">
                    <Sparkles className="h-4 w-4" />
                  </div>
                )}

                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'border border-slate-200 bg-white text-slate-800 shadow-sm'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{m.text}</p>

                  {/* Sensitif alert */}
                  {m.sensitif && (
                    <div className="mt-2.5 flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200/80 p-2 text-xs text-amber-800">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                      <span>Data sensitif. Pertanyaan dan akses ini dicatat di Audit Log sistem.</span>
                    </div>
                  )}

                  {/* Tabel Jawaban */}
                  {m.tabel && (Array.isArray(m.tabel) ? m.tabel.length > 0 : (m.tabel.baris?.length ?? 0) > 0) && (
                    <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-inner">
                      <DataTable rows={m.tabel} />
                    </div>
                  )}

                  {/* Contoh pertanyaan saat engine meminta klarifikasi / pertanyaan tidak dikenali */}
                  {m.contoh && m.contoh.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {m.contoh.map((c, k) => (
                        <button key={k} onClick={() => kirim(c)} className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] text-blue-700 hover:bg-blue-100">
                          {c}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Sumber data & Mode */}
                  {m.sumber && m.sumber.length > 0 && (
                    <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                      <span>Sumber: {m.sumber.join(', ')}</span>
                      {m.mode && <span className="text-slate-300">• mode {m.mode}</span>}
                    </div>
                  )}
                </div>

                {m.role === 'user' && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-200 text-slate-700">
                    <UserIcon className="h-4 w-4" />
                  </div>
                )}
              </div>
            ))}

            {busy && (
              <div className="flex gap-3 items-center text-sm text-slate-500">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-600 animate-pulse">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-blue-600 animate-ping"></span>
                  <span className="text-xs text-slate-500">Memproses pertanyaan dengan Hybrid Engine…</span>
                </div>
              </div>
            )}
            <div ref={end} />
          </div>
        )}
      </div>

      {/* FLOATING COMPOSER AREA (Sesuai Frame 13:2) */}
      <div className="mx-auto w-full max-w-3xl pt-2">
        <form
          onSubmit={submit}
          className="relative rounded-2xl border border-slate-200/90 bg-white p-3 shadow-sm focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 transition-all"
        >
          <textarea
            rows={2}
            className="w-full resize-none bg-transparent text-sm text-slate-800 placeholder-slate-400 focus:outline-none"
            placeholder="Tanyakan apa saja seputar data sekolah, siswa, nilai, kehadiran, atau PKL..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                kirim(input);
              }
            }}
          />

          <div className="flex items-center justify-between border-t border-slate-100 pt-2">
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 border border-emerald-200/60">
                <ShieldCheck className="h-3 w-3 text-emerald-600" />
                21 Tabel Terverifikasi
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-400 hidden sm:inline">Tekan Enter untuk kirim</span>
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm shadow-blue-200 transition-all hover:bg-blue-700 disabled:opacity-40 disabled:hover:bg-blue-600 active:scale-95"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </form>

        {/* AI Privacy Disclaimer (Sesuai Figma) */}
        <div className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5 text-slate-400" />
          <span>Privat untuk SMKN 4 Bandung. AI dapat melakukan kesalahan, mohon verifikasi data penting di halaman data.</span>
        </div>
      </div>
    </div>
  );
}

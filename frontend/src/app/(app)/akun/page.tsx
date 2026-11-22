'use client';

import {
  ChangeEvent,
  FormEvent,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Activity,
  AlertCircle,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  CornerDownLeft,
  Eye,
  EyeOff,
  KeyRound,
  LayoutGrid,
  List,
  Loader2,
  Lock,
  LogOut,
  MessageSquare,
  Monitor,
  Moon,
  ShieldAlert,
  ShieldCheck,
  Shuffle,
  Sparkles,
  Sun,
  Trash2,
} from 'lucide-react';
import { API, api, canViewPelanggaran, roleLabel, session, User } from '@/lib/api';
import { preferences, TableDensity, ThemePref, UserPreferences } from '@/lib/preferences';
import ConfirmDialog from '@/components/ConfirmDialog';
import UserAvatar from '@/components/UserAvatar';

type SectionKey = 'profil' | 'keamanan' | 'preferensi' | 'privasi';

type ActivityItem = {
  id: number;
  waktu: string;
  aksi: string;
  pertanyaan?: string | null;
  status: string;
};

type ChatSessionSummary = {
  id: string;
  judul: string;
  pinned: boolean;
};

type HealthPrivacy = {
  ai_engine: string;
  ai_kirim_data?: boolean;
};

const VALID_SECTIONS: readonly SectionKey[] = ['profil', 'keamanan', 'preferensi', 'privasi'];
const MAX_PASSWORD_BYTES = 72;
const MIN_PASSWORD_LEN = 8;
const MAX_AVATAR_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_AVATAR_DATA_URL_LEN = 580_000;
const ALLOWED_AVATAR_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const USERNAME_REGEX = /^(?!\.)(?!.*\.\.)[a-zA-Z0-9._]{3,30}(?<!\.)$/;

const COMMON_WEAK_PASSWORDS = new Set([
  // Global umum & bocor
  'password',
  'password1',
  'password12',
  'password123',
  'password123!',
  'password1234',
  'passw0rd',
  'p@ssword',
  'p@ssw0rd',
  '12345678',
  '123456789',
  '1234567890',
  '01234567',
  '0123456789',
  '87654321',
  '987654321',
  '11111111',
  '00000000',
  '12341234',
  '12344321',
  'abcd1234',
  'abcdefgh',
  'qwerty',
  'qwertyui',
  'qwertyuiop',
  'qwerty12',
  'qwerty123',
  'qwerty123!',
  'qwerty1234',
  'asdfghjk',
  'asdfghjkl',
  'zxcvbnm1',
  '1q2w3e4r',
  '1qaz2wsx',
  'qazwsxedc',
  'zaq12wsx',
  'admin123',
  'admin123!',
  'admin1234',
  'administrator',
  'welcome1',
  'welcome123',
  'letmein1',
  'letmein123',
  'iloveyou',
  'sunshine',
  'princess',
  'football',
  'monkey123',
  'dragon123',
  'master123',
  'changeme',
  'default123',
  'test1234',
  'testing1',
  'guest123',
  'user1234',
  'login123',
  // Umum di Indonesia & lingkungan sekolah / SMKN 4 Bandung
  'indonesia',
  'indonesia1',
  'indonesia123',
  'merdeka1',
  'merdeka123',
  'nusantara',
  'pancasila',
  'garuda123',
  'bandung',
  'bandung1',
  'bandung123',
  'bandungjuara',
  'jawabarat',
  'jabarjuara',
  'jakarta1',
  'jakarta123',
  'surabaya',
  'semarang',
  'yogyakarta',
  'smkn4',
  'smkn4bdg',
  'smkn4bandung',
  'smkn4123',
  'smkn42024',
  'smkn42025',
  'smkn42026',
  'smkn4bdg123',
  'smkn4bandung123',
  'smkhebat',
  'smkbisa1',
  'smkbisa123',
  'sekolah',
  'sekolah1',
  'sekolah123',
  'sekolahku',
  'guru1234',
  'guruku123',
  'siswa123',
  'pelajar123',
  'pendidikan',
  'kurikulum',
  'akademik',
  'rahasia',
  'rahasia1',
  'rahasia123',
  'rahasia1234',
  'rahasiaku',
  'bismillah',
  'bismillah1',
  'bismillah123',
  'alhamdulillah',
  'insyaallah',
  'allah123',
  'astaghfirullah',
  'sayangku',
  'sayang123',
  'cintaku1',
  'cintaku123',
  'persib123',
  'persibbdg',
  'persibbandung',
  'viking123',
  'bobotoh1',
  'bobotoh123',
  'semangat',
  'semangat123',
  'mantap123',
  'sukses123',
  'juara123',
  'terbaik1',
  'sahabat1',
  'keluarga',
  'orangtua',
  'komputer',
  'teknologi',
  'informasi',
  'aplikasi',
]);

const SEQUENTIAL_PATTERNS = [
  'abcdefghijklmnopqrstuvwxyz',
  '01234567890',
  '`1234567890-=',
  'qwertyuiop[]\\',
  "asdfghjkl;'",
  'zxcvbnm,./',
  '!@#$%^&*()_+',
];

const SEQUENTIAL_PATTERNS_BOTH = [
  ...SEQUENTIAL_PATTERNS,
  ...SEQUENTIAL_PATTERNS.map((p) => p.split('').reverse().join('')),
];

const PASSPHRASE_WORDS = [
  'langit',
  'kopi',
  'senja',
  'hujan',
  'ombak',
  'angin',
  'bintang',
  'pelangi',
  'embun',
  'mentari',
  'rembulan',
  'daun',
  'hutan',
  'gunung',
  'lembah',
  'sungai',
  'danau',
  'pantai',
  'karang',
  'perahu',
  'layar',
  'lampu',
  'jendela',
  'beranda',
  'taman',
  'bunga',
  'melati',
  'anggrek',
  'cemara',
  'bambu',
  'kertas',
  'pena',
  'lukisan',
  'musik',
  'irama',
  'nada',
  'gitar',
  'seruling',
  'cahaya',
  'bayangan',
  'langkah',
  'kompas',
  'peta',
  'awan',
  'kabut',
  'pelita',
  'lentera',
  'samudra',
];

const ACADEMIC_TITLES = new Set([
  's.pd',
  's.pd.i',
  'm.pd',
  'm.pd.i',
  's.kom',
  's.st',
  'm.hum',
  'm.kom',
  's.ag',
  's.sn',
  's.or',
  's.kep',
  's.sos',
  's.si',
  'm.si',
  's.t',
  'm.t',
  's.tr.kom',
  's.tr.t',
  's.e',
  's.h',
  'm.m',
  'm.sc',
  'ph.d',
  'drs',
  'dra',
  'prof',
]);

function parseSectionParam(raw: string | null): SectionKey {
  if (raw && (VALID_SECTIONS as readonly string[]).includes(raw)) {
    return raw as SectionKey;
  }
  return 'profil';
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function extractNameTokens(nama?: string | null): string[] {
  if (!nama) return [];
  const tokens: string[] = [];
  for (const raw of nama.split(/[\s,;/()]+/)) {
    const tok = raw.replace(/^[.,;:()[\]{}"'`~!?]+|[.,;:()[\]{}"'`~!?]+$/g, '').toLowerCase();
    if (!tok || ACADEMIC_TITLES.has(tok)) continue;
    if (tok.length >= 4) tokens.push(tok);
    for (const sub of tok.split('-')) {
      if (sub && !ACADEMIC_TITLES.has(sub) && sub.length >= 4 && sub !== tok) {
        tokens.push(sub);
      }
    }
  }
  return tokens;
}

function checkPasswordIdentitySafe(pw: string, username: string, nama?: string | null): boolean {
  if (!pw) return false;
  const lower = pw.toLowerCase();
  const trimmedUser = username.trim().toLowerCase();
  if (trimmedUser.length >= 3 && lower.includes(trimmedUser)) {
    return false;
  }
  for (const token of extractNameTokens(nama)) {
    if (lower.includes(token)) return false;
  }
  return true;
}

function isRepetitiveOrSequential(password: string): boolean {
  const pw = password.toLowerCase();
  const n = pw.length;
  if (n < 8) return false;
  for (const unitLen of [1, 2, 3]) {
    const unit = pw.slice(0, unitLen);
    if (unit.repeat(Math.floor(n / unitLen) + 1).slice(0, n) === pw) {
      return true;
    }
  }
  for (let i = 0; i <= n - 8; i++) {
    const chunk = pw.slice(i, i + 8);
    if (SEQUENTIAL_PATTERNS_BOTH.some((seq) => seq.includes(chunk))) {
      return true;
    }
  }
  return false;
}

function isCommonWeakPassword(pw: string): boolean {
  const lower = pw.toLowerCase();
  return COMMON_WEAK_PASSWORDS.has(lower) || COMMON_WEAK_PASSWORDS.has(lower.trim());
}

function cryptoRandomInt(maxExclusive: number): number {
  const arr = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  while (true) {
    window.crypto.getRandomValues(arr);
    if (arr[0] < limit) return arr[0] % maxExclusive;
  }
}

function generateStrongPassword(username: string, nama?: string | null): string {
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const symbols = '!@#$%&*?';
  const all = lower + upper + digits + symbols;

  for (let attempt = 0; attempt < 10; attempt++) {
    const chars: string[] = [
      lower[cryptoRandomInt(lower.length)],
      lower[cryptoRandomInt(lower.length)],
      upper[cryptoRandomInt(upper.length)],
      upper[cryptoRandomInt(upper.length)],
      digits[cryptoRandomInt(digits.length)],
      digits[cryptoRandomInt(digits.length)],
      symbols[cryptoRandomInt(symbols.length)],
      symbols[cryptoRandomInt(symbols.length)],
    ];
    while (chars.length < 14) {
      chars.push(all[cryptoRandomInt(all.length)]);
    }
    for (let i = chars.length - 1; i > 0; i--) {
      const j = cryptoRandomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    const candidate = chars.join('');
    if (
      !isCommonWeakPassword(candidate) &&
      !isRepetitiveOrSequential(candidate) &&
      checkPasswordIdentitySafe(candidate, username, nama)
    ) {
      return candidate;
    }
  }

  return 'K4rt!ka#Nusa92';
}

function generatePassphrase(username: string, nama?: string | null): string {
  for (let attempt = 0; attempt < 16; attempt++) {
    const picked: string[] = [];
    const used = new Set<number>();
    while (picked.length < 3) {
      const idx = cryptoRandomInt(PASSPHRASE_WORDS.length);
      if (!used.has(idx)) {
        used.add(idx);
        picked.push(PASSPHRASE_WORDS[idx]);
      }
    }
    const twoDigits = String(10 + cryptoRandomInt(90));
    const candidate = `${picked.join('-')}-${twoDigits}`;
    if (
      utf8ByteLength(candidate) <= MAX_PASSWORD_BYTES &&
      !isCommonWeakPassword(candidate) &&
      !isRepetitiveOrSequential(candidate) &&
      checkPasswordIdentitySafe(candidate, username, nama)
    ) {
      return candidate;
    }
  }

  return 'langit-kopi-senja-48';
}

type PasswordStrengthResult = {
  score: 0 | 1 | 2 | 3 | 4;
  label: 'Belum diisi' | 'Lemah' | 'Cukup' | 'Kuat' | 'Sangat Kuat';
  crackTime: string;
  tip: string | null;
  barClass: string;
};

function computePasswordStrength(
  pw: string,
  username: string,
  nama?: string | null
): PasswordStrengthResult {
  if (!pw) {
    return {
      score: 0,
      label: 'Belum diisi',
      crackTime: '',
      tip: null,
      barClass: 'bg-[var(--border-subtle)]',
    };
  }

  if (pw.length < MIN_PASSWORD_LEN) {
    return {
      score: 1,
      label: 'Lemah',
      crackTime: 'Hitungan detik',
      tip: 'Gunakan minimal 8 karakter atau susun frasa sandi 3 kata yang mudah diingat.',
      barClass: 'bg-rose-500',
    };
  }

  if (isCommonWeakPassword(pw)) {
    return {
      score: 1,
      label: 'Lemah',
      crackTime: 'Hitungan detik',
      tip: 'Kata sandi terlalu umum. Gunakan kombinasi kata unik atau generator di atas.',
      barClass: 'bg-rose-500',
    };
  }

  if (isRepetitiveOrSequential(pw)) {
    return {
      score: 1,
      label: 'Lemah',
      crackTime: 'Hitungan detik',
      tip: 'Hindari pengulangan karakter atau urutan tombol seperti 12345678 dan qwerty.',
      barClass: 'bg-rose-500',
    };
  }

  const identitySafe = checkPasswordIdentitySafe(pw, username, nama);

  const hasLower = /[a-z]/.test(pw);
  const hasUpper = /[A-Z]/.test(pw);
  const hasDigit = /[0-9]/.test(pw);
  const hasSpace = /\s/.test(pw);
  const hasSymbol = /[^a-zA-Z0-9\s]/.test(pw);

  const pool = Math.max(
    1,
    (hasLower ? 26 : 0) +
      (hasUpper ? 26 : 0) +
      (hasDigit ? 10 : 0) +
      (hasSpace ? 1 : 0) +
      (hasSymbol ? 32 : 0)
  );
  const bitsPerChar = Math.log2(pool);
  let bits = pw.length * bitsPerChar;

  // Penalti untuk pengulangan karakter beruntun (mis. aaa, 111) & keragaman rendah
  const repeatRuns = pw.match(/(.)\1{2,}/g) || [];
  for (const run of repeatRuns) {
    bits -= (run.length - 1) * bitsPerChar * 0.75;
  }
  const uniqueChars = new Set(pw).size;
  if (uniqueChars < pw.length * 0.5) {
    bits *= 0.78;
  }

  // Penalti untuk fragmen urutan >= 4 karakter (mis. 1234, abcd, qwer)
  const lower = pw.toLowerCase();
  let seqPenalties = 0;
  for (let i = 0; i <= lower.length - 4; ) {
    const chunk = lower.slice(i, i + 4);
    if (SEQUENTIAL_PATTERNS_BOTH.some((seq) => seq.includes(chunk))) {
      seqPenalties += 1;
      i += 4;
    } else {
      i += 1;
    }
  }
  bits -= seqPenalties * 10;

  // Penalti untuk pola tahun 4 digit (1950–2039)
  const yearMatches = pw.match(/(?:19[5-9]\d|20[0-3]\d)/g) || [];
  bits -= yearMatches.length * 10;

  // Bonus untuk frasa sandi multi-kata (3+ kata unik dengan pemisah spasi/tanda hubung)
  const words = pw
    .trim()
    .split(/[\s\-_.]+/)
    .filter((w) => w.length >= 3 && /[a-zA-Z]/.test(w));
  const uniqueWords = new Set(words.map((w) => w.toLowerCase()));
  if (uniqueWords.size >= 3 && pw.length >= 14) {
    const passphraseBits =
      uniqueWords.size * 12 + (hasDigit ? 7 : 0) + (hasSymbol || hasSpace ? 5 : 0);
    bits = Math.max(bits, passphraseBits) + (uniqueWords.size >= 4 ? 8 : 4);
  }

  if (!identitySafe) {
    bits = Math.min(bits, 26);
  }

  if (bits < 36 || !identitySafe) {
    return {
      score: 1,
      label: 'Lemah',
      crackTime: 'Hitungan detik',
      tip: !identitySafe
        ? 'Hapus bagian username atau nama pribadi agar tidak mudah ditebak.'
        : 'Perpanjang hingga 12+ karakter atau gabungkan 3 kata unik agar jauh lebih kuat.',
      barClass: 'bg-rose-500',
    };
  }

  if (bits < 52) {
    return {
      score: 2,
      label: 'Cukup',
      crackTime: 'Beberapa jam',
      tip: 'Tambahkan beberapa karakter, satu kata tambahan, atau variasi angka/simbol.',
      barClass: 'bg-amber-500',
    };
  }

  if (bits < 72) {
    return {
      score: 3,
      label: 'Kuat',
      crackTime: bits >= 62 ? 'Puluhan tahun' : 'Berbulan-bulan',
      tip: 'Sudah baik. Tambahkan 1 kata atau beberapa karakter lagi untuk ketahanan maksimal.',
      barClass: 'bg-sky-500',
    };
  }

  return {
    score: 4,
    label: 'Sangat Kuat',
    crackTime: 'Berabad-abad',
    tip: null,
    barClass: 'bg-emerald-500',
  };
}

async function compressAvatarToDataUrl(file: File): Promise<string> {
  if (file.type && !ALLOWED_AVATAR_TYPES.has(file.type.toLowerCase())) {
    throw new Error('Format foto harus PNG, JPEG, atau WebP.');
  }
  if (file.size <= 0) {
    throw new Error('File gambar kosong atau tidak valid.');
  }
  if (file.size > MAX_AVATAR_UPLOAD_BYTES) {
    throw new Error('Ukuran file terlalu besar (maksimal 10 MB sebelum kompresi).');
  }

  let bitmap: ImageBitmap | null = null;
  let objectUrl: string | null = null;

  try {
    let source: CanvasImageSource | null = null;
    let srcW = 0;
    let srcH = 0;

    if (typeof createImageBitmap === 'function') {
      try {
        bitmap = await createImageBitmap(file);
        source = bitmap;
        srcW = bitmap.width;
        srcH = bitmap.height;
      } catch {
        bitmap = null;
      }
    }

    if (!source) {
      objectUrl = URL.createObjectURL(file);
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () =>
          reject(new Error('Gagal membaca file gambar. Pastikan file PNG, JPEG, atau WebP tidak rusak.'));
        image.src = objectUrl!;
      });
      source = img;
      srcW = img.naturalWidth || img.width;
      srcH = img.naturalHeight || img.height;
    }

    if (srcW <= 0 || srcH <= 0) {
      throw new Error('Dimensi gambar tidak valid.');
    }

    const side = Math.min(srcW, srcH);
    const sx = Math.floor((srcW - side) / 2);
    const sy = Math.floor((srcH - side) / 2);

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Browser tidak mendukung pemrosesan gambar Canvas.');
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, sx, sy, side, side, 0, 0, 256, 256);

    const webp = canvas.toDataURL('image/webp', 0.86);
    if (webp.startsWith('data:image/webp;base64,') && webp.length <= MAX_AVATAR_DATA_URL_LEN) {
      return webp;
    }

    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 256, 256);
    ctx.globalCompositeOperation = 'source-over';

    for (const quality of [0.86, 0.76, 0.66]) {
      const jpeg = canvas.toDataURL('image/jpeg', quality);
      if (jpeg.startsWith('data:image/jpeg;base64,') && jpeg.length <= MAX_AVATAR_DATA_URL_LEN) {
        return jpeg;
      }
    }

    throw new Error('Ukuran gambar terkompresi masih terlalu besar. Pilih gambar lain.');
  } finally {
    if (bitmap) bitmap.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

function formatDateWib(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(d);
}

function formatActivityAction(aksi: string): { label: string; tone: 'neutral' | 'ok' | 'warn' } {
  switch (aksi) {
    case 'login_ok':
      return { label: 'Login berhasil', tone: 'ok' };
    case 'login_gagal':
      return { label: 'Percobaan login gagal', tone: 'warn' };
    case 'ganti_password':
      return { label: 'Kata sandi diganti', tone: 'ok' };
    case 'ganti_username':
      return { label: 'Username diubah', tone: 'neutral' };
    case 'cabut_sesi_lain':
      return { label: 'Sesi perangkat lain dicabut', tone: 'neutral' };
    case 'ubah_profil':
      return { label: 'Profil diperbarui', tone: 'neutral' };
    case 'ubah_foto_profil':
      return { label: 'Foto profil diperbarui', tone: 'neutral' };
    case 'hapus_foto_profil':
      return { label: 'Foto profil dihapus', tone: 'neutral' };
    default:
      return { label: aksi.replace(/_/g, ' '), tone: 'neutral' };
  }
}

function PasswordChangeCard({
  user,
  wajib,
  onSuccess,
}: {
  user: User | null;
  wajib: boolean;
  onSuccess: (updatedUser: User) => void;
}) {
  const [lama, setLama] = useState('');
  const [baru, setBaru] = useState('');
  const [konfirmasi, setKonfirmasi] = useState('');
  const [showLama, setShowLama] = useState(false);
  const [showBaru, setShowBaru] = useState(false);
  const [showKonfirmasi, setShowKonfirmasi] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const [lamaErrMsg, setLamaErrMsg] = useState('Masukkan kata sandi saat ini.');
  const [baruErrMsg, setBaruErrMsg] = useState('Kata sandi baru belum memenuhi ketentuan di atas.');
  const [konfErrMsg, setKonfErrMsg] = useState('Konfirmasi kata sandi baru tidak cocok.');

  const formRef = useRef<HTMLFormElement>(null);
  const lamaRef = useRef<HTMLInputElement>(null);
  const baruRef = useRef<HTMLInputElement>(null);
  const konfRef = useRef<HTMLInputElement>(null);
  const flaggedRef = useRef(new WeakSet<HTMLInputElement>());
  const announcedRef = useRef(new WeakSet<HTMLInputElement>());
  const dirtyRef = useRef(new WeakMap<HTMLInputElement, { interacted: boolean; blurred: boolean }>());
  const announceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const supportsUserInvalidRef = useRef(true);

  const username = user?.username || '';
  const byteLen = utf8ByteLength(baru);
  const ruleLength = baru.length >= MIN_PASSWORD_LEN && byteLen <= MAX_PASSWORD_BYTES;
  const ruleNoIdentity = baru.length > 0 && checkPasswordIdentitySafe(baru, username, user?.nama);
  const ruleNotCommonOrPattern =
    baru.length > 0 && !isCommonWeakPassword(baru) && !isRepetitiveOrSequential(baru);
  const strength = useMemo(
    () => computePasswordStrength(baru, username, user?.nama),
    [baru, username, user?.nama]
  );

  const linkError = useCallback((el: HTMLInputElement, shown: boolean) => {
    const errorId = el.dataset.error;
    if (!errorId) return;
    const baseIds = (el.getAttribute('aria-describedby') || '')
      .split(/\s+/)
      .filter((id) => id && id !== errorId);
    if (shown) baseIds.push(errorId);
    if (baseIds.length > 0) el.setAttribute('aria-describedby', baseIds.join(' '));
    else el.removeAttribute('aria-describedby');
  }, []);

  const queueAnnouncement = useCallback((el: HTMLInputElement) => {
    const errorId = el.dataset.error;
    if (!errorId) return;
    const errEl = document.getElementById(errorId);
    const labelEl = el.labels?.[0];
    const labelText = labelEl ? `${labelEl.textContent?.trim()}: ` : '';
    const msgText = errEl?.textContent?.replace(/\s+/g, ' ').trim() || '';
    if (!msgText) return;
    if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
    setAnnouncement('');
    announceTimerRef.current = setTimeout(() => {
      setAnnouncement(`${labelText}${msgText}`);
    }, 500);
  }, []);

  const syncAriaForInput = useCallback(
    (el: HTMLInputElement | null, announce = false) => {
      if (!el) return;
      const usesNative = supportsUserInvalidRef.current;
      const isInvalid = usesNative
        ? el.matches(':user-invalid')
        : el.classList.contains('user-invalid-fallback');

      if (isInvalid) {
        if (announce && !announcedRef.current.has(el)) {
          queueAnnouncement(el);
          announcedRef.current.add(el);
        }
        el.setAttribute('aria-invalid', 'true');
        linkError(el, true);
        flaggedRef.current.add(el);
      } else if (flaggedRef.current.has(el) || el.getAttribute('aria-invalid') !== 'true') {
        el.setAttribute('aria-invalid', 'false');
        linkError(el, false);
        flaggedRef.current.delete(el);
        announcedRef.current.delete(el);
      }
    },
    [linkError, queueAnnouncement]
  );

  useEffect(() => {
    const elLama = lamaRef.current;
    if (elLama) {
      elLama.setCustomValidity('');
      setLamaErrMsg('Masukkan kata sandi saat ini.');
    }

    const elBaru = baruRef.current;
    if (elBaru) {
      let customMsg = '';
      if (baru.length > 0) {
        if (baru.length < MIN_PASSWORD_LEN) {
          customMsg = `Kata sandi minimal ${MIN_PASSWORD_LEN} karakter.`;
        } else if (utf8ByteLength(baru) > MAX_PASSWORD_BYTES) {
          customMsg = `Kata sandi terlalu panjang (maksimal ${MAX_PASSWORD_BYTES} byte).`;
        } else if (isCommonWeakPassword(baru)) {
          customMsg = 'Kata sandi terlalu umum dan mudah ditebak.';
        } else if (isRepetitiveOrSequential(baru)) {
          customMsg = 'Kata sandi tidak boleh berupa karakter berulang atau urutan sederhana.';
        } else if (!ruleNoIdentity) {
          customMsg = 'Kata sandi tidak boleh memuat username atau nama Anda.';
        }
      }
      elBaru.setCustomValidity(customMsg);
      setBaruErrMsg(customMsg || `Kata sandi baru minimal ${MIN_PASSWORD_LEN} karakter.`);
    }

    const elKonf = konfRef.current;
    if (elKonf) {
      const mismatch = Boolean(konfirmasi && konfirmasi !== baru);
      const customMsg = mismatch ? 'Konfirmasi kata sandi baru tidak cocok.' : '';
      elKonf.setCustomValidity(customMsg);
      setKonfErrMsg(customMsg || 'Ulangi kata sandi baru Anda.');
    }
  }, [lama, baru, konfirmasi, ruleNoIdentity]);

  useEffect(() => {
    if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
      supportsUserInvalidRef.current = CSS.supports('selector(:user-invalid)');
    }
    const inputs = [lamaRef.current, baruRef.current, konfRef.current].filter(
      (x): x is HTMLInputElement => Boolean(x)
    );
    inputs.forEach((el) => {
      el.setAttribute('aria-invalid', 'false');
    });

    const form = formRef.current;
    if (!form) return;

    const updateFallback = (input: HTMLInputElement) => {
      const valid = input.validity.valid;
      input.classList.toggle('user-invalid-fallback', !valid);
      input.classList.toggle('user-valid-fallback', valid);
    };

    const onBlur = (e: FocusEvent) => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (!supportsUserInvalidRef.current) {
        const st = dirtyRef.current.get(target) ?? { interacted: false, blurred: false };
        st.blurred = true;
        dirtyRef.current.set(target, st);
        if (st.interacted) updateFallback(target);
      }
      syncAriaForInput(target, true);
    };

    const onInput = (e: Event) => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (!supportsUserInvalidRef.current) {
        const st = dirtyRef.current.get(target) ?? { interacted: false, blurred: false };
        st.interacted = true;
        dirtyRef.current.set(target, st);
        if (st.blurred) updateFallback(target);
      }
      if (target.hasAttribute('aria-invalid')) {
        syncAriaForInput(target, false);
      }
    };

    const onInvalid = (e: Event) => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (!supportsUserInvalidRef.current) {
        dirtyRef.current.set(target, { interacted: true, blurred: true });
        updateFallback(target);
      }
      announcedRef.current.add(target);
      syncAriaForInput(target, false);
    };

    form.addEventListener('blur', onBlur, true);
    form.addEventListener('input', onInput);
    form.addEventListener('invalid', onInvalid, true);

    return () => {
      form.removeEventListener('blur', onBlur, true);
      form.removeEventListener('input', onInput);
      form.removeEventListener('invalid', onInvalid, true);
      if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
    };
  }, [syncAriaForInput]);

  function applyGeneratedPassword(generated: string) {
    setBaru(generated);
    setKonfirmasi(generated);
    setShowBaru(true);
    setMsg('');
    setErr('');
    [baruRef.current, konfRef.current].forEach((el) => {
      if (!el) return;
      el.setCustomValidity('');
      el.classList.remove('user-invalid-fallback', 'user-valid-fallback');
      el.setAttribute('aria-invalid', 'false');
      linkError(el, false);
      flaggedRef.current.delete(el);
      announcedRef.current.delete(el);
    });
  }

  function handleGenerateStrongPassword() {
    applyGeneratedPassword(generateStrongPassword(username, user?.nama));
  }

  function handleGeneratePassphrase() {
    applyGeneratedPassword(generatePassphrase(username, user?.nama));
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg('');
    setErr('');

    const form = formRef.current;
    if (form && !form.checkValidity()) {
      const firstInvalid = form.querySelector(':invalid') as HTMLInputElement | null;
      [lamaRef.current, baruRef.current, konfRef.current].forEach((el) => {
        if (el && !el.validity.valid) {
          if (!supportsUserInvalidRef.current) {
            el.classList.add('user-invalid-fallback');
            el.classList.remove('user-valid-fallback');
          }
          el.setAttribute('aria-invalid', 'true');
          linkError(el, true);
        }
      });
      firstInvalid?.focus();
      return;
    }

    if (baru !== konfirmasi) {
      setErr('Konfirmasi kata sandi baru tidak cocok.');
      konfRef.current?.focus();
      return;
    }

    setBusy(true);
    let redirecting = false;
    try {
      const res = await api<{ ok?: boolean; access_token?: string; user?: User }>('/auth/ganti-password', {
        method: 'POST',
        body: { password_lama: lama, password_baru: baru },
      });
      const baseUser = res?.user || user || session.user();
      const token = res?.access_token || session.token();
      if (baseUser && token) {
        const updated = { ...baseUser, wajib_ganti_password: false };
        session.save(token, updated);
        window.dispatchEvent(new Event('sis-user-updated'));
        onSuccess(updated);
      }
      setMsg('Kata sandi berhasil diperbarui. Sesi di perangkat lain otomatis dicabut.');
      setLama('');
      setBaru('');
      setKonfirmasi('');
      setShowBaru(false);
      setShowKonfirmasi(false);
      [lamaRef.current, baruRef.current, konfRef.current].forEach((el) => {
        if (!el) return;
        el.classList.remove('user-invalid-fallback', 'user-valid-fallback');
        el.setAttribute('aria-invalid', 'false');
        linkError(el, false);
        dirtyRef.current.delete(el);
        flaggedRef.current.delete(el);
        announcedRef.current.delete(el);
      });

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

  const checklistItems = [
    {
      label: 'Minimal 8 karakter',
      met: ruleLength,
    },
    {
      label: `Tidak memuat username${username ? ` (@${username})` : ''} atau nama pribadi`,
      met: ruleNoIdentity,
    },
    {
      label: 'Bukan kata sandi umum atau pola mudah ditebak',
      met: ruleNotCommonOrPattern,
    },
  ];

  return (
    <form ref={formRef} onSubmit={submit} className="space-y-4">
      <div className="visually-hidden" aria-live="polite">
        {announcement}
      </div>

      {/* Konteks username untuk password manager saat autoComplete="new-password" */}
      <input
        type="text"
        name="username"
        autoComplete="username"
        value={username}
        readOnly
        tabIndex={-1}
        aria-hidden="true"
        className="visually-hidden"
      />

      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-[var(--text-primary)]" />
        <h2 className="text-base font-semibold text-[var(--text-primary)]">Ganti Kata Sandi</h2>
      </div>

      {wajib && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p>Kata sandi sementara wajib diganti terlebih dahulu sebelum mengakses menu lain.</p>
        </div>
      )}

      {/* Kata sandi saat ini */}
      <div className="field space-y-1.5">
        <label htmlFor="password-lama" className="block text-xs font-medium text-[var(--text-primary)]">
          Kata sandi saat ini
        </label>
        <div className="relative">
          <input
            ref={lamaRef}
            id="password-lama"
            name="password_lama"
            className="input !pr-10"
            type={showLama ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="Masukkan kata sandi saat ini"
            minLength={1}
            required
            aria-invalid="false"
            data-error="password-lama-error"
            value={lama}
            onChange={(e) => setLama(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setShowLama((v) => !v)}
            aria-label={showLama ? 'Sembunyikan kata sandi saat ini' : 'Tampilkan kata sandi saat ini'}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          >
            {showLama ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <div id="password-lama-error" className="error-msg text-xs font-medium text-rose-600 dark:text-rose-400">
          <span className="inline-flex items-start gap-1.5">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{lamaErrMsg}</span>
          </span>
        </div>
      </div>

      {/* Kata sandi baru + daftar ketentuan NIST Rev 4 di atas input */}
      <div className="field space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="password-baru" className="block text-xs font-medium text-[var(--text-primary)]">
            Kata sandi baru
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={handleGenerateStrongPassword}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-surface)]"
            >
              <Sparkles className="h-3 w-3 text-[var(--text-secondary)]" aria-hidden="true" />
              <span>Sandi acak</span>
            </button>
            <button
              type="button"
              onClick={handleGeneratePassphrase}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-surface)]"
            >
              <Shuffle className="h-3 w-3 text-[var(--text-secondary)]" aria-hidden="true" />
              <span>Frasa sandi</span>
            </button>
          </div>
        </div>

        <ul
          id="password-rules"
          className="space-y-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 px-3 py-2 text-xs text-[var(--text-secondary)]"
        >
          {checklistItems.map((rule) => (
            <li key={rule.label} className="flex items-start gap-1.5">
              <CheckCircle2
                aria-hidden="true"
                className={`mt-0.5 h-3.5 w-3.5 shrink-0 transition-colors ${
                  rule.met ? 'text-emerald-600 dark:text-emerald-400' : 'opacity-35'
                }`}
              />
              <span className={rule.met ? 'text-[var(--text-primary)]' : undefined}>{rule.label}</span>
            </li>
          ))}
        </ul>

        <div className="relative">
          <input
            ref={baruRef}
            id="password-baru"
            name="password_baru"
            className="input !pr-10"
            type={showBaru ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="Minimal 8 karakter atau frasa sandi"
            minLength={MIN_PASSWORD_LEN}
            maxLength={MAX_PASSWORD_BYTES}
            required
            aria-invalid="false"
            aria-describedby="password-rules"
            data-error="password-baru-error"
            value={baru}
            onChange={(e) => setBaru(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setShowBaru((v) => !v)}
            aria-label={showBaru ? 'Sembunyikan kata sandi baru' : 'Tampilkan kata sandi baru'}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          >
            {showBaru ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        <div id="password-baru-error" className="error-msg text-xs font-medium text-rose-600 dark:text-rose-400">
          <span className="inline-flex items-start gap-1.5">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{baruErrMsg}</span>
          </span>
        </div>

        {/* 4-bar Password Strength Meter + Estimasi Ketahanan + Tip Non-blocking */}
        <div className="space-y-1.5 pt-0.5" aria-live="off">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--text-secondary)]">
            <span>Kekuatan kata sandi</span>
            <div className="flex items-center gap-2">
              {strength.crackTime && (
                <span className="text-[var(--text-muted)]">
                  Estimasi ketahanan: <strong className="font-medium text-[var(--text-secondary)]">{strength.crackTime}</strong>
                </span>
              )}
              <span className="font-semibold text-[var(--text-primary)]">{strength.label}</span>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {[1, 2, 3, 4].map((step) => (
              <span
                key={step}
                className={`h-1.5 rounded-full transition-colors ${
                  strength.score >= step ? strength.barClass : 'bg-[var(--border-subtle)]'
                }`}
              />
            ))}
          </div>
          {strength.score > 0 && strength.score < 4 && strength.tip && (
            <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">{strength.tip}</p>
          )}
        </div>
      </div>

      {/* Konfirmasi kata sandi baru */}
      <div className="field space-y-1.5">
        <label htmlFor="password-konfirmasi" className="block text-xs font-medium text-[var(--text-primary)]">
          Konfirmasi kata sandi baru
        </label>
        <div className="relative">
          <input
            ref={konfRef}
            id="password-konfirmasi"
            name="password_konfirmasi"
            className="input !pr-10"
            type={showKonfirmasi ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="Ulangi kata sandi baru"
            minLength={MIN_PASSWORD_LEN}
            maxLength={MAX_PASSWORD_BYTES}
            required
            aria-invalid="false"
            data-error="password-konfirmasi-error"
            value={konfirmasi}
            onChange={(e) => setKonfirmasi(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setShowKonfirmasi((v) => !v)}
            aria-label={showKonfirmasi ? 'Sembunyikan konfirmasi kata sandi' : 'Tampilkan konfirmasi kata sandi'}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          >
            {showKonfirmasi ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <div id="password-konfirmasi-error" className="error-msg text-xs font-medium text-rose-600 dark:text-rose-400">
          <span className="inline-flex items-start gap-1.5">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{konfErrMsg}</span>
          </span>
        </div>
      </div>

      {msg && (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-sm text-emerald-700 dark:text-emerald-300">
          {msg}
        </p>
      )}
      {err && (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-sm text-rose-700 dark:text-rose-300">
          {err}
        </p>
      )}

      <button type="submit" className="btn w-full sm:w-auto" disabled={busy}>
        {busy ? 'Menyimpan…' : 'Simpan Kata Sandi'}
      </button>
    </form>
  );
}

function AkunPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');

  const [user, setUser] = useState<User | null>(null);
  const [activeSection, setActiveSection] = useState<SectionKey>(() => parseSectionParam(tabParam));

  // Profil & Foto state
  const [namaInput, setNamaInput] = useState('');
  const [savingProfil, setSavingProfil] = useState(false);
  const [profilMsg, setProfilMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [usernameInput, setUsernameInput] = useState('');
  const [usernameConfirmPw, setUsernameConfirmPw] = useState('');
  const [showUsernameConfirmPw, setShowUsernameConfirmPw] = useState(false);
  const [usernameCheck, setUsernameCheck] = useState<{
    state: 'idle' | 'invalid' | 'checking' | 'available' | 'unavailable' | 'error';
    reason?: string;
  }>({ state: 'idle' });
  const [savingUsername, setSavingUsername] = useState(false);
  const [usernameMsg, setUsernameMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoMsg, setPhotoMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keamanan & Sesi state
  const [revokingOther, setRevokingOther] = useState(false);
  const [confirmRevokeOpen, setConfirmRevokeOpen] = useState(false);
  const [sessionMsg, setSessionMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activitiesErr, setActivitiesErr] = useState('');

  // Preferensi state
  const [prefs, setPrefs] = useState<UserPreferences>({
    theme: 'system',
    enterToSend: true,
    tableDensity: 'comfortable',
  });
  const [osDark, setOsDark] = useState(false);
  const [autoSaveTick, setAutoSaveTick] = useState(0);

  // Privasi & Data Percakapan state
  const [health, setHealth] = useState<HealthPrivacy | null>(null);
  const [chatSessions, setChatSessions] = useState<ChatSessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [confirmClearChatsOpen, setConfirmClearChatsOpen] = useState(false);
  const [clearingChats, setClearingChats] = useState(false);
  const [privacyMsg, setPrivacyMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const panelRefs = useRef<Record<SectionKey, HTMLDivElement | null>>({
    profil: null,
    keamanan: null,
    preferensi: null,
    privasi: null,
  });

  const themeLegendId = useId();
  const shortcutLegendId = useId();
  const densityLegendId = useId();

  useEffect(() => {
    setActiveSection(parseSectionParam(tabParam));
  }, [tabParam]);

  const selectSection = useCallback(
    (next: SectionKey) => {
      setActiveSection(next);
      router.replace(`${pathname}?tab=${next}`, { scroll: false });
    },
    [pathname, router]
  );

  // Sinkronisasi preferensi & preferensi sistem OS
  useEffect(() => {
    setPrefs(preferences.get());
    const unsub = preferences.subscribe((next) => setPrefs(next));
    const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    if (mq) {
      setOsDark(mq.matches);
      const onChange = (e: MediaQueryListEvent) => setOsDark(e.matches);
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
      return () => {
        unsub();
        if (mq.removeEventListener) mq.removeEventListener('change', onChange);
        else if (mq.removeListener) mq.removeListener(onChange);
      };
    }
    return unsub;
  }, []);

  // Ambil profil user terbaru
  useEffect(() => {
    let alive = true;
    const cached = session.user();
    if (cached) {
      setUser(cached);
      setNamaInput(cached.nama || '');
      setUsernameInput(cached.username || '');
    }
    const token = session.token();
    if (!token) return;
    api<User>('/auth/me')
      .then((fresh) => {
        if (!alive) return;
        session.save(token, fresh);
        setUser(fresh);
        setNamaInput(fresh.nama || '');
        setUsernameInput(fresh.username || '');
      })
      .catch(() => {
        /* ditangani oleh interceptor api() */
      });
    return () => {
      alive = false;
    };
  }, []);

  const trimmedUsername = usernameInput.trim();
  const currentUsername = (user?.username || '').trim();
  const isUsernameDifferent = Boolean(
    user && trimmedUsername.length > 0 && trimmedUsername !== currentUsername
  );

  // Cek ketersediaan username secara langsung (debounced 350ms)
  useEffect(() => {
    if (!user || user.wajib_ganti_password) return;
    if (trimmedUsername === currentUsername) {
      setUsernameCheck({ state: 'idle' });
      return;
    }
    if (trimmedUsername.length < 3) {
      setUsernameCheck({ state: 'invalid', reason: 'Username minimal 3 karakter.' });
      return;
    }
    if (trimmedUsername.length > 30) {
      setUsernameCheck({ state: 'invalid', reason: 'Username maksimal 30 karakter.' });
      return;
    }
    if (!/^[a-zA-Z0-9._]+$/.test(trimmedUsername)) {
      setUsernameCheck({
        state: 'invalid',
        reason: 'Username hanya boleh berisi huruf, angka, titik (.), atau garis bawah (_).',
      });
      return;
    }
    if (trimmedUsername.startsWith('.') || trimmedUsername.endsWith('.')) {
      setUsernameCheck({
        state: 'invalid',
        reason: 'Username tidak boleh diawali atau diakhiri dengan titik (.).',
      });
      return;
    }
    if (trimmedUsername.includes('..')) {
      setUsernameCheck({
        state: 'invalid',
        reason: 'Username tidak boleh mengandung dua titik berurutan (..).',
      });
      return;
    }
    if (!USERNAME_REGEX.test(trimmedUsername)) {
      setUsernameCheck({
        state: 'invalid',
        reason: 'Format username tidak valid.',
      });
      return;
    }
    if (trimmedUsername.toLowerCase() === currentUsername.toLowerCase()) {
      setUsernameCheck({
        state: 'unavailable',
        reason: 'Username ini sudah menjadi username Anda saat ini.',
      });
      return;
    }

    let cancelled = false;
    setUsernameCheck({ state: 'checking' });
    const timer = setTimeout(async () => {
      try {
        const res = await api<{ available: boolean; reason?: string | null }>(
          `/auth/cek-username?username=${encodeURIComponent(trimmedUsername)}`
        );
        if (cancelled) return;
        if (res.available) {
          setUsernameCheck({ state: 'available' });
        } else {
          setUsernameCheck({
            state: 'unavailable',
            reason: res.reason || 'Username sudah digunakan oleh akun lain.',
          });
        }
      } catch (err) {
        if (cancelled) return;
        setUsernameCheck({
          state: 'error',
          reason: (err as Error).message || 'Gagal memeriksa ketersediaan username.',
        });
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmedUsername, currentUsername, user]);

  const loadActivities = useCallback(async () => {
    setActivitiesLoading(true);
    setActivitiesErr('');
    try {
      const res = await api<{ data: ActivityItem[] }>('/auth/aktivitas');
      setActivities(res.data ?? []);
    } catch (e) {
      setActivitiesErr((e as Error).message);
    } finally {
      setActivitiesLoading(false);
    }
  }, []);

  const loadChatSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res = await api<{ data: ChatSessionSummary[] }>('/chat/sesi?limit=100');
      setChatSessions(res.data ?? []);
    } catch {
      /* abaikan bila gagal memuat jumlah sesi */
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  // Muat aktivitas, status privasi health, dan sesi chat ketika bukan mode wajib ganti sandi
  useEffect(() => {
    if (!user || user.wajib_ganti_password) return;
    loadActivities();
    loadChatSessions();
    fetch(`${API}/health`)
      .then((r) => (r.ok ? (r.json() as Promise<HealthPrivacy>) : null))
      .then((h) => {
        if (h) setHealth(h);
      })
      .catch(() => {});
  }, [user, loadActivities, loadChatSessions]);

  // Sinkronkan tab jika Find-in-page membuka tabpanel hidden="until-found"
  useEffect(() => {
    const keys: SectionKey[] = ['profil', 'keamanan', 'preferensi', 'privasi'];
    const cleanups: Array<() => void> = [];
    for (const k of keys) {
      const el = panelRefs.current[k];
      if (!el) continue;
      const onBeforeMatch = () => selectSection(k);
      el.addEventListener('beforematch', onBeforeMatch);
      cleanups.push(() => el.removeEventListener('beforematch', onBeforeMatch));
    }
    return () => cleanups.forEach((fn) => fn());
  }, [user?.wajib_ganti_password, selectSection]);

  const wajib = Boolean(user?.wajib_ganti_password);

  // Mode terisolasi wajib ganti password
  if (wajib && user) {
    return (
      <div className="mx-auto w-full max-w-md space-y-4">
        <div className="card space-y-5 p-6">
          <div className="flex items-center gap-3.5 border-b border-[var(--border-subtle)] pb-4">
            <UserAvatar
              nama={user.nama}
              username={user.username}
              fotoProfil={user.foto_profil}
              size="md"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{user.nama}</p>
                <span className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text-primary)]">
                  {roleLabel(user.role)}
                </span>
              </div>
              <p className="truncate text-xs text-[var(--text-secondary)]">
                @{user.username}
                {user.nip ? ` · NIP ${user.nip}` : ''}
              </p>
            </div>
          </div>

          <PasswordChangeCard
            user={user}
            wajib
            onSuccess={(updated) => {
              setUser(updated);
            }}
          />
        </div>
      </div>
    );
  }

  const trimmedNama = namaInput.trim();
  const isProfilDirty = Boolean(user && trimmedNama.length > 0 && trimmedNama !== (user.nama || '').trim());

  async function handlePhotoSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !user || photoBusy) return;

    setPhotoBusy(true);
    setPhotoMsg(null);
    try {
      const dataUrl = await compressAvatarToDataUrl(file);
      const updated = await api<User>('/auth/foto-profil', {
        method: 'POST',
        body: { foto_profil: dataUrl },
      });
      const token = session.token();
      const merged: User = {
        ...user,
        ...updated,
        foto_profil: updated?.foto_profil ?? dataUrl,
      };
      if (token) {
        session.save(token, merged);
      }
      setUser(merged);
      window.dispatchEvent(new Event('sis-user-updated'));
      setPhotoMsg({ kind: 'ok', text: 'Foto profil berhasil diperbarui.' });
      loadActivities();
    } catch (e2) {
      setPhotoMsg({ kind: 'err', text: (e2 as Error).message });
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handleDeletePhoto() {
    if (!user || !user.foto_profil || photoBusy) return;
    setPhotoBusy(true);
    setPhotoMsg(null);
    try {
      const updated = await api<User>('/auth/foto-profil', {
        method: 'DELETE',
      });
      const token = session.token();
      const merged: User = {
        ...user,
        ...updated,
        foto_profil: null,
      };
      if (token) {
        session.save(token, merged);
      }
      setUser(merged);
      window.dispatchEvent(new Event('sis-user-updated'));
      setPhotoMsg({ kind: 'ok', text: 'Foto profil dihapus.' });
      loadActivities();
    } catch (e2) {
      setPhotoMsg({ kind: 'err', text: (e2 as Error).message });
    } finally {
      setPhotoBusy(false);
    }
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    if (!user || !isProfilDirty || savingProfil) return;
    setSavingProfil(true);
    setProfilMsg(null);
    try {
      const updated = await api<User>('/auth/profil', {
        method: 'PATCH',
        body: { nama: trimmedNama },
      });
      const token = session.token();
      const merged = { ...user, ...updated, nama: updated?.nama || trimmedNama };
      if (token) {
        session.save(token, merged);
      }
      setUser(merged);
      setNamaInput(merged.nama);
      window.dispatchEvent(new Event('sis-user-updated'));
      setProfilMsg({ kind: 'ok', text: 'Nama lengkap berhasil diperbarui.' });
      loadActivities();
    } catch (e2) {
      setProfilMsg({ kind: 'err', text: (e2 as Error).message });
    } finally {
      setSavingProfil(false);
    }
  }

  async function saveUsername(e: FormEvent) {
    e.preventDefault();
    if (
      !user ||
      !isUsernameDifferent ||
      !USERNAME_REGEX.test(trimmedUsername) ||
      usernameCheck.state !== 'available' ||
      !usernameConfirmPw ||
      savingUsername
    ) {
      return;
    }
    setSavingUsername(true);
    setUsernameMsg(null);
    try {
      const updated = await api<User>('/auth/username', {
        method: 'PATCH',
        body: {
          username_baru: trimmedUsername,
          password_saat_ini: usernameConfirmPw,
        },
      });
      const token = session.token();
      const merged: User = {
        ...user,
        ...updated,
        username: updated?.username || trimmedUsername,
      };
      if (token) {
        session.save(token, merged);
      }
      setUser(merged);
      setUsernameInput(merged.username);
      setUsernameConfirmPw('');
      setShowUsernameConfirmPw(false);
      setUsernameCheck({ state: 'idle' });
      window.dispatchEvent(new Event('sis-user-updated'));
      setUsernameMsg({ kind: 'ok', text: `Username berhasil diubah menjadi @${merged.username}.` });
      loadActivities();
    } catch (e2) {
      setUsernameMsg({ kind: 'err', text: (e2 as Error).message });
    } finally {
      setSavingUsername(false);
    }
  }

  async function revokeOtherSessions() {
    if (revokingOther) return;
    setRevokingOther(true);
    setSessionMsg(null);
    try {
      await api('/auth/cabut-sesi-lain', { method: 'POST' });
      setConfirmRevokeOpen(false);
      setSessionMsg({
        kind: 'ok',
        text: 'Semua sesi login di perangkat lain telah dicabut. Sesi Anda saat ini tetap aktif.',
      });
      loadActivities();
    } catch (e2) {
      setConfirmRevokeOpen(false);
      setSessionMsg({ kind: 'err', text: (e2 as Error).message });
    } finally {
      setRevokingOther(false);
    }
  }

  async function clearUnpinnedChats() {
    if (clearingChats) return;
    setClearingChats(true);
    setPrivacyMsg(null);
    try {
      const res = await api<{ deleted: number }>('/chat/sesi', { method: 'DELETE' });
      setConfirmClearChatsOpen(false);
      window.dispatchEvent(new Event('sis-sessions-updated'));
      await loadChatSessions();
      setPrivacyMsg({
        kind: 'ok',
        text: `${res?.deleted ?? 0} riwayat percakapan reguler telah dihapus. Percakapan yang disematkan tetap tersimpan.`,
      });
    } catch (e2) {
      setConfirmClearChatsOpen(false);
      setPrivacyMsg({ kind: 'err', text: (e2 as Error).message });
    } finally {
      setClearingChats(false);
    }
  }

  const isAdmin = user?.role === 'admin';
  const allowPelanggaran = canViewPelanggaran(user?.role);

  const pinnedCount = chatSessions.filter((s) => Boolean(s.pinned)).length;
  const unpinnedCount = chatSessions.length - pinnedCount;

  const triggerPrefFeedback = () => {
    setAutoSaveTick((t) => t + 1);
  };

  const roleSummaryText = isAdmin
    ? 'Akses penuh sistem, manajemen akun, master data & audit pelanggaran.'
    : allowPelanggaran
    ? 'Akses akademik, AI assistant & catatan pelanggaran siswa (tercatat audit).'
    : 'Akses akademik, jadwal, nilai & AI assistant (data pelanggaran dibatasi).';

  const showUsernameConfirm =
    (isUsernameDifferent && usernameCheck.state === 'available') || savingUsername;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      {/* Content Panels (single stack for hidden="until-found") */}
      <div className="min-w-0">
        {/* 1) Profil & Hak Akses */}
        <div
          ref={(el) => {
            panelRefs.current.profil = el;
          }}
          role="region"
          aria-label="Profil"
          hidden={activeSection !== 'profil' ? ('until-found' as unknown as boolean) : undefined}
          tabIndex={activeSection === 'profil' ? 0 : undefined}
        >
          <div className="space-y-5">
            {/* Identity, Avatar, Editable Name & Username */}
            <section className="card space-y-5 p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border-subtle)] pb-5">
                <div className="flex min-w-0 items-center gap-4">
                  <UserAvatar
                    nama={user?.nama}
                    username={user?.username}
                    fotoProfil={user?.foto_profil}
                    size="lg"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-lg font-bold text-[var(--text-primary)]">
                        {user?.nama || 'Pengguna'}
                      </h2>
                      <span className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-0.5 text-xs font-semibold text-[var(--text-primary)]">
                        {roleLabel(user?.role)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                      @{user?.username || '—'}
                      {user?.nip ? ` · NIP ${user.nip}` : ''}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor="profil-foto-input" className="visually-hidden">
                    Pilih file foto profil
                  </label>
                  <input
                    ref={fileInputRef}
                    id="profil-foto-input"
                    name="foto_profil"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="visually-hidden"
                    onChange={handlePhotoSelected}
                  />
                  <button
                    type="button"
                    disabled={photoBusy || !user}
                    onClick={() => fileInputRef.current?.click()}
                    className="btn-ghost text-xs"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    <span>{photoBusy ? 'Memproses…' : 'Ubah Foto'}</span>
                  </button>
                  {user?.foto_profil && (
                    <button
                      type="button"
                      disabled={photoBusy}
                      onClick={handleDeletePhoto}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-1.5 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Hapus Foto</span>
                    </button>
                  )}
                </div>
              </div>

              {photoMsg && (
                <p
                  className={`rounded-xl border p-2.5 text-sm ${
                    photoMsg.kind === 'ok'
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                  }`}
                >
                  {photoMsg.text}
                </p>
              )}

              <form onSubmit={saveProfile} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="profil-nama" className="block text-xs font-medium text-[var(--text-primary)]">
                    Nama Lengkap
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      id="profil-nama"
                      name="nama"
                      type="text"
                      className="input sm:max-w-md"
                      value={namaInput}
                      minLength={1}
                      maxLength={120}
                      required
                      onChange={(e) => {
                        setNamaInput(e.target.value);
                        if (profilMsg) setProfilMsg(null);
                      }}
                    />
                    <button
                      type="submit"
                      disabled={!isProfilDirty || savingProfil}
                      className="btn shrink-0"
                    >
                      {savingProfil ? 'Menyimpan…' : 'Simpan Profil'}
                    </button>
                  </div>
                  <p className="text-[11px] text-[var(--text-secondary)]">
                    Nama lengkap dan foto profil ditampilkan pada sidebar aplikasi dan riwayat aktivitas akun.
                  </p>
                </div>

                {profilMsg && (
                  <p
                    className={`rounded-xl border p-2.5 text-sm ${
                      profilMsg.kind === 'ok'
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                    }`}
                  >
                    {profilMsg.text}
                  </p>
                )}
              </form>

              {/* Ubah Username */}
              <form onSubmit={saveUsername} className="space-y-3 border-t border-[var(--border-subtle)] pt-5">
                <div className="space-y-1.5">
                  <label htmlFor="profil-username" className="block text-xs font-medium text-[var(--text-primary)]">
                    Ubah Username
                  </label>
                  <div className="relative sm:max-w-md">
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-[var(--text-muted)]"
                    >
                      @
                    </span>
                    <input
                      id="profil-username"
                      name="username"
                      type="text"
                      autoComplete="username"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      minLength={3}
                      maxLength={30}
                      pattern="[a-zA-Z0-9._]{3,30}"
                      title="3–30 karakter: huruf, angka, titik (.), atau garis bawah (_), tanpa titik di awal/akhir atau berurutan"
                      className="input !pl-7 font-mono"
                      value={usernameInput}
                      onChange={(e) => {
                        setUsernameInput(e.target.value);
                        if (usernameMsg) setUsernameMsg(null);
                      }}
                    />
                  </div>
                  <p className="text-[11px] text-[var(--text-secondary)]">
                    3–30 karakter: huruf, angka, titik (.), atau garis bawah (_), tanpa titik di awal/akhir atau berurutan.
                  </p>

                  {usernameCheck.state === 'checking' && (
                    <p className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)]" aria-live="polite">
                      <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden="true" />
                      <span>Memeriksa ketersediaan…</span>
                    </p>
                  )}
                  {usernameCheck.state === 'available' && (
                    <p
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"
                      aria-live="polite"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>Username tersedia</span>
                    </p>
                  )}
                  {(usernameCheck.state === 'invalid' ||
                    usernameCheck.state === 'unavailable' ||
                    usernameCheck.state === 'error') &&
                    usernameCheck.reason && (
                      <p
                        className="inline-flex items-start gap-1.5 text-xs font-medium text-rose-600 dark:text-rose-400"
                        aria-live="polite"
                      >
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>{usernameCheck.reason}</span>
                      </p>
                    )}
                </div>

                {showUsernameConfirm && (
                  <div className="space-y-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/70 p-3.5">
                    <label
                      htmlFor="username-confirm-password"
                      className="block text-xs font-medium text-[var(--text-primary)]"
                    >
                      Kata sandi saat ini (untuk konfirmasi)
                    </label>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <div className="relative flex-1 sm:max-w-xs">
                        <input
                          id="username-confirm-password"
                          name="password_saat_ini"
                          type={showUsernameConfirmPw ? 'text' : 'password'}
                          autoComplete="current-password"
                          placeholder="Masukkan kata sandi saat ini"
                          required
                          className="input !pr-10"
                          value={usernameConfirmPw}
                          onChange={(e) => {
                            setUsernameConfirmPw(e.target.value);
                            if (usernameMsg) setUsernameMsg(null);
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => setShowUsernameConfirmPw((v) => !v)}
                          aria-label={
                            showUsernameConfirmPw
                              ? 'Sembunyikan kata sandi konfirmasi'
                              : 'Tampilkan kata sandi konfirmasi'
                          }
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                        >
                          {showUsernameConfirmPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      <button
                        type="submit"
                        disabled={!usernameConfirmPw || savingUsername || usernameCheck.state !== 'available'}
                        className="btn shrink-0"
                      >
                        {savingUsername ? 'Menyimpan…' : 'Simpan Username'}
                      </button>
                    </div>
                  </div>
                )}

                {usernameMsg && (
                  <p
                    className={`rounded-xl border p-2.5 text-sm ${
                      usernameMsg.kind === 'ok'
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                    }`}
                  >
                    {usernameMsg.text}
                  </p>
                )}
              </form>

              <dl className="grid grid-cols-1 gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 sm:grid-cols-2">
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                    Username
                  </dt>
                  <dd className="mt-0.5 font-mono text-sm text-[var(--text-primary)]">
                    @{user?.username || '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                    NIP
                  </dt>
                  <dd className="mt-0.5 font-mono text-sm text-[var(--text-primary)]">
                    {user?.nip || '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                    Wali Kelas
                  </dt>
                  <dd className="mt-0.5 text-sm text-[var(--text-primary)]">
                    {user?.wali_kelas && user.wali_kelas.length > 0
                      ? user.wali_kelas.join(', ')
                      : 'Bukan wali kelas'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                    Akun Terdaftar Sejak
                  </dt>
                  <dd className="mt-0.5 text-sm text-[var(--text-primary)]">
                    {formatDateWib(user?.dibuat_pada)}
                  </dd>
                </div>
              </dl>
            </section>

            {/* Ringkasan Peran & Hak Akses (collapsible disclosure) */}
            <section className="card space-y-3 p-5 sm:p-6">
              <div className="space-y-0.5">
                <h3 className="text-base font-semibold text-[var(--text-primary)]">Peran &amp; Hak Akses</h3>
                <p className="text-xs text-[var(--text-secondary)]">
                  <strong className="font-semibold text-[var(--text-primary)]">{roleLabel(user?.role)}</strong>
                  {' · '}
                  {roleSummaryText}
                </p>
              </div>

              <details className="sis-disclosure group rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50">
                <summary className="flex cursor-pointer items-center justify-between gap-2 px-3.5 py-2.5 text-xs font-medium text-[var(--text-primary)] select-none hover:bg-[var(--bg-elevated)]">
                  <span>Lihat ringkasan hak akses peran</span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-secondary)] transition-transform duration-200 group-open:rotate-180" />
                </summary>

                <div className="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                  {[
                    {
                      area: 'Data Akademik, Jadwal, Nilai & Kehadiran Siswa Kelas XII',
                      allowed: true,
                      note: 'Diizinkan',
                    },
                    {
                      area: 'Data & Catatan Pelanggaran Siswa (Sensitif)',
                      allowed: allowPelanggaran,
                      note: allowPelanggaran
                        ? 'Diizinkan'
                        : 'Dibatasi (Admin, Kepsek & BK)',
                    },
                    {
                      area: 'Knowledge Graph & Unggah Dokumen Sekolah',
                      allowed: true,
                      note: isAdmin ? 'Akses Penuh' : 'Unggah & Ajukan Hapus',
                    },
                    {
                      area: 'Manajemen Akun, Audit Log & Riwayat Impor',
                      allowed: isAdmin,
                      note: isAdmin ? 'Diizinkan' : 'Khusus Admin',
                    },
                    {
                      area: 'AI School Assistant (SQL Layer & CoT Trace)',
                      allowed: true,
                      note: 'Diizinkan',
                    },
                  ].map((row) => (
                    <div key={row.area} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                      <span className="font-medium text-[var(--text-primary)]">{row.area}</span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                          row.allowed
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
                        }`}
                      >
                        {row.allowed ? <Check className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                        <span>{row.note}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            </section>
          </div>
        </div>

        {/* 2) Keamanan & Sesi */}
        <div
          ref={(el) => {
            panelRefs.current.keamanan = el;
          }}
          role="region"
          aria-label="Keamanan & Sesi"
          hidden={activeSection !== 'keamanan' ? ('until-found' as unknown as boolean) : undefined}
          tabIndex={activeSection === 'keamanan' ? 0 : undefined}
        >
          <div className="space-y-5">
            {/* Form Ganti Kata Sandi */}
            <section className="card p-5 sm:p-6">
              <PasswordChangeCard
                user={user}
                wajib={false}
                onSuccess={(updated) => {
                  setUser(updated);
                  loadActivities();
                }}
              />
            </section>

            {/* Sesi Aktif */}
            <section className="card space-y-4 p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-[var(--text-primary)]">Sesi Aktif</h3>
                  <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                    Kelola sesi masuk Anda di peramban dan perangkat lain yang terhubung.
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  Sesi Saat Ini Aktif
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3.5">
                <div className="flex items-center gap-3">
                  <Monitor className="h-5 w-5 shrink-0 text-[var(--text-secondary)]" />
                  <div>
                    <p className="text-sm font-medium text-[var(--text-primary)]">Peramban &amp; Perangkat Ini</p>
                    <p className="text-xs text-[var(--text-secondary)]">
                      Token sesi tervalidasi terhadap versi keamanan terbaru akun Anda.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmRevokeOpen(true)}
                  className="btn-ghost text-xs"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Keluar dari Semua Perangkat Lain</span>
                </button>
              </div>

              {sessionMsg && (
                <p
                  className={`rounded-xl border p-2.5 text-sm ${
                    sessionMsg.kind === 'ok'
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                  }`}
                >
                  {sessionMsg.text}
                </p>
              )}
            </section>

            {/* Aktivitas Keamanan Terakhir */}
            <section className="card space-y-3 p-5 sm:p-6">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-[var(--text-primary)]" />
                  <h3 className="text-base font-semibold text-[var(--text-primary)]">Aktivitas Keamanan Terakhir</h3>
                </div>
                <button
                  type="button"
                  onClick={loadActivities}
                  disabled={activitiesLoading}
                  className="btn-ghost text-xs"
                >
                  {activitiesLoading ? 'Memuat…' : 'Muat Ulang'}
                </button>
              </div>

              {activitiesErr ? (
                <p className="text-sm text-rose-600 dark:text-rose-400">{activitiesErr}</p>
              ) : activitiesLoading && activities.length === 0 ? (
                <p className="text-sm text-[var(--text-secondary)]">Memuat riwayat keamanan…</p>
              ) : activities.length === 0 ? (
                <p className="text-sm text-[var(--text-secondary)]">Belum ada riwayat aktivitas keamanan tercatat.</p>
              ) : (
                <div className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)]">
                  {activities.map((item) => {
                    const info = formatActivityAction(item.aksi);
                    const isFail = item.status !== 'ok';
                    return (
                      <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-[var(--text-primary)]">{info.label}</span>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                                isFail
                                  ? 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                                  : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                              }`}
                            >
                              {item.status}
                            </span>
                          </div>
                          {item.pertanyaan && (
                            <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--text-secondary)]">
                              {item.pertanyaan}
                            </p>
                          )}
                        </div>
                        <span className="shrink-0 text-[11px] text-[var(--text-secondary)]">
                          {formatDateWib(item.waktu)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>

        {/* 3) Preferensi Tampilan & AI */}
        <div
          ref={(el) => {
            panelRefs.current.preferensi = el;
          }}
          role="region"
          aria-label="Preferensi Tampilan & AI"
          hidden={activeSection !== 'preferensi' ? ('until-found' as unknown as boolean) : undefined}
          tabIndex={activeSection === 'preferensi' ? 0 : undefined}
        >
          <section className="card space-y-6 p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-4">
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">Preferensi Tampilan &amp; AI</h2>
                <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                  Pengaturan berlaku langsung di peramban ini dan disinkronkan antar tab.
                </p>
              </div>
              <span
                key={autoSaveTick}
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Tersimpan otomatis</span>
              </span>
            </div>

            {/* 3-State Theme Toggle */}
            <fieldset className="space-y-2.5" aria-labelledby={themeLegendId}>
              <legend id={themeLegendId} className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Tema Tampilan
              </legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" role="radiogroup" aria-labelledby={themeLegendId}>
                {(
                  [
                    {
                      value: 'system' as ThemePref,
                      title: 'Ikuti Sistem',
                      desc: `Mengikuti perangkat (Saat ini ${osDark ? 'Gelap' : 'Terang'})`,
                      icon: Monitor,
                    },
                    {
                      value: 'light' as ThemePref,
                      title: 'Terang',
                      desc: 'Kertas hangat editorial dengan kontras tinta gelap',
                      icon: Sun,
                    },
                    {
                      value: 'dark' as ThemePref,
                      title: 'Gelap',
                      desc: 'Nyaman untuk ruang minim cahaya & sesi malam',
                      icon: Moon,
                    },
                  ] as const
                ).map((opt) => {
                  const Icon = opt.icon;
                  const active = prefs.theme === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => {
                        preferences.setTheme(opt.value);
                        triggerPrefFeedback();
                      }}
                      className={`flex flex-col items-start justify-between rounded-xl border p-3.5 text-left transition-all ${
                        active
                          ? 'border-[var(--accent-ink)] bg-[var(--bg-elevated)] ring-1 ring-[var(--accent-ink)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)]/60'
                      }`}
                    >
                      <div className="flex w-full items-center justify-between">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)]">
                          <Icon className="h-4 w-4" />
                        </span>
                        {active && (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-ink)] text-[var(--accent-ink-fg)]">
                            <Check className="h-3 w-3" />
                          </span>
                        )}
                      </div>
                      <p className="mt-3 text-sm font-semibold text-[var(--text-primary)]">{opt.title}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-secondary)]">{opt.desc}</p>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {/* Chat Send Shortcut */}
            <fieldset className="space-y-2.5" aria-labelledby={shortcutLegendId}>
              <legend id={shortcutLegendId} className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Pintasan Kirim Pesan AI
              </legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-labelledby={shortcutLegendId}>
                {[
                  {
                    value: true,
                    title: 'Enter untuk kirim',
                    desc: 'Tekan Enter untuk mengirim pertanyaan; Shift + Enter untuk baris baru.',
                  },
                  {
                    value: false,
                    title: 'Ctrl / Cmd + Enter untuk kirim',
                    desc: 'Tekan Enter untuk baris baru; Ctrl/Cmd + Enter untuk mengirim pertanyaan.',
                  },
                ].map((opt) => {
                  const active = prefs.enterToSend === opt.value;
                  return (
                    <button
                      key={String(opt.value)}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => {
                        preferences.setEnterToSend(opt.value);
                        triggerPrefFeedback();
                      }}
                      className={`flex items-start justify-between gap-3 rounded-xl border p-3.5 text-left transition-all ${
                        active
                          ? 'border-[var(--accent-ink)] bg-[var(--bg-elevated)] ring-1 ring-[var(--accent-ink)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)]/60'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <CornerDownLeft className="h-4 w-4 text-[var(--text-primary)]" />
                          <span className="text-sm font-semibold text-[var(--text-primary)]">{opt.title}</span>
                        </div>
                        <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{opt.desc}</p>
                      </div>
                      {active && (
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-ink)] text-[var(--accent-ink-fg)]">
                          <Check className="h-3 w-3" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {/* Table Density */}
            <fieldset className="space-y-2.5" aria-labelledby={densityLegendId}>
              <legend id={densityLegendId} className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Kepadatan Tabel Data
              </legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-labelledby={densityLegendId}>
                {(
                  [
                    {
                      value: 'comfortable' as TableDensity,
                      title: 'Nyaman',
                      desc: 'Padding sel lebih lega untuk kenyamanan baca.',
                      icon: LayoutGrid,
                    },
                    {
                      value: 'compact' as TableDensity,
                      title: 'Ringkas',
                      desc: 'Baris lebih padat untuk melihat lebih banyak data sekaligus.',
                      icon: List,
                    },
                  ] as const
                ).map((opt) => {
                  const Icon = opt.icon;
                  const active = prefs.tableDensity === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => {
                        preferences.setTableDensity(opt.value);
                        triggerPrefFeedback();
                      }}
                      className={`flex items-start justify-between gap-3 rounded-xl border p-3.5 text-left transition-all ${
                        active
                          ? 'border-[var(--accent-ink)] bg-[var(--bg-elevated)] ring-1 ring-[var(--accent-ink)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)]/60'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 text-[var(--text-primary)]" />
                          <span className="text-sm font-semibold text-[var(--text-primary)]">{opt.title}</span>
                        </div>
                        <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{opt.desc}</p>
                      </div>
                      {active && (
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-ink)] text-[var(--accent-ink-fg)]">
                          <Check className="h-3 w-3" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </section>
        </div>

        {/* 4) Privasi & Data */}
        <div
          ref={(el) => {
            panelRefs.current.privasi = el;
          }}
          role="region"
          aria-label="Privasi & Data"
          hidden={activeSection !== 'privasi' ? ('until-found' as unknown as boolean) : undefined}
          tabIndex={activeSection === 'privasi' ? 0 : undefined}
        >
          <div className="space-y-5">
            {/* Perlindungan Data & Audit */}
            <section className="card space-y-4 p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <div>
                    <h2 className="text-base font-semibold text-[var(--text-primary)]">
                      Perlindungan Data &amp; Audit
                    </h2>
                    <p className="text-xs text-[var(--text-secondary)]">
                      Ringkasan kebijakan privasi dan pencatatan akses data akademik SMKN 4 Bandung.
                    </p>
                  </div>
                </div>
                {health && (
                  <span className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-primary)]">
                    {health.ai_kirim_data ? 'Pemrosesan Terfilter' : 'Pemrosesan Privat'}
                  </span>
                )}
              </div>

              <ul className="space-y-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 text-xs leading-relaxed text-[var(--text-secondary)]">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <span>
                    <strong className="text-[var(--text-primary)]">Audit Aktivitas:</strong> Setiap kueri dan akses data sensitif siswa tercatat otomatis pada log audit sekolah.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <span>
                    <strong className="text-[var(--text-primary)]">Proteksi Identitas Siswa:</strong> Nomor induk (NIS/NISN) dan catatan pelanggaran tidak pernah dikirim ke layanan AI eksternal.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <span>
                    <strong className="text-[var(--text-primary)]">Kontrol Penuh Riwayat:</strong> Seluruh riwayat percakapan bersifat pribadi untuk akun Anda dan dapat dihapus kapan saja.
                  </span>
                </li>
              </ul>
            </section>

            {/* Riwayat Percakapan */}
            <section className="card space-y-4 p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-[var(--text-primary)]" aria-hidden="true" />
                <h3 className="text-base font-semibold text-[var(--text-primary)]">Riwayat Percakapan</h3>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
                  <p className="text-[11px] text-[var(--text-secondary)]">Total Sesi</p>
                  <p className="mt-1 text-xl font-bold text-[var(--text-primary)]">
                    {sessionsLoading ? '…' : chatSessions.length}
                  </p>
                </div>
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
                  <p className="text-[11px] text-[var(--text-secondary)]">Disematkan</p>
                  <p className="mt-1 text-xl font-bold text-[var(--text-primary)]">
                    {sessionsLoading ? '…' : pinnedCount}
                  </p>
                </div>
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
                  <p className="text-[11px] text-[var(--text-secondary)]">Reguler</p>
                  <p className="mt-1 text-xl font-bold text-[var(--text-primary)]">
                    {sessionsLoading ? '…' : unpinnedCount}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/25 bg-rose-500/5 p-4">
                <div className="max-w-md space-y-0.5">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Bersihkan Riwayat Reguler</p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    Menghapus seluruh percakapan reguler secara permanen. Percakapan yang disematkan tetap tersimpan.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={sessionsLoading || unpinnedCount === 0 || clearingChats}
                  onClick={() => setConfirmClearChatsOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Bersihkan Riwayat</span>
                </button>
              </div>

              {privacyMsg && (
                <p
                  className={`rounded-xl border p-2.5 text-sm ${
                    privacyMsg.kind === 'ok'
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                  }`}
                >
                  {privacyMsg.text}
                </p>
              )}
            </section>
          </div>
        </div>
      </div>

      {/* Confirm Dialog: Cabut semua sesi lain */}
      <ConfirmDialog
        open={confirmRevokeOpen}
        title="Keluar dari Semua Perangkat Lain?"
        description="Seluruh sesi login aktif Anda di peramban atau perangkat lain akan segera dicabut. Sesi Anda di perangkat ini tetap aktif."
        confirmLabel="Cabut Sesi Lain"
        cancelLabel="Batal"
        busy={revokingOther}
        onCancel={() => {
          if (!revokingOther) setConfirmRevokeOpen(false);
        }}
        onConfirm={revokeOtherSessions}
      />

      {/* Confirm Dialog: Hapus semua percakapan selain disematkan */}
      <ConfirmDialog
        open={confirmClearChatsOpen}
        title="Hapus Semua Percakapan?"
        description={`Tindakan ini akan menghapus ${unpinnedCount} percakapan yang tidak disematkan secara permanen. ${pinnedCount} percakapan yang disematkan tidak akan terhapus.`}
        confirmLabel="Ya, Hapus Semua"
        cancelLabel="Batal"
        destructive
        busy={clearingChats}
        onCancel={() => {
          if (!clearingChats) setConfirmClearChatsOpen(false);
        }}
        onConfirm={clearUnpinnedChats}
      />
    </div>
  );
}

export default function AkunPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-3xl p-4 text-sm text-[var(--text-secondary)]">
          Memuat pengaturan akun…
        </div>
      }
    >
      <AkunPageContent />
    </Suspense>
  );
}

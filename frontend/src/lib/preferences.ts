export type ThemePref = 'system' | 'light' | 'dark';
export type TableDensity = 'comfortable' | 'compact';
export type UserPreferences = {
  theme: ThemePref;
  enterToSend: boolean;
  tableDensity: TableDensity;
};

const KEY_THEME = 'sis_color_scheme';
const KEY_ENTER = 'sis_enter_to_send';
const KEY_DENSITY = 'sis_table_density';
const EVENT_NAME = 'sis-prefs-changed';

const DEFAULT_PREFS: UserPreferences = {
  theme: 'system',
  enterToSend: true,
  tableDensity: 'comfortable',
};

function readPrefs(): UserPreferences {
  if (typeof window === 'undefined') return { ...DEFAULT_PREFS };
  let theme: ThemePref = 'system';
  let enterToSend = true;
  let tableDensity: TableDensity = 'comfortable';

  try {
    const rawTheme = window.localStorage.getItem(KEY_THEME);
    if (rawTheme === 'light' || rawTheme === 'dark') {
      theme = rawTheme;
    }
    const rawEnter = window.localStorage.getItem(KEY_ENTER);
    if (rawEnter === 'false' || rawEnter === '0') {
      enterToSend = false;
    } else if (rawEnter === 'true' || rawEnter === '1') {
      enterToSend = true;
    }
    const rawDensity = window.localStorage.getItem(KEY_DENSITY);
    if (rawDensity === 'compact') {
      tableDensity = 'compact';
    }
  } catch {
    /* abaikan bila akses storage diblokir */
  }

  return { theme, enterToSend, tableDensity };
}

function resolveTheme(theme: ThemePref): 'light' | 'dark' {
  if (theme === 'light' || theme === 'dark') return theme;
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

function applyToDom(p: UserPreferences): void {
  if (typeof document === 'undefined') return;
  let meta = document.querySelector('meta[name="color-scheme"]') as HTMLMetaElement | null;
  if (!meta && document.head) {
    meta = document.createElement('meta');
    meta.name = 'color-scheme';
    document.head.appendChild(meta);
  }
  if (meta) {
    meta.content = p.theme === 'system' ? 'light dark' : p.theme;
  }
  document.documentElement.dataset.theme = resolveTheme(p.theme);
  document.documentElement.dataset.density = p.tableDensity;
}

function emitChange(next: UserPreferences): void {
  applyToDom(next);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<UserPreferences>(EVENT_NAME, { detail: next }));
  }
}

export const preferences = {
  get(): UserPreferences {
    return readPrefs();
  },

  setTheme(t: ThemePref): void {
    if (typeof window === 'undefined') return;
    try {
      if (t === 'system') {
        window.localStorage.removeItem(KEY_THEME);
      } else {
        window.localStorage.setItem(KEY_THEME, t);
      }
    } catch {
      /* tetap terapkan di DOM walaupun localStorage diblokir */
    }
    const next: UserPreferences = { ...readPrefs(), theme: t };
    emitChange(next);
  },

  setEnterToSend(v: boolean): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(KEY_ENTER, v ? 'true' : 'false');
    } catch {
      /* abaikan */
    }
    const next: UserPreferences = { ...readPrefs(), enterToSend: v };
    emitChange(next);
  },

  setTableDensity(d: TableDensity): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(KEY_DENSITY, d);
    } catch {
      /* abaikan */
    }
    const next: UserPreferences = { ...readPrefs(), tableDensity: d };
    emitChange(next);
  },

  applyToDom,

  subscribe(cb: (p: UserPreferences) => void): () => void {
    if (typeof window === 'undefined') return () => {};

    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent<UserPreferences>).detail;
      cb(detail ?? readPrefs());
    };

    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === KEY_THEME || e.key === KEY_ENTER || e.key === KEY_DENSITY) {
        const next = readPrefs();
        applyToDom(next);
        cb(next);
      }
    };

    const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    const onMediaChange = () => {
      const cur = readPrefs();
      if (cur.theme === 'system') {
        applyToDom(cur);
        cb(cur);
      }
    };

    window.addEventListener(EVENT_NAME, onCustom);
    window.addEventListener('storage', onStorage);
    if (mq) {
      if (mq.addEventListener) mq.addEventListener('change', onMediaChange);
      else if (mq.addListener) mq.addListener(onMediaChange);
    }

    return () => {
      window.removeEventListener(EVENT_NAME, onCustom);
      window.removeEventListener('storage', onStorage);
      if (mq) {
        if (mq.removeEventListener) mq.removeEventListener('change', onMediaChange);
        else if (mq.removeListener) mq.removeListener(onMediaChange);
      }
    };
  },
};

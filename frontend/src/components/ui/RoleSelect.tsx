'use client';

import {
  KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { Role, ROLE_LABELS } from '@/lib/api';

export type RoleMeta = {
  value: Role;
  label: string;
  description: string;
  dotClass: string;
  pillActiveClass: string;
};

export const ROLE_META: Record<Role, RoleMeta> = {
  teacher: {
    value: 'teacher',
    label: ROLE_LABELS.teacher,
    description: 'Akses akademik, jadwal, & chat AI (tanpa pelanggaran)',
    dotClass: 'bg-sky-500',
    pillActiveClass: 'border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-200',
  },
  bk: {
    value: 'bk',
    label: ROLE_LABELS.bk,
    description: 'Akses data siswa, pelanggaran, & pembinaan',
    dotClass: 'bg-emerald-500',
    pillActiveClass: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
  },
  kepala_sekolah: {
    value: 'kepala_sekolah',
    label: ROLE_LABELS.kepala_sekolah,
    description: 'Akses penuh laporan akademik, PKL, & pelanggaran',
    dotClass: 'bg-amber-500',
    pillActiveClass: 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200',
  },
  admin: {
    value: 'admin',
    label: ROLE_LABELS.admin,
    description: 'Kontrol penuh akun, audit log, & Knowledge Graph',
    dotClass: 'bg-violet-500',
    pillActiveClass: 'border-violet-500/40 bg-violet-500/10 text-violet-800 dark:text-violet-200',
  },
};

export const ROLE_OPTIONS: RoleMeta[] = [
  ROLE_META.teacher,
  ROLE_META.bk,
  ROLE_META.kepala_sekolah,
  ROLE_META.admin,
];

type PopoverCoords = {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
};

export default function RoleSelect({
  id,
  name,
  value,
  onChange,
  disabled = false,
  size = 'md',
  ariaLabel,
  ariaLabelledBy,
  className = '',
}: {
  id?: string;
  name?: string;
  value: Role;
  onChange: (role: Role) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  ariaLabel?: string;
  ariaLabelledBy?: string;
  className?: string;
}) {
  const generatedId = useId();
  const buttonId = id || `${generatedId}-btn`;
  const listboxId = `${generatedId}-listbox`;

  const triggerRef = useRef<HTMLButtonElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);

  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(0, ROLE_OPTIONS.findIndex((r) => r.value === value))
  );
  const [coords, setCoords] = useState<PopoverCoords | null>(null);

  const currentMeta = ROLE_META[value] ?? ROLE_META.teacher;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (disabled && open) {
      setOpen(false);
    }
  }, [disabled, open]);

  const updateCoords = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const estimatedHeight = Math.max(330, ROLE_OPTIONS.length * 76 + 16);
    const spaceBelow = vh - rect.bottom - 10;
    const spaceAbove = rect.top - 10;
    const dropUp = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;
    const availableSpace = (dropUp ? spaceAbove : spaceBelow) - 12;
    const maxHeight = Math.max(160, availableSpace);
    const width = Math.min(Math.max(rect.width, 290), vw - 24);
    const left = Math.min(Math.max(12, rect.left), Math.max(12, vw - width - 12));

    setCoords({
      left,
      width,
      top: dropUp ? undefined : rect.bottom + 6,
      bottom: dropUp ? vh - rect.top + 6 : undefined,
      maxHeight,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updateCoords();
    const idx = ROLE_OPTIONS.findIndex((r) => r.value === value);
    setActiveIndex(idx >= 0 ? idx : 0);
    const raf = requestAnimationFrame(() => {
      listboxRef.current?.focus({ preventScroll: true });
    });

    const onResize = () => updateCoords();
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && portalRef.current?.contains(e.target)) {
        return;
      }
      setOpen(false);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, updateCoords, value]);

  useEffect(() => {
    if (!open) return;
    const isInside = (target: EventTarget | null) =>
      target instanceof Node &&
      Boolean(triggerRef.current?.contains(target) || portalRef.current?.contains(target));

    const onPointerDown = (e: PointerEvent) => {
      if (!isInside(e.target)) setOpen(false);
    };
    const onFocusIn = (e: FocusEvent) => {
      if (!isInside(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [open]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const list = listboxRef.current;
    const item = optionRefs.current[activeIndex];
    if (!list || !item) return;
    const itemTop = item.offsetTop;
    const itemBottom = itemTop + item.offsetHeight;
    if (itemTop < list.scrollTop) {
      list.scrollTop = itemTop;
    } else if (itemBottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = itemBottom - list.clientHeight;
    }
  }, [open, activeIndex]);

  const closeAndFocusTrigger = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => {
      triggerRef.current?.focus();
    });
  }, []);

  const selectRole = useCallback(
    (nextRole: Role) => {
      if (nextRole !== value) {
        onChange(nextRole);
      }
      closeAndFocusTrigger();
    },
    [onChange, value, closeAndFocusTrigger]
  );

  const handleTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
    }
  };

  const handleListKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % ROLE_OPTIONS.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + ROLE_OPTIONS.length) % ROLE_OPTIONS.length);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      setActiveIndex(ROLE_OPTIONS.length - 1);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const opt = ROLE_OPTIONS[activeIndex];
      if (opt) selectRole(opt.value);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeAndFocusTrigger();
      return;
    }
    if (e.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const ch = e.key.toLowerCase();
      for (let offset = 1; offset <= ROLE_OPTIONS.length; offset += 1) {
        const idx = (activeIndex + offset) % ROLE_OPTIONS.length;
        if (ROLE_OPTIONS[idx].label.toLowerCase().startsWith(ch)) {
          setActiveIndex(idx);
          break;
        }
      }
    }
  };

  const sizeClasses =
    size === 'sm'
      ? 'min-h-[30px] gap-2 rounded-lg px-2.5 py-1 text-xs font-medium'
      : 'w-full justify-between gap-2 rounded-lg px-3 py-2 text-sm';

  return (
    <div className={`relative ${size === 'sm' ? 'inline-block' : 'w-full'} ${className}`}>
      {name && <input type="hidden" name={name} value={value} />}

      <button
        ref={triggerRef}
        id={buttonId}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        onClick={() => {
          if (!disabled) setOpen((prev) => !prev);
        }}
        onKeyDown={handleTriggerKeyDown}
        className={`inline-flex items-center border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-left text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-elevated)]/60 focus-visible:border-[var(--accent-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ink)]/20 disabled:cursor-not-allowed disabled:opacity-50 ${sizeClasses}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={`h-2 w-2 shrink-0 rounded-full ${currentMeta.dotClass}`}
          />
          <span className="truncate">{currentMeta.label}</span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-transform duration-150 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open &&
        mounted &&
        coords &&
        createPortal(
          <div
            ref={portalRef}
            style={{
              position: 'fixed',
              left: coords.left,
              width: coords.width,
              top: coords.top,
              bottom: coords.bottom,
              zIndex: 60,
            }}
            className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1.5 shadow-xl"
          >
            <ul
              ref={listboxRef}
              id={listboxId}
              role="listbox"
              tabIndex={-1}
              aria-label={ariaLabel || 'Pilih peran akun'}
              aria-activedescendant={`${generatedId}-role-${activeIndex}`}
              onKeyDown={handleListKeyDown}
              style={{ maxHeight: coords.maxHeight }}
              className="space-y-0.5 overflow-y-auto focus:outline-none"
            >
              {ROLE_OPTIONS.map((opt, idx) => {
                const isSelected = opt.value === value;
                const isActive = idx === activeIndex;
                return (
                  <li
                    key={opt.value}
                    ref={(el) => {
                      optionRefs.current[idx] = el;
                    }}
                    id={`${generatedId}-role-${idx}`}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => selectRole(opt.value)}
                    className={`flex cursor-pointer items-start justify-between gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${
                      isActive
                        ? 'bg-[var(--bg-elevated)]'
                        : 'hover:bg-[var(--bg-elevated)]/70'
                    }`}
                  >
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span
                        aria-hidden="true"
                        className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${opt.dotClass}`}
                      />
                      <div className="min-w-0">
                        <p
                          className={`text-sm leading-tight text-[var(--text-primary)] ${
                            isSelected ? 'font-semibold' : 'font-medium'
                          }`}
                        >
                          {opt.label}
                        </p>
                        <p className="mt-0.5 text-xs leading-snug text-[var(--text-secondary)]">
                          {opt.description}
                        </p>
                      </div>
                    </div>
                    {isSelected && (
                      <Check
                        aria-hidden="true"
                        className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-ink)]"
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body
        )}
    </div>
  );
}

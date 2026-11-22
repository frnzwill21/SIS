'use client';

import {
  KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Loader2, Search, X } from 'lucide-react';

export type ComboboxOption = {
  value: string;
  label: string;
  sublabel?: string;
};

type MenuCoords = {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
  dropUp: boolean;
};

export default function Combobox({
  id,
  name,
  options,
  value,
  onChange,
  placeholder = 'Cari atau pilih…',
  emptyText = 'Belum ada data pilihan.',
  noMatchText = 'Tidak ada pilihan yang cocok.',
  clearLabel = 'Hapus pilihan',
  disabled = false,
  loading = false,
  ariaLabel,
  ariaDescribedBy,
  title,
  className = '',
}: {
  id?: string;
  name?: string;
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
  noMatchText?: string;
  clearLabel?: string;
  disabled?: boolean;
  loading?: boolean;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  title?: string;
  className?: string;
}) {
  const generatedId = useId();
  const inputId = id || `${generatedId}-input`;
  const listboxId = `${generatedId}-listbox`;

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);
  const selectAllOnMouseUpRef = useRef(false);

  const selectedOption = useMemo(
    () => options.find((opt) => opt.value === value) ?? null,
    [options, value]
  );

  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [hasTyped, setHasTyped] = useState(false);
  const [query, setQuery] = useState(selectedOption?.label ?? '');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [coords, setCoords] = useState<MenuCoords | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery(selectedOption?.label ?? '');
      setHasTyped(false);
    }
  }, [selectedOption, open]);

  useEffect(() => {
    if (disabled && open) {
      setOpen(false);
      setHasTyped(false);
      setQuery(selectedOption?.label ?? '');
    }
  }, [disabled, open, selectedOption]);

  const filteredOptions = useMemo(() => {
    if (!hasTyped) return options;
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        (opt.sublabel ? opt.sublabel.toLowerCase().includes(q) : false)
    );
  }, [options, hasTyped, query]);

  const updateCoords = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const spaceBelow = vh - rect.bottom - 10;
    const spaceAbove = rect.top - 10;
    const dropUp = spaceBelow < 220 && spaceAbove > spaceBelow;
    const available = dropUp ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(132, Math.min(268, available - 4));
    const desiredWidth = Math.min(Math.max(rect.width, 260), vw - 24);
    const left = Math.min(Math.max(12, rect.left), Math.max(12, vw - desiredWidth - 12));

    setCoords({
      left,
      width: desiredWidth,
      top: dropUp ? undefined : rect.bottom + 6,
      bottom: dropUp ? vh - rect.top + 6 : undefined,
      maxHeight,
      dropUp,
    });
  }, []);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setHasTyped(false);
    setQuery(selectedOption?.label ?? '');
  }, [selectedOption]);

  useLayoutEffect(() => {
    if (!open) return;
    updateCoords();
    const onResize = () => updateCoords();
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && portalRef.current?.contains(e.target)) {
        return;
      }
      closeMenu();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, updateCoords, closeMenu, filteredOptions.length]);

  useEffect(() => {
    if (!open) return;
    const isInside = (target: EventTarget | null) =>
      target instanceof Node &&
      Boolean(containerRef.current?.contains(target) || portalRef.current?.contains(target));

    const onPointerDown = (e: PointerEvent) => {
      if (!isInside(e.target)) closeMenu();
    };
    const onFocusIn = (e: FocusEvent) => {
      if (!isInside(e.target)) closeMenu();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [open, closeMenu]);

  useEffect(() => {
    if (!open) {
      setActiveIndex(-1);
      return;
    }
    if (filteredOptions.length === 0) {
      setActiveIndex(-1);
      return;
    }
    const selIdx = value ? filteredOptions.findIndex((opt) => opt.value === value) : -1;
    setActiveIndex(selIdx >= 0 ? selIdx : 0);
  }, [open, filteredOptions, value]);

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

  const commitOption = useCallback(
    (opt: ComboboxOption) => {
      onChange(opt.value);
      setQuery(opt.label);
      setHasTyped(false);
      setOpen(false);
      inputRef.current?.focus();
    },
    [onChange]
  );

  const handleClear = () => {
    if (disabled) return;
    onChange('');
    setQuery('');
    setHasTyped(false);
    setOpen(true);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (filteredOptions.length === 0) return;
      setActiveIndex((prev) => (prev < filteredOptions.length - 1 ? prev + 1 : 0));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (filteredOptions.length === 0) return;
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : filteredOptions.length - 1));
      return;
    }

    if (e.key === 'Enter') {
      if (open && activeIndex >= 0 && filteredOptions[activeIndex]) {
        e.preventDefault();
        commitOption(filteredOptions[activeIndex]);
      }
      return;
    }

    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setHasTyped(false);
        setQuery(selectedOption?.label ?? '');
      }
      return;
    }

    if (e.key === 'Tab' && open) {
      setOpen(false);
      setHasTyped(false);
      setQuery(selectedOption?.label ?? '');
    }
  };

  const showClear = !disabled && (Boolean(value) || query.length > 0);
  const activeOptionId =
    open && activeIndex >= 0 && filteredOptions[activeIndex]
      ? `${generatedId}-opt-${activeIndex}`
      : undefined;

  return (
    <div ref={containerRef} className={`relative ${className}`} title={title}>
      {name && <input type="hidden" name={name} value={value} />}

      <div className="relative flex items-center">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
        />
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={activeOptionId}
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
          disabled={disabled}
          value={query}
          placeholder={loading && options.length === 0 ? 'Memuat daftar…' : placeholder}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          onFocus={() => {
            if (selectedOption && !hasTyped) {
              selectAllOnMouseUpRef.current = true;
            }
          }}
          onMouseUp={() => {
            if (selectAllOnMouseUpRef.current && inputRef.current) {
              selectAllOnMouseUpRef.current = false;
              const el = inputRef.current;
              if (el.selectionStart === el.selectionEnd) {
                el.select();
              }
            }
          }}
          onClick={() => {
            if (!disabled && !open) {
              setOpen(true);
            }
          }}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            setHasTyped(true);
            if (!open) setOpen(true);
            if (next === '' && value !== '') {
              onChange('');
            }
          }}
          onKeyDown={handleKeyDown}
          className={`input pl-9 ${showClear ? 'pr-16' : 'pr-9'} disabled:cursor-not-allowed disabled:opacity-50`}
        />

        <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
          {showClear && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleClear}
              aria-label={clearLabel}
              title={clearLabel}
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (disabled) return;
              setOpen((prev) => !prev);
              inputRef.current?.focus();
            }}
            aria-label={open ? 'Tutup daftar pilihan' : 'Buka daftar pilihan'}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:pointer-events-none"
          >
            {loading && options.length === 0 ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ChevronDown
                className={`h-4 w-4 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
              />
            )}
          </button>
        </div>
      </div>

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
            className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xl"
          >
            <ul
              ref={listboxRef}
              id={listboxId}
              role="listbox"
              aria-label={ariaLabel || placeholder}
              style={{ maxHeight: coords.maxHeight }}
              className="overflow-y-auto p-1.5 text-sm"
            >
              {options.length === 0 ? (
                <li className="px-3 py-4 text-center text-xs text-[var(--text-secondary)]">
                  {loading ? 'Memuat daftar…' : emptyText}
                </li>
              ) : filteredOptions.length === 0 ? (
                <li className="px-3 py-4 text-center text-xs text-[var(--text-secondary)]">
                  {noMatchText}
                </li>
              ) : (
                filteredOptions.map((opt, idx) => {
                  const isSelected = opt.value === value;
                  const isActive = idx === activeIndex;
                  return (
                    <li
                      key={opt.value}
                      ref={(el) => {
                        optionRefs.current[idx] = el;
                      }}
                      id={`${generatedId}-opt-${idx}`}
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => commitOption(opt)}
                      className={`flex cursor-pointer items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${
                        isActive
                          ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                          : 'text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]/70'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-sm ${isSelected ? 'font-semibold' : 'font-medium'}`}>
                          {opt.label}
                        </p>
                        {opt.sublabel && (
                          <p className="truncate font-mono text-[11px] tabular-nums text-[var(--text-secondary)]">
                            {opt.sublabel}
                          </p>
                        )}
                      </div>
                      {isSelected && (
                        <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
                      )}
                    </li>
                  );
                })
              )}
            </ul>
            {options.length > 0 && (
              <div className="flex items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 px-3 py-1.5 text-[11px] text-[var(--text-secondary)]">
                <span className="tabular-nums">
                  {filteredOptions.length} dari {options.length} pilihan
                </span>
                <span>↑↓ pilih · Enter konfirmasi</span>
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}

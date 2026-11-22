'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import KineticConstellation from '@/components/chat/KineticConstellation';

const MIN_DISPLAY_MS = 220;
const SAFETY_TIMEOUT_MS = 4000;

function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith('/')) {
    return path.slice(0, -1);
  }
  return path;
}

/**
 * Indikator transisi laman ringan di atas area `<main>` saja (tidak menutupi sidebar/header),
 * aktif saat navigasi antar-rute `(app)` dan otomatis menghilang setelah pathname menetap.
 */
export default function RouteTransitionLoader() {
  const pathname = usePathname();
  const prefersReducedHook = useReducedMotion();
  const prefersReduced = Boolean(prefersReducedHook);

  const [visible, setVisible] = useState(false);

  const currentPathRef = useRef(normalizePath(pathname || ''));
  const prevPathRef = useRef(normalizePath(pathname || ''));
  const startedAtRef = useRef(0);
  const dismissTimerRef = useRef<number | null>(null);
  const safetyTimerRef = useRef<number | null>(null);
  const prefersReducedRef = useRef(prefersReduced);

  prefersReducedRef.current = prefersReduced;
  currentPathRef.current = normalizePath(pathname || '');

  const clearTimers = useCallback(() => {
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    if (safetyTimerRef.current !== null) {
      window.clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (prefersReduced) {
      clearTimers();
      setVisible(false);
    }
  }, [prefersReduced, clearTimers]);

  useEffect(() => {
    const normalized = normalizePath(pathname || '');
    if (normalized === prevPathRef.current) return;
    prevPathRef.current = normalized;

    if (!visible) return;

    if (safetyTimerRef.current !== null) {
      window.clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }

    const elapsed = performance.now() - startedAtRef.current;
    const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);

    dismissTimerRef.current = window.setTimeout(() => {
      dismissTimerRef.current = null;
      setVisible(false);
    }, remaining);
  }, [pathname, visible]);

  useEffect(() => {
    const onDocumentClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const reducedNow =
        prefersReducedRef.current ||
        Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
      if (reducedNow) return;

      const target = e.target as Element | null;
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.hasAttribute('download')) return;
      if (anchor.target && anchor.target !== '_self') return;

      const rawHref = anchor.getAttribute('href');
      if (!rawHref || rawHref.startsWith('#')) return;

      let parsed: URL;
      try {
        parsed = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }

      if (parsed.origin !== window.location.origin) return;
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;

      const nextPath = normalizePath(parsed.pathname);
      if (!nextPath.startsWith('/') || nextPath.startsWith('/login')) return;
      if (nextPath === currentPathRef.current) return;

      clearTimers();
      startedAtRef.current = performance.now();
      setVisible(true);

      safetyTimerRef.current = window.setTimeout(() => {
        safetyTimerRef.current = null;
        setVisible(false);
      }, SAFETY_TIMEOUT_MS);
    };

    document.addEventListener('click', onDocumentClick, true);
    return () => {
      document.removeEventListener('click', onDocumentClick, true);
      clearTimers();
    };
  }, [clearTimers]);

  if (prefersReduced) return null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="sis-route-transition-loader"
          role="status"
          aria-live="polite"
          aria-label="Memuat laman"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14, ease: 'easeOut' }}
          className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center bg-[var(--bg-canvas)]/70 backdrop-blur-[2px] select-none"
        >
          <div className="absolute inset-x-0 top-0 h-[2px] overflow-hidden bg-[var(--border-subtle)]/50">
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: '100%' }}
              transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut' }}
              className="h-full w-1/2 bg-[var(--accent-ink)]/75"
            />
          </div>

          <div className="inline-flex items-center gap-2.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/95 px-4 py-2.5 shadow-sm backdrop-blur-md">
            <KineticConstellation mode="loader" size="sm" />
            <span className="text-xs font-medium tracking-tight text-[var(--text-secondary)]">
              Memuat laman...
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

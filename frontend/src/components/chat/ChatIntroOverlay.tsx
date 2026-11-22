'use client';

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import KineticConstellation from '@/components/chat/KineticConstellation';

const LOGIN_INTRO_KEY = 'sis_just_logged_in';
const EXIT_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * Overlay transisi singkat setelah login pertama ke ruang /chat.
 * Otomatis melewati animasi bila pengguna memilih prefers-reduced-motion,
 * dan langsung menghapus penanda sessionStorage agar tidak terulang saat muat ulang.
 */
export default function ChatIntroOverlay() {
  const prefersReducedHook = useReducedMotion();
  const [visible, setVisible] = useState(false);

  const dismiss = useCallback(() => {
    setVisible(false);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let shouldShow = false;
    try {
      shouldShow = sessionStorage.getItem(LOGIN_INTRO_KEY) === '1';
      if (shouldShow) {
        sessionStorage.removeItem(LOGIN_INTRO_KEY);
      }
    } catch {
      shouldShow = false;
    }

    if (!shouldShow) return;

    const prefersReduced =
      Boolean(prefersReducedHook) ||
      Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

    if (prefersReduced) {
      return;
    }

    setVisible(true);
  }, [prefersReducedHook]);

  useEffect(() => {
    if (!visible) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dismiss();
      }
    };

    // Pengaman batas maksimum agar overlay tidak pernah tertahan bila tab di latar belakang
    const safetyTimer = window.setTimeout(dismiss, 2100);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.clearTimeout(safetyTimer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [visible, dismiss]);

  const handleIntroComplete = useCallback(() => {
    window.setTimeout(dismiss, 180);
  }, [dismiss]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="sis-chat-intro-overlay"
          role="presentation"
          aria-label="Memasuki ruang asisten sekolah"
          onClick={dismiss}
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 0.975 }}
          transition={{ duration: 0.36, ease: EXIT_EASE }}
          className="absolute inset-0 z-30 flex cursor-pointer flex-col items-center justify-center bg-[var(--bg-canvas)]/95 px-6 backdrop-blur-md select-none"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96, y: -6 }}
            transition={{ duration: 0.32, ease: EXIT_EASE }}
            className="flex flex-col items-center text-center"
          >
            <KineticConstellation
              mode="intro"
              size="xl"
              onIntroComplete={handleIntroComplete}
            />

            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.56, duration: 0.38, ease: EXIT_EASE }}
              className="mt-6 text-xs font-semibold tracking-[0.22em] text-[var(--text-primary)] uppercase"
            >
              SIS SMKN 4 Bandung
            </motion.p>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.85, duration: 0.35 }}
              className="mt-2 text-[11px] text-[var(--text-muted)]"
            >
              Klik di mana saja atau tekan Esc untuk melewati
            </motion.p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

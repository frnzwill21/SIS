'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { motion, useReducedMotion } from 'motion/react';

export default function AppTemplate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const prefersReduced = Boolean(useReducedMotion());
  const isChatRoute = pathname === '/chat' || Boolean(pathname?.startsWith('/chat/'));

  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={prefersReduced ? { duration: 0 } : { duration: 0.18, ease: 'easeOut' }}
      className={isChatRoute ? 'flex h-full min-h-0 flex-1 flex-col' : 'min-h-full'}
    >
      {children}
    </motion.div>
  );
}

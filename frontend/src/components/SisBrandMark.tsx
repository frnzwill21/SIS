'use client';

type BrandSize = 'sm' | 'md' | 'lg';

const CONTAINER_CLASSES: Record<BrandSize, string> = {
  sm: 'h-8 w-8 rounded-lg',
  md: 'h-10 w-10 rounded-xl',
  lg: 'h-12 w-12 rounded-2xl',
};

const SVG_CLASSES: Record<BrandSize, string> = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
};

/**
 * Emblem geometris monokrom 4-Node Connected Nexus:
 * merepresentasikan SMKN 4 Bandung + graf kecerdasan SIS.
 */
export default function SisBrandMark({
  size = 'md',
  thinking = false,
  className = '',
}: {
  size?: BrandSize;
  thinking?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center bg-[var(--accent-ink)] text-[var(--accent-ink-fg)] ring-1 ring-black/10 dark:ring-white/15 ${CONTAINER_CLASSES[size]} ${className}`}
    >
      <svg
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={SVG_CLASSES[size]}
      >
        {/* Sisi graf membentuk angka 4 dan nexus pengetahuan */}
        <path
          d="M19.5 6.5L7.5 18.5H24.5M19.5 6.5V25.5M19.5 6.5L24.5 18.5M19.5 25.5L24.5 18.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeOpacity="0.88"
        />

        {/* 4 simpul utama */}
        <circle
          cx="19.5"
          cy="6.5"
          r="2.6"
          fill="currentColor"
          className={thinking ? 'sis-node-pulse' : undefined}
          style={thinking ? { animationDelay: '0ms' } : undefined}
        />
        <circle
          cx="7.5"
          cy="18.5"
          r="2.4"
          fill="currentColor"
          className={thinking ? 'sis-node-pulse' : undefined}
          style={thinking ? { animationDelay: '220ms' } : undefined}
        />
        <circle
          cx="24.5"
          cy="18.5"
          r="2.4"
          fill="currentColor"
          className={thinking ? 'sis-node-pulse' : undefined}
          style={thinking ? { animationDelay: '440ms' } : undefined}
        />
        <circle
          cx="19.5"
          cy="25.5"
          r="2.5"
          fill="currentColor"
          className={thinking ? 'sis-node-pulse' : undefined}
          style={thinking ? { animationDelay: '660ms' } : undefined}
        />
      </svg>
    </span>
  );
}

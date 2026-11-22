'use client';

import { useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';

export type ConstellationState =
  | 'idle'
  | 'thinking'
  | 'answering'
  | 'sql'
  | 'clarify'
  | 'done'
  | 'error';
export type ConstellationSize = 'sm' | 'md' | 'lg' | 'xl' | 'hero';
export type ConstellationMode =
  | 'standard'
  | 'idle'
  | 'thinking'
  | 'answering'
  | 'intro'
  | 'loader';

const SIZE_CLASSES: Record<ConstellationSize, string> = {
  sm: 'h-7 w-7',
  md: 'h-10 w-10',
  lg: 'h-14 w-14',
  xl: 'h-24 w-24 sm:h-28 sm:w-28',
  hero: 'h-24 w-24 sm:h-28 sm:w-28',
};

const STATE_COLORS: Record<ConstellationState, string> = {
  idle: 'text-[var(--accent-ink)]',
  thinking: 'text-[var(--accent-ink)]',
  answering: 'text-[var(--accent-ink)]',
  sql: 'text-emerald-600 dark:text-emerald-400',
  clarify: 'text-amber-600 dark:text-amber-400',
  done: 'text-[var(--accent-ink)]',
  error: 'text-rose-600 dark:text-rose-400',
};

// Empat simpul presisi membentuk angka 4 (SMKN 4 Bandung) dalam viewBox 48x48
const VERTICES = [
  { id: 'v0', cx: 29, cy: 10.5, r: 2.45, introDelay: 0.0 },
  { id: 'v1', cx: 13, cy: 25.5, r: 2.15, introDelay: 0.09 },
  { id: 'v2', cx: 35, cy: 25.5, r: 2.15, introDelay: 0.18 },
  { id: 'v3', cx: 29, cy: 37.5, r: 2.35, introDelay: 0.27 },
] as const;

// Sisi utama angka 4
const PRIMARY_EDGES = [
  { id: 'diagonal', d: 'M29 10.5 L13 25.5', introDelay: 0.3, introDuration: 0.24 },
  { id: 'crossbar', d: 'M13 25.5 L35 25.5', introDelay: 0.5, introDuration: 0.22 },
  { id: 'spine', d: 'M29 10.5 L29 37.5', introDelay: 0.68, introDuration: 0.22 },
] as const;

// Faset arsitektural sekunder (aksen struktural rendah opasitas)
const FACET_EDGES = [
  { id: 'facet-upper', d: 'M29 10.5 L35 25.5' },
  { id: 'facet-lower', d: 'M35 25.5 L29 37.5' },
] as const;

// 4 tanda presisi kompas pada orbit luar (N, E, S, W)
const ORBIT_TICKS = [
  { x1: 24, y1: 1.8, x2: 24, y2: 4.1 },
  { x1: 46.2, y1: 24, x2: 43.9, y2: 24 },
  { x1: 24, y1: 46.2, x2: 24, y2: 43.9 },
  { x1: 1.8, y1: 24, x2: 4.1, y2: 24 },
] as const;

const STUDIO_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const CENTER_ORIGIN = { transformBox: 'view-box' as const, transformOrigin: '24px 24px' };
const FILL_ORIGIN = { transformBox: 'fill-box' as const, transformOrigin: 'center' };

const LOADER_CYCLE_S = 0.95;
const LOADER_STROKE_KEYFRAMES = [
  {
    times: [0, 0.03, 0.28, 0.72, 0.92, 1],
    pathLength: [0, 0, 1, 1, 1, 0],
    opacity: [0, 0.92, 1, 0.85, 0, 0],
  },
  {
    times: [0, 0.22, 0.48, 0.76, 0.95, 1],
    pathLength: [0, 0, 1, 1, 1, 0],
    opacity: [0, 0.92, 1, 0.85, 0, 0],
  },
  {
    times: [0, 0.44, 0.7, 0.82, 0.98, 1],
    pathLength: [0, 0, 1, 1, 1, 0],
    opacity: [0, 0.92, 1, 0.85, 0, 0],
  },
] as const;

const LOADER_NODE_KEYFRAMES = [
  {
    times: [0, 0.08, 0.22, 0.4, 1],
    scale: [1, 1.24, 1.06, 1, 1],
    opacity: [0.48, 1, 0.8, 0.48, 0.48],
  },
  {
    times: [0, 0.24, 0.38, 0.56, 1],
    scale: [1, 1.24, 1.06, 1, 1],
    opacity: [0.48, 1, 0.8, 0.48, 0.48],
  },
  {
    times: [0, 0.44, 0.58, 0.76, 1],
    scale: [1, 1.24, 1.06, 1, 1],
    opacity: [0.48, 1, 0.8, 0.48, 0.48],
  },
  {
    times: [0, 0.64, 0.78, 0.94, 1],
    scale: [1, 1.24, 1.06, 1, 1],
    opacity: [0.48, 1, 0.8, 0.48, 0.48],
  },
] as const;

const MODE_STATE_MAP: Partial<Record<ConstellationMode, ConstellationState>> = {
  idle: 'idle',
  thinking: 'thinking',
  answering: 'answering',
};

function LoaderConstellation({
  animate,
  size,
  className,
}: {
  animate: boolean;
  size: ConstellationSize;
  className: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-constellation-state="loader"
      data-constellation-mode="loader"
      className={`relative inline-flex shrink-0 items-center justify-center select-none ${SIZE_CLASSES[size]} text-[var(--accent-ink)] ${className}`}
    >
      <svg
        viewBox="7 6 34 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-full w-full overflow-visible"
      >
        {PRIMARY_EDGES.map((edge, idx) => {
          const kf = LOADER_STROKE_KEYFRAMES[idx];
          return (
            <g key={edge.id}>
              <path
                d={edge.d}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="miter"
                strokeOpacity={animate ? 0.22 : 0.88}
              />
              {animate && (
                <motion.path
                  d={edge.d}
                  stroke="currentColor"
                  strokeWidth="2.35"
                  strokeLinecap="round"
                  strokeLinejoin="miter"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{
                    pathLength: [...kf.pathLength],
                    opacity: [...kf.opacity],
                  }}
                  transition={{
                    duration: LOADER_CYCLE_S,
                    times: [...kf.times],
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                />
              )}
            </g>
          );
        })}

        {VERTICES.map((v, idx) => {
          const nkf = LOADER_NODE_KEYFRAMES[idx];
          return animate ? (
            <motion.circle
              key={v.id}
              cx={v.cx}
              cy={v.cy}
              r={v.r}
              fill="currentColor"
              style={FILL_ORIGIN}
              animate={{
                scale: [...nkf.scale],
                opacity: [...nkf.opacity],
              }}
              transition={{
                duration: LOADER_CYCLE_S,
                times: [...nkf.times],
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
          ) : (
            <circle
              key={v.id}
              cx={v.cx}
              cy={v.cy}
              r={v.r}
              fill="currentColor"
              fillOpacity={0.95}
            />
          );
        })}
      </svg>
    </span>
  );
}

/**
 * Emblem geometris presisi tanpa bingkai berbentuk angka 4 (SMKN 4 Bandung):
 * mendukung mode loader minimalis, koreografi intro (~1,4 dtk), serta state standar.
 */
export default function KineticConstellation({
  state = 'idle',
  mode = 'standard',
  size = 'md',
  onIntroComplete,
  className = '',
}: {
  state?: ConstellationState;
  mode?: ConstellationMode;
  size?: ConstellationSize;
  onIntroComplete?: () => void;
  className?: string;
}) {
  const prefersReduced = Boolean(useReducedMotion());
  const animate = !prefersReduced;
  const isLoader = mode === 'loader';
  const isIntro = mode === 'intro';
  const introDoneRef = useRef(false);
  const onIntroCompleteRef = useRef(onIntroComplete);

  useEffect(() => {
    onIntroCompleteRef.current = onIntroComplete;
  }, [onIntroComplete]);

  useEffect(() => {
    if (!isIntro) {
      introDoneRef.current = false;
      return;
    }
    if (introDoneRef.current) return;

    if (prefersReduced) {
      introDoneRef.current = true;
      onIntroCompleteRef.current?.();
      return;
    }

    const timer = window.setTimeout(() => {
      if (!introDoneRef.current) {
        introDoneRef.current = true;
        onIntroCompleteRef.current?.();
      }
    }, 1440);

    return () => window.clearTimeout(timer);
  }, [isIntro, prefersReduced]);

  if (isLoader) {
    return <LoaderConstellation animate={animate} size={size} className={className} />;
  }

  const effectiveState: ConstellationState = isIntro
    ? 'idle'
    : MODE_STATE_MAP[mode] ?? state;
  const colorClass = isIntro ? 'text-[var(--accent-ink)]' : STATE_COLORS[effectiveState];

  const isThinkingLike = effectiveState === 'thinking' || effectiveState === 'answering';

  // Parameter orbit untuk mode standar
  const outerRingDuration =
    effectiveState === 'sql'
      ? 4.4
      : isThinkingLike
      ? 8.5
      : effectiveState === 'clarify'
      ? 18
      : effectiveState === 'idle'
      ? 34
      : 0;

  const innerRingDuration =
    effectiveState === 'sql'
      ? 3.0
      : isThinkingLike
      ? 5.2
      : effectiveState === 'idle'
      ? 24
      : 0;

  const showSatellites = isIntro || (effectiveState !== 'done' && effectiveState !== 'error');
  const showSqlTelemetry = !isIntro && effectiveState === 'sql';
  const isPulsingActive =
    animate && !isIntro && (isThinkingLike || effectiveState === 'sql');

  const outerRingOpacity = isIntro
    ? 0.34
    : effectiveState === 'done'
    ? 0.16
    : effectiveState === 'error'
    ? 0.28
    : effectiveState === 'idle'
    ? 0.22
    : 0.42;

  const innerRingOpacity = isIntro
    ? 0.24
    : effectiveState === 'sql'
    ? 0.38
    : isThinkingLike
    ? 0.28
    : effectiveState === 'idle'
    ? 0.14
    : 0.1;

  const baseStrokeOpacity = isIntro
    ? 0.9
    : effectiveState === 'sql'
    ? 0.32
    : isThinkingLike
    ? 0.36
    : effectiveState === 'done'
    ? 0.92
    : 0.82;

  return (
    <span
      aria-hidden="true"
      data-constellation-state={isIntro ? 'intro' : effectiveState}
      className={`relative inline-flex shrink-0 items-center justify-center select-none ${SIZE_CLASSES[size]} ${colorClass} ${className}`}
    >
      <svg
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-full w-full overflow-visible"
      >
        {/* 1. Cincin orbit luar presisi + tanda kompas + satelit telemetri */}
        <motion.g
          style={CENTER_ORIGIN}
          initial={
            isIntro && animate
              ? { scale: 0.72, opacity: 0, rotate: -32 }
              : { scale: 1, opacity: 1, rotate: 0 }
          }
          animate={
            isIntro && animate
              ? { scale: 1, opacity: 1, rotate: 0 }
              : animate && outerRingDuration > 0
              ? { scale: 1, opacity: 1, rotate: 360 }
              : { scale: 1, opacity: 1, rotate: 0 }
          }
          transition={
            isIntro && animate
              ? { delay: 0.8, duration: 0.42, ease: STUDIO_EASE }
              : animate && outerRingDuration > 0
              ? {
                  rotate: {
                    duration: outerRingDuration,
                    ease: 'linear',
                    repeat: Infinity,
                  },
                }
              : { duration: 0.25 }
          }
        >
          {/* Penjaga kotak batas 48x48 agar titik pusat rotasi presisi */}
          <circle cx="24" cy="24" r="23" fill="none" />

          {/* Rel orbit halus */}
          <circle
            cx="24"
            cy="24"
            r="20.6"
            stroke="currentColor"
            strokeWidth={effectiveState === 'sql' || isThinkingLike ? '0.95' : '0.8'}
            strokeDasharray={
              effectiveState === 'done' || effectiveState === 'error' ? undefined : '2.5 4.2'
            }
            strokeOpacity={outerRingOpacity * 0.75}
          />

          {/* Dua busur arsitektural berlawanan */}
          <path
            d="M 10.2 8.7 A 20.6 20.6 0 0 1 37.8 8.7"
            stroke="currentColor"
            strokeWidth={effectiveState === 'sql' ? '1.35' : '1.1'}
            strokeLinecap="round"
            strokeOpacity={outerRingOpacity}
          />
          <path
            d="M 37.8 39.3 A 20.6 20.6 0 0 1 10.2 39.3"
            stroke="currentColor"
            strokeWidth={effectiveState === 'sql' ? '1.35' : '1.1'}
            strokeLinecap="round"
            strokeOpacity={outerRingOpacity}
          />

          {/* 4 tanda tick presisi */}
          {ORBIT_TICKS.map((t, idx) => (
            <line
              key={idx}
              x1={t.x1}
              y1={t.y1}
              x2={t.x2}
              y2={t.y2}
              stroke="currentColor"
              strokeWidth="0.85"
              strokeLinecap="round"
              strokeOpacity={outerRingOpacity * 0.9}
            />
          ))}

          {/* Titik satelit telemetri */}
          {showSatellites && (
            <>
              <circle
                cx="24"
                cy="3.4"
                r={effectiveState === 'sql' ? '1.55' : '1.25'}
                fill="currentColor"
                fillOpacity={effectiveState === 'idle' && !isIntro ? 0.55 : 0.92}
              />
              <circle
                cx="24"
                cy="44.6"
                r={effectiveState === 'sql' ? '1.3' : '1.0'}
                fill="currentColor"
                fillOpacity={effectiveState === 'idle' && !isIntro ? 0.35 : 0.7}
              />
            </>
          )}

          {showSqlTelemetry && (
            <>
              <circle cx="44.6" cy="24" r="1.25" fill="currentColor" fillOpacity={0.85} />
              <circle cx="3.4" cy="24" r="1.05" fill="currentColor" fillOpacity={0.65} />
            </>
          )}
        </motion.g>

        {/* 2. Cincin giro dalam berputar berlawanan arah */}
        <motion.g
          style={CENTER_ORIGIN}
          initial={
            isIntro && animate
              ? { scale: 0.76, opacity: 0, rotate: 26 }
              : { scale: 1, opacity: 1, rotate: 0 }
          }
          animate={
            isIntro && animate
              ? { scale: 1, opacity: 1, rotate: 0 }
              : animate && innerRingDuration > 0
              ? { scale: 1, opacity: 1, rotate: -360 }
              : { scale: 1, opacity: 1, rotate: 0 }
          }
          transition={
            isIntro && animate
              ? { delay: 0.86, duration: 0.38, ease: STUDIO_EASE }
              : animate && innerRingDuration > 0
              ? {
                  rotate: {
                    duration: innerRingDuration,
                    ease: 'linear',
                    repeat: Infinity,
                  },
                }
              : { duration: 0.25 }
          }
        >
          <circle cx="24" cy="24" r="16" fill="none" />
          <circle
            cx="24"
            cy="24"
            r="15.4"
            stroke="currentColor"
            strokeWidth="0.75"
            strokeDasharray="1.8 4.8"
            strokeOpacity={innerRingOpacity}
          />
          {(isThinkingLike || effectiveState === 'sql' || isIntro) && (
            <path
              d="M 14.2 12.1 A 15.4 15.4 0 0 1 33.8 12.1"
              stroke="currentColor"
              strokeWidth="1.05"
              strokeLinecap="round"
              strokeOpacity={Math.min(0.65, innerRingOpacity * 1.6)}
            />
          )}
        </motion.g>

        {/* 3. Faset struktural sekunder (V0 -> V2 dan V2 -> V3) */}
        {FACET_EDGES.map((edge) => (
          <motion.path
            key={edge.id}
            d={edge.d}
            stroke="currentColor"
            strokeWidth="1.05"
            strokeLinecap="butt"
            initial={isIntro && animate ? { pathLength: 0, opacity: 0 } : { pathLength: 1, opacity: 0.22 }}
            animate={{ pathLength: 1, opacity: effectiveState === 'done' ? 0.24 : 0.2 }}
            transition={
              isIntro && animate
                ? { delay: 0.72, duration: 0.24, ease: STUDIO_EASE }
                : { duration: 0.2 }
            }
          />
        ))}

        {/* 4. Sisi utama angka 4 (V0->V1, V1->V2, V0->V3) dengan strokeLinecap="butt" */}
        {PRIMARY_EDGES.map((edge) => (
          <motion.path
            key={edge.id}
            d={edge.d}
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="butt"
            strokeLinejoin="miter"
            initial={
              isIntro && animate
                ? { pathLength: 0, opacity: 0.2 }
                : { pathLength: 1, opacity: baseStrokeOpacity }
            }
            animate={{ pathLength: 1, opacity: baseStrokeOpacity }}
            transition={
              isIntro && animate
                ? {
                    pathLength: {
                      delay: edge.introDelay,
                      duration: edge.introDuration,
                      ease: STUDIO_EASE,
                    },
                    opacity: {
                      delay: edge.introDelay,
                      duration: 0.14,
                    },
                  }
                : { duration: 0.25 }
            }
          />
        ))}

        {/* 5. Sapuan energi luminis saat koreografi intro selesai (1.14s - 1.42s) */}
        {isIntro && animate && (
          <>
            <motion.path
              d="M29 10.5 L13 25.5 L35 25.5"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="butt"
              strokeLinejoin="miter"
              initial={{ pathLength: 0.25, pathOffset: 0, opacity: 0 }}
              animate={{
                pathLength: [0.22, 0.45, 0.2],
                pathOffset: [0, 0.55, 1],
                opacity: [0, 0.95, 0],
              }}
              transition={{ delay: 1.12, duration: 0.3, ease: STUDIO_EASE }}
            />
            <motion.path
              d="M29 10.5 L29 37.5"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="butt"
              initial={{ pathLength: 0.25, pathOffset: 0, opacity: 0 }}
              animate={{
                pathLength: [0.25, 0.5, 0.2],
                pathOffset: [0, 0.5, 1],
                opacity: [0, 0.95, 0],
              }}
              transition={{ delay: 1.18, duration: 0.26, ease: STUDIO_EASE }}
            />
          </>
        )}

        {/* 6. Pulsa cahaya tersegmentasi saat thinking / sql (strokeLinecap="butt") */}
        {isPulsingActive &&
          PRIMARY_EDGES.map((edge, idx) => {
            const isSql = effectiveState === 'sql';
            const segDuration = isSql ? 0.38 : 0.62;
            const cycleDelay = isSql ? 0.72 : 1.24;
            return (
              <motion.path
                key={`pulse-${edge.id}`}
                d={edge.d}
                stroke="currentColor"
                strokeWidth={isSql ? '2.25' : '2.1'}
                strokeLinecap="butt"
                initial={{ pathLength: 0.01, pathOffset: 0, opacity: 0 }}
                animate={{
                  pathLength: [0.05, 0.52, 0.05],
                  pathOffset: [0, 0.48, 0.95],
                  opacity: [0, 1, 0],
                }}
                transition={{
                  duration: segDuration,
                  delay: idx * (segDuration * 0.78),
                  repeat: Infinity,
                  repeatDelay: cycleDelay,
                  ease: 'easeInOut',
                }}
              />
            );
          })}

        {/* 7. Halo halus pada simpul puncak (V0) & dasar (V3) saat idle atau intro */}
        {animate && (isIntro || effectiveState === 'idle') && (
          <>
            {[VERTICES[0], VERTICES[3]].map((v, idx) => (
              <motion.circle
                key={`halo-${v.id}`}
                cx={v.cx}
                cy={v.cy}
                r={v.r + 2.3}
                stroke="currentColor"
                strokeWidth="0.85"
                fill="none"
                style={FILL_ORIGIN}
                initial={{ scale: 0.7, opacity: 0 }}
                animate={
                  isIntro
                    ? { scale: [0.85, 1.35, 1.1], opacity: [0, 0.5, 0] }
                    : { scale: [0.92, 1.25, 0.92], opacity: [0.08, 0.34, 0.08] }
                }
                transition={
                  isIntro
                    ? { delay: 1.15 + idx * 0.06, duration: 0.32, ease: STUDIO_EASE }
                    : {
                        duration: 3.8,
                        delay: idx * 1.9,
                        repeat: Infinity,
                        ease: 'easeInOut',
                      }
                }
              />
            ))}
          </>
        )}

        {/* 8. Empat simpul utama angka 4 */}
        {VERTICES.map((v, idx) => {
          const introPop = isIntro && animate;
          const activeNodePulse =
            animate &&
            !isIntro &&
            (isThinkingLike ||
              effectiveState === 'sql' ||
              effectiveState === 'clarify');

          const pulseDuration =
            effectiveState === 'sql' ? 1.1 : isThinkingLike ? 1.55 : 2.2;
          const pulseDelay = idx * (effectiveState === 'sql' ? 0.14 : 0.22);

          return (
            <g key={v.id}>
              {/* Riak mikro saat simpul muncul di mode intro */}
              {introPop && (
                <motion.circle
                  cx={v.cx}
                  cy={v.cy}
                  r={v.r + 2.2}
                  stroke="currentColor"
                  strokeWidth="0.85"
                  fill="none"
                  style={FILL_ORIGIN}
                  initial={{ scale: 0.4, opacity: 0.65 }}
                  animate={{ scale: 1.65, opacity: 0 }}
                  transition={{ delay: v.introDelay, duration: 0.36, ease: STUDIO_EASE }}
                />
              )}

              {/* Cincin denyut terkalibrasi saat SQL / Thinking */}
              {activeNodePulse && (
                <motion.circle
                  cx={v.cx}
                  cy={v.cy}
                  r={v.r + 1.8}
                  stroke="currentColor"
                  strokeWidth="0.8"
                  fill="none"
                  style={FILL_ORIGIN}
                  animate={{ scale: [0.85, 1.35, 0.85], opacity: [0.1, 0.45, 0.1] }}
                  transition={{
                    duration: pulseDuration,
                    delay: pulseDelay,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                />
              )}

              <motion.circle
                cx={v.cx}
                cy={v.cy}
                r={v.r}
                fill="currentColor"
                style={FILL_ORIGIN}
                initial={introPop ? { scale: 0, opacity: 0 } : { scale: 1, opacity: 1 }}
                animate={
                  introPop
                    ? { scale: 1, opacity: 1 }
                    : activeNodePulse
                    ? { scale: [1, 1.16, 0.96, 1], opacity: [0.95, 1, 0.72, 0.95] }
                    : { scale: 1, opacity: 1 }
                }
                transition={
                  introPop
                    ? {
                        type: 'spring',
                        stiffness: 440,
                        damping: 24,
                        mass: 0.7,
                        delay: v.introDelay,
                      }
                    : activeNodePulse
                    ? {
                        duration: pulseDuration,
                        delay: pulseDelay,
                        repeat: Infinity,
                        ease: 'easeInOut',
                      }
                    : { duration: 0.2 }
                }
              />
            </g>
          );
        })}
      </svg>
    </span>
  );
}

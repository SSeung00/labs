import { motion } from 'framer-motion'
import { EASE_OUT } from '@/components/ui/motion'

/** Half-ring gauge: how much of the month's limit is used, with a tick at today's pace. */
export function Gauge({ used, pace, over }: { used: number; pace: number; over: boolean }) {
  const r = 80
  const len = Math.PI * r
  const u = Math.max(0, Math.min(1, used))
  const angle = Math.PI * (1 - Math.max(0, Math.min(1, pace)))
  return (
    <svg viewBox="0 0 200 112" className="w-full max-w-[240px]" aria-hidden>
      <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="var(--surface-3)" strokeWidth="14" strokeLinecap="round" />
      <motion.path
        d="M20 100 A80 80 0 0 1 180 100"
        fill="none"
        stroke={over ? 'var(--bad)' : 'var(--accent)'}
        strokeWidth="14"
        strokeLinecap="round"
        strokeDasharray={len}
        initial={{ strokeDashoffset: len }}
        animate={{ strokeDashoffset: len * (1 - u) }}
        transition={{ duration: 0.9, ease: EASE_OUT }}
      />
      {pace > 0 && pace < 1 && (
        <line
          x1={100 + Math.cos(angle) * (r - 12)}
          y1={100 - Math.sin(angle) * (r - 12)}
          x2={100 + Math.cos(angle) * (r + 12)}
          y2={100 - Math.sin(angle) * (r + 12)}
          stroke="var(--text)"
          strokeWidth="2.5"
          strokeLinecap="round"
          opacity="0.7"
        />
      )}
    </svg>
  )
}

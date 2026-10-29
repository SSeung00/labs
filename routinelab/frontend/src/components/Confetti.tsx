import { useMemo } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

const COLORS = ['var(--good)', 'var(--warn)', 'var(--accent)', 'var(--cat-health)', 'var(--cat-study)', 'var(--cat-mind)']

/** A short burst of paper bits from the bottom centre (마이루틴-style 폭죽). */
export function Confetti({ pieces = 70 }: { pieces?: number }) {
  const reduce = useReducedMotion()
  const bits = useMemo(
    () =>
      Array.from({ length: pieces }, (_, i) => {
        const angle = (-90 + (Math.random() - 0.5) * 110) * (Math.PI / 180)
        const speed = 380 + Math.random() * 420
        return {
          i,
          x: Math.cos(angle) * speed,
          y: Math.sin(angle) * speed,
          rot: (Math.random() - 0.5) * 900,
          w: 6 + Math.random() * 6,
          h: 8 + Math.random() * 10,
          color: COLORS[i % COLORS.length],
          delay: Math.random() * 0.12,
          round: Math.random() < 0.3,
        }
      }),
    [pieces],
  )
  if (reduce) return null
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden" aria-hidden>
      {bits.map((b) => (
        <motion.span
          key={b.i}
          className="absolute bottom-[18%] left-1/2"
          style={{ width: b.w, height: b.round ? b.w : b.h, background: b.color, borderRadius: b.round ? 999 : 2 }}
          initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
          animate={{ x: [0, b.x * 0.8, b.x], y: [0, b.y, b.y + 900], rotate: b.rot, opacity: [1, 1, 0] }}
          transition={{ duration: 2.4, delay: b.delay, times: [0, 0.35, 1], ease: ['easeOut', 'easeIn'] }}
        />
      ))}
    </div>
  )
}

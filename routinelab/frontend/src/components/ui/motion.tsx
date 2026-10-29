import { useEffect, useRef, useState, type ReactNode } from 'react'
import { animate, motion, useReducedMotion, type Variants } from 'framer-motion'
import { cn } from '@/lib/utils'

export const EASE_OUT = [0.22, 1, 0.36, 1] as const

/** Counts from the previous value to the new one (first render: from 0). */
export function AnimatedNumber({
  value,
  format,
  duration = 0.8,
  className,
}: {
  value: number
  format: (v: number) => string
  duration?: number
  className?: string
}) {
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(reduce ? value : 0)
  const from = useRef(reduce ? value : 0)

  useEffect(() => {
    if (reduce) {
      setShown(value)
      return
    }
    const controls = animate(from.current, value, {
      duration,
      ease: EASE_OUT,
      onUpdate: (v) => setShown(v),
    })
    from.current = value
    return () => controls.stop()
  }, [value, duration, reduce])

  return <span className={cn('num', className)}>{format(Math.round(shown))}</span>
}

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045, delayChildren: 0.02 } },
}

const item: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE_OUT } },
}

/** Children wrapped in <StaggerItem> fade-and-rise in sequence. */
export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={container} initial="hidden" animate="show">
      {children}
    </motion.div>
  )
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={item}>
      {children}
    </motion.div>
  )
}

/** Bar that grows from zero to its value on mount and animates on change. */
export function GrowBar({
  value,
  color,
  className,
  marker,
}: {
  value: number
  color?: string
  className?: string
  /** 0–1 position of a thin "expected by today" tick. */
  marker?: number | null
}) {
  const v = Math.max(0, Math.min(1, value))
  return (
    <div className={cn('relative h-2 overflow-hidden rounded-full bg-surface-3', className)}>
      <motion.div
        className="h-full rounded-full bg-accent"
        style={color ? { background: color } : undefined}
        initial={{ width: 0 }}
        animate={{ width: `${v * 100}%` }}
        transition={{ duration: 0.7, ease: EASE_OUT }}
      />
      {marker != null && marker > 0 && marker < 1 && (
        <span className="absolute inset-y-0 w-0.5 rounded-full bg-text/70" style={{ left: `${marker * 100}%` }} aria-hidden />
      )}
    </div>
  )
}

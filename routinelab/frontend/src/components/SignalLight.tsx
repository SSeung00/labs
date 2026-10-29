import { motion } from 'framer-motion'
import type { Light, Signal } from '@/api/types'
import { cn } from '@/lib/utils'
import { parseDay, weekdayShort } from '@/lib/day'

const LAMPS = [
  { key: 'red', color: 'var(--bad)' },
  { key: 'yellow', color: 'var(--warn)' },
  { key: 'green', color: 'var(--good)' },
] as const

export const LIGHT_COLOR: Record<Light, string> = {
  green: 'var(--good)',
  yellow: 'var(--warn)',
  red: 'var(--bad)',
  rest: 'var(--rest)',
  off: 'var(--surface-3)',
  none: 'var(--surface-3)',
}

export const LIGHT_LABEL: Record<Light, string> = {
  green: '초록불',
  yellow: '노란불',
  red: '빨간불',
  rest: '쉬는 날',
  off: '시작 전',
  none: '루틴 없음',
}

function lit(lamp: (typeof LAMPS)[number]['key'], color: Light) {
  return lamp === color || (color === 'rest' && lamp === 'yellow')
}

/** Compact three-dot light for bars and lists. */
export function SignalDots({ color, size = 'sm' }: { color: Light; size?: 'xs' | 'sm' }) {
  const s = size === 'xs' ? 'size-2' : 'size-2.5'
  return (
    <span className="inline-flex items-center gap-1" aria-label={LIGHT_LABEL[color]}>
      {LAMPS.map((l) => (
        <span
          key={l.key}
          className={cn('rounded-full transition-colors', s)}
          style={{ background: lit(l.key, color) ? (color === 'rest' ? LIGHT_COLOR.rest : l.color) : 'var(--surface-3)' }}
        />
      ))}
    </span>
  )
}

/** The big traffic light on 오늘. */
export function SignalLamp({ color }: { color: Light }) {
  return (
    <div className="inline-flex items-center gap-2.5 rounded-full border bg-surface-2 px-3 py-2.5 dark:bg-black/30" role="img" aria-label={LIGHT_LABEL[color]}>
      {LAMPS.map((l) => {
        const on = lit(l.key, color)
        const c = color === 'rest' ? LIGHT_COLOR.rest : l.color
        return (
          <motion.span
            key={l.key}
            className="relative size-9 rounded-full sm:size-10"
            animate={{ scale: on ? 1 : 0.86, opacity: on ? 1 : 0.5 }}
            transition={{ type: 'spring', stiffness: 400, damping: 22 }}
            style={{ background: on ? c : 'var(--surface-3)', boxShadow: on ? `0 0 22px 2px color-mix(in oklch, ${c} 55%, transparent)` : undefined }}
          >
            {on && <span className="absolute inset-[22%] rounded-full bg-white/25 blur-[2px]" />}
          </motion.span>
        )
      })}
    </div>
  )
}

/** Mon–Sun dots for the week around the shown day. */
export function WeekStrip({ week, day, today, onPick }: { week: Signal[]; day: string; today: string; onPick: (d: string) => void }) {
  return (
    <div className="grid grid-cols-7 gap-1">
      {week.map((w) => {
        const future = w.day > today
        const active = w.day === day
        return (
          <button
            key={w.day}
            onClick={() => !future && onPick(w.day)}
            disabled={future}
            className={cn(
              'flex flex-col items-center gap-1 rounded-xl py-1.5 text-[11px] transition-colors',
              active ? 'bg-surface-3 font-semibold text-text' : 'text-subtle hover:bg-surface-2',
              future && 'opacity-50',
            )}
            aria-label={`${w.day} ${LIGHT_LABEL[w.color]}`}
          >
            <span className={cn(w.day === today && 'text-accent')}>{weekdayShort(w.day)}</span>
            <span
              className={cn('grid size-6 place-items-center rounded-full text-[10px] font-bold num', w.color === 'off' || w.color === 'none' ? 'border border-dashed border-border-strong' : 'text-black/70')}
              style={w.color !== 'off' && w.color !== 'none' ? { background: LIGHT_COLOR[w.color] } : undefined}
            >
              {parseDay(w.day).getDate()}
            </span>
          </button>
        )
      })}
    </div>
  )
}

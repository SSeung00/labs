import { motion } from 'framer-motion'
import { Check, Feather, Flame, Minus, Plus } from 'lucide-react'
import type { DayHabit } from '@/api/types'
import { cn } from '@/lib/utils'
import { fmtValue } from '@/lib/day'

export const CATEGORY: Record<string, { label: string; color: string }> = {
  health: { label: '건강', color: 'var(--cat-health)' },
  exercise: { label: '운동', color: 'var(--cat-exercise)' },
  study: { label: '공부', color: 'var(--cat-study)' },
  mind: { label: '마음', color: 'var(--cat-mind)' },
  life: { label: '생활', color: 'var(--cat-life)' },
}

export function targetText(h: Pick<DayHabit, 'kind' | 'target' | 'unit'>): string {
  if (h.kind === 'check') return ''
  return `${fmtValue(h.target)}${h.unit}`
}

/** The round button on the left: tap = done (check) or +1 (count); minutes/number open the sheet. */
function CheckButton({ h, onTap }: { h: DayHabit; onTap: () => void }) {
  const state = h.entry?.state ?? ''
  const value = h.entry?.value ?? 0
  const ratio = h.kind === 'check' ? (h.done ? 1 : 0) : Math.min(1, value / h.target)
  const color = CATEGORY[h.category]?.color ?? 'var(--accent)'
  const R = 19
  const C = 2 * Math.PI * R
  return (
    <motion.button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onTap()
      }}
      whileTap={{ scale: 0.86 }}
      className="relative grid size-12 shrink-0 place-items-center rounded-full"
      aria-label={h.done ? `${h.name} 완료됨 — 되돌리기` : `${h.name} ${h.kind === 'count' ? '하나 더' : '완료'}`}
    >
      <svg viewBox="0 0 44 44" className="absolute inset-0 size-full -rotate-90">
        <circle cx="22" cy="22" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="3.5" strokeDasharray={state === 'skip' ? '4 4' : undefined} />
        {ratio > 0 && (
          <motion.circle
            cx="22"
            cy="22"
            r={R}
            fill={h.done ? color : 'none'}
            stroke={color}
            strokeWidth="3.5"
            strokeLinecap="round"
            initial={false}
            animate={{ strokeDasharray: `${C * ratio} ${C}` }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          />
        )}
      </svg>
      <span className={cn('relative text-[13px] font-bold num', h.done ? 'text-white' : 'text-muted')}>
        {h.done ? (
          state === 'easy' ? <Feather className="size-5" strokeWidth={2.4} /> : <Check className="size-5" strokeWidth={3} />
        ) : state === 'skip' ? (
          <Minus className="size-4" />
        ) : h.kind === 'check' ? null : value > 0 ? (
          fmtValue(value)
        ) : h.kind === 'count' ? (
          <Plus className="size-4" />
        ) : null}
      </span>
    </motion.button>
  )
}

export function HabitRow({ h, onTap, onOpen, disabled }: { h: DayHabit; onTap: () => void; onOpen: () => void; disabled?: boolean }) {
  const state = h.entry?.state ?? ''
  const value = h.entry?.value ?? 0
  const sub: string[] = []
  if (state === 'easy') sub.push(`가볍게${h.easy_name ? `: ${h.easy_name}` : ''}`)
  else if (state === 'skip') sub.push('오늘은 쉬어요')
  else if (h.kind !== 'check') sub.push(`${fmtValue(value)} / ${targetText(h)}`)
  if (h.schedule === 'weekly') sub.push(`이번 주 ${h.week_done}/${h.per_week}`)
  if (h.cue && !h.done) sub.push(h.cue)
  if (h.entry?.note) sub.push(`“${h.entry.note}”`)

  return (
    <motion.li layout="position" className={cn('flex items-center gap-3 rounded-2xl px-2 py-1.5 transition-colors', !disabled && 'hover:bg-surface-2/70')}>
      <CheckButton h={h} onTap={disabled ? onOpen : onTap} />
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="text-[22px] leading-none">{h.emoji}</span>
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-[15px] font-medium', h.done && 'text-muted line-through decoration-1 decoration-subtle/60', state === 'skip' && 'text-subtle')}>
            {h.name}
          </span>
          {sub.length > 0 && <span className="mt-0.5 block truncate text-xs text-subtle">{sub.join(' · ')}</span>}
        </span>
        {h.streak.current > 0 && (
          <span
            className={cn('flex shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold num', h.streak.at_risk ? 'bg-warn/15 text-warn' : 'text-muted')}
            title={h.streak.at_risk ? '어제 놓쳤어요. 오늘 하면 이어져요' : `${h.streak.current}번 연속`}
          >
            <Flame className="size-3.5" />
            {h.streak.current}
          </span>
        )}
      </button>
    </motion.li>
  )
}

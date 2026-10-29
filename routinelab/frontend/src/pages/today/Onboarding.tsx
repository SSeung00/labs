import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Loader2, Sparkles } from 'lucide-react'
import type { HabitInput } from '@/api/types'
import { useHabitMutations, useTemplates } from '@/api/rl'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { SLOTS } from '@/lib/day'

function describe(h: Partial<HabitInput>): string {
  const slot = SLOTS.find((s) => s.key === h.slot)?.label
  const sched = h.schedule === 'weekly' ? `주 ${h.per_week}회` : h.schedule === 'days' ? '요일 지정' : '매일'
  const amount = h.kind && h.kind !== 'check' ? `${h.target}${h.unit}` : null
  return [slot, sched, amount, h.easy_name ? `가볍게: ${h.easy_name}` : null].filter(Boolean).join(' · ')
}

/** First run: pick themes, keep the routines you want, start. */
export function Onboarding() {
  const { data } = useTemplates()
  const { bulk } = useHabitMutations()
  const [themes, setThemes] = useState<string[]>(['health', 'exercise', 'study'])
  // Start small: only the first two of each theme are ticked.
  const [off, setOff] = useState<Set<string> | null>(null)

  const items = useMemo(
    () => (data?.themes ?? []).filter((t) => themes.includes(t.key)).flatMap((t) => t.habits.map((h) => ({ id: `${t.key}:${h.name}`, h }))),
    [data, themes],
  )
  const defaultOff = useMemo(
    () => new Set((data?.themes ?? []).flatMap((t) => t.habits.slice(2).map((h) => `${t.key}:${h.name}`))),
    [data],
  )
  const offSet = off ?? defaultOff
  const picked = items.filter((i) => !offSet.has(i.id))

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">어떤 루틴부터 시작할까요?</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          주제를 고르면 기본 루틴을 깔아 드려요. 이름·목표·요일은 나중에 언제든 바꿀 수 있어요.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(data?.themes ?? []).map((t) => {
          const on = themes.includes(t.key)
          return (
            <button
              key={t.key}
              onClick={() => setThemes(on ? themes.filter((x) => x !== t.key) : [...themes, t.key])}
              className={cn('h-10 rounded-full border px-4 text-sm font-medium transition-colors', on ? 'border-accent bg-accent-soft' : 'text-muted hover:text-text')}
            >
              {t.emoji} {t.name}
            </button>
          )
        })}
      </div>

      <Card>
        <CardBody className="pt-4">
          {items.length === 0 ? (
            <p className="py-6 text-center text-sm text-subtle">위에서 주제를 골라 주세요.</p>
          ) : (
            <ul className="divide-y">
              {items.map(({ id, h }) => {
                const on = !offSet.has(id)
                return (
                  <li key={id}>
                    <label className="flex cursor-pointer items-center gap-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => {
                          const next = new Set(offSet)
                          if (on) next.add(id)
                          else next.delete(id)
                          setOff(next)
                        }}
                        className="size-5 accent-[var(--accent)]"
                      />
                      <span className="text-xl">{h.emoji}</span>
                      <span className="min-w-0 flex-1">
                        <span className={cn('block text-[15px] font-medium', !on && 'text-subtle')}>{h.name}</span>
                        <span className="block truncate text-xs text-subtle">{describe(h)}</span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <p className={cn('flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs leading-relaxed', picked.length > 7 ? 'bg-warn/15 text-warn' : 'bg-surface-2 text-muted')}>
        <Sparkles className="mt-0.5 size-3.5 shrink-0" />
        {picked.length > 7
          ? `${picked.length}개는 처음엔 많아요. 3~5개로 시작해서 익숙해지면 늘리는 걸 추천해요.`
          : '하루 루틴의 60%만 해도 초록불이 켜져요. 못 한 날이 있어도 괜찮아요.'}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" className="h-11 px-5" disabled={!picked.length || bulk.isPending} onClick={() => bulk.mutate(picked.map((i) => i.h))}>
          {bulk.isPending && <Loader2 className="animate-spin" />}
          {picked.length}개로 시작하기
        </Button>
        <Link to="/routines?new=1" className="text-sm font-medium text-muted hover:text-text">
          직접 만들래요
        </Link>
      </div>
      {bulk.error && <p className="text-sm text-bad">{bulk.error.message}</p>}
    </div>
  )
}

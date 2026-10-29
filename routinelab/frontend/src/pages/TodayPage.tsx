import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ChevronLeft, ChevronRight, Coffee, Palmtree, Plus } from 'lucide-react'
import type { DayHabit, DayPayload } from '@/api/types'
import { useDay, useDayActions, useDayMutations, useModes, useSettings } from '@/api/rl'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { PageSkeleton } from '@/components/layout/PageSkeleton'
import { HabitRow } from '@/components/HabitRow'
import { HabitSheet } from '@/components/HabitSheet'
import { SignalLamp, WeekStrip } from '@/components/SignalLight'
import { useCelebrate } from '@/components/layout/Toasts'
import { addDays, dayLabel, SLOTS } from '@/lib/day'
import { cn } from '@/lib/utils'
import { Onboarding } from './today/Onboarding'
import { ReviewCard, TodoCard } from './today/DayCards'

function signalMessage(d: DayPayload): string {
  const { done, total, color } = d.signal
  if (d.rest) return d.rest.note ? `${d.rest.note} — 오늘은 쉬어가요` : '오늘은 쉬는 날이에요'
  if (!total) return '오늘 할 루틴이 없어요'
  if (done === total) return '오늘 루틴을 전부 해냈어요!'
  const need = Math.max(0, Math.ceil(d.thresholds.green * total - 1e-9) - done)
  if (color === 'green') return `초록불이에요. 남은 건 보너스예요`
  if (d.day < d.today) return `이날은 ${done}/${total}개 했어요`
  return need === 1 ? '하나만 더 하면 초록불!' : `${need}개 더 하면 초록불이 켜져요`
}

function SignalCard({ data, onPick }: { data: DayPayload; onPick: (d: string) => void }) {
  const { done, total } = data.signal
  return (
    <Card className="overflow-hidden">
      <CardBody className="space-y-4 pt-5">
        <div className="flex items-center gap-4">
          <SignalLamp color={data.signal.color} />
          <div className="min-w-0">
            <div className="text-2xl font-bold tracking-tight num">
              {data.rest ? '휴가' : `${done}/${total}`}
              {!data.rest && total > 0 && <span className="ml-1.5 text-sm font-medium text-subtle">{Math.round((done / total) * 100)}%</span>}
            </div>
            <div className="mt-0.5 text-[13px] leading-snug text-muted">{signalMessage(data)}</div>
          </div>
        </div>
        <WeekStrip week={data.week} day={data.day} today={data.today} onPick={onPick} />
        {data.streak.current > 0 && (
          <p className="text-center text-xs text-subtle">
            🔥 초록불 <b className="text-text num">{data.streak.current}</b>일 연속
          </p>
        )}
      </CardBody>
    </Card>
  )
}

function ModeSheet({ open, onClose, data }: { open: boolean; onClose: () => void; data: DayPayload }) {
  const { data: modes } = useModes()
  const { mode, rest } = useDayMutations()
  const singleRest = data.rest && data.rest.start === data.day && data.rest.end === data.day
  return (
    <Dialog open={open} onClose={onClose} title="오늘의 모드" description="상황에 맞는 루틴 세트로 바꿔요. 이날 하루만 적용돼요.">
      <div className="space-y-2 px-5 py-5">
        {modes?.modes.map((m) => {
          const on = data.mode?.id === m.id
          return (
            <button
              key={m.id}
              disabled={mode.isPending}
              onClick={() => mode.mutate({ day: data.day, mode_id: m.id }, { onSuccess: onClose })}
              className={cn('flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors', on ? 'border-accent bg-accent-soft' : 'hover:border-border-strong')}
            >
              <span className="text-xl">{m.emoji}</span>
              <span className="flex-1">
                <span className="block text-sm font-semibold">
                  {m.name} {m.is_default && <span className="ml-1 text-xs font-normal text-subtle">기본</span>}
                </span>
                <span className="block text-xs text-subtle">루틴 {m.habits}개</span>
              </span>
            </button>
          )
        })}
        <div className="border-t pt-3">
          <button
            disabled={rest.isPending || (!!data.rest && !singleRest)}
            onClick={() => rest.mutate({ day: data.day, rest: !singleRest }, { onSuccess: onClose })}
            className={cn('flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors', singleRest ? 'border-rest bg-rest/15' : 'hover:border-border-strong')}
          >
            <Coffee className="size-5 text-rest" />
            <span className="flex-1">
              <span className="block text-sm font-semibold">{singleRest ? '쉬는 날 취소' : '오늘은 쉬는 날'}</span>
              <span className="block text-xs text-subtle">
                {data.rest && !singleRest ? '휴가 기간이에요. 루틴 → 모드·휴가에서 바꿀 수 있어요' : '신호등도 연속 기록도 멈춰요. 쉬는 것도 루틴이에요'}
              </span>
            </span>
          </button>
        </div>
        <Link to="/routines?tab=modes" onClick={onClose} className="block pt-1 text-center text-xs font-medium text-accent">
          모드 만들기 · 휴가 예약
        </Link>
      </div>
    </Dialog>
  )
}

function HabitGroups({ data, onOpen }: { data: DayPayload; onOpen: (h: DayHabit) => void }) {
  const { setEntry } = useDayActions(data.day)
  const tap = (h: DayHabit) => {
    if (h.kind === 'check') setEntry(h, { state: h.done ? '' : 'done' })
    else if (h.kind === 'count' && !h.done) setEntry(h, { value: (h.entry?.value ?? 0) + 1 })
    else onOpen(h)
  }
  const groups = SLOTS.map((s) => ({ ...s, items: data.habits.filter((h) => h.slot === s.key) })).filter((g) => g.items.length)

  if (!data.habits.length) {
    return (
      <Card>
        <CardBody className="py-10 text-center text-sm text-subtle">
          이 모드에는 오늘 할 루틴이 없어요.
          <div className="mt-3">
            <Link to="/routines?new=1">
              <Button size="sm" tabIndex={-1}>
                <Plus /> 루틴 추가
              </Button>
            </Link>
          </div>
        </CardBody>
      </Card>
    )
  }
  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const done = g.items.filter((h) => h.done).length
        return (
          <Card key={g.key} className={cn(data.rest && 'opacity-70')}>
            <div className="flex items-center justify-between px-4 pt-3 text-[13px] font-semibold text-muted">
              <span>
                {g.emoji} {g.label}
              </span>
              <span className="text-xs font-medium text-subtle num">
                {done}/{g.items.length}
              </span>
            </div>
            <ul className="px-2 pb-2 pt-1">
              {g.items.map((h) => (
                <HabitRow key={h.id} h={h} onTap={() => tap(h)} onOpen={() => onOpen(h)} />
              ))}
            </ul>
          </Card>
        )
      })}
    </div>
  )
}

/** Fires confetti when today's light turns green or every routine is done (not on page load). */
function useCelebrations(data: DayPayload | undefined, enabled: boolean) {
  const fire = useCelebrate((s) => s.fire)
  const prev = useRef<{ day: string; color: string; done: number } | null>(null)
  useEffect(() => {
    if (!data) return
    const p = prev.current
    prev.current = { day: data.day, color: data.signal.color, done: data.signal.done }
    if (!enabled || !p || p.day !== data.day || data.day !== data.today || data.rest) return
    const { done, total, color } = data.signal
    if (total > 0 && done === total && p.done < done) {
      fire({ emoji: '🌟', title: '완벽한 하루!', body: `오늘 루틴 ${total}개를 전부 해냈어요.` })
    } else if (color === 'green' && p.color !== 'green') {
      fire({ emoji: '🟢', title: '초록불 켜졌어요!', body: `초록불 ${data.streak.current}일째예요. 남은 건 보너스!` })
    }
  }, [data, enabled, fire])
}

export function TodayPage() {
  const [day, setDay] = useState<string | undefined>()
  const [openId, setOpenId] = useState<number | null>(null)
  const [modeOpen, setModeOpen] = useState(false)
  const { data, error } = useDay(day)
  const { data: settings } = useSettings()
  const actions = useDayActions(data?.day ?? '')
  useCelebrations(data, settings?.celebrate !== false)

  if (!data) {
    return error ? <p className="py-20 text-center text-sm text-bad">{error.message}</p> : <PageSkeleton />
  }
  if (!data.has_habits) return <Onboarding />

  const pick = (d: string) => setDay(d === data.today ? undefined : d)
  const open = data.habits.find((h) => h.id === openId) ?? null

  return (
    <div>
      <header className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" onClick={() => pick(addDays(data.day, -1))} aria-label="전날">
            <ChevronLeft />
          </Button>
          <h1 className="px-1 text-lg font-bold tracking-tight sm:text-xl">{dayLabel(data.day, data.today)}</h1>
          <Button variant="ghost" size="icon" onClick={() => pick(addDays(data.day, 1))} disabled={data.day >= data.today} aria-label="다음날">
            <ChevronRight />
          </Button>
        </div>
        {data.day !== data.today && (
          <Button size="sm" variant="ghost" className="border" onClick={() => setDay(undefined)}>
            오늘로
          </Button>
        )}
        <button
          onClick={() => setModeOpen(true)}
          className="ml-auto flex h-8 items-center gap-1.5 rounded-full border bg-surface-2/70 px-3 text-[13px] font-medium hover:border-border-strong"
        >
          {data.rest ? (
            <>
              <Palmtree className="size-4 text-rest" /> 쉬는 날
            </>
          ) : (
            <>
              {data.mode?.emoji} {data.mode?.name ?? '모드'}
            </>
          )}
        </button>
      </header>

      {/* Phone: light, routines, todos, review. Wider: routines left, the rest stacked right. */}
      <div className="grid gap-4 split:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] split:grid-rows-[auto_auto_1fr] split:items-start">
        <div className="split:col-start-2 split:row-start-1">
          <SignalCard data={data} onPick={pick} />
        </div>
        <div className="split:col-start-1 split:row-span-3 split:row-start-1">
          <HabitGroups data={data} onOpen={(h) => setOpenId(h.id)} />
        </div>
        <div className="split:col-start-2">
          <TodoCard data={data} />
        </div>
        <div className="split:col-start-2">
          <ReviewCard data={data} />
        </div>
      </div>

      <HabitSheet h={open} onClose={() => setOpenId(null)} onChange={actions.setEntry} />
      <ModeSheet open={modeOpen} onClose={() => setModeOpen(false)} data={data} />
    </div>
  )
}

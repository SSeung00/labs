import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { addDays, format, parseISO, startOfWeek } from 'date-fns'
import { ko } from 'date-fns/locale'
import { BedDouble, ChevronLeft, ChevronRight, Feather, MoreHorizontal } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { ActivePlan, PlannedWorkout, WeekAction } from '@/api/planner'
import type { PaceZones } from '@/api/progress'
import { fmtPaceSec } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useNow } from '@/lib/useNow'
import { KIND, PHASE, STATUS_ICON, estDuration, fmtEst, keyLine } from './workoutMeta'

const iso = (d: Date) => format(d, 'yyyy-MM-dd')

function weekName(offset: number) {
  if (offset === 0) return '이번 주'
  if (offset === 1) return '다음 주'
  if (offset === -1) return '지난 주'
  return offset > 0 ? `${offset}주 뒤` : `${-offset}주 전`
}

function DayCard({ day, items, extras, today, paces, racePace, onOpen }: {
  day: Date
  items: PlannedWorkout[]
  extras: ActivePlan['extras']
  today: string
  paces?: PaceZones | null
  racePace?: number
  onOpen: (w: PlannedWorkout) => void
}) {
  const d = iso(day)
  const isToday = d === today
  const past = d < today
  const label = (
    <div className={cn('flex flex-wrap items-baseline gap-x-1.5 xl:mb-2', isToday ? 'text-accent' : 'text-subtle')}>
      <span className="text-xs font-semibold">{format(day, 'EEE', { locale: ko })}</span>
      <span className="num text-xs">{format(day, 'M/d')}</span>
      {isToday && <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold leading-4 text-accent-fg">오늘</span>}
    </div>
  )
  const real = items.filter((w) => w.kind !== 'rest')

  return (
    <div
      className={cn(
        'flex gap-3 rounded-xl border px-3 py-2 xl:min-h-40 xl:flex-col xl:gap-0 xl:p-3',
        isToday ? 'border-accent/60 bg-accent-soft/40 ring-1 ring-accent/30' : 'bg-surface-2/30',
        past && !isToday && 'opacity-80',
      )}
    >
      <div className="w-16 shrink-0 xl:w-auto">{label}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {real.length === 0 && extras.length === 0 && (
          <div className="flex items-center gap-1.5 py-1 text-sm text-subtle">
            <BedDouble className="size-4" /> 휴식
          </div>
        )}
        {real.map((w) => {
          const st = STATUS_ICON[w.status as keyof typeof STATUS_ICON]
          const full = keyLine(w.structure, paces, racePace)
          // Titles like "크루즈 인터벌 4×1.6km" already name the set; then just show the target pace.
          const [set, pace0] = full.split(' @')
          const line = pace0 && w.title.includes(set) ? `@${pace0}` : full
          const pace = w.actual_time_s && w.actual_main_km ? w.actual_time_s / w.actual_main_km : null
          return (
            <button
              key={w.id}
              onClick={() => onOpen(w)}
              className={cn('group flex w-full flex-col items-start rounded-lg text-left', w.status === 'skipped' && 'opacity-50')}
            >
              {/* Column layout (wide screens) gets a kind label row; the list layout keeps one line per fact. */}
              <div className="flex w-full items-center gap-1.5 xl:mb-1">
                <span className="h-3.5 w-1 shrink-0 rounded-full" style={{ background: KIND[w.kind].color }} />
                <span className="hidden text-[11px] font-medium text-muted xl:inline">{KIND[w.kind].label}</span>
                <span className="min-w-0 xl:hidden">
                  <span className={cn('line-clamp-2 text-sm font-semibold leading-snug group-hover:text-accent', w.status === 'skipped' && 'line-through')}>{w.title}</span>
                </span>
                {st && (
                  <span className={cn('ml-auto grid size-4 shrink-0 place-items-center rounded-full', st.cls)} title={st.label}>
                    <st.icon className="size-2.5" strokeWidth={3} />
                  </span>
                )}
              </div>
              <div className="hidden xl:block">
                <div className={cn('line-clamp-2 text-sm font-semibold leading-snug group-hover:text-accent', w.status === 'skipped' && 'line-through')}>{w.title}</div>
              </div>
              <div className="flex flex-wrap items-baseline gap-x-2 pl-2.5 xl:block xl:pl-0">
                {line && w.kind !== 'race' && <div className="num mt-0.5 text-xs text-muted">{line}</div>}
                <div className="num mt-0.5 text-[11px] text-subtle xl:mt-1">
                  {w.matched_activity_id ? (
                    <span className={cn(w.status === 'done' ? 'text-good' : 'text-warn')}>
                      {w.actual_km?.toFixed(1)} / {((w.target_distance_m ?? 0) / 1000).toFixed(1)}km{pace ? ` · ${fmtPaceSec(pace)}/km` : ''}
                    </span>
                  ) : (
                    <>
                      {((w.target_distance_m ?? 0) / 1000).toFixed(1)}km
                      {w.kind !== 'race' && estDuration(w.structure ?? [], paces, racePace) ? ` · ${fmtEst(estDuration(w.structure ?? [], paces, racePace))}` : ''}
                    </>
                  )}
                </div>
              </div>
            </button>
          )
        })}
        {extras.map((e) => (
          <Link key={e.activity_id} to={`/activities/${e.activity_id}`} className="num text-[11px] text-muted hover:text-text">
            + 계획 외 {e.km.toFixed(1)}km
          </Link>
        ))}
      </div>
    </div>
  )
}

/** This week's seven days, big enough to read at a glance; arrows (or a swipe) page through weeks. */
export function WeekBoard({ data, paces, onOpen, onWeekAction, onSettings }: {
  data: ActivePlan
  paces?: PaceZones | null
  onOpen: (w: PlannedWorkout) => void
  onWeekAction: (week_start: string, action: WeekAction) => void
  onSettings: () => void
}) {
  const now = useNow()
  const today = iso(now)
  const racePace = data.plan.params.race_pace_s_per_km
  const thisMonday = iso(startOfWeek(now, { weekStartsOn: 1 }))

  const { weeks, byDay, extrasByDay, info } = useMemo(() => {
    const ws: string[] = []
    const end = parseISO(data.plan.end_day)
    for (let d = startOfWeek(parseISO(data.plan.start_day), { weekStartsOn: 1 }); d <= end; d = addDays(d, 7)) ws.push(iso(d))
    const byDay = new Map<string, PlannedWorkout[]>()
    data.workouts.forEach((w) => byDay.set(w.day, [...(byDay.get(w.day) ?? []), w]))
    const extrasByDay = new Map<string, ActivePlan['extras']>()
    data.extras.forEach((e) => extrasByDay.set(e.day, [...(extrasByDay.get(e.day) ?? []), e]))
    return { weeks: ws, byDay, extrasByDay, info: new Map(data.weeks.map((w) => [w.week_start, w])) }
  }, [data])

  const startIdx = Math.max(0, weeks.findIndex((w) => w >= thisMonday))
  const [idx, setIdx] = useState(startIdx)
  const [menu, setMenu] = useState(false)
  const touch = useRef<number | null>(null)
  const cur = Math.min(idx, weeks.length - 1)
  const wk = weeks[cur]
  const monday = parseISO(wk)
  const w = info.get(wk)
  const isThis = wk === thisMonday
  const editable = iso(addDays(monday, 6)) >= today
  const planned = w?.planned_km ?? 0
  const actual = w?.actual_km ?? 0
  const pct = planned ? Math.min(100, (actual / planned) * 100) : 0
  const go = (d: number) => setIdx((i) => Math.max(0, Math.min(weeks.length - 1, i + d)))

  return (
    <Card
      className="p-4 sm:p-5"
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touch.current == null) return
        const dx = e.changedTouches[0].clientX - touch.current
        touch.current = null
        if (Math.abs(dx) > 70) go(dx < 0 ? 1 : -1)
      }}
    >
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => go(-1)} disabled={cur === 0} aria-label="지난 주">
            <ChevronLeft />
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight">{weekName(Math.round((monday.getTime() - parseISO(thisMonday).getTime()) / (7 * 864e5)))}</h2>
              <span className="num text-xs text-subtle">
                {format(monday, 'M/d')} – {format(addDays(monday, 6), 'M/d')} · {cur + 1}/{weeks.length}주
              </span>
            </div>
            {w && (
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                <span className="size-2 rounded-full" style={{ background: PHASE[w.phase].color }} />
                {PHASE[w.phase].label} 단계 · {PHASE[w.phase].desc}
              </div>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={() => go(1)} disabled={cur === weeks.length - 1} aria-label="다음 주">
            <ChevronRight />
          </Button>
        </div>
        {!isThis && (
          <Button size="sm" variant="ghost" onClick={() => setIdx(startIdx)}>
            이번 주로
          </Button>
        )}

        <div className="ml-auto flex items-center gap-3">
          <div className="w-36 sm:w-44">
            <div className="num flex items-baseline justify-between text-xs">
              <span className="text-muted">{wk <= thisMonday ? '달린 거리' : '계획 거리'}</span>
              <span>
                {wk <= thisMonday && <b className={cn('font-semibold', actual >= planned * 0.85 ? 'text-good' : 'text-text')}>{actual.toFixed(0)} / </b>}
                <span className="text-muted">{planned.toFixed(0)}km</span>
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${wk <= thisMonday ? pct : 0}%` }} />
            </div>
          </div>
          <div className="relative">
            <Button variant="ghost" size="icon" onClick={() => setMenu((m) => !m)} aria-label="주간 조정">
              <MoreHorizontal />
            </Button>
            {menu && (
              <div className="absolute right-0 top-10 z-20 w-52 rounded-xl border bg-surface p-1 shadow-xl" onMouseLeave={() => setMenu(false)}>
                {editable && (
                  <>
                    <button onClick={() => (setMenu(false), onWeekAction(wk, 'lighter'))} className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2">
                      <Feather className="mt-0.5 size-4 shrink-0 text-muted" />
                      <span>
                        이 주 가볍게
                        <span className="block text-[11px] text-subtle">강훈련 하나만 남기고 거리 20%↓</span>
                      </span>
                    </button>
                    <button onClick={() => (setMenu(false), onWeekAction(wk, 'recovery'))} className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2">
                      <BedDouble className="mt-0.5 size-4 shrink-0 text-muted" />
                      <span>
                        회복 주로 바꾸기
                        <span className="block text-[11px] text-subtle">아프거나 지쳤을 때 · 모두 이지, 거리 40%↓</span>
                      </span>
                    </button>
                  </>
                )}
                <button onClick={() => (setMenu(false), onSettings())} className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2">
                  <MoreHorizontal className="mt-0.5 size-4 shrink-0 text-muted" />
                  <span>
                    플랜 설정 바꾸기
                    <span className="block text-[11px] text-subtle">훈련 요일·롱런 요일·최고 거리</span>
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-2 xl:grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => {
          const day = addDays(monday, i)
          const d = iso(day)
          return (
            <DayCard
              key={d}
              day={day}
              items={byDay.get(d) ?? []}
              extras={extrasByDay.get(d) ?? []}
              today={today}
              paces={paces}
              racePace={racePace}
              onOpen={onOpen}
            />
          )
        })}
      </div>
      <p className="mt-3 text-[11px] text-subtle md:hidden">옆으로 밀면 다른 주를 볼 수 있어요</p>
    </Card>
  )
}

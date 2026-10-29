import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { addDays, format, isToday, parseISO, startOfWeek } from 'date-fns'
import { ko } from 'date-fns/locale'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { ActivePlan, PlannedWorkout } from '@/api/planner'
import { cn } from '@/lib/utils'
import { useNow } from '@/lib/useNow'
import { KIND, PHASE, STATUS_ICON } from './workoutMeta'

/** Phone view of the plan: a vertical week-by-week list, starting at this week. */
export function PlanAgenda({ data, onOpen }: { data: ActivePlan; onOpen: (w: PlannedWorkout) => void }) {
  const now = useNow()
  const thisMonday = format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd')

  const { weeks, byDay, extrasByDay, weekInfo, currentIdx } = useMemo(() => {
    const start = startOfWeek(parseISO(data.plan.start_day), { weekStartsOn: 1 })
    const end = parseISO(data.plan.end_day)
    const ws: string[] = []
    for (let d = start; d <= end; d = addDays(d, 7)) ws.push(format(d, 'yyyy-MM-dd'))
    const byDay = new Map<string, PlannedWorkout[]>()
    data.workouts.forEach((w) => byDay.set(w.day, [...(byDay.get(w.day) ?? []), w]))
    const extrasByDay = new Map<string, ActivePlan['extras']>()
    data.extras.forEach((e) => extrasByDay.set(e.day, [...(extrasByDay.get(e.day) ?? []), e]))
    const idx = ws.findIndex((w) => w >= thisMonday)
    return { weeks: ws, byDay, extrasByDay, weekInfo: new Map(data.weeks.map((w) => [w.week_start, w])), currentIdx: idx < 0 ? ws.length - 1 : idx }
  }, [data, thisMonday])

  const [from, setFrom] = useState(currentIdx)
  const [to, setTo] = useState(Math.min(weeks.length, currentIdx + 4))
  const shown = weeks.slice(from, to)

  return (
    <div className="space-y-3">
      {from > 0 && (
        <button onClick={() => setFrom((f) => Math.max(0, f - 4))} className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed py-2 text-xs text-muted">
          <ChevronUp className="size-3.5" /> 지난 주 보기
        </button>
      )}
      {shown.map((wk) => {
        const info = weekInfo.get(wk)
        const current = wk === thisMonday
        const monday = parseISO(wk)
        return (
          <section key={wk} className={cn('overflow-hidden rounded-2xl border', current ? 'border-accent/50 bg-accent-soft/40' : 'bg-surface-2/30')}>
            <header className="flex items-center gap-2 border-b px-3 py-2">
              <span className="num text-[13px] font-semibold">
                {format(monday, 'M/d')} – {format(addDays(monday, 6), 'M/d')}
              </span>
              {current && <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-accent-fg">이번 주</span>}
              {info && (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted">
                  <span className="size-1.5 rounded-full" style={{ background: PHASE[info.phase].color }} />
                  {PHASE[info.phase].label}
                </span>
              )}
              {info && (
                <span className="num ml-auto text-xs">
                  {info.actual_km != null && wk <= thisMonday && (
                    <span className={cn('font-semibold', info.actual_km >= info.planned_km * 0.85 ? 'text-good' : 'text-text')}>{info.actual_km.toFixed(0)} / </span>
                  )}
                  <span className="text-muted">{info.planned_km.toFixed(0)}km</span>
                </span>
              )}
            </header>
            <ul className="divide-y">
              {Array.from({ length: 7 }, (_, i) => {
                const day = addDays(monday, i)
                const iso = format(day, 'yyyy-MM-dd')
                const items = byDay.get(iso) ?? []
                const extras = extrasByDay.get(iso) ?? []
                if (iso < data.plan.start_day || iso > data.plan.end_day) return null
                const today = isToday(day)
                return (
                  <li key={iso} className="flex min-h-11 items-stretch gap-3 px-3 py-1.5">
                    <div className={cn('flex w-9 shrink-0 flex-col items-center justify-center leading-none', today ? 'text-accent' : 'text-subtle')}>
                      <span className="text-[10px]">{format(day, 'EEE', { locale: ko })}</span>
                      <span className={cn('num mt-0.5 text-sm font-semibold', today && 'font-bold')}>{format(day, 'd')}</span>
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
                      {items.length === 0 && extras.length === 0 && <span className="text-xs text-subtle">—</span>}
                      {items.map((w) => {
                        const st = STATUS_ICON[w.status as keyof typeof STATUS_ICON]
                        return (
                          <button
                            key={w.id}
                            onClick={() => onOpen(w)}
                            className={cn('flex items-center gap-2 rounded-lg py-1 text-left active:bg-surface-2', w.status === 'skipped' && 'opacity-50')}
                          >
                            <span className="h-7 w-1 shrink-0 rounded-full" style={{ background: KIND[w.kind].color }} />
                            <span className="min-w-0 flex-1">
                              <span className={cn('block truncate text-sm font-medium', w.kind === 'rest' && 'text-muted')}>{w.title}</span>
                              {w.kind !== 'rest' && (
                                <span className="num block text-[11px] text-subtle">
                                  {((w.target_distance_m ?? 0) / 1000).toFixed(1)}km
                                  {w.actual_km ? <span className="text-muted"> → {w.actual_km.toFixed(1)}km</span> : null}
                                </span>
                              )}
                            </span>
                            {st && (
                              <span className={cn('grid size-5 shrink-0 place-items-center rounded-full', st.cls)} title={st.label}>
                                <st.icon className="size-3" strokeWidth={3} />
                              </span>
                            )}
                          </button>
                        )
                      })}
                      {extras.map((e) => (
                        <Link key={e.activity_id} to={`/activities/${e.activity_id}`} className="num text-[11px] text-muted">
                          + 계획 외 {e.km.toFixed(1)}km {e.name ? `· ${e.name}` : ''}
                        </Link>
                      ))}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
      {to < weeks.length && (
        <button onClick={() => setTo((t) => Math.min(weeks.length, t + 4))} className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed py-2 text-xs text-muted">
          <ChevronDown className="size-3.5" /> 다음 4주 보기 ({weeks.length - to}주 남음)
        </button>
      )}
    </div>
  )
}

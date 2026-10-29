import { useEffect, useMemo, useRef, useState } from 'react'
import { addDays, format, isToday, parseISO, startOfWeek } from 'date-fns'
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { Plus } from 'lucide-react'
import type { ActivePlan, PlannedWorkout } from '@/api/planner'
import { useCreateWorkout, usePatchWorkout } from '@/api/planner'
import { cn } from '@/lib/utils'
import { KIND, PHASE, STATUS_ICON } from './workoutMeta'
import { useNow } from '@/lib/useNow'

const DOW = ['월', '화', '수', '목', '금', '토', '일']
// minmax(0, 1fr): day columns stay equal width no matter how long a workout title is.
const COLS = 'grid grid-cols-[56px_repeat(7,minmax(0,1fr))_52px] gap-1.5'


function Chip({ w, onOpen }: { w: PlannedWorkout; onOpen: (w: PlannedWorkout) => void }) {
  const past = w.status !== 'planned'
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `w-${w.id}`, data: { w }, disabled: w.kind === 'race' })
  const st = STATUS_ICON[w.status as keyof typeof STATUS_ICON]
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onOpen(w)}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={cn(
        'group relative w-full touch-none rounded-lg border bg-surface px-2 py-1.5 text-left shadow-sm transition-shadow hover:border-border-strong hover:shadow-md',
        isDragging && 'z-20 cursor-grabbing shadow-xl ring-2 ring-accent/40',
        w.status === 'skipped' && 'opacity-50',
      )}
    >
      <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full" style={{ background: KIND[w.kind].color }} />
      <div className="flex items-start gap-1 pl-1">
        <span className="line-clamp-2 break-keep text-[11px] font-semibold leading-tight" title={w.title}>{w.title}</span>
        {st && (
          <span className={cn('ml-auto grid size-3.5 shrink-0 place-items-center rounded-full', st.cls)} title={st.label}>
            <st.icon className="size-2.5" strokeWidth={3} />
          </span>
        )}
      </div>
      <div className="num pl-1 text-[10px] text-subtle">
        {w.kind === 'rest' ? '휴식' : `${((w.target_distance_m ?? 0) / 1000).toFixed(1)}km`}
        {past && w.actual_km ? <span className="text-muted"> → {w.actual_km.toFixed(1)}</span> : null}
      </div>
    </button>
  )
}

function DayCell({ day, items, extras, inPlan, onOpen, onAdd }: {
  day: Date
  items: PlannedWorkout[]
  extras: { km: number; activity_id: number }[]
  inPlan: boolean
  onOpen: (w: PlannedWorkout) => void
  onAdd: (day: string) => void
}) {
  const iso = format(day, 'yyyy-MM-dd')
  const { setNodeRef, isOver } = useDroppable({ id: iso, disabled: !inPlan })
  const today = isToday(day)
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'group/cell relative flex min-h-[86px] flex-col gap-1 rounded-xl border p-1.5 transition-colors',
        inPlan ? 'bg-surface-2/40' : 'border-transparent bg-transparent opacity-40',
        today && 'border-accent/60 bg-accent-soft',
        isOver && 'border-accent bg-accent-soft',
      )}
    >
      <div className="flex items-center justify-between px-0.5">
        <span className={cn('num text-[11px]', today ? 'font-bold text-accent' : 'text-subtle')}>{format(day, 'd')}</span>
        {inPlan && items.length === 0 && (
          <button onClick={() => onAdd(iso)} className="grid size-4 place-items-center rounded text-subtle opacity-0 hover:bg-surface-3 hover:text-text group-hover/cell:opacity-100" aria-label="훈련 추가">
            <Plus className="size-3" />
          </button>
        )}
      </div>
      {items.map((w) => <Chip key={w.id} w={w} onOpen={onOpen} />)}
      {extras.map((e) => (
        <a key={e.activity_id} href={`/activities/${e.activity_id}`} className="num rounded-md bg-surface-3/70 px-1.5 py-0.5 text-[10px] text-muted hover:text-text">
          + {e.km.toFixed(1)}km
        </a>
      ))}
    </div>
  )
}

export function PlanCalendar({ data, onOpen }: { data: ActivePlan; onOpen: (w: PlannedWorkout) => void }) {
  const now = useNow()
  const patch = usePatchWorkout()
  const add = useCreateWorkout()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const [error, setError] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  const { weeks, byDay, extrasByDay, weekInfo } = useMemo(() => {
    const start = startOfWeek(parseISO(data.plan.start_day), { weekStartsOn: 1 })
    const end = parseISO(data.plan.end_day)
    const ws: Date[] = []
    for (let d = start; d <= end; d = addDays(d, 7)) ws.push(d)
    const byDay = new Map<string, PlannedWorkout[]>()
    data.workouts.forEach((w) => byDay.set(w.day, [...(byDay.get(w.day) ?? []), w]))
    const extrasByDay = new Map<string, { km: number; activity_id: number }[]>()
    data.extras.forEach((e) => extrasByDay.set(e.day, [...(extrasByDay.get(e.day) ?? []), e]))
    const weekInfo = new Map(data.weeks.map((w) => [w.week_start, w]))
    return { weeks: ws, byDay, extrasByDay, weekInfo }
  }, [data])

  // Open on the current week.
  useEffect(() => {
    const el = scroller.current?.querySelector('[data-current-week="true"]') as HTMLElement | null
    if (el && scroller.current) scroller.current.scrollTop = el.offsetTop - 60
  }, [])

  const onDragEnd = (e: DragEndEvent) => {
    const w = e.active.data.current?.w as PlannedWorkout | undefined
    const to = e.over?.id as string | undefined
    if (!w || !to || to === w.day) return
    if ((byDay.get(to) ?? []).some((x) => x.kind !== 'rest')) {
      setError('그날에는 이미 훈련이 있어요. 먼저 비워 주세요.')
      setTimeout(() => setError(null), 2500)
      return
    }
    patch.mutate({ id: w.id, day: to })
  }

  const startIso = data.plan.start_day
  const endIso = data.plan.end_day
  const thisMonday = format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd')

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      {error && <div className="mb-2 rounded-lg bg-warn/15 px-3 py-2 text-xs text-warn">{error}</div>}
      {/* One scroll container for header + weeks so the columns can't drift (scrollbar width, long titles). */}
      <div ref={scroller} className="relative max-h-[680px] overflow-auto">
        <div className="min-w-[620px] px-1 pb-2">
          <div className={cn(COLS, 'sticky top-0 z-10 bg-surface pb-2 pt-1 text-center text-[11px] font-semibold text-subtle')}>
            <span />
            {DOW.map((d) => <span key={d}>{d}</span>)}
            <span>주간</span>
          </div>
          <div className="space-y-1.5">
            {weeks.map((monday) => {
              const wk = format(monday, 'yyyy-MM-dd')
              const info = weekInfo.get(wk)
              const current = wk === thisMonday
              return (
                <div key={wk} data-current-week={current} className={cn(COLS, 'rounded-2xl', current && 'bg-surface-2/50 ring-1 ring-border-strong')}>
                  <div className="flex flex-col justify-center pl-1">
                    <span className="num text-[11px] text-subtle">{format(monday, 'M/d')}</span>
                    {info && (
                      <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold">
                        <span className="size-1.5 rounded-full" style={{ background: PHASE[info.phase].color }} />
                        {PHASE[info.phase].label}
                      </span>
                    )}
                  </div>
                  {Array.from({ length: 7 }, (_, i) => {
                    const day = addDays(monday, i)
                    const iso = format(day, 'yyyy-MM-dd')
                    return (
                      <DayCell
                        key={iso}
                        day={day}
                        items={byDay.get(iso) ?? []}
                        extras={extrasByDay.get(iso) ?? []}
                        inPlan={iso >= startIso && iso <= endIso}
                        onOpen={onOpen}
                        onAdd={(d) => add.mutate({ day: d })}
                      />
                    )
                  })}
                  <div className="flex flex-col items-end justify-center pr-1 text-right">
                    {info && (
                      <>
                        <span className="num text-xs font-bold">{info.planned_km.toFixed(0)}<span className="text-[10px] font-medium text-subtle">km</span></span>
                        {info.actual_km != null && wk <= thisMonday && (
                          <span className={cn('num text-[10px]', info.actual_km >= info.planned_km * 0.85 ? 'text-good' : 'text-subtle')}>실제 {info.actual_km.toFixed(0)}</span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </DndContext>
  )
}

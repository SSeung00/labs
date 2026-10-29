import { useEffect, useMemo, useRef, useState } from 'react'
import { addDays, format, startOfWeek, subWeeks } from 'date-fns'
import { ko } from 'date-fns/locale'
import type { DayTotal } from '@/api/activities'
import { RunTypeDot } from '@/components/runtype/RunTypePicker'
import { RUN_TYPE, RUN_TYPES } from '@/lib/runTypes'
import { fmtDuration, fmtKm } from '@/lib/format'
import { useNow } from '@/lib/useNow'

const WEEKS = 53
const CELL = 13
const GAP = 3
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/** One cell per day, coloured by that day's most significant training type. */
export function YearHeatmap({ data }: { data: DayTotal[] }) {
  const now = useNow()
  const [hover, setHover] = useState<{ x: number; y: number; day: string } | null>(null)
  const byDay = useMemo(() => new Map(data.map((d) => [d.day, d])), [data])
  const scroller = useRef<HTMLDivElement>(null)
  // On narrow screens, open on the most recent weeks.
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [])

  const { days, months } = useMemo(() => {
    const start = startOfWeek(subWeeks(now, WEEKS - 1), { weekStartsOn: 1 })
    const today = format(now, 'yyyy-MM-dd')
    const cells: { key: string; col: number; row: number; future: boolean }[] = []
    const monthLabels: { col: number; label: string }[] = []
    let lastMonth = -1
    for (let w = 0; w < WEEKS; w++) {
      for (let d = 0; d < 7; d++) {
        const date = addDays(start, w * 7 + d)
        const key = format(date, 'yyyy-MM-dd')
        cells.push({ key, col: w, row: d, future: key > today })
        if (d === 0 && date.getMonth() !== lastMonth) {
          lastMonth = date.getMonth()
          monthLabels.push({ col: w, label: format(date, 'M월') })
        }
      }
    }
    return { days: cells, months: monthLabels }
  }, [now])

  const LEFT = 18
  const width = WEEKS * (CELL + GAP)
  const height = 7 * (CELL + GAP)
  const hovered = hover ? byDay.get(hover.day) : undefined
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    data.forEach((d) => d.run_type && (c[d.run_type] = (c[d.run_type] ?? 0) + 1))
    return c
  }, [data])

  return (
    <div className="relative" data-heatmap>
      <div ref={scroller} className="overflow-x-auto pb-1">
        <svg viewBox={`0 0 ${width + LEFT} ${height + 20}`} className="block w-full min-w-[620px]" role="img" aria-label="최근 1년 일별 훈련 종류">
          {months.map((m) => (
            <text key={`${m.col}-${m.label}`} x={LEFT + m.col * (CELL + GAP)} y={10} className="fill-[var(--text-subtle)] text-[10px]">
              {m.label}
            </text>
          ))}
          {DOW.map((l, i) => (
            <text key={i} x={0} y={18 + i * (CELL + GAP) + CELL - 3} className="fill-[var(--text-subtle)] text-[9px] font-medium">
              {l}
            </text>
          ))}
          <g transform={`translate(${LEFT}, 18)`}>
            {days.map((c) => {
              const t = byDay.get(c.key)
              const type = t?.run_type
              const x = c.col * (CELL + GAP)
              const y = c.row * (CELL + GAP)
              return (
                <g
                  key={c.key}
                  className="cursor-pointer"
                  onMouseEnter={(e) => {
                    if (c.future) return
                    const host = (e.currentTarget as SVGGElement).closest('[data-heatmap]')
                    if (!host) return
                    const box = host.getBoundingClientRect()
                    const r = (e.currentTarget as SVGGElement).getBoundingClientRect()
                    setHover({ x: r.left - box.left + r.width / 2, y: r.top - box.top, day: c.key })
                  }}
                  onMouseLeave={() => setHover(null)}
                >
                  <rect
                    x={x}
                    y={y}
                    width={CELL}
                    height={CELL}
                    rx={3}
                    fill={c.future ? 'transparent' : !t ? 'var(--surface-3)' : type ? RUN_TYPE[type].color : 'var(--text-subtle)'}
                    className="transition-opacity hover:opacity-75"
                  />
                  {/* Race: ink cell plus a ring — shape, not just colour, carries the identity. */}
                  {type === 'race' && <rect x={x - 1.5} y={y - 1.5} width={CELL + 3} height={CELL + 3} rx={4} fill="none" stroke="var(--accent)" strokeWidth={1.5} />}
                </g>
              )
            })}
          </g>
        </svg>
      </div>

      {hover && (
        <div
          className="pointer-events-none absolute z-10 min-w-40 -translate-x-1/2 -translate-y-full rounded-lg border bg-surface px-3 py-2 text-xs shadow-card"
          style={{ left: hover.x, top: hover.y - 6 }}
        >
          <div className="font-medium">{format(new Date(hover.day), 'M월 d일 (EEE)', { locale: ko })}</div>
          {hovered ? (
            <>
              <ul className="mt-1 space-y-0.5">
                {hovered.runs.map((r) => (
                  <li key={r.id} className="flex items-center gap-1.5 text-muted">
                    <RunTypeDot type={r.run_type} className="size-2" />
                    <span className="truncate">{r.run_type ? RUN_TYPE[r.run_type].label : '미분류'}</span>
                    <span className="num ml-auto pl-2">{r.km.toFixed(1)}km</span>
                  </li>
                ))}
              </ul>
              <div className="num mt-1 border-t pt-1 text-subtle">
                합계 {fmtKm(hovered.distance_m, 1)} km · {fmtDuration(hovered.duration_s)}
              </div>
            </>
          ) : (
            <div className="mt-0.5 text-subtle">휴식</div>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[11px] text-muted">
        {RUN_TYPES.map((t) => (
          <span key={t.key} className="inline-flex items-center gap-1.5">
            <RunTypeDot type={t.key} />
            {t.label}
            <span className="num text-subtle">{counts[t.key] ?? 0}일</span>
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 text-subtle">
          <span className="inline-block size-2.5 rounded-[3px] bg-surface-3" />
          휴식
        </span>
      </div>
    </div>
  )
}

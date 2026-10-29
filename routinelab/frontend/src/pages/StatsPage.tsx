import { useMemo, useState, type CSSProperties } from 'react'
import { ChevronLeft, ChevronRight, Flame, Trophy } from 'lucide-react'
import type { EChartsOption } from 'echarts'
import type { HabitStats, HeatCode, Signal, Stats } from '@/api/types'
import { useSettings, useStats } from '@/api/rl'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageSkeleton } from '@/components/layout/PageSkeleton'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Stat } from '@/components/ui/controls'
import { EChart } from '@/components/charts/EChart'
import { alpha, baseAxis, baseTooltip, useChartTheme } from '@/components/charts/theme'
import { CATEGORY } from '@/components/HabitRow'
import { LIGHT_COLOR, LIGHT_LABEL } from '@/components/SignalLight'
import { addDays, fmtDay, parseDay, shortDay, WEEKDAYS_MON } from '@/lib/day'
import { cn } from '@/lib/utils'

const pct = (v: number | null | undefined) => (v == null ? '–' : `${Math.round(v * 100)}%`)

function SignalCalendar({ calendar, today }: { calendar: Signal[]; today: string }) {
  const byDay = useMemo(() => new Map(calendar.map((c) => [c.day, c])), [calendar])
  const t = parseDay(today)
  const [ym, setYm] = useState({ y: t.getFullYear(), m: t.getMonth() })
  const first = new Date(ym.y, ym.m, 1)
  const lead = (first.getDay() + 6) % 7
  const days = new Date(ym.y, ym.m + 1, 0).getDate()
  const earliest = calendar[0]?.day ?? today
  const canPrev = fmtDay(first) > earliest
  const canNext = ym.y < t.getFullYear() || (ym.y === t.getFullYear() && ym.m < t.getMonth())
  const shift = (n: number) => setYm(({ y, m }) => ({ y: m + n < 0 ? y - 1 : m + n > 11 ? y + 1 : y, m: (m + n + 12) % 12 }))
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => fmtDay(new Date(ym.y, ym.m, i + 1)))]
  const monthDays = cells.filter(Boolean).map((d) => byDay.get(d as string)).filter(Boolean) as Signal[]
  const greens = monthDays.filter((c) => c.color === 'green').length

  return (
    <Card>
      <CardHeader
        title="신호등 달력"
        hint={`이번 달 초록불 ${greens}일`}
        action={
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="size-8" onClick={() => shift(-1)} disabled={!canPrev} aria-label="이전 달">
              <ChevronLeft />
            </Button>
            <span className="w-20 text-center text-sm font-semibold num">
              {ym.y}.{String(ym.m + 1).padStart(2, '0')}
            </span>
            <Button variant="ghost" size="icon" className="size-8" onClick={() => shift(1)} disabled={!canNext} aria-label="다음 달">
              <ChevronRight />
            </Button>
          </div>
        }
      />
      <CardBody>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-subtle">
          {WEEKDAYS_MON.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (!d) return <span key={`x${i}`} />
            const c = byDay.get(d)
            const color = c?.color ?? 'none'
            const lit = color !== 'none' && color !== 'off'
            return (
              <span
                key={d}
                title={c ? `${shortDay(d)} ${LIGHT_LABEL[color]}${c.total ? ` ${c.done}/${c.total}` : ''}` : shortDay(d)}
                className={cn(
                  'grid aspect-square place-items-center rounded-full text-[11px] font-semibold num',
                  lit ? 'text-black/70' : 'text-subtle',
                  d === today && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
                  d > today && 'opacity-40',
                )}
                style={lit ? { background: LIGHT_COLOR[color] } : { background: 'var(--surface-2)' }}
              >
                {parseDay(d).getDate()}
              </span>
            )
          })}
        </div>
        <div className="mt-3 flex flex-wrap justify-center gap-3 text-[11px] text-subtle">
          {(['green', 'yellow', 'red', 'rest'] as const).map((k) => (
            <span key={k} className="flex items-center gap-1">
              <span className="size-2.5 rounded-full" style={{ background: LIGHT_COLOR[k] }} />
              {LIGHT_LABEL[k]}
            </span>
          ))}
        </div>
      </CardBody>
    </Card>
  )
}

function WeeklyChart({ weeks, green }: { weeks: Stats['weeks']; green: number }) {
  const t = useChartTheme()
  const option: EChartsOption = {
    grid: { left: 8, right: 8, top: 16, bottom: 4, containLabel: true },
    tooltip: { ...baseTooltip(t), trigger: 'axis', valueFormatter: (v) => `${v}%` },
    xAxis: { type: 'category', data: weeks.map((w) => `${parseDay(w.start).getMonth() + 1}/${parseDay(w.start).getDate()}`), ...baseAxis(t), splitLine: { show: false } },
    yAxis: { type: 'value', max: 100, ...baseAxis(t), axisLabel: { ...baseAxis(t).axisLabel, formatter: '{value}%' } },
    series: [
      {
        type: 'bar',
        barMaxWidth: 22,
        data: weeks.map((w) => {
          const v = w.rate == null ? 0 : Math.round(w.rate * 100)
          const c = w.rate == null ? t.grid : w.rate >= green ? t.good : w.rate >= 0.3 ? t.warn : t.bad
          return { value: v, itemStyle: { color: c, borderRadius: [6, 6, 2, 2] } }
        }),
        markLine: { silent: true, symbol: 'none', lineStyle: { color: alpha(t.good, 0.6), type: 'dashed' }, label: { show: false }, data: [{ yAxis: Math.round(green * 100) }] },
      },
    ],
  }
  return (
    <Card>
      <CardHeader title="주간 달성률" hint="최근 12주 · 점선이 초록불 기준" />
      <CardBody className="pt-1">
        <EChart option={option} style={{ height: 190 }} />
      </CardBody>
    </Card>
  )
}

function heatStyle(code: HeatCode, color: string): CSSProperties {
  switch (code) {
    case 'done':
      return { background: color }
    case 'easy':
      return { background: `color-mix(in oklch, ${color} 50%, transparent)` }
    case 'miss':
      return { background: 'color-mix(in oklch, var(--bad) 22%, transparent)' }
    case 'skip':
      return { background: 'var(--surface-3)' }
    case 'rest':
      return { background: 'color-mix(in oklch, var(--rest) 30%, transparent)' }
    case 'todo':
      return { boxShadow: `inset 0 0 0 1.5px ${color}` }
    case 'future':
      return { background: 'transparent' }
    default:
      return { background: 'var(--surface-2)' }
  }
}

function HabitCard({ h }: { h: HabitStats }) {
  const color = CATEGORY[h.category]?.color ?? 'var(--accent)'
  const weeks = h.heat.length / 7
  return (
    <Card>
      <CardBody className="space-y-3 pt-4">
        <div className="flex items-center gap-2.5">
          <span className="text-xl">{h.emoji}</span>
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{h.name}</span>
          <span className="text-sm font-bold num" style={{ color }}>
            {pct(h.rate30)}
          </span>
        </div>
        <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))`, gridTemplateRows: 'repeat(7, auto)', gridAutoFlow: 'column' }}>
          {h.heat.map((code, i) => (
            <span key={i} className="aspect-square rounded-[3px]" style={heatStyle(code, color)} title={`${shortDay(addDays(h.heat_start, i))} ${code}`} />
          ))}
        </div>
        <div className="flex items-center gap-4 text-xs text-muted">
          <span className="flex items-center gap-1">
            <Flame className={cn('size-3.5', h.streak.current ? 'text-warn' : 'text-subtle')} />
            지금 <b className="text-text num">{h.streak.current}</b>
          </span>
          <span className="flex items-center gap-1">
            <Trophy className="size-3.5 text-subtle" />
            최고 <b className="text-text num">{h.best}</b>
          </span>
          <span className="ml-auto text-subtle num">총 {h.total_done}번</span>
        </div>
      </CardBody>
    </Card>
  )
}

function BodyChart({ body }: { body: Stats['body'] }) {
  const t = useChartTheme()
  const days = body.map((b) => shortDay(b.day))
  const hasWeight = body.some((b) => b.weight != null)
  const option: EChartsOption = {
    grid: { left: 8, right: 8, top: 28, bottom: 4, containLabel: true },
    legend: { top: 0, right: 0, textStyle: { color: t.muted, fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    tooltip: { ...baseTooltip(t), trigger: 'axis' },
    xAxis: { type: 'category', data: days, ...baseAxis(t), splitLine: { show: false } },
    yAxis: [
      { type: 'value', min: 0, max: 12, ...baseAxis(t), name: '' },
      { type: 'value', min: 1, max: 5, show: false },
    ],
    series: [
      { name: '잠(시간)', type: 'bar', data: body.map((b) => b.sleep_hours), itemStyle: { color: alpha(t.accent, 0.45), borderRadius: [4, 4, 0, 0] }, barMaxWidth: 10 },
      { name: '기분', type: 'line', yAxisIndex: 1, data: body.map((b) => b.mood), smooth: true, connectNulls: true, symbolSize: 5, itemStyle: { color: t.good }, lineStyle: { width: 2 } },
      { name: '에너지', type: 'line', yAxisIndex: 1, data: body.map((b) => b.energy), smooth: true, connectNulls: true, symbolSize: 5, itemStyle: { color: t.warn }, lineStyle: { width: 2 } },
    ],
  }
  const weight: EChartsOption = {
    grid: { left: 8, right: 8, top: 12, bottom: 4, containLabel: true },
    tooltip: { ...baseTooltip(t), trigger: 'axis', valueFormatter: (v) => `${v}kg` },
    xAxis: { type: 'category', data: days, ...baseAxis(t), splitLine: { show: false } },
    yAxis: { type: 'value', scale: true, ...baseAxis(t) },
    series: [{ type: 'line', data: body.map((b) => b.weight), connectNulls: true, smooth: true, symbolSize: 5, itemStyle: { color: t.accent }, areaStyle: { color: alpha(t.accent, 0.1) } }],
  }
  return (
    <Card>
      <CardHeader title="컨디션" hint="회고에 남긴 잠 · 기분 · 에너지 (최근 90일)" />
      <CardBody className="pt-1">
        <EChart option={option} style={{ height: 200 }} />
        {hasWeight && (
          <>
            <div className="mt-3 text-xs font-medium text-muted">몸무게</div>
            <EChart option={weight} style={{ height: 140 }} />
          </>
        )}
      </CardBody>
    </Card>
  )
}

export function StatsPage() {
  const { data } = useStats()
  const { data: settings } = useSettings()
  if (!data) return <PageSkeleton />
  const week = data.weeks[data.weeks.length - 1]
  const last30 = data.calendar.slice(-30)
  const green30 = last30.filter((c) => c.color === 'green').length
  const greenAt = settings?.green_at ?? 0.6

  return (
    <div className="space-y-4">
      <PageHeader title="기록" subtitle="완벽한 날보다 초록불이 자주 켜지는 달을 목표로." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="초록불 연속" value={`${data.streak.current}일`} sub={`최고 ${data.streak.best}일`} icon={<Flame className="size-3.5 text-warn" />} />
        <Stat label="이번 주 달성률" value={pct(week?.rate)} sub={week ? `${week.done}/${week.total} · 초록불 ${week.green_days}일` : undefined} />
        <Stat label="최근 30일 초록불" value={`${green30}일`} sub={`${Math.round((green30 / 30) * 100)}%`} />
        <Stat label="배지" value={`${data.badges.filter((b) => b.earned).length}/${data.badges.length}`} sub="아래에서 확인" />
      </div>

      <div className="grid gap-4 split:grid-cols-2 split:items-start">
        <SignalCalendar calendar={data.calendar} today={data.today} />
        <WeeklyChart weeks={data.weeks} green={greenAt} />
      </div>

      {data.habits.length > 0 && (
        <>
          <h2 className="pt-2 text-sm font-semibold text-muted">루틴별 · 최근 18주</h2>
          <div className="grid gap-3 split:grid-cols-2 xl:grid-cols-3">
            {data.habits.map((h) => (
              <HabitCard key={h.id} h={h} />
            ))}
          </div>
          <p className="text-center text-[11px] text-subtle">
            진한 칸 = 완료 · 옅은 칸 = 가볍게 · 붉은 칸 = 놓침 · 회색 = 쉬었거나 할 날이 아님
          </p>
        </>
      )}

      {data.body.length > 1 && <BodyChart body={data.body} />}

      <Card>
        <CardHeader title="배지" hint="마일스톤마다 하나씩" />
        <CardBody>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {data.badges.map((b) => (
              <div key={b.key} className={cn('rounded-xl border p-3', b.earned ? 'bg-accent-soft/50' : 'opacity-60')}>
                <div className={cn('text-2xl', !b.earned && 'grayscale')}>{b.emoji}</div>
                <div className="mt-1 text-[13px] font-semibold">{b.title}</div>
                <div className="text-[11px] leading-snug text-subtle">{b.desc}</div>
                {!b.earned && (
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${b.progress * 100}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

import { useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import type { CoreSkill, Forecast, LearningRate, SkillEstimate } from '@/api/types'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Segmented } from '@/components/ui/controls'
import { EChart } from '@/components/charts/EChart'
import { baseAxis, baseTooltip, useChartTheme } from '@/components/charts/theme'
import { cefr } from '@/lib/level'
import { cn } from '@/lib/utils'

// Categorical slots 1–4 of the validated reference palette (same skill → same colour as on 기록).
export const SKILL_COLORS = {
  light: { reading: '#2a78d6', listening: '#eb6834', speaking: '#1baf7a', writing: '#eda100' },
  dark: { reading: '#3987e5', listening: '#d95926', speaking: '#199e70', writing: '#c98500' },
}
export const SKILLS: [CoreSkill, string][] = [
  ['reading', '읽기'],
  ['listening', '듣기'],
  ['speaking', '말하기'],
  ['writing', '쓰기'],
]

const fmtDate = (d: string | null | undefined) => {
  if (!d) return '–'
  if (d === 'reached') return '도달'
  const [y, m] = d.split('-')
  return `${y.slice(2)}년 ${Number(m)}월`
}
const lv = (v: number | null | undefined) => (v == null ? '–' : `${cefr(v)} (${v.toFixed(1)})`)

function Chart({ f, skill }: { f: Forecast; skill: CoreSkill | 'overall' }) {
  const t = useChartTheme()
  const colors = t.dark ? SKILL_COLORS.dark : SKILL_COLORS.light
  const color = skill === 'overall' ? t.accent : colors[skill]
  const option = useMemo<EChartsOption>(() => {
    // Past estimate (with its 80% range) and the projections.
    let past: [string, number, number][] = []
    if (skill === 'overall') {
      const keys = Object.keys(f.estimate_series) as CoreSkill[]
      const byDay = new Map<string, number[]>()
      for (const k of keys) for (const [d, v] of f.estimate_series[k] ?? []) byDay.set(d, [...(byDay.get(d) ?? []), v])
      past = [...byDay.entries()].filter(([, vs]) => vs.length === keys.length).map(([d, vs]) => [d, vs.reduce((a, b) => a + b, 0) / vs.length, 0])
    } else past = f.estimate_series[skill] ?? []
    const key = skill === 'overall' ? 'overall' : skill
    const sdKey = `${key}_sd`
    const pace = f.series.pace.filter((r) => r[key] != null)
    const plan = (f.series.plan ?? []).filter((r) => r[key] != null)
    const goal = skill === 'overall' ? f.overall.goal : f.goal[skill]
    const band = (rows: { d: string; v: number; sd: number }[], name: string, opacity: number) => [
      { name: `${name}-lo`, type: 'line' as const, data: rows.map((r) => [r.d, Math.max(1, r.v - 1.28 * r.sd)]), stack: name, symbol: 'none', lineStyle: { opacity: 0 }, silent: true, tooltip: { show: false } },
      { name: `${name}-hi`, type: 'line' as const, data: rows.map((r) => [r.d, Math.min(6, r.v + 1.28 * r.sd) - Math.max(1, r.v - 1.28 * r.sd)]), stack: name, symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { color, opacity }, silent: true, tooltip: { show: false } },
    ]
    const now = pace[0]
    const series: EChartsOption['series'] = [
      ...(skill !== 'overall' ? band(past.map(([d, v, sd]) => ({ d, v, sd })), 'pastband', 0.12) : []),
      ...(skill !== 'overall' ? band(pace.map((r) => ({ d: r.d, v: r[key] as number, sd: (r[sdKey] as number) ?? 0 })), 'paceband', 0.08) : []),
      { name: '추정 실력', type: 'line', data: past.map(([d, v]) => [d, v]), symbol: 'none', lineStyle: { width: 2.5, color }, itemStyle: { color } },
      {
        name: '지금 페이스',
        type: 'line',
        data: [...(past.length && now ? [[past[past.length - 1][0], past[past.length - 1][1]]] : []), ...pace.map((r) => [r.d, r[key]])],
        symbol: 'none',
        lineStyle: { width: 2, type: 'dashed', color },
        itemStyle: { color },
        markLine: {
          silent: true,
          symbol: 'none',
          label: { color: t.muted, fontSize: 11 },
          data: [
            { yAxis: goal, lineStyle: { color: t.good, type: 'solid', width: 1.5 }, label: { formatter: `목표 ${cefr(goal)}`, position: 'insideEndTop' } },
            { xAxis: f.target_date, lineStyle: { color: t.subtle, type: 'dotted' }, label: { formatter: '목표일', position: 'insideEndTop' } },
          ],
        },
      },
      ...(plan.length
        ? [{ name: '계획대로', type: 'line' as const, data: plan.map((r) => [r.d, r[key]]), symbol: 'none', lineStyle: { width: 2, type: 'dotted' as const, color: t.text }, itemStyle: { color: t.text } }]
        : []),
    ]
    const vals = [...past.map((p) => p[1]), ...pace.map((r) => r[key] as number)]
    const min = Math.max(1, Math.floor((Math.min(...vals, goal) - 0.4) * 2) / 2)
    return {
      grid: { left: 40, right: 16, top: 24, bottom: 28 },
      legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 3, textStyle: { color: t.muted, fontSize: 11 }, data: ['추정 실력', '지금 페이스', ...(plan.length ? ['계획대로'] : [])] },
      tooltip: { ...baseTooltip(t), trigger: 'axis', valueFormatter: (v) => (typeof v === 'number' ? `${cefr(v)} (${v.toFixed(2)})` : String(v)) },
      xAxis: { type: 'time', ...baseAxis(t), splitLine: { show: false } },
      yAxis: {
        type: 'value',
        min,
        max: 6,
        interval: 0.5,
        ...baseAxis(t),
        axisLabel: { ...baseAxis(t).axisLabel, formatter: (v: number) => (Number.isInteger(v) ? ['', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'][v] : '') },
      },
      series,
    }
  }, [f, skill, t, color])
  return <EChart option={option} style={{ height: 260 }} />
}

/** The skill estimate (with its uncertainty) and where the current pace / the plan leads by the target date. */
export function ForecastCard({ f, detail, rate }: { f: Forecast; detail: Record<CoreSkill, SkillEstimate | null>; rate: LearningRate }) {
  const [skill, setSkill] = useState<CoreSkill | 'overall'>('overall')
  const known = SKILLS.filter(([k]) => f.skills[k])
  if (!known.length)
    return (
      <Card>
        <CardHeader title="실력 예측" />
        <CardBody className="text-sm text-muted">레벨 진단을 마치면 기능별 실력 추정과 목표일 예측이 여기에 나와요.</CardBody>
      </Card>
    )
  const scen = f.has_plan ? 'plan' : 'pace'
  return (
    <Card>
      <CardHeader
        title="실력 예측"
        hint={`공부한 시간과 근거(진단·대화·퀴즈·첨삭·교재 점수)로 매일 다시 계산해요 · 개인 학습 속도 ×${rate.rate.toFixed(2)}${rate.weight < 0.3 ? ' (근거가 쌓이면 보정돼요)' : ''}`}
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border bg-surface-2/40 p-3">
            <div className="text-xs text-subtle">지금 종합</div>
            <div className="num text-lg font-bold">{lv(f.overall.now)}</div>
          </div>
          <div className="rounded-xl border bg-surface-2/40 p-3">
            <div className="text-xs text-subtle">목표일 예상 (지금 페이스)</div>
            <div className="num text-lg font-bold">{lv(f.overall.pace)}</div>
          </div>
          <div className="rounded-xl border bg-surface-2/40 p-3">
            <div className="text-xs text-subtle">목표일 예상 (계획대로)</div>
            <div className="num text-lg font-bold">{f.has_plan ? lv(f.overall.plan) : '계획 없음'}</div>
          </div>
          <div className="rounded-xl border bg-surface-2/40 p-3">
            <div className="text-xs text-subtle">목표 · D-{f.days_left}</div>
            <div className="num text-lg font-bold">{lv(f.overall.goal)}</div>
          </div>
        </div>
        <Segmented
          size="sm"
          value={skill}
          onChange={setSkill}
          options={[{ value: 'overall' as const, label: '종합' }, ...known.map(([k, label]) => ({ value: k, label }))]}
        />
        <Chart f={f} skill={skill} />
        {f.basis.assumed && <p className="text-xs text-subtle">아직 공부 기록이 3일이 안 돼서, 하루 계획 시간을 기본 비율로 나눠 예측했어요.</p>}
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs text-subtle">
                <th className="px-1 py-1.5 font-medium">기능</th>
                <th className="px-1 py-1.5 font-medium">지금 (80% 범위)</th>
                <th className="px-1 py-1.5 font-medium">신뢰도 · 마지막 근거</th>
                <th className="px-1 py-1.5 font-medium">목표일 예상</th>
                <th className="px-1 py-1.5 font-medium">C1 · C2 예상</th>
                <th className="px-1 py-1.5 font-medium">하루 학습 (지금 / 필요)</th>
              </tr>
            </thead>
            <tbody>
              {known.map(([k, label]) => {
                const s = f.skills[k]!
                const d = detail[k]
                const sc = s[scen] ?? s.pace
                const enough = s.needed_hours_per_day <= (sc.hours_per_day || 0) + 0.01
                return (
                  <tr key={k} className="border-t">
                    <td className="px-1 py-2 font-medium">{label}</td>
                    <td className="num px-1 py-2">
                      <span className="font-semibold">{cefr(s.now)}</span> <span className="text-subtle">{s.now.toFixed(2)}</span>
                      {d && (
                        <span className="ml-1 text-xs text-subtle">
                          ({d.low.toFixed(1)}–{d.high.toFixed(1)})
                        </span>
                      )}
                    </td>
                    <td className="px-1 py-2 text-xs">
                      {d && (
                        <>
                          <span className={cn('font-medium', d.confidence === '높음' ? 'text-good' : d.confidence === '보통' ? 'text-text' : 'text-warn')}>{d.confidence}</span>
                          <span className="text-subtle"> · {d.last_source} {d.days_since === 0 ? '오늘' : `${d.days_since}일 전`}</span>
                        </>
                      )}
                    </td>
                    <td className="num px-1 py-2">
                      <span className="font-semibold">{cefr(sc.at_target)}</span> <span className="text-xs text-subtle">({sc.low.toFixed(1)}–{sc.high.toFixed(1)})</span>
                    </td>
                    <td className="num px-1 py-2 text-xs">
                      {fmtDate(sc.c1)} · {fmtDate(sc.c2)}
                    </td>
                    <td className="num px-1 py-2 text-xs">
                      <span>{Math.round(sc.hours_per_day * 60)}분</span> / <span className={cn('font-semibold', enough ? 'text-good' : 'text-warn')}>{Math.round(s.needed_hours_per_day * 60)}분</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs leading-relaxed text-subtle">
          하루 학습은 그 기능을 실제로 훈련한 '유효 시간'이에요 (예: 듣기 = 듣기 시간 + 대화의 절반 + 읽기·복습 일부). 근거가 오래되면 범위가 넓어져요 — 대화 리포트, 듣기 먼저 퀴즈, 쓰기 첨삭, 교재 점수가 들어올 때마다 좁혀져요.
        </p>
      </CardBody>
    </Card>
  )
}

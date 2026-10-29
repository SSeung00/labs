import { useMemo, useState } from 'react'
import type { StreamData } from '@/api/activities'
import { EChart } from '@/components/charts/EChart'
import { alpha, baseAxis, baseTooltip, useChartTheme, type ChartTheme } from '@/components/charts/theme'
import { fmtDuration, fmtPaceSec } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useHoverT } from './hover'

type Key = 'pace' | 'hr' | 'alt' | 'cad' | 'power' | 'gct' | 'vo' | 'stride'

interface Spec {
  key: Key
  label: string
  unit: string
  color: (t: ChartTheme) => string
  fmt: (v: number) => string
  inverse?: boolean
  area?: boolean
  optional?: boolean
}

// Each metric gets its own panel on a shared x-axis (small multiples, never a dual axis).
const SPECS: Spec[] = [
  { key: 'pace', label: '페이스', unit: '/km', color: (t) => t.accent, fmt: fmtPaceSec, inverse: true },
  { key: 'hr', label: '심박', unit: 'bpm', color: (t) => t.fatigue, fmt: (v) => `${Math.round(v)}` },
  { key: 'alt', label: '고도', unit: 'm', color: (t) => t.subtle, fmt: (v) => `${v.toFixed(0)}`, area: true },
  { key: 'cad', label: '케이던스', unit: 'spm', color: (t) => t.fitness, fmt: (v) => `${Math.round(v)}` },
  { key: 'power', label: '파워', unit: 'W', color: (t) => t.warn, fmt: (v) => `${Math.round(v)}`, optional: true },
  { key: 'gct', label: '지면 접촉', unit: 'ms', color: (t) => t.form, fmt: (v) => `${Math.round(v)}`, optional: true },
  { key: 'vo', label: '수직 진폭', unit: 'mm', color: (t) => t.form, fmt: (v) => v.toFixed(1), optional: true },
  { key: 'stride', label: '보폭', unit: 'm', color: (t) => t.fitness, fmt: (v) => v.toFixed(2), optional: true },
]

const GROUP = 'activity-streams'

function percentile(vals: number[], q: number) {
  const s = vals.filter((v) => v != null && isFinite(v)).sort((a, b) => a - b)
  return s.length ? s[Math.floor(q * (s.length - 1))] : 0
}

function Panel({ spec, x, y, xMode, t, isLast, tSeries }: {
  spec: Spec
  x: (number | null)[]
  y: (number | null)[]
  xMode: 'dist' | 't'
  t: ChartTheme
  isLast: boolean
  tSeries: (number | null)[]
}) {
  const setHover = useHoverT((s) => s.set)
  const color = spec.color(t)
  const vals = y.filter((v): v is number => v != null)
  // Clip axis to 2nd–98th percentile so GPS/strap spikes don't squash the line.
  const lo = percentile(vals, 0.02)
  const hi = percentile(vals, 0.98)
  const pad = (hi - lo) * 0.12 || 1
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
  const data = x.map((xv, i) => [xv, y[i]])

  return (
    <div>
      <div className="mb-1 flex items-baseline gap-2 px-1">
        <span className="size-2 rounded-full" style={{ background: color }} />
        <span className="text-xs font-medium text-muted">{spec.label}</span>
        <span className="num text-[11px] text-subtle">
          평균 {spec.fmt(avg)} {spec.unit}
        </span>
      </div>
      <EChart
        group={GROUP}
        style={{ height: isLast ? 132 : 112 }}
        onEvents={{
          updateAxisPointer: (e: unknown) => {
            const info = (e as { dataIndex?: number; axesInfo?: { value: number }[] })
            const idx = info.dataIndex
            setHover(idx != null && tSeries[idx] != null ? (tSeries[idx] as number) : null)
          },
          globalout: () => setHover(null),
        }}
        option={{
          animation: false,
          grid: { left: 44, right: 12, top: 6, bottom: isLast ? 24 : 6 },
          tooltip: {
            ...baseTooltip(t),
            trigger: 'axis',
            axisPointer: { type: 'line', lineStyle: { color: t.muted, width: 1 } },
            formatter: (ps: unknown) => {
              const p = (ps as { dataIndex: number; value: [number, number | null] }[])[0]
              const v = p.value[1]
              const xs = xMode === 'dist' ? `${(p.value[0] ?? 0).toFixed(2)} km` : fmtDuration(p.value[0])
              return `<span style="color:${t.muted}">${xs}</span>&nbsp;&nbsp;<b>${v == null ? '—' : spec.fmt(v)}</b> <span style="color:${t.muted}">${spec.unit}</span>`
            },
          },
          xAxis: {
            type: 'value',
            min: 'dataMin',
            max: 'dataMax',
            ...baseAxis(t),
            splitLine: { show: false },
            axisLabel: {
              ...baseAxis(t).axisLabel,
              show: isLast,
              formatter: (v: number) => (xMode === 'dist' ? `${v.toFixed(v < 10 ? 1 : 0)} km` : fmtDuration(v)),
            },
          },
          yAxis: {
            type: 'value',
            inverse: spec.inverse,
            min: Math.max(0, lo - pad),
            max: hi + pad,
            splitNumber: 2,
            ...baseAxis(t),
            axisLabel: { ...baseAxis(t).axisLabel, formatter: (v: number) => spec.fmt(v) },
          },
          dataZoom: [{ type: 'inside', xAxisIndex: 0, filterMode: 'none' }],
          series: [
            {
              type: 'line',
              data,
              showSymbol: false,
              connectNulls: false,
              lineStyle: { width: spec.area ? 1.5 : 2, color },
              itemStyle: { color },
              areaStyle: spec.area ? { color: alpha(color, 0.12), origin: 'start' } : undefined,
              markLine: spec.area
                ? undefined
                : { silent: true, symbol: 'none', lineStyle: { color: alpha(color, 0.5), type: 'solid', width: 1 }, label: { show: false }, data: [{ yAxis: avg }] },
            },
          ],
        }}
      />
    </div>
  )
}

export function StreamCharts({ stream }: { stream: StreamData }) {
  const t = useChartTheme()
  const s = stream.series
  const [xMode, setXMode] = useState<'dist' | 't'>(s.dist ? 'dist' : 't')
  const available = useMemo(() => SPECS.filter((sp) => (s[sp.key]?.some((v) => v != null) ?? false)), [s])
  const [extra, setExtra] = useState<Key[]>([])
  const shown = available.filter((sp) => !sp.optional || extra.includes(sp.key))
  const x = (xMode === 'dist' ? s.dist : s.t) ?? []

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border bg-surface-2 p-0.5">
          {(['dist', 't'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setXMode(m)}
              disabled={m === 'dist' && !s.dist}
              className={cn('h-7 rounded-md px-2.5 text-xs font-medium', xMode === m ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text')}
            >
              {m === 'dist' ? '거리' : '시간'}
            </button>
          ))}
        </div>
        {available.filter((sp) => sp.optional).map((sp) => {
          const on = extra.includes(sp.key)
          return (
            <button
              key={sp.key}
              onClick={() => setExtra((e) => (on ? e.filter((k) => k !== sp.key) : [...e, sp.key]))}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors',
                on ? 'border-border-strong bg-surface-2 text-text' : 'text-subtle hover:text-muted',
              )}
            >
              <span className="size-1.5 rounded-full" style={{ background: on ? sp.color(t) : 'var(--text-subtle)' }} />
              {sp.label}
            </button>
          )
        })}
        <span className="ml-auto text-[11px] text-subtle">스크롤로 확대 · 차트 위에서 지도와 연동</span>
      </div>
      <div className="space-y-1">
        {shown.map((sp, i) => (
          <Panel key={`${sp.key}-${xMode}-${t.dark}`} spec={sp} x={x} y={s[sp.key] ?? []} xMode={xMode} t={t} isLast={i === shown.length - 1} tSeries={s.t ?? []} />
        ))}
      </div>
    </div>
  )
}

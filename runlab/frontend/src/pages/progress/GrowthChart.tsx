import { format } from 'date-fns'
import { ko } from 'date-fns/locale'
import type { ProgressData } from '@/api/progress'
import { EChart } from '@/components/charts/EChart'
import { alpha, baseAxis, baseTooltip, useChartTheme } from '@/components/charts/theme'
import { useNow } from '@/lib/useNow'

/**
 * VDOT over time. One measure, one axis:
 *   faint dots = per-run HR-based estimates (bias-corrected), accent dots = race-like efforts,
 *   line = fitness estimate with its ±1 SD band, band + line beyond today = fitted growth curve (10–90% band).
 */
export function GrowthChart({ data, targetVdot, height = 360, showScenarios = true }: { data: ProgressData; targetVdot?: number | null; height?: number; showScenarios?: boolean }) {
  const now = useNow()
  const t = useChartTheme()
  const curve = data.fit.curve ?? []
  const today = format(now, 'yyyy-MM-dd')
  const band = curve.map((c) => [c.day, c.lo])
  const bandSpan = curve.map((c) => [c.day, +(c.hi - c.lo).toFixed(2)])
  const hrBias = data.current.hr_bias ?? 0
  const sdBase = data.smooth.map((s) => [s.day, s.v - (s.sd ?? 0)])
  const sdSpan = data.smooth.map((s) => [s.day, +(2 * (s.sd ?? 0)).toFixed(2)])
  // Axis range follows the fitness line and forecast, not single noisy per-run estimates.
  const scen = showScenarios ? (data.scenarios?.scenarios ?? []) : []
  const ys = [
    ...data.smooth.map((s) => s.v),
    ...curve.flatMap((c) => [c.lo, c.hi]),
    ...scen.flatMap((sc) => sc.points.map((p) => p.v)),
    targetVdot ?? NaN,
  ].filter((v) => isFinite(v))
  const ymin = Math.floor(Math.min(...ys) - 4)
  const ymax = Math.ceil(Math.max(...ys) + 3)
  const inRange = (v: number | null): v is number => v != null && v >= ymin && v <= ymax

  return (
    <EChart
      style={{ height }}
      option={{
        animationDuration: 600,
        grid: { left: 36, right: 16, top: 16, bottom: 28 },
        tooltip: {
          ...baseTooltip(t),
          trigger: 'axis',
          axisPointer: { type: 'line', lineStyle: { color: t.muted } },
          formatter: (ps: unknown) => {
            const arr = ps as { seriesId: string; value: [string, number]; dataIndex: number }[]
            const day = arr[0]?.value?.[0]
            const lines = [`<div style="font-weight:600;margin-bottom:4px">${day ? format(new Date(day), 'yyyy. M. d (EEE)', { locale: ko }) : ''}</div>`]
            for (const p of arr) {
              if (p.seriesId === 'smooth') {
                const sd = data.smooth[p.dataIndex]?.sd
                lines.push(`체력 VDOT <b>${p.value[1].toFixed(1)}</b>${sd ? ` <span style="color:${t.muted}">±${sd.toFixed(1)}</span>` : ''}`)
              }
              if (p.seriesId === 'fit') {
                const c = curve[p.dataIndex]
                lines.push(`추세 <b>${c.v.toFixed(1)}</b> <span style="color:${t.muted}">(${c.lo.toFixed(1)}–${c.hi.toFixed(1)})</span>`)
              }
              if (p.seriesId === 'perf') lines.push(`<span style="color:${t.muted}">레이스급 노력</span> <b>${p.value[1].toFixed(1)}</b>`)
            }
            return lines.join('<br/>')
          },
        },
        xAxis: { type: 'time', ...baseAxis(t), splitLine: { show: false }, axisLabel: { ...baseAxis(t).axisLabel, formatter: (v: number) => format(new Date(v), 'yy.M') } },
        yAxis: { type: 'value', min: ymin, max: ymax, ...baseAxis(t), splitNumber: 4 },
        dataZoom: [{ type: 'inside' }],
        series: [
          // Band: stacked transparent base + shaded span.
          { id: 'band-base', type: 'line', data: band, stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, silent: true, tooltip: { show: false } },
          { id: 'band', type: 'line', data: bandSpan, stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { color: alpha(t.fitness, 0.12) }, silent: true, tooltip: { show: false } },
          {
            id: 'hr', type: 'scatter', data: data.points.filter((p) => p.vdot_hr != null && inRange(p.vdot_hr - hrBias)).map((p) => [p.day, p.vdot_hr! - hrBias]),
            symbolSize: 8, itemStyle: { color: alpha(t.subtle, 0.35), borderColor: t.surface, borderWidth: 2 }, silent: true, tooltip: { show: false }, z: 2,
          },
          {
            id: 'fit', type: 'line', data: curve.map((c) => [c.day, c.v]), showSymbol: false,
            lineStyle: { width: 2, color: alpha(t.fitness, 0.55) }, z: 3,
            markLine: {
              silent: true, symbol: 'none',
              data: [
                { xAxis: today, lineStyle: { color: t.subtle, width: 1, type: 'solid' }, label: { formatter: '오늘', color: t.subtle, fontSize: 10, position: 'insideEndTop' } },
                ...(targetVdot
                  ? [{ yAxis: targetVdot, lineStyle: { color: t.accent, width: 1.5, type: 'solid' as const }, label: { formatter: `목표 ${targetVdot.toFixed(1)}`, color: t.text, fontSize: 11, position: 'insideStartTop' as const } }]
                  : []),
              ],
            },
          },
          { id: 'sd-base', type: 'line', data: sdBase, stack: 'sd', symbol: 'none', lineStyle: { opacity: 0 }, silent: true, tooltip: { show: false } },
          { id: 'sd', type: 'line', data: sdSpan, stack: 'sd', symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { color: alpha(t.fitness, 0.16) }, silent: true, tooltip: { show: false } },
          { id: 'smooth', type: 'line', data: data.smooth.map((s) => [s.day, s.v]), showSymbol: false, lineStyle: { width: 2, color: t.fitness }, z: 4 },
          // Plan scenarios: one hue (accent), ordered by compliance → stepped opacity. Values live in the scenario table
          // below (end labels collided when scenarios converge).
          ...scen.map((sc, i) => ({
            id: `scen-${i}`,
            type: 'line' as const,
            data: sc.points.map((p) => [p.day, p.v]),
            showSymbol: false,
            z: 6,
            lineStyle: { width: 2, color: alpha(t.accent, Math.max(0.35, 1 - i * 0.22)) },
            itemStyle: { color: alpha(t.accent, Math.max(0.35, 1 - i * 0.22)) },
            tooltip: { show: false },
          })),
          {
            id: 'perf', type: 'scatter',
            data: data.points.filter((p) => inRange(p.vdot_perf) && p.vdot_perf >= (data.current.vdot ?? 0) - 6).map((p) => [p.day, p.vdot_perf]),
            symbolSize: 9, itemStyle: { color: t.accent, borderColor: t.surface, borderWidth: 2 }, z: 5,
          },
        ],
      }}
    />
  )
}

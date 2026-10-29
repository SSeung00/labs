import { format } from 'date-fns'
import type { WeekTotal } from '@/api/activities'
import { EChart } from '@/components/charts/EChart'
import { alpha, baseAxis, baseTooltip, useChartTheme } from '@/components/charts/theme'
import { fmtHours } from '@/lib/format'

/** Single-series weekly distance columns; the current week is the accent, history recedes. */
export function WeeklyVolumeChart({ data, height = 220 }: { data: WeekTotal[]; height?: number }) {
  const t = useChartTheme()
  const last = data.length - 1
  const avg = data.length > 1 ? data.slice(0, -1).reduce((s, w) => s + w.distance_m, 0) / (data.length - 1) / 1000 : 0

  return (
    <EChart
      style={{ height }}
      option={{
        grid: { left: 8, right: 8, top: 24, bottom: 4, containLabel: true },
        tooltip: {
          ...baseTooltip(t),
          trigger: 'axis',
          axisPointer: { type: 'shadow', shadowStyle: { color: alpha(t.subtle, 0.08) } },
          formatter: (ps: unknown) => {
            const p = (ps as { dataIndex: number }[])[0]
            const w = data[p.dataIndex]
            return `<div style="font-weight:600">${format(new Date(w.week), 'M월 d일')} 주</div>
              <div style="margin-top:4px">${(w.distance_m / 1000).toFixed(1)} km · ${w.count}회</div>
              <div style="color:${t.muted}">${fmtHours(w.duration_s)} · 고도 ${Math.round(w.elevation_m)} m</div>`
          },
        },
        xAxis: {
          type: 'category',
          data: data.map((w) => format(new Date(w.week), 'M/d')),
          ...baseAxis(t),
          splitLine: { show: false },
        },
        yAxis: {
          type: 'value',
          ...baseAxis(t),
          axisLabel: { ...baseAxis(t).axisLabel, formatter: '{value} km' },
          splitNumber: 3,
        },
        series: [
          {
            type: 'bar',
            barMaxWidth: 24,
            data: data.map((w, i) => ({
              value: +(w.distance_m / 1000).toFixed(1),
              itemStyle: {
                color: i === last ? t.accent : alpha(t.accent, 0.38),
                borderRadius: [4, 4, 0, 0],
              },
            })),
            label: {
              show: true,
              position: 'top',
              color: t.muted,
              fontSize: 10,
              formatter: (p: { dataIndex: number; value?: unknown }) => (p.dataIndex === last && Number(p.value) > 0 ? `${p.value}` : ''),
            },
            markLine: avg
              ? {
                  silent: true,
                  symbol: 'none',
                  lineStyle: { color: t.subtle, type: 'solid', width: 1 },
                  label: { color: t.subtle, fontSize: 10, formatter: `평균 ${avg.toFixed(1)}`, position: 'insideEndTop' },
                  data: [{ yAxis: +avg.toFixed(1) }],
                }
              : undefined,
          },
        ],
      }}
    />
  )
}

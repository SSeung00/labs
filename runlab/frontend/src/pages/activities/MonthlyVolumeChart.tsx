import type { MonthTotal } from '@/api/activities'
import { EChart } from '@/components/charts/EChart'
import { alpha, baseAxis, baseTooltip, useChartTheme } from '@/components/charts/theme'
import { fmtHours, fmtPace, monthLabel } from '@/lib/format'
import { RUN_TYPE, type RunType } from '@/lib/runTypes'

// Bottom → top: the everyday volume first, the rare sessions on top.
const STACK: RunType[] = ['easy', 'recovery', 'long', 'workout', 'race']

/** Monthly distance stacked by run type. Click a month to filter the list below. */
export function MonthlyVolumeChart({
  data,
  selected,
  onSelect,
  height = 220,
}: {
  data: MonthTotal[]
  selected: string | null
  onSelect: (month: string | null) => void
  height?: number
}) {
  const t = useChartTheme()
  const months = data.slice(-14)
  const dim = (i: number) => selected != null && months[i].month !== selected

  return (
    <EChart
      style={{ height, cursor: 'pointer' }}
      onEvents={{
        click: (p) => {
          const m = months[(p as { dataIndex: number }).dataIndex].month
          onSelect(m === selected ? null : m)
        },
      }}
      option={{
        grid: { left: 8, right: 8, top: 24, bottom: 4, containLabel: true },
        tooltip: {
          ...baseTooltip(t),
          trigger: 'axis',
          axisPointer: { type: 'shadow', shadowStyle: { color: alpha(t.subtle, 0.08) } },
          formatter: (ps: unknown) => {
            const m = months[(ps as { dataIndex: number }[])[0].dataIndex]
            const rows = [...STACK]
              .reverse()
              .filter((k) => (m.by_type[k] ?? 0) > 0)
              .map(
                (k) => `<div style="display:flex;justify-content:space-between;gap:16px">
                  <span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${t.rt[k]};margin-right:6px"></span>${RUN_TYPE[k].label}</span>
                  <span>${((m.by_type[k] ?? 0) / 1000).toFixed(0)} km</span></div>`,
              )
              .join('')
            return `<div style="font-weight:600">${monthLabel(m.month, true)}</div>
              <div style="margin-top:4px">${(m.distance_m / 1000).toFixed(1)} km · ${m.count}회</div>
              <div style="color:${t.muted};margin-bottom:6px">${fmtHours(m.duration_s)}${m.duration_s ? ` · 평균 ${fmtPace(m.distance_m / m.duration_s)}/km` : ''}</div>
              ${rows}
              <div style="color:${t.subtle};margin-top:6px;font-size:11px">눌러서 이 달의 러닝만 보기</div>`
          },
        },
        xAxis: {
          type: 'category',
          data: months.map((m, i) => (i === 0 || m.month.endsWith('-01') ? `${m.month.slice(2, 4)}.${Number(m.month.slice(5))}` : monthLabel(m.month))),
          ...baseAxis(t),
          splitLine: { show: false },
        },
        yAxis: {
          type: 'value',
          ...baseAxis(t),
          axisLabel: { ...baseAxis(t).axisLabel, formatter: '{value} km' },
          splitNumber: 3,
        },
        series: STACK.map((k, si) => ({
          type: 'bar',
          stack: 'km',
          name: RUN_TYPE[k].label,
          barMaxWidth: 26,
          data: months.map((m, i) => ({
            value: +((m.by_type[k] ?? 0) / 1000).toFixed(1),
            itemStyle: {
              color: dim(i) ? alpha(t.rt[k], 0.25) : t.rt[k],
              // Round only the top of each column.
              borderRadius: si === STACK.length - 1 ? [4, 4, 0, 0] : 0,
            },
          })),
          // Total on top of the selected (or latest) month.
          label:
            si === STACK.length - 1
              ? {
                  show: true,
                  position: 'top',
                  color: t.muted,
                  fontSize: 10,
                  formatter: (p: { dataIndex: number }) => {
                    const m = months[p.dataIndex]
                    const show = selected ? m.month === selected : p.dataIndex === months.length - 1
                    return show ? (m.distance_m / 1000).toFixed(0) : ''
                  },
                }
              : undefined,
        })),
      }}
    />
  )
}

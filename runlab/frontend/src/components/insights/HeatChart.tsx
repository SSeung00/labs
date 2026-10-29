import { EChart } from '@/components/charts/EChart'
import { alpha, baseAxis, baseTooltip, useChartTheme } from '@/components/charts/theme'
import { useHeat } from '@/api/life'

/** Aerobic efficiency (EF) by temperature at the start of the run. */
export function HeatChart() {
  const t = useChartTheme()
  const { data } = useHeat()
  if (!data?.bins?.length) return <p className="py-8 text-center text-sm text-subtle">날씨 정보가 있는 러닝이 부족해요</p>
  return (
    <>
      <EChart
        style={{ height: 220 }}
        option={{
          grid: { left: 44, right: 8, top: 16, bottom: 24 },
          tooltip: {
            ...baseTooltip(t),
            trigger: 'axis',
            axisPointer: { type: 'shadow', shadowStyle: { color: alpha(t.subtle, 0.08) } },
            formatter: (ps: unknown) => {
              const b = data.bins![(ps as { dataIndex: number }[])[0].dataIndex]
              return `${b.lo}–${b.hi}°C<br/>EF 중앙값 <b>${b.ef.toFixed(2)}</b><br/><span style="color:${t.muted}">${b.n}회</span>`
            },
          },
          xAxis: { type: 'category', data: data.bins.map((b) => `${b.lo}°`), ...baseAxis(t), splitLine: { show: false } },
          yAxis: { type: 'value', scale: true, ...baseAxis(t), splitNumber: 3 },
          series: [{ type: 'bar', barMaxWidth: 24, data: data.bins.map((b) => b.ef), itemStyle: { color: alpha(t.accent, 0.75), borderRadius: [4, 4, 0, 0] } }],
        }}
      />
      <p className="mt-2 text-xs text-muted">
        기온이 5°C 오를 때 효율이 평균 <b className="num text-text">{data.pct_per_5c! > 0 ? '+' : ''}{data.pct_per_5c}%</b> 변해요
        <span className="text-subtle"> · {data.n}회 · R² {data.r2}{(data.r2 ?? 0) < 0.1 ? ' (영향이 작거나 다른 요인이 더 커요)' : ''}</span>
      </p>
    </>
  )
}


import { format } from 'date-fns'
import { ko } from 'date-fns/locale'
import type { EfficiencyPoint, PmcPoint, WeekLoad } from '@/api/analytics'
import { EChart } from '@/components/charts/EChart'
import { alpha, baseAxis, baseTooltip, useChartTheme } from '@/components/charts/theme'
import { fmtHours, fmtPace } from '@/lib/format'

const dayLabel = (d: string) => format(new Date(d), 'M/d')

/** Legend chip: colored line key + text in ink (text never wears the series color). */
export function LegendKey({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span className="inline-block h-0.5 w-4 rounded-full" style={{ background: dashed ? `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 7px)` : color }} />
      {label}
    </span>
  )
}

/** Performance management chart: fitness/fatigue lines on top, form (TSB) bars below, one time axis. */
export function PmcChart({ data, height = 380 }: { data: PmcPoint[]; height?: number }) {
  const t = useChartTheme()
  const days = data.map((d) => d.day)
  const todayIdx = data.findIndex((d) => d.future) - 1
  const futureStart = data.find((d) => d.future)?.day
  return (
    <EChart
      style={{ height }}
      option={{
        animationDuration: 500,
        axisPointer: { link: [{ xAxisIndex: 'all' }], lineStyle: { color: t.muted } },
        tooltip: {
          ...baseTooltip(t),
          trigger: 'axis',
          formatter: (ps: unknown) => {
            const i = (ps as { dataIndex: number }[])[0].dataIndex
            const d = data[i]
            const row = (c: string, l: string, v: string) => `<div style="display:flex;gap:16px;justify-content:space-between"><span><span style="display:inline-block;width:8px;height:8px;border-radius:9px;background:${c};margin-right:6px"></span>${l}</span><b>${v}</b></div>`
            return `<div style="font-weight:600;margin-bottom:4px">${format(new Date(d.day), 'yyyy. M. d (EEE)', { locale: ko })}${d.future ? ' · 계획' : ''}</div>
              ${row(t.fitness, '체력 CTL', d.ctl.toFixed(1))}${row(t.fatigue, '피로 ATL', d.atl.toFixed(1))}${row(t.form, '폼 TSB', (d.tsb > 0 ? '+' : '') + d.tsb.toFixed(1))}
              <div style="color:${t.muted};margin-top:4px">부하 ${d.load.toFixed(0)}${d.run_km ? ` · ${d.run_km.toFixed(1)} km` : ''}</div>`
          },
        },
        grid: [
          { left: 40, right: 12, top: 10, height: '52%' },
          { left: 40, right: 12, top: '66%', bottom: 26 },
        ],
        xAxis: [
          { type: 'category', data: days, gridIndex: 0, ...baseAxis(t), axisLabel: { show: false }, splitLine: { show: false }, boundaryGap: false },
          { type: 'category', data: days, gridIndex: 1, ...baseAxis(t), axisLabel: { ...baseAxis(t).axisLabel, formatter: dayLabel }, splitLine: { show: false } },
        ],
        yAxis: [
          { type: 'value', gridIndex: 0, ...baseAxis(t), splitNumber: 3 },
          { type: 'value', gridIndex: 1, ...baseAxis(t), splitNumber: 2 },
        ],
        dataZoom: [{ type: 'inside', xAxisIndex: [0, 1] }],
        series: [
          {
            name: 'CTL', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: data.map((d) => d.ctl), showSymbol: false,
            lineStyle: { width: 2, color: t.fitness }, itemStyle: { color: t.fitness },
            areaStyle: { color: alpha(t.fitness, 0.1) },
            markLine: todayIdx >= 0 ? { silent: true, symbol: 'none', lineStyle: { color: t.subtle, width: 1, type: 'solid' }, label: { formatter: '오늘', color: t.subtle, fontSize: 10 }, data: [{ xAxis: todayIdx }] } : undefined,
            markArea: futureStart ? { silent: true, itemStyle: { color: alpha(t.subtle, 0.06) }, data: [[{ xAxis: futureStart }, { xAxis: days[days.length - 1] }]] } : undefined,
          },
          { name: 'ATL', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: data.map((d) => d.atl), showSymbol: false, lineStyle: { width: 2, color: t.fatigue }, itemStyle: { color: t.fatigue } },
          {
            name: 'TSB', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, barMaxWidth: 6,
            data: data.map((d) => ({ value: d.tsb, itemStyle: { color: d.tsb >= 0 ? alpha(t.form, d.future ? 0.45 : 0.9) : alpha(t.fatigue, d.future ? 0.35 : 0.7), borderRadius: d.tsb >= 0 ? [2, 2, 0, 0] : [0, 0, 2, 2] } })),
            markArea: {
              silent: true,
              label: { color: t.subtle, fontSize: 9, position: 'insideTopLeft' },
              data: [
                [{ yAxis: -30, name: '과부하', itemStyle: { color: alpha(t.bad, 0.06) } }, { yAxis: -60 }],
                [{ yAxis: 5, name: '신선', itemStyle: { color: alpha(t.form, 0.06) } }, { yAxis: 25 }],
              ],
            },
          },
        ],
      }}
    />
  )
}

export function AcwrChart({ data, height = 200 }: { data: PmcPoint[]; height?: number }) {
  const t = useChartTheme()
  const pts = data.filter((d) => !d.future)
  return (
    <EChart
      style={{ height }}
      option={{
        grid: { left: 36, right: 12, top: 10, bottom: 24 },
        tooltip: {
          ...baseTooltip(t),
          trigger: 'axis',
          formatter: (ps: unknown) => {
            const d = pts[(ps as { dataIndex: number }[])[0].dataIndex]
            return `${format(new Date(d.day), 'M월 d일')}<br/><b>ACWR ${d.acwr?.toFixed(2) ?? '—'}</b>`
          },
        },
        xAxis: { type: 'category', data: pts.map((d) => d.day), ...baseAxis(t), axisLabel: { ...baseAxis(t).axisLabel, formatter: dayLabel }, splitLine: { show: false }, boundaryGap: false },
        yAxis: { type: 'value', min: 0, max: (v: { max: number }) => Math.max(2, Math.ceil(v.max * 10) / 10), ...baseAxis(t), splitNumber: 2 },
        series: [
          {
            type: 'line', data: pts.map((d) => d.acwr), showSymbol: false, connectNulls: true,
            lineStyle: { width: 2, color: t.accent }, itemStyle: { color: t.accent },
            markArea: {
              silent: true,
              label: { color: t.subtle, fontSize: 9, position: 'insideTopLeft' },
              data: [
                [{ yAxis: 0.8, name: '적정 0.8–1.3', itemStyle: { color: alpha(t.good, 0.09) } }, { yAxis: 1.3 }],
                [{ yAxis: 1.5, name: '위험 1.5+', itemStyle: { color: alpha(t.bad, 0.08) } }, { yAxis: 10 }],
              ],
            },
          },
        ],
      }}
    />
  )
}

export function ZoneWeeksChart({ data, zoneNames, height = 240 }: { data: WeekLoad[]; zoneNames: string[]; height?: number }) {
  const t = useChartTheme()
  return (
    <EChart
      style={{ height }}
      option={{
        grid: { left: 40, right: 8, top: 10, bottom: 24 },
        tooltip: {
          ...baseTooltip(t),
          trigger: 'axis',
          axisPointer: { type: 'shadow', shadowStyle: { color: alpha(t.subtle, 0.08) } },
          formatter: (ps: unknown) => {
            const w = data[(ps as { dataIndex: number }[])[0].dataIndex]
            const total = w.zone_seconds.reduce((a, b) => a + b, 0)
            const easy = total ? ((w.zone_seconds[0] + w.zone_seconds[1]) / total) * 100 : 0
            return `<div style="font-weight:600">${format(new Date(w.week), 'M월 d일')} 주 · ${w.run_km.toFixed(1)} km</div>` +
              w.zone_seconds.map((s, i) => `<div style="display:flex;justify-content:space-between;gap:14px"><span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${t.zones[i]};margin-right:6px"></span>${zoneNames[i]}</span><span>${fmtHours(s)} · ${total ? Math.round((s / total) * 100) : 0}%</span></div>`).reverse().join('') +
              `<div style="color:${t.muted};margin-top:4px">쉬운 강도(Z1–2) ${easy.toFixed(0)}%</div>`
          },
        },
        xAxis: { type: 'category', data: data.map((w) => dayLabel(w.week)), ...baseAxis(t), splitLine: { show: false } },
        yAxis: { type: 'value', ...baseAxis(t), splitNumber: 3, axisLabel: { ...baseAxis(t).axisLabel, formatter: (v: number) => `${Math.round(v / 3600)}h` } },
        series: [0, 1, 2, 3, 4].map((z) => ({
          name: zoneNames[z],
          type: 'bar',
          stack: 'zones',
          barMaxWidth: 22,
          data: data.map((w) => w.zone_seconds[z]),
          // 2px surface gap between stacked segments; round only the outer end.
          itemStyle: { color: t.zones[z], borderColor: t.surface, borderWidth: 1, borderRadius: z === 4 ? [4, 4, 0, 0] : 0 },
        })),
      }}
    />
  )
}

export function EfficiencyChart({ data, height = 260 }: { data: EfficiencyPoint[]; height?: number }) {
  const t = useChartTheme()
  const pts = data.filter((d) => d.ef && !d.treadmill)
  // 9-run rolling median as the trend.
  const trend = pts.map((_, i) => {
    const win = pts.slice(Math.max(0, i - 8), i + 1).map((p) => p.ef as number).sort((a, b) => a - b)
    return [pts[i].day, +win[Math.floor(win.length / 2)].toFixed(3)]
  })
  return (
    <EChart
      style={{ height }}
      option={{
        grid: { left: 44, right: 12, top: 12, bottom: 24 },
        tooltip: {
          ...baseTooltip(t),
          trigger: 'item',
          formatter: (p: unknown) => {
            const q = p as { seriesIndex: number; dataIndex: number }
            if (q.seriesIndex !== 0) return ''
            const d = pts[q.dataIndex]
            return `<div style="font-weight:600">${d.name ?? '러닝'}</div><div style="color:${t.muted}">${format(new Date(d.day), 'yyyy. M. d')}</div>
              <div style="margin-top:4px">EF <b>${d.ef?.toFixed(2)}</b> · ${(d.distance_m / 1000).toFixed(1)} km</div>
              <div>GAP ${fmtPace(d.gap_speed)}/km · ${d.avg_hr ?? '—'} bpm</div>
              ${d.decoupling != null ? `<div>디커플링 ${d.decoupling.toFixed(1)}%</div>` : ''}`
          },
        },
        xAxis: { type: 'time', ...baseAxis(t), splitLine: { show: false }, axisLabel: { ...baseAxis(t).axisLabel, formatter: (v: number) => format(new Date(v), 'yy.M') } },
        yAxis: { type: 'value', scale: true, ...baseAxis(t), splitNumber: 3 },
        series: [
          {
            type: 'scatter',
            data: pts.map((d) => [d.day, d.ef]),
            symbolSize: (_: unknown, p: { dataIndex: number }) => Math.max(8, Math.min(16, 6 + pts[p.dataIndex].distance_m / 2000)),
            itemStyle: { color: alpha(t.fitness, 0.45), borderColor: t.surface, borderWidth: 2 },
            emphasis: { itemStyle: { color: t.fitness } },
          },
          { type: 'line', data: trend, showSymbol: false, smooth: 0.3, lineStyle: { width: 2, color: t.accent }, silent: true, tooltip: { show: false } },
        ],
      }}
    />
  )
}

type Band = { key: string; label: string; lo: number | null; hi: number | null }

const bandOf = (tsb: number, bands: Band[]) => bands.find((b) => (b.lo == null || tsb >= b.lo) && (b.hi == null || tsb < b.hi))?.key ?? 'neutral'

/**
 * Fitness and fatigue lines over background bands that say what state each day was in
 * (green = training is paying off, red = overload, blue = fresh). Planned days are dashed.
 */
export function ConditionChart({ data, bands, height = 320 }: { data: PmcPoint[]; bands: Band[]; height?: number }) {
  const t = useChartTheme()
  const days = data.map((d) => d.day)
  const firstFuture = data.findIndex((d) => d.future)
  const todayIdx = firstFuture < 0 ? data.length - 1 : firstFuture - 1
  const color: Record<string, string | null> = { overload: alpha(t.bad, 0.13), productive: alpha(t.good, 0.1), neutral: null, fresh: alpha(t.form, 0.12), rested: alpha(t.subtle, 0.08) }
  // Bands follow a 7-day average of form so day-to-day noise doesn't flicker; stretches shorter
  // than 5 days merge into the one before. Contiguous days of one band become one shaded area.
  const smooth = data.map((_, i) => {
    const win = data.slice(Math.max(0, i - 6), i + 1)
    return win.reduce((a, d) => a + d.tsb, 0) / win.length
  })
  const runs: { key: string; from: number; to: number }[] = []
  smooth.forEach((v, i) => {
    const k = bandOf(v, bands)
    const last = runs.at(-1)
    if (last && last.key === k) last.to = i
    else runs.push({ key: k, from: i, to: i })
  })
  const merged: typeof runs = []
  for (const r of runs) {
    const last = merged.at(-1)
    if (last && (r.to - r.from < 4 || last.key === r.key)) last.to = r.to
    else merged.push({ ...r })
  }
  const areas = merged
    .filter((r) => color[r.key])
    .map((r) => [{ xAxis: days[r.from], itemStyle: { color: color[r.key]! } }, { xAxis: days[r.to] }] as [{ xAxis: string; itemStyle: { color: string } }, { xAxis: string }])
  const past = (v: (d: PmcPoint) => number) => data.map((d, i) => (i <= todayIdx ? v(d) : null))
  const future = (v: (d: PmcPoint) => number) => data.map((d, i) => (i >= todayIdx ? v(d) : null))
  const label = Object.fromEntries(bands.map((b) => [b.key, b.label]))
  return (
    <EChart
      style={{ height }}
      option={{
        animationDuration: 500,
        tooltip: {
          ...baseTooltip(t),
          trigger: 'axis',
          formatter: (ps: unknown) => {
            const d = data[(ps as { dataIndex: number }[])[0].dataIndex]
            const row = (c: string, l: string, v: string) => `<div style="display:flex;gap:16px;justify-content:space-between"><span><span style="display:inline-block;width:8px;height:8px;border-radius:9px;background:${c};margin-right:6px"></span>${l}</span><b>${v}</b></div>`
            return `<div style="font-weight:600;margin-bottom:4px">${format(new Date(d.day), 'yyyy. M. d (EEE)', { locale: ko })}${d.future ? ' · 계획대로 하면' : ''}</div>
              ${row(t.fitness, '체력', d.ctl.toFixed(1))}${row(t.fatigue, '피로', d.atl.toFixed(1))}
              <div style="color:${t.muted};margin-top:4px">${label[bandOf(smooth[(ps as { dataIndex: number }[])[0].dataIndex], bands)]} · 폼 ${(d.tsb > 0 ? '+' : '') + d.tsb.toFixed(0)}</div>`
          },
        },
        grid: { left: 36, right: 12, top: 12, bottom: 26 },
        xAxis: { type: 'category', data: days, ...baseAxis(t), boundaryGap: false, splitLine: { show: false }, axisLabel: { ...baseAxis(t).axisLabel, formatter: dayLabel } },
        yAxis: { type: 'value', ...baseAxis(t), splitNumber: 3 },
        dataZoom: [{ type: 'inside' }],
        series: [
          {
            name: '체력', type: 'line', data: past((d) => d.ctl), showSymbol: false, lineStyle: { width: 2.5, color: t.fitness }, itemStyle: { color: t.fitness },
            markArea: { silent: true, data: areas },
            markLine: firstFuture > 0 ? { silent: true, symbol: 'none', lineStyle: { color: t.subtle, width: 1, type: 'solid' }, label: { formatter: '오늘', color: t.subtle, fontSize: 10 }, data: [{ xAxis: todayIdx }] } : undefined,
          },
          { name: '피로', type: 'line', data: past((d) => d.atl), showSymbol: false, smooth: 0.3, lineStyle: { width: 1.5, color: alpha(t.fatigue, 0.75) }, itemStyle: { color: t.fatigue } },
          ...(firstFuture > 0
            ? [
                { name: '체력 (계획)', type: 'line' as const, data: future((d) => d.ctl), showSymbol: false, lineStyle: { width: 2, color: t.fitness, type: 'dashed' as const }, itemStyle: { color: t.fitness } },
                { name: '피로 (계획)', type: 'line' as const, data: future((d) => d.atl), showSymbol: false, lineStyle: { width: 1.2, color: alpha(t.fatigue, 0.6), type: 'dashed' as const }, itemStyle: { color: t.fatigue } },
              ]
            : []),
        ],
      }}
    />
  )
}

/** Weekly share of easy (Z1–2) running against the 80% target. */
export function EasyShareChart({ data, target, height = 200 }: { data: { week: string; hours: number; easy_pct: number | null }[]; target: number; height?: number }) {
  const t = useChartTheme()
  return (
    <EChart
      style={{ height }}
      option={{
        grid: { left: 36, right: 8, top: 12, bottom: 24 },
        tooltip: {
          ...baseTooltip(t),
          trigger: 'axis',
          axisPointer: { type: 'shadow', shadowStyle: { color: alpha(t.subtle, 0.08) } },
          formatter: (ps: unknown) => {
            const w = data[(ps as { dataIndex: number }[])[0].dataIndex]
            return `<b>${format(new Date(w.week), 'M월 d일')} 주</b><br/>쉬운 강도 ${w.easy_pct ?? '—'}% · ${w.hours}시간`
          },
        },
        xAxis: { type: 'category', data: data.map((w) => dayLabel(w.week)), ...baseAxis(t), splitLine: { show: false } },
        yAxis: { type: 'value', min: 0, max: 100, ...baseAxis(t), splitNumber: 2, axisLabel: { ...baseAxis(t).axisLabel, formatter: '{value}%' } },
        series: [
          {
            type: 'bar', barMaxWidth: 18,
            data: data.map((w) => ({ value: w.easy_pct, itemStyle: { color: w.easy_pct == null ? t.subtle : w.easy_pct >= target - 5 ? t.good : alpha(t.warn, 0.85), borderRadius: [4, 4, 0, 0] } })),
            markLine: { silent: true, symbol: 'none', lineStyle: { color: t.muted, type: 'dashed' }, label: { formatter: `목표 ${target}%`, color: t.muted, fontSize: 10, position: 'insideEndTop' }, data: [{ yAxis: target }] },
          },
        ],
      }}
    />
  )
}

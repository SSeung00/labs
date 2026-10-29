import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Info } from 'lucide-react'
import { EChart } from '@/components/charts/EChart'
import { alpha, baseAxis, baseTooltip, useChartTheme } from '@/components/charts/theme'
import { useCorrelation, useDrivers, useInsightMetrics, type Driver, type InsightMetric } from '@/api/life'
import { cn } from '@/lib/utils'

function MetricSelect({ value, onChange, metrics, label }: { value: string; onChange: (v: string) => void; metrics: InsightMetric[]; label: string }) {
  const groups = useMemo(() => [...new Set(metrics.map((m) => m.group))], [metrics])
  return (
    <label className="block min-w-0 flex-1">
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-lg border bg-surface-2/60 px-3 text-sm outline-none hover:border-border-strong focus:border-accent"
      >
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {metrics.filter((m) => m.group === g).map((m) => (
              <option key={m.key} value={m.key} disabled={m.count < 8}>
                {m.label}{m.count < 8 ? ` (기록 ${m.count}일 — 부족)` : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  )
}

function strength(rho: number) {
  const a = Math.abs(rho)
  const s = a >= 0.5 ? '강한' : a >= 0.3 ? '뚜렷한' : a >= 0.15 ? '약한' : '거의 없는'
  return `${s} ${a < 0.15 ? '' : rho > 0 ? '양의' : '음의'} 관계`.replace('  ', ' ')
}

const lagText = (l: number) => (l === 0 ? '같은 날' : `${l}일 후`)

function DriverBars({ drivers, onPick }: { drivers: Driver[]; onPick: (d: Driver) => void }) {
  if (!drivers.length) return <p className="py-8 text-center text-sm text-subtle">분석할 만큼 겹치는 기록이 아직 없어요</p>
  return (
    <ul className="space-y-1">
      {drivers.slice(0, 10).map((d) => {
        const w = Math.abs(d.rho) * 50
        const sig = d.p < 0.05
        return (
          <li key={d.key}>
            <button onClick={() => onPick(d)} className="grid w-full grid-cols-[minmax(0,9rem)_1fr_4.5rem] items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2">
              <span className="truncate text-xs">
                {d.label}
                <span className="ml-1 text-[10px] text-subtle">· {lagText(d.lag)}</span>
              </span>
              {/* Diverging bar around a neutral centre line. */}
              <span className="relative h-3">
                <span className="absolute inset-y-0 left-1/2 w-px bg-border-strong" />
                <span
                  className="absolute inset-y-0 rounded-full"
                  style={{
                    width: `${w}%`,
                    left: d.rho >= 0 ? '50%' : `${50 - w}%`,
                    background: d.rho >= 0 ? 'var(--fitness)' : 'var(--fatigue)',
                    opacity: sig ? 1 : 0.4,
                  }}
                />
              </span>
              <span className="num text-right text-xs">
                <b>{d.rho > 0 ? '+' : ''}{d.rho.toFixed(2)}</b>
                <span className="ml-1 text-[10px] text-subtle">{sig ? '' : 'n.s.'}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function Scatter({ x, y, lag, xLabel, yLabel }: { x: string; y: string; lag: number; xLabel: string; yLabel: string }) {
  const t = useChartTheme()
  const { data } = useCorrelation(x, y, lag)
  const pts = data?.pairs ?? []
  const xs = pts.map((p) => p.x)
  const line = data?.slope != null && xs.length ? [[Math.min(...xs), data.intercept! + data.slope * Math.min(...xs)], [Math.max(...xs), data.intercept! + data.slope * Math.max(...xs)]] : []
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_15rem]">
      <EChart
        style={{ height: 320 }}
        option={{
          grid: { left: 48, right: 16, top: 16, bottom: 40 },
          tooltip: {
            ...baseTooltip(t),
            trigger: 'item',
            formatter: (p: unknown) => {
              const q = p as { seriesIndex: number; dataIndex: number }
              if (q.seriesIndex !== 0) return ''
              const d = pts[q.dataIndex]
              return `${format(parseISO(d.day), 'yyyy. M. d')}<br/>${xLabel} <b>${d.x}</b><br/>${yLabel}${lag ? ` (${lag}일 후)` : ''} <b>${d.y}</b>`
            },
          },
          xAxis: { type: 'value', scale: true, name: xLabel, nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: t.muted, fontSize: 11 }, ...baseAxis(t) },
          yAxis: { type: 'value', scale: true, name: yLabel, nameTextStyle: { color: t.muted, fontSize: 11, align: 'left' }, ...baseAxis(t) },
          series: [
            { type: 'scatter', data: pts.map((p) => [p.x, p.y]), symbolSize: 9, itemStyle: { color: alpha(t.fitness, 0.55), borderColor: t.surface, borderWidth: 2 }, emphasis: { itemStyle: { color: t.fitness } } },
            { type: 'line', data: line, showSymbol: false, lineStyle: { width: 2, color: t.accent }, silent: true },
          ],
        }}
      />
      <div className="space-y-3">
        {data?.rho != null ? (
          <>
            <div className="rounded-xl bg-surface-2/70 p-4">
              <div className="text-xs text-muted">순위 상관 (Spearman ρ)</div>
              <div className="num mt-1 text-3xl font-bold">{data.rho > 0 ? '+' : ''}{data.rho.toFixed(2)}</div>
              <div className="mt-1 text-sm">{strength(data.rho)}</div>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-lg bg-surface-2/60 py-2">
                <dt className="text-[10px] text-subtle">표본</dt>
                <dd className="num text-sm font-semibold">{data.n}일</dd>
              </div>
              <div className="rounded-lg bg-surface-2/60 py-2">
                <dt className="text-[10px] text-subtle">p값</dt>
                <dd className={cn('num text-sm font-semibold', (data.p ?? 1) < 0.05 ? 'text-good' : 'text-subtle')}>{(data.p ?? 1) < 0.001 ? '<0.001' : data.p!.toFixed(3)}</dd>
              </div>
            </dl>
            <p className="text-[11px] leading-relaxed text-subtle">
              {(data.p ?? 1) < 0.05 ? '우연일 가능성이 낮은 관계예요.' : '아직은 우연과 구분하기 어려워요. 기록이 쌓이면 다시 보세요.'} 상관은 인과가 아니에요 — 함께 움직이는 다른 요인이 있을 수 있어요.
            </p>
          </>
        ) : (
          <div className="rounded-xl bg-surface-2/70 p-4 text-sm text-subtle">겹치는 날이 {data?.n ?? 0}일이에요. 최소 8일이 필요해요.</div>
        )}
      </div>
    </div>
  )
}

/** Pick an outcome to rank what moves with it, or compare any two metrics directly. */
export function Explorer() {
  const { data: metrics = [] } = useInsightMetrics()
  const [target, setTarget] = useState('ef')
  const [x, setX] = useState('tsb')
  const [y, setY] = useState('ef')
  const [lag, setLag] = useState(0)
  const { data: drivers = [], isFetching } = useDrivers(target)
  const label = (k: string) => metrics.find((m) => m.key === k)?.label ?? k
  const journalCount = Math.max(0, ...metrics.filter((m) => m.group === '일지').map((m) => m.count))

  return (
    <div className="space-y-4">
      {journalCount < 8 && (
        <div className="flex items-start gap-3 rounded-xl border bg-surface-2/60 px-4 py-3 text-sm text-muted">
          <Info className="mt-0.5 size-4 shrink-0 text-accent" />
          <span>
            체크인이 {journalCount}일 쌓였어요. <b className="text-text">8일 이상</b> 기록하면 수면·피로도 같은 내 지표도 비교할 수 있어요.
          </span>
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-5">
        <div className="xl:col-span-2">
          <div className="mb-2 text-sm font-semibold">무엇이 함께 움직이나</div>
          <MetricSelect value={target} onChange={setTarget} metrics={metrics} label="결과 지표" />
          <div className={cn('mt-4 transition-opacity', isFetching && 'opacity-50')}>
            <DriverBars drivers={drivers} onPick={(d) => { setX(d.key); setY(target); setLag(d.lag) }} />
          </div>
          <div className="mt-3 flex gap-4 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-full bg-fitness" />함께 증가</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-full bg-fatigue" />반대로 움직임</span>
            <span>0–2일 시차 중 가장 강한 관계 · 흐린 막대는 불확실</span>
          </div>
        </div>
        <div className="xl:col-span-3">
          <div className="mb-2 text-sm font-semibold">두 지표 비교</div>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <MetricSelect value={x} onChange={setX} metrics={metrics} label="원인 후보 (X)" />
            <MetricSelect value={y} onChange={setY} metrics={metrics} label="결과 (Y)" />
            <div>
              <span className="mb-1.5 block text-xs font-medium text-muted">시차</span>
              <div className="flex rounded-lg border bg-surface-2 p-0.5">
                {[0, 1, 2].map((l) => (
                  <button key={l} onClick={() => setLag(l)} className={cn('h-8 rounded-md px-3 text-xs font-medium', lag === l ? 'bg-surface text-text shadow-sm' : 'text-muted')}>
                    {lagText(l)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {metrics.length > 0 && <Scatter x={x} y={y} lag={lag} xLabel={label(x)} yLabel={label(y)} />}
        </div>
      </div>
    </div>
  )
}

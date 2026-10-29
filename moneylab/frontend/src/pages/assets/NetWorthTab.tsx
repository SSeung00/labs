import { useMemo } from 'react'
import { ArrowDownRight, ArrowUpRight, Landmark } from 'lucide-react'
import type { EChartsOption } from 'echarts'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { AnimatedNumber, Stagger, StaggerItem } from '@/components/ui/motion'
import { EChart } from '@/components/charts/EChart'
import { alpha, baseAxis, baseTooltip, useChartTheme } from '@/components/charts/theme'
import { useNetWorth } from '@/api/extra'
import { useOverview } from '@/api/money'
import { fmtDate, won, wonShort } from '@/lib/format'
import { cn } from '@/lib/utils'

const GROUP_COLORS = ['#2a78d6', '#0ca678', '#7048e8', '#f59f00', '#e8590c', '#868e96', '#e64980']

export function NetWorthTab() {
  const { data: points } = useNetWorth()
  const { data: overview } = useOverview()
  const b = overview?.balances

  if (!points) return <div className="shimmer h-96 rounded-card" />
  if (!points.length || !b) {
    return (
      <Card>
        <EmptyState icon={Landmark} title="자산 정보가 아직 없어요">
          뱅크샐러드 엑셀의 재무현황(계좌 잔액)을 읽어서 보여드려요. 엑셀을 한 번 가져와 주세요.
        </EmptyState>
      </Card>
    )
  }
  const last = points[points.length - 1]
  const prev = points[points.length - 2]
  const delta = prev ? last.net - prev.net : null
  const assetGroups = b.groups.filter((g) => g.side === 'asset')

  return (
    <Stagger className="grid grid-cols-1 gap-4 split:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <StaggerItem className="split:col-span-2">
        <Card>
          <CardBody className="flex flex-wrap items-end justify-between gap-4 pt-5">
            <div>
              <div className="text-xs font-medium text-muted">순자산 · {fmtDate(last.as_of)} 기준</div>
              <AnimatedNumber value={last.net} format={won} className="mt-1 block text-3xl font-bold tracking-tight fold:text-4xl" />
              {delta != null && (
                <div className={cn('mt-1 flex items-center gap-1 text-sm', delta >= 0 ? 'text-good' : 'text-bad')}>
                  {delta >= 0 ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                  지난 기록({fmtDate(prev!.as_of)})보다 {wonShort(Math.abs(delta))} {delta >= 0 ? '늘었어요' : '줄었어요'}
                </div>
              )}
            </div>
            <div className="flex gap-4 text-sm">
              <div>
                <div className="text-xs text-muted">자산</div>
                <div className="num font-semibold">{won(last.assets)}</div>
              </div>
              <div>
                <div className="text-xs text-muted">부채</div>
                <div className="num font-semibold">{won(last.debts)}</div>
              </div>
            </div>
          </CardBody>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <Card className="h-full">
          <CardHeader title="순자산 추이" hint="엑셀을 가져올 때마다 한 점씩 쌓여요" />
          <CardBody>
            <TrendChart points={points} />
          </CardBody>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <Card className="h-full">
          <CardHeader title="구성" />
          <CardBody>
            <CompositionChart groups={assetGroups.map((g) => ({ name: g.group, value: g.amount }))} />
            <div className="mt-3 space-y-3">
              {b.groups.map((g, gi) => (
                <div key={`${g.side}-${g.group}`}>
                  <div className="flex items-center justify-between text-xs font-medium text-muted">
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full" style={{ background: g.side === 'debt' ? 'var(--bad)' : GROUP_COLORS[gi % GROUP_COLORS.length] }} />
                      {g.group}
                    </span>
                    <span className="num">{won(g.amount)}</span>
                  </div>
                  <ul className="mt-1 space-y-0.5 pl-3.5">
                    {g.items.map((i) => (
                      <li key={i.name} className="flex justify-between gap-3 text-[13px]">
                        <span className="truncate">{i.name}</span>
                        <span className="num shrink-0">{won(i.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </StaggerItem>
    </Stagger>
  )
}

function TrendChart({ points }: { points: { as_of: string; net: number; assets: number }[] }) {
  const t = useChartTheme()
  const option = useMemo<EChartsOption>(
    () => ({
      grid: { left: 4, right: 12, top: 12, bottom: 4, containLabel: true },
      tooltip: { ...baseTooltip(t), trigger: 'axis', valueFormatter: (v) => won(Number(v)) },
      xAxis: { type: 'category', data: points.map((p) => p.as_of.slice(2).replaceAll('-', '.')), boundaryGap: false, ...baseAxis(t), splitLine: { show: false } },
      yAxis: { type: 'value', scale: true, ...baseAxis(t), axisLabel: { ...baseAxis(t).axisLabel, formatter: (v: number) => wonShort(v) } },
      series: [
        {
          name: '순자산',
          type: 'line',
          data: points.map((p) => p.net),
          smooth: true,
          symbolSize: 8,
          lineStyle: { color: t.accent, width: 2.5 },
          itemStyle: { color: t.accent },
          areaStyle: {
            color: {
              type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: alpha(t.accent, 0.28) },
                { offset: 1, color: alpha(t.accent, 0) },
              ],
            },
          },
        },
      ],
    }),
    [points, t],
  )
  return <EChart option={option} style={{ height: 240 }} />
}

export function CompositionChart({ groups, height = 180 }: { groups: { name: string; value: number }[]; height?: number }) {
  const t = useChartTheme()
  const option = useMemo<EChartsOption>(
    () => ({
      tooltip: { ...baseTooltip(t), trigger: 'item', valueFormatter: (v) => won(Number(v)) },
      series: [
        {
          type: 'pie',
          radius: ['58%', '84%'],
          padAngle: 2,
          itemStyle: { borderRadius: 6 },
          label: { show: false },
          data: groups.filter((g) => g.value > 0).map((g, i) => ({ ...g, itemStyle: { color: GROUP_COLORS[i % GROUP_COLORS.length] } })),
          animationType: 'scale',
          animationEasing: 'cubicOut',
        },
      ],
    }),
    [groups, t],
  )
  return <EChart option={option} style={{ height }} />
}

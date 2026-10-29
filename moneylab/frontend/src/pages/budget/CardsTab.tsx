import { useMemo } from 'react'
import { Link } from 'react-router'
import { CreditCard } from 'lucide-react'
import type { EChartsOption } from 'echarts'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { EChart } from '@/components/charts/EChart'
import { baseAxis, baseTooltip, useChartTheme } from '@/components/charts/theme'
import { type CardsSummary, useCards } from '@/api/extra'
import { fmtMonth, won, wonShort } from '@/lib/format'

/** Card usage (by approval month) next to what left the bank to pay the bill. */
export function CardsTab() {
  const { data } = useCards()
  if (!data) return <div className="shimmer h-80 rounded-card" />
  if (!data.issuers.length) {
    return (
      <Card>
        <EmptyState icon={CreditCard} title="카드 내역이 없어요">
          엑셀을 가져오면 카드사별 사용액과 통장에서 나간 카드값을 나란히 보여드려요.
        </EmptyState>
      </Card>
    )
  }
  return (
    <Stagger className="grid grid-cols-1 gap-4 split:grid-cols-2">
      {data.issuers.map((iss) => {
        const n = data.months.length
        const lastUsed = iss.used[n - 1] ?? 0
        const prevUsed = iss.used[n - 2] ?? 0
        return (
          <StaggerItem key={iss.issuer}>
            <Card className="h-full">
              <CardHeader
                title={<span className="text-text">{iss.issuer === '미지정' ? '카드사 미지정' : `${iss.issuer}카드`}</span>}
                hint={iss.cards.map((c) => c.name).join(' · ') || '사용 내역 없음 (결제만 있음)'}
              />
              <CardBody>
                <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-xl bg-surface-2/60 px-3 py-2">
                    <div className="text-[11px] text-muted">{fmtMonth(data.months[n - 1], true)} 사용 (진행 중)</div>
                    <div className="num font-semibold">{won(lastUsed)}</div>
                  </div>
                  <div className="rounded-xl bg-surface-2/60 px-3 py-2">
                    <div className="text-[11px] text-muted">다음 결제 추정 (지난달 사용액)</div>
                    <div className="num font-semibold">{won(prevUsed)}</div>
                  </div>
                </div>
                <IssuerChart data={data} used={iss.used} paid={iss.paid} />
                {iss.issuer === '미지정' && (
                  <p className="mt-2 text-xs text-warn">
                    <Link to="/settings" className="underline">설정 → 계좌·카드</Link>에서 카드사를 정하면 통장 결제액과 짝지어 보여드려요.
                  </p>
                )}
              </CardBody>
            </Card>
          </StaggerItem>
        )
      })}
      <p className="text-xs leading-relaxed text-subtle split:col-span-2">
        카드값은 보통 한 달 늦게 통장에서 나가요. 결제일·할부에 따라 막대가 정확히 맞지 않을 수 있고, '다음 결제 추정'은 지난달 사용액 그대로예요.
      </p>
    </Stagger>
  )
}

function IssuerChart({ data, used, paid }: { data: CardsSummary; used: number[]; paid: number[] }) {
  const t = useChartTheme()
  const option = useMemo<EChartsOption>(
    () => ({
      grid: { left: 4, right: 4, top: 26, bottom: 4, containLabel: true },
      legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: t.muted, fontSize: 11 } },
      tooltip: { ...baseTooltip(t), trigger: 'axis', valueFormatter: (v) => won(Number(v)) },
      xAxis: { type: 'category', data: data.months.map((m) => fmtMonth(m, true)), ...baseAxis(t), splitLine: { show: false } },
      yAxis: { type: 'value', ...baseAxis(t), axisLabel: { ...baseAxis(t).axisLabel, formatter: (v: number) => wonShort(v) } },
      series: [
        { name: '사용', type: 'bar', data: used, barMaxWidth: 16, itemStyle: { color: t.accent, borderRadius: [3, 3, 0, 0] } },
        { name: '통장에서 결제', type: 'bar', data: paid, barMaxWidth: 16, itemStyle: { color: t.dark ? '#868e96' : '#adb5bd', borderRadius: [3, 3, 0, 0] } },
      ],
    }),
    [data, used, paid, t],
  )
  return <EChart option={option} style={{ height: 200 }} />
}

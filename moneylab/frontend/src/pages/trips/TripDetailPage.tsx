import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, HandCoins, Minus, Pencil, Plus, Trash2 } from 'lucide-react'
import type { EChartsOption } from 'echarts'
import { PageHeader } from '@/components/layout/PageHeader'
import { GrowBar } from '@/components/ui/motion'
import { PageSkeleton } from '@/components/layout/PageSkeleton'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress, Stat } from '@/components/ui/controls'
import { EChart } from '@/components/charts/EChart'
import { baseAxis, baseTooltip, useChartTheme } from '@/components/charts/theme'
import { TxnList } from '@/components/money/TxnList'
import { CategoryDot } from '@/components/money/bits'
import { type TripDetail, useDeleteTrip, usePatchTxn, useTrip } from '@/api/money'
import { fmtDate, won, wonShort } from '@/lib/format'
import { TripForm } from './TripForm'

export function TripDetailPage() {
  const id = Number(useParams().id)
  const { data: trip, isPending } = useTrip(id)
  const [editing, setEditing] = useState(false)
  const del = useDeleteTrip()
  const patch = usePatchTxn()
  const navigate = useNavigate()

  if (isPending) return <PageSkeleton />
  if (!trip) return <p className="text-sm text-muted">여행을 찾을 수 없어요.</p>

  const max = trip.by_category[0]?.amount ?? 1

  return (
    <>
      <Link to="/trips" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text">
        <ArrowLeft className="size-4" /> 여행·행사 목록
      </Link>
      <PageHeader
        title={trip.name}
        subtitle={`${trip.kind === 'event' ? '학회·행사 · ' : ''}${fmtDate(trip.start_date)} ~ ${fmtDate(trip.end_date)} · ${trip.days}일`}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil /> 수정
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (confirm(`'${trip.name}'을(를) 지울까요? 거래와 정산은 그대로 남아요.`)) del.mutate(trip.id, { onSuccess: () => navigate('/trips') })
              }}
            >
              <Trash2 /> 삭제
            </Button>
          </>
        }
      />

      {trip.claims && <EventClaims claims={trip.claims} spent={trip.spent} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={trip.kind === 'event' ? '내 지출' : '총 지출'} value={won(trip.spent)} sub={`${trip.count}건`} />
        <Stat label="하루 평균 (기간 전체)" value={won(trip.per_day)} sub={`여행 중만: ${wonShort(Math.round(trip.phase.during / trip.days))}/일`} />
        <Stat label="출발 전 결제" value={won(trip.phase.before)} sub="항공·숙소 예약 등" />
        <Stat
          label="예산"
          value={trip.budget ? won(trip.budget) : '—'}
          sub={trip.budget ? (trip.spent > trip.budget ? `${wonShort(trip.spent - trip.budget)} 초과` : `${wonShort(trip.budget - trip.spent)} 남음`) : '수정에서 정할 수 있어요'}
        />
      </div>
      {trip.budget ? <Progress value={trip.spent / trip.budget} className="mt-3" color={trip.spent > trip.budget ? 'var(--bad)' : undefined} /> : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader title="항목별" />
          <CardBody className="space-y-2">
            {trip.by_category.length === 0 && <p className="py-6 text-center text-sm text-subtle">아직 묶인 지출이 없어요</p>}
            {trip.by_category.map((c) => (
              <div key={c.category} className="flex items-center gap-3 text-sm">
                <CategoryDot color={c.color} />
                <span className="w-20 shrink-0 truncate">{c.category}</span>
                <GrowBar value={c.amount / max} color={c.color} className="flex-1 bg-surface-2" />
                <span className="num w-24 shrink-0 text-right">{won(c.amount)}</span>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader title="여행 중 날짜별" />
          <CardBody>
            <DayChart trip={trip} />
          </CardBody>
        </Card>
      </div>

      {(trip.fx.length > 0 || trip.fees > 0) && (
        <Card className="mt-4">
          <CardHeader title="통화별 결제" hint="거래 상세에서 현지 금액을 적은 결제만 모여요" />
          <CardBody className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {trip.fx.map((f) => (
              <div key={f.currency} className="rounded-xl bg-surface-2/60 px-3 py-2.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-semibold">{f.currency}</span>
                  <span className="num text-xs text-subtle">{f.count}건</span>
                </div>
                <div className="num mt-1 text-lg font-bold">{f.foreign.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}</div>
                <div className="num text-xs text-muted">
                  = {won(f.krw)}
                  {f.rate ? ` · 1 ${f.currency} ≈ ${f.rate.toFixed(f.currency === 'JPY' ? 3 : 1)}원` : ''}
                </div>
              </div>
            ))}
            {trip.fees > 0 && (
              <div className="rounded-xl bg-surface-2/60 px-3 py-2.5">
                <div className="text-sm font-semibold">해외 결제 수수료</div>
                <div className="num mt-1 text-lg font-bold">{won(trip.fees)}</div>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {trip.claim_items.length > 0 && (
        <Card className="mt-4 overflow-hidden">
          <CardHeader
            title={`정산 거래 ${trip.claim_items.length}건`}
            hint="남 대신 낸 돈(−)과 돌려받은 돈(+). 내 지출에는 안 들어가요. 거래를 눌러 '정산'에서 빼거나 다른 정산으로 옮길 수 있어요"
            className="pb-3"
          />
          <div className="border-t">
            <TxnList items={[...trip.claim_items].reverse()} />
          </div>
        </Card>
      )}

      <Card className="mt-4 overflow-hidden">
        <CardHeader title={`${trip.kind === 'event' ? '내 지출' : '묶인 거래'} ${trip.items.length}건`} hint="빼고 싶은 거래는 − 버튼, 바꾸고 싶으면 눌러서 수정" className="pb-3" />
        <div className="border-t">
          <TxnList
            items={[...trip.items].reverse()}
            emptyText="이 여행에 묶인 거래가 없어요"
            trailing={(t) => (
              <Button size="icon" variant="ghost" className="size-8" title="여행에서 빼기" onClick={() => patch.mutate({ id: t.id, patch: { trip_id: null } })}>
                <Minus />
              </Button>
            )}
          />
        </div>
      </Card>

      {trip.candidates.length > 0 && (
        <Card className="mt-4 overflow-hidden">
          <CardHeader title={`혹시 이 여행 결제인가요? ${trip.candidates.length}건`} hint="앞뒤 1년 안의 항공·숙소 결제 중 아무 여행에도 안 묶인 것" className="pb-3" />
          <div className="border-t">
            <TxnList
              items={trip.candidates}
              trailing={(t) => (
                <Button size="icon" variant="ghost" className="size-8" title="이 여행에 넣기" onClick={() => patch.mutate({ id: t.id, patch: { trip_id: trip.id } })}>
                  <Plus />
                </Button>
              )}
            />
          </div>
        </Card>
      )}

      <TripForm open={editing} onClose={() => setEditing(false)} trip={trip} />
    </>
  )
}

function DayChart({ trip }: { trip: TripDetail }) {
  const t = useChartTheme()
  const option = useMemo<EChartsOption>(
    () => ({
      grid: { left: 4, right: 4, top: 10, bottom: 4, containLabel: true },
      tooltip: { ...baseTooltip(t), trigger: 'axis', valueFormatter: (v) => won(Number(v)) },
      xAxis: { type: 'category', data: trip.by_day.map((d) => d.date.slice(5).replace('-', '/')), ...baseAxis(t), splitLine: { show: false } },
      yAxis: { type: 'value', ...baseAxis(t), axisLabel: { ...baseAxis(t).axisLabel, formatter: (v: number) => wonShort(v) } },
      series: [{ type: 'bar', data: trip.by_day.map((d) => d.amount), barMaxWidth: 28, itemStyle: { color: t.accent, borderRadius: [4, 4, 0, 0] } }],
    }),
    [trip, t],
  )
  return <EChart option={option} style={{ height: 220 }} />
}

/** 학회·행사: what I paid for the group, what came back, and what the event cost me in the end. */
function EventClaims({ claims, spent }: { claims: NonNullable<TripDetail['claims']>; spent: number }) {
  const gap = claims.paid - claims.reimbursed
  return (
    <Card className="mb-4">
      <CardBody className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-4 text-sm">
        <HandCoins className="size-5 shrink-0 text-accent" />
        <span>
          대신 낸 돈 <b className="num">{won(claims.paid)}</b>
        </span>
        <span>
          돌려받음 <b className="num text-good">{won(claims.reimbursed)}</b>
        </span>
        <span>
          {claims.open ? (gap > 0 ? '받을 돈 ' : '더 받은 돈 ') : '정산 끝 · 차액 '}
          <b className={gap > 0 && claims.open ? 'num text-warn' : 'num'}>{won(Math.abs(gap))}</b>
        </span>
        <span className="text-muted">
          내 부담 <b className="num text-text">{won(spent)}</b>
          {claims.open && gap > 0 && <span className="text-xs text-subtle"> (못 받은 돈은 정산을 끝낼 때 더해져요)</span>}
        </span>
        <Link to="/assets?tab=claims" className="ml-auto text-xs font-medium text-accent hover:underline">
          받을 돈 탭에서 보기 →
        </Link>
      </CardBody>
    </Card>
  )
}

import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowRight, Camera, Footprints, HandCoins, Inbox, Plane, ShieldCheck, Upload } from 'lucide-react'
import type { EChartsOption } from 'echarts'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageSkeleton } from '@/components/layout/PageSkeleton'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Segmented, Stat } from '@/components/ui/controls'
import { AnimatedNumber, GrowBar, Stagger, StaggerItem } from '@/components/ui/motion'
import { EChart } from '@/components/charts/EChart'
import { baseAxis, baseTooltip, useChartTheme } from '@/components/charts/theme'
import { CategoryDot, useCategoryMap } from '@/components/money/bits'
import { type MonthSummary, type Overview, useOverview } from '@/api/money'
import { useMonthBudget } from '@/api/plan'
import { useHealth } from '@/api/client'
import { fmtDate, fmtMonth, monthRange, thisMonth, won, wonShort } from '@/lib/format'
import { GROUP_COLORS, GROUPS } from '@/lib/groups'
import { cn } from '@/lib/utils'

export function HomePage() {
  const { data, isPending } = useOverview()
  if (isPending) return <PageSkeleton />
  if (!data || data.empty || !data.months) {
    return (
      <>
        <PageHeader title="홈" />
        <Card>
          <EmptyState
            icon={Upload}
            title="뱅크샐러드 엑셀을 가져와 주세요"
            action={
              <Link to="/import">
                <Button variant="primary">
                  <Upload /> 가져오기
                </Button>
              </Link>
            }
          >
            뱅크샐러드 앱에서 내보낸 엑셀을 올리면 카드대금·중복을 정리해서 보여드려요.
          </EmptyState>
        </Card>
      </>
    )
  }
  return <Dashboard data={data as Required<Overview>} />
}

/** The ledger only knows what was imported: nudge when the newest row is over a week old. */
function StaleData({ last }: { last: string }) {
  const days = Math.floor((Date.now() - new Date(last.slice(0, 10) + 'T00:00:00').getTime()) / 86_400_000)
  if (days < 8) return null
  return (
    <StaggerItem>
      <Link to="/import" className="lift flex items-center gap-3 rounded-card border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
        <Upload className="size-5 shrink-0 text-warn" />
        <span className="flex-1">
          마지막 거래가 <b className="num">{days}일</b> 전이에요. 뱅크샐러드 엑셀을 가져오면 이번 달 숫자가 맞춰져요.
        </span>
        <ArrowRight className="size-4 text-muted" />
      </Link>
    </StaggerItem>
  )
}

type Scope = 'daily' | 'all'

/** 일상 = spending outside trips and events; 전체 = everything. Remembered per device. */
function useScope(): [Scope, (s: Scope) => void] {
  const [scope, set] = useState<Scope>(() => {
    try {
      return localStorage.getItem('home.scope') === 'all' ? 'all' : 'daily'
    } catch {
      return 'daily'
    }
  })
  return [
    scope,
    (v) => {
      set(v)
      try {
        localStorage.setItem('home.scope', v)
      } catch {
        /* private mode: just don't remember */
      }
    },
  ]
}

const TRIP_COLOR = '#2a78d6'

function Dashboard({ data }: { data: Required<Overview> }) {
  const months = data.months
  const [sel, setSel] = useState(months.length - 1)
  const [scope, setScope] = useScope()
  const cur = months[sel]
  const prev = months[sel - 1]
  const { data: health } = useHealth()

  return (
    <>
      <PageHeader
        title="홈"
        subtitle={`${fmtDate(data.range.first)} ~ ${fmtDate(data.range.last)} 데이터`}
        actions={
          <>
            <Segmented
              size="sm"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'daily', label: '일상' },
                { value: 'all', label: '여행·행사 포함' },
              ]}
            />
            <Link to="/import">
              <Button size="sm">
                <Upload /> 가져오기
              </Button>
            </Link>
          </>
        }
      />

      <Stagger className="space-y-4">
        <StaleData last={data.range.last} />
        {!!data.claims_outstanding && (
          <StaggerItem>
            <Link to="/assets?tab=claims" className="lift flex items-center gap-3 rounded-card border bg-surface px-4 py-3 text-sm shadow-card">
              <HandCoins className="size-5 shrink-0 text-accent" />
              <span className="flex-1">
                정산으로 돌려받을 돈 <b className="num">{won(data.claims_outstanding)}</b>
              </span>
              <ArrowRight className="size-4 text-muted" />
            </Link>
          </StaggerItem>
        )}
        {(data.review.total > 0 || !!health?.live) && (
          <StaggerItem className="grid grid-cols-1 gap-2 split:grid-cols-2">
            {data.review.total > 0 && (
              <Link to="/review" className="lift flex items-center gap-3 rounded-card border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
                <Inbox className="size-5 shrink-0 text-warn" />
                <span className="flex-1">
                  확인할 거래 <b className="num">{data.review.total}건</b>
                  <span className="ml-1.5 text-xs text-muted">
                    미분류 {data.review.uncategorized} · 중복 {data.review.dups} · 큰 송금 {data.review.big_transfers}
                  </span>
                </span>
                <ArrowRight className="size-4 text-muted" />
              </Link>
            )}
            {!!health?.live && (
              <Link to="/review?tab=live" className="lift flex items-center gap-3 rounded-card border border-accent/40 bg-accent-soft px-4 py-3 text-sm">
                <span className="relative flex size-2.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-accent" />
                </span>
                <span className="flex-1">
                  실시간 결제 <b className="num">{health.live}건</b>이 반영돼 있어요
                </span>
                <ArrowRight className="size-4 text-muted" />
              </Link>
            )}
          </StaggerItem>
        )}

        <StaggerItem className="grid grid-cols-1 gap-4 split:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <HeroCard cur={cur} prev={prev} isLatest={sel === months.length - 1} scope={scope} />
          <div className="grid grid-cols-2 gap-3">
            <Stat label={`${fmtMonth(cur.month, true)} 수입`} value={<AnimatedNumber value={cur.income} format={won} />} sub={prev ? `지난달 ${wonShort(prev.income)}` : undefined} />
            <Stat label={`${fmtMonth(cur.month, true)} 저축`} value={<AnimatedNumber value={cur.savings_in} format={won} />} sub="적금·청약 입금" />
            <Link to="/assets" className="col-span-2">
              <Stat
                className="lift"
                label="순자산"
                value={data.balances ? <AnimatedNumber value={data.balances.net} format={won} /> : '—'}
                sub={data.balances ? `${fmtDate(data.balances.as_of)} 뱅크샐러드 기준 · 자산 보기 →` : '자산 정보 없음'}
              />
            </Link>
          </div>
        </StaggerItem>

        <StaggerItem>
          <Card>
            <CardHeader
              title={scope === 'daily' ? '월별 일상 지출' : '월별 지출 (여행·행사 포함)'}
              hint={
                scope === 'daily'
                  ? '여행·학회 기간과 그 예약은 빼고 봐요 · 막대를 누르면 그 달을 볼 수 있어요'
                  : '파란 칸이 여행·행사 · 막대를 누르면 그 달을 볼 수 있어요'
              }
            />
            <CardBody>
              <MonthlyChart months={months} selected={sel} onSelect={setSel} scope={scope} />
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                {GROUPS.map((g) => (
                  <span key={g} className="flex items-center gap-1.5">
                    <CategoryDot color={GROUP_COLORS[g]} /> {g} <span className="num text-subtle">{wonShort(cur.by_group_daily[g] ?? 0)}</span>
                  </span>
                ))}
                {scope === 'all' && (
                  <span className="flex items-center gap-1.5">
                    <CategoryDot color={TRIP_COLOR} /> 여행·행사 <span className="num text-subtle">{wonShort(cur.trips)}</span>
                  </span>
                )}
              </div>
            </CardBody>
          </Card>
        </StaggerItem>

        <StaggerItem>
          <IncomeSpendCard months={months} selected={sel} onSelect={setSel} />
        </StaggerItem>

        <StaggerItem className="grid grid-cols-1 gap-4 split:grid-cols-2 lg:grid-cols-5">
          <div className="split:col-span-1 lg:col-span-3">
            <CategoryCard data={data} month={cur} daily={scope === 'daily'} />
          </div>
          <div className="space-y-4 lg:col-span-2">
            <HobbyCard data={data} />
            <CorrectedCard data={data} />
          </div>
        </StaggerItem>
      </Stagger>
    </>
  )
}

/** This month's spending with the budget alongside, when a budget exists. */
function HeroCard({ cur, prev, isLatest, scope }: { cur: MonthSummary; prev?: MonthSummary; isLatest: boolean; scope: Scope }) {
  const pick = (m?: MonthSummary) => (m ? (scope === 'daily' ? m.daily : m.spending) : undefined)
  const trips = Object.entries(cur.trip_names).sort((a, b) => b[1] - a[1])
  const { data: budget } = useMonthBudget(cur.month)
  const spend = budget?.configured ? budget.lines.filter((l) => l.kind === 'spend') : []
  const limit = spend.reduce((s, l) => s + l.planned, 0)
  const used = spend.reduce((s, l) => s + l.actual, 0)
  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-accent/10 blur-3xl" />
      <CardBody className="relative pt-5">
        <div className="text-xs font-medium text-muted">
          {fmtMonth(cur.month)} {scope === 'daily' ? '일상 지출' : '지출'}
          {isLatest && cur.month === thisMonth() ? ' · 지금까지' : ''}
        </div>
        <AnimatedNumber value={pick(cur)!} format={won} className="mt-1 block text-3xl font-bold tracking-tight fold:text-[34px]" />
        <div className="mt-1 text-sm">
          <Delta cur={pick(cur)!} prev={pick(prev)} />
        </div>
        {cur.trips !== 0 && (
          <Link to="/trips" className="mt-1.5 flex items-center gap-1.5 text-xs text-muted hover:text-text">
            <Plane className="size-3.5 shrink-0" style={{ color: TRIP_COLOR }} />
            <span className="truncate">
              {scope === 'daily' ? '별도로 ' : '그중 '}여행·행사 <b className="num text-text">{won(cur.trips)}</b>
              {trips.length > 0 && ` · ${trips.map(([n]) => n).join(', ')}`}
            </span>
          </Link>
        )}
        {limit > 0 ? (
          <Link to="/budget" className="mt-4 block rounded-xl bg-surface-2/60 p-3 transition-colors hover:bg-surface-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-muted">생활 예산</span>
              <span className={cn('num font-semibold', used > limit ? 'text-bad' : 'text-text')}>
                {used > limit ? `${wonShort(used - limit)} 초과` : `${wonShort(limit - used)} 남음`}
              </span>
            </div>
            <GrowBar value={used / limit} marker={budget?.pace} color={used > limit ? 'var(--bad)' : undefined} className="mt-2 h-2.5" />
            <div className="mt-1 flex justify-between text-[11px] text-subtle">
              <span className="num">{won(used)}</span>
              <span className="num">한도 {won(limit)}</span>
            </div>
          </Link>
        ) : (
          <Link to="/budget" className="mt-4 flex items-center justify-between rounded-xl border border-dashed px-3 py-2.5 text-xs text-muted hover:text-text">
            예산을 만들면 여기서 남은 돈을 보여드려요
            <ArrowRight className="size-3.5" />
          </Link>
        )}
      </CardBody>
    </Card>
  )
}

function Delta({ cur, prev }: { cur: number; prev?: number }) {
  if (prev == null) return null
  const d = cur - prev
  if (d === 0) return <>지난달과 같아요</>
  return (
    <span className={d > 0 ? 'text-bad' : 'text-good'}>
      지난달보다 {wonShort(Math.abs(d))} {d > 0 ? '더' : '덜'} 씀
    </span>
  )
}

/** Month by month: what came in, what went out, and what was left over. */
function IncomeSpendCard({ months, selected, onSelect }: { months: MonthSummary[]; selected: number; onSelect: (i: number) => void }) {
  const rows = months.map((m, i) => ({ ...m, i, left: m.income - m.spending })).reverse()
  const total = rows.reduce(
    (a, r) => ({ income: a.income + r.income, spending: a.spending + r.spending, daily: a.daily + r.daily, trips: a.trips + r.trips }),
    { income: 0, spending: 0, daily: 0, trips: 0 },
  )
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="월별 수입 · 지출"
        hint="일상 = 여행·행사 밖의 지출 · 남은 돈 = 수입 − (일상 + 여행·행사) · 카드대금·내 계좌 이체·정산·저축은 지출이 아니에요"
        className="pb-3"
      />
      <div className="overflow-x-auto border-t">
        <table className="w-full min-w-[24rem] text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b">
              <th className="px-4 py-2 text-left font-medium sm:px-5">월</th>
              <th className="px-2 py-2 text-right font-medium">수입</th>
              <th className="px-2 py-2 text-right font-medium">일상</th>
              <th className="px-2 py-2 text-right font-medium">여행·행사</th>
              <th className="px-2 py-2 text-right font-medium">남은 돈</th>
              <th className="hidden px-4 py-2 text-right font-medium sm:table-cell sm:px-5">저축</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((r) => (
              <tr
                key={r.month}
                onClick={() => onSelect(r.i)}
                className={cn('cursor-pointer transition-colors hover:bg-surface-2/60', r.i === selected && 'bg-accent-soft/60')}
              >
                <td className="px-4 py-2 sm:px-5">{fmtMonth(r.month)}</td>
                <td className="num px-2 py-2 text-right">{wonShort(r.income)}</td>
                <td className="num px-2 py-2 text-right">{wonShort(r.daily)}</td>
                <td className="num px-2 py-2 text-right text-muted" title={Object.entries(r.trip_names).map(([n, a]) => `${n} ${won(a)}`).join('\n')}>
                  {r.trips ? wonShort(r.trips) : ''}
                </td>
                <td className={cn('num px-2 py-2 text-right font-semibold', r.left >= 0 ? 'text-good' : 'text-bad')}>
                  {r.left >= 0 ? '+' : ''}
                  {wonShort(r.left)}
                </td>
                <td className="num hidden px-4 py-2 text-right text-muted sm:table-cell sm:px-5">{wonShort(r.savings_in)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t text-xs text-muted">
            <tr>
              <td className="px-4 py-2 sm:px-5">{rows.length}개월 평균</td>
              <td className="num px-2 py-2 text-right">{wonShort(total.income / rows.length)}</td>
              <td className="num px-2 py-2 text-right">{wonShort(total.daily / rows.length)}</td>
              <td className="num px-2 py-2 text-right">{wonShort(total.trips / rows.length)}</td>
              <td className="num px-2 py-2 text-right">{wonShort((total.income - total.spending) / rows.length)}</td>
              <td className="hidden sm:table-cell" />
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  )
}

function MonthlyChart({ months, selected, onSelect, scope }: { months: MonthSummary[]; selected: number; onSelect: (i: number) => void; scope: Scope }) {
  const t = useChartTheme()
  const option = useMemo<EChartsOption>(
    () => ({
      grid: { left: 4, right: 4, top: 12, bottom: 4, containLabel: true },
      tooltip: {
        ...baseTooltip(t),
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(127,127,127,0.08)' } },
        valueFormatter: (v) => won(Number(v)),
      },
      xAxis: {
        type: 'category',
        data: months.map((m) => fmtMonth(m.month, true)),
        ...baseAxis(t),
        splitLine: { show: false },
      },
      yAxis: { type: 'value', ...baseAxis(t), axisLabel: { ...baseAxis(t).axisLabel, formatter: (v: number) => wonShort(v) } },
      series: [
        ...GROUPS.map((g, gi) => ({
          name: g,
          type: 'bar' as const,
          stack: 'spend',
          barMaxWidth: 34,
          data: months.map((m, i) => ({
            value: Math.max(0, m.by_group_daily[g] ?? 0),
            itemStyle: {
              color: GROUP_COLORS[g],
              opacity: i === selected ? 1 : 0.45,
              borderRadius: scope === 'daily' && gi === GROUPS.length - 1 ? [4, 4, 0, 0] : 0,
            },
          })),
        })),
        ...(scope === 'all'
          ? [{
              name: '여행·행사',
              type: 'bar' as const,
              stack: 'spend',
              barMaxWidth: 34,
              data: months.map((m, i) => ({
                value: Math.max(0, m.trips),
                itemStyle: { color: TRIP_COLOR, opacity: i === selected ? 1 : 0.45, borderRadius: [4, 4, 0, 0] },
              })),
            }]
          : []),
      ],
    }),
    [months, selected, t, scope],
  )
  return (
    <EChart
      option={option}
      style={{ height: 240 }}
      onEvents={{ click: (p) => onSelect((p as { dataIndex: number }).dataIndex) }}
    />
  )
}

function CategoryCard({ data, month, daily }: { data: Required<Overview>; month: MonthSummary; daily: boolean }) {
  const [scope, setScope] = useState<'month' | 'year'>('month')
  const cats = useCategoryMap()
  const navigate = useNavigate()
  const leaves: [string, number][] =
    scope === 'month'
      ? Object.entries(daily ? month.by_category_daily : month.by_category)
      : (daily ? data.ytd_daily : data.ytd).map((r) => [r.category, r.amount])
  const byParent = new Map<string, { amount: number; parts: Map<string, number> }>()
  for (const [category, amount] of leaves) {
    const parent = cats.get(category)?.parent ?? category
    const b = byParent.get(parent) ?? { amount: 0, parts: new Map<string, number>() }
    b.amount += amount
    if (category !== parent) b.parts.set(category, (b.parts.get(category) ?? 0) + amount)
    byParent.set(parent, b)
  }
  const rows = [...byParent.entries()]
    .map(([category, b]) => ({
      category,
      amount: b.amount,
      color: cats.get(category)?.color ?? '#999',
      parts: [...b.parts.entries()].filter(([, a]) => a > 0).sort((x, y) => y[1] - x[1]),
    }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount)
  const total = rows.reduce((s, r) => s + r.amount, 0)
  const max = rows[0]?.amount ?? 1
  const range = scope === 'month' ? monthRange(month.month) : { start: `${data.year}-01-01`, end: `${data.year}-12-31` }

  return (
    <Card>
      <CardHeader
        title={daily ? '카테고리별 일상 지출' : '카테고리별 지출'}
        hint={`${scope === 'month' ? fmtMonth(month.month) : `${data.year}년`} · 합계 ${won(total)}`}
        action={
          <Segmented
            size="sm"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'month', label: fmtMonth(month.month, true) },
              { value: 'year', label: '올해' },
            ]}
          />
        }
      />
      <CardBody className="px-2 sm:px-3">
        {rows.length === 0 && <p className="py-8 text-center text-sm text-subtle">지출이 없어요</p>}
        <ul>
          {rows.map((r) => (
            <li key={r.category}>
              <button
                onClick={() => navigate(`/transactions?category=${encodeURIComponent(r.category)}&start=${range.start}&end=${range.end}`)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-2"
              >
                <CategoryDot color={r.color} />
                <span className="w-20 shrink-0 text-sm">
                  <span className="block truncate">{r.category}</span>
                  {r.parts.length > 0 && (
                    <span className="block truncate text-[10px] text-subtle" title={r.parts.map(([c, a]) => `${c} ${won(a)}`).join(' · ')}>
                      {r.parts.slice(0, 2).map(([c]) => c).join(' · ')}
                    </span>
                  )}
                </span>
                <GrowBar value={r.amount / max} color={r.color} className="flex-1 bg-surface-2" />
                <span className="num w-24 shrink-0 text-right text-sm font-medium">{won(r.amount)}</span>
                <span className="num hidden w-10 shrink-0 text-right text-xs text-subtle sm:block">
                  {total ? Math.round((r.amount / total) * 100) : 0}%
                </span>
              </button>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  )
}

const HOBBY_ICON = { 여행: Plane, 러닝: Footprints, 카메라: Camera } as const

function HobbyCard({ data }: { data: Required<Overview> }) {
  return (
    <Card>
      <CardHeader title="여행 · 취미" hint="올해 / 최근 12개월" />
      <CardBody className="grid grid-cols-3 gap-2">
        {data.hobbies.map((h) => {
          const Icon = HOBBY_ICON[h.category as keyof typeof HOBBY_ICON] ?? Plane
          return (
            <Link
              key={h.category}
              to={h.category === '여행' ? '/trips' : `/transactions?category=${encodeURIComponent(h.category)}`}
              className="rounded-xl border bg-surface-2/50 p-3 transition-colors hover:border-border-strong"
            >
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
                <Icon className="size-3.5" style={{ color: h.color }} /> {h.category}
              </div>
              <div className="num mt-1.5 text-base font-bold">{wonShort(h.ytd)}</div>
              <div className="num text-[11px] text-subtle">12개월 {wonShort(h.last12)}</div>
            </Link>
          )
        })}
      </CardBody>
    </Card>
  )
}

function CorrectedCard({ data }: { data: Required<Overview> }) {
  const c = data.corrected
  if (!c.card_payments_as_spending.count && !c.duplicates.count) return null
  return (
    <Card>
      <CardHeader title="뱅크샐러드 합계와 다른 점" />
      <CardBody className="space-y-2 text-[13px] text-muted">
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-good" />
          <p>
            뱅크샐러드가 <b className="text-text">지출</b>로 센 카드대금 출금 {c.card_payments_as_spending.count}건(
            <span className="num">{won(c.card_payments_as_spending.amount)}</span>)은 카드 사용 내역과 겹쳐서 지출에서 뺐어요.
          </p>
        </div>
        {c.duplicates.count > 0 && (
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-good" />
            <p>
              간편결제와 카드에 같이 찍힌 중복 {c.duplicates.count}건도 한 번만 셌어요.{' '}
              <Link to="/review?tab=dups" className="font-medium text-accent">
                확인하기
              </Link>
            </p>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

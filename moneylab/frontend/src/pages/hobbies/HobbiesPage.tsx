import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { Camera, Footprints, Link2, Medal } from 'lucide-react'
import type { EChartsOption } from 'echarts'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Segmented, Select, Stat } from '@/components/ui/controls'
import { AnimatedNumber, GrowBar, Stagger, StaggerItem } from '@/components/ui/motion'
import { EChart } from '@/components/charts/EChart'
import { baseAxis, baseTooltip, useChartTheme } from '@/components/charts/theme'
import { TxnList } from '@/components/money/TxnList'
import { useTransactions } from '@/api/money'
import { type RunningData, useRunLink, useRunning } from '@/api/tools'
import { fmtDate, fmtMonth, won, wonShort } from '@/lib/format'

type Tab = 'running' | 'camera'

export function HobbiesPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'running'
  return (
    <>
      <PageHeader title="취미" subtitle="러닝과 카메라에 쓰는 돈, 그리고 그만큼 얼마나 달렸는지" />
      <Segmented
        value={tab}
        onChange={(v) => setParams(v === 'running' ? {} : { tab: v }, { replace: true })}
        options={[
          { value: 'running', label: <><Footprints className="size-3.5" /> 러닝</> },
          { value: 'camera', label: <><Camera className="size-3.5" /> 카메라</> },
        ]}
        className="mb-4"
      />
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>
          {tab === 'running' ? <RunningTab /> : <CameraTab />}
        </motion.div>
      </AnimatePresence>
    </>
  )
}

function RunningTab() {
  const { data } = useRunning()
  if (!data) return <div className="shimmer h-96 rounded-card" />
  return (
    <Stagger className="grid grid-cols-1 gap-4 split:grid-cols-2">
      <StaggerItem className="grid grid-cols-3 gap-3 split:col-span-2">
        <Stat label="최근 12개월 러닝 지출" value={<AnimatedNumber value={data.total_spend} format={won} />} />
        <Stat label="달린 거리" value={data.connected ? <AnimatedNumber value={Math.round(data.total_km)} format={(v) => `${v.toLocaleString()} km`} /> : '—'} sub={data.connected ? 'RunLab 기록' : 'RunLab 연결 안 됨'} />
        <Stat label="km당 비용" value={data.cost_per_km ? <AnimatedNumber value={data.cost_per_km} format={won} /> : '—'} sub="장비·대회·사진 모두 포함" />
      </StaggerItem>

      {!data.connected && (
        <StaggerItem className="split:col-span-2">
          <Card>
            <CardBody className="pt-4 text-[13px] text-muted">
              RunLab 데이터를 찾지 못했어요 (<code className="rounded bg-surface-2 px-1">{data.runlab_db}</code>). RunLab을 다른 곳에 두었다면 backend/.env에
              <code className="mx-1 rounded bg-surface-2 px-1">MONEYLAB_RUNLAB_DB=경로</code>를 넣어 주세요. 지출 쪽은 지금도 보여요.
            </CardBody>
          </Card>
        </StaggerItem>
      )}

      <StaggerItem className="split:col-span-2">
        <Card>
          <CardHeader title="월별 러닝 지출과 거리" hint="막대: 지출 · 선: 달린 km" />
          <CardBody>
            <SpendKmChart data={data} />
          </CardBody>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <Card className="h-full">
          <CardHeader title="신발별 km당 비용" hint="아래 구매 내역에서 신발을 연결하면 계산돼요" />
          <CardBody className="space-y-3">
            {!data.shoes.length && <p className="text-sm text-subtle">RunLab에 등록된 신발이 없어요</p>}
            {data.shoes.map((s) => (
              <div key={s.id} className={s.retired ? 'opacity-60' : undefined}>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-medium">
                    {s.name}
                    {s.retired && <span className="ml-1.5 text-[11px] text-subtle">은퇴</span>}
                  </span>
                  <span className="num shrink-0 text-xs text-muted">
                    {s.km.toLocaleString()} km{s.cost_per_km ? ` · ${won(s.cost_per_km)}/km` : ''}
                  </span>
                </div>
                <GrowBar value={s.km / 700} className="mt-1.5 h-1.5" color={s.km > 600 ? 'var(--warn)' : undefined} />
                <div className="mt-0.5 text-[11px] text-subtle">{s.price ? `구매 ${won(s.price)}` : '구매 결제 미연결'} · 700km 기준</div>
              </div>
            ))}
          </CardBody>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <Card className="h-full">
          <CardHeader title="목표 대회 · 참가비" />
          <CardBody className="space-y-2">
            {!data.races.length && <p className="text-sm text-subtle">RunLab에 목표 대회가 없어요</p>}
            {data.races.map((r) => (
              <div key={r.id} className="flex items-center gap-3 text-sm">
                <Medal className="size-4 shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.name}</div>
                  <div className="text-[11px] text-subtle">{fmtDate(r.race_day)} · {r.distance_km}km</div>
                </div>
                <span className="num text-xs text-muted">{r.fee ? won(r.fee) : '참가비 미연결'}</span>
              </div>
            ))}
          </CardBody>
        </Card>
      </StaggerItem>

      <StaggerItem className="split:col-span-2">
        <PurchasesCard data={data} />
      </StaggerItem>
    </Stagger>
  )
}

function SpendKmChart({ data }: { data: RunningData }) {
  const t = useChartTheme()
  const option = useMemo<EChartsOption>(
    () => ({
      grid: { left: 4, right: 4, top: 26, bottom: 4, containLabel: true },
      legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: t.muted, fontSize: 11 } },
      tooltip: { ...baseTooltip(t), trigger: 'axis' },
      xAxis: { type: 'category', data: data.months.map((m) => fmtMonth(m.month, true)), ...baseAxis(t), splitLine: { show: false } },
      yAxis: [
        { type: 'value', ...baseAxis(t), axisLabel: { ...baseAxis(t).axisLabel, formatter: (v: number) => wonShort(v) } },
        { type: 'value', ...baseAxis(t), splitLine: { show: false }, axisLabel: { ...baseAxis(t).axisLabel, formatter: '{value}km' } },
      ],
      series: [
        { name: '지출', type: 'bar', data: data.months.map((m) => m.spend), barMaxWidth: 26, itemStyle: { color: '#e8590c', borderRadius: [4, 4, 0, 0] }, tooltip: { valueFormatter: (v) => won(Number(v)) } },
        { name: '거리', type: 'line', yAxisIndex: 1, smooth: true, data: data.months.map((m) => m.km), symbolSize: 6, lineStyle: { color: t.accent, width: 2 }, itemStyle: { color: t.accent }, tooltip: { valueFormatter: (v) => `${v} km` } },
      ],
    }),
    [data, t],
  )
  return <EChart option={option} style={{ height: 240 }} />
}

function PurchasesCard({ data }: { data: RunningData }) {
  const link = useRunLink()
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-1.5 text-text"><Link2 className="size-4 text-accent" /> 러닝 구매 내역 (최근 2년)</span>}
        hint="신발이나 대회에 연결하면 km당 비용·참가비가 계산돼요. '러닝' 카테고리 결제만 보여요."
      />
      <CardBody className="px-0 pb-1">
        {!data.purchases.length && (
          <p className="px-5 pb-4 text-sm text-subtle">
            아직 '러닝'으로 분류된 결제가 없어요. <Link to="/settings" className="text-accent">분류 규칙</Link>을 확인해 보세요.
          </p>
        )}
        <ul className="divide-y">
          {data.purchases.map((p) => {
            const value = p.gear_id ? `g${p.gear_id}` : p.race_id ? `r${p.race_id}` : ''
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.merchant}</div>
                  <div className="text-[11px] text-subtle">{fmtDate(p.date)}</div>
                </div>
                <span className="num text-sm font-semibold">{won(p.amount)}</span>
                <Select
                  value={value}
                  onChange={(e) => {
                    const v = e.target.value
                    link.mutate({ txn_id: p.id, gear_id: v.startsWith('g') ? Number(v.slice(1)) : null, race_id: v.startsWith('r') ? Number(v.slice(1)) : null })
                  }}
                  className="w-44 [&_select]:h-8 [&_select]:text-xs"
                  aria-label="연결"
                  disabled={!data.connected}
                >
                  <option value="">연결 안 함</option>
                  {data.shoes.length > 0 && (
                    <optgroup label="신발">
                      {data.shoes.map((s) => (
                        <option key={s.id} value={`g${s.id}`}>{s.name}</option>
                      ))}
                    </optgroup>
                  )}
                  {data.races.length > 0 && (
                    <optgroup label="대회">
                      {data.races.map((r) => (
                        <option key={r.id} value={`r${r.id}`}>{r.name}</option>
                      ))}
                    </optgroup>
                  )}
                </Select>
              </li>
            )
          })}
        </ul>
      </CardBody>
    </Card>
  )
}

function CameraTab() {
  const { data } = useTransactions({ category: '카메라', limit: 300 })
  const items = data?.items ?? []
  const byYear = items.reduce<Record<string, number>>((acc, t) => {
    const y = t.occurred_at.slice(0, 4)
    acc[y] = (acc[y] ?? 0) - t.amount
    return acc
  }, {})
  if (data && !items.length) {
    return (
      <Card>
        <EmptyState icon={Camera} title="'카메라'로 분류된 결제가 없어요">
          카메라·렌즈 산 결제가 결제대행사 이름으로만 찍혀서 미분류에 있을 수 있어요. 확인하기에서 '카메라'를 골라 주거나, 매장 이름으로 분류 규칙을 만들어 두세요.
        </EmptyState>
      </Card>
    )
  }
  return (
    <Stagger className="grid grid-cols-1 gap-4">
      <StaggerItem className="grid grid-cols-2 gap-3 split:grid-cols-4">
        {Object.entries(byYear)
          .sort(([a], [b]) => b.localeCompare(a))
          .map(([y, v]) => (
            <Stat key={y} label={`${y}년`} value={<AnimatedNumber value={v} format={won} />} />
          ))}
      </StaggerItem>
      <StaggerItem>
        <Card className="overflow-clip">
          <CardHeader title={`카메라 구매 ${items.length}건`} hint="눌러서 메모(바디·렌즈 이름 등)를 남겨 두면 장비 목록처럼 쓸 수 있어요" className="pb-3" />
          <div className="border-t">
            <TxnList items={items} />
          </div>
        </Card>
      </StaggerItem>
    </Stagger>
  )
}

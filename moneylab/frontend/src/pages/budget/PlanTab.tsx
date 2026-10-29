import { useMemo, useState, type FormEvent } from 'react'
import { AlertTriangle, CalendarPlus, Loader2, Pencil, Plane, Settings2, Trash2 } from 'lucide-react'
import type { EChartsOption } from 'echarts'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label } from '@/components/ui/input'
import { Segmented, Select } from '@/components/ui/controls'
import { AnimatedNumber, Stagger, StaggerItem } from '@/components/ui/motion'
import { EChart } from '@/components/charts/EChart'
import { baseAxis, baseTooltip, useChartTheme } from '@/components/charts/theme'
import {
  type Forecast,
  type PlanEvent,
  useBudgetLines,
  useDeleteEvent,
  useForecast,
  useSaveEvent,
  useSavePlanSettings,
} from '@/api/plan'
import { addMonths, fmtDate, fmtMonth, parseWon, thisMonth, won, wonShort } from '@/lib/format'
import { cn } from '@/lib/utils'

export function PlanTab() {
  const { data } = useForecast(12)
  const [event, setEvent] = useState<Partial<PlanEvent> | null>(null)
  const [settings, setSettings] = useState(false)

  if (!data) return <div className="shimmer h-96 rounded-card" />
  const last = data.months[data.months.length - 1]
  const lowest = data.months.reduce((m, r) => (r.free < m.free ? r : m), data.months[0])

  return (
    <Stagger className="grid grid-cols-1 gap-4">
      <StaggerItem className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="지금 쓸 수 있는 통장 잔액" value={data.start_cash ?? 0} sub={data.cash_known ? `${fmtDate(data.cash_as_of)} 뱅크샐러드 기준` : '잔액 정보 없음 (엑셀 가져오기 필요)'} />
        <Tile label={`${fmtMonth(last.month, true)} 말 예상 잔액`} value={last.cash} tone={last.cash < 0 ? 'bad' : undefined} />
        <Tile label="비상금 목표" value={data.emergency_target} sub={`생활 한도의 ${data.settings.emergency_months}개월치`} />
        <Tile
          label={lowest.free < 0 ? '비상금·봉투까지 채우려면 부족한 돈' : '가장 빠듯한 달의 자유 자금'}
          value={Math.abs(lowest.free)}
          sub={`${fmtMonth(lowest.month)} 기준`}
          tone={lowest.free < 0 ? 'bad' : 'good'}
        />
      </StaggerItem>

      <StaggerItem>
        <div
          className={cn(
            'flex flex-wrap items-center gap-x-4 gap-y-1 rounded-card border px-4 py-3 text-[13px]',
            data.monthly_balance < 0 ? 'border-bad/40 bg-bad/10' : 'border-good/40 bg-good/10',
          )}
        >
          <span>
            월 수입 <b className="num">{won(data.settings.income)}</b> − 매달 계획 <b className="num">{won(data.committed)}</b> ={' '}
            <b className={cn('num', data.monthly_balance < 0 ? 'text-bad' : 'text-good')}>{won(data.monthly_balance)}</b>
          </span>
          <span className="text-xs text-muted">
            {data.monthly_balance < 0
              ? '한도·봉투를 줄이거나, 정기적으로 들어오는 다른 돈(용돈·정산 등)이 있다면 월 수입에 더해 주세요.'
              : '매달 이만큼 여유가 생겨요. 봉투나 투자에 더 넣을 수 있어요.'}
          </span>
        </div>
      </StaggerItem>

      {data.warnings.filter((w) => w.kind !== 'plan_deficit').length > 0 && (
        <StaggerItem>
          <div className="space-y-1.5 rounded-card border border-warn/40 bg-warn/10 px-4 py-3 text-[13px]">
            {data.warnings.filter((w) => w.kind !== 'plan_deficit').slice(0, 5).map((w, i) => (
              <div key={i} className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
                <span>
                  <b>{fmtMonth(w.month, true)}</b> · {w.message}
                </span>
              </div>
            ))}
          </div>
        </StaggerItem>
      )}

      <StaggerItem>
        <Card>
          <CardHeader
            title="12개월 자금 흐름"
            hint="월말 통장 잔액을 비상금 → 봉투 → 자유 자금 순서로 채워요. 아래 빨간 막대는 그걸 다 채우기에 모자란 돈이에요."
            action={
              <Button size="sm" variant="ghost" onClick={() => setSettings(true)}>
                <Settings2 /> 수입 · 비상금
              </Button>
            }
          />
          <CardBody>
            <ForecastChart data={data} />
          </CardBody>
        </Card>
      </StaggerItem>

      <StaggerItem className="grid grid-cols-1 gap-4 split:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card>
          <CardHeader
            title="계획된 큰 돈"
            hint="여행, 큰 구매, 보너스처럼 한 번에 드나드는 돈. 예산이 있는 다가오는 여행은 자동으로 들어가요."
            action={
              <Button size="sm" variant="primary" onClick={() => setEvent({ month: addMonths(thisMonth(), 1), amount: -500000 })}>
                <CalendarPlus /> 추가
              </Button>
            }
          />
          <CardBody className="space-y-1.5">
            {data.months.every((m) => m.events.length === 0) && <p className="py-4 text-center text-sm text-subtle">아직 없어요</p>}
            {data.months.flatMap((m) =>
              m.events.map((e, i) => (
                <div key={`${m.month}-${e.id ?? `trip${e.trip_id}`}-${i}`} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2/60">
                  <span className="num w-12 shrink-0 text-xs text-muted">{fmtMonth(m.month, true)}</span>
                  {e.trip_id && <Plane className="size-3.5 shrink-0 text-accent" />}
                  <span className="min-w-0 flex-1 truncate text-sm">{e.name}</span>
                  <span className={cn('num text-sm font-semibold', e.amount > 0 && 'text-good')}>{e.amount > 0 ? '+' : ''}{won(e.amount)}</span>
                  {e.id ? (
                    <Button size="icon" variant="ghost" className="size-7" aria-label="수정" onClick={() => setEvent({ ...e, month: m.month, id: e.id! })}>
                      <Pencil />
                    </Button>
                  ) : (
                    <span className="w-7 text-center text-[10px] text-subtle" title="여행 예산에서 자동">자동</span>
                  )}
                </div>
              )),
            )}
          </CardBody>
        </Card>

        <Card className="overflow-clip">
          <CardHeader title="월별 표" className="pb-3" />
          <div className="overflow-x-auto border-t">
            <table className="w-full min-w-[520px] text-right text-[12.5px]">
              <thead className="bg-surface-2/60 text-[11px] text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">월</th>
                  <th className="px-2 py-2 font-medium">수입</th>
                  <th className="px-2 py-2 font-medium">생활·고정</th>
                  <th className="px-2 py-2 font-medium">저축·투자</th>
                  <th className="px-2 py-2 font-medium">큰 돈</th>
                  <th className="px-2 py-2 font-medium">월말 잔액</th>
                  <th className="px-3 py-2 font-medium">자유 자금</th>
                </tr>
              </thead>
              <tbody className="num divide-y">
                {data.months.map((m) => (
                  <tr key={m.month}>
                    <td className="px-3 py-1.5 text-left font-medium">{fmtMonth(m.month, true)}</td>
                    <td className="px-2 py-1.5 text-good">{wonShort(m.income)}</td>
                    <td className="px-2 py-1.5">{wonShort(m.spend)}</td>
                    <td className="px-2 py-1.5">{wonShort(m.transfers)}</td>
                    <td className="px-2 py-1.5">{m.event_out ? wonShort(-m.event_out) : '·'}</td>
                    <td className={cn('px-2 py-1.5 font-semibold', m.cash < 0 && 'text-bad')}>{wonShort(m.cash)}</td>
                    <td className={cn('px-3 py-1.5', m.free < 0 ? 'text-bad' : 'text-muted')}>{wonShort(m.free)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <p className="text-xs leading-relaxed text-subtle">
          계산 방법: 이번 달은 남은 한도만큼만 더 쓰고, 다음 달부터는 예산대로 쓴다고 가정해요. 봉투에 쌓는 돈은 통장에 그대로 있다가, 계획한 큰 돈이 나갈 때 줄어들어요.
          예산 밖 지출과 이자는 넣지 않았어요.
        </p>
      </StaggerItem>

      <EventDialog event={event} onClose={() => setEvent(null)} />
      <SettingsDialog open={settings} onClose={() => setSettings(false)} current={data.settings} />
    </Stagger>
  )
}

function Tile({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: 'bad' | 'good' }) {
  return (
    <div className="min-w-0 rounded-card border bg-surface px-4 py-3.5 shadow-card">
      <div className="truncate text-xs font-medium text-muted">{label}</div>
      <AnimatedNumber value={value} format={won} className={cn('mt-1 block truncate text-lg font-bold tracking-tight xl:text-[22px]', tone === 'bad' && 'text-bad', tone === 'good' && 'text-good')} />
      {sub && <div className="mt-0.5 truncate text-xs text-subtle">{sub}</div>}
    </div>
  )
}

function ForecastChart({ data }: { data: Forecast }) {
  const t = useChartTheme()
  const option = useMemo<EChartsOption>(() => {
    const months = data.months.map((m) => fmtMonth(m.month, true))
    const emergency = data.months.map((m) => Math.max(0, Math.min(m.emergency, m.cash)))
    const reserved = data.months.map((m, i) => Math.max(0, Math.min(m.reserved, m.cash - emergency[i])))
    const free = data.months.map((m) => m.free)
    return {
      grid: { left: 4, right: 4, top: 28, bottom: 4, containLabel: true },
      legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: t.muted, fontSize: 11 } },
      tooltip: { ...baseTooltip(t), trigger: 'axis', valueFormatter: (v) => won(Number(v)) },
      xAxis: { type: 'category', data: months, ...baseAxis(t), splitLine: { show: false } },
      yAxis: { type: 'value', ...baseAxis(t), axisLabel: { ...baseAxis(t).axisLabel, formatter: (v: number) => wonShort(v) } },
      animationDuration: 700,
      animationEasing: 'cubicOut',
      series: [
        { name: '비상금', type: 'bar', stack: 'cash', data: emergency, itemStyle: { color: t.dark ? '#495057' : '#ced4da' }, barMaxWidth: 30 },
        { name: '봉투 적립금', type: 'bar', stack: 'cash', data: reserved, itemStyle: { color: '#2a78d6' }, barMaxWidth: 30 },
        { name: '자유 자금', type: 'bar', stack: 'cash', data: free.map((v) => Math.max(0, v)), itemStyle: { color: t.good, borderRadius: [4, 4, 0, 0] }, barMaxWidth: 30 },
        // Below zero: what's missing to keep the emergency fund and envelopes whole.
        { name: '부족', type: 'bar', stack: 'cash', data: free.map((v) => Math.min(0, v)), itemStyle: { color: t.bad, borderRadius: [0, 0, 4, 4] }, barMaxWidth: 30 },
        {
          name: '월말 잔액',
          type: 'line',
          data: data.months.map((m) => m.cash),
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { color: t.text, width: 2 },
          itemStyle: { color: t.text },
          z: 5,
        },
      ],
    }
  }, [data, t])
  return <EChart option={option} style={{ height: 280 }} />
}

function EventDialog({ event, onClose }: { event: Partial<PlanEvent> | null; onClose: () => void }) {
  return (
    <Dialog open={!!event} onClose={onClose} title={event?.id ? '계획 수정' : '큰 돈 계획 추가'} description="나가는 돈과 들어오는 돈 모두 넣을 수 있어요">
      {event && <EventBody key={event.id ?? 'new'} event={event} onDone={onClose} />}
    </Dialog>
  )
}

function EventBody({ event, onDone }: { event: Partial<PlanEvent>; onDone: () => void }) {
  const save = useSaveEvent()
  const del = useDeleteEvent()
  const { data: lines } = useBudgetLines()
  const funds = (lines ?? []).filter((l) => l.kind === 'fund')
  const [dir, setDir] = useState<'out' | 'in'>((event.amount ?? -1) < 0 ? 'out' : 'in')
  const [month, setMonth] = useState(event.month ?? thisMonth())
  const [name, setName] = useState(event.name ?? '')
  const [amount, setAmount] = useState(event.amount ? String(Math.abs(event.amount)) : '')
  const [lineId, setLineId] = useState(event.line_id ? String(event.line_id) : '')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const n = parseWon(amount) ?? 0
    save.mutate(
      {
        id: event.id, month, name: name.trim(), amount: dir === 'out' ? -n : n,
        line_id: dir === 'out' && lineId ? Number(lineId) : null, trip_id: event.trip_id ?? null, note: null,
      },
      { onSuccess: onDone },
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4 px-5 py-4">
      <Segmented value={dir} onChange={setDir} options={[{ value: 'out', label: '나가는 돈' }, { value: 'in', label: '들어오는 돈' }]} />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="ev-month">월</Label>
          <Input id="ev-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="ev-amount">금액</Label>
          <Input id="ev-amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="예: 150만" inputMode="numeric" required />
        </div>
      </div>
      <div>
        <Label htmlFor="ev-name">이름</Label>
        <Input id="ev-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={dir === 'out' ? '예: 오사카 여행, 카메라 렌즈' : '예: 연구비 정산, 성과급'} required />
      </div>
      {dir === 'out' && funds.length > 0 && (
        <div>
          <Label htmlFor="ev-fund">어느 봉투에서 낼까요?</Label>
          <Select id="ev-fund" value={lineId} onChange={(e) => setLineId(e.target.value)}>
            <option value="">봉투 없이 (자유 자금에서)</option>
            {funds.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        </div>
      )}
      {save.error && <p className="text-sm text-bad">{save.error.message}</p>}
      <div className="flex items-center justify-between gap-2">
        {event.id ? (
          <Button type="button" variant="ghost" onClick={() => del.mutate(event.id!, { onSuccess: onDone })}>
            <Trash2 /> 삭제
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            취소
          </Button>
          <Button type="submit" variant="primary" disabled={save.isPending || !name.trim()}>
            {save.isPending && <Loader2 className="animate-spin" />}저장
          </Button>
        </div>
      </div>
    </form>
  )
}

function SettingsDialog({ open, onClose, current }: { open: boolean; onClose: () => void; current: { income: number; emergency_months: number } }) {
  return (
    <Dialog open={open} onClose={onClose} title="수입 · 비상금" description="자금 계획의 기준이 되는 숫자예요">
      {open && <SettingsBody current={current} onDone={onClose} />}
    </Dialog>
  )
}

function SettingsBody({ current, onDone }: { current: { income: number; emergency_months: number }; onDone: () => void }) {
  const save = useSavePlanSettings()
  const [income, setIncome] = useState(String(current.income))
  const [months, setMonths] = useState(String(current.emergency_months))
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate({ income: parseWon(income) ?? 0, emergency_months: Number(months) || 0 }, { onSuccess: onDone })
      }}
      className="space-y-4 px-5 py-4"
    >
      <div>
        <Label htmlFor="pl-income">월 수입 (세후, 계획)</Label>
        <Input id="pl-income" value={income} onChange={(e) => setIncome(e.target.value)} inputMode="numeric" />
      </div>
      <div>
        <Label htmlFor="pl-em">비상금 (생활 한도의 몇 개월치)</Label>
        <Input id="pl-em" value={months} onChange={(e) => setMonths(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" />
        <p className="mt-1 text-[11px] text-subtle">통장에서 건드리지 않고 남겨 둘 돈이에요. 흔히 3~6개월치를 기준으로 삼지만, 상황에 맞게 정하세요.</p>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          취소
        </Button>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          저장
        </Button>
      </div>
    </form>
  )
}

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { BookOpenCheck, Loader2, Pencil, Plus, Target, Trash2, TrendingUp } from 'lucide-react'
import type { EChartsOption } from 'echarts'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label } from '@/components/ui/input'
import { Select, Textarea } from '@/components/ui/controls'
import { AnimatedNumber, GrowBar, Stagger, StaggerItem } from '@/components/ui/motion'
import { EChart } from '@/components/charts/EChart'
import { baseAxis, baseTooltip, useChartTheme } from '@/components/charts/theme'
import {
  type Holding,
  type InvestOverview,
  type InvestPolicy,
  useDeleteHolding,
  useInvest,
  useSaveHolding,
  useSavePolicy,
  useSaveTargets,
} from '@/api/extra'
import { useBudgetLines } from '@/api/plan'
import { fmtDate, fmtMonth, parseWon, pct, won, wonShort } from '@/lib/format'
import { cn } from '@/lib/utils'
import { CompositionChart } from './NetWorthTab'

export function InvestTab() {
  const { data } = useInvest()
  const [holding, setHolding] = useState<Partial<Holding> | null>(null)
  const [targets, setTargets] = useState(false)
  if (!data) return <div className="shimmer h-96 rounded-card" />

  const empty = data.holdings.length === 0
  const thisMonth = data.contributions[data.contributions.length - 1]?.amount ?? 0
  const total12 = data.contributions.slice(-12).reduce((s, c) => s + c.amount, 0)

  return (
    <Stagger className="grid grid-cols-1 gap-4 split:grid-cols-2">
      <StaggerItem className="grid grid-cols-2 gap-3 lg:grid-cols-4 split:col-span-2">
        <Tile label="평가 금액" value={data.totals.value} />
        <Tile label="투자 원금" value={data.totals.cost} />
        <Tile
          label="손익"
          value={data.totals.gain}
          sub={data.totals.gain_pct != null ? pct(data.totals.gain_pct, 1) : undefined}
          tone={data.totals.gain > 0 ? 'good' : data.totals.gain < 0 ? 'bad' : undefined}
        />
        <Tile label="이번 달 투자금" value={thisMonth} sub={`최근 12개월 ${wonShort(total12)}`} />
      </StaggerItem>

      {empty && (
        <StaggerItem className="split:col-span-2">
          <StartGuide onAdd={() => setHolding({ asset_class: '해외주식' })} onTargets={() => setTargets(true)} />
        </StaggerItem>
      )}

      <StaggerItem>
        <Card className="h-full">
          <CardHeader
            title="자산군 비중"
            hint="목표 비중은 내가 정한 숫자예요"
            action={
              <Button size="sm" variant="ghost" onClick={() => setTargets(true)}>
                <Target /> 목표 비중
              </Button>
            }
          />
          <CardBody>
            {data.classes.length === 0 ? (
              <p className="py-6 text-center text-sm text-subtle">보유 자산을 기록하면 비중이 보여요</p>
            ) : (
              <>
                {data.totals.value > 0 && <CompositionChart groups={data.classes.map((c) => ({ name: c.asset_class, value: c.value }))} height={160} />}
                <div className="mt-2 space-y-3">
                  {data.classes.map((c) => (
                    <div key={c.asset_class}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{c.asset_class}</span>
                        <span className="num text-xs text-muted">
                          {pct(c.pct)}
                          {c.target_pct != null && <> / 목표 {pct(c.target_pct)}</>}
                        </span>
                      </div>
                      <div className="relative mt-1">
                        <GrowBar value={c.pct} marker={c.target_pct} className="h-2" />
                      </div>
                      {c.diff != null && Math.abs(c.diff) >= 10000 && (
                        <div className={cn('mt-0.5 text-right text-[11px]', c.diff > 0 ? 'text-accent' : 'text-warn')}>
                          목표까지 {c.diff > 0 ? `${wonShort(c.diff)} 더` : `${wonShort(-c.diff)} 줄이면`}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardBody>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <Card className="h-full">
          <CardHeader
            title="보유 자산"
            hint={data.holdings.some((h) => h.source === 'banksalad') ? '뱅크샐러드 투자현황 + 직접 기록' : '직접 기록 · 평가금액은 가끔 업데이트해 주세요'}
            action={
              <Button size="sm" variant="primary" onClick={() => setHolding({ asset_class: '해외주식' })}>
                <Plus /> 추가
              </Button>
            }
          />
          <CardBody className="px-0 pb-1">
            {empty && <p className="px-5 pb-4 text-sm text-subtle">아직 없어요</p>}
            <ul className="divide-y">
              {data.holdings.map((h) => {
                const gain = h.value - h.cost
                return (
                  <li key={h.id} className="flex items-center gap-3 px-5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{h.name}</div>
                      <div className="truncate text-[11px] text-subtle">
                        {h.asset_class}
                        {h.account && ` · ${h.account}`}
                        {h.updated_at && ` · ${fmtDate(h.updated_at)}`}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="num text-sm font-semibold">{won(h.value)}</div>
                      <div className={cn('num text-[11px]', gain > 0 ? 'text-good' : gain < 0 ? 'text-bad' : 'text-subtle')}>
                        {gain >= 0 ? '+' : ''}
                        {wonShort(gain)}
                      </div>
                    </div>
                    <Button size="icon" variant="ghost" className="size-8" onClick={() => setHolding(h)} aria-label="수정">
                      <Pencil />
                    </Button>
                  </li>
                )
              })}
            </ul>
            {data.accounts.items.some((a) => a.amount) && (
              <div className="mx-5 mb-3 mt-2 rounded-lg bg-surface-2/60 px-3 py-2 text-xs text-muted">
                뱅크샐러드 투자 계좌 잔액 ({fmtDate(data.accounts.as_of)}):{' '}
                {data.accounts.items.filter((a) => a.amount).map((a) => `${a.name} ${won(a.amount)}`).join(' · ')}
              </div>
            )}
          </CardBody>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <ContributionsCard data={data} />
      </StaggerItem>

      <StaggerItem>
        <Simulator start={data.totals.value} />
      </StaggerItem>

      <StaggerItem className="split:col-span-2">
        <PolicyCard policy={data.policy} />
      </StaggerItem>

      <StaggerItem className="split:col-span-2">
        <p className="text-xs leading-relaxed text-subtle">
          MoneyLab은 기록하고 계산하는 도구예요. 특정 종목·상품을 추천하거나 투자 조언을 하지 않아요. 목표 비중과 수익률 가정은 모두 직접 정한 값이에요.
        </p>
      </StaggerItem>

      <HoldingDialog holding={holding} classes={data.asset_classes} onClose={() => setHolding(null)} />
      <TargetsDialog open={targets} data={data} onClose={() => setTargets(false)} />
    </Stagger>
  )
}

function Tile({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="min-w-0 rounded-card border bg-surface px-4 py-3.5 shadow-card">
      <div className="text-xs font-medium text-muted">{label}</div>
      <AnimatedNumber value={value} format={won} className={cn('mt-1 block truncate text-lg font-bold xl:text-[22px]', tone === 'good' && 'text-good', tone === 'bad' && 'text-bad')} />
      {sub && <div className="mt-0.5 text-xs text-subtle">{sub}</div>}
    </div>
  )
}

function StartGuide({ onAdd, onTargets }: { onAdd: () => void; onTargets: () => void }) {
  const steps = [
    { icon: BookOpenCheck, title: '나의 투자 원칙 적기', body: '왜, 얼마나 오래, 얼마까지 떨어져도 버틸지. 아래 노트에 적어 두면 흔들릴 때 다시 볼 수 있어요.' },
    { icon: Target, title: '목표 비중 정하기', body: '공부한 내용을 바탕으로 자산군별 비중을 정해 두면, 지금 얼마나 벗어났는지 보여드려요.', action: onTargets, cta: '목표 비중' },
    { icon: TrendingUp, title: '매달 넣을 금액을 예산에', body: "예산 → 항목에서 '투자' 금액을 정하면 이번 달 예산과 자금 계획에 같이 잡혀요." },
    { icon: Plus, title: '보유 자산 기록', body: '증권 계좌를 뱅크샐러드에 연결하면 엑셀로 들어오고, 아니면 직접 적어 두세요.', action: onAdd, cta: '추가' },
  ]
  return (
    <Card>
      <CardHeader title="투자를 시작하기 전에" hint="공부하면서 이 순서로 채워 보세요" />
      <CardBody className="grid grid-cols-1 gap-2.5 fold:grid-cols-2">
        {steps.map((s, i) => (
          <div key={s.title} className="flex gap-3 rounded-xl border bg-surface-2/40 p-3">
            <span className="num grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                <s.icon className="size-4 text-muted" /> {s.title}
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">{s.body}</p>
              {s.action && (
                <Button size="sm" variant="ghost" className="-ml-2 mt-1" onClick={s.action}>
                  {s.cta} →
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardBody>
    </Card>
  )
}

function ContributionsCard({ data }: { data: InvestOverview }) {
  const t = useChartTheme()
  const option = useMemo<EChartsOption>(
    () => ({
      grid: { left: 4, right: 4, top: 10, bottom: 4, containLabel: true },
      tooltip: { ...baseTooltip(t), trigger: 'axis', valueFormatter: (v) => won(Number(v)) },
      xAxis: { type: 'category', data: data.contributions.map((c) => fmtMonth(c.month, true)), ...baseAxis(t), splitLine: { show: false } },
      yAxis: { type: 'value', ...baseAxis(t), axisLabel: { ...baseAxis(t).axisLabel, formatter: (v: number) => wonShort(v) } },
      series: [
        {
          type: 'bar',
          data: data.contributions.map((c) => ({ value: c.amount, itemStyle: { color: c.amount < 0 ? t.bad : '#7048e8', borderRadius: [3, 3, 0, 0] } })),
          barMaxWidth: 14,
        },
      ],
    }),
    [data, t],
  )
  return (
    <Card className="h-full">
      <CardHeader title="월별 투자금" hint="증권 계좌로 옮긴 돈 − 꺼낸 돈 (최근 2년)" />
      <CardBody>
        {data.contributions.every((c) => !c.amount) ? (
          <p className="py-8 text-center text-sm text-subtle">아직 증권 계좌로 옮긴 기록이 없어요</p>
        ) : (
          <EChart option={option} style={{ height: 200 }} />
        )}
      </CardBody>
    </Card>
  )
}

/** Future value of a starting balance plus a monthly contribution, under rates the user picks. */
function project(start: number, monthly: number, years: number, annual: number) {
  const r = annual / 100 / 12
  const out: number[] = []
  let v = start
  for (let m = 1; m <= years * 12; m++) {
    v = v * (1 + r) + monthly
    if (m % 12 === 0) out.push(Math.round(v))
  }
  return out
}

function Simulator({ start }: { start: number }) {
  const { data: lines } = useBudgetLines()
  const planned = lines?.filter((l) => l.kind === 'invest').reduce((s, l) => s + l.monthly_amount, 0) ?? 0
  const [monthly, setMonthly] = useState('')
  const [years, setYears] = useState('10')
  const [rates, setRates] = useState(['0', '3', '6'])
  const t = useChartTheme()

  useEffect(() => {
    if (!monthly && planned) setMonthly(String(planned))
  }, [planned, monthly])

  const m = parseWon(monthly) ?? 0
  const y = Math.min(40, Math.max(1, Number(years) || 1))
  const series = rates.map((r) => ({ rate: Number(r) || 0, values: project(start, m, y, Number(r) || 0) }))
  const principal = start + m * 12 * y
  const colors = ['#868e96', '#2a78d6', '#7048e8']

  const option: EChartsOption = {
    grid: { left: 4, right: 8, top: 26, bottom: 4, containLabel: true },
    legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: t.muted, fontSize: 11 } },
    tooltip: { ...baseTooltip(t), trigger: 'axis', valueFormatter: (v) => won(Number(v)) },
    xAxis: { type: 'category', data: Array.from({ length: y }, (_, i) => `${i + 1}년`), ...baseAxis(t), splitLine: { show: false } },
    yAxis: { type: 'value', ...baseAxis(t), axisLabel: { ...baseAxis(t).axisLabel, formatter: (v: number) => wonShort(v) } },
    series: series.map((s, i) => ({
      name: `연 ${s.rate}%`, type: 'line', data: s.values, smooth: true, showSymbol: false,
      lineStyle: { width: 2, color: colors[i] }, itemStyle: { color: colors[i] },
    })),
  }

  return (
    <Card className="h-full">
      <CardHeader title="적립 시뮬레이터" hint="수익률은 가정일 뿐이에요. 실제 결과는 다를 수 있어요." />
      <CardBody className="space-y-3">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <div>
            <Label htmlFor="sim-m">매달 넣을 돈</Label>
            <Input id="sim-m" value={monthly} onChange={(e) => setMonthly(e.target.value)} inputMode="numeric" placeholder="예: 30만" />
          </div>
          <div>
            <Label htmlFor="sim-y">기간(년)</Label>
            <Input id="sim-y" value={years} onChange={(e) => setYears(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className="w-20" />
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          연 수익률 가정
          {rates.map((r, i) => (
            <Input
              key={i}
              value={r}
              onChange={(e) => setRates((rs) => rs.map((x, j) => (j === i ? e.target.value.replace(/[^\d.-]/g, '') : x)))}
              className="num h-8 w-16 text-center"
              aria-label={`수익률 ${i + 1}`}
            />
          ))}
          %
        </div>
        <EChart option={option} style={{ height: 200 }} />
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          {series.map((s, i) => (
            <div key={i} className="rounded-lg bg-surface-2/60 px-2 py-2">
              <div className="text-muted">연 {s.rate}%</div>
              <div className="num mt-0.5 text-sm font-semibold">{wonShort(s.values[s.values.length - 1] ?? principal)}</div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-subtle">넣은 원금 합계 {won(principal)} (지금 평가금액 {wonShort(start)} 포함) · 세금·수수료·물가는 빼고 계산했어요.</p>
      </CardBody>
    </Card>
  )
}

const POLICY_FIELDS: { key: keyof InvestPolicy; label: string; placeholder: string }[] = [
  { key: 'goal', label: '왜 투자하나요?', placeholder: '예: 10년 뒤 목돈, 노후 준비, 물가보다 조금 더' },
  { key: 'horizon', label: '얼마나 오래 둘 건가요?', placeholder: '예: 최소 5년은 꺼내지 않을 돈만' },
  { key: 'risk', label: '얼마까지 떨어져도 버틸 수 있나요?', placeholder: '예: 평가금액이 30% 줄어도 팔지 않기' },
  { key: 'rules', label: '나만의 규칙', placeholder: '예: 매달 같은 날 자동 매수, 1년에 한 번 비중 맞추기, 뉴스 보고 사지 않기' },
  { key: 'notes', label: '공부 메모', placeholder: '읽은 책, 용어, 궁금한 점…' },
]

function PolicyCard({ policy }: { policy: InvestPolicy }) {
  const save = useSavePolicy()
  const [draft, setDraft] = useState<InvestPolicy>(policy)
  useEffect(() => setDraft(policy), [policy])
  const dirty = POLICY_FIELDS.some((f) => (draft[f.key] ?? '') !== (policy[f.key] ?? ''))
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-1.5 text-text">
            <BookOpenCheck className="size-4 text-accent" /> 나의 투자 원칙 노트
          </span>
        }
        hint={policy.updated_at ? `마지막 수정 ${policy.updated_at.replace('T', ' ')}` : '시장이 흔들릴 때 다시 읽을 수 있게 미리 적어 두세요'}
        action={
          dirty ? (
            <Button size="sm" variant="primary" disabled={save.isPending} onClick={() => save.mutate(draft)}>
              {save.isPending && <Loader2 className="animate-spin" />}저장
            </Button>
          ) : undefined
        }
      />
      <CardBody className="grid grid-cols-1 gap-3 split:grid-cols-2">
        {POLICY_FIELDS.map((f) => (
          <div key={f.key} className={f.key === 'notes' || f.key === 'rules' ? 'split:col-span-1' : ''}>
            <Label htmlFor={`pol-${f.key}`}>{f.label}</Label>
            <Textarea id={`pol-${f.key}`} rows={f.key === 'notes' ? 4 : 2} value={draft[f.key] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} placeholder={f.placeholder} />
          </div>
        ))}
      </CardBody>
    </Card>
  )
}

function HoldingDialog({ holding, classes, onClose }: { holding: Partial<Holding> | null; classes: string[]; onClose: () => void }) {
  return (
    <Dialog open={!!holding} onClose={onClose} title={holding?.id ? '보유 자산 수정' : '보유 자산 추가'} description="평가금액은 증권 앱에서 보고 가끔 업데이트하면 돼요">
      {holding && <HoldingBody key={holding.id ?? 'new'} holding={holding} classes={classes} onDone={onClose} />}
    </Dialog>
  )
}

function HoldingBody({ holding, classes, onDone }: { holding: Partial<Holding>; classes: string[]; onDone: () => void }) {
  const save = useSaveHolding()
  const del = useDeleteHolding()
  const [name, setName] = useState(holding.name ?? '')
  const [account, setAccount] = useState(holding.account ?? '')
  const [cls, setCls] = useState(holding.asset_class ?? '기타')
  const [cost, setCost] = useState(holding.cost ? String(holding.cost) : '')
  const [value, setValue] = useState(holding.value ? String(holding.value) : '')
  const [note, setNote] = useState(holding.note ?? '')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const c = parseWon(cost) ?? 0
    save.mutate(
      { id: holding.id, name: name.trim(), account, asset_class: cls, cost: c, value: parseWon(value) ?? c, ticker: null, quantity: null, note: note || null },
      { onSuccess: onDone },
    )
  }
  return (
    <form onSubmit={submit} className="space-y-4 px-5 py-4">
      <div>
        <Label htmlFor="h-name">이름</Label>
        <Input id="h-name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="예: 미국 지수 ETF, CMA" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="h-cls">자산군</Label>
          <Select id="h-cls" value={cls} onChange={(e) => setCls(e.target.value)}>
            {classes.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="h-acc">계좌 (선택)</Label>
          <Input id="h-acc" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="예: ISA, 연금저축" />
        </div>
        <div>
          <Label htmlFor="h-cost">투자 원금</Label>
          <Input id="h-cost" value={cost} onChange={(e) => setCost(e.target.value)} inputMode="numeric" required />
        </div>
        <div>
          <Label htmlFor="h-val">지금 평가금액</Label>
          <Input id="h-val" value={value} onChange={(e) => setValue(e.target.value)} inputMode="numeric" placeholder="비우면 원금과 같게" />
        </div>
      </div>
      <div>
        <Label htmlFor="h-note">메모</Label>
        <Input id="h-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {save.error && <p className="text-sm text-bad">{save.error.message}</p>}
      <div className="flex items-center justify-between">
        {holding.id ? (
          <Button type="button" variant="ghost" onClick={() => confirm('삭제할까요?') && del.mutate(holding.id!, { onSuccess: onDone })}>
            <Trash2 /> 삭제
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            취소
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim() || save.isPending}>
            저장
          </Button>
        </div>
      </div>
    </form>
  )
}

function TargetsDialog({ open, data, onClose }: { open: boolean; data: InvestOverview; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="목표 비중" description="공부해서 정한 자산군별 비중을 적어 주세요. 합계 100%">
      {open && <TargetsBody data={data} onDone={onClose} />}
    </Dialog>
  )
}

function TargetsBody({ data, onDone }: { data: InvestOverview; onDone: () => void }) {
  const save = useSaveTargets()
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(data.asset_classes.map((c) => [c, data.targets[c] ? String(data.targets[c]) : ''])),
  )
  const sum = Object.values(vals).reduce((s, v) => s + (Number(v) || 0), 0)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate(Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, Number(v) || 0])), { onSuccess: onDone })
      }}
      className="space-y-3 px-5 py-4"
    >
      {data.asset_classes.map((c) => (
        <div key={c} className="flex items-center gap-3">
          <span className="w-20 text-sm">{c}</span>
          <Input value={vals[c]} onChange={(e) => setVals((v) => ({ ...v, [c]: e.target.value.replace(/[^\d.]/g, '') }))} inputMode="decimal" className="num h-9 w-20 text-right" />
          <span className="text-sm text-muted">%</span>
          <GrowBar value={(Number(vals[c]) || 0) / 100} className="h-1.5 flex-1" />
        </div>
      ))}
      <div className={cn('text-right text-sm font-semibold', Math.abs(sum - 100) < 0.01 ? 'text-good' : sum > 100 ? 'text-bad' : 'text-muted')}>합계 {sum}%</div>
      {save.error && <p className="text-sm text-bad">{save.error.message}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          취소
        </Button>
        <Button type="submit" variant="primary" disabled={sum > 100 || save.isPending}>
          저장
        </Button>
      </div>
    </form>
  )
}

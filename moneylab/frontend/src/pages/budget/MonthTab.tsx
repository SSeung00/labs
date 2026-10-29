import { Link } from 'react-router'
import { CheckCircle2, CircleDashed, PiggyBank, TrendingUp } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { AnimatedNumber, GrowBar, Stagger, StaggerItem } from '@/components/ui/motion'
import { CategoryDot } from '@/components/money/bits'
import type { MonthBudget, MonthLine } from '@/api/plan'
import { fmtMonth, monthRange, won, wonShort } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Gauge } from './Gauge'

function status(actual: number, planned: number, pace: number) {
  if (!planned) return actual > 0 ? 'over' : 'ok'
  const r = actual / planned
  if (r > 1) return 'over'
  if (pace > 0 && r > pace + 0.12) return 'warn'
  return 'ok'
}

const STATUS = {
  ok: { label: '여유', cls: 'bg-good/15 text-good' },
  warn: { label: '빠름', cls: 'bg-warn/15 text-warn' },
  over: { label: '초과', cls: 'bg-bad/15 text-bad' },
} as const

export function MonthTab({ data }: { data: MonthBudget }) {
  const spend = data.lines.filter((l) => l.kind === 'spend')
  const funds = data.lines.filter((l) => l.kind === 'fund')
  const transfers = data.lines.filter((l) => l.kind === 'save' || l.kind === 'invest')
  const limit = spend.reduce((s, l) => s + l.planned, 0)
  const used = spend.reduce((s, l) => s + l.actual, 0)
  const left = limit - used
  const range = monthRange(data.month)
  const unbudgetedTotal = data.unbudgeted.reduce((s, u) => s + u.amount, 0)

  return (
    <Stagger className="grid grid-cols-1 gap-4 split:grid-cols-2">
      <StaggerItem className="split:col-span-2">
        <Card className="overflow-hidden">
          <div className="grid grid-cols-1 items-center gap-4 p-5 split:grid-cols-[auto_1fr]">
            <div className="relative mx-auto w-[220px]">
              <Gauge used={limit ? used / limit : 0} pace={data.pace} over={left < 0} />
              <div className="absolute inset-x-0 bottom-1 text-center">
                <div className="text-xs text-muted">{left >= 0 ? '이번 달 남은 생활 예산' : '한도를 넘었어요'}</div>
                <AnimatedNumber value={Math.abs(left)} format={won} className={cn('text-2xl font-bold tracking-tight', left < 0 && 'text-bad')} />
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
              <Big label="쓴 돈 / 한도" value={`${wonShort(used)} / ${wonShort(limit)}`} />
              <Big
                label={data.pace > 0 && data.pace < 1 ? `오늘까지 예상 (${Math.round(data.pace * 100)}%)` : '월 진행'}
                value={data.pace > 0 && data.pace < 1 ? wonShort(limit * data.pace) : data.pace >= 1 ? '마감' : '시작 전'}
              />
              <Big label="수입 (계획 대비)" value={`${wonShort(data.income.actual)} / ${wonShort(data.income.planned)}`} />
              <Big
                label="예산 밖 지출"
                value={unbudgetedTotal ? wonShort(unbudgetedTotal) : '없음'}
                tone={unbudgetedTotal ? 'warn' : undefined}
              />
            </dl>
          </div>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <Card className="h-full">
          <CardHeader title="지출 한도" hint="막대의 세로선은 오늘까지 써도 괜찮은 만큼이에요" />
          <CardBody className="space-y-4">
            {spend.length === 0 && <p className="text-sm text-subtle">지출 한도 항목이 없어요</p>}
            {spend.map((l) => (
              <LimitRow key={l.id} line={l} pace={data.pace} range={range} />
            ))}
          </CardBody>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <Card className="h-full">
          <CardHeader title="적립 봉투" hint="매달 조금씩 쌓아 두고 큰 지출 때 꺼내 쓰는 돈" />
          <CardBody className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 split:grid-cols-1 lg:grid-cols-2">
            {funds.length === 0 && <p className="text-sm text-subtle">봉투가 없어요</p>}
            {funds.map((l) => (
              <div key={l.id} className="lift rounded-xl border bg-surface-2/40 p-3">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
                  <CategoryDot color={l.color ?? undefined} /> {l.name}
                </div>
                <AnimatedNumber value={l.balance ?? 0} format={won} className={cn('mt-1 block text-lg font-bold', (l.balance ?? 0) < 0 && 'text-bad')} />
                <div className="mt-0.5 flex justify-between text-[11px] text-subtle">
                  <span>매달 +{wonShort(l.planned)}</span>
                  {l.actual > 0 && <span className="text-text">이번 달 −{wonShort(l.actual)}</span>}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </StaggerItem>

      {transfers.length > 0 && (
        <StaggerItem>
          <Card className="h-full">
            <CardHeader title="저축 · 투자" />
            <CardBody className="space-y-3">
              {transfers.map((l) => {
                const met = l.planned > 0 && l.actual >= l.planned
                const Icon = l.kind === 'invest' ? TrendingUp : PiggyBank
                return (
                  <div key={l.id} className="flex items-center gap-3">
                    <Icon className="size-4 shrink-0 text-muted" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{l.name}</div>
                      <GrowBar value={l.planned ? l.actual / l.planned : 0} color={l.color ?? undefined} className="mt-1.5 h-1.5" />
                    </div>
                    <div className="text-right">
                      <div className="num text-sm font-semibold">{won(l.actual)}</div>
                      <div className="num text-[11px] text-subtle">/ {won(l.planned)}</div>
                    </div>
                    {met ? <CheckCircle2 className="size-5 text-good" /> : <CircleDashed className="size-5 text-subtle" />}
                  </div>
                )
              })}
            </CardBody>
          </Card>
        </StaggerItem>
      )}

      {data.unbudgeted.length > 0 && (
        <StaggerItem>
          <Card className="h-full">
            <CardHeader title="예산 밖 지출" hint="어느 항목에도 속하지 않은 카테고리예요. '항목' 탭에서 넣을 수 있어요." />
            <CardBody className="space-y-1.5">
              {data.unbudgeted.map((u) => (
                <Link
                  key={u.category}
                  to={`/transactions?category=${encodeURIComponent(u.category)}&start=${range.start}&end=${range.end}`}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2"
                >
                  <CategoryDot color={u.color} />
                  <span className="flex-1">{u.category}</span>
                  <span className="num">{won(u.amount)}</span>
                </Link>
              ))}
            </CardBody>
          </Card>
        </StaggerItem>
      )}
      <p className="text-xs text-subtle split:col-span-2">{fmtMonth(data.month)} 기준 · 여행 기간의 지출은 여행 봉투에서 나간 걸로 쳐요.</p>
    </Stagger>
  )
}

function Big({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="rounded-xl bg-surface-2/60 px-3 py-2.5">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className={cn('num mt-0.5 text-base font-semibold', tone === 'warn' && 'text-warn')}>{value}</dd>
    </div>
  )
}

function LimitRow({ line, pace, range }: { line: MonthLine; pace: number; range: { start: string; end: string } }) {
  const st = status(line.actual, line.planned, pace)
  const cats = line.categories.map(String)
  const link = cats.length === 1 ? `/transactions?category=${encodeURIComponent(cats[0])}&start=${range.start}&end=${range.end}` : `/transactions?start=${range.start}&end=${range.end}`
  return (
    <Link to={link} className="block rounded-lg transition-colors">
      <div className="flex items-center gap-2">
        <CategoryDot color={line.color ?? undefined} className="size-2.5" />
        <span className="flex-1 text-sm font-semibold">{line.name}</span>
        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS[st].cls)}>{STATUS[st].label}</span>
      </div>
      <GrowBar value={line.planned ? line.actual / line.planned : 0} color={st === 'over' ? 'var(--bad)' : (line.color ?? undefined)} marker={pace} className="mt-2 h-2.5" />
      <div className="mt-1 flex justify-between text-xs">
        <span className="num text-muted">{won(line.actual)} 씀</span>
        <span className="num text-subtle">
          {line.planned - line.actual >= 0 ? `${won(line.planned - line.actual)} 남음` : `${won(line.actual - line.planned)} 초과`} · 한도 {wonShort(line.planned)}
        </span>
      </div>
    </Link>
  )
}

import { useState } from 'react'
import { motion } from 'framer-motion'
import { EyeOff, Repeat } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { AnimatedNumber, Stagger, StaggerItem } from '@/components/ui/motion'
import { CategoryDot, useCategoryMap } from '@/components/money/bits'
import { type RecurringData, useIgnoreRecurring, useRecurring } from '@/api/tools'
import { fmtDate, todayIso, won } from '@/lib/format'
import { cn } from '@/lib/utils'

const CADENCE = { weekly: '매주', monthly: '매달', yearly: '매년' } as const
const WEEK = ['일', '월', '화', '수', '목', '금', '토']

export function RecurringTab() {
  const [showHidden, setShowHidden] = useState(false)
  const { data } = useRecurring(showHidden)
  const ignore = useIgnoreRecurring()
  const cats = useCategoryMap()

  if (!data) return <div className="shimmer h-96 rounded-card" />
  if (!data.items.length && !showHidden) {
    return (
      <Card>
        <EmptyState icon={Repeat} title="정기결제를 찾지 못했어요">
          같은 곳에 비슷한 금액을 매주·매달·매년 세 번 이상 내면 여기에 모여요.
        </EmptyState>
      </Card>
    )
  }
  const active = data.items.filter((i) => i.active && !i.ignored)
  const stopped = data.items.filter((i) => !i.active && !i.ignored)
  const hidden = data.items.filter((i) => i.ignored)

  return (
    <Stagger className="grid grid-cols-1 gap-4 split:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <StaggerItem className="grid grid-cols-2 gap-3 split:col-span-2">
        <div className="rounded-card border bg-surface px-4 py-3.5 shadow-card">
          <div className="text-xs font-medium text-muted">한 달에 나가는 정기결제</div>
          <AnimatedNumber value={data.monthly_total} format={won} className="mt-1 block text-xl font-bold" />
          <div className="text-xs text-subtle">{active.length}건 · 연간·주간 결제는 월로 환산</div>
        </div>
        <div className="rounded-card border bg-surface px-4 py-3.5 shadow-card">
          <div className="text-xs font-medium text-muted">1년이면</div>
          <AnimatedNumber value={data.yearly_total} format={won} className="mt-1 block text-xl font-bold" />
          <div className="text-xs text-subtle">안 쓰는 구독이 있는지 한 번씩 보세요</div>
        </div>
      </StaggerItem>

      <StaggerItem>
        <Card className="h-full">
          <CardHeader title="정기결제 목록" hint="정기결제가 아니면 숨기기를 누르세요" />
          <CardBody className="px-0 pb-1">
            <ul className="divide-y">
              {[...active, ...stopped, ...hidden].map((i) => (
                <li key={i.key} className={cn('flex items-center gap-3 px-5 py-2.5', (!i.active || i.ignored) && 'opacity-55')}>
                  <CategoryDot color={cats.get(i.category)?.color} className="size-2.5" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{i.merchant}</div>
                    <div className="text-[11px] text-subtle">
                      {CADENCE[i.cadence]}
                      {i.day_of_month ? ` ${i.day_of_month}일 무렵` : ''} · {i.count}회 · {i.active ? `다음 ${fmtDate(i.next_date)}` : `마지막 ${fmtDate(i.last_date)} (멈춤?)`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="num text-sm font-semibold">{won(i.amount)}</div>
                    {i.cadence !== 'monthly' && <div className="num text-[11px] text-subtle">월 {won(i.monthly_cost)}</div>}
                  </div>
                  <Button size="icon" variant="ghost" className="size-8" title={i.ignored ? '다시 보이기' : '정기결제 아님 (숨기기)'} onClick={() => ignore.mutate({ key: i.key, ignored: !i.ignored })}>
                    <EyeOff className={cn(i.ignored && 'text-accent')} />
                  </Button>
                </li>
              ))}
            </ul>
            <button onClick={() => setShowHidden((v) => !v)} className="px-5 py-2 text-xs text-muted hover:text-text">
              {showHidden ? '숨긴 것 감추기' : '숨긴 것도 보기'}
            </button>
          </CardBody>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <Card className="h-full">
          <CardHeader title="다가오는 결제" hint="앞으로 45일, 지난 패턴으로 예상한 날짜예요" />
          <CardBody>
            <Calendar data={data} />
          </CardBody>
        </Card>
      </StaggerItem>
    </Stagger>
  )
}

function Calendar({ data }: { data: RecurringData }) {
  const today = todayIso()
  const start = new Date(today + 'T00:00:00')
  start.setDate(start.getDate() - start.getDay()) // back to Sunday
  const days = Array.from({ length: 49 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const byDay = data.upcoming.reduce<Record<string, typeof data.upcoming>>((acc, u) => {
    ;(acc[u.date] ??= []).push(u)
    return acc
  }, {})
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-subtle">
        {WEEK.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {days.map((d, i) => {
          const items = byDay[d] ?? []
          const total = items.reduce((s, u) => s + u.amount, 0)
          return (
            <motion.div
              key={d}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.006 }}
              title={items.map((u) => `${u.merchant} ${won(u.amount)}`).join('\n')}
              className={cn(
                'flex aspect-square flex-col items-center justify-center rounded-lg text-[11px]',
                d < today ? 'text-subtle/50' : 'bg-surface-2/50',
                d === today && 'ring-2 ring-accent',
                items.length > 0 && 'bg-accent-soft font-semibold text-text',
              )}
            >
              <span>{Number(d.slice(8))}</span>
              {items.length > 0 && <span className="num text-[9px] text-accent">{total >= 10000 ? `${Math.round(total / 1000)}k` : total.toLocaleString()}</span>}
            </motion.div>
          )
        })}
      </div>
      <ul className="mt-3 space-y-1 text-xs">
        {data.upcoming.slice(0, 8).map((u, i) => (
          <li key={i} className="flex justify-between gap-2">
            <span className="truncate text-muted">
              {fmtDate(u.date).slice(5)} {u.merchant}
            </span>
            <span className="num shrink-0">{won(u.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

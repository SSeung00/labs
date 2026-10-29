import { useSearchParams } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/controls'
import { useMonthBudget } from '@/api/plan'
import { addMonths, fmtMonth, thisMonth } from '@/lib/format'
import { CardsTab } from './CardsTab'
import { DraftCard } from './DraftCard'
import { LinesTab } from './LinesTab'
import { MonthTab } from './MonthTab'
import { PlanTab } from './PlanTab'
import { RecurringTab } from './RecurringTab'

type Tab = 'month' | 'plan' | 'recurring' | 'cards' | 'lines'

const TABS: { value: Tab; label: string }[] = [
  { value: 'month', label: '이번 달' },
  { value: 'plan', label: '자금 계획' },
  { value: 'recurring', label: '정기결제' },
  { value: 'cards', label: '카드' },
  { value: 'lines', label: '항목' },
]

export function BudgetPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'month'
  const month = params.get('month') ?? thisMonth()
  const { data, isPending } = useMonthBudget(month)

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) next.delete(k)
      else next.set(k, v)
    }
    setParams(next, { replace: true })
  }

  const configured = data?.configured
  return (
    <>
      <PageHeader
        title="예산"
        subtitle="매달 쓸 돈, 모아 둘 돈, 앞으로 1년의 자금 흐름"
        actions={
          tab === 'month' && configured ? (
            <div className="flex items-center gap-1 rounded-lg border bg-surface p-0.5">
              <Button size="icon" variant="ghost" className="size-8" aria-label="이전 달" onClick={() => set({ month: addMonths(month, -1) })}>
                <ChevronLeft />
              </Button>
              <button className="num min-w-[92px] text-center text-sm font-semibold" onClick={() => set({ month: null })}>
                {fmtMonth(month)}
              </button>
              <Button size="icon" variant="ghost" className="size-8" aria-label="다음 달" onClick={() => set({ month: addMonths(month, 1) })}>
                <ChevronRight />
              </Button>
            </div>
          ) : undefined
        }
      />

      {!isPending && !configured ? (
        <DraftCard />
      ) : (
        <>
          <Segmented value={tab} onChange={(v) => set({ tab: v === 'month' ? null : v })} options={TABS} className="mb-4" />
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              {tab === 'month' && (data ? <MonthTab data={data} /> : <div className="shimmer h-96 rounded-card" />)}
              {tab === 'plan' && <PlanTab />}
              {tab === 'recurring' && <RecurringTab />}
              {tab === 'cards' && <CardsTab />}
              {tab === 'lines' && <LinesTab />}
            </motion.div>
          </AnimatePresence>
        </>
      )}
    </>
  )
}

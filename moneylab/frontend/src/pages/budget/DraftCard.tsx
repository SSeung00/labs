import { useEffect, useState } from 'react'
import { Loader2, Sparkles, WalletCards } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { CategoryDot } from '@/components/money/bits'
import { type DraftLine, LINE_KIND_LABEL, useApplyDraft, useDraft } from '@/api/plan'
import { parseWon, won } from '@/lib/format'
import { cn } from '@/lib/utils'

/** First run (or "다시 만들기"): a plan drafted from the last 6–12 months, editable before saving. */
export function DraftCard({ onDone, replacing }: { onDone?: () => void; replacing?: boolean }) {
  const { data, isPending } = useDraft(true)
  const apply = useApplyDraft()
  const [income, setIncome] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])

  useEffect(() => {
    if (!data) return
    setIncome(String(data.income))
    setLines(data.lines)
  }, [data])

  const incomeN = parseWon(income) ?? 0
  const out = lines.reduce((s, l) => s + l.monthly_amount, 0)
  const surplus = incomeN - out

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-1.5 text-text">
            <Sparkles className="size-4 text-accent" /> 지난 기록으로 만든 예산 초안
          </span>
        }
        hint="금액을 고친 뒤 저장하세요. 저장 후에도 언제든 '항목' 탭에서 바꿀 수 있어요."
      />
      <CardBody>
        {isPending ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="shimmer h-12 rounded-lg" />
            ))}
          </div>
        ) : (
          <Stagger className="space-y-2">
            <StaggerItem className="flex items-center gap-3 rounded-xl border bg-surface-2/50 px-3 py-2.5">
              <WalletCards className="size-4 text-good" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">월 수입 (계획)</div>
                <div className="text-[11px] text-subtle">{data?.income_basis}</div>
              </div>
              <Input value={income} onChange={(e) => setIncome(e.target.value)} inputMode="numeric" className="num h-9 w-32 text-right" />
            </StaggerItem>
            {lines.map((l, i) => (
              <StaggerItem key={l.name} className="flex items-center gap-3 rounded-xl border px-3 py-2.5">
                <CategoryDot color={l.color} className="size-2.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-sm font-semibold">
                    {l.name}
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">{LINE_KIND_LABEL[l.kind]}</span>
                  </div>
                  <div className="truncate text-[11px] text-subtle">{l.basis}</div>
                </div>
                <Input
                  value={String(l.monthly_amount)}
                  onChange={(e) => {
                    const v = parseWon(e.target.value) ?? 0
                    setLines((ls) => ls.map((x, j) => (j === i ? { ...x, monthly_amount: v } : x)))
                  }}
                  inputMode="numeric"
                  className="num h-9 w-32 text-right"
                />
              </StaggerItem>
            ))}
          </Stagger>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-2 px-4 py-3 text-sm">
          <span>
            수입 {won(incomeN)} − 계획 {won(out)} ={' '}
            <b className={cn('num', surplus < 0 ? 'text-bad' : 'text-good')}>{won(surplus)}</b>
            <span className="ml-1 text-xs text-muted">{surplus < 0 ? '(모자라요: 한도를 줄이거나 수입을 확인하세요)' : '(남는 돈)'}</span>
          </span>
          <div className="flex gap-2">
            {onDone && (
              <Button variant="ghost" onClick={onDone}>
                취소
              </Button>
            )}
            <Button
              variant="primary"
              disabled={!data || apply.isPending}
              onClick={() => {
                if (replacing && !confirm('지금 예산 항목을 이 초안으로 바꿀까요?')) return
                apply.mutate({ income: incomeN, lines }, { onSuccess: onDone })
              }}
            >
              {apply.isPending && <Loader2 className="animate-spin" />}이 예산으로 시작
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}

import { Link } from 'react-router'
import { format, parseISO } from 'date-fns'
import { Check, ChevronRight, ClipboardCheck, Loader2, Target } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ChangeList } from '@/components/race/ChangeList'
import { useApplyPlanCheck, useDismissPlanCheck, usePlanCheck, type PlanCheck } from '@/api/planner'
import { fmtDuration } from '@/lib/format'
import { cn } from '@/lib/utils'

const pct = (c: number) => (c < 0.01 ? '1% 미만' : c > 0.99 ? '99% 이상' : `${Math.round(c * 100)}%`)

function GoalLine({ g }: { g: NonNullable<PlanCheck['goal']> }) {
  if (!g.predicted_s) return null
  const trend = g.chance != null && g.chance_prev != null ? g.chance - g.chance_prev : null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-surface-2/60 px-3.5 py-2.5 text-sm">
      <Target className="size-4 shrink-0 text-accent" />
      <span>
        {g.name} · 지금처럼 하면 <b className="num">{fmtDuration(g.predicted_s)}</b>
        {g.predicted_prev_s && g.predicted_prev_s !== g.predicted_s && (
          <span className={cn('num text-xs font-semibold', g.predicted_s < g.predicted_prev_s ? 'text-good' : 'text-warn')}>
            {' '}
            ({g.predicted_s < g.predicted_prev_s ? '−' : '+'}
            {fmtDuration(Math.abs(g.predicted_s - g.predicted_prev_s))} / 1주)
          </span>
        )}
      </span>
      {g.target_s && g.chance != null && (
        <span className="text-xs text-muted">
          목표 {fmtDuration(g.target_s)} 달성 가능성 <b className="num text-text">{pct(g.chance)}</b>
          {trend != null && Math.abs(trend) >= 0.01 && (
            <span className={cn('num', trend > 0 ? 'text-good' : 'text-warn')}> ({trend > 0 ? '+' : ''}{Math.round(trend * 100)}%p)</span>
          )}
        </span>
      )}
    </div>
  )
}

/** The weekly look-back with a proposal for the coming week (preview → apply, or keep as planned). */
export function WeekCheckCard({ className }: { className?: string }) {
  const { data } = usePlanCheck()
  const apply = useApplyPlanCheck()
  const dismiss = useDismissPlanCheck()
  if (!data || data.status === 'dismissed') return null
  const week = format(parseISO(data.week_start), 'M월 d일')
  const pending = data.changes.length > 0 && data.status !== 'applied'

  return (
    <Card className={className}>
      <CardHeader
        title={`주간 점검 · ${week} 주`}
        hint="지난 2주 기록·피로·체력 변화로 다음 주를 다시 봤어요"
        action={<ClipboardCheck className="size-4 text-subtle" />}
      />
      <CardBody className="space-y-3">
        <ul className="space-y-1 text-sm text-muted">
          {data.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
        {data.goal && <GoalLine g={data.goal} />}
        {data.status === 'applied' ? (
          <p className="flex items-center gap-1.5 text-sm text-good">
            <Check className="size-4" /> 이번 조정안을 적용했어요.
          </p>
        ) : pending ? (
          <>
            <ChangeList changes={data.changes} />
            {(apply.error ?? dismiss.error) && <p className="text-xs text-bad">{(apply.error ?? dismiss.error)!.message}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" size="sm" disabled={dismiss.isPending} onClick={() => dismiss.mutate()}>
                계획대로 둘게요
              </Button>
              <Button variant="primary" size="sm" disabled={apply.isPending} onClick={() => apply.mutate()}>
                {apply.isPending ? <Loader2 className="animate-spin" /> : <Check />} {data.changes.length}개 조정 적용
              </Button>
            </div>
          </>
        ) : null}
      </CardBody>
    </Card>
  )
}

/** Home-screen nudge while a weekly proposal is waiting. */
export function WeekCheckBanner({ className }: { className?: string }) {
  const { data } = usePlanCheck()
  if (!data || data.status || !data.changes.length) return null
  return (
    <Link to="/plan" className={cn('flex items-center gap-2 rounded-xl border border-accent/40 bg-accent-soft/50 px-4 py-2.5 text-sm hover:bg-accent-soft', className)}>
      <ClipboardCheck className="size-4 shrink-0 text-accent" />
      <span className="min-w-0 flex-1">다음 주 조정안이 준비됐어요 ({data.changes.length}개)</span>
      <ChevronRight className="size-4 text-muted" />
    </Link>
  )
}

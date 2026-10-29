import { useState } from 'react'
import { Link } from 'react-router'
import { CalendarDays, GraduationCap, Plane, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Progress } from '@/components/ui/controls'
import { useTransactions, useTrips } from '@/api/money'
import { fmtDate, won, wonShort } from '@/lib/format'
import { cn } from '@/lib/utils'
import { TripForm } from './TripForm'

export function TripsPage() {
  const { data: trips } = useTrips()
  const [adding, setAdding] = useState(false)
  // Travel-category spending not yet attached to any trip: a hint that a trip is missing.
  const { data: loose } = useTransactions({ category: '항공,숙소', trip_id: 0, kind: 'expense', limit: 1 })

  return (
    <>
      <PageHeader
        title="여행·행사"
        subtitle="여행 한 번에 얼마 썼는지, 학회·단체 행사에서 내 몫은 얼마였는지"
        actions={
          <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
            <Plus /> 추가
          </Button>
        }
      />

      {loose && loose.total > 0 && (
        <Link
          to={`/transactions?category=${encodeURIComponent('항공,숙소')}&all=1`}
          className="mb-4 flex items-center gap-3 rounded-card border bg-surface px-4 py-3 text-sm text-muted shadow-card hover:border-border-strong"
        >
          <Plane className="size-4 shrink-0 text-accent" />
          <span>
            항공·숙소 결제 중 어떤 여행에도 안 묶인 결제가 <b className="num text-text">{loose.total}건</b> (
            <span className="num">{won(loose.spending)}</span>) 있어요. 여행을 추가하면 기간에 맞춰 자동으로 묶여요.
          </span>
        </Link>
      )}

      {trips && trips.length === 0 ? (
        <Card>
          <EmptyState
            icon={Plane}
            title="첫 여행을 추가해 보세요"
            action={
              <Button variant="primary" onClick={() => setAdding(true)}>
                <Plus /> 여행 추가
              </Button>
            }
          >
            이름과 기간만 넣으면 그 기간의 지출과 출발 전 항공·숙소 결제를 모아서 보여드려요.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(trips ?? []).map((t) => {
            const upcoming = t.start_date > new Date().toISOString().slice(0, 10)
            const ratio = t.budget ? t.spent / t.budget : null
            return (
              <Link key={t.id} to={`/trips/${t.id}`}>
                <Card className="lift h-full">
                  <CardBody className="pt-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-base font-semibold">{t.name}</div>
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-subtle">
                          <CalendarDays className="size-3.5" />
                          {fmtDate(t.start_date)} ~ {fmtDate(t.end_date)} · {t.days}일
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        {t.kind === 'event' && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-muted">
                            <GraduationCap className="size-3" /> 학회·행사
                          </span>
                        )}
                        {upcoming && <span className="rounded-md bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">예정</span>}
                      </div>
                    </div>
                    <div className="num mt-3 text-2xl font-bold tracking-tight">{won(t.spent)}</div>
                    <div className="mt-0.5 text-xs text-subtle">
                      {t.kind === 'event' ? '내 지출' : `${t.count}건 · 하루 ${wonShort(t.per_day)}`}
                      {t.budget ? ` · 예산 ${wonShort(t.budget)}` : ''}
                    </div>
                    {t.claims && (
                      <div className="mt-2 rounded-lg bg-surface-2/70 px-3 py-2 text-xs text-muted">
                        대신 낸 돈 <span className="num text-text">{wonShort(t.claims.paid)}</span> · 돌려받음{' '}
                        <span className="num text-good">{wonShort(t.claims.reimbursed)}</span>
                        {t.claims.open && t.claims.outstanding > 0 && (
                          <>
                            {' '}
                            · 받을 돈 <span className="num font-semibold text-warn">{wonShort(t.claims.outstanding)}</span>
                          </>
                        )}
                      </div>
                    )}
                    {ratio != null && (
                      <Progress value={ratio} className="mt-3" color={ratio > 1 ? 'var(--bad)' : undefined} />
                    )}
                    {ratio != null && (
                      <div className={cn('mt-1 text-right text-[11px]', ratio > 1 ? 'text-bad' : 'text-subtle')}>
                        예산의 {Math.round(ratio * 100)}%
                      </div>
                    )}
                  </CardBody>
                </Card>
              </Link>
            )
          })}
        </div>
      )}

      <TripForm open={adding} onClose={() => setAdding(false)} />
    </>
  )
}

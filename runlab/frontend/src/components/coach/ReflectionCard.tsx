import { Link } from 'react-router'
import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { ArrowRight, CalendarCheck, Flag, Gauge, TrendingUp } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { useReflection, type Reflection } from '@/api/progress'
import { fmtDuration } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useNow } from '@/lib/useNow'

const VERDICT = { on: '목표 범위로 소화했어요', fast: '목표보다 빨랐어요', slow: '목표보다 느렸어요' } as const

function Row({ icon: Icon, children }: { icon: typeof Gauge; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0 text-subtle" />
      <span className="min-w-0">{children}</span>
    </li>
  )
}

function Lines({ r }: { r: Reflection }) {
  const dv = r.vdot_before != null && r.vdot_after != null ? +(r.vdot_after - r.vdot_before).toFixed(1) : null
  const dt = r.race ? r.race.after_s - r.race.before_s : null
  return (
    <ul className="space-y-2">
      {dv != null && (
        <Row icon={TrendingUp}>
          체력(VDOT){' '}
          <b className="num">
            {r.vdot_before?.toFixed(1)} <ArrowRight className="inline size-3" /> {r.vdot_after?.toFixed(1)}
          </b>{' '}
          <span className={cn('num text-xs font-semibold', dv > 0 ? 'text-good' : dv < 0 ? 'text-warn' : 'text-subtle')}>
            {dv > 0 ? `+${dv}` : dv < 0 ? dv : '변화 없음'}
          </span>
          {dv === 0 && <span className="text-xs text-subtle"> · 쉬운 러닝은 체력을 지키는 역할이에요</span>}
        </Row>
      )}
      {r.race && dt != null && (
        <Row icon={Flag}>
          {r.race.name} 예상{' '}
          <b className="num">{fmtDuration(r.race.after_s)}</b>
          {dt !== 0 && <span className={cn('num text-xs font-semibold', dt < 0 ? 'text-good' : 'text-warn')}> ({dt < 0 ? '−' : '+'}{fmtDuration(Math.abs(dt))})</span>}
          {r.race.target_s && (
            <span className="text-xs text-subtle">
              {' '}
              · 목표 {fmtDuration(r.race.target_s)}보다 {r.race.after_s > r.race.target_s ? `${fmtDuration(r.race.after_s - r.race.target_s)} 느려요` : `${fmtDuration(r.race.target_s - r.race.after_s)} 빨라요`}
            </span>
          )}
        </Row>
      )}
      {(r.ctl_delta != null || r.tsb_after != null) && (
        <Row icon={Gauge}>
          부하 {r.load ?? '—'} · 체력 CTL {r.ctl_delta != null && r.ctl_delta >= 0 ? '+' : ''}
          {r.ctl_delta?.toFixed(1)}
          {r.tsb_after != null && <span className="text-xs text-subtle"> · {r.tsb_after < -20 ? `피로가 많이 쌓였어요 (폼 ${r.tsb_after.toFixed(0)})` : r.tsb_after < 0 ? `피로가 조금 쌓였어요 (폼 ${r.tsb_after.toFixed(0)})` : '피로가 풀린 상태예요'}</span>}
        </Row>
      )}
      {(r.workout || r.week) && (
        <Row icon={CalendarCheck}>
          {r.workout && (
            <>
              계획 '{r.workout.title}' {r.workout.verdict ? VERDICT[r.workout.verdict] : '기록과 연결했어요'}
              {r.workout.reps > 0 && <span className="num text-xs text-subtle"> · 반복 {r.workout.reps_on}/{r.workout.reps} 목표 안</span>}
            </>
          )}
          {r.week && (
            <span className="num text-xs text-subtle">
              {r.workout ? ' · ' : ''}이번 주 {r.week.actual_km.toFixed(0)}/{r.week.planned_km.toFixed(0)}km
            </span>
          )}
        </Row>
      )}
    </ul>
  )
}

/**
 * "What this run changed". With `activityId` it explains that run; without, the latest run — and on the
 * home screen it only shows while that run is fresh (≤ 2 days).
 */
export function ReflectionCard({ activityId, className }: { activityId?: number; className?: string }) {
  const now = useNow()
  const { data: r } = useReflection(activityId)
  if (!r) return null
  const age = differenceInCalendarDays(now, parseISO(r.day))
  if (!activityId && age > 2) return null
  return (
    <Card className={className}>
      <CardHeader
        title={activityId ? '이 러닝이 바꾼 것' : '최근 러닝 반영'}
        hint={`${format(parseISO(r.day), 'M월 d일 (EEE)', { locale: ko })} · ${r.km.toFixed(1)}km${r.vdot_sd ? ` · 체력 추정 ±${r.vdot_sd}` : ''}`}
        action={
          !activityId ? (
            <Link to={`/activities/${r.activity_id}`} className="text-xs text-muted hover:text-text">
              기록 보기
            </Link>
          ) : undefined
        }
      />
      <CardBody>
        <Lines r={r} />
      </CardBody>
    </Card>
  )
}

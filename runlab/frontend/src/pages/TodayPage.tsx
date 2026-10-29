import { useMemo, useState } from 'react'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { ko } from 'date-fns/locale'
import { Link } from 'react-router'
import { Link2, Sparkles } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useHealth } from '@/api/client'
import { useActivities, useWeekly, type Activity } from '@/api/activities'
import { ReadinessCard } from '@/components/checkin/ReadinessCard'
import { CoachCard } from '@/components/coach/CoachCard'
import { ReflectionCard } from '@/components/coach/ReflectionCard'
import { Suggestions } from './plan/Suggestions'
import { TodayWorkoutCard } from './plan/TodayWorkoutCard'
import { WeekCheckBanner } from './plan/WeekCheckCard'
import { fmtDuration, fmtHours, fmtKm, fmtPace, sportLabel } from '@/lib/format'
import { cn } from '@/lib/utils'
import { WeeklyVolumeChart } from './activities/WeeklyVolumeChart'

function greeting(hour: number) {
  if (hour < 5) return '늦은 밤이에요'
  if (hour < 11) return '좋은 아침이에요'
  if (hour < 17) return '좋은 오후예요'
  return '좋은 저녁이에요'
}

function WeekRing({ km, target }: { km: number; target: number }) {
  const pct = target > 0 ? Math.min(1, km / target) : 0
  const r = 52
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 128 128" className="size-32 shrink-0" role="img" aria-label={`이번 주 ${km.toFixed(1)}km, 평소 ${target.toFixed(0)}km의 ${Math.round(pct * 100)}%`}>
      <circle cx="64" cy="64" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="10" />
      <circle
        cx="64" cy="64" r={r} fill="none" stroke="var(--accent)" strokeWidth="10" strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 64 64)"
        style={{ transition: 'stroke-dasharray .8s ease' }}
      />
      <text x="64" y="62" textAnchor="middle" className="fill-[var(--text)] text-[22px] font-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {km.toFixed(1)}
      </text>
      <text x="64" y="80" textAnchor="middle" className="fill-[var(--text-subtle)] text-[11px]">
        / {target.toFixed(0)} km
      </text>
    </svg>
  )
}

function RecentRow({ a }: { a: Activity }) {
  return (
    <Link to={`/activities/${a.id}`} className="group flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-surface-2">
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-[11px] font-bold text-accent">
        {format(new Date(a.start_time), 'd')}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium group-hover:text-accent">{a.name || sportLabel(a.sport)}</div>
        <div className="text-[11px] text-subtle">
          {formatDistanceToNowStrict(new Date(a.start_time), { addSuffix: true, locale: ko })} · {sportLabel(a.sport)}
        </div>
      </div>
      <div className="num text-right">
        <div className="text-sm font-semibold">{fmtKm(a.distance_m, 1)} km</div>
        <div className="text-[11px] text-subtle">
          {fmtPace(a.avg_speed_mps)}/km · {fmtDuration(a.moving_time_s ?? a.duration_s)}
        </div>
      </div>
    </Link>
  )
}

export function TodayPage() {
  const [now] = useState(() => new Date())
  const { data: health } = useHealth()
  const { data: weekly } = useWeekly(16)
  const { data: recent } = useActivities({ limit: 120 })
  const hasData = (health?.activities ?? 0) > 0

  const week = useMemo(() => {
    if (!weekly?.length) return null
    const cur = weekly[weekly.length - 1]
    const past = weekly.slice(-9, -1).filter((w) => w.distance_m > 0)
    const target = past.length ? past.reduce((s, w) => s + w.distance_m, 0) / past.length / 1000 : 0
    return { km: cur.distance_m / 1000, count: cur.count, dur: cur.duration_s, target }
  }, [weekly])

  const vo2 = useMemo(() => {
    const pts = (recent?.items ?? []).filter((a) => a.vo2max).map((a) => ({ t: a.start_time, v: a.vo2max as number }))
    if (!pts.length) return null
    const latest = pts[0]
    const ninetyAgo = pts.find((p) => new Date(latest.t).getTime() - new Date(p.t).getTime() > 90 * 864e5)
    return { v: latest.v, delta: ninetyAgo ? latest.v - ninetyAgo.v : null }
  }, [recent])

  const items = recent?.items ?? []

  return (
    <>
      <PageHeader title={greeting(now.getHours())} subtitle={format(now, 'yyyy년 M월 d일 EEEE', { locale: ko })} />

      {!hasData && (
        <Card className="relative mb-6 overflow-hidden">
          <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full opacity-40 blur-3xl" style={{ background: 'radial-gradient(circle, var(--accent), transparent 70%)' }} />
          <div className="relative flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:p-8">
            <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent">
              <Sparkles className="size-6" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold tracking-tight">가민 계정을 연결해 시작하세요</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted">연결하면 모든 러닝 기록과 수면·HRV·안정 심박을 가져와 훈련 부하, 성장 곡선, 기록 예측을 계산합니다.</p>
            </div>
            <Link to="/settings">
              <Button variant="primary">
                <Link2 />
                가민 연결하기
              </Button>
            </Link>
          </div>
        </Card>
      )}

      <Suggestions className="mb-4" />
      <WeekCheckBanner className="mb-4" />
      <ReflectionCard className="mb-4" />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="이번 주" hint="최근 8주 평균 대비" />
          <CardBody>
            {week ? (
              <div className="flex items-center gap-5">
                <WeekRing km={week.km} target={week.target} />
                <div className="space-y-3 text-sm">
                  <div>
                    <div className="text-xs text-subtle">러닝</div>
                    <div className="num font-semibold">{week.count}회</div>
                  </div>
                  <div>
                    <div className="text-xs text-subtle">시간</div>
                    <div className="num font-semibold">{fmtHours(week.dur)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-subtle">VO2max</div>
                    <div className="num flex items-baseline gap-1.5 font-semibold">
                      {vo2?.v ?? '—'}
                      {vo2?.delta != null && vo2.delta !== 0 && (
                        <span className={cn('text-[11px] font-medium', vo2.delta > 0 ? 'text-good' : 'text-warn')}>
                          {vo2.delta > 0 ? '▲' : '▼'} {Math.abs(vo2.delta)} (90일)
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-32 animate-pulse rounded-xl bg-surface-2" />
            )}
          </CardBody>
        </Card>

        <ReadinessCard />

        <TodayWorkoutCard />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="주간 거리" hint="최근 16주" />
          <CardBody>{weekly ? <WeeklyVolumeChart data={weekly} height={240} /> : <div className="h-60 animate-pulse rounded-lg bg-surface-2" />}</CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader
            title="최근 활동"
            action={
              <Link to="/activities" className="text-xs text-muted hover:text-text">
                전체 보기
              </Link>
            }
          />
          <CardBody className="pt-2">
            {items.length ? items.slice(0, 5).map((a) => <RecentRow key={a.id} a={a} />) : <p className="py-6 text-center text-sm text-subtle">활동이 없어요</p>}
          </CardBody>
        </Card>
      </div>
      <div className="mt-4">
        <CoachCard />
      </div>
    </>
  )
}

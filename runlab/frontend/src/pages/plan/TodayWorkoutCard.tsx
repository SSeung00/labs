import { useMemo } from 'react'
import { Link } from 'react-router'
import { addDays, format } from 'date-fns'
import { ArrowRight, BedDouble, CalendarPlus, Check } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useActivePlan } from '@/api/planner'
import { useProgress } from '@/api/progress'
import { KIND, PHASE, estDuration, fmtEst } from './workoutMeta'
import { StepList } from './StepList'
import { useNow } from '@/lib/useNow'

export function TodayWorkoutCard() {
  const now = useNow()
  const { data: plan, isLoading } = useActivePlan()
  const { data: progress } = useProgress()
  const today = format(now, 'yyyy-MM-dd')
  const tomorrow = format(addDays(now, 1), 'yyyy-MM-dd')
  const { w, next } = useMemo(() => {
    const ws = plan?.workouts ?? []
    return { w: ws.find((x) => x.day === today), next: ws.find((x) => x.day > today && x.kind !== 'rest') }
  }, [plan, today])
  const racePace = plan?.plan.params.race_pace_s_per_km

  if (isLoading) return <Card className="h-64 animate-pulse" />

  if (!plan) {
    return (
      <Card className="flex flex-col">
        <CardHeader title="오늘의 훈련" hint="활성 플랜" />
        <CardBody className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="grid size-11 place-items-center rounded-2xl bg-surface-2 text-z2">
            <CalendarPlus className="size-5" />
          </div>
          <p className="mt-3 text-sm font-medium">아직 훈련 계획이 없어요</p>
          <p className="mt-1 text-xs text-subtle">목표 레이스를 정하면 매일 할 훈련을 알려 드려요</p>
          <Link to="/plan" className="mt-4">
            <Button size="sm">
              플랜 만들기 <ArrowRight />
            </Button>
          </Link>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card className="flex flex-col">
      <CardHeader
        title="오늘의 훈련"
        hint={w?.phase ? `${PHASE[w.phase].label} 단계` : plan.plan.name}
        action={<Link to="/plan" className="text-xs text-muted hover:text-text">캘린더</Link>}
      />
      <CardBody className="flex-1">
        {!w || w.kind === 'rest' ? (
          <div className="flex h-full flex-col items-center justify-center py-4 text-center">
            <BedDouble className="size-7 text-subtle" />
            <p className="mt-2 text-sm font-medium">오늘은 휴식일이에요</p>
            {next && (
              <p className="mt-1 text-xs text-subtle">
                다음: {next.day === tomorrow ? '내일' : format(new Date(next.day), 'M/d')} · {next.title}
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <span className="mt-1 h-9 w-1 rounded-full" style={{ background: KIND[w.kind].color }} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold leading-snug">{w.title}</div>
                <div className="num mt-0.5 text-xs text-subtle">
                  {((w.target_distance_m ?? 0) / 1000).toFixed(1)}km · {fmtEst(estDuration(w.structure ?? [], progress?.paces, racePace))}
                </div>
              </div>
              {w.status === 'done' && (
                <span className="inline-flex items-center gap-1 rounded-full bg-good/15 px-2 py-0.5 text-[11px] font-semibold text-good">
                  <Check className="size-3" /> 완료
                </span>
              )}
            </div>
            {(w.structure ?? []).length > 0 && (
              <div className="mt-3 max-h-48 overflow-y-auto">
                <StepList steps={w.structure!} paces={progress?.paces} racePace={racePace} />
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  )
}

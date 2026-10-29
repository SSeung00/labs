import { useState } from 'react'
import { Link } from 'react-router'
import { format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { CalendarCheck2, CalendarPlus, Check, Flag, MapPin, Pencil, Plus, Trophy } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { RaceDialog } from '@/components/race/RaceDialog'
import { RaceApplyDialog } from '@/components/race/RaceApplyDialog'
import { dDay, distLabel, PRIORITY } from '@/components/race/raceMeta'
import { useActivePlan, usePlanRaces, useRaces, type PlanRace, type RaceView } from '@/api/planner'
import { fmtDuration, fmtPaceSec } from '@/lib/format'
import { cn } from '@/lib/utils'

function PriorityBadge({ p }: { p: RaceView['priority'] }) {
  return (
    <span className={cn('grid size-6 shrink-0 place-items-center rounded-md text-xs font-bold', PRIORITY[p].cls)} title={PRIORITY[p].label}>
      {PRIORITY[p].short}
    </span>
  )
}

function PlanStatus({ r, planRace, hasPlan, onApply }: { r: RaceView; planRace?: PlanRace; hasPlan: boolean; onApply: (r: PlanRace) => void }) {
  if (r.is_plan_goal) return <span className="inline-flex items-center gap-1 text-xs font-medium text-accent"><Flag className="size-3.5" /> 플랜 목표</span>
  if (r.in_plan) return <span className="inline-flex items-center gap-1 text-xs font-medium text-good"><Check className="size-3.5" /> 플랜에 반영됨</span>
  if (!hasPlan) return <span className="text-xs text-subtle">플랜 없음</span>
  if (!r.in_plan_period) return <span className="text-xs text-subtle">플랜 기간 밖</span>
  if (planRace && planRace.changes.length) {
    return (
      <Button size="sm" onClick={() => onApply(planRace)}>
        <CalendarPlus /> 플랜에 반영
      </Button>
    )
  }
  return <span className="text-xs text-subtle">반영할 수 없음</span>
}

function Upcoming({ r, ...rest }: { r: RaceView; planRace?: PlanRace; hasPlan: boolean; onApply: (r: PlanRace) => void; onEdit: () => void }) {
  const d = parseISO(r.race_day)
  const goalPace = r.target_time_s ? r.target_time_s / (r.distance_m / 1000) : null
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-4 py-3.5 first:border-t-0 sm:px-5">
      <div className="w-16 shrink-0 text-center">
        <div className={cn('num text-lg font-bold leading-none', r.d_day <= 14 && 'text-accent')}>{dDay(r.d_day)}</div>
        <div className="num mt-1 text-[11px] text-subtle">{format(d, 'M/d (EEE)', { locale: ko })}</div>
      </div>
      <div className="min-w-[12rem] flex-1">
        <div className="flex items-center gap-2">
          <PriorityBadge p={r.priority} />
          <span className="truncate font-semibold">{r.name}</span>
          <span className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-muted">{distLabel(r.distance_m)}</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-subtle">
          {r.target_time_s ? (
            <span className="num">목표 <b className="text-text">{fmtDuration(r.target_time_s)}</b> ({fmtPaceSec(goalPace)}/km)</span>
          ) : null}
          {r.predicted_time_s ? <span className="num">지금 예상 {fmtDuration(r.predicted_time_s)}</span> : null}
          {r.location && <span className="inline-flex items-center gap-0.5"><MapPin className="size-3" />{r.location}</span>}
          {r.note && <span>{r.note}</span>}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <PlanStatus r={r} {...rest} />
        <Button size="icon" variant="ghost" onClick={rest.onEdit} aria-label="수정">
          <Pencil />
        </Button>
      </div>
    </li>
  )
}

function Past({ r, onEdit }: { r: RaceView; onEdit: () => void }) {
  const res = r.result
  const diff = res && r.target_time_s ? res.time_s - r.target_time_s : null
  return (
    <li className="flex items-center gap-4 border-t px-4 py-3 first:border-t-0 sm:px-5">
      <div className="num w-16 shrink-0 text-center text-[11px] text-subtle">{format(parseISO(r.race_day), 'yy.M.d')}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <PriorityBadge p={r.priority} />
          <span className="truncate font-medium">{r.name}</span>
          <span className="shrink-0 text-[11px] text-subtle">{distLabel(r.distance_m)}</span>
        </div>
      </div>
      {res ? (
        <Link to={`/activities/${res.activity_id}`} className="text-right hover:text-accent">
          <div className="num text-sm font-bold">{fmtDuration(res.time_s)}</div>
          <div className="num text-[11px] text-subtle">
            {fmtPaceSec(res.pace_s_per_km)}/km
            {diff != null && <span className={diff <= 0 ? ' text-good' : ' text-warn'}> · 목표 {diff <= 0 ? '−' : '+'}{fmtDuration(Math.abs(diff))}</span>}
          </div>
        </Link>
      ) : (
        <span className="text-xs text-subtle">기록 없음</span>
      )}
      <Button size="icon" variant="ghost" onClick={onEdit} aria-label="수정">
        <Pencil />
      </Button>
    </li>
  )
}

export function RacesPage() {
  const { data: races } = useRaces()
  const { data: plan } = useActivePlan()
  const { data: planRaces } = usePlanRaces(!!plan)
  const [edit, setEdit] = useState<RaceView | 'new' | null>(null)
  const [apply, setApply] = useState<PlanRace | null>(null)

  const upcoming = races?.filter((r) => r.d_day >= 0) ?? []
  const past = [...(races?.filter((r) => r.d_day < 0) ?? [])].reverse()
  const byId = new Map(planRaces?.map((r) => [r.id, r]))
  const pending = planRaces?.filter((r) => !r.in_plan && r.changes.length) ?? []

  return (
    <>
      <PageHeader
        title="대회"
        subtitle="앞으로의 대회와 지난 기록 · 플랜 기간 안의 대회는 훈련 계획에 반영할 수 있어요"
        actions={
          <Button variant="primary" onClick={() => setEdit('new')}>
            <Plus /> 대회 추가
          </Button>
        }
      />

      {pending.length > 0 && (
        <Card className="mb-4 flex flex-wrap items-center gap-3 border-accent/40 bg-accent-soft px-5 py-3.5">
          <CalendarCheck2 className="size-5 text-accent" />
          <p className="flex-1 text-sm">
            플랜 기간 안에 아직 반영하지 않은 대회가 <b>{pending.length}개</b> 있어요.
          </p>
          <Button size="sm" variant="primary" onClick={() => setApply(pending[0])}>
            {pending[0].name} 반영하기
          </Button>
        </Card>
      )}

      {races && races.length === 0 ? (
        <Card>
          <EmptyState icon={Trophy} title="등록된 대회가 없어요" action={<Button variant="primary" onClick={() => setEdit('new')}><Plus /> 첫 대회 추가</Button>}>
            참가할 대회를 추가하면 D-day와 예상 기록을 보여주고, 훈련 계획에 맞춰 넣을 수 있어요.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="overflow-hidden lg:col-span-2">
            <CardHeader title={`다가오는 대회 ${upcoming.length}개`} hint={plan ? `현재 플랜: ${plan.plan.name}` : '훈련 계획이 없어요 · A 대회로 플랜을 만들 수 있어요'} />
            {upcoming.length ? (
              <ul className="mt-2">
                {upcoming.map((r) => (
                  <Upcoming key={r.id} r={r} planRace={byId.get(r.id)} hasPlan={!!plan} onApply={setApply} onEdit={() => setEdit(r)} />
                ))}
              </ul>
            ) : (
              <p className="px-5 pb-5 pt-2 text-sm text-subtle">예정된 대회가 없어요.</p>
            )}
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader title="중요도" />
              <CardBody className="space-y-2.5">
                {(Object.keys(PRIORITY) as RaceView['priority'][]).map((k) => (
                  <div key={k} className="flex gap-2.5">
                    <PriorityBadge p={k} />
                    <div className="text-[13px] leading-snug">
                      <div className="font-medium">{PRIORITY[k].label.split(' · ')[1]}</div>
                      <div className="text-xs text-subtle">{PRIORITY[k].desc}</div>
                    </div>
                  </div>
                ))}
              </CardBody>
            </Card>
            {past.length > 0 && (
              <Card className="overflow-hidden">
                <CardHeader title="지난 대회" hint="대회 날 비슷한 거리의 러닝을 기록으로 연결해요" />
                <ul className="mt-2">
                  {past.map((r) => (
                    <Past key={r.id} r={r} onEdit={() => setEdit(r)} />
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </div>
      )}

      {edit && <RaceDialog key={edit === 'new' ? 'new' : edit.id} race={edit === 'new' ? null : edit} open onClose={() => setEdit(null)} />}
      <RaceApplyDialog key={apply?.id ?? 'none'} race={apply} onClose={() => setApply(null)} />
    </>
  )
}

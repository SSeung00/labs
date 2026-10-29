import { useState } from 'react'
import { Link } from 'react-router'
import { format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { CalendarPlus, Check, Flag, Plus } from 'lucide-react'
import { Card, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { RaceApplyDialog } from '@/components/race/RaceApplyDialog'
import { dDay, distLabel, PRIORITY } from '@/components/race/raceMeta'
import { usePlanRaces, type PlanRace } from '@/api/planner'
import { cn } from '@/lib/utils'

/** Races that fall inside the active plan, and whether each one is folded into it yet. */
export function PlanRacesCard() {
  const { data } = usePlanRaces()
  const [apply, setApply] = useState<PlanRace | null>(null)
  const races = data ?? []

  return (
    <Card className="mt-4 overflow-hidden">
      <CardHeader
        title="이 플랜 기간의 대회"
        hint="B·C 대회를 반영하면 앞뒤 훈련을 자동으로 조정해요"
        action={
          <Link to="/races" className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-text">
            <Plus className="size-3.5" /> 대회 관리
          </Link>
        }
      />
      {races.length === 0 ? (
        <p className="px-5 pb-5 pt-2 text-sm text-subtle">
          플랜 기간 안에 등록된 대회가 없어요. 중간에 뛸 대회가 있으면 <Link to="/races" className="font-medium text-accent">대회</Link>에서 추가하세요.
        </p>
      ) : (
        <ul className="mt-2">
          {races.map((r) => (
            <li key={r.id} className="flex items-center gap-3 border-t px-5 py-3 first:border-t-0">
              <span className={cn('grid size-6 shrink-0 place-items-center rounded-md text-xs font-bold', PRIORITY[r.priority].cls)}>{PRIORITY[r.priority].short}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{r.name}</div>
                <div className="num text-[11px] text-subtle">
                  {format(parseISO(r.race_day), 'M월 d일 (EEE)', { locale: ko })} · {distLabel(r.distance_m)} · {dDay(r.d_day)}
                </div>
              </div>
              {r.is_plan_goal ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-accent"><Flag className="size-3.5" /> 목표</span>
              ) : r.in_plan ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-good"><Check className="size-3.5" /> 반영됨</span>
              ) : r.changes.length ? (
                <Button size="sm" onClick={() => setApply(r)}>
                  <CalendarPlus /> 반영
                </Button>
              ) : (
                <span className="text-xs text-subtle">지난 대회</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <RaceApplyDialog key={apply?.id ?? 'none'} race={apply} onClose={() => setApply(null)} />
    </Card>
  )
}

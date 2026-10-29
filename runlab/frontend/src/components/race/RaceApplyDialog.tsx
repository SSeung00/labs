import { format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { Check, Flag, Loader2 } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useApplyRaces, type PlanRace } from '@/api/planner'
import { ChangeList } from './ChangeList'
import { distLabel, PRIORITY } from './raceMeta'

const day = (iso: string) => format(parseISO(iso), 'M/d (EEE)', { locale: ko })

/** Preview what folding one race into the plan changes, then apply. */
export function RaceApplyDialog({ race, onClose }: { race: PlanRace | null; onClose: () => void }) {
  const applyM = useApplyRaces()
  if (!race) return <Dialog open={false} onClose={onClose} title="">{null}</Dialog>
  const close = () => {
    applyM.reset()
    onClose()
  }
  return (
    <Dialog
      open
      onClose={close}
      title={<span className="flex items-center gap-2"><Flag className="size-4 text-accent" /> 플랜에 반영: {race.name}</span>}
      description={`${day(race.race_day)} · ${distLabel(race.distance_m)} · ${PRIORITY[race.priority].label}`}
      className="sm:max-w-xl"
    >
      <div className="space-y-4 p-5">
        {applyM.isSuccess ? (
          <div className="space-y-4 py-4 text-center">
            <p className="text-sm">플랜에 반영했어요. 캘린더에서 대회 날과 앞뒤 일정을 확인하세요.</p>
            <Button onClick={close}>닫기</Button>
          </div>
        ) : (
          <>
            <p className="rounded-xl bg-surface-2/70 px-4 py-3 text-[13px] leading-relaxed text-muted">{PRIORITY[race.priority].desc}</p>
            <ChangeList changes={race.changes} />
            {applyM.error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-bad">{applyM.error.message}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close}>
                취소
              </Button>
              <Button variant="primary" onClick={() => applyM.mutate([race.id])} disabled={applyM.isPending}>
                {applyM.isPending ? <Loader2 className="animate-spin" /> : <Check />} {race.changes.length}개 변경 적용
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}

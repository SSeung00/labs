import { useState } from 'react'
import { addWeeks, format } from 'date-fns'
import { Loader2, Trash2 } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { useDeleteRace, useSaveRace, type RacePriority, type RaceView } from '@/api/planner'
import { useProgress } from '@/api/progress'
import { fmtDuration, fmtPaceSec, parseDuration, RACE_PRESETS } from '@/lib/format'
import { cn } from '@/lib/utils'
import { PRIORITY } from './raceMeta'

/** Add or edit a race on the calendar. */
export function RaceDialog({ race, open, onClose }: { race: RaceView | null; open: boolean; onClose: () => void }) {
  const save = useSaveRace()
  const del = useDeleteRace()
  const { data: progress } = useProgress()
  const [name, setName] = useState(race?.name ?? '')
  const [day, setDay] = useState(() => race?.race_day ?? format(addWeeks(new Date(), 8), 'yyyy-MM-dd'))
  const preset = race ? RACE_PRESETS.find((r) => Math.abs(r.distance_m - race.distance_m) < 1) : RACE_PRESETS[1]
  const [dist, setDist] = useState<number | 'custom'>(preset ? preset.distance_m : 'custom')
  const [customKm, setCustomKm] = useState(race && !preset ? String(race.distance_m / 1000) : '')
  const [goal, setGoal] = useState(race?.target_time_s ? fmtDuration(race.target_time_s) : '')
  const [priority, setPriority] = useState<RacePriority>(race?.priority ?? 'B')
  const [location, setLocation] = useState(race?.location ?? '')
  const [note, setNote] = useState(race?.note ?? '')

  const meters = dist === 'custom' ? Number(customKm) * 1000 : dist
  const goalS = parseDuration(goal)
  const predicted = progress?.predictions.find((p) => Math.abs(p.distance_m - meters) < 1)?.consensus_s
  const valid = name.trim() && day && meters >= 400 && (!goal || goalS)

  const submit = () =>
    save.mutate(
      {
        id: race?.id, name: name.trim(), race_day: day, distance_m: meters, target_time_s: goalS ?? null,
        priority, location: location.trim() || null, note: note.trim() || null,
      },
      { onSuccess: onClose },
    )

  return (
    <Dialog open={open} onClose={onClose} title={race ? '대회 수정' : '대회 추가'} description="플랜 기간 안이면 훈련 계획에 반영할 수 있어요">
      <form
        className="space-y-4 p-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) submit()
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
          <div>
            <Label htmlFor="r-name">대회 이름</Label>
            <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 2026 춘천마라톤" autoFocus={!race} />
          </div>
          <div>
            <Label htmlFor="r-day">날짜</Label>
            <Input id="r-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </div>
        </div>

        <div>
          <Label>거리</Label>
          <div className="flex flex-wrap items-center gap-1.5">
            {[...RACE_PRESETS.map((r) => ({ v: r.distance_m as number | 'custom', l: r.label })), { v: 'custom' as const, l: '직접 입력' }].map((o) => (
              <button
                key={String(o.v)}
                type="button"
                onClick={() => setDist(o.v)}
                className={cn('h-9 rounded-lg px-3 text-sm font-medium', dist === o.v ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-muted hover:text-text')}
              >
                {o.l}
              </button>
            ))}
            {dist === 'custom' && (
              <Input value={customKm} onChange={(e) => setCustomKm(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="km" className="num h-9 w-24" aria-label="거리 (km)" />
            )}
          </div>
        </div>

        <div>
          <Label htmlFor="r-goal">목표 기록 (선택)</Label>
          <Input id="r-goal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={predicted ? `현재 예상 ${fmtDuration(predicted)}` : 'h:mm:ss'} className="num" />
          <p className="mt-1 text-[11px] text-subtle">
            {goalS && meters ? `목표 페이스 ${fmtPaceSec(goalS / (meters / 1000))}/km` : goal ? 'h:mm:ss 형식으로 적어 주세요' : '비워 두면 현재 체력 기준 예상 기록을 보여줘요'}
          </p>
        </div>

        <div>
          <Label>중요도</Label>
          <div className="grid gap-1.5 sm:grid-cols-3">
            {(Object.keys(PRIORITY) as RacePriority[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setPriority(k)}
                className={cn('rounded-xl border px-3 py-2 text-left', priority === k ? 'border-accent bg-accent-soft' : 'hover:border-border-strong')}
              >
                <div className="text-sm font-semibold">{PRIORITY[k].label}</div>
                <div className="mt-0.5 text-[11px] leading-snug text-subtle">{PRIORITY[k].desc}</div>
              </button>
            ))}
          </div>
          {priority === 'A' && <p className="mt-1.5 text-[11px] text-subtle">A 대회는 훈련 계획 → 새 플랜에서 목표로 골라 플랜을 만들 수 있어요.</p>}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="r-loc">장소 (선택)</Label>
            <Input id="r-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="예: 춘천 공지천" />
          </div>
          <div>
            <Label htmlFor="r-note">메모 (선택)</Label>
            <Input id="r-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 접수 완료, 배번 수령" />
          </div>
        </div>

        {(save.error || del.error) && <p className="rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-bad">{(save.error ?? del.error)!.message}</p>}

        <div className="flex items-center gap-2 border-t pt-4">
          {race && (
            <Button
              type="button"
              variant="ghost"
              className="text-bad hover:text-bad"
              onClick={() => confirm(`'${race.name}'을(를) 지울까요? 플랜에 반영된 대회 날은 휴식으로 바뀌어요.`) && del.mutate(race.id, { onSuccess: onClose })}
            >
              <Trash2 /> 삭제
            </Button>
          )}
          <Button type="button" variant="ghost" className="ml-auto" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" variant="primary" disabled={!valid || save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />}
            {race ? '저장' : '추가'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

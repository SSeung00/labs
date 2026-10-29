import { useState } from 'react'
import { Link } from 'react-router'
import { format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { ArrowLeftRight, ArrowUpRight, BedDouble, CalendarArrowUp, CircleDashed, Feather, Heart, Loader2, RotateCcw, Trash2, Watch } from 'lucide-react'
import { useSendToGarmin } from '@/api/coach'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import {
  useDeleteWorkout,
  usePatchWorkout,
  useSetTemplate,
  useSwapWorkout,
  useWorkoutReview,
  useWorkoutTemplates,
  type PaceZone,
  type PlannedWorkout,
  type Verdict,
  type WorkoutReview,
} from '@/api/planner'
import type { PaceZones } from '@/api/progress'
import { fmtDuration, fmtPaceSec } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useNow } from '@/lib/useNow'
import { KIND, PACE_NAME, PHASE, estDuration, fmtEst, templateOf } from './workoutMeta'
import { StepList } from './StepList'

const VERDICT: Record<Verdict, { label: string; cls: string }> = {
  on: { label: '목표 범위', cls: 'bg-good/15 text-good' },
  fast: { label: '빠름', cls: 'bg-warn/15 text-warn' },
  slow: { label: '느림', cls: 'bg-fitness/15 text-fitness' },
}

function Pill({ v }: { v: Verdict | null | undefined }) {
  if (!v) return null
  return <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', VERDICT[v].cls)}>{VERDICT[v].label}</span>
}

function bandText(b: { slow: number; fast: number } | null | undefined) {
  return b ? `${fmtPaceSec(b.fast)}–${fmtPaceSec(b.slow)}` : '—'
}

function Targets({ review }: { review: WorkoutReview }) {
  const zones = Object.entries(review.targets) as [PaceZone, NonNullable<WorkoutReview['targets'][PaceZone]>][]
  if (!zones.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {zones.map(([z, t]) => (
        <span key={z} className="num inline-flex items-center gap-1.5 rounded-lg border bg-surface-2/50 px-2 py-1 text-xs">
          <b className="font-semibold">{PACE_NAME[z]}</b>
          <span className="text-muted">{bandText(t.pace)}/km</span>
          <span className="inline-flex items-center gap-0.5 text-subtle">
            <Heart className="size-3" /> {t.hr[0] > 0 ? `${t.hr[0]}–${t.hr[1]}` : `≤${t.hr[1]}`}
          </span>
        </span>
      ))}
    </div>
  )
}

/** What was actually run against the plan: distance, main-set pace, and each rep. */
function Actual({ review }: { review: WorkoutReview }) {
  const a = review.actual
  if (!a) return null
  const work = review.main_zone !== 'E'
  const band = review.targets[review.main_zone]?.pace
  return (
    <div className="space-y-3 rounded-xl border p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted">목표 대비 실제</span>
        <Link to={`/activities/${a.activity_id}`} className="inline-flex items-center gap-0.5 text-xs text-muted hover:text-text">
          기록 보기 <ArrowUpRight className="size-3.5" />
        </Link>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-surface-2/60 p-2">
          <div className="text-[10px] text-subtle">거리</div>
          <div className="num text-sm font-bold">
            {a.km.toFixed(1)}
            <span className="text-xs font-normal text-subtle"> / {a.target_km.toFixed(1)}km</span>
          </div>
        </div>
        <div className="rounded-lg bg-surface-2/60 p-2">
          <div className="text-[10px] text-subtle">{work ? `${PACE_NAME[review.main_zone]} 구간 평균` : '평균 페이스'}</div>
          <div className="num text-sm font-bold">{a.main_pace ? fmtPaceSec(a.main_pace) : '—'}</div>
          <div className="mt-0.5">
            <Pill v={a.main_verdict} />
          </div>
        </div>
        <div className="rounded-lg bg-surface-2/60 p-2">
          <div className="text-[10px] text-subtle">평균 심박 · 시간</div>
          <div className="num text-sm font-bold">{a.avg_hr ? Math.round(a.avg_hr) : '—'}</div>
          <div className="num text-[11px] text-subtle">{fmtDuration(a.time_s)}</div>
        </div>
      </div>
      {!work && a.main_hr_ok === false && <p className="text-xs text-warn">심박이 쉬운 강도보다 높았어요. 다음엔 조금 더 천천히 달려 보세요.</p>}
      {work && band && <p className="num text-[11px] text-subtle">목표 {bandText(band)}/km · 범위 ±6초까지 목표로 봐요</p>}
      {a.reps.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] text-subtle">{a.paired ? '반복별 기록' : '빠르게 달린 랩 (자동 랩 기준이라 대략적이에요)'}</div>
          <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            {a.reps.map((r) => (
              <li key={r.n} className="num flex items-center gap-2 rounded-lg bg-surface-2/50 px-2 py-1 text-xs">
                <span className="w-4 text-subtle">{r.n}</span>
                <b className="font-semibold">{r.pace ? fmtPaceSec(r.pace) : '—'}</b>
                {r.hr && <span className="text-subtle">♥{Math.round(r.hr)}</span>}
                <span
                  className={cn('ml-auto size-2 rounded-full', r.verdict === 'on' ? 'bg-good' : r.verdict === 'fast' ? 'bg-warn' : r.verdict === 'slow' ? 'bg-fitness' : 'bg-surface-3')}
                  title={r.verdict ? VERDICT[r.verdict].label : ''}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
      {work && a.reps.length === 0 && <p className="text-xs text-subtle">빠르게 달린 랩이 없어요. 계획한 강도로 못 달렸거나, 랩이 길어서 구분이 안 돼요.</p>}
    </div>
  )
}

function TemplateEditor({ w, onDone }: { w: PlannedWorkout; onDone: () => void }) {
  const { data: templates } = useWorkoutTemplates()
  const set = useSetTemplate()
  const [key, setKey] = useState(() => templateOf(w.kind, w.title))
  const [km, setKm] = useState(String(Math.max(3, Math.round((w.target_distance_m ?? 8000) / 1000))))
  return (
    <div>
      <Label>훈련 바꾸기</Label>
      <div className="flex flex-wrap gap-1.5">
        {(templates ?? []).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setKey(t.key)}
            className={cn('h-8 rounded-lg px-2.5 text-xs font-medium transition-colors', key === t.key ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-muted hover:text-text')}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        {key !== 'rest' && (
          <>
            <Input inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} className="num w-24" aria-label="전체 거리 (km)" />
            <span className="text-xs text-subtle">km (워밍업·쿨다운 포함, 반복 횟수는 거리에 맞춰 정해져요)</span>
          </>
        )}
        <Button size="sm" className="ml-auto" disabled={set.isPending} onClick={() => set.mutate({ id: w.id, template: key, km: Number(km) || 8 }, { onSuccess: onDone })}>
          {set.isPending && <Loader2 className="animate-spin" />} 적용
        </Button>
      </div>
      {set.error && <p className="mt-1 text-xs text-bad">{set.error.message}</p>}
    </div>
  )
}

function DayEditor({ w, onDone }: { w: PlannedWorkout; onDone: () => void }) {
  const patch = usePatchWorkout()
  const swap = useSwapWorkout()
  const [day, setDay] = useState(w.day)
  const err = patch.error ?? swap.error
  return (
    <div>
      <Label htmlFor="wday">날짜</Label>
      <div className="flex flex-wrap gap-2">
        <Input id="wday" type="date" value={day} onChange={(e) => setDay(e.target.value)} className="num w-40" />
        <Button size="sm" className="h-10" disabled={day === w.day || patch.isPending} onClick={() => patch.mutate({ id: w.id, day }, { onSuccess: onDone })}>
          <CalendarArrowUp /> 이 날로 옮기기
        </Button>
        <Button size="sm" className="h-10" disabled={day === w.day || swap.isPending} onClick={() => swap.mutate({ id: w.id, day }, { onSuccess: onDone })} title="그날의 훈련과 자리를 바꿔요">
          <ArrowLeftRight /> 서로 바꾸기
        </Button>
      </div>
      {err && <p className="mt-1 text-xs text-bad">{err.message}</p>}
    </div>
  )
}

export function WorkoutDialog({ w, onClose, paces, racePace }: { w: PlannedWorkout | null; onClose: () => void; paces?: PaceZones | null; racePace?: number }) {
  const now = useNow()
  const patch = usePatchWorkout()
  const del = useDeleteWorkout()
  const send = useSendToGarmin()
  const { data: review } = useWorkoutReview(w?.kind !== 'rest' ? w?.id : null)
  const [note, setNote] = useState(w?.note ?? '')

  if (!w) return <Dialog open={false} onClose={onClose} title="">{null}</Dialog>
  const run = (b: Parameters<typeof patch.mutate>[0]) => patch.mutate(b, { onSuccess: onClose })
  const editable = w.kind !== 'race' && w.day >= format(now, 'yyyy-MM-dd') && w.status !== 'done' && w.status !== 'partial'

  return (
    <Dialog
      open={!!w}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <span className="h-4 w-1 rounded-full" style={{ background: KIND[w.kind].color }} />
          {w.title}
        </span>
      }
      description={`${format(parseISO(w.day), 'M월 d일 EEEE', { locale: ko })} · ${KIND[w.kind].label}${w.phase ? ` · ${PHASE[w.phase].label} 단계` : ''}`}
      className="sm:max-w-xl"
    >
      <div className="space-y-5 p-5">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-surface-2/70 p-2.5">
            <div className="text-[10px] text-subtle">거리</div>
            <div className="num font-bold">{((w.target_distance_m ?? 0) / 1000).toFixed(1)}km</div>
          </div>
          <div className="rounded-xl bg-surface-2/70 p-2.5">
            <div className="text-[10px] text-subtle">예상 시간</div>
            <div className="num font-bold">{fmtEst(estDuration(w.structure ?? [], paces, racePace)) || '—'}</div>
          </div>
          <div className="rounded-xl bg-surface-2/70 p-2.5">
            <div className="text-[10px] text-subtle">예상 부하</div>
            <div className="num font-bold">{Math.round(w.target_tss ?? 0)}</div>
          </div>
        </div>

        {(w.structure ?? []).length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted">구성 · 페이스는 현재 VDOT 기준</div>
            <StepList steps={w.structure!} paces={paces} racePace={racePace} />
            {review && <Targets review={review} />}
          </div>
        )}

        {review?.actual && <Actual review={review} />}

        {editable && <TemplateEditor key={`${w.id}-${w.kind}`} w={w} onDone={onClose} />}
        {(editable || w.status === 'missed') && <DayEditor w={w} onDone={onClose} />}

        <div>
          <Label htmlFor="wnote">메모</Label>
          <Input id="wnote" value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (w.note ?? '') && patch.mutate({ id: w.id, note })} placeholder="코스, 신발, 컨디션 등" />
        </div>

        {w.kind !== 'rest' && (w.structure ?? []).length > 0 && (
          <div className="rounded-xl border bg-surface-2/40 p-3">
            <div className="flex items-center gap-3">
              <Watch className="size-4 shrink-0 text-fitness" />
              <div className="min-w-0 flex-1 text-xs text-muted">
                {w.garmin_workout_id || send.isSuccess
                  ? '가민 커넥트 캘린더에 보냈어요. 시계를 동기화하면 이 날 워크아웃으로 나타나요.'
                  : '가민 커넥트 캘린더에 이 워크아웃(페이스 목표 포함)을 만들어요. 시계로 하면 반복별 기록이 정확히 비교돼요.'}
              </div>
              <Button
                size="sm"
                disabled={send.isPending}
                onClick={() => confirm('가민 커넥트 계정에 이 워크아웃을 만들고 캘린더에 예약할까요?') && send.mutate(w.id)}
              >
                {send.isPending ? <Loader2 className="animate-spin" /> : <Watch />}
                {w.garmin_workout_id || send.isSuccess ? '다시 보내기' : '가민으로 보내기'}
              </Button>
            </div>
            {send.error && <p className="mt-2 text-xs text-bad">{send.error.message}</p>}
          </div>
        )}

        <div className="flex flex-wrap gap-2 border-t pt-4">
          {editable && w.kind !== 'easy' && w.kind !== 'rest' && (
            <Button size="sm" onClick={() => run({ id: w.id, kind: 'easy' })}>
              <Feather /> 이지런으로
            </Button>
          )}
          {editable && w.kind !== 'rest' && (
            <Button size="sm" onClick={() => run({ id: w.id, kind: 'rest' })}>
              <BedDouble /> 휴식으로
            </Button>
          )}
          {w.status === 'skipped' ? (
            <Button size="sm" onClick={() => run({ id: w.id, status: 'planned' })}>
              <RotateCcw /> 되돌리기
            </Button>
          ) : (
            w.kind !== 'race' &&
            w.kind !== 'rest' &&
            w.status !== 'done' && (
              <Button size="sm" onClick={() => run({ id: w.id, status: 'skipped' })}>
                <CircleDashed /> 건너뛰기
              </Button>
            )
          )}
          {w.kind !== 'race' && (
            <Button size="sm" variant="ghost" className="ml-auto text-bad hover:text-bad" onClick={() => del.mutate(w.id, { onSuccess: onClose })}>
              <Trash2 /> 삭제
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  )
}

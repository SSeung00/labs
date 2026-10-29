import { useMemo, useState } from 'react'
import { addWeeks, differenceInCalendarWeeks, format } from 'date-fns'
import { ko } from 'date-fns/locale'
import { motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, CalendarRange, Loader2, Sparkles } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { useCreatePlan, usePlanDefaults, usePreviewPlan, useRaces, type PlanBody, type RaceView } from '@/api/planner'
import { useProgress } from '@/api/progress'
import { fmtDuration, fmtPaceSec, parseDuration, RACE_PRESETS } from '@/lib/format'
import { cn } from '@/lib/utils'
import { DOW, KIND, PHASE } from './workoutMeta'
import { Seg } from '@/components/ui/seg'
import { distLabel, PRIORITY } from '@/components/race/raceMeta'
import { useNow } from '@/lib/useNow'



export function PlanWizard({ onCancel }: { onCancel?: () => void }) {
  const now = useNow()
  const { data: defaults } = usePlanDefaults()
  const { data: progress } = useProgress()
  const preview = usePreviewPlan()
  const create = useCreatePlan()
  const [step, setStep] = useState(0)

  const [name, setName] = useState('')
  const [dist, setDist] = useState(21097.5)
  const [raceDay, setRaceDay] = useState(format(addWeeks(now, 16), 'yyyy-MM-dd'))
  const [goal, setGoal] = useState('')
  const [days, setDays] = useState(5)
  const [longDow, setLongDow] = useState(6)
  const [curKmInput, setCurKm] = useState<string | null>(null)
  const curKm = curKmInput ?? (defaults ? String(defaults.current_weekly_km) : '')
  const [peakKm, setPeakKm] = useState<string>('')
  const [raceId, setRaceId] = useState<number | null>(null)
  const { data: races } = useRaces()
  // Saved races at least 2 weeks out, goal races first.
  const candidates = (races ?? []).filter((r) => r.d_day >= 14).sort((a, b) => a.priority.localeCompare(b.priority) || a.d_day - b.d_day)

  const pick = (r: RaceView) => {
    setRaceId(r.id)
    setName(r.name)
    setRaceDay(r.race_day)
    setDist(r.distance_m)
    setGoal(r.target_time_s ? fmtDuration(r.target_time_s) : '')
  }


  const predicted = progress?.predictions.find((p) => p.distance_m === dist)?.consensus_s
  const goalS = parseDuration(goal)
  const weeks = differenceInCalendarWeeks(new Date(raceDay), now, { weekStartsOn: 1 })

  const body: PlanBody = useMemo(
    () => ({
      race: { name: name || `${RACE_PRESETS.find((r) => r.distance_m === dist)?.label} 레이스`, race_day: raceDay, distance_m: dist, target_time_s: goalS },
      race_id: raceId,
      days_per_week: days,
      long_run_dow: longDow,
      current_weekly_km: curKm ? Number(curKm) : null,
      peak_weekly_km: peakKm ? Number(peakKm) : null,
    }),
    [name, dist, raceDay, goalS, raceId, days, longDow, curKm, peakKm],
  )

  const goPreview = () => {
    preview.mutate(body)
    setStep(2)
  }

  const maxKm = Math.max(...(preview.data?.weeks.map((w) => w.target_km ?? w.planned_km) ?? [1]))

  return (
    <Card className="mx-auto max-w-3xl overflow-hidden">
      <div className="flex items-center gap-3 border-b px-6 py-4">
        <div className="grid size-9 place-items-center rounded-xl bg-accent-soft text-accent">
          <CalendarRange className="size-5" />
        </div>
        <div className="flex-1">
          <h2 className="font-semibold tracking-tight">새 훈련 플랜</h2>
          <p className="text-xs text-subtle">{['목표 레이스', '훈련 설정', '미리보기'][step]} · {step + 1}/3</p>
        </div>
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span key={i} className={cn('h-1.5 w-6 rounded-full transition-colors', i <= step ? 'bg-accent' : 'bg-surface-3')} />
          ))}
        </div>
      </div>

      <motion.div key={step} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.18 }} className="space-y-6 p-6">
        {step === 0 && (
          <>
            {candidates.length > 0 && (
              <div>
                <Label>저장된 대회에서 고르기</Label>
                <div className="flex flex-wrap gap-1.5">
                  {candidates.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => (raceId === r.id ? setRaceId(null) : pick(r))}
                      className={cn('rounded-lg border px-3 py-1.5 text-left text-sm', raceId === r.id ? 'border-accent bg-accent-soft' : 'hover:border-border-strong')}
                    >
                      <span className="mr-1.5 text-[11px] font-bold text-subtle">{PRIORITY[r.priority].short}</span>
                      <span className="font-medium">{r.name}</span>
                      <span className="num ml-1.5 text-[11px] text-subtle">{distLabel(r.distance_m)} · {r.race_day}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-subtle">고른 대회가 플랜의 목표(A)가 되고, 기간 안의 다른 대회는 자동으로 일정에 반영돼요.</p>
              </div>
            )}
            <div>
              <Label>거리</Label>
              <Seg value={dist} onChange={setDist} options={RACE_PRESETS.map((r) => ({ v: r.distance_m, l: r.label }))} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="race-name">레이스 이름</Label>
                <Input id="race-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 2027 서울마라톤" />
              </div>
              <div>
                <Label htmlFor="race-day">레이스 날짜</Label>
                <Input id="race-day" type="date" value={raceDay} onChange={(e) => setRaceDay(e.target.value)} />
                <p className="mt-1 text-[11px] text-subtle">{weeks > 0 ? `${weeks}주 남음` : '미래 날짜를 고르세요'}</p>
              </div>
            </div>
            <div>
              <Label htmlFor="goal">목표 기록 (선택)</Label>
              <Input id="goal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={predicted ? `현재 예상 ${fmtDuration(predicted)}` : 'h:mm:ss'} className="num" />
              <p className="mt-1 text-[11px] text-subtle">
                {goalS ? `목표 페이스 ${fmtPaceSec(goalS / (dist / 1000))}/km` : '비워 두면 현재 체력 기준 예상 기록으로 레이스 페이스를 잡아요'}
                {predicted && goalS && goalS < predicted * 0.93 ? ' · 현재보다 7% 이상 빠른 도전적인 목표예요' : ''}
              </p>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div>
              <Label>주당 훈련 일수</Label>
              <Seg value={days} onChange={setDays} options={[3, 4, 5, 6, 7].map((d) => ({ v: d, l: `${d}일` }))} />
            </div>
            <div>
              <Label>롱런 요일</Label>
              <Seg value={longDow} onChange={setLongDow} options={DOW.map((d, i) => ({ v: i, l: d }))} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="cur">현재 주간 거리 (km)</Label>
                <Input id="cur" inputMode="decimal" value={curKm} onChange={(e) => setCurKm(e.target.value)} className="num" />
                <p className="mt-1 text-[11px] text-subtle">최근 4주 평균 {defaults?.current_weekly_km ?? '—'}km</p>
              </div>
              <div>
                <Label htmlFor="peak">최대 주간 거리 (km, 선택)</Label>
                <Input id="peak" inputMode="decimal" value={peakKm} onChange={(e) => setPeakKm(e.target.value)} placeholder="자동" className="num" />
                <p className="mt-1 text-[11px] text-subtle">비워 두면 거리·현재 볼륨에 맞춰 정해요</p>
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            {preview.isPending && <div className="grid h-48 place-items-center text-sm text-subtle"><Loader2 className="size-5 animate-spin" /></div>}
            {preview.error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{preview.error.message}</p>}
            {preview.data && (
              <>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-xl bg-surface-2/70 p-3">
                    <div className="text-[11px] text-subtle">기간</div>
                    <div className="num text-lg font-bold">{preview.data.weeks.length}주</div>
                  </div>
                  <div className="rounded-xl bg-surface-2/70 p-3">
                    <div className="text-[11px] text-subtle">최대 주간 거리</div>
                    <div className="num text-lg font-bold">{maxKm.toFixed(0)}km</div>
                  </div>
                  <div className="rounded-xl bg-surface-2/70 p-3">
                    <div className="text-[11px] text-subtle">레이스 페이스</div>
                    <div className="num text-lg font-bold">{fmtPaceSec(preview.data.race_pace_s_per_km)}</div>
                  </div>
                </div>
                <div>
                  <div className="mb-2 flex flex-wrap gap-3">
                    {(['base', 'build', 'peak', 'taper'] as const).map((p) => (
                      <span key={p} className="inline-flex items-center gap-1.5 text-xs text-muted">
                        <span className="size-2 rounded-[3px]" style={{ background: PHASE[p].color }} />
                        {PHASE[p].label} <span className="text-subtle">· {PHASE[p].desc}</span>
                      </span>
                    ))}
                  </div>
                  <div className="flex h-36 items-end gap-[3px]">
                    {preview.data.weeks.map((w) => (
                      <div key={w.week_start} className="group relative flex h-full flex-1 flex-col justify-end" title={`${format(new Date(w.week_start), 'M/d')} · ${w.target_km}km`}>
                        <div className="w-full rounded-t-[4px]" style={{ height: `${((w.target_km ?? w.planned_km) / maxKm) * 100}%`, background: PHASE[w.phase].color, opacity: 0.85 }} />
                        <span className="num pointer-events-none absolute -top-5 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-surface px-1.5 text-[10px] shadow group-hover:block">{w.target_km}km</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-1 flex justify-between text-[10px] text-subtle">
                    <span>{format(new Date(preview.data.weeks[0].week_start), 'M월 d일', { locale: ko })}</span>
                    <span>레이스 주</span>
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-xs font-medium text-muted">첫 주</div>
                  <div className="grid gap-1.5">
                    {preview.data.workouts
                      .filter((w) => w.day < addWeeks(new Date(preview.data!.weeks[0].week_start), 1).toISOString().slice(0, 10))
                      .map((w) => (
                        <div key={w.day + w.title} className="flex items-center gap-3 rounded-lg bg-surface-2/60 px-3 py-2 text-sm">
                          <span className="w-14 text-xs text-subtle">{format(new Date(w.day), 'M/d (EEE)', { locale: ko })}</span>
                          <span className="h-4 w-1 rounded-full" style={{ background: KIND[w.kind].color }} />
                          <span className="flex-1 font-medium">{w.title}</span>
                          <span className="num text-xs text-muted">{((w.target_distance_m ?? 0) / 1000).toFixed(1)}km</span>
                        </div>
                      ))}
                  </div>
                </div>
              </>
            )}
            {create.error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{create.error.message}</p>}
          </>
        )}
      </motion.div>

      <div className="flex items-center gap-2 border-t px-6 py-4">
        {step > 0 ? (
          <Button variant="ghost" onClick={() => setStep(step - 1)}>
            <ArrowLeft /> 이전
          </Button>
        ) : (
          onCancel && <Button variant="ghost" onClick={onCancel}>취소</Button>
        )}
        <div className="ml-auto">
          {step === 0 && (
            <Button variant="primary" disabled={weeks < 2} onClick={() => setStep(1)}>
              다음 <ArrowRight />
            </Button>
          )}
          {step === 1 && (
            <Button variant="primary" onClick={goPreview}>
              플랜 미리보기 <ArrowRight />
            </Button>
          )}
          {step === 2 && (
            <Button variant="primary" disabled={!preview.data || create.isPending} onClick={() => create.mutate(body)}>
              {create.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
              플랜 시작하기
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}

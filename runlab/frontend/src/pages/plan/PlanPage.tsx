import { useState } from 'react'
import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { ChevronDown, Flag, MoreHorizontal, Plus, Settings2, Sparkles, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EChart } from '@/components/charts/EChart'
import { alpha, baseAxis, baseTooltip, useChartTheme } from '@/components/charts/theme'
import { useActivePlan, useDeletePlan, type ActivePlan, type PlannedWorkout, type WeekAction } from '@/api/planner'
import { useProgress } from '@/api/progress'
import { fmtDuration, fmtPaceSec, RACE_PRESETS } from '@/lib/format'
import { cn } from '@/lib/utils'
import { LegendKey } from '../fitness/charts'
import { PlanCalendar } from './PlanCalendar'
import { PlanAgenda } from './PlanAgenda'
import { PlanWizard } from './PlanWizard'
import { Suggestions } from './Suggestions'
import { WorkoutDialog } from './WorkoutDialog'
import { PlanAiDialog } from './PlanAiDialog'
import { PlanRacesCard } from './PlanRacesCard'
import { WeekBoard } from './WeekBoard'
import { WeekCheckCard } from './WeekCheckCard'
import { WeekAdjustDialog } from './WeekAdjustDialog'
import { PlanSettingsDialog } from './PlanSettingsDialog'
import { useAiUsage } from '@/api/coach'
import { PHASE } from './workoutMeta'
import { useNow } from '@/lib/useNow'

const FULL_KEY = 'runlab.plan.full'

// Remembered per device; storage can be unavailable (private mode), so failures just fall back.
function readFlag(key: string) {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

function PhaseTimeline({ data }: { data: ActivePlan }) {
  const now = useNow()
  const weeks = data.plan.params.weeks ?? data.weeks
  const total = weeks.length
  const todayIso = format(now, 'yyyy-MM-dd')
  const curIdx = weeks.findIndex((w, i) => w.week_start <= todayIso && (weeks[i + 1]?.week_start ?? '9999') > todayIso)
  const segs: { phase: keyof typeof PHASE; n: number }[] = []
  weeks.forEach((w) => (segs.at(-1)?.phase === w.phase ? segs.at(-1)!.n++ : segs.push({ phase: w.phase, n: 1 })))
  return (
    <div>
      <div className="relative flex h-3 gap-[3px]">
        {segs.map((s, i) => (
          <div key={i} className="h-full rounded-full" style={{ flex: s.n, background: PHASE[s.phase].color, opacity: 0.85 }} />
        ))}
        {curIdx >= 0 && (
          <div className="absolute -top-1 h-5 w-1 -translate-x-1/2 rounded-full bg-text shadow" style={{ left: `${((curIdx + 0.5) / total) * 100}%` }} title="이번 주" />
        )}
      </div>
      <div className="mt-2 flex gap-[3px] text-[11px]">
        {segs.map((s, i) => (
          <div key={i} style={{ flex: s.n }} className="min-w-0 truncate text-muted">
            <b className="font-semibold text-text">{PHASE[s.phase].label}</b> {s.n}주
          </div>
        ))}
      </div>
    </div>
  )
}

function WeeklyCompare({ data }: { data: ActivePlan }) {
  const now = useNow()
  const t = useChartTheme()
  const today = format(now, 'yyyy-MM-dd')
  const weeks = data.weeks
  return (
    <EChart
      style={{ height: 220 }}
      option={{
        grid: { left: 36, right: 8, top: 12, bottom: 24 },
        tooltip: {
          ...baseTooltip(t),
          trigger: 'axis',
          axisPointer: { type: 'shadow', shadowStyle: { color: alpha(t.subtle, 0.08) } },
          formatter: (ps: unknown) => {
            const w = weeks[(ps as { dataIndex: number }[])[0].dataIndex]
            return `<b>${format(parseISO(w.week_start), 'M월 d일')} 주 · ${PHASE[w.phase].label}</b><br/>계획 ${w.planned_km.toFixed(1)} km${w.week_start <= today ? `<br/>실제 ${(w.actual_km ?? 0).toFixed(1)} km` : ''}`
          },
        },
        xAxis: { type: 'category', data: weeks.map((w) => format(parseISO(w.week_start), 'M/d')), ...baseAxis(t), splitLine: { show: false } },
        yAxis: { type: 'value', ...baseAxis(t), splitNumber: 3, axisLabel: { ...baseAxis(t).axisLabel, formatter: '{value}' } },
        series: [
          { name: '계획', type: 'bar', barMaxWidth: 12, barGap: '15%', data: weeks.map((w) => w.planned_km), itemStyle: { color: alpha(t.subtle, 0.35), borderRadius: [4, 4, 0, 0] } },
          { name: '실제', type: 'bar', barMaxWidth: 12, data: weeks.map((w) => (w.week_start <= today ? w.actual_km : null)), itemStyle: { color: t.accent, borderRadius: [4, 4, 0, 0] } },
        ],
      }}
    />
  )
}

function ActiveView({ data }: { data: ActivePlan }) {
  const now = useNow()
  const { data: progress } = useProgress()
  const del = useDeletePlan()
  const [open, setOpen] = useState<PlannedWorkout | null>(null)
  const [menu, setMenu] = useState(false)
  const [ai, setAi] = useState(false)
  const [settings, setSettings] = useState(false)
  const [weekReq, setWeekReq] = useState<{ week_start: string; action: WeekAction } | null>(null)
  const [full, setFull] = useState(() => readFlag(FULL_KEY))
  const toggleFull = () => {
    writeFlag(FULL_KEY, !full)
    setFull(!full)
  }
  const { data: usage } = useAiUsage()
  const race = data.race
  const dday = race ? differenceInCalendarDays(parseISO(race.race_day), now) : null
  const racePace = data.plan.params.race_pace_s_per_km

  return (
    <>
      <PageHeader
        title={race?.name ?? data.plan.name}
        subtitle={race ? `${format(parseISO(race.race_day), 'yyyy년 M월 d일 EEEE', { locale: ko })} · ${RACE_PRESETS.find((r) => Math.abs(r.distance_m - race.distance_m) < 1)?.label ?? `${race.distance_m / 1000}km`}` : ''}
        actions={
          <div className="relative flex items-center gap-1">
            {usage?.available && (
              <Button onClick={() => setAi(true)}>
                <Sparkles className="text-accent" /> AI로 조정
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={() => setMenu((m) => !m)} aria-label="플랜 메뉴">
              <MoreHorizontal />
            </Button>
            {menu && (
              <div className="absolute right-0 top-10 z-20 w-44 rounded-xl border bg-surface p-1 shadow-xl">
                <button onClick={() => (setMenu(false), setSettings(true))} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-surface-2">
                  <Settings2 className="size-4" /> 플랜 설정 바꾸기
                </button>
                <button
                  onClick={() => confirm('이 플랜을 삭제할까요? 계획된 훈련이 모두 지워져요.') && del.mutate(data.plan.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-bad hover:bg-surface-2"
                >
                  <Trash2 className="size-4" /> 플랜 삭제
                </button>
              </div>
            )}
          </div>
        }
      />

      <Suggestions className="mb-4" />

      <WeekBoard data={data} paces={progress?.paces} onOpen={setOpen} onWeekAction={(week_start, action) => setWeekReq({ week_start, action })} onSettings={() => setSettings(true)} />

      <WeekCheckCard className="mt-4" />

      <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-4">
        <Card className="p-3 sm:p-5">
          <div className="flex items-center gap-2 text-xs text-muted">
            <Flag className="size-3.5" /> 레이스까지
          </div>
          <div className="num mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{dday != null ? (dday > 0 ? `D-${dday}` : dday === 0 ? 'D-DAY' : '완료') : '—'}</div>
          <div className="mt-1 text-xs text-subtle">
            {race?.target_time_s ? `목표 ${fmtDuration(race.target_time_s)}` : '목표 기록 없음'}
            {racePace ? ` · ${fmtPaceSec(racePace)}/km` : ''}
          </div>
        </Card>
        <Card className="p-3 sm:p-5">
          <div className="text-xs text-muted">훈련 소화율</div>
          <div className="num mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{data.compliance != null ? `${Math.round(data.compliance * 100)}%` : '—'}</div>
          <div className="mt-1 text-xs text-subtle">{data.due ? `지금까지 ${data.due}개 중 ${data.done}개 완료` : '아직 시작 전이에요'}</div>
        </Card>
        <Card className="p-3 sm:p-5">
          <div className="text-xs text-muted">현재 VDOT</div>
          <div className="num mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{progress?.current.vdot?.toFixed(1) ?? '—'}</div>
          <div className="mt-1 text-xs text-subtle">페이스는 VDOT이 바뀌면 자동 갱신돼요</div>
        </Card>
      </div>

      <PlanRacesCard />

      <button
        onClick={toggleFull}
        className="mt-4 flex w-full flex-wrap items-center gap-x-2 rounded-card border bg-surface px-5 py-3.5 text-left shadow-card hover:bg-surface-2/60"
        aria-expanded={full}
      >
        <span className="text-sm font-semibold">전체 일정 보기</span>
        <span className="text-xs text-subtle">주기화 · {data.weeks.length}주 캘린더 · 계획 대비 실제 거리</span>
        <ChevronDown className={cn('ml-auto size-4 text-muted transition-transform', full && 'rotate-180')} />
      </button>
      {full && (
        <>
          <Card className="mt-4">
            <CardHeader title="주기화" hint="기초 → 강화 → 실전 → 테이퍼 · 세로 막대가 이번 주" />
            <CardBody>
              <PhaseTimeline data={data} />
            </CardBody>
          </Card>

          <Card className="mt-4">
            <CardHeader
              title="훈련 캘린더"
              hint={<><span className="md:hidden">훈련을 누르면 자세히 보고 날짜를 옮길 수 있어요</span><span className="hidden md:inline">카드를 끌어서 다른 날로 옮기세요 · 빈 날에 마우스를 올리면 + 버튼</span></>}
              action={
                <div className="hidden gap-3 sm:flex">
                  {(['done', 'partial', 'missed'] as const).map((s) => (
                    <span key={s} className="inline-flex items-center gap-1 text-[11px] text-muted">
                      <span className={cn('size-2 rounded-full', s === 'done' ? 'bg-good' : s === 'partial' ? 'bg-warn' : 'bg-bad')} />
                      {s === 'done' ? '완료' : s === 'partial' ? '일부' : '놓침'}
                    </span>
                  ))}
                </div>
              }
            />
            <CardBody>
              <div className="hidden md:block">
                <PlanCalendar data={data} onOpen={setOpen} />
              </div>
              <div className="md:hidden">
                <PlanAgenda data={data} onOpen={setOpen} />
              </div>
            </CardBody>
          </Card>

          <Card className="mt-4">
            <CardHeader title="계획 대비 실제 거리" action={<div className="flex gap-3"><LegendKey color="color-mix(in srgb, var(--text-subtle) 50%, transparent)" label="계획" /><LegendKey color="var(--accent)" label="실제" /></div>} />
            <CardBody>
              <WeeklyCompare data={data} />
            </CardBody>
          </Card>
        </>
      )}

      <PlanAiDialog open={ai} onClose={() => setAi(false)} />
      <PlanSettingsDialog key={settings ? 'open' : 'closed'} data={data} open={settings} onClose={() => setSettings(false)} />
      <WeekAdjustDialog req={weekReq} onClose={() => setWeekReq(null)} />
      <WorkoutDialog key={open?.id ?? 'none'} w={open} onClose={() => setOpen(null)} paces={progress?.paces} racePace={racePace} />
    </>
  )
}

export function PlanPage() {
  const { data, isLoading } = useActivePlan()
  const [wizard, setWizard] = useState(false)
  if (isLoading) return <div className="h-96 animate-pulse rounded-card bg-surface" />
  if (data && !wizard) return <ActiveView data={data} />
  return (
    <>
      <PageHeader
        title="훈련 계획"
        subtitle="목표 레이스에 맞춘 주기화 플랜을 만들어요"
        actions={data ? <Button variant="ghost" onClick={() => setWizard(false)}>현재 플랜으로</Button> : undefined}
      />
      {!data && (
        <div className="mx-auto mb-6 max-w-3xl rounded-2xl border border-dashed p-5 text-sm leading-relaxed text-muted">
          <div className="mb-1 flex items-center gap-2 font-semibold text-text">
            <Plus className="size-4 text-accent" /> 이렇게 만들어져요
          </div>
          현재 체력(VDOT)과 최근 주간 거리에서 출발해 주당 10% 이내로 늘리고, 4주마다 회복 주를 넣어요. 강화·실전 단계에서는 역치·인터벌·레이스 페이스 훈련이 들어가고,
          레이스 전에는 거리별로 1–3주 테이퍼를 합니다. 만든 뒤에도 드래그로 자유롭게 옮길 수 있어요.
        </div>
      )}
      <PlanWizard onCancel={data ? () => setWizard(false) : undefined} />
    </>
  )
}

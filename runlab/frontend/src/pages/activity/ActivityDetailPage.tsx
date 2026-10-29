import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { format } from 'date-fns'
import { ko } from 'date-fns/locale'
import { ArrowLeft, ChevronLeft, ChevronRight, CloudSun, Droplets, Moon, Thermometer, Wind } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useActivity, usePatchActivity, useStream, type Activity, type Wellness } from '@/api/activities'
import { useGear } from '@/api/life'
import { ShoeSwatch } from '@/components/gear/ShoeSwatch'
import { RunTypePicker } from '@/components/runtype/RunTypePicker'
import { fmtDuration, fmtHours, fmtKm, fmtNum, fmtPace, sportLabel } from '@/lib/format'
import { cn } from '@/lib/utils'
import { RouteMap } from './RouteMap'
import { StreamCharts } from './StreamCharts'
import { LapsTable } from './LapsTable'
import { ZoneBars } from './ZoneBars'
import { ActivityAiCard } from './ActivityAiCard'
import { ReflectionCard } from '@/components/coach/ReflectionCard'

function Stat({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium text-subtle">{label}</div>
      <div className="num mt-1 truncate text-xl font-bold tracking-tight sm:text-2xl">
        {value}
        {unit && <span className="ml-0.5 text-xs font-medium text-subtle">{unit}</span>}
      </div>
      {sub && <div className="num mt-0.5 text-[11px] text-subtle">{sub}</div>}
    </div>
  )
}

function WeatherChips({ w }: { w: NonNullable<Activity['weather']> }) {
  if (w.temp_c == null) return null
  const chips = [
    { icon: Thermometer, text: `${w.temp_c.toFixed(0)}°C${w.feels_like_c != null ? ` (체감 ${w.feels_like_c.toFixed(0)}°)` : ''}` },
    w.humidity_pct != null && { icon: Droplets, text: `습도 ${Math.round(w.humidity_pct)}%` },
    w.wind_mps != null && { icon: Wind, text: `${w.wind_mps.toFixed(1)} m/s` },
  ].filter(Boolean) as { icon: typeof CloudSun; text: string }[]
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <span key={c.text} className="inline-flex h-7 items-center gap-1.5 rounded-full border bg-surface-2/70 px-2.5 text-xs text-muted">
          <c.icon className="size-3.5" />
          {c.text}
        </span>
      ))}
    </div>
  )
}

function NightBefore({ w }: { w: Wellness }) {
  const items = [
    { label: '수면', value: w.sleep_total_s ? fmtHours(w.sleep_total_s) : '—', sub: w.sleep_score ? `점수 ${w.sleep_score}` : undefined },
    { label: 'HRV', value: w.hrv_avg ? `${Math.round(w.hrv_avg)} ms` : '—', sub: w.hrv_status?.toLowerCase() },
    { label: '안정 심박', value: w.resting_hr ? `${w.resting_hr} bpm` : '—' },
    { label: '훈련 준비도', value: w.training_readiness ? `${Math.round(w.training_readiness)}` : '—' },
  ]
  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((i) => (
        <div key={i.label} className="rounded-xl bg-surface-2/70 px-3 py-2.5">
          <div className="text-[11px] text-subtle">{i.label}</div>
          <div className="num mt-0.5 text-sm font-semibold">{i.value}</div>
          {i.sub && <div className="text-[10px] text-subtle">{i.sub}</div>}
        </div>
      ))}
    </div>
  )
}

function ShoePicker({ a, onChange }: { a: Activity; onChange: (id: number | null) => void }) {
  const { data: gear } = useGear()
  if (!gear?.length) return null
  return (
    <div>
      <div className="mb-2 text-xs font-medium text-muted">신발</div>
      <div className="flex flex-wrap gap-1.5">
        {gear.filter((g) => !g.retired || g.id === a.shoe_id).map((g) => (
          <button
            key={g.id}
            onClick={() => onChange(a.shoe_id === g.id ? null : g.id)}
            className={cn('inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium', a.shoe_id === g.id ? 'bg-text text-bg' : 'bg-surface-2 text-muted hover:text-text')}
          >
            <ShoeSwatch color={g.color} color2={g.color2} className="size-2.5" />
            {g.name}
          </button>
        ))}
      </div>
    </div>
  )
}

function RpeNote({ a }: { a: Activity }) {
  const patch = usePatchActivity(a.id)
  const [note, setNote] = useState(a.note ?? '')
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-xs font-medium text-muted">체감 강도 (RPE)</span>
          <span className="text-[11px] text-subtle">1 매우 쉬움 · 10 최대</span>
        </div>
        <div className="grid grid-cols-10 gap-1">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
            <button
              key={v}
              onClick={() => patch.mutate({ rpe: a.rpe === v ? null : v })}
              className={cn(
                'num h-8 rounded-md text-xs font-semibold transition-colors',
                a.rpe === v ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-muted hover:bg-surface-3 hover:text-text',
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      <ShoePicker a={a} onChange={(shoe_id) => patch.mutate({ shoe_id })} />
      <div>
        <div className="mb-2 text-xs font-medium text-muted">메모</div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== (a.note ?? '') && patch.mutate({ note: note || null })}
          rows={3}
          placeholder="컨디션, 코스, 느낀 점…"
          className="w-full resize-none rounded-lg border bg-surface-2/60 px-3 py-2 text-sm outline-none placeholder:text-subtle focus:border-accent focus:ring-3 focus:ring-accent/15"
        />
        <div className="h-4 text-[11px] text-subtle">{patch.isPending ? '저장 중…' : patch.isSuccess ? '저장됨' : ''}</div>
      </div>
    </div>
  )
}

export function ActivityDetailPage() {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const { data, isLoading, error } = useActivity(id)
  const { data: stream } = useStream(id)
  const typePatch = usePatchActivity(id)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return
      if (e.key === 'ArrowLeft' && data?.prev_id) navigate(`/activities/${data.prev_id}`)
      if (e.key === 'ArrowRight' && data?.next_id) navigate(`/activities/${data.next_id}`)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [data, navigate])

  if (isLoading) return <div className="h-96 animate-pulse rounded-card bg-surface" />
  if (error || !data) return <p className="text-sm text-bad">{error?.message ?? '활동을 불러오지 못했어요'}</p>

  const a = data.activity
  const d = new Date(a.start_time)
  const moving = a.moving_time_s ?? a.duration_s

  return (
    <>
      <div className="mb-5 flex items-center gap-2">
        <Link to="/activities" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
          <ArrowLeft className="size-4" />
          활동
        </Link>
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" size="icon" disabled={!data.prev_id} onClick={() => navigate(`/activities/${data.prev_id}`)} title="이전 활동 (←)">
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="icon" disabled={!data.next_id} onClick={() => navigate(`/activities/${data.next_id}`)} title="다음 활동 (→)">
            <ChevronRight />
          </Button>
        </div>
      </div>

      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-xs text-subtle">
            <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent">{sportLabel(a.sport)}</span>
            <RunTypePicker type={a.run_type} source={a.run_type_source} confidence={a.run_type_confidence} reason={a.run_type_reason} onChange={(t) => typePatch.mutate({ run_type: t })} />
            {format(d, 'yyyy년 M월 d일 EEEE HH:mm', { locale: ko })}
          </div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">{a.name || '러닝'}</h1>
        </div>
        {a.weather && <WeatherChips w={a.weather} />}
      </header>

      <Card className="mb-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 p-5 sm:grid-cols-4 lg:grid-cols-8">
          <Stat label="거리" value={fmtKm(a.distance_m)} unit="km" />
          <Stat label="이동 시간" value={fmtDuration(moving)} sub={a.duration_s - moving > 30 ? `경과 ${fmtDuration(a.duration_s)}` : undefined} />
          <Stat label="평균 페이스" value={fmtPace(a.avg_speed_mps)} unit="/km" />
          <Stat label="평균 심박" value={fmtNum(a.avg_hr)} unit="bpm" sub={a.max_hr ? `최대 ${a.max_hr}` : undefined} />
          <Stat label="케이던스" value={fmtNum(a.avg_cadence)} unit="spm" />
          <Stat label="상승 고도" value={fmtNum(a.elevation_gain_m)} unit="m" />
          <Stat label="유산소 TE" value={fmtNum(a.aerobic_te, 1)} sub={a.anaerobic_te ? `무산소 ${a.anaerobic_te.toFixed(1)}` : undefined} />
          <Stat label="칼로리" value={fmtNum(a.calories)} unit="kcal" sub={a.vo2max ? `VO2max ${a.vo2max}` : undefined} />
        </div>
      </Card>

      <ActivityAiCard key={a.id} id={a.id} />
      {a.sport.includes('run') && <ReflectionCard key={`r${a.id}`} activityId={a.id} className="mb-4" />}

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card className="h-[380px] overflow-hidden lg:col-span-2">{stream ? <RouteMap route={stream.route} /> : <div className="h-full animate-pulse bg-surface-2" />}</Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="심박 존" />
            <CardBody>
              <ZoneBars zones={data.hr_zones} />
            </CardBody>
          </Card>
          {data.wellness && (
            <Card>
              <CardHeader title="그날의 컨디션" action={<Moon className="size-4 text-subtle" />} />
              <CardBody>
                <NightBefore w={data.wellness} />
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      <Card className="mb-4">
        <CardHeader title="구간 분석" hint="지표별로 나눠 같은 축에 정렬" />
        <CardBody>{stream ? stream.n ? <StreamCharts stream={stream} /> : <p className="py-8 text-center text-sm text-subtle">초 단위 기록이 없는 활동이에요</p> : <div className="h-80 animate-pulse rounded-lg bg-surface-2" />}</CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader title={`랩 ${data.laps.length}개`} hint="막대가 길수록 빠른 랩 · 가장 빠른 랩 강조" />
          <div className="mt-3">{data.laps.length ? <LapsTable laps={data.laps} /> : <p className="px-5 pb-5 text-sm text-subtle">랩 정보가 없어요</p>}</div>
        </Card>
        <Card>
          <CardHeader title="내 기록" />
          <CardBody>
            <RpeNote key={a.id} a={a} />
          </CardBody>
        </Card>
      </div>
    </>
  )
}

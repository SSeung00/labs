import { useState } from 'react'
import { Link } from 'react-router'
import { BatteryMedium, ChevronDown, CircleAlert, Flag, Minus, TrendingDown, TrendingUp, Zap, type LucideIcon } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { useCondition, usePmc, useProfile, useWeeklyLoad, type Condition } from '@/api/analytics'
import { useActivePlan } from '@/api/planner'
import { FindingCards } from '@/components/insights/FindingCards'
import { cn } from '@/lib/utils'
import { ConditionChart, EasyShareChart, LegendKey, PmcChart, ZoneWeeksChart } from './charts'
import { FitnessGuide } from './FitnessGuide'
import { useNow } from '@/lib/useNow'

const RANGES = [
  { days: 90, label: '3개월' },
  { days: 180, label: '6개월' },
  { days: 365, label: '1년' },
]

const signed = (v: number | null | undefined, digits = 1) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}`)

function Signal({ title, icon: Icon, label, tone, lines, abbr }: { title: string; icon: LucideIcon; label: string; tone: string; lines: string[]; abbr: string }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center gap-2 text-xs font-medium text-muted">
        {title}
        <span className="num ml-auto text-[10px] text-subtle">{abbr}</span>
      </div>
      <div className={cn('mt-2 flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl', tone)}>
        <Icon className="size-5 shrink-0 sm:size-6" />
        {label}
      </div>
      {lines.map((l) => (
        <div key={l} className="num mt-1 text-xs text-subtle">
          {l}
        </div>
      ))}
    </Card>
  )
}

function Signals({ c }: { c: Condition }) {
  const fit = c.fitness
  const fat = c.fatigue
  const form = c.form
  const band = c.bands.find((b) => b.key === form.band)
  return (
    <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
      <Signal
        title="체력"
        icon={fit.state === 'up' ? TrendingUp : fit.state === 'down' ? TrendingDown : Minus}
        label={fit.state === 'up' && fit.rising_weeks >= 2 ? `${fit.rising_weeks}주째 ${fit.label}` : fit.label}
        tone={fit.state === 'up' ? 'text-good' : fit.state === 'down' ? 'text-warn' : 'text-text'}
        lines={[`지난주보다 ${signed(fit.delta_7d)}`, fit.from_28d != null ? `4주 전 ${fit.from_28d.toFixed(0)} → 지금 ${fit.value.toFixed(0)}` : '']}
        abbr={`CTL ${fit.value.toFixed(1)}`}
      />
      <Signal
        title="피로"
        icon={BatteryMedium}
        label={fat.label}
        tone={fat.state === 'low' ? 'text-good' : fat.state === 'mid' ? 'text-text' : 'text-bad'}
        lines={[`지난주보다 ${signed(fat.delta_7d)}`, fat.state === 'high' ? '쉬는 날을 챙기세요' : fat.state === 'mid' ? '훈련 중이면 정상적인 수준' : '몸이 회복된 상태']}
        abbr={`ATL ${fat.value.toFixed(1)}`}
      />
      <Signal
        title="컨디션"
        icon={form.state === 'race' ? Flag : form.state === 'rest' ? CircleAlert : Zap}
        label={form.label}
        tone={form.state === 'rest' ? 'text-bad' : 'text-good'}
        lines={[`${band?.label ?? ''} 구간`, form.readiness != null ? `준비도 ${form.readiness}점${form.has_checkin ? '' : ' (오늘 체크인 전)'}` : '']}
        abbr={`TSB ${signed(form.tsb, 0)}`}
      />
    </div>
  )
}

/** ACWR as "how fast load is growing": a bar with the safe range marked. */
function RampGauge({ ramp }: { ramp: Condition['ramp'] }) {
  const v = ramp.value
  const pos = v == null ? null : Math.min(100, (v / 2) * 100)
  const tone = ramp.state === 'ok' ? 'text-good' : ramp.state === 'fast' ? 'text-warn' : ramp.state === 'risk' ? 'text-bad' : 'text-muted'
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className={cn('text-xl font-bold', tone)}>{ramp.label}</span>
        {v != null && <span className="num text-xs text-subtle">최근 1주 부하가 4주 평균의 {v.toFixed(2)}배</span>}
      </div>
      <div className="relative mt-4 h-3 rounded-full bg-surface-3">
        <div className="absolute inset-y-0 rounded-full bg-good/45" style={{ left: '40%', width: '25%' }} />
        <div className="absolute inset-y-0 bg-warn/45" style={{ left: '65%', width: '10%' }} />
        <div className="absolute inset-y-0 right-0 rounded-r-full bg-bad/40" style={{ left: '75%' }} />
        {pos != null && <div className="absolute -top-1 h-5 w-1.5 -translate-x-1/2 rounded-full bg-text shadow" style={{ left: `${pos}%` }} />}
      </div>
      <div className="num relative mt-1.5 h-4 text-[10px] text-subtle">
        {[
          [0, '0'],
          [40, '0.8'],
          [65, '1.3'],
          [75, '1.5'],
          [100, '2+'],
        ].map(([p, l]) => (
          <span key={l} className="absolute -translate-x-1/2" style={{ left: `${p}%` }}>
            {l}
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">초록 구간(0.8–1.3)이 안전해요. 1.5를 넘으면 부상 위험이 커지니 거리를 늘리지 마세요.</p>
    </div>
  )
}

export function FitnessPage() {
  const now = useNow()
  const [days, setDays] = useState(180)
  const [project, setProject] = useState(true)
  const [details, setDetails] = useState(false)
  const { data: c } = useCondition()
  const { data: plan } = useActivePlan()
  const projectDays = plan && project ? Math.min(120, Math.max(0, Math.ceil((new Date(plan.plan.end_day).getTime() - now.getTime()) / 864e5) + 7)) : 0
  const { data: pmc } = usePmc(days, projectDays)
  const { data: weekly } = useWeeklyLoad(days > 200 ? 52 : 26)
  const { data: profile } = useProfile()
  const series = pmc?.series ?? []

  return (
    <>
      <PageHeader
        title="컨디션"
        subtitle="지금 몸 상태와 훈련량이 적절한지"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <FitnessGuide />
            <div className="flex rounded-lg border bg-surface-2 p-0.5">
              {RANGES.map((r) => (
                <button
                  key={r.days}
                  onClick={() => setDays(r.days)}
                  className={cn('h-8 rounded-md px-3 text-xs font-medium', days === r.days ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text')}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {c ? (
        <>
          <Card className={cn('mb-4 border-l-4 p-5', c.form.state === 'rest' ? 'border-l-bad' : c.form.state === 'race' ? 'border-l-form' : 'border-l-good')}>
            <p className="text-base font-semibold leading-relaxed sm:text-lg">{c.headline}</p>
            {c.advice.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm text-muted">
                {c.advice.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}
            {c.flags.length > 0 && (
              <ul className="mt-3 space-y-1">
                {c.flags.map((f) => (
                  <li key={f} className="flex items-start gap-1.5 text-xs text-warn">
                    <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> {f}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Signals c={c} />
          <Card className="mt-4">
            <CardHeader title="나에게서 찾은 패턴" hint="수면·체크인·가민 기록과 러닝 결과 사이에서 뚜렷한 관계만 골랐어요" />
            <CardBody>
              <FindingCards category="recovery" />
            </CardBody>
          </Card>
        </>
      ) : (
        <div className="h-48 animate-pulse rounded-card bg-surface" />
      )}

      <Card className="mt-4">
        <CardHeader
          title="체력과 피로"
          hint="배경색이 그날의 상태예요 · 초록 = 훈련 효과가 쌓이는 중, 빨강 = 과부하, 파랑 = 레이스 적기"
          action={
            <div className="flex flex-wrap items-center gap-3">
              {plan && (
                <button
                  onClick={() => setProject((v) => !v)}
                  className={cn('h-7 rounded-full border px-2.5 text-[11px] font-medium', project ? 'border-accent/40 bg-accent-soft text-accent' : 'text-muted')}
                >
                  계획대로 하면 {project ? '보기' : '숨김'}
                </button>
              )}
              <LegendKey color="var(--fitness)" label="체력" />
              <LegendKey color="var(--fatigue)" label="피로" />
              {projectDays > 0 && <LegendKey color="var(--text-subtle)" label="계획" dashed />}
            </div>
          }
        />
        <CardBody>{series.length && c ? <ConditionChart data={series} bands={c.bands} /> : <div className="h-[320px] animate-pulse rounded-lg bg-surface-2" />}</CardBody>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="부하가 늘어나는 속도" hint="너무 빨리 늘리면 다치기 쉬워요" />
          <CardBody>{c ? <RampGauge ramp={c.ramp} /> : <div className="h-24 animate-pulse rounded-lg bg-surface-2" />}</CardBody>
        </Card>
        <Card>
          <CardHeader title="쉬운 훈련 비율" hint={`주별 심박 Z1–2 시간 비율 · 목표 ${c?.easy_target_pct ?? 80}%`} action={<Link to="/settings" className="text-xs text-muted hover:text-text">존 설정</Link>} />
          <CardBody>{c ? <EasyShareChart data={c.intensity} target={c.easy_target_pct} /> : <div className="h-[200px] animate-pulse rounded-lg bg-surface-2" />}</CardBody>
        </Card>
      </div>

      <button
        onClick={() => setDetails((v) => !v)}
        className="mt-4 flex w-full flex-wrap items-center gap-x-2 rounded-card border bg-surface px-5 py-3.5 text-left shadow-card hover:bg-surface-2/60"
        aria-expanded={details}
      >
        <span className="text-sm font-semibold">자세한 지표</span>
        <span className="text-xs text-subtle">CTL·ATL·TSB 원래 차트 · 주별 존 분포</span>
        <ChevronDown className={cn('ml-auto size-4 text-muted transition-transform', details && 'rotate-180')} />
      </button>
      {details && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="퍼포먼스 관리 차트" hint="위: 체력 CTL·피로 ATL · 아래: 폼 TSB" />
            <CardBody>{series.length ? <PmcChart data={series} height={320} /> : null}</CardBody>
          </Card>
          <Card>
            <CardHeader title="주간 강도 분포" hint={profile ? `러닝만 · 심박 존 기준 · LTHR ${Math.round(profile.lthr)} bpm` : '심박 존 기준'} />
            <CardBody>
              {weekly && profile ? <ZoneWeeksChart data={weekly} zoneNames={profile.zone_names} height={260} /> : null}
              {profile && (
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                  {profile.zone_names.map((n, i) => (
                    <span key={n} className="inline-flex items-center gap-1.5 text-[11px] text-muted">
                      <span className="size-2 rounded-[3px]" style={{ background: `var(--z${i + 1})` }} />
                      {n}
                    </span>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </>
  )
}

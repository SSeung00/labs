import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { differenceInCalendarDays, format } from 'date-fns'
import { ko } from 'date-fns/locale'
import { Flag, Medal, Target, TrendingUp } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useBacktest, useProgress, usePRs, type GoalInfo, type PaceZones, type PR, type ProgressData } from '@/api/progress'
import { fmtDuration, fmtPaceSec, parseDuration, RACE_PRESETS } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useEfficiency } from '@/api/analytics'
import { HeatChart } from '@/components/insights/HeatChart'
import { EfficiencyChart, LegendKey } from '../fitness/charts'
import { GrowthChart } from './GrowthChart'
import { ScenarioCard } from './ScenarioCard'
import { useNow } from '@/lib/useNow'

const ZONE_INFO: { key: keyof PaceZones; name: string; desc: string; color: string }[] = [
  { key: 'E', name: '이지 (E)', desc: '대화 가능한 편한 속도 · 주간 거리의 대부분', color: 'var(--z2)' },
  { key: 'M', name: '마라톤 (M)', desc: '예상 풀코스 페이스', color: 'var(--z3)' },
  { key: 'T', name: '역치 (T)', desc: '편안하게 힘든 · 20–40분 템포', color: 'var(--z4)' },
  { key: 'I', name: '인터벌 (I)', desc: '3–5분 반복 · VO2max 자극', color: 'var(--z5)' },
  { key: 'R', name: '반복 (R)', desc: '200–400m 빠른 반복 · 스피드와 폼', color: 'var(--accent)' },
]

function Tile({ icon: Icon, label, value, unit, sub }: { icon: typeof Flag; label: string; value: string; unit?: string; sub?: React.ReactNode }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-xs font-medium text-muted">
        <Icon className="size-3.5 text-subtle" />
        {label}
      </div>
      <div className="num mt-2 text-3xl font-bold tracking-tight">
        {value}
        {unit && <span className="ml-1 text-sm font-medium text-subtle">{unit}</span>}
      </div>
      <div className="mt-1 min-h-4 text-xs text-subtle">{sub}</div>
    </Card>
  )
}

function GoalPanel({ goal, onChange, data }: { goal: { distance_m: number; time_s: number } | null; onChange: (g: { distance_m: number; time_s: number } | null) => void; data?: ProgressData }) {
  const now = useNow()
  const [dist, setDist] = useState(goal?.distance_m ?? 21097.5)
  const [text, setText] = useState(goal ? fmtDuration(goal.time_s) : '')
  const secs = parseDuration(text)
  const info: GoalInfo | null = data?.goal ?? null
  const predicted = data?.predictions.find((p) => p.distance_m === dist)?.consensus_s
  const yearAhead = data?.fit.curve?.at(-1)?.v

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {RACE_PRESETS.map((r) => (
          <button
            key={r.distance_m}
            onClick={() => {
              setDist(r.distance_m)
              if (secs) onChange({ distance_m: r.distance_m, time_s: secs })
            }}
            className={cn('h-8 rounded-full px-3 text-xs font-medium', dist === r.distance_m ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-muted hover:text-text')}
          >
            {r.label}
          </button>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          onChange(secs ? { distance_m: dist, time_s: secs } : null)
        }}
      >
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={predicted ? `예: ${fmtDuration(predicted - 120)}` : '예: 1:35:00'} className="num" />
        <button type="submit" className="h-10 shrink-0 rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg hover:brightness-110">
          확인
        </button>
      </form>
      {predicted && <p className="text-xs text-subtle">현재 예상 기록 {fmtDuration(predicted)} · 목표를 시간으로 입력하세요 (h:mm:ss)</p>}

      {info && (
        <div className="rounded-xl bg-surface-2/70 p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted">목표 VDOT</span>
            <span className="num text-lg font-bold">{info.vdot.toFixed(1)}</span>
          </div>
          <div className="mt-3 text-sm leading-relaxed">
            {info.already ? (
              <span className="text-good">이미 도달한 수준이에요. 레이스에서 증명할 차례!</span>
            ) : info.eta ? (
              <>
                현재 추세라면{' '}
                <b>{format(new Date(info.eta), 'yyyy년 M월', { locale: ko })}</b> 쯤 도달 예상
                <span className="text-subtle"> ({differenceInCalendarDays(new Date(info.eta), now)}일 후)</span>
                {info.eta_early && info.eta_late && (
                  <div className="mt-1 text-xs text-subtle">
                    80% 범위 {format(new Date(info.eta_early), 'yy.M')} – {format(new Date(info.eta_late), 'yy.M')}
                  </div>
                )}
              </>
            ) : (
              <span className="text-warn">
                지금 추세로는 1년 안에 어려워요{yearAhead ? ` (1년 후 예상 VDOT ${yearAhead.toFixed(1)})` : ''}. 훈련량을 늘리는 플랜이 필요해요.
              </span>
            )}
          </div>
          {info.probability_1y != null && !info.already && (
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-[11px] text-subtle">
                <span>1년 내 도달 가능성</span>
                <span className="num">{Math.round(info.probability_1y * 100)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-accent" style={{ width: `${info.probability_1y * 100}%` }} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PrRow({ pr }: { pr: PR }) {
  if (!pr.best) return null
  const h = pr.history
  const first = h[0]
  const gain = h.length > 1 ? first.time_s - pr.best.time_s : 0
  // Mini step-line of PR improvements (lower = faster), normalized to the row.
  const max = Math.max(...h.map((x) => x.time_s))
  const min = Math.min(...h.map((x) => x.time_s))
  const W = 96
  const H = 24
  const pts = h.map((x, i) => [h.length === 1 ? W : (i / (h.length - 1)) * W, max === min ? H / 2 : ((x.time_s - min) / (max - min)) * (H - 4) + 2])
  const path = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `H${p[0]}V${p[1]}`)).join('')
  return (
    <Link to={`/activities/${pr.best.activity_id}`} className="group grid grid-cols-[4rem_1fr_auto] items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-2 sm:grid-cols-[4.5rem_1fr_7rem_auto]">
      <span className="text-sm font-semibold">{pr.label}</span>
      <div className="min-w-0">
        <div className="num text-sm font-bold group-hover:text-accent">{fmtDuration(pr.best.time_s)}</div>
        <div className="truncate text-[11px] text-subtle">
          {format(new Date(pr.best.day), 'yy.M.d')} · {pr.best.name ?? '러닝'}
        </div>
      </div>
      <svg width={W} height={H} className="hidden sm:block" aria-hidden>
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
        <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3" fill="var(--accent)" />
      </svg>
      <span className="num text-right text-[11px] text-good">{gain > 0 ? `−${fmtDuration(gain)}` : ''}</span>
    </Link>
  )
}

export function ProgressPage() {
  const [goal, setGoal] = useState<{ distance_m: number; time_s: number } | null>(null)
  const { data } = useProgress(goal)
  const { data: prs } = usePRs()
  const { data: eff } = useEfficiency(365)
  const { data: bt } = useBacktest()
  const prByDist = useMemo(() => new Map((prs ?? []).map((p) => [p.distance_m, p])), [prs])
  const cur = data?.current
  const fit = data?.fit

  return (
    <>
      <PageHeader title="성장" subtitle="VDOT로 보는 체력 성장과 기록 예측" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile
          icon={TrendingUp}
          label="현재 VDOT"
          value={cur?.vdot?.toFixed(1) ?? '—'}
          sub={cur ? `${cur.vdot_sd ? `±${cur.vdot_sd} · ` : ''}심박 기반 ${cur.vdot_hr ?? '—'} · 레이스급 ${cur.vdot_perf ?? '—'}` : ''}
        />
        <Tile
          icon={Target}
          label="1년 후 예상 VDOT"
          value={fit?.curve?.at(-1)?.v.toFixed(1) ?? '—'}
          sub={fit?.curve?.length ? `80% 범위 ${fit.curve.at(-1)!.lo.toFixed(1)}–${fit.curve.at(-1)!.hi.toFixed(1)}` : fit?.reason}
        />
        <Tile icon={Flag} label="하프 예상 기록" value={data ? fmtDuration(data.predictions.find((p) => p.label === '하프')?.consensus_s) : '—'} sub={prByDist.get(21097.5)?.best ? `PR ${fmtDuration(prByDist.get(21097.5)!.best!.time_s)}` : ''} />
        <Tile
          icon={Medal}
          label="가민 VO2max"
          value={cur?.garmin_vo2max?.toFixed(0) ?? '—'}
          sub={cur?.garmin_gap != null && Math.abs(cur.garmin_gap) >= 5 ? `VDOT보다 ${Math.abs(cur.garmin_gap).toFixed(0)} ${cur.garmin_gap > 0 ? '높아요' : '낮아요'} · 최대 심박 설정을 확인해 보세요` : '참고용 · 기기 추정값'}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="성장 곡선"
            hint={data?.scenarios ? '파란 선·음영 = 지금 추세 그대로 · 주황 선 = 플랜 이행률별 시나리오' : '포화 지수 모델로 적합 · 음영은 부트스트랩 80% 범위'}
            action={
              <div className="hidden flex-wrap gap-3 sm:flex">
                <LegendKey color="var(--fitness)" label="체력 VDOT" />
                <LegendKey color="color-mix(in srgb, var(--fitness) 55%, transparent)" label="추세·예측" />
                <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                  <span className="size-2 rounded-full bg-accent" />
                  레이스급 노력
                </span>
                {data?.scenarios && <LegendKey color="var(--accent)" label="플랜 시나리오 (진할수록 이행률↑)" />}
              </div>
            }
          />
          <CardBody>
            {data ? <GrowthChart data={data} targetVdot={data.goal?.vdot} /> : <div className="h-[360px] animate-pulse rounded-lg bg-surface-2" />}
            <p className="mt-2 text-[11px] leading-relaxed text-subtle">
              체력은 러닝마다 조금씩 갱신해요. 대회는 크게, 포인트 훈련은 중간, 조깅은 작게 반영하고, 심박 기반 추정은 대회 기록과 비교해 보정해요
              {data?.current.hr_bias ? ` (지금 ${data.current.hr_bias > 0 ? '−' : '+'}${Math.abs(data.current.hr_bias).toFixed(1)})` : ''}. 진한 띠는 확실도 범위예요.
              {bt?.n && bt.median_new != null && bt.median_old != null
                ? ` 지난 대회 ${bt.n}개를 대회 전날 값으로 맞혀 보면 오차 중앙값 ±${bt.median_new.toFixed(1)} (예전 방식 ±${bt.median_old.toFixed(1)}).`
                : ''}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="목표 시뮬레이터" hint="목표 기록을 넣으면 도달 시점을 추정해요" />
          <CardBody>
            <GoalPanel goal={goal} onChange={setGoal} data={data} />
          </CardBody>
        </Card>
      </div>

      {data?.scenarios && (
        <div className="mt-4">
          <ScenarioCard data={data.scenarios} />
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="기록 예측" hint="VDOT · Riegel 공식의 중앙값 · 현재 체력 기준" />
          <div className="mt-2 overflow-x-auto">
            <table className="w-full whitespace-nowrap text-sm">
              <thead>
                <tr className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
                  <th className="py-2 pl-5 text-left">거리</th>
                  <th className="px-2 text-right">예상 기록</th>
                  <th className="px-2 text-right">페이스</th>
                  <th className="hidden px-2 text-right 2xl:table-cell">VDOT식</th>
                  <th className="hidden px-2 text-right 2xl:table-cell">Riegel</th>
                  <th className="py-2 pr-5 text-right">PR</th>
                </tr>
              </thead>
              <tbody>
                {data?.predictions.map((p) => {
                  const pr = prByDist.get(p.distance_m)?.best
                  return (
                    <tr key={p.label} className="border-t">
                      <td className="whitespace-nowrap py-3 pl-5 font-semibold">{p.label}</td>
                      <td className="num px-2 text-right text-base font-bold">{fmtDuration(p.consensus_s)}</td>
                      <td className="num px-2 text-right text-muted">{p.consensus_s ? fmtPaceSec(p.consensus_s / (p.distance_m / 1000)) : '—'}</td>
                      <td className="num hidden px-2 text-right text-subtle 2xl:table-cell">{fmtDuration(p.vdot_time_s)}</td>
                      <td className="num hidden px-2 text-right text-subtle 2xl:table-cell">{fmtDuration(p.riegel_time_s)}</td>
                      <td className={cn('num py-3 pr-5 text-right', pr && p.consensus_s && p.consensus_s < pr.time_s ? 'text-good' : 'text-subtle')}>{pr ? fmtDuration(pr.time_s) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="px-5 py-3 text-[11px] text-subtle">초록색 PR = 지금 체력이면 기록 경신이 가능한 거리</p>
        </Card>

        <Card>
          <CardHeader title="훈련 페이스" hint={cur?.vdot ? `VDOT ${cur.vdot.toFixed(1)} 기준 (Daniels)` : ''} />
          <CardBody className="space-y-2">
            {data?.paces &&
              ZONE_INFO.map((z) => (
                <div key={z.key} className="flex items-center gap-3 rounded-xl bg-surface-2/60 px-3 py-2.5">
                  <span className="h-8 w-1 rounded-full" style={{ background: z.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{z.name}</div>
                    <div className="truncate text-[11px] text-subtle">{z.desc}</div>
                  </div>
                  <div className="num text-right text-sm font-bold">
                    {z.key === 'M' ? fmtPaceSec((data.paces![z.key].slow + data.paces![z.key].fast) / 2) : `${fmtPaceSec(data.paces![z.key].slow)}–${fmtPaceSec(data.paces![z.key].fast)}`}
                    <span className="ml-0.5 text-[11px] font-medium text-subtle">/km</span>
                  </div>
                </div>
              ))}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="개인 기록 (PR)" hint="모든 러닝의 구간 최고 기록에서 자동 추출 · 그래프는 기록 단축 이력" />
        <CardBody className="grid gap-x-6 sm:grid-cols-2">{prs?.map((p) => <PrRow key={p.distance_m} pr={p} />)}</CardBody>
      </Card>

      <Card className="mt-4">
        <CardHeader
          title="유산소 효율 (EF)"
          hint="같은 심박에서 더 빨리 달릴수록 올라가요 · 경사 보정 속도 ÷ 평균 심박 · 점 크기 = 거리 · 선 = 최근 9회 중앙값"
        />
        <CardBody>{eff ? <EfficiencyChart data={eff} /> : <div className="h-[260px] animate-pulse rounded-lg bg-surface-2" />}</CardBody>
      </Card>

      <Card className="mt-4">
        <CardHeader title="더위의 영향" hint="러닝 시작 시점 기온별 유산소 효율(EF) 중앙값 · 여름 기록을 볼 때 참고하세요" />
        <CardBody>
          <HeatChart />
        </CardBody>
      </Card>
    </>
  )
}

import { useMemo } from 'react'
import { Award, Flame, Lock, Snowflake } from 'lucide-react'
import type { EChartsOption } from 'echarts'
import { useStats } from '@/api/el'
import type { Stats } from '@/api/types'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Progress, Stat } from '@/components/ui/controls'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageSkeleton } from '@/components/layout/PageSkeleton'
import { EChart } from '@/components/charts/EChart'
import { baseAxis, baseTooltip, useChartTheme } from '@/components/charts/theme'
import { band, cefr } from '@/lib/level'
import { cn } from '@/lib/utils'
import { LevelBars } from './placement/PlacementResultView'

// Categorical slots 1–4 of the validated reference palette (fixed order = fixed skill).
const SERIES = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500'],
}
const SKILLS = [
  ['reading', '읽기'],
  ['listening', '듣기'],
  ['speaking', '말하기'],
  ['writing', '쓰기'],
] as const
// Sequential blue ramp (light → dark = less → more minutes).
const HEAT_LIGHT = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95']
const HEAT_DARK = ['#104281', '#184f95', '#256abf', '#2a78d6', '#5598e7', '#86b6ef']

function LevelChart({ s }: { s: Stats }) {
  const t = useChartTheme()
  const colors = t.dark ? SERIES.dark : SERIES.light
  const option = useMemo<EChartsOption>(() => {
    const series = SKILLS.map(([k, label], i) => {
      const pts = s.level_history.filter((h) => h.skill === k).map((h) => [h.at, h.level])
      return {
        name: label,
        type: 'line' as const,
        data: pts,
        showSymbol: true,
        symbolSize: 8,
        lineStyle: { width: 2, color: colors[i] },
        itemStyle: { color: colors[i], borderColor: t.surface, borderWidth: 2 },
        endLabel: { show: pts.length > 0, formatter: label, color: t.muted, fontSize: 11 },
      }
    })
    return {
      color: colors,
      grid: { left: 36, right: 56, top: 28, bottom: 24 },
      legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 4, textStyle: { color: t.muted, fontSize: 11 } },
      tooltip: { ...baseTooltip(t), trigger: 'axis', valueFormatter: (v) => `${cefr(Number(v))} (${Number(v).toFixed(1)})` },
      xAxis: { type: 'time', ...baseAxis(t), splitLine: { show: false } },
      yAxis: { type: 'value', min: 1, max: 6, interval: 1, ...baseAxis(t), axisLabel: { ...baseAxis(t).axisLabel, formatter: (v: number) => ['', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'][v] } },
      series,
    }
  }, [s.level_history, t, colors])
  if (!s.level_history.length) return <p className="py-8 text-center text-sm text-subtle">레벨 진단을 하면 여기에 변화가 쌓여요.</p>
  return <EChart option={option} style={{ height: 240 }} />
}

function TrendChart({ s, field, label, unit }: { s: Stats; field: 'wpm' | 'errors_per_100w'; label: string; unit: string }) {
  const t = useChartTheme()
  const data = s.speaking_trend.filter((p) => p[field] != null).map((p) => [p.at, p[field]])
  const option = useMemo<EChartsOption>(
    () => ({
      grid: { left: 36, right: 12, top: 12, bottom: 24 },
      tooltip: { ...baseTooltip(t), trigger: 'axis', valueFormatter: (v) => `${v} ${unit}` },
      xAxis: { type: 'time', ...baseAxis(t), splitLine: { show: false } },
      yAxis: { type: 'value', ...baseAxis(t), min: 0 },
      series: [{ name: label, type: 'line', data, showSymbol: true, symbolSize: 8, lineStyle: { width: 2, color: t.accent }, itemStyle: { color: t.accent, borderColor: t.surface, borderWidth: 2 } }],
    }),
    [data, t, label, unit],
  )
  if (data.length < 2) return <p className="py-6 text-center text-xs text-subtle">대화를 2번 이상 하면 추이가 보여요.</p>
  return <EChart option={option} style={{ height: 160 }} />
}

function Heatmap({ s }: { s: Stats }) {
  const t = useChartTheme()
  const ramp = t.dark ? HEAT_DARK : HEAT_LIGHT
  const days = s.calendar
  // Columns are weeks (Mon-first); pad the first week.
  const first = new Date(days[0].day)
  const pad = (first.getDay() + 6) % 7
  const cells: (Stats['calendar'][number] | null)[] = [...Array(pad).fill(null), ...days]
  const weeks: (typeof cells)[] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  const step = (m: number) => (m <= 0 ? -1 : m < 15 ? 0 : m < 30 ? 1 : m < 60 ? 2 : m < 90 ? 3 : m < 150 ? 4 : 5)
  return (
    <div>
      <div className="flex gap-[3px] overflow-x-auto pb-1">
        {weeks.map((w, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {w.map((d, di) => {
              if (!d) return <span key={di} className="size-3.5" />
              const k = step(d.minutes)
              return (
                <span
                  key={di}
                  title={`${d.day} · ${Math.round(d.minutes)}분${d.frozen ? ' · 프리즈' : ''}${d.goal_met ? ' · 목표 달성' : ''}`}
                  className={cn('size-3.5 rounded-[3px]', d.frozen && 'ring-1 ring-inset ring-fitness')}
                  style={{ background: k < 0 ? 'var(--surface-3)' : ramp[k] }}
                />
              )
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-subtle">
        적음
        {ramp.map((c) => (
          <span key={c} className="size-3 rounded-[3px]" style={{ background: c }} />
        ))}
        많음 <span className="ml-3 inline-block size-3 rounded-[3px] ring-1 ring-inset ring-fitness" /> 프리즈
      </div>
    </div>
  )
}

const KIND_LABEL: Record<string, string> = { read: '읽기', listen: '듣기', external: '외부 듣기', talk: '말하기', review: '복습', drill: '드릴', placement: '진단', write: '쓰기' }

export function StatsPage() {
  const { data: s } = useStats()
  if (!s) return <PageSkeleton />
  const lv = s.levels
  const totalMin = Object.values(s.minutes_by_kind).reduce((a, b) => a + b, 0)
  const weekMin = Object.values(s.minutes_by_kind_7d).reduce((a, b) => a + b, 0)
  const daysLeft = Math.max(0, Math.round((new Date(s.target_date).getTime() - Date.now()) / 86400000))

  return (
    <div className="space-y-5">
      <PageHeader title="기록" subtitle={`목표일까지 ${daysLeft}일 · 마지막 진단 ${s.last_placement ? s.last_placement.slice(0, 10) : '없음'}`} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="종합 레벨" value={lv.overall_label} sub={lv.toefl.total != null ? `TOEFL 밴드 약 ${band(lv.toefl.total)}` : '진단 후 표시'} />
        <Stat label="연속 출석" value={`${s.streak.current}일`} icon={<Flame className="size-3.5 text-warn" />} sub={`최장 ${s.streak.longest}일 · 총 ${s.streak.days_total}일`} />
        <Stat label="최근 7일" value={`${Math.floor(weekMin / 60)}시간 ${Math.round(weekMin % 60)}분`} sub={`누적 ${Math.floor(totalMin / 60)}시간 ${Math.round(totalMin % 60)}분`} />
        <Stat label="프리즈" value={`${s.streak.freezes}개`} icon={<Snowflake className="size-3.5 text-fitness" />} sub="매주 2개 충전" />
      </div>

      <div className="grid gap-5 split:grid-cols-2">
        <Card>
          <CardHeader title="현재 레벨" hint="근거(진단·대화·퀴즈·첨삭·교재 점수)와 공부 시간으로 매일 다시 추정 · 예측은 계획 화면에서" />
          <CardBody className="space-y-4">
            <LevelBars levels={lv.levels} />
            <div className="grid grid-cols-4 gap-2 text-center">
              {SKILLS.map(([k, label]) => (
                <div key={k} className="rounded-xl border bg-surface-2/40 py-2">
                  <div className="text-[11px] text-subtle">TOEFL {label}</div>
                  <div className="num font-bold">{band(lv.toefl[k])}</div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="레벨 변화" />
          <CardBody>
            <LevelChart s={s} />
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-5 split:grid-cols-2">
        <Card>
          <CardHeader title="입력 시간" hint="읽기 + 듣기 + 외부 시청. C1~C2에는 1,000시간 이상의 이해 가능한 입력이 필요해요" />
          <CardBody className="space-y-2">
            <div className="num text-2xl font-bold">
              {s.input_hours}
              <span className="text-sm font-normal text-subtle"> / {s.input_goal_hours.toLocaleString()}시간</span>
            </div>
            <Progress value={s.input_hours / s.input_goal_hours} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="아는 단어 (추정 표제어 수)" hint={s.last_placement ? '자막 없는 드라마의 98%를 알아들으려면 약 9,500개' : '레벨 진단 전이라 기본값이에요'} />
          <CardBody className="space-y-2">
            <div className="num text-2xl font-bold">
              {s.known_words.toLocaleString()}
              <span className="text-sm font-normal text-subtle"> / {s.vocab_goal.toLocaleString()}</span>
            </div>
            <Progress value={s.known_words / s.vocab_goal} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="공부 달력" hint="최근 18주 · 하루 공부 시간" />
        <CardBody>
          <Heatmap s={s} />
          <div className="mt-4 flex flex-wrap gap-2">
            {Object.entries(s.minutes_by_kind)
              .sort((a, b) => b[1] - a[1])
              .map(([k, m]) => (
                <span key={k} className="num rounded-full border px-2.5 py-1 text-xs text-muted">
                  {KIND_LABEL[k] ?? k} {Math.round(m / 6) / 10}시간
                </span>
              ))}
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-5 split:grid-cols-2">
        <Card>
          <CardHeader title="말하기 속도" hint="대화별 wpm · 원어민 대화는 보통 140~170" />
          <CardBody>
            <TrendChart s={s} field="wpm" label="말하기 속도" unit="wpm" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="오류율" hint="대화별 100단어당 오류 수 · 낮을수록 좋아요" />
          <CardBody>
            <TrendChart s={s} field="errors_per_100w" label="오류율" unit="개/100단어" />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="배지" hint={`${s.badges.filter((b) => b.achieved_at).length} / ${s.badges.length}`} />
        <CardBody className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {s.badges.map((b) => (
            <div key={b.key} className={cn('flex items-center gap-2.5 rounded-xl border p-2.5', !b.achieved_at && 'opacity-45')}>
              <div className={cn('grid size-9 shrink-0 place-items-center rounded-lg', b.achieved_at ? 'bg-warn/15 text-warn' : 'bg-surface-3 text-subtle')}>
                {b.achieved_at ? <Award className="size-5" /> : <Lock className="size-4" />}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{b.title}</div>
                <div className="truncate text-[11px] text-subtle">{b.achieved_at ? b.achieved_at.slice(0, 10) : b.desc || '아직'}</div>
              </div>
            </div>
          ))}
        </CardBody>
      </Card>

      <div className="grid gap-5 split:grid-cols-2">
        <Card>
          <CardHeader title="자주 하는 실수" />
          <CardBody className="space-y-2">
            {s.mistakes.length === 0 && <p className="text-sm text-subtle">아직 없어요.</p>}
            {s.mistakes.map((m) => (
              <div key={m.id} className="text-sm">
                <div className="text-xs font-semibold text-muted">
                  {m.pattern} <span className="num text-subtle">×{m.count}</span>
                </div>
                <span className="text-bad line-through">{m.wrong}</span> → <span className="text-good">{m.right}</span>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="이번 달 AI 사용" hint={s.ai.provider === 'cli' ? `Claude 구독(CLI) · API 환산 $${s.ai.cli_month_equiv_usd.toFixed(2)}` : `API 상한 $${s.ai.budget_usd}`} />
          <CardBody className="space-y-2">
            <div className="num text-2xl font-bold">${s.ai.month_usd.toFixed(2)}</div>
            <Progress value={s.ai.month_usd / Math.max(0.01, s.ai.budget_usd)} color={s.ai.month_usd / s.ai.budget_usd > 0.85 ? 'var(--warn)' : undefined} />
            <div className="flex flex-wrap gap-2 pt-1">
              {Object.entries(s.ai.by_feature).map(([k, v]) => (
                <span key={k} className="num rounded-full border px-2 py-0.5 text-[11px] text-muted">
                  {k} ${v.usd.toFixed(2)} · {v.calls}회
                </span>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

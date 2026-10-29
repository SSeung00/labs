import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { addDays, format, isAfter, isSameDay, startOfWeek, subDays } from 'date-fns'
import { ko } from 'date-fns/locale'
import { ChevronDown, ChevronLeft, ChevronRight, Settings2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CheckinForm } from '@/components/checkin/CheckinForm'
import { useJournal, useMetricDefs, type MetricDef } from '@/api/analytics'
import { cn } from '@/lib/utils'
import { Explorer } from '@/components/insights/Explorer'
import { InjuryPanel } from './InjuryPanel'
import { MetricManager } from './MetricManager'
import { JournalAiCard } from './JournalAiCard'
import { useNow } from '@/lib/useNow'

const ISO = (d: Date) => format(d, 'yyyy-MM-dd')

function Spark({ values, color }: { values: (number | null)[]; color: string }) {
  const nums = values.filter((v): v is number => v != null)
  if (nums.length < 2) return <div className="h-10" />
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const W = 160
  const H = 40
  const pts = values
    .map((v, i) => (v == null ? null : [(i / (values.length - 1)) * W, H - 3 - ((v - min) / (max - min || 1)) * (H - 6)]))
    .filter(Boolean) as number[][]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-10 w-full" preserveAspectRatio="none" aria-hidden>
      <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={color} strokeWidth="1.75" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="1.6" fill={color} />
      ))}
    </svg>
  )
}

function Trend({ def, days, entries }: { def: MetricDef; days: string[]; entries: Record<string, Record<string, number | string>> }) {
  const series = days.map((d) => {
    const v = entries[d]?.[def.key]
    return typeof v === 'number' ? v : null
  })
  const nums = series.filter((v): v is number => v != null)
  const last7 = series.slice(-7).filter((v): v is number => v != null)
  const avg7 = last7.length ? last7.reduce((a, b) => a + b, 0) / last7.length : null
  const latest = [...series].reverse().find((v) => v != null)
  const color = def.polarity === 'lower_better' ? 'var(--fatigue)' : def.polarity === 'higher_better' ? 'var(--form)' : 'var(--fitness)'
  return (
    <div className="rounded-xl bg-surface-2/60 p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-muted">{def.label}</span>
        <span className="text-[10px] text-subtle">{nums.length}일 기록</span>
      </div>
      <div className="num mt-1 text-lg font-bold">
        {latest != null ? (def.kind === 'bool' ? (latest ? '예' : '아니오') : +latest.toFixed(1)) : '—'}
        {def.unit && latest != null && <span className="ml-0.5 text-xs font-medium text-subtle">{def.unit}</span>}
        {avg7 != null && def.kind !== 'bool' && <span className="ml-2 text-[11px] font-normal text-subtle">7일 평균 {avg7.toFixed(1)}</span>}
      </div>
      <Spark values={series} color={color} />
    </div>
  )
}

export function JournalPage() {
  const now = useNow()
  const [day, setDay] = useState(() => now)
  const [manage, setManage] = useState(false)
  // The old 인사이트 screen links here with ?compare=1.
  const [params] = useSearchParams()
  const [compare, setCompare] = useState(params.get('compare') === '1')
  const weekStart = startOfWeek(day, { weekStartsOn: 1 })
  const trendStart = subDays(now, 59)
  const { data: entries = {} } = useJournal(ISO(trendStart < weekStart ? trendStart : weekStart), ISO(now))
  const { data: defs = [] } = useMetricDefs()
  const trendKey = ISO(trendStart)
  const trendDays = useMemo(() => Array.from({ length: 60 }, (_, i) => ISO(addDays(new Date(trendKey), i))), [trendKey])
  const numeric = defs.filter((d) => d.kind !== 'text' && d.kind !== 'select')
  const iso = ISO(day)

  return (
    <>
      <PageHeader
        title="일지"
        subtitle="매일의 컨디션과 가민에 없는 기록"
        actions={
          <Button onClick={() => setManage(true)}>
            <Settings2 /> 지표 관리
          </Button>
        }
      />

      <JournalAiCard />

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="overflow-hidden lg:col-span-2">
          <div className="flex items-center gap-1 border-b px-3 py-3">
            <Button variant="ghost" size="icon" onClick={() => setDay(subDays(day, 7))} aria-label="이전 주">
              <ChevronLeft />
            </Button>
            <div className="grid flex-1 grid-cols-7 gap-1">
              {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((d) => {
                const future = isAfter(d, now)
                const filled = !!entries[ISO(d)] && Object.keys(entries[ISO(d)]).length > 0
                return (
                  <button
                    key={ISO(d)}
                    disabled={future}
                    onClick={() => setDay(d)}
                    className={cn(
                      'flex flex-col items-center rounded-lg py-1.5 text-xs transition-colors disabled:opacity-30',
                      isSameDay(d, day) ? 'bg-accent text-accent-fg' : 'hover:bg-surface-2',
                    )}
                  >
                    <span className={cn('text-[10px]', isSameDay(d, day) ? 'text-accent-fg/80' : 'text-subtle')}>{format(d, 'EEE', { locale: ko })}</span>
                    <span className="num font-semibold">{format(d, 'd')}</span>
                    <span className={cn('mt-0.5 size-1 rounded-full', filled ? (isSameDay(d, day) ? 'bg-accent-fg' : 'bg-good') : 'bg-transparent')} />
                  </button>
                )
              })}
            </div>
            <Button variant="ghost" size="icon" onClick={() => setDay(addDays(day, 7))} disabled={isAfter(addDays(weekStart, 7), now)} aria-label="다음 주">
              <ChevronRight />
            </Button>
          </div>
          <div className="px-5 pt-4 text-sm font-semibold">{format(day, 'M월 d일 EEEE', { locale: ko })}</div>
          <CheckinForm key={iso + JSON.stringify(entries[iso] ?? {})} day={iso} initial={entries[iso] ?? {}} />
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader title="최근 60일 추이" hint="초록 = 높을수록 좋은 지표 · 분홍 = 낮을수록 좋은 지표" />
          <CardBody className="grid gap-3 sm:grid-cols-2">
            {numeric.map((d) => <Trend key={d.key} def={d} days={trendDays} entries={entries} />)}
          </CardBody>
        </Card>
      </div>

      <div className="mt-4">
        <InjuryPanel />
      </div>

      <button
        onClick={() => setCompare((v) => !v)}
        className="mt-4 flex w-full flex-wrap items-center gap-x-2 rounded-card border bg-surface px-5 py-3.5 text-left shadow-card hover:bg-surface-2/60"
        aria-expanded={compare}
      >
        <span className="text-sm font-semibold">직접 비교해 보기</span>
        <span className="text-xs text-subtle">두 지표를 골라 관계를 봐요 · 그냥 궁금한 건 AI 코치에게 물어봐도 돼요</span>
        <ChevronDown className={cn('ml-auto size-4 text-muted transition-transform', compare && 'rotate-180')} />
      </button>
      {compare && (
        <Card className="mt-4">
          <CardBody className="pt-5">
            <Explorer />
          </CardBody>
        </Card>
      )}

      <MetricManager open={manage} onClose={() => setManage(false)} />
    </>
  )
}

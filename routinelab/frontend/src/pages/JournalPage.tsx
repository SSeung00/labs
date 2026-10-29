import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Check, ChevronLeft, ChevronRight, Loader2, NotebookPen } from 'lucide-react'
import type { DayLog, DayPayload } from '@/api/types'
import { useDay, useDayActions, useJournal } from '@/api/rl'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageSkeleton } from '@/components/layout/PageSkeleton'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { Textarea } from '@/components/ui/controls'
import { EmptyState } from '@/components/ui/empty-state'
import { SignalDots } from '@/components/SignalLight'
import { useOutbox } from '@/lib/outbox'
import { addDays, dayLabel, shortDay } from '@/lib/day'
import { cn } from '@/lib/utils'
import { ENERGY, MOODS } from './today/DayCards'

type Draft = Omit<DayLog, 'day'>

function Scale({ label, icons, value, onChange }: { label: string; icons: string[]; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex gap-1.5">
        {icons.map((m, i) => (
          <button
            key={m}
            type="button"
            onClick={() => onChange(value === i + 1 ? null : i + 1)}
            className={cn('grid size-11 place-items-center rounded-xl border text-[22px] transition-all', value === i + 1 ? 'border-accent bg-accent-soft' : 'opacity-55 grayscale hover:opacity-100 hover:grayscale-0')}
            aria-pressed={value === i + 1}
            aria-label={`${label} ${i + 1}`}
          >
            {m}
          </button>
        ))}
      </div>
    </div>
  )
}

function LogForm({ data }: { data: DayPayload }) {
  const { saveLog } = useDayActions(data.day)
  const pending = useOutbox((s) => s.ops.some((o) => o.kind === 'log' && o.day === data.day))
  const [draft, setDraft] = useState<Draft>(data.log)
  const timer = useRef<number | undefined>(undefined)
  const dirty = useRef<Partial<Draft>>({})

  const flushDraft = () => {
    window.clearTimeout(timer.current)
    if (Object.keys(dirty.current).length) {
      saveLog(dirty.current)
      dirty.current = {}
    }
  }
  useEffect(() => () => flushDraft(), []) // eslint-disable-line react-hooks/exhaustive-deps

  const change = (patch: Partial<Draft>, now = false) => {
    setDraft((d) => ({ ...d, ...patch }))
    dirty.current = { ...dirty.current, ...patch }
    window.clearTimeout(timer.current)
    if (now) flushDraft()
    else timer.current = window.setTimeout(flushDraft, 900)
  }
  const questions = [...new Set([...data.questions, ...Object.keys(draft.answers)])]

  return (
    <Card>
      <CardHeader
        title="오늘의 회고"
        hint="질문에 한두 줄씩만 답해도 쌓이면 일기가 돼요"
        action={<span className="flex items-center gap-1 text-xs text-subtle">{pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5 text-good" />}{pending ? '저장 중' : '저장됨'}</span>}
      />
      <CardBody className="space-y-5">
        <div className="flex flex-wrap gap-5">
          <Scale label="기분" icons={MOODS} value={draft.mood} onChange={(v) => change({ mood: v }, true)} />
          <Scale label="에너지" icons={ENERGY} value={draft.energy} onChange={(v) => change({ energy: v }, true)} />
        </div>
        <div className="grid max-w-sm grid-cols-2 gap-3">
          <div>
            <Label>잠 (시간)</Label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.5"
              min={0}
              max={24}
              value={draft.sleep_hours ?? ''}
              onChange={(e) => change({ sleep_hours: e.target.value === '' ? null : Number(e.target.value) })}
              onBlur={flushDraft}
              placeholder="7"
            />
          </div>
          <div>
            <Label>몸무게 (kg)</Label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={draft.weight ?? ''}
              onChange={(e) => change({ weight: e.target.value === '' ? null : Number(e.target.value) })}
              onBlur={flushDraft}
              placeholder="선택"
            />
          </div>
        </div>
        {questions.map((q) => (
          <div key={q}>
            <Label>{q}</Label>
            <Textarea
              rows={2}
              value={draft.answers[q] ?? ''}
              onChange={(e) => change({ answers: { ...draft.answers, [q]: e.target.value } })}
              onBlur={flushDraft}
            />
          </div>
        ))}
        <div>
          <Label>자유롭게</Label>
          <Textarea rows={4} value={draft.note} onChange={(e) => change({ note: e.target.value })} onBlur={flushDraft} placeholder="오늘 있었던 일, 떠오른 생각" />
        </div>
      </CardBody>
    </Card>
  )
}

function History() {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useJournal()
  const entries = data?.pages.flatMap((p) => p.entries) ?? []
  if (!data) return <PageSkeleton />
  if (!entries.length) {
    return (
      <Card>
        <EmptyState icon={NotebookPen} title="아직 회고가 없어요">
          매일 밤 기분과 한 줄을 남기면 여기에 일기처럼 쌓여요.
        </EmptyState>
      </Card>
    )
  }
  return (
    <div className="space-y-3">
      {entries.map((e) => {
        const answers = Object.entries(e.answers).filter(([, a]) => a.trim())
        return (
          <Card key={e.day}>
            <CardBody className="space-y-2 pt-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{shortDay(e.day)}</span>
                <SignalDots color={e.signal.color} size="xs" />
                {e.signal.total > 0 && <span className="text-xs text-subtle num">{e.signal.done}/{e.signal.total}</span>}
                <span className="ml-auto text-lg">
                  {e.mood ? MOODS[e.mood - 1] : ''}
                  {e.energy ? ENERGY[e.energy - 1] : ''}
                </span>
              </div>
              {answers.map(([q, a]) => (
                <p key={q} className="text-sm leading-relaxed">
                  <span className="text-xs text-subtle">{q}</span>
                  <br />
                  {a}
                </p>
              ))}
              {e.note && <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">{e.note}</p>}
              {e.done.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {e.done.map((d) => (
                    <span key={d} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
                      {d}
                    </span>
                  ))}
                </div>
              )}
              {(e.sleep_hours != null || e.weight != null) && (
                <p className="text-xs text-subtle num">
                  {e.sleep_hours != null && `잠 ${e.sleep_hours}시간`}
                  {e.sleep_hours != null && e.weight != null && ' · '}
                  {e.weight != null && `${e.weight}kg`}
                </p>
              )}
            </CardBody>
          </Card>
        )
      })}
      {hasNextPage && (
        <Button className="w-full" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
          {isFetchingNextPage && <Loader2 className="animate-spin" />}
          더 보기
        </Button>
      )}
    </div>
  )
}

export function JournalPage() {
  const [params, setParams] = useSearchParams()
  const picked = params.get('day') ?? undefined
  const { data } = useDay(picked)
  const go = (d: string) => setParams(d === data?.today ? {} : { day: d }, { replace: true })

  return (
    <div>
      <PageHeader title="회고" subtitle="하루를 돌아보는 몇 줄. 루틴을 조정할 힌트가 여기서 나와요." />
      <div className="grid gap-4 split:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] split:items-start">
        <div className="space-y-3">
          {data ? (
            <>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => go(addDays(data.day, -1))} aria-label="전날">
                  <ChevronLeft />
                </Button>
                <span className="text-base font-semibold">{dayLabel(data.day, data.today)}</span>
                <Button variant="ghost" size="icon" onClick={() => go(addDays(data.day, 1))} disabled={data.day >= data.today} aria-label="다음날">
                  <ChevronRight />
                </Button>
              </div>
              {/* Keyed by day: switching days saves the old one on unmount and starts fresh. */}
              <LogForm key={data.day} data={data} />
            </>
          ) : (
            <PageSkeleton />
          )}
        </div>
        <div>
          <h2 className="mb-3 mt-1 text-sm font-semibold text-muted">지난 회고</h2>
          <History />
        </div>
      </div>
    </div>
  )
}

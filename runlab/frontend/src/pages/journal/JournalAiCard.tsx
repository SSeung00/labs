import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { ArrowRight, Check, Loader2, MessageSquareText, Sparkles, X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useMetricDefs, useSaveJournal, type MetricDef } from '@/api/analytics'
import { useSaveInjury } from '@/api/life'
import { useAiUsage, useParseJournal, type ParsedJournal } from '@/api/coach'
import { cn } from '@/lib/utils'
import { SPOTS } from './spots'

const PARTS = [...new Set(SPOTS.map((s) => s.part))]
const SIDE = { left: '왼쪽', right: '오른쪽', center: '' } as const
const EXAMPLES = ['어제 6시간 반 잤고 좀 피곤함. 왼쪽 종아리가 살짝 땡김', '푹 잤고 컨디션 최고, 체중 68.2', '야근으로 스트레스 많음. 무릎 뒤가 계단에서 시큰']

function show(def: MetricDef | undefined, v: number | string | null | undefined) {
  if (v == null || v === '') return '—'
  if (!def) return String(v)
  if (def.kind === 'bool') return v ? '예' : '아니오'
  if (def.kind === 'scale') return `${v} / ${def.scale_max ?? 5}`
  return `${v}${def.unit ? ` ${def.unit}` : ''}`
}

function Preview({ p, defs, onDone }: { p: ParsedJournal; defs: MetricDef[]; onDone: (saved: boolean) => void }) {
  const save = useSaveJournal()
  const saveInj = useSaveInjury()
  const byKey = Object.fromEntries(defs.map((d) => [d.key, d]))
  const keys = Object.keys(p.values)
  const [skip, setSkip] = useState<Set<string>>(new Set())
  const [skipInj, setSkipInj] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (k: string) => setSkip((s) => (s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set([...s, k])))

  const commit = async () => {
    setBusy(true)
    setError(null)
    try {
      const values: Record<string, number | string> = {}
      for (const k of keys) {
        if (skip.has(k)) continue
        const v = p.values[k]
        // Free-text memo: keep what was already written that day.
        const prev = p.current[k]
        values[k] = byKey[k]?.kind === 'text' && typeof prev === 'string' && prev && prev !== v ? `${prev}\n${v}` : v
      }
      if (Object.keys(values).length) await save.mutateAsync({ day: p.day, values })
      for (const [i, inj] of p.injuries.entries()) {
        if (skipInj.has(i)) continue
        const spot = SPOTS.find((s) => s.part === inj.body_part && (s.side === inj.side || inj.side === 'center')) ?? SPOTS.find((s) => s.part === inj.body_part)
        await saveInj.mutateAsync({
          body_part: inj.body_part, side: spot?.side ?? inj.side, map_x: spot?.x ?? null, map_y: spot?.y ?? null,
          severity: inj.severity, start_day: p.day, note: inj.note || null,
        })
      }
      onDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  const nothing = !keys.length && !p.injuries.length
  return (
    <div className="mt-3 rounded-xl border bg-surface-2/40 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
          {format(parseISO(p.day), 'M월 d일 (EEE)', { locale: ko })}
        </span>
        <span className="text-muted">{p.summary}</span>
      </div>
      {nothing && <p className="py-2 text-sm text-subtle">채울 수 있는 항목을 찾지 못했어요. 조금 더 구체적으로 적어 주세요.</p>}
      <ul className="divide-y">
        {keys.map((k) => (
          <li key={k} className={cn('flex items-center gap-2 py-2 text-sm', skip.has(k) && 'opacity-40')}>
            <button onClick={() => toggle(k)} className={cn('grid size-5 shrink-0 place-items-center rounded-md border', !skip.has(k) && 'border-accent bg-accent text-accent-fg')} aria-label={skip.has(k) ? '포함' : '제외'}>
              {!skip.has(k) && <Check className="size-3.5" strokeWidth={3} />}
            </button>
            <span className="w-20 shrink-0 text-muted">{byKey[k]?.label ?? k}</span>
            <span className="num min-w-0 truncate text-subtle">{show(byKey[k], p.current[k])}</span>
            <ArrowRight className="size-3.5 shrink-0 text-subtle" />
            <span className="num min-w-0 flex-1 truncate font-semibold">{show(byKey[k], p.values[k])}</span>
          </li>
        ))}
        {p.injuries.map((inj, i) => (
          <li key={`inj-${i}`} className={cn('flex items-center gap-2 py-2 text-sm', skipInj.has(i) && 'opacity-40')}>
            <button
              onClick={() => setSkipInj((s) => (s.has(i) ? new Set([...s].filter((x) => x !== i)) : new Set([...s, i])))}
              className={cn('grid size-5 shrink-0 place-items-center rounded-md border', !skipInj.has(i) && 'border-bad bg-bad text-white')}
              aria-label={skipInj.has(i) ? '포함' : '제외'}
            >
              {!skipInj.has(i) && <Check className="size-3.5" strokeWidth={3} />}
            </button>
            <span className="w-20 shrink-0 text-muted">부상 기록</span>
            <span className="min-w-0 flex-1 truncate">
              <b>{SIDE[inj.side]} {inj.body_part}</b> · 강도 {inj.severity}/5 {inj.note && <span className="text-subtle">· {inj.note}</span>}
            </span>
          </li>
        ))}
      </ul>
      {p.unclear.length > 0 && <p className="mt-2 text-xs text-warn">확인 필요: {p.unclear.join(' · ')}</p>}
      {error && <p className="mt-2 text-xs text-bad">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => onDone(false)}>
          <X /> 취소
        </Button>
        {!nothing && (
          <Button size="sm" variant="primary" onClick={commit} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Check />} 저장
          </Button>
        )}
      </div>
    </div>
  )
}

/** Write the day in plain words; Claude fills the check-in fields and injury log, you confirm. */
export function JournalAiCard() {
  const { data: usage } = useAiUsage()
  const { data: defs = [] } = useMetricDefs()
  const parse = useParseJournal()
  const [text, setText] = useState('')
  const [saved, setSaved] = useState(false)

  if (usage && !usage.available) return null

  return (
    <Card className="mb-4 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <MessageSquareText className="size-4 text-accent" /> 말로 기록하기
        <span className="text-xs font-normal text-subtle">적으면 AI가 칸을 채워요 · 저장 전에 확인</span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setSaved(false)
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim() && parse.mutate({ text, injury_parts: PARTS })}
          rows={2}
          placeholder={EXAMPLES[0]}
          className="min-h-[60px] flex-1 resize-y rounded-lg border bg-surface-2/60 px-3 py-2 text-sm outline-none placeholder:text-subtle focus:border-accent"
        />
        <Button variant="primary" className="sm:h-auto" onClick={() => parse.mutate({ text, injury_parts: PARTS })} disabled={!text.trim() || parse.isPending}>
          {parse.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {parse.isPending ? '정리 중…' : '정리하기'}
        </Button>
      </div>
      {!text && !parse.data && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button key={ex} onClick={() => setText(ex)} className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] text-muted hover:text-text">
              {ex}
            </button>
          ))}
        </div>
      )}
      {parse.error && <p className="mt-2 rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-bad">{parse.error.message}</p>}
      {saved && <p className="mt-2 text-xs text-good">저장했어요.</p>}
      {parse.data && (
        <Preview
          key={JSON.stringify(parse.data)}
          p={parse.data}
          defs={defs}
          onDone={(ok) => {
            parse.reset()
            if (ok) {
              setText('')
              setSaved(true)
            }
          }}
        />
      )}
    </Card>
  )
}

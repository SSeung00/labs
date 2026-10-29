import { useState } from 'react'
import { Check, Loader2, Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useMetricDefs, useSaveJournal, type JournalValues, type MetricDef } from '@/api/analytics'
import { cn } from '@/lib/utils'

type Draft = Record<string, number | string | null>

const SCALE_HINTS: Record<string, [string, string]> = {
  sleep_quality: ['나쁨', '아주 좋음'],
  fatigue: ['개운함', '매우 피곤'],
  soreness: ['없음', '심함'],
  mood: ['처짐', '최고'],
  stress: ['편안', '매우 높음'],
}

function ScaleInput({ def, value, onChange }: { def: MetricDef; value: number | null; onChange: (v: number | null) => void }) {
  const lo = def.scale_min ?? 1
  const hi = def.scale_max ?? 5
  const steps = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
  const hint = SCALE_HINTS[def.key]
  // Color by polarity: the "good" end is green-ish, the "bad" end warm — always alongside the number.
  const tone = (v: number) => {
    const t = (v - lo) / Math.max(hi - lo, 1)
    const good = def.polarity === 'lower_better' ? 1 - t : def.polarity === 'higher_better' ? t : 0.5
    return good > 0.66 ? 'bg-good text-white' : good < 0.34 ? 'bg-warn text-black' : 'bg-accent text-accent-fg'
  }
  return (
    <div>
      <div className="flex gap-1.5">
        {steps.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(value === v ? null : v)}
            className={cn(
              'num h-10 flex-1 rounded-lg text-sm font-semibold transition-all',
              value === v ? cn(tone(v), 'scale-[1.04] shadow-sm') : 'bg-surface-2 text-muted hover:bg-surface-3 hover:text-text',
            )}
            aria-pressed={value === v}
          >
            {v}
          </button>
        ))}
      </div>
      {hint && (
        <div className="mt-1 flex justify-between text-[10px] text-subtle">
          <span>{hint[0]}</span>
          <span>{hint[1]}</span>
        </div>
      )}
    </div>
  )
}

function NumberInput({ def, value, onChange }: { def: MetricDef; value: number | null; onChange: (v: number | null) => void }) {
  const step = def.key === 'sleep_hours' ? 0.5 : def.unit === 'kg' ? 0.1 : 1
  const bump = (d: number) => onChange(Math.max(def.scale_min ?? 0, +((value ?? (def.key === 'sleep_hours' ? 7 : 0)) + d).toFixed(2)))
  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="secondary" size="icon" onClick={() => bump(-step)} aria-label="감소">
        <Minus />
      </Button>
      <div className="relative flex-1">
        <Input
          inputMode="decimal"
          value={value ?? ''}
          onChange={(e) => {
            const v = e.target.value.trim()
            onChange(v === '' ? null : Number(v))
          }}
          className="num text-center text-base font-semibold"
          placeholder="—"
        />
        {def.unit && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-subtle">{def.unit}</span>}
      </div>
      <Button type="button" variant="secondary" size="icon" onClick={() => bump(step)} aria-label="증가">
        <Plus />
      </Button>
    </div>
  )
}

export function MetricField({ def, value, onChange }: { def: MetricDef; value: number | string | null; onChange: (v: number | string | null) => void }) {
  if (def.kind === 'scale') return <ScaleInput def={def} value={(value as number) ?? null} onChange={onChange} />
  if (def.kind === 'number') return <NumberInput def={def} value={(value as number) ?? null} onChange={onChange} />
  if (def.kind === 'bool')
    return (
      <div className="flex gap-1.5">
        {[
          { v: 1, l: '예' },
          { v: 0, l: '아니오' },
        ].map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(value === o.v ? null : o.v)}
            className={cn('h-9 flex-1 rounded-lg text-sm font-medium', value === o.v ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-muted hover:text-text')}
          >
            {o.l}
          </button>
        ))}
      </div>
    )
  if (def.kind === 'select')
    return (
      <div className="flex flex-wrap gap-1.5">
        {(def.options ?? []).map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onChange(value === o ? null : o)}
            className={cn('h-8 rounded-full px-3 text-xs font-medium', value === o ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-muted hover:text-text')}
          >
            {o}
          </button>
        ))}
      </div>
    )
  return <Input value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || null)} placeholder="자유롭게 적어 주세요" />
}

/** The daily check-in. Saves only changed fields; clearing a field deletes it. */
export function CheckinForm({ day, initial, onSaved }: { day: string; initial: JournalValues; onSaved?: () => void }) {
  const { data: defs } = useMetricDefs()
  const save = useSaveJournal()
  const [draft, setDraft] = useState<Draft>(() => ({ ...initial }))

  const changed = Object.fromEntries(
    Object.entries(draft).filter(([k, v]) => (initial[k] ?? null) !== (v ?? null)),
  )

  if (!defs) return <div className="h-80 animate-pulse bg-surface-2" />

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate({ day, values: changed }, { onSuccess: () => onSaved?.() })
      }}
    >
      <div className="space-y-5 px-5 py-5">
        {defs.map((d) => (
          <div key={d.key}>
            <div className="mb-2 flex items-baseline justify-between">
              <label className="text-sm font-medium">{d.label}</label>
              {d.unit && d.kind !== 'number' && <span className="text-[11px] text-subtle">{d.unit}</span>}
            </div>
            <MetricField def={d} value={draft[d.key] ?? null} onChange={(v) => setDraft((s) => ({ ...s, [d.key]: v }))} />
          </div>
        ))}
      </div>
      <div className="sticky bottom-0 flex items-center gap-3 border-t bg-surface px-5 py-3">
        {save.error && <span className="text-xs text-bad">{save.error.message}</span>}
        <span className="text-xs text-subtle">{Object.keys(changed).length ? `${Object.keys(changed).length}개 변경` : '변경 없음'}</span>
        <Button type="submit" variant="primary" className="ml-auto" disabled={!Object.keys(changed).length || save.isPending}>
          {save.isPending ? <Loader2 className="animate-spin" /> : <Check />}
          저장
        </Button>
      </div>
    </form>
  )
}

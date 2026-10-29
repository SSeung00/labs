import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, RotateCcw, Sparkles } from 'lucide-react'
import { needsReview, RUN_TYPE, RUN_TYPES, type RunType } from '@/lib/runTypes'
import { cn } from '@/lib/utils'

export function RunTypeDot({ type, className }: { type: RunType | null | undefined; className?: string }) {
  if (!type) return <span className={cn('inline-block size-2.5 rounded-full border border-dashed border-border-strong', className)} />
  // Race is ink + ring (its secondary encoding); the rest are filled dots.
  return type === 'race' ? (
    <span className={cn('inline-block size-2.5 rounded-full bg-[var(--rt-race)] ring-[1.5px] ring-[var(--accent)] ring-offset-1 ring-offset-surface', className)} />
  ) : (
    <span className={cn('inline-block size-2.5 rounded-full', className)} style={{ background: RUN_TYPE[type].color }} />
  )
}

interface Props {
  type: RunType | null | undefined
  source: string | null | undefined
  confidence: number | null | undefined
  reason?: string | null
  onChange: (t: RunType | 'auto') => void
  size?: 'sm' | 'md'
}

/** Chip showing the training type; click to change. Ambiguous auto picks show a "?" until confirmed. */
export function RunTypePicker({ type, source, confidence, reason, onChange, size = 'sm' }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const review = needsReview(source, confidence)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={ref} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border font-medium transition-colors hover:border-border-strong',
          size === 'sm' ? 'h-6 px-2 text-[11px]' : 'h-8 px-3 text-xs',
          review ? 'border-dashed border-warn/60 bg-warn/10 text-text' : 'bg-surface-2/70 text-text',
        )}
        title={reason ?? undefined}
      >
        <RunTypeDot type={type} />
        {type ? RUN_TYPE[type].label : '미분류'}
        {review && <span className="font-bold text-warn">?</span>}
        <ChevronDown className="size-3 text-subtle" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-60 rounded-xl border border-border-strong bg-surface p-1 shadow-xl">
          {reason && (
            <div className="mb-1 flex items-start gap-1.5 rounded-lg bg-surface-2/70 px-2.5 py-2 text-[11px] leading-snug text-muted">
              <Sparkles className="mt-px size-3 shrink-0 text-accent" />
              <span>
                {source === 'manual' ? '직접 지정' : source === 'import' ? '기록표에서 가져옴' : '자동 분류'} · {reason}
              </span>
            </div>
          )}
          {RUN_TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                onChange(t.key)
                setOpen(false)
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-surface-2"
            >
              <RunTypeDot type={t.key} />
              <span className="flex-1">
                <span className="block text-sm font-medium">{t.label}</span>
                <span className="block text-[10px] text-subtle">{t.desc}</span>
              </span>
              {type === t.key && <Check className="size-4 text-accent" />}
            </button>
          ))}
          {source === 'manual' && (
            <button
              type="button"
              onClick={() => {
                onChange('auto')
                setOpen(false)
              }}
              className="mt-1 flex w-full items-center gap-2 rounded-lg border-t px-2.5 py-2 text-left text-xs text-muted hover:bg-surface-2"
            >
              <RotateCcw className="size-3.5" /> 자동 분류로 되돌리기
            </button>
          )}
        </div>
      )}
    </div>
  )
}

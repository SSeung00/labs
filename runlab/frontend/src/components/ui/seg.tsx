import { cn } from '@/lib/utils'

/** Segmented choice: a row of pill buttons, one selected. */
export function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={String(o.v)}
          type="button"
          onClick={() => onChange(o.v)}
          className={cn('h-9 min-w-10 rounded-lg px-3 text-sm font-medium transition-colors', value === o.v ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-muted hover:text-text')}
        >
          {o.l}
        </button>
      ))}
    </div>
  )
}

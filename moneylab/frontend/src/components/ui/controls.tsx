import { useId, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { GrowBar } from './motion'

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn('relative', className)}>
      <select
        className="h-10 w-full appearance-none rounded-lg border bg-surface-2/60 pl-3 pr-8 text-sm outline-none transition-colors hover:border-border-strong focus:border-accent focus:ring-3 focus:ring-accent/15"
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
    </div>
  )
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-lg border bg-surface-2/60 px-3 py-2 text-sm outline-none transition-colors placeholder:text-subtle hover:border-border-strong focus:border-accent focus:ring-3 focus:ring-accent/15',
        className,
      )}
      {...props}
    />
  )
}

/** Tabs with a sliding pill under the active option. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode }[]
  className?: string
  size?: 'sm' | 'md'
}) {
  const id = useId()
  return (
    <div className={cn('inline-flex max-w-full overflow-x-auto rounded-lg border bg-surface-2/60 p-0.5 [scrollbar-width:none]', className)} role="tablist">
      {options.map((o) => {
        const active = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'relative flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
              active ? 'text-text' : 'text-muted hover:text-text',
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-md bg-surface shadow-sm"
                transition={{ type: 'spring', stiffness: 520, damping: 38 }}
              />
            )}
            <span className="relative flex items-center gap-1.5">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function Progress({ value, color, className, marker }: { value: number; color?: string; className?: string; marker?: number | null }) {
  return <GrowBar value={value} color={color} className={className} marker={marker} />
}

export function Stat({
  label,
  value,
  sub,
  className,
  icon,
}: {
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  className?: string
  icon?: ReactNode
}) {
  return (
    <div className={cn('min-w-0 rounded-card border bg-surface px-4 py-3.5 shadow-card', className)}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
        {icon}
        {label}
      </div>
      <div className="num mt-1 truncate text-lg font-bold tracking-tight xl:text-[22px]">{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-subtle">{sub}</div>}
    </div>
  )
}

/** Small labelled number used inside cards. */
export function Kv({ label, value, strong, className }: { label: ReactNode; value: ReactNode; strong?: boolean; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className={cn('num', strong && 'font-semibold')}>{value}</dd>
    </div>
  )
}

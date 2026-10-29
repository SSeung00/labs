import clsx from 'clsx'
import { X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

export function ToolButton({
  title,
  active,
  disabled,
  onClick,
  children,
  className,
}: {
  title: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={clsx(
        'inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-1.5 text-[13px] text-ink transition-colors',
        'hover:bg-hover disabled:pointer-events-none disabled:opacity-35',
        active && 'bg-active text-accent-strong',
        className,
      )}
    >
      {children}
    </button>
  )
}

export const Sep = () => <div className="mx-1 h-6 w-px shrink-0 bg-line" />

export function Popover({
  trigger,
  children,
  align = 'left',
  title,
}: {
  trigger: (open: boolean, toggle: () => void) => ReactNode
  children: (close: () => void) => ReactNode
  align?: 'left' | 'right'
  title?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div className="relative" ref={ref} title={title}>
      {trigger(open, () => setOpen((o) => !o))}
      {open && (
        <div
          className={clsx(
            'absolute top-full z-50 mt-1 rounded-lg border border-line bg-panel p-2 shadow-pop',
            align === 'right' ? 'right-0' : 'left-0',
          )}
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault()
          }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function Dialog({
  title,
  onClose,
  children,
  footer,
  width = 440,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="flex max-h-[90vh] w-full flex-col rounded-xl border border-line bg-panel shadow-pop"
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
          <button className="rounded p-1 text-muted hover:bg-hover" onClick={onClose} aria-label="닫기">
            <X size={16} />
          </button>
        </div>
        <div className="overflow-auto px-4 py-3">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-4 py-2.5">{footer}</div>}
      </div>
    </div>
  )
}

export function Btn({
  children,
  onClick,
  primary,
  disabled,
  className,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  primary?: boolean
  disabled?: boolean
  className?: string
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors disabled:opacity-40',
        primary ? 'bg-accent text-white hover:bg-accent-strong' : 'border border-line bg-panel text-ink hover:bg-hover',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function NumField({
  label,
  value,
  onChange,
  unit,
  step = 0.1,
  min,
  max,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  unit?: string
  step?: number
  min?: number
  max?: number
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-[13px] text-ink">
      <span className="text-muted">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          className="h-7 w-24 rounded-md border border-line bg-field px-2 text-right tabular-nums outline-none focus:border-accent"
          value={Number.isFinite(value) ? value : 0}
          step={step}
          min={min}
          max={max}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {unit && <span className="w-6 text-[12px] text-muted">{unit}</span>}
      </span>
    </label>
  )
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-[13px] text-ink">
      <span className="text-muted">{label}</span>
      <select
        className="h-7 w-[8.5rem] rounded-md border border-line bg-field px-1.5 outline-none focus:border-accent"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function Toast({ message, kind = 'info' }: { message: string; kind?: 'info' | 'error' }) {
  return (
    <div
      className={clsx(
        'pointer-events-none fixed bottom-10 left-1/2 z-[200] -translate-x-1/2 rounded-lg px-4 py-2 text-[13px] text-white shadow-pop',
        kind === 'error' ? 'bg-bad' : 'bg-ink/90',
      )}
    >
      {message}
    </div>
  )
}

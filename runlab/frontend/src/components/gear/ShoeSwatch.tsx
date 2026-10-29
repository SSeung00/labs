import { cn } from '@/lib/utils'

/** A shoe's colourway: one colour, or two split diagonally. */
export function ShoeSwatch({ color, color2, className }: { color: string | null; color2?: string | null; className?: string }) {
  const c1 = color ?? 'var(--accent)'
  return (
    <span
      className={cn('inline-block size-3 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/15', className)}
      style={{ background: color2 ? `linear-gradient(135deg, ${c1} 0 50%, ${color2} 50% 100%)` : c1 }}
    />
  )
}

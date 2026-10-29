import { format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { ArrowRight } from 'lucide-react'
import type { PlanChange } from '@/api/planner'
import { cn } from '@/lib/utils'

const day = (iso: string) => format(parseISO(iso), 'M/d (EEE)', { locale: ko })

/** Before → after list for previewing plan changes. */
export function ChangeList({ changes }: { changes: PlanChange[] }) {
  return (
    <ul className="divide-y rounded-xl border">
      {changes.map((c, i) => (
        <li key={i} className="px-3 py-2.5 text-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="num w-20 shrink-0 text-muted">{day(c.day)}</span>
            <span className={cn(!c.before && 'text-subtle')}>{c.before ? `${c.before.title}` : '빈 날'}</span>
            <ArrowRight className="size-3.5 text-subtle" />
            <span className={cn('font-semibold', c.op === 'race' ? 'text-accent' : '')}>
              {c.after.title}
              {c.after.km > 0 && c.op !== 'race' && !c.after.title.includes('km') ? ` ${c.after.km}km` : ''}
            </span>
          </div>
          <div className="ml-[5.4rem] text-xs text-subtle">{c.reason}</div>
        </li>
      ))}
    </ul>
  )
}

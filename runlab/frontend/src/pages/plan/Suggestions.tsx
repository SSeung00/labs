import { Lightbulb, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useApplySuggestion, useSuggestions } from '@/api/planner'
import { cn } from '@/lib/utils'

/** Condition-based nudges; nothing changes until the user picks an action. */
export function Suggestions({ className }: { className?: string }) {
  const { data } = useSuggestions()
  const apply = useApplySuggestion()
  if (!data?.length) return null
  return (
    <div className={cn('space-y-2', className)}>
      {data.map((s) => (
        <div
          key={`${s.workout_id}-${s.title}`}
          className={cn(
            'flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3',
            s.severity === 'high' ? 'border-bad/30 bg-bad/8' : s.severity === 'medium' ? 'border-warn/30 bg-warn/8' : 'bg-surface-2/60',
          )}
        >
          <Lightbulb className={cn('size-4 shrink-0', s.severity === 'high' ? 'text-bad' : s.severity === 'medium' ? 'text-warn' : 'text-muted')} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{s.title}</div>
            <div className="text-xs text-subtle">{s.reason}</div>
          </div>
          <div className="flex gap-1.5">
            {s.actions.map((a) => (
              <Button key={a.type} size="sm" onClick={() => apply.mutate({ workout_id: s.workout_id, type: a.type })} disabled={apply.isPending}>
                {apply.isPending && apply.variables?.type === a.type && <Loader2 className="animate-spin" />}
                {a.label}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

import type { PaceZones } from '@/api/progress'
import type { Step } from '@/api/planner'
import { paceText, PACE_NAME } from './workoutMeta'

function amount(s: Step) {
  if (s.distance_m) return s.distance_m >= 1000 ? `${+(s.distance_m / 1000).toFixed(1)}km` : `${Math.round(s.distance_m)}m`
  if (s.duration_s) return s.duration_s >= 120 ? `${Math.round(s.duration_s / 60)}분` : `${s.duration_s}초`
  return ''
}

const STEP_LABEL: Record<Step['type'], string> = { warmup: '워밍업', run: '달리기', recover: '회복', cooldown: '쿨다운', repeat: '반복' }

/** Readable workout structure with live paces. */
export function StepList({ steps, paces, racePace }: { steps: Step[]; paces?: PaceZones | null; racePace?: number }) {
  return (
    <ol className="space-y-1.5">
      {steps.map((s, i) =>
        s.type === 'repeat' ? (
          <li key={i} className="rounded-xl border border-dashed border-border-strong p-2.5">
            <div className="mb-1.5 text-xs font-semibold text-muted">{s.reps}회 반복</div>
            <StepList steps={s.steps ?? []} paces={paces} racePace={racePace} />
          </li>
        ) : (
          <li key={i} className="flex items-center gap-3 rounded-lg bg-surface-2/70 px-3 py-2 text-sm">
            <span className="w-12 shrink-0 text-xs text-subtle">{STEP_LABEL[s.type]}</span>
            <span className="num font-semibold">{amount(s)}</span>
            {s.note && <span className="text-xs text-subtle">{s.note}</span>}
            <span className="num ml-auto text-xs text-muted">
              {s.pace && <b className="mr-1 font-semibold text-text">{PACE_NAME[s.pace]}</b>}
              {paceText(s.pace, paces, racePace)}
            </span>
          </li>
        ),
      )}
    </ol>
  )
}

import type { InjuryRec } from '@/api/life'
import { cn } from '@/lib/utils'
import { SPOTS, type Spot } from './spots'
import { useNow } from '@/lib/useNow'

function Figure() {
  // Stylized silhouette: soft rounded shapes, no anatomy detail.
  return (
    <g fill="var(--surface-3)" stroke="var(--border-strong)" strokeWidth="1">
      <circle cx="60" cy="18" r="13" />
      <rect x="38" y="34" width="44" height="70" rx="16" />
      <rect x="22" y="38" width="12" height="62" rx="6" />
      <rect x="86" y="38" width="12" height="62" rx="6" />
      <rect x="38" y="96" width="44" height="26" rx="12" />
      <rect x="38" y="112" width="19" height="64" rx="9" />
      <rect x="63" y="112" width="19" height="64" rx="9" />
      <rect x="40" y="172" width="16" height="64" rx="8" />
      <rect x="64" y="172" width="16" height="64" rx="8" />
      <ellipse cx="46" cy="246" rx="10" ry="6" />
      <ellipse cx="74" cy="246" rx="10" ry="6" />
    </g>
  )
}

export function BodyMap({ injuries, onPick, selected }: { injuries: InjuryRec[]; onPick: (s: Spot) => void; selected?: { part: string; side: string } | null }) {
  const now = useNow()
  const today = now.toISOString().slice(0, 10)
  const state = (s: Spot) => {
    const hits = injuries.filter((i) => i.body_part === s.part && (i.side ?? 'center') === s.side)
    const active = hits.find((i) => i.start_day <= today && (!i.end_day || i.end_day >= today))
    return { active, past: hits.length > 0 && !active }
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      {(['front', 'back'] as const).map((view) => (
        <figure key={view} className="flex flex-col items-center">
          <svg viewBox="0 0 120 260" className="h-72 w-auto" role="img" aria-label={view === 'front' ? '앞면' : '뒷면'}>
            <Figure />
            {SPOTS.filter((s) => s.view === view).map((s) => {
              const st = state(s)
              const isSel = selected?.part === s.part && selected.side === s.side
              return (
                <g key={`${s.part}-${s.side}`} className="cursor-pointer" onClick={() => onPick(s)}>
                  <title>{`${s.side === 'left' ? '왼쪽 ' : s.side === 'right' ? '오른쪽 ' : ''}${s.part}`}</title>
                  {st.active && <circle cx={s.x} cy={s.y} r="9" fill="var(--bad)" opacity="0.25" className="animate-ping origin-center [transform-box:fill-box]" />}
                  <circle
                    cx={s.x}
                    cy={s.y}
                    r={st.active ? 5.5 : 4.5}
                    className={cn('transition-all', !st.active && !isSel && 'hover:[r:6]')}
                    fill={st.active ? 'var(--bad)' : isSel ? 'var(--accent)' : st.past ? 'color-mix(in srgb, var(--warn) 55%, transparent)' : 'var(--surface)'}
                    stroke={isSel ? 'var(--accent)' : st.active ? 'var(--surface)' : 'var(--text-subtle)'}
                    strokeWidth="1.5"
                  />
                </g>
              )
            })}
          </svg>
          <figcaption className="text-[11px] text-subtle">{view === 'front' ? '앞' : '뒤'}</figcaption>
        </figure>
      ))}
    </div>
  )
}

import type { ActivityDetail } from '@/api/activities'
import { fmtDuration } from '@/lib/format'

/** Time in HR zones as labeled horizontal bars (labels always visible, so color is never the only cue). */
export function ZoneBars({ zones }: { zones: ActivityDetail['hr_zones'] }) {
  const total = zones.seconds.reduce((a, b) => a + b, 0)
  if (!total) return <p className="py-6 text-center text-sm text-subtle">심박 데이터가 없어요</p>
  const lowers = [0, ...zones.bounds.map((b) => b + 1)]
  return (
    <div className="space-y-2.5">
      {zones.seconds.map((sec, i) => {
        const pct = (sec / total) * 100
        const range = i === 4 ? `${lowers[i]}+` : `${lowers[i] || '~'}–${zones.bounds[i]}`
        return (
          <div key={i} className="grid grid-cols-[5.5rem_1fr_5.5rem] items-center gap-3 text-xs">
            <div>
              <div className="font-medium">{zones.names[i]}</div>
              <div className="num text-[10px] text-subtle">{range} bpm</div>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full" style={{ width: `${Math.max(pct, sec > 0 ? 1.5 : 0)}%`, background: `var(--z${i + 1})` }} />
            </div>
            <div className="num text-right">
              <span className="font-semibold">{pct.toFixed(0)}%</span>
              <span className="ml-1.5 text-subtle">{fmtDuration(sec)}</span>
            </div>
          </div>
        )
      })}
      <p className="pt-1 text-[11px] text-subtle">
        {zones.method === 'max_estimated'
          ? `최대 심박 ${zones.max_hr}bpm(기록 기반 추정)의 비율로 계산 · 설정에서 LTHR을 지정하면 더 정확해져요`
          : `최대 심박 ${zones.max_hr ?? '—'} bpm 기준`}
      </p>
    </div>
  )
}

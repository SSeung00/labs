import type { Lap } from '@/api/activities'
import { fmtDuration, fmtKm, fmtNum, fmtPace } from '@/lib/format'

/** Laps with an inline pace bar: longer bar = faster, scaled between the slowest and fastest lap. */
// Some watches don't record lap speed; distance / time is the same thing.
const lapSpeed = (l: Lap) => l.avg_speed_mps ?? (l.distance_m > 0 && l.duration_s > 0 ? l.distance_m / l.duration_s : null)

export function LapsTable({ laps: raw }: { laps: Lap[] }) {
  const laps = raw.map((l) => ({ ...l, avg_speed_mps: lapSpeed(l) }))
  const speeds = laps.map((l) => l.avg_speed_mps ?? 0).filter((v) => v > 0)
  const min = Math.min(...speeds)
  const max = Math.max(...speeds)
  const best = laps.reduce((b, l) => ((l.avg_speed_mps ?? 0) > (b?.avg_speed_mps ?? 0) && l.distance_m > 300 ? l : b), null as (typeof laps)[number] | null)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm sm:min-w-[520px]">
        <thead>
          <tr className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
            <th className="py-2 pl-5 pr-2 text-left">#</th>
            <th className="px-2 text-right">거리</th>
            <th className="px-2 text-right">시간</th>
            <th className="w-[38%] px-2 text-left">페이스</th>
            <th className="py-2 pl-2 pr-5 text-right sm:pr-2">심박</th>
            <th className="hidden px-2 text-right sm:table-cell">케이던스</th>
            <th className="hidden py-2 pl-2 pr-5 text-right sm:table-cell">상승</th>
          </tr>
        </thead>
        <tbody>
          {laps.map((l) => {
            const sp = l.avg_speed_mps ?? 0
            const w = max > min ? 18 + ((sp - min) / (max - min)) * 82 : 100
            return (
              <tr key={l.id} className="border-t">
                <td className="num py-2 pl-5 pr-2 text-subtle">{l.idx + 1}</td>
                <td className="num px-2 text-right">{fmtKm(l.distance_m)}</td>
                <td className="num px-2 text-right">{fmtDuration(l.duration_s)}</td>
                <td className="px-2">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${sp ? w : 0}%`, background: l === best ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 45%, var(--surface-3))' }}
                      />
                    </div>
                    <span className="num w-10 text-right font-medium">{fmtPace(l.avg_speed_mps)}</span>
                  </div>
                </td>
                <td className="num py-2 pl-2 pr-5 text-right sm:pr-2">{fmtNum(l.avg_hr)}</td>
                <td className="num hidden px-2 text-right sm:table-cell">{fmtNum(l.avg_cadence)}</td>
                <td className="num hidden py-2 pl-2 pr-5 text-right sm:table-cell">{l.elevation_gain_m != null ? `${fmtNum(l.elevation_gain_m)} m` : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

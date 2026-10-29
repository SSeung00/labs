/** Formatting helpers. All inputs are SI (m, s, m/s). */

export function fmtKm(m: number | null | undefined, digits = 2) {
  if (m == null) return '—'
  return (m / 1000).toFixed(digits)
}

/** 5:32 style from seconds per km. */
export function fmtPaceSec(secPerKm: number | null | undefined) {
  if (secPerKm == null || !isFinite(secPerKm) || secPerKm <= 0) return '—'
  const total = Math.round(secPerKm)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function fmtPace(mps: number | null | undefined) {
  if (!mps) return '—'
  return fmtPaceSec(1000 / mps)
}

/** 1:02:03 or 42:10 */
export function fmtDuration(sec: number | null | undefined) {
  if (sec == null) return '—'
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

/** "3시간 12분" — for totals, not race times. */
export function fmtHours(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`
}

export function fmtNum(v: number | null | undefined, digits = 0) {
  if (v == null || !isFinite(v)) return '—'
  return v.toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

export const SPORT_LABEL: Record<string, string> = {
  running: '러닝',
  treadmill_running: '트레드밀',
  trail_running: '트레일',
  track_running: '트랙',
  street_running: '로드',
  indoor_running: '실내 러닝',
  virtual_run: '가상 러닝',
}

export function sportLabel(s: string) {
  return SPORT_LABEL[s] ?? s
}

/** "1:35:00" / "45:30" / "95" (minutes) → seconds; null if unparseable. */
export function parseDuration(input: string): number | null {
  const s = input.trim()
  if (!s) return null
  const parts = s.split(':').map((p) => Number(p))
  if (parts.some((p) => !isFinite(p) || p < 0)) return null
  if (parts.length === 1) return parts[0] * 60
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return null
}

export const RACE_PRESETS = [
  { distance_m: 5000, label: '5K' },
  { distance_m: 10000, label: '10K' },
  { distance_m: 21097.5, label: '하프' },
  { distance_m: 42195, label: '풀코스' },
]

/** '2026-09' → '9월' or '2026년 9월'. */
export function monthLabel(m: string, withYear = false) {
  const [y, mo] = m.split('-')
  return withYear ? `${y}년 ${Number(mo)}월` : `${Number(mo)}월`
}

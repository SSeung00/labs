import { Check, CircleDashed, Minus, X } from 'lucide-react'
import type { PaceZones } from '@/api/progress'
import type { Phase, Step, WorkoutKind } from '@/api/planner'
import { fmtHours, fmtPaceSec } from '@/lib/format'

export const KIND: Record<WorkoutKind, { label: string; color: string }> = {
  easy: { label: '이지', color: 'var(--z2)' },
  recovery: { label: '회복', color: 'var(--z1)' },
  long: { label: '롱런', color: 'var(--fitness)' },
  tempo: { label: '역치', color: 'var(--z4)' },
  interval: { label: '인터벌', color: 'var(--z5)' },
  mp: { label: '레이스 페이스', color: 'var(--z3)' },
  race: { label: '레이스', color: 'var(--accent)' },
  rest: { label: '휴식', color: 'var(--text-subtle)' },
  cross: { label: '크로스', color: 'var(--text-subtle)' },
}

export const PHASE: Record<Phase, { label: string; desc: string; color: string }> = {
  base: { label: '기초', desc: '유산소 기반과 근지구력', color: 'var(--z2)' },
  build: { label: '강화', desc: '역치·VO2max 자극', color: 'var(--z4)' },
  peak: { label: '실전', desc: '레이스 페이스 적응', color: 'var(--z5)' },
  taper: { label: '테이퍼', desc: '피로 해소와 컨디션 조절', color: 'var(--form)' },
}

/** Plan-vs-actual badge for a planned workout. */
export const STATUS_ICON = {
  done: { icon: Check, cls: 'bg-good text-white', label: '완료' },
  partial: { icon: Minus, cls: 'bg-warn text-black', label: '일부' },
  missed: { icon: X, cls: 'bg-bad/80 text-white', label: '놓침' },
  skipped: { icon: CircleDashed, cls: 'bg-surface-3 text-muted', label: '건너뜀' },
} as const

export const DOW = ['월', '화', '수', '목', '금', '토', '일']

export const PACE_NAME: Record<string, string> = { E: '이지', M: '마라톤', T: '역치', I: '인터벌', R: '반복', RP: '목표' }

export function paceText(zone: string | undefined, paces: PaceZones | null | undefined, racePace?: number) {
  if (!zone) return ''
  if (zone === 'RP') return racePace ? `${fmtPaceSec(racePace)}/km` : '목표 페이스'
  const z = paces?.[zone as keyof PaceZones]
  if (!z) return PACE_NAME[zone] ?? zone
  return zone === 'M' ? `${fmtPaceSec((z.slow + z.fast) / 2)}/km` : `${fmtPaceSec(z.fast)}–${fmtPaceSec(z.slow)}/km`
}

export function estDuration(steps: Step[], paces: PaceZones | null | undefined, racePace?: number): number {
  let t = 0
  for (const s of steps) {
    if (s.type === 'repeat') {
      t += (s.reps ?? 1) * estDuration(s.steps ?? [], paces, racePace)
      continue
    }
    if (s.duration_s) t += s.duration_s
    else if (s.distance_m) {
      const z = s.pace === 'RP' ? racePace : s.pace && paces ? (paces[s.pace as keyof PaceZones].slow + paces[s.pace as keyof PaceZones].fast) / 2 : 330
      t += (s.distance_m / 1000) * (z ?? 330)
    }
  }
  return t
}

export const fmtEst = (sec: number) => (sec ? `약 ${fmtHours(sec)}` : '')

const WORK = new Set(['M', 'T', 'I', 'R', 'RP'])

/** Short target pace for a zone: "4:05–4:12", a single pace for M / race pace. */
export function shortPace(zone: string | undefined, paces: PaceZones | null | undefined, racePace?: number) {
  if (!zone) return ''
  if (zone === 'RP') return racePace ? fmtPaceSec(racePace) : ''
  const z = paces?.[zone as keyof PaceZones]
  if (!z) return ''
  return zone === 'M' ? fmtPaceSec((z.slow + z.fast) / 2) : `${fmtPaceSec(z.fast)}–${fmtPaceSec(z.slow)}`
}

function amountText(s: Step) {
  if (s.distance_m) return s.distance_m >= 1000 ? `${+(s.distance_m / 1000).toFixed(1)}km` : `${Math.round(s.distance_m)}m`
  if (s.duration_s) return s.duration_s >= 120 ? `${Math.round(s.duration_s / 60)}분` : `${s.duration_s}초`
  return ''
}

/** The workout's main set in one line, e.g. "5×1km @4:05–4:12" or "이지 @5:20–5:50". */
export function keyLine(steps: Step[] | null | undefined, paces: PaceZones | null | undefined, racePace?: number): string {
  const list = steps ?? []
  const easy = shortPace('E', paces, racePace)
  // Short R-pace bursts are strides, not the session's main set.
  const strides = list.find((s) => s.type === 'repeat' && s.steps?.some((x) => x.pace === 'R' && (x.duration_s ?? 99) <= 30))
  if (strides) return `${easy ? `${easy}/km + ` : ''}스트라이드 ${strides.reps}회`
  for (const s of list) {
    const work = s.type === 'repeat' ? s.steps?.find((x) => x.type === 'run' && x.pace && WORK.has(x.pace)) : null
    if (work) {
      const p = shortPace(work.pace, paces, racePace)
      return `${s.reps}×${amountText(work)}${p ? ` @${p}` : ''}`
    }
  }
  const main = list.filter((s) => s.type === 'run' && s.pace && WORK.has(s.pace))
  if (main.length) {
    const s = main[0]
    const p = shortPace(s.pace, paces, racePace)
    return `${PACE_NAME[s.pace!]} ${amountText(s)}${p ? ` @${p}` : ''}`
  }
  return list.length && easy ? `${easy}/km` : ''
}

/** Best-guess editor template for an existing workout (titles come from the generator / templates). */
export function templateOf(kind: string, title: string): string {
  if (kind === 'rest') return 'rest'
  if (kind === 'recovery') return 'recovery'
  if (kind === 'long') return title.includes('페이스') ? 'long_m' : 'long'
  if (kind === 'mp') return 'rp'
  if (title.includes('스트라이드')) return 'strides'
  if (title.includes('언덕')) return 'hills'
  if (title.includes('크루즈')) return 'cruise'
  if (kind === 'tempo') return 'tempo'
  if (kind === 'interval') return title.includes('레이스 페이스') ? 'rp' : 'vo2'
  return 'easy'
}

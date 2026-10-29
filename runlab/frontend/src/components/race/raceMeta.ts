import type { RacePriority } from '@/api/planner'
import { RACE_PRESETS } from '@/lib/format'

export const PRIORITY: Record<RacePriority, { label: string; short: string; desc: string; cls: string }> = {
  A: { label: 'A · 목표 대회', short: 'A', desc: '플랜 전체를 이 대회에 맞춰요 (테이퍼·피크)', cls: 'bg-accent text-accent-fg' },
  B: { label: 'B · 중요한 대회', short: 'B', desc: '앞 2–3일 가볍게, 뒤로 회복일을 둬요', cls: 'bg-fitness text-white' },
  C: { label: 'C · 훈련 삼아', short: 'C', desc: '그 주 포인트 훈련 대신 뛰어요. 앞뒤 강훈련만 쉽게', cls: 'bg-surface-3 text-text' },
}

export function distLabel(m: number) {
  const preset = RACE_PRESETS.find((r) => Math.abs(r.distance_m - m) < 1)
  return preset ? preset.label : `${+(m / 1000).toFixed(1)}km`
}

export function dDay(n: number) {
  return n > 0 ? `D-${n}` : n === 0 ? 'D-DAY' : `${-n}일 전`
}

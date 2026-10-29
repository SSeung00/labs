export type RunType = 'race' | 'workout' | 'easy' | 'recovery' | 'long'

export const RUN_TYPES: { key: RunType; label: string; desc: string; color: string }[] = [
  { key: 'race', label: '레이스', desc: '대회·기록 측정', color: 'var(--rt-race)' },
  { key: 'workout', label: '포인트', desc: '템포·인터벌·언덕 등 고강도', color: 'var(--rt-workout)' },
  { key: 'long', label: '장거리', desc: 'LSD·롱런 (18km+ 또는 100분+)', color: 'var(--rt-long)' },
  { key: 'easy', label: '조깅', desc: '편한 유산소', color: 'var(--rt-easy)' },
  { key: 'recovery', label: '리커버리', desc: '아주 가볍게 회복', color: 'var(--rt-recovery)' },
]

export const RUN_TYPE = Object.fromEntries(RUN_TYPES.map((t) => [t.key, t])) as Record<RunType, (typeof RUN_TYPES)[number]>

export const REVIEW_BELOW = 0.7

export function needsReview(source: string | null | undefined, confidence: number | null | undefined) {
  return source === 'auto' && (confidence ?? 1) < REVIEW_BELOW
}

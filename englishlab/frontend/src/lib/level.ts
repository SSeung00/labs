const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

/** 1.0–6.0 → "B2", "B2+" (upper half), "C2". */
export function cefr(level: number | null | undefined): string {
  if (level == null) return '–'
  const v = Math.max(1, Math.min(6, level))
  if (v >= 6) return 'C2'
  const base = CEFR[Math.floor(v) - 1]
  return v - Math.floor(v) >= 0.5 ? `${base}+` : base
}

export function levelColor(level: number | null | undefined): string {
  if (level == null) return 'var(--surface-3)'
  if (level >= 5) return 'var(--good)'
  if (level >= 4) return 'var(--accent)'
  if (level >= 3) return 'var(--fitness)'
  return 'var(--warn)'
}

export const band = (level: number | null | undefined) => (level == null ? '–' : (Math.round(level * 2) / 2).toFixed(1))

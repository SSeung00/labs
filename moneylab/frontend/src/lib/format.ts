/** Money and date formatting. Amounts are whole KRW. */

export function won(v: number | null | undefined) {
  if (v == null || !isFinite(v)) return '—'
  return `${Math.round(v).toLocaleString('ko-KR')}원`
}

/** Signed, for ledger rows: "-12,000원" / "+3,000원". */
export function wonSigned(v: number) {
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v)).toLocaleString('ko-KR')}원`
}

/** Compact Korean units for chart axes and tight spots: 1.2억, 345만, 8,000. */
export function wonShort(v: number | null | undefined) {
  if (v == null || !isFinite(v)) return '—'
  const a = Math.abs(v)
  const sign = v < 0 ? '−' : ''
  if (a >= 1e8) return `${sign}${trim(a / 1e8, 1)}억`
  if (a >= 1e4) return `${sign}${trim(a / 1e4, a >= 1e6 ? 0 : 1)}만`
  return `${sign}${Math.round(a).toLocaleString('ko-KR')}`
}

function trim(n: number, digits: number) {
  return n.toFixed(digits).replace(/\.0+$/, '')
}

export function fmtNum(v: number | null | undefined) {
  if (v == null || !isFinite(v)) return '—'
  return v.toLocaleString('ko-KR')
}

export function pct(v: number | null | undefined, digits = 0) {
  if (v == null || !isFinite(v)) return '—'
  return `${(v * 100).toFixed(digits)}%`
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']

/** "10월 3일 (금)" this year, "2025년 10월 3일 (금)" otherwise. */
export function fmtDay(iso: string, withYear?: boolean) {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00')
  const year = withYear ?? d.getFullYear() !== new Date().getFullYear()
  return `${year ? `${d.getFullYear()}년 ` : ''}${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY[d.getDay()]})`
}

/** "2026.10.03" */
export function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  return iso.slice(0, 10).replaceAll('-', '.')
}

export function fmtTime(iso: string) {
  return iso.slice(11, 16)
}

/** "2026-10" → "2026년 10월" / short "10월" */
export function fmtMonth(ym: string, short = false) {
  const [y, m] = ym.split('-')
  return short ? `${Number(m)}월` : `${y}년 ${Number(m)}월`
}

export function monthRange(ym: string): { start: string; end: string } {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return { start: `${ym}-01`, end: `${ym}-${String(last).padStart(2, '0')}` }
}

export function addMonths(ym: string, n: number) {
  const [y, m] = ym.split('-').map(Number)
  const idx = y * 12 + (m - 1) + n
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

export function thisMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "300000" / "30만" / "1,200,000" → number; null when empty or unparseable. */
export function parseWon(input: string): number | null {
  const s = input.replace(/[,\s원]/g, '')
  if (!s) return null
  const m = s.match(/^(\d+(?:\.\d+)?)(억|만)?$/)
  if (!m) return null
  const n = Number(m[1]) * (m[2] === '억' ? 1e8 : m[2] === '만' ? 1e4 : 1)
  return isFinite(n) ? Math.round(n) : null
}

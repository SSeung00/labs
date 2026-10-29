import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, post } from './client'

// ── Gear ─────────────────────────────────────────────────────────────
export interface Shoe {
  id: number
  name: string
  brand: string | null
  purchased_on: string | null
  retire_at_km: number
  initial_km: number
  retired: boolean
  is_default: boolean | null
  color: string | null
  color2: string | null
  note: string | null
  runs: number
  km: number
  tracked_km: number
  avg_pace_s_per_km: number | null
  avg_ef: number | null
  last_used: string | null
  first_used: string | null
  wear: number | null
  unassigned_runs: number
}

export const useGear = () => useQuery({ queryKey: ['gear'], queryFn: () => api<Shoe[]>('/gear') })

function useInv(...keys: string[][]) {
  const qc = useQueryClient()
  return () => keys.forEach((k) => qc.invalidateQueries({ queryKey: k }))
}

export function useCreateShoe() {
  const inv = useInv(['gear'])
  return useMutation({ mutationFn: (b: Partial<Shoe> & { name: string }) => post<Shoe>('/gear', b), onSuccess: inv })
}
export function usePatchShoe() {
  const inv = useInv(['gear'])
  return useMutation({ mutationFn: ({ id, ...b }: Partial<Shoe> & { id: number }) => api<Shoe>(`/gear/${id}`, { method: 'PATCH', body: JSON.stringify(b) }), onSuccess: inv })
}
export function useDeleteShoe() {
  const inv = useInv(['gear'], ['activities'])
  return useMutation({ mutationFn: (id: number) => api(`/gear/${id}`, { method: 'DELETE' }), onSuccess: inv })
}
export function useImportShoeCsv() {
  const inv = useInv(['gear'], ['activities'], ['run-types'])
  return useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      return api<{ rows: number; matched: number; unmatched: string[]; shoes_created: string[]; renamed: number; races: number }>('/gear/import-csv', { method: 'POST', body: fd })
    },
    onSuccess: inv,
  })
}

export function useAssignShoe() {
  const inv = useInv(['gear'], ['activities'])
  return useMutation({
    mutationFn: ({ id, ...b }: { id: number; start: string; end?: string | null; overwrite?: boolean }) => post<{ assigned: number }>(`/gear/${id}/assign`, b),
    onSuccess: inv,
  })
}

// ── Injuries ─────────────────────────────────────────────────────────
export interface InjuryRec {
  id: number
  body_part: string
  side: string | null
  map_x: number | null
  map_y: number | null
  severity: number
  start_day: string
  end_day: string | null
  note: string | null
}

export const useInjuries = () => useQuery({ queryKey: ['injuries'], queryFn: () => api<InjuryRec[]>('/injuries') })
export function useSaveInjury() {
  const inv = useInv(['injuries'], ['readiness'], ['plan'])
  return useMutation({
    mutationFn: ({ id, ...b }: Partial<InjuryRec> & { id?: number }) =>
      id ? api<InjuryRec>(`/injuries/${id}`, { method: 'PATCH', body: JSON.stringify(b) }) : post<InjuryRec>('/injuries', b),
    onSuccess: inv,
  })
}
export function useDeleteInjury() {
  const inv = useInv(['injuries'], ['readiness'])
  return useMutation({ mutationFn: (id: number) => api(`/injuries/${id}`, { method: 'DELETE' }), onSuccess: inv })
}

// ── Insights ─────────────────────────────────────────────────────────
export interface InsightMetric {
  group: string
  key: string
  label: string
  unit: string
  polarity: 'higher_better' | 'lower_better' | 'neutral'
  count: number
}
export interface Correlation {
  n: number
  lag: number
  pairs: { day: string; x: number; y: number }[]
  rho?: number
  p?: number
  slope?: number
  intercept?: number
  r2?: number
}
export interface Driver {
  key: string
  label: string
  group: string
  rho: number
  p: number
  n: number
  lag: number
}
export interface HeatEffect {
  n: number
  slope_per_c?: number
  pct_per_5c?: number
  r2?: number
  p?: number
  bins?: { lo: number; hi: number; ef: number; n: number }[]
  points?: { temp: number; ef: number }[]
}

export const useInsightMetrics = () => useQuery({ queryKey: ['insights', 'metrics'], queryFn: () => api<InsightMetric[]>('/insights/metrics') })
export const useCorrelation = (x: string, y: string, lag: number) =>
  useQuery({
    queryKey: ['insights', 'corr', x, y, lag],
    queryFn: () => api<Correlation>(`/insights/correlate?x=${encodeURIComponent(x)}&y=${encodeURIComponent(y)}&lag=${lag}`),
    enabled: !!x && !!y,
    placeholderData: (p) => p,
  })
export const useDrivers = (target: string) =>
  useQuery({ queryKey: ['insights', 'drivers', target], queryFn: () => api<Driver[]>(`/insights/drivers?target=${encodeURIComponent(target)}`), enabled: !!target })
export const useHeat = () => useQuery({ queryKey: ['insights', 'heat'], queryFn: () => api<HeatEffect>('/insights/heat') })

export interface Finding {
  key: string
  cause: string
  outcome: string
  lag: number
  text: string
  /** Whether the "high" side of the cause goes with the better outcome. */
  good: boolean
  basis: string
  rho: number | null
  n: number
  p: number
  category: 'recovery' | 'growth'
}

export const useFindings = () => useQuery({ queryKey: ['insights', 'findings'], queryFn: () => api<Finding[]>('/insights/findings'), staleTime: 10 * 60_000 })

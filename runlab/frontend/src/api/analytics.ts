import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export interface Profile {
  max_hr: number
  rest_hr: number
  lthr: number
  zone_bounds: number[]
  zone_method: 'lthr' | 'max' | 'custom'
  sex: string
  vdot: number | null
  sources: Record<'max_hr' | 'rest_hr' | 'lthr', 'manual' | 'estimated' | 'default'>
  estimates: Record<'max_hr' | 'rest_hr' | 'lthr', number | null>
  zone_names: string[]
}

export interface PmcPoint {
  day: string
  load: number
  ctl: number
  atl: number
  tsb: number
  acwr: number | null
  run_km: number
  future: boolean
  planned: boolean
}

export interface LoadToday {
  ctl: number
  atl: number
  tsb: number
  acwr: number | null
}

export interface WeekLoad {
  week: string
  load: number
  run_km: number
  monotony: number | null
  strain: number | null
  zone_seconds: number[]
}

export interface EfficiencyPoint {
  id: number
  day: string
  name: string | null
  ef: number | null
  decoupling: number | null
  avg_hr: number | null
  gap_speed: number | null
  distance_m: number
  moving_s: number | null
  vdot_est: number | null
  load: number | null
  treadmill: boolean
}

export interface Readiness {
  day: string
  score: number
  level: 'high' | 'ok' | 'low' | 'very_low'
  advice: string
  flags: string[]
  components: { key: string; label: string; score: number; detail: string }[]
  has_checkin: boolean
  load: LoadToday
  checkin: Record<string, number | string>
}

export interface MetricDef {
  key: string
  label: string
  kind: 'number' | 'scale' | 'bool' | 'text' | 'select'
  unit: string | null
  icon: string | null
  options: string[] | null
  scale_min: number | null
  scale_max: number | null
  polarity: 'higher_better' | 'lower_better' | 'neutral' | null
  sort_order: number | null
  builtin: boolean | null
  archived: boolean
}

export type JournalValues = Record<string, number | string>

export const useProfile = () => useQuery({ queryKey: ['profile'], queryFn: () => api<Profile>('/profile') })

export function useSaveProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: Partial<{ max_hr: number | null; resting_hr: number | null; lthr: number | null; hr_zone_method: string; vdot: number | null }>) =>
      api<Profile>('/profile', { method: 'PUT', body: JSON.stringify(b) }),
    onSuccess: () => qc.invalidateQueries(),
  })
}

export const usePmc = (days: number, project = 0) =>
  useQuery({
    queryKey: ['fitness', 'pmc', days, project],
    queryFn: () => api<{ series: PmcPoint[]; today: LoadToday }>(`/fitness/pmc?days=${days}&project=${project}`),
  })

export const useWeeklyLoad = (weeks = 26) =>
  useQuery({ queryKey: ['fitness', 'weekly', weeks], queryFn: () => api<WeekLoad[]>(`/fitness/weekly?weeks=${weeks}`) })

export const useEfficiency = (days = 365) =>
  useQuery({ queryKey: ['fitness', 'efficiency', days], queryFn: () => api<EfficiencyPoint[]>(`/fitness/efficiency?days=${days}`) })

export const useReadiness = () => useQuery({ queryKey: ['readiness'], queryFn: () => api<Readiness>('/readiness') })

export const useMetricDefs = (includeArchived = false) =>
  useQuery({ queryKey: ['journal', 'defs', includeArchived], queryFn: () => api<MetricDef[]>(`/journal/defs?include_archived=${includeArchived}`) })

export const useJournal = (start: string, end: string) =>
  useQuery({ queryKey: ['journal', 'entries', start, end], queryFn: () => api<Record<string, JournalValues>>(`/journal?start=${start}&end=${end}`) })

export function useSaveJournal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ day, values }: { day: string; values: Record<string, number | string | null> }) =>
      api<JournalValues>(`/journal/${day}`, { method: 'PUT', body: JSON.stringify(values) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['journal'] })
      qc.invalidateQueries({ queryKey: ['readiness'] })
      qc.invalidateQueries({ queryKey: ['insights'] })
    },
  })
}

export function useCreateMetricDef() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: Partial<MetricDef> & { label: string }) => api<MetricDef>('/journal/defs', { method: 'POST', body: JSON.stringify(b) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['journal', 'defs'] }),
  })
}

export function usePatchMetricDef() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, ...b }: Partial<MetricDef> & { key: string }) =>
      api<MetricDef>(`/journal/defs/${key}`, { method: 'PATCH', body: JSON.stringify(b) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['journal', 'defs'] }),
  })
}

// ---------- condition (plain-language fitness / fatigue / form) ----------

export type BandKey = 'overload' | 'productive' | 'neutral' | 'fresh' | 'rested'

export interface Condition {
  headline: string
  advice: string[]
  flags: string[]
  fitness: { state: 'up' | 'flat' | 'down'; label: string; value: number; delta_7d: number | null; from_28d: number | null; rising_weeks: number }
  fatigue: { state: 'low' | 'mid' | 'high'; label: string; value: number; tsb: number; delta_7d: number | null }
  form: { state: 'race' | 'train' | 'rest'; label: string; tsb: number; readiness: number | null; has_checkin: boolean; band: BandKey }
  ramp: { state: 'unknown' | 'low' | 'ok' | 'fast' | 'risk'; label: string; value: number | null }
  intensity: { week: string; hours: number; run_km: number; easy_pct: number | null }[]
  easy_target_pct: number
  bands: { key: BandKey; label: string; lo: number | null; hi: number | null }[]
}

export const useCondition = () => useQuery({ queryKey: ['fitness', 'condition'], queryFn: () => api<Condition>('/condition') })

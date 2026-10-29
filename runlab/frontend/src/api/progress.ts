import { useQuery } from '@tanstack/react-query'
import { api } from './client'

export type PaceZones = Record<'E' | 'M' | 'T' | 'I' | 'R', { slow: number; fast: number }>

export interface GoalInfo {
  distance_m: number
  time_s: number
  name: string | null
  race_day: string | null
  vdot: number
  reachable: boolean
  already?: boolean
  eta?: string | null
  eta_early?: string | null
  eta_late?: string | null
  probability_1y?: number | null
  v_inf?: number | null
}

export interface Prediction {
  distance_m: number
  label: string
  vdot_time_s?: number
  riegel_time_s?: number
  cs_time_s?: number
  consensus_s?: number
}

export interface ProgressData {
  points: { id: number; day: string; name: string | null; vdot_hr: number | null; vdot_perf: number | null; vo2max: number | null }[]
  smooth: { day: string; v: number; sd?: number }[]
  fit: {
    ok: boolean
    reason?: string
    method?: string
    rmse?: number
    params?: { v_inf: number; v0: number; tau_days: number }
    curve?: { day: string; v: number; lo: number; hi: number; future: boolean }[]
  }
  current: {
    vdot: number | null
    source: string
    /** Uncertainty of the sequential estimate (1 SD). */
    vdot_sd: number | null
    /** HR-based estimate, already corrected by `hr_bias` (learned from races). */
    vdot_hr: number | null
    hr_bias: number
    vdot_perf: number | null
    garmin_vo2max: number | null
    garmin_gap: number | null
  }
  critical_speed: { cs_mps: number; d_prime_m: number; r2: number } | null
  predictions: Prediction[]
  paces: PaceZones | null
  goal: GoalInfo | null
  scenarios: Scenarios | null
}

export interface Scenario {
  compliance: number
  label: string
  points: { day: string; v: number }[]
  race_day_vdot: number
  race_day_ctl: number
  race_day_tsb: number
  peak_ctl: number
  predicted_time_s?: number
  vs_goal_s?: number
}

export interface Scenarios {
  plan_name: string
  race_day: string
  race_distance_m: number | null
  goal_time_s: number | null
  actual_compliance: number | null
  link: { slope: number; lag: number; r: number | null; fallback: boolean; hist_max_ctl: number; load_calibration: number; max_gain_per_week: number }
  scenarios: Scenario[]
}

export interface PR {
  distance_m: number
  label: string
  best: { day: string; time_s: number; activity_id: number; name: string | null } | null
  history: { day: string; time_s: number; activity_id: number; name: string | null }[]
}

export function useProgress(goal?: { distance_m: number; time_s: number } | null) {
  const qs = goal ? `?goal_distance=${goal.distance_m}&goal_time=${goal.time_s}` : ''
  return useQuery({ queryKey: ['progress', goal?.distance_m, goal?.time_s], queryFn: () => api<ProgressData>(`/progress${qs}`), placeholderData: (p) => p })
}

export const usePRs = () => useQuery({ queryKey: ['progress', 'prs'], queryFn: () => api<PR[]>('/progress/prs') })

export interface Backtest {
  n: number
  mae_new?: number
  mae_old?: number
  median_new?: number
  median_old?: number
  races: { day: string; actual: number; new: number; old: number }[]
}

export const useBacktest = () => useQuery({ queryKey: ['progress', 'backtest'], queryFn: () => api<Backtest>('/progress/backtest'), staleTime: 30 * 60_000 })

export interface Reflection {
  activity_id: number
  name: string | null
  day: string
  run_type: string | null
  km: number
  vdot_before: number | null
  vdot_after: number | null
  vdot_sd: number | null
  race?: { name: string; distance_m: number; target_s: number | null; before_s: number; after_s: number }
  ctl_delta?: number
  tsb_after?: number
  load: number | null
  workout?: { id: number; title: string; kind: string; main_zone: string; verdict: 'on' | 'fast' | 'slow' | null; target_km: number | null; reps_on: number; reps: number }
  week?: { actual_km: number; planned_km: number; planned_to_date_km: number }
}

export const useReflection = (activityId?: number) =>
  useQuery({
    queryKey: ['progress', 'reflection', activityId ?? 'latest'],
    queryFn: () => api<Reflection | null>(`/reflection${activityId ? `?activity_id=${activityId}` : ''}`),
  })

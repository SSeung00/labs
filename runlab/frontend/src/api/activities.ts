import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { RunType } from '@/lib/runTypes'

export interface Activity {
  id: number
  garmin_id: number | null
  source: string
  name: string | null
  sport: string
  start_time: string
  start_time_utc: string | null
  distance_m: number
  duration_s: number
  moving_time_s: number | null
  elevation_gain_m: number | null
  avg_hr: number | null
  max_hr: number | null
  avg_speed_mps: number | null
  avg_cadence: number | null
  calories: number | null
  start_lat: number | null
  start_lon: number | null
  aerobic_te: number | null
  anaerobic_te: number | null
  vo2max: number | null
  gap_speed_mps: number | null
  trimp: number | null
  hr_tss: number | null
  efficiency_factor: number | null
  decoupling_pct: number | null
  weather: {
    temp_c?: number
    feels_like_c?: number
    humidity_pct?: number
    dew_point_c?: number
    wind_mps?: number
    precip_mm?: number
  } | null
  shoe_id: number | null
  rpe: number | null
  note: string | null
  has_stream: boolean
  run_type: RunType | null
  run_type_source: 'auto' | 'import' | 'manual' | null
  run_type_confidence: number | null
  run_type_reason: string | null
}

export interface Lap {
  id: number
  idx: number
  distance_m: number
  duration_s: number
  avg_hr: number | null
  avg_speed_mps: number | null
  avg_cadence: number | null
  elevation_gain_m: number | null
}

export interface Wellness {
  day: string
  resting_hr: number | null
  hrv_avg: number | null
  hrv_status: string | null
  sleep_total_s: number | null
  sleep_deep_s: number | null
  sleep_rem_s: number | null
  sleep_score: number | null
  body_battery_max: number | null
  body_battery_min: number | null
  stress_avg: number | null
  steps: number | null
  weight_kg: number | null
  training_readiness: number | null
}

export interface ActivityDetail {
  activity: Activity
  laps: Lap[]
  hr_zones: { bounds: number[]; names: string[]; seconds: number[]; method: string; max_hr: number | null }
  wellness: Wellness | null
  prev_id: number | null
  next_id: number | null
}

export interface StreamData {
  n: number
  series: Partial<Record<'t' | 'dist' | 'pace' | 'hr' | 'alt' | 'cad' | 'power' | 'vo' | 'gct' | 'stride', (number | null)[]>>
  /** [lon, lat, t, pace s/km] */
  route: [number, number, number, number | null][]
}

export interface DayTotal {
  day: string
  distance_m: number
  duration_s: number
  count: number
  run_type: RunType | null
  runs: { id: number; name: string | null; km: number; run_type: RunType | null }[]
}

export interface WeekTotal {
  week: string
  distance_m: number
  duration_s: number
  elevation_m: number
  count: number
}

export interface MonthTotal {
  month: string // YYYY-MM
  count: number
  distance_m: number
  duration_s: number
  by_type: Partial<Record<RunType, number>> // meters
}

export interface ListParams {
  limit?: number
  offset?: number
  sort?: string
  order?: 'asc' | 'desc'
  q?: string
  sport?: string
  run_type?: string
  review?: boolean
  month?: string
}

export function useActivities(p: ListParams) {
  const qs = new URLSearchParams(
    Object.entries(p).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]),
  )
  return useQuery({
    queryKey: ['activities', 'list', p],
    queryFn: () => api<{ total: number; items: Activity[] }>(`/activities?${qs}`),
    placeholderData: keepPreviousData,
  })
}

export const useCalendar = (days = 371) =>
  useQuery({ queryKey: ['activities', 'calendar', days], queryFn: () => api<DayTotal[]>(`/activities/calendar?days=${days}`) })

export const useWeekly = (weeks = 16) =>
  useQuery({ queryKey: ['activities', 'weekly', weeks], queryFn: () => api<WeekTotal[]>(`/activities/weekly?weeks=${weeks}`) })

export const useMonthly = () =>
  useQuery({ queryKey: ['activities', 'monthly'], queryFn: () => api<MonthTotal[]>('/activities/monthly') })

export const useActivity = (id: number) =>
  useQuery({ queryKey: ['activities', 'detail', id], queryFn: () => api<ActivityDetail>(`/activities/${id}`) })

export const useStream = (id: number) =>
  useQuery({ queryKey: ['activities', 'stream', id], queryFn: () => api<StreamData>(`/activities/${id}/stream?points=1500`), staleTime: Infinity })

export const useWellness = (days = 60) =>
  useQuery({ queryKey: ['wellness', days], queryFn: () => api<Wellness[]>(`/wellness?days=${days}`) })

export function usePatchActivity(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<Pick<Activity, 'name' | 'rpe' | 'note' | 'shoe_id'>> & { run_type?: RunType | 'auto' }) =>
      api<Activity>(`/activities/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['activities'] })
      qc.invalidateQueries({ queryKey: ['gear'] })
      qc.invalidateQueries({ queryKey: ['run-types'] })
    },
  })
}

export const useRunTypeSummary = () =>
  useQuery({
    queryKey: ['run-types'],
    queryFn: () => api<{ types: Record<RunType, { count: number; km: number }>; review: number }>('/activities/run-types'),
  })

/** Patch any activity by id (list rows), unlike usePatchActivity which is bound to one id. */
export function usePatchAnyActivity() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; run_type?: RunType | 'auto'; shoe_id?: number | null }) =>
      api<Activity>(`/activities/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['activities'] })
      qc.invalidateQueries({ queryKey: ['run-types'] })
    },
  })
}

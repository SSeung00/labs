import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, post } from './client'

export type WorkoutKind = 'easy' | 'long' | 'tempo' | 'interval' | 'mp' | 'recovery' | 'rest' | 'cross' | 'race'
export type Phase = 'base' | 'build' | 'peak' | 'taper'

export interface Step {
  type: 'warmup' | 'run' | 'recover' | 'cooldown' | 'repeat'
  distance_m?: number
  duration_s?: number
  pace?: 'E' | 'M' | 'T' | 'I' | 'R' | 'RP'
  note?: string
  reps?: number
  steps?: Step[]
}

export interface PlannedWorkout {
  id: number
  plan_id: number
  day: string
  kind: WorkoutKind
  title: string
  phase: Phase | null
  target_distance_m: number | null
  target_tss: number | null
  structure: Step[] | null
  note: string | null
  status: 'planned' | 'done' | 'partial' | 'missed' | 'skipped' | 'rest'
  matched_activity_id: number | null
  actual_km?: number
  /** Moving time and distance of the main matched run (for its pace). */
  actual_time_s?: number | null
  actual_main_km?: number | null
  garmin_workout_id?: number | null
  race_id?: number | null
}

export interface PlanWeek {
  week_start: string
  phase: Phase
  target_km?: number
  planned_km: number
  actual_km?: number
  planned_tss: number
}

export type RacePriority = 'A' | 'B' | 'C'

export interface GoalRace {
  id: number
  name: string
  race_day: string
  distance_m: number
  target_time_s: number | null
  priority: RacePriority
  location: string | null
  note: string | null
  result_activity_id: number | null
}

/** A saved race as the race calendar shows it. */
export interface RaceView extends GoalRace {
  d_day: number
  predicted_time_s: number | null
  is_plan_goal: boolean
  in_plan_period: boolean
  in_plan: boolean
  result: { activity_id: number; time_s: number; km: number; pace_s_per_km: number | null; name: string | null } | null
}

export interface RaceChange {
  op: 'race' | 'easy' | 'shakeout' | 'rest'
  workout_id: number | null
  day: string
  before: { title: string; kind: string; km: number } | null
  after: { title: string; kind: string; km: number }
  reason: string
}

export interface PlanRace extends RaceView {
  changes: RaceChange[]
}

export type RaceBody = Pick<GoalRace, 'name' | 'race_day' | 'distance_m' | 'target_time_s' | 'priority' | 'location' | 'note'>

export interface ActivePlan {
  plan: {
    id: number
    name: string
    start_day: string
    end_day: string
    goal_race_id: number | null
    params: { race_pace_s_per_km?: number; goal_time_s?: number | null; race_distance_m?: number; days_per_week?: number; long_run_dow?: number; peak_weekly_km?: number | null; weeks?: PlanWeek[] }
  }
  race: GoalRace | null
  workouts: PlannedWorkout[]
  weeks: PlanWeek[]
  extras: { day: string; activity_id: number; km: number; name: string | null }[]
  compliance: number | null
  done: number
  due: number
}

export interface PlanBody {
  race: { name: string; race_day: string; distance_m: number; target_time_s: number | null; priority?: string }
  race_id?: number | null
  start_day?: string
  days_per_week: number
  long_run_dow: number
  current_weekly_km?: number | null
  peak_weekly_km?: number | null
}

export interface PlanPreview {
  params: Record<string, unknown>
  weeks: PlanWeek[]
  workouts: (Omit<PlannedWorkout, 'id' | 'plan_id' | 'status' | 'matched_activity_id'>)[]
  race_pace_s_per_km: number
}

export interface Suggestion {
  workout_id: number
  severity: 'high' | 'medium' | 'low'
  title: string
  reason: string
  actions: { type: string; label: string }[]
}

export const useActivePlan = () => useQuery({ queryKey: ['plan', 'active'], queryFn: () => api<ActivePlan | null>('/plans/active') })
export const usePlanDefaults = () =>
  useQuery({ queryKey: ['plan', 'defaults'], queryFn: () => api<{ start_day: string; current_weekly_km: number; vdot: number | null }>('/plans/defaults') })
export const useSuggestions = () => useQuery({ queryKey: ['plan', 'suggestions'], queryFn: () => api<Suggestion[]>('/plans/suggestions') })

function useInvalidatePlan() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['plan'] })
    qc.invalidateQueries({ queryKey: ['fitness'] })
    qc.invalidateQueries({ queryKey: ['progress'] })
  }
}

export function usePreviewPlan() {
  return useMutation({ mutationFn: (b: PlanBody) => post<PlanPreview>('/plans/preview', b) })
}

export function useCreatePlan() {
  const inv = useInvalidatePlan()
  return useMutation({ mutationFn: (b: PlanBody) => post<ActivePlan>('/plans', b), onSuccess: inv })
}

export function useDeletePlan() {
  const inv = useInvalidatePlan()
  return useMutation({ mutationFn: (id: number) => api(`/plans/${id}`, { method: 'DELETE' }), onSuccess: inv })
}

export function usePatchWorkout() {
  const qc = useQueryClient()
  const inv = useInvalidatePlan()
  return useMutation({
    mutationFn: ({ id, ...b }: { id: number } & Partial<Pick<PlannedWorkout, 'day' | 'kind' | 'title' | 'target_distance_m' | 'note' | 'status' | 'structure'>>) =>
      api<PlannedWorkout>(`/workouts/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
    // Optimistic move so drag-and-drop feels instant.
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ['plan', 'active'] })
      const prev = qc.getQueryData<ActivePlan | null>(['plan', 'active'])
      if (prev) {
        qc.setQueryData<ActivePlan>(['plan', 'active'], {
          ...prev,
          workouts: prev.workouts.map((w) => (w.id === vars.id ? { ...w, ...vars } : w)),
        })
      }
      return { prev }
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(['plan', 'active'], ctx.prev),
    onSettled: inv,
  })
}

export function useCreateWorkout() {
  const inv = useInvalidatePlan()
  return useMutation({ mutationFn: (b: { day: string; kind?: string; title?: string; target_distance_m?: number }) => post<PlannedWorkout>('/workouts', b), onSuccess: inv })
}

export function useDeleteWorkout() {
  const inv = useInvalidatePlan()
  return useMutation({ mutationFn: (id: number) => api(`/workouts/${id}`, { method: 'DELETE' }), onSuccess: inv })
}

export function useApplySuggestion() {
  const qc = useQueryClient()
  const inv = useInvalidatePlan()
  return useMutation({
    mutationFn: (b: { workout_id: number; type: string }) => post('/plans/suggestions/apply', b),
    onSuccess: () => {
      inv()
      qc.invalidateQueries({ queryKey: ['readiness'] })
    },
  })
}

// ---------- race calendar ----------

export const useRaces = () => useQuery({ queryKey: ['races'], queryFn: () => api<RaceView[]>('/races') })
export const usePlanRaces = (enabled = true) =>
  useQuery({ queryKey: ['plan', 'races'], queryFn: () => api<PlanRace[]>('/plans/races'), enabled })

function useInvalidateRaces() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['races'] })
    qc.invalidateQueries({ queryKey: ['plan'] })
  }
}

export function useSaveRace() {
  const inv = useInvalidateRaces()
  return useMutation({
    mutationFn: ({ id, ...b }: RaceBody & { id?: number }) =>
      id ? api<RaceView>(`/races/${id}`, { method: 'PATCH', body: JSON.stringify(b) }) : post<RaceView>('/races', b),
    onSuccess: inv,
  })
}

export function useDeleteRace() {
  const inv = useInvalidateRaces()
  return useMutation({ mutationFn: (id: number) => api(`/races/${id}`, { method: 'DELETE' }), onSuccess: inv })
}

export function useApplyRaces() {
  const inv = useInvalidateRaces()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (race_ids: number[]) => post<{ changed: number }>('/plans/races/apply', { race_ids }),
    onSuccess: () => {
      inv()
      qc.invalidateQueries({ queryKey: ['fitness'] })
      qc.invalidateQueries({ queryKey: ['progress'] })
    },
  })
}

// ---------- editing ----------

export type PaceZone = 'E' | 'M' | 'T' | 'I' | 'R' | 'RP'
export type Verdict = 'on' | 'fast' | 'slow'

export interface WorkoutReview {
  main_zone: PaceZone
  targets: Partial<Record<PaceZone, { pace: { slow: number; fast: number } | null; hr: [number, number] }>>
  actual: {
    activity_id: number
    km: number
    target_km: number
    time_s: number
    avg_pace: number | null
    avg_hr: number | null
    main_pace: number | null
    main_verdict: Verdict | null
    main_hr_ok: boolean | null
    reps: { n: number; lap: number; pace: number | null; hr: number | null; zone: PaceZone; verdict: Verdict | null }[]
    paired: boolean
    laps: { idx: number; km: number; time_s: number; pace: number | null; hr: number | null; zone?: PaceZone; verdict?: Verdict | null }[]
  } | null
}

export const useWorkoutReview = (id: number | null | undefined) =>
  useQuery({ queryKey: ['plan', 'review', id], queryFn: () => api<WorkoutReview>(`/workouts/${id}/review`), enabled: !!id })

export const useWorkoutTemplates = () =>
  useQuery({ queryKey: ['plan', 'templates'], queryFn: () => api<{ key: string; label: string }[]>('/workouts/templates'), staleTime: Infinity })

export function useSetTemplate() {
  const inv = useInvalidatePlan()
  return useMutation({
    mutationFn: ({ id, ...b }: { id: number; template: string; km: number }) => post<PlannedWorkout>(`/workouts/${id}/template`, b),
    onSuccess: inv,
  })
}

export function useSwapWorkout() {
  const inv = useInvalidatePlan()
  return useMutation({ mutationFn: ({ id, day }: { id: number; day: string }) => post<{ moved: number }>(`/workouts/${id}/swap`, { day }), onSuccess: inv })
}

/** A planned change, as the week tools and race integration preview it. */
export type PlanChange = Pick<RaceChange, 'workout_id' | 'day' | 'before' | 'after' | 'reason'> & { op: string }

export type WeekAction = 'lighter' | 'recovery'

export function useWeekPreview() {
  return useMutation({
    mutationFn: (b: { week_start: string; action: WeekAction }) => post<{ changes: PlanChange[] }>('/plans/week', { ...b, dry_run: true }),
  })
}

export function useApplyWeek() {
  const inv = useInvalidatePlan()
  return useMutation({
    mutationFn: (b: { week_start: string; action: WeekAction }) => post<{ changed: number }>('/plans/week', { ...b, dry_run: false }),
    onSuccess: inv,
  })
}

export interface RegenBody {
  days_per_week: number
  long_run_dow: number
  peak_weekly_km: number | null
}

export interface RegenSummary {
  from_day: string
  replaced: number
  created: number
  old_km: number
  new_km: number
  weeks: { week_start: string; phase: Phase; old_km: number; new_km: number }[]
}

export function useRegenPreview() {
  return useMutation({ mutationFn: (b: RegenBody) => post<RegenSummary>('/plans/regenerate', { ...b, dry_run: true }) })
}

export function useRegenerate() {
  const inv = useInvalidatePlan()
  return useMutation({ mutationFn: (b: RegenBody) => post<RegenSummary>('/plans/regenerate', { ...b, dry_run: false }), onSuccess: inv })
}

// ---------- weekly check ----------

export interface PlanCheck {
  week_start: string
  status: 'applied' | 'dismissed' | null
  notes: string[]
  changes: PlanChange[]
  stats: { ratio: number | null; missed: number; vdot_now: number | null; vdot_start: number | null }
  goal: { name: string; target_s: number | null; predicted_s: number | null; chance: number | null; chance_prev: number | null; predicted_prev_s: number | null } | null
}

export const usePlanCheck = () => useQuery({ queryKey: ['plan', 'check'], queryFn: () => api<PlanCheck | null>('/plans/check') })

export function useApplyPlanCheck() {
  const inv = useInvalidatePlan()
  return useMutation({ mutationFn: () => post<{ changed: number }>('/plans/check/apply'), onSuccess: inv })
}

export function useDismissPlanCheck() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: () => post('/plans/check/dismiss'), onSuccess: () => qc.invalidateQueries({ queryKey: ['plan', 'check'] }) })
}

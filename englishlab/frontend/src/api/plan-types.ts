import type { Levels } from './types'

// ---------- skill estimate, forecast, plan, books ----------

export type CoreSkill = 'reading' | 'listening' | 'speaking' | 'writing'
export type BlockKey = 'review' | 'read' | 'listen' | 'talk' | 'write' | 'book'

export interface SkillEstimate {
  level: number
  sd: number
  low: number
  high: number
  confidence: '높음' | '보통' | '낮음'
  evidence: number
  last_at: string
  last_source: string
  days_since: number
  hours_per_day: number
  monthly_gain: number
}

export interface LearningRate {
  rate: number
  weight: number
  observed: number | null
  expected: number | null
}

export interface ScenarioForecast {
  at_target: number
  low: number
  high: number
  c1: string | null
  c2: string | null
  goal_date: string | null
  hours_per_day: number
}

export interface SkillForecast {
  now: number
  sd: number
  goal: number
  pace: ScenarioForecast
  plan?: ScenarioForecast
  needed_hours_per_day: number
}

export type ForecastRow = { d: string; overall?: number } & Partial<Record<string, number>>

export interface Forecast {
  target_date: string
  days_left: number
  goal: Record<CoreSkill, number>
  rate: LearningRate
  basis: { days: number; assumed: boolean }
  has_plan: boolean
  skills: Record<CoreSkill, SkillForecast | null>
  overall: { now: number | null; pace: number | null; plan: number | null; goal: number }
  series: { pace: ForecastRow[]; plan?: ForecastRow[] }
  estimate_series: Partial<Record<CoreSkill, [string, number, number][]>>
}

export interface PlanPhase {
  name_ko: string
  start: string
  end: string
  focus_ko: string
  weekly_minutes: Record<BlockKey, number>
  targets_ko: string[]
}

export interface Milestone {
  date: string
  title_ko: string
  skill_targets: Record<CoreSkill, number>
  check_ko: string
}

export interface StudyPlan {
  id: number
  created_at: string
  status: 'generating' | 'ready' | 'error'
  error: string | null
  note: string | null
  start: string
  end: string
  goal: Record<CoreSkill, number>
  phases: PlanPhase[]
  milestones: Milestone[]
  routine: { day: string; items: { block: BlockKey; minutes: number; what_ko: string }[] }[]
  summary_ko: string | null
  realistic_goal_ko: string | null
  tips_ko: string[]
  book_schedule: { book_id: number; start: string; days_per_week: number; minutes_per_session: number; note_ko: string }[]
}

export type TrackState = 'ahead' | 'on_track' | 'slightly_behind' | 'behind' | 'none'

export interface PlanTrack {
  phase: (PlanPhase & { index: number; effective_weekly: Record<BlockKey, number> }) | null
  week: {
    start: string
    elapsed_days: number
    blocks: { key: BlockKey; title: string; target: number; done: number; expected: number; state: TrackState }[]
    target: number
    done: number
    expected: number
    ratio: number | null
  }
  weeks: { start: string; target: number; done: number; ratio: number | null }[]
  milestones: (Milestone & {
    forecast: Partial<Record<CoreSkill, number>>
    plan_forecast: Partial<Record<CoreSkill, number>>
    gaps: Partial<Record<CoreSkill, number>>
    past: boolean
    on_track: boolean
    status: 'on_track' | 'with_plan' | 'at_risk'
  })[]
  books: BookSummary[]
  verdict: { state: TrackState; ratio: number | null; text_ko: string; goal_gap: number | null }
  forecast: Forecast
}

export interface Checkin {
  text_ko: string
  adjustments_ko: string[]
  week: string
  at: string
}

export interface PlanResponse {
  plan: StudyPlan | null
  generating: StudyPlan | null
  failed: StudyPlan | null
  track: PlanTrack | null
  forecast: Forecast | null
  levels: Levels & { detail: Record<CoreSkill, SkillEstimate | null>; rate: LearningRate }
  checkin: Checkin | null
}

export type BookStatus = 'researching' | 'ready' | 'active' | 'paused' | 'done' | 'error'

export interface BookProgress {
  done: number
  total: number
  expected: number
  behind_units: number
  behind_days: number
  state: 'done' | 'behind' | 'ahead' | 'on_track'
  next_unit: number | null
  units_per_week: number
  weekly_minutes: number
}

export interface BookSummary {
  id: number
  title: string
  author: string | null
  notes: string | null
  status: BookStatus
  error: string | null
  skill: string
  unit_label: string
  created_at: string
  start_date: string | null
  end_date: string | null
  days_per_week: number
  minutes_per_session: number
  fit: string | null
  summary_ko: string | null
  level_min: number | null
  level_max: number | null
  progress: BookProgress
}

export interface BookResearch {
  identified: boolean
  title: string
  author: string
  publisher: string
  edition: string
  year: string
  kind: string
  skill: string
  exam: string
  format_note_ko: string
  level_min: number
  level_max: number
  summary_ko: string
  fit: string
  fit_reason_ko: string
  unit_label: string
  structure_confidence: 'toc' | 'partial' | 'estimated'
  recommended: { weeks: number; days_per_week: number; minutes_per_session: number; units_per_week: number; start_ko: string; intensity_ko: string }
  method_ko: string[]
  plan_fit_ko: string
  cautions_ko: string[]
  sources: string[]
}

export interface BookDetail extends BookSummary {
  info: Partial<BookResearch>
  units: { title: string; minutes: number }[]
  units_done: number[]
  sessions: { id: number; day: string; minutes: number; units: number[]; score: number | null; band: number | null; note: string | null }[]
}

// ---------- writing & ink ----------

export interface WritingTask {
  key: 'email' | 'discussion' | 'journal' | 'free'
  title: string
  desc: string
  minutes: number
  min_words: number
  max_words: number
}

export interface WritingResult {
  transcript: string
  level: number
  band: number
  scores: { task: number; organization: number; language: number }
  summary_ko: string
  corrected: string
  upgraded: string
  corrections: { original: string; better: string; type: string; note_ko: string }[]
  mistakes: { pattern: string; category: string; wrong: string; right: string; explanation_ko: string }[]
  expressions: { expr: string; meaning_ko: string }[]
  handwriting_ko: string
}

export interface WritingItem {
  id: number
  created_at: string
  task: WritingTask['key']
  task_title: string
  prompt: string
  words: number
  handwritten: boolean
  minutes: number
  level: number | null
  band: number | null
  text?: string
  result?: WritingResult
}

/** One pen stroke. Reader annotations: pts relative to the top-left of word `wi` of paragraph `p`, in px
 *  at word height `h` (older strokes: relative to paragraph `p` at paragraph width `w`).
 *  Note pages: pts in page units (page width 1000). Each point is [x, y, pressure]. */
export interface Stroke {
  id: string
  tool: 'pen' | 'hl'
  color: number
  size: number
  pts: [number, number, number][]
  p?: number
  w?: number
  wi?: number
  h?: number
}

/** Words p:a..b (inclusive word indices in paragraph p) marked with highlighter colour c. */
export interface Highlight {
  p: number
  a: number
  b: number
  c: number
}

export interface InkDoc {
  id: number | null
  scope: 'reading' | 'readnote' | 'book' | 'note' | 'writing'
  ref_id: number | null
  title: string | null
  strokes: Stroke[]
  highlights: Highlight[]
  height: number
  updated_at?: string
  stroke_count?: number
  highlight_count?: number
}

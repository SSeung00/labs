export type Slot = 'morning' | 'day' | 'evening' | 'night' | 'anytime'
export type Kind = 'check' | 'count' | 'minutes' | 'number'
export type Schedule = 'daily' | 'days' | 'weekly'
export type Category = 'health' | 'exercise' | 'study' | 'mind' | 'life'
export type EntryState = '' | 'done' | 'easy' | 'skip'
/** The day's traffic light. off = today with nothing done yet (or a future day). */
export type Light = 'green' | 'yellow' | 'red' | 'off' | 'none' | 'rest'

export interface HabitInput {
  name: string
  emoji: string
  color: string
  category: Category
  slot: Slot
  kind: Kind
  target: number
  unit: string
  schedule: Schedule
  days: number[]
  per_week: number
  easy_name: string
  cue: string
  reminder: string | null
  modes: number[]
  note: string
}

export interface Habit extends HabitInput {
  id: number
  sort: number
  archived: boolean
  start_date: string
}

export interface EntryData {
  value: number
  state: EntryState
  note: string
}

export interface DayHabit extends Habit {
  entry: EntryData | null
  done: boolean
  counted: boolean
  week_done: number
  streak: { current: number; at_risk: boolean }
}

export interface Signal {
  day: string
  done: number
  total: number
  rate: number | null
  color: Light
}

export interface Mode {
  id: number
  name: string
  emoji: string
  is_default: boolean
}

export interface Period {
  id: number
  kind: 'mode' | 'break'
  mode_id: number | null
  start: string
  end: string
  note: string
}

export interface Todo {
  id: string
  title: string
  day: string
  time: string | null
  done: boolean
  sort: number
}

export interface DayLog {
  day: string
  mood: number | null
  energy: number | null
  sleep_hours: number | null
  weight: number | null
  answers: Record<string, string>
  note: string
}

export interface DayPayload {
  day: string
  today: string
  mode: Mode | null
  rest: Period | null
  signal: Signal
  streak: { current: number }
  habits: DayHabit[]
  todos: Todo[]
  overdue: number
  log: DayLog
  week: Signal[]
  questions: string[]
  thresholds: { green: number; yellow: number }
  has_habits: boolean
}

export interface Settings {
  green_at: number
  yellow_at: number
  day_start_hour: number
  morning_on: boolean
  morning_time: string
  review_on: boolean
  review_time: string
  weekend_quiet: boolean
  celebrate: boolean
  questions: string[]
  onboarded: boolean
}

export interface Theme {
  key: string
  name: string
  emoji: string
  habits: Partial<HabitInput>[]
}

export interface JournalEntry extends DayLog {
  signal: Signal
  done: string[]
  mode: Mode | null
}

export type HeatCode = 'none' | 'rest' | 'done' | 'easy' | 'skip' | 'miss' | 'todo' | 'future'

export interface HabitStats extends Habit {
  rate30: number | null
  done30: number
  streak: { current: number; at_risk: boolean }
  best: number
  heat_start: string
  heat: HeatCode[]
  total_done: number
}

export interface Badge {
  key: string
  emoji: string
  title: string
  desc: string
  earned: boolean
  progress: number
}

export interface Stats {
  today: string
  calendar: Signal[]
  weeks: { start: string; done: number; total: number; rate: number | null; green_days: number }[]
  habits: HabitStats[]
  body: { day: string; mood: number | null; energy: number | null; sleep_hours: number | null; weight: number | null }[]
  streak: { current: number; best: number }
  badges: Badge[]
}

export interface DesktopStatus {
  supervised: boolean
  service: string | null
  autostart: boolean
  shortcuts: boolean
  build: { build: string } | null
  windows: boolean
}

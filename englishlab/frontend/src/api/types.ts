export type Skill = 'reading' | 'listening' | 'speaking' | 'writing' | 'vocab'

export interface Levels {
  levels: Record<Skill, number | null>
  labels: Record<Skill, string>
  overall: number | null
  overall_label: string
  toefl: { reading: number | null; listening: number | null; speaking: number | null; writing: number | null; total: number | null }
}

export interface Streak {
  current: number
  longest: number
  studied_today: boolean
  at_risk: boolean
  freezes: number
  goal_streak: number
  days_total: number
}

export interface CardCounts {
  total: number
  due: number
  new: number
  reviewed_today: number
  new_today: number
}

export interface Badge {
  key: string
  title: string
  desc: string
  achieved_at: string | null
  new: boolean
}

export interface Block {
  key: 'review' | 'read' | 'listen' | 'talk' | 'write' | 'book'
  book_id?: number
  title: string
  desc: string
  link: string
  target: number
  done: number
  complete: boolean
}

export interface Today {
  date: string
  needs_placement: boolean
  goal_minutes: number
  minutes: number
  goal_met: boolean
  blocks: Block[]
  has_plan: boolean
  streak: Streak
  cards: CardCounts
  coach_tip: string | null
  levels: Levels
  known_words: number
  input_hours: number
  new_badges: Badge[]
}

export interface Profile {
  name: string
  goal: string
  target_date: string
  daily_minutes: number
  daily_goal_minutes: number
  interests: string[]
  self_level: string
  voice: string
  tts_rate: number
  new_cards_per_day: number
  max_reviews_per_day: number
  auto_mistake_cards: boolean
  hide_ai_text: boolean
  onboarded: boolean
}

export interface ProfileResponse {
  profile: Profile
  voices: { id: string; label: string }[]
  memory: string[]
  vocab_estimate: number
  retention: number
}

export interface TtsClip {
  key: string
  marks: { w: string; t: number; d: number }[]
}

export interface Gloss {
  lemma: string
  pos: string
  meaning_ko: string
  definition_en: string
  ipa: string
  note_ko: string
  example_en: string
  example_ko: string
  rank: number | null
}

export interface ReadingSummary {
  id: number
  title: string
  created_at: string
  source_kind: 'url' | 'text' | 'topic'
  source_url: string | null
  mode: 'adapt' | 'gloss'
  level: number | null
  level_label: string
  word_count: number
  coverage: number | null
  finished_at: string | null
  minutes: number
  quiz_score: number | null
  summary_ko: string | null
}

export interface Reading extends ReadingSummary {
  body: string
  original: string | null
  unknown: string[]
  unknown_forms: Record<string, string>
  coverage_now: number
  data: {
    targets: { term: string; meaning_ko: string; definition_en: string }[]
    expressions: { expr: string; meaning_ko: string; note_ko: string }[]
    questions: { q: string; choices: string[]; answer: number; explanation_ko: string }[]
    summary_ko: string
    talk_prompt: string
    source_coverage: number | null
    quick_gloss?: Record<string, string>
  }
}

export interface CardItem {
  id: number
  kind: 'word' | 'phrase' | 'correction'
  term: string
  lemma: string | null
  context: string | null
  prompt: string | null
  meaning_ko: string | null
  definition_en: string | null
  ipa: string | null
  examples: { en: string; ko: string }[]
  note: string | null
  enriched: boolean
  reps: number
  lapses: number
  due: string
  state: number | null
  stability: number | null
  suspended: boolean
  created_at: string
  source_kind: string | null
  intervals?: Record<string, number>
}

export interface Mistake {
  id: number
  pattern: string
  category: 'grammar' | 'vocabulary' | 'naturalness' | 'pronunciation'
  wrong: string
  right: string
  explanation_ko: string
  count: number
  last_seen: string
  card_id: number | null
  resolved: boolean
}

export interface Correction {
  original: string
  better: string
  type: string
  note_ko: string
}

export interface SpeechStats {
  words: number
  seconds: number
  wpm: number
  long_pauses: number
  fillers: number
  unclear_words: string[]
}

export interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
  data: { nudge?: string; corrections?: Correction[]; upgrade?: string; stats?: SpeechStats }
  audio_seconds: number | null
  words: number | null
  replaced: boolean
  created_at: string
}

export interface TalkReport {
  summary_ko: string
  level: number
  scores: { accuracy: number; complexity: number; fluency: number; pronunciation: number }
  caf_ko: { accuracy: string; complexity: string; fluency: string; pronunciation: string }
  focus: { title_ko: string; why_ko: string; practice_en: string }[]
  mistakes: { pattern: string; category: string; wrong: string; right: string; explanation_ko: string }[]
  upgrades: { original: string; better: string; why_ko: string }[]
  expressions: { expr: string; meaning_ko: string; example: string }[]
  toefl_band: number
  memory_add: string[]
  memory_remove: string[]
  next_ko: string
}

export interface TalkMetrics {
  turns: number
  words: number
  speaking_seconds: number
  wpm: number | null
  words_per_turn: number
  errors_per_100w: number | null
  fillers_per_100w: number | null
  long_pauses: number
  lexical_diversity: number | null
}

export interface Conversation {
  id: number
  mode: 'free' | 'roleplay' | 'interview' | 'reading'
  title: string
  created_at: string
  ended_at: string | null
  minutes: number
  metrics: TalkMetrics | Record<string, never>
  level: number | null
  messages?: ChatMessage[]
  report?: TalkReport | null
  scenario?: Record<string, unknown>
}

export interface Scenario {
  key: string
  title: string
  desc: string
}

export interface PlacementView {
  id: number
  status: 'generating' | 'ready' | 'error'
  error: string | null
  done: string[]
  finished: boolean
  result: PlacementResult | null
  vocab?: string[]
  reading?: { level: string; title: string; text: string; questions: { q: string; choices: string[] }[] }[]
  dictation?: { level: string; index: number }[]
  speaking?: { prompt: string; seconds: number }[]
  writing?: { prompt: string; min_words: number; max_words: number }
}

export interface PlacementResult {
  levels: { reading: number; listening: number; speaking: number; writing: number }
  summary_ko: string
  strengths_ko: string[]
  weaknesses_ko: string[]
  focus_ko: { title: string; why: string; how: string }[]
  speaking_feedback_ko: string
  writing_feedback_ko: string
  writing_improved: string
  outlook_ko: string
  mistakes: { pattern: string; wrong: string; right: string; explanation_ko: string }[]
}

export interface AiUsage {
  available: boolean
  provider: 'cli' | 'api'
  provider_pref: 'auto' | 'cli' | 'api'
  cli: { available: boolean; path: string | null; version: string | null; logged_in: boolean | null; reason: string | null }
  api_key: boolean
  cli_month_equiv_usd: number
  budget_usd: number
  month_usd: number
  remaining_usd: number
  all_time_usd: number
  by_feature: Record<string, { calls: number; usd: number }>
}

export interface AiConfig {
  features: { key: string; label: string; model: string; effort: string; default_model: string; default_effort: string }[]
  models: { id: string; label: string; input_per_mtok: number; output_per_mtok: number }[]
  efforts: string[]
}

export interface Stats {
  levels: Levels
  level_history: { at: string; skill: Skill; level: number; source: string; source_label: string; note: string | null }[]
  streak: Streak
  calendar: { day: string; minutes: number; frozen: boolean; goal_met: boolean }[]
  minutes_by_kind: Record<string, number>
  minutes_by_kind_7d: Record<string, number>
  input_hours: number
  input_goal_hours: number
  known_words: number
  vocab_goal: number
  cards: CardCounts
  retention: { reviews: number; retention: number | null }
  speaking_trend: { at: string; wpm: number | null; errors_per_100w: number | null; lexical_diversity: number | null; level: number | null }[]
  mistakes: Mistake[]
  badges: Badge[]
  target_date: string
  last_placement: string | null
  ai: AiUsage
}

export * from './plan-types'

import type { DayHabit, DayPayload, EntryData, EntryState, Light, Signal, Slot } from '@/api/types'
import type { Op } from './outbox'

export const SLOTS: { key: Slot; label: string; emoji: string }[] = [
  { key: 'morning', label: '아침', emoji: '🌅' },
  { key: 'day', label: '낮', emoji: '☀️' },
  { key: 'evening', label: '저녁', emoji: '🌆' },
  { key: 'night', label: '자기 전', emoji: '🌙' },
  { key: 'anytime', label: '언제든', emoji: '⏳' },
]

export const isDone = (state: EntryState | undefined) => state === 'done' || state === 'easy'

/** Same rules as the server's set_entry, so the screen can update before the PC answers. */
export function nextEntry(h: DayHabit, change: { value?: number; state?: EntryState; note?: string }): EntryData {
  const cur = h.entry ?? { value: 0, state: '' as EntryState, note: '' }
  let { value, state, note } = cur
  const quantity = h.kind !== 'check'
  if (change.value !== undefined) {
    value = Math.max(0, change.value)
    if (quantity && change.state === undefined) {
      if (value >= h.target) state = 'done'
      else if (state === 'done') state = ''
    }
  }
  if (change.state !== undefined) {
    state = change.state
    if (!quantity) value = isDone(state) ? 1 : 0
    else if (state === 'done' && change.value === undefined) value = Math.max(value, h.target)
  }
  if (change.note !== undefined) note = change.note
  return { value, state, note }
}

export function lightFor(done: number, total: number, day: string, today: string, t: DayPayload['thresholds']): Light {
  if (!total) return 'none'
  if (day > today || (day === today && done === 0)) return 'off'
  const rate = done / total
  return rate >= t.green ? 'green' : rate >= t.yellow ? 'yellow' : 'red'
}

function withEntry(h: DayHabit, e: EntryData): DayHabit {
  const done = isDone(e.state)
  const empty = !e.state && !e.value && !e.note
  const delta = Number(done) - Number(h.done)
  return {
    ...h,
    entry: empty ? null : e,
    done,
    week_done: h.week_done + delta,
    streak: { ...h.streak, current: Math.max(0, h.streak.current + delta), at_risk: done ? false : h.streak.at_risk },
  }
}

/** Server payload + this day's queued changes → what the screen should show. */
export function overlay(p: DayPayload, ops: Op[]): DayPayload {
  const mine = ops.filter((o) => o.day === p.day)
  if (!mine.length) return p
  let { habits, todos, log } = p
  for (const op of mine) {
    if (op.kind === 'entry') {
      habits = habits.map((h) => (h.id === op.habit_id ? withEntry(h, { value: op.value, state: op.state, note: op.note }) : h))
    } else if (op.kind === 'todo') {
      const exists = todos.some((t) => t.id === op.id)
      todos = exists
        ? todos.map((t) => (t.id === op.id ? { ...t, ...op.changes } : t))
        : [...todos, { id: op.id, title: '', day: p.day, time: null, done: false, sort: 999, ...op.changes }]
      todos = todos.filter((t) => t.day === p.day)
    } else if (op.kind === 'todo-del') {
      todos = todos.filter((t) => t.id !== op.id)
    } else if (op.kind === 'log') {
      log = { ...log, ...op.changes }
    }
  }
  return recompute({ ...p, habits, todos, log })
}

function recompute(p: DayPayload): DayPayload {
  if (p.rest) return p
  const done = p.habits.filter((h) => h.done).length
  const total = p.habits.filter((h) => h.done || (h.counted && h.entry?.state !== 'skip')).length
  const color = lightFor(done, total, p.day, p.today, p.thresholds)
  const signal: Signal = { day: p.day, done, total, rate: total ? done / total : null, color }
  let streak = p.streak
  if (p.day === p.today && (p.signal.color === 'green') !== (color === 'green')) {
    streak = { current: Math.max(0, p.streak.current + (color === 'green' ? 1 : -1)) }
  }
  return { ...p, signal, streak, week: p.week.map((w) => (w.day === p.day ? signal : w)) }
}

// ---------- dates ----------

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
export const WEEKDAYS_MON = ['월', '화', '수', '목', '금', '토', '일']

export function parseDay(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function fmtDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function addDays(s: string, n: number): string {
  const d = parseDay(s)
  d.setDate(d.getDate() + n)
  return fmtDay(d)
}

export function dayLabel(s: string, today?: string): string {
  const d = parseDay(s)
  const base = `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS[d.getDay()]}요일`
  if (!today || s === today) return base
  const diff = Math.round((parseDay(s).getTime() - parseDay(today).getTime()) / 86_400_000)
  if (diff === -1) return `어제 · ${base}`
  if (diff === 1) return `내일 · ${base}`
  return base
}

export function shortDay(s: string): string {
  const d = parseDay(s)
  return `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAYS[d.getDay()]})`
}

export const weekdayShort = (s: string) => WEEKDAYS[parseDay(s).getDay()]

export function fmtValue(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

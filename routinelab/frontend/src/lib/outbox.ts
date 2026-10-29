import { create } from 'zustand'
import { api, ApiError } from '@/api/client'
import type { DayLog, DayPayload, EntryState, Todo } from '@/api/types'

/**
 * Check-ins, todos and journal edits go through this queue instead of straight to the PC.
 * The screen shows server data with the queued changes laid on top (see lib/day.ts), so a tap
 * takes effect at once, and when the PC is asleep or out of reach the change waits here
 * (saved in localStorage) and is sent when it comes back. Every op carries an absolute value,
 * so sending one twice is harmless.
 */
export type Op = { seq: number; key: string; day: string; tries: number } & (
  | { kind: 'entry'; habit_id: number; value: number; state: EntryState; note: string }
  | { kind: 'todo'; id: string; changes: Partial<Pick<Todo, 'title' | 'time' | 'done' | 'sort' | 'day'>> }
  | { kind: 'todo-del'; id: string }
  | { kind: 'log'; changes: Partial<Omit<DayLog, 'day'>> }
)

type NewOp = Op extends infer T ? (T extends Op ? Omit<T, 'seq' | 'tries'> : never) : never

const STORE_KEY = 'routinelab-outbox'
const TIMEOUT_MS = 10_000
const MAX_TRIES = 8

function load(): Op[] {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return raw ? (JSON.parse(raw) as Op[]) : []
  } catch {
    return []
  }
}

function save(ops: Op[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(ops))
  } catch {
    /* storage unavailable: the queue still works for this session */
  }
}

interface OutboxState {
  ops: Op[]
  /** Last failure that wasn't about being offline (shown once as a toast). */
  error: string | null
  offline: boolean
  add: (op: NewOp) => void
  remove: (seq: number) => void
  clearError: () => void
}

let seq = Date.now()

export const useOutbox = create<OutboxState>((set, get) => ({
  ops: load(),
  error: null,
  offline: false,
  add: (op) => {
    const ops = [...get().ops]
    const i = ops.findIndex((o) => o.key === op.key)
    const prev = i >= 0 ? ops[i] : null
    let next = { ...op, seq: ++seq, tries: 0 } as Op
    // Partial updates of the same todo / journal day add up; everything else replaces.
    if (prev && prev.kind === next.kind && (next.kind === 'todo' || next.kind === 'log')) {
      next = { ...next, changes: { ...(prev as typeof next).changes, ...next.changes } } as Op
    }
    if (i >= 0) ops[i] = next
    else ops.push(next)
    save(ops)
    set({ ops })
  },
  remove: (s) => {
    const ops = get().ops.filter((o) => o.seq !== s)
    save(ops)
    set({ ops })
  },
  clearError: () => set({ error: null }),
}))

async function send(op: Op): Promise<DayPayload> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  const put = (path: string, body: unknown) => api<DayPayload>(path, { method: 'PUT', body: JSON.stringify(body), signal: ctrl.signal })
  try {
    switch (op.kind) {
      case 'entry':
        return await put('/entries', { habit_id: op.habit_id, day: op.day, value: op.value, state: op.state, note: op.note })
      case 'todo':
        return await put(`/todos/${encodeURIComponent(op.id)}`, { day: op.day, ...op.changes })
      case 'todo-del':
        return await api<DayPayload>(`/todos/${encodeURIComponent(op.id)}`, { method: 'DELETE', signal: ctrl.signal })
      case 'log':
        return await put(`/journal/${op.day}`, op.changes)
    }
  } finally {
    clearTimeout(timer)
  }
}

type Listener = (payload: DayPayload) => void
const listeners = new Set<Listener>()

/** Called with the server's fresh day after each op lands. */
export function onSynced(fn: Listener) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

let running: Promise<void> | null = null

async function drain(): Promise<void> {
  for (;;) {
    const op = useOutbox.getState().ops[0]
    if (!op) return
    try {
      const payload = await send(op)
      useOutbox.getState().remove(op.seq)
      useOutbox.setState({ offline: false })
      listeners.forEach((l) => l(payload))
    } catch (e) {
      const rejected = e instanceof ApiError && e.status >= 400 && e.status < 500 && e.code !== 'locked' && e.code !== 'pin_not_set'
      if (rejected || op.tries + 1 >= MAX_TRIES) {
        useOutbox.getState().remove(op.seq)
        useOutbox.setState({ error: e instanceof Error ? e.message : '저장하지 못했어요.' })
        continue
      }
      const ops = useOutbox.getState().ops.map((o) => (o.seq === op.seq ? { ...o, tries: o.tries + 1 } : o))
      save(ops)
      useOutbox.setState({ ops, offline: !(e instanceof ApiError) || e.status >= 500 })
      return
    }
  }
}

/** Send queued ops in order. Stops at the first one that can't get through (retried later). */
export function flush(): Promise<void> {
  // .finally runs after the assignment even when drain() finishes synchronously (empty queue).
  running ??= drain().finally(() => {
    running = null
  })
  return running
}

export function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }
}

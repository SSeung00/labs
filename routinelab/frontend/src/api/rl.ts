import { useCallback, useEffect } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api, post } from './client'
import type {
  DayHabit, DayLog, DayPayload, DesktopStatus, EntryState, Habit, HabitInput, JournalEntry, Mode, Period, Settings,
  Stats, Theme, Todo,
} from './types'
import { flush, newId, onSynced, useOutbox } from '@/lib/outbox'
import { nextEntry, overlay } from '@/lib/day'

const put = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) })
const del = <T>(path: string) => api<T>(path, { method: 'DELETE' })

// ---------- the day ----------

/** Cache key: an explicit date, or 'today' for "whatever day it is on the PC". */
export const dayKey = (day?: string) => ['day', day ?? 'today'] as const

/** Store a fresh day payload under its date (and under 'today' when it is today). */
export function putDay(qc: QueryClient, p: DayPayload) {
  qc.setQueryData(dayKey(p.day), p)
  const cur = qc.getQueryData<DayPayload>(dayKey())
  if (p.day === p.today || cur?.day === p.day) qc.setQueryData(dayKey(), p)
}

export function useDay(day?: string) {
  const ops = useOutbox((s) => s.ops)
  const select = useCallback((p: DayPayload) => overlay(p, ops), [ops])
  return useQuery({
    queryKey: dayKey(day),
    queryFn: () => api<DayPayload>(day ? `/today?day=${day}` : '/today'),
    select,
    refetchInterval: 5 * 60_000,
  })
}

/** Keeps the outbox draining and caches in step with what the PC confirmed. Mounted once in AppShell. */
export function useOutboxSync() {
  const qc = useQueryClient()
  useEffect(() => {
    let refresh: number | undefined
    const off = onSynced((p) => {
      putDay(qc, p)
      window.clearTimeout(refresh)
      refresh = window.setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['stats'] })
        qc.invalidateQueries({ queryKey: ['journal'] })
      }, 1500)
    })
    const kick = () => void flush()
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        kick()
        qc.invalidateQueries({ queryKey: ['day'] })
      }
    }
    // A notification's "했어요" button changed something while the app was in the background.
    const onMessage = (e: MessageEvent) => e.data?.type === 'routinelab:changed' && qc.invalidateQueries({ queryKey: ['day'] })
    window.addEventListener('online', kick)
    document.addEventListener('visibilitychange', onVisible)
    navigator.serviceWorker?.addEventListener('message', onMessage)
    const timer = window.setInterval(() => useOutbox.getState().ops.length && kick(), 20_000)
    kick()
    return () => {
      off()
      window.removeEventListener('online', kick)
      document.removeEventListener('visibilitychange', onVisible)
      navigator.serviceWorker?.removeEventListener('message', onMessage)
      window.clearInterval(timer)
    }
  }, [qc])
}

export function useDayActions(day: string) {
  const add = useOutbox((s) => s.add)
  const queue: typeof add = (op) => {
    add(op)
    void flush()
  }
  return {
    setEntry: (h: DayHabit, change: { value?: number; state?: EntryState; note?: string }) =>
      queue({ kind: 'entry', key: `entry:${h.id}:${day}`, day, habit_id: h.id, ...nextEntry(h, change) }),
    addTodo: (title: string, time: string | null) => {
      const id = newId()
      queue({ kind: 'todo', key: `todo:${id}`, day, id, changes: { title, time, done: false, day } })
    },
    updateTodo: (t: Todo, changes: Partial<Pick<Todo, 'title' | 'time' | 'done'>>) =>
      queue({ kind: 'todo', key: `todo:${t.id}`, day, id: t.id, changes }),
    deleteTodo: (t: Todo) => queue({ kind: 'todo-del', key: `todo:${t.id}`, day, id: t.id }),
    saveLog: (changes: Partial<Omit<DayLog, 'day'>>) => queue({ kind: 'log', key: `log:${day}`, day, changes }),
  }
}

/** Mode / rest-day / carry-over need the PC to recompute the day; they don't queue offline. */
export function useDayMutations() {
  const qc = useQueryClient()
  const done = (p: DayPayload) => {
    putDay(qc, p)
    qc.invalidateQueries({ queryKey: ['stats'] })
    qc.invalidateQueries({ queryKey: ['modes'] })
  }
  return {
    mode: useMutation({ mutationFn: (b: { day: string; mode_id: number | null }) => put<DayPayload>('/day/mode', b), onSuccess: done }),
    rest: useMutation({ mutationFn: (b: { day: string; rest: boolean }) => put<DayPayload>('/day/rest', b), onSuccess: done }),
    carry: useMutation({ mutationFn: (day: string) => post<DayPayload>('/todos/carry', { day }), onSuccess: done }),
  }
}

// ---------- routines ----------

export function useHabits() {
  return useQuery({ queryKey: ['habits'], queryFn: () => api<{ habits: Habit[]; modes: Mode[] }>('/habits') })
}

function useRoutineInvalidate() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['habits'] })
    qc.invalidateQueries({ queryKey: ['day'] })
    qc.invalidateQueries({ queryKey: ['stats'] })
    qc.invalidateQueries({ queryKey: ['modes'] })
  }
}

export function useHabitMutations() {
  const invalidate = useRoutineInvalidate()
  return {
    save: useMutation({
      mutationFn: ({ id, body }: { id?: number; body: HabitInput }) => (id ? put<Habit>(`/habits/${id}`, body) : post<Habit>('/habits', body)),
      onSuccess: invalidate,
    }),
    bulk: useMutation({ mutationFn: (habits: Partial<HabitInput>[]) => post('/habits/bulk', { habits }), onSuccess: invalidate }),
    archive: useMutation({ mutationFn: ({ id, archived }: { id: number; archived: boolean }) => post(`/habits/${id}/archive`, { archived }), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: (id: number) => del(`/habits/${id}`), onSuccess: invalidate }),
    reorder: useMutation({ mutationFn: (ids: number[]) => post('/habits/reorder', { ids }), onSuccess: invalidate }),
  }
}

export function useTemplates() {
  return useQuery({ queryKey: ['templates'], queryFn: () => api<{ themes: Theme[] }>('/templates'), staleTime: Infinity })
}

// ---------- modes & periods ----------

export interface ModesPayload {
  modes: (Mode & { habits: number })[]
  periods: Period[]
  today: string
}

export function useModes() {
  return useQuery({ queryKey: ['modes'], queryFn: () => api<ModesPayload>('/modes') })
}

export function useModeMutations() {
  const qc = useQueryClient()
  const done = (m: ModesPayload) => {
    qc.setQueryData(['modes'], m)
    qc.invalidateQueries({ queryKey: ['habits'] })
    qc.invalidateQueries({ queryKey: ['day'] })
    qc.invalidateQueries({ queryKey: ['stats'] })
  }
  return {
    create: useMutation({ mutationFn: (b: { name: string; emoji: string }) => post<ModesPayload>('/modes', b), onSuccess: done }),
    update: useMutation({
      mutationFn: ({ id, ...b }: { id: number; name: string; emoji: string; is_default?: boolean }) => put<ModesPayload>(`/modes/${id}`, b),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: (id: number) => del<ModesPayload>(`/modes/${id}`), onSuccess: done }),
    addPeriod: useMutation({
      mutationFn: (b: Omit<Period, 'id'>) => post<ModesPayload>('/periods', b),
      onSuccess: done,
    }),
    removePeriod: useMutation({ mutationFn: (id: number) => del<ModesPayload>(`/periods/${id}`), onSuccess: done }),
  }
}

// ---------- journal & stats ----------

export function useJournal() {
  return useInfiniteQuery({
    queryKey: ['journal'],
    queryFn: ({ pageParam }) => api<{ entries: JournalEntry[]; more: boolean }>(`/journal?limit=20${pageParam ? `&before=${pageParam}` : ''}`),
    initialPageParam: '',
    getNextPageParam: (last) => (last.more ? last.entries[last.entries.length - 1]?.day : undefined),
  })
}

export function useStats() {
  return useQuery({ queryKey: ['stats'], queryFn: () => api<Stats>('/stats') })
}

// ---------- settings, push, PC app ----------

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') })
}

export function useSaveSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (changes: Partial<Settings>) => put<Settings>('/settings', { changes }),
    onSuccess: (s) => {
      qc.setQueryData(['settings'], s)
      qc.invalidateQueries({ queryKey: ['day'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
    },
  })
}

export interface PushInfo {
  key: string
  devices: { label: string; endpoint: string }[]
}

export function usePushInfo() {
  return useQuery({ queryKey: ['push'], queryFn: () => api<PushInfo>('/push/key') })
}

export function useDesktop() {
  return useQuery({ queryKey: ['desktop'], queryFn: () => api<DesktopStatus>('/desktop') })
}

export function useSetAutostart() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (enabled: boolean) => put<DesktopStatus>('/desktop/autostart', { enabled }),
    onSuccess: (s) => qc.setQueryData(['desktop'], s),
  })
}

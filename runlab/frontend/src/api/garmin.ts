import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, post } from './client'

export interface GarminStatus {
  connected: boolean
  mfa_pending: boolean
  full_name: string | null
  display_name: string | null
  last_sync: string | null
}

export type SyncPhase = 'idle' | 'starting' | 'activities' | 'streams' | 'wellness' | 'weather' | 'analysis' | 'import' | 'done' | 'error'

export interface SyncStatus {
  running: boolean
  phase: SyncPhase
  current: number
  total: number
  message: string
  error: string | null
  new_activities: number
  new_wellness_days: number
  started_at: string | null
  finished_at: string | null
  log: string[]
}

export function useGarminStatus() {
  return useQuery({ queryKey: ['garmin', 'status'], queryFn: () => api<GarminStatus>('/garmin/status') })
}

export function useSyncStatus() {
  return useQuery({
    queryKey: ['sync', 'status'],
    queryFn: () => api<SyncStatus>('/sync/status'),
    refetchInterval: (q) => (q.state.data?.running ? 800 : false),
  })
}

function useInvalidateAll() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['garmin'] })
    qc.invalidateQueries({ queryKey: ['sync'] })
    qc.invalidateQueries({ queryKey: ['health'] })
  }
}

export function useGarminLogin() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (b: { email: string; password: string }) => post<GarminStatus>('/garmin/login', b),
    onSuccess: invalidate,
  })
}

export function useGarminMfa() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (code: string) => post<GarminStatus>('/garmin/mfa', { code }),
    onSuccess: invalidate,
  })
}

export function useGarminLogout() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: () => post('/garmin/logout'), onSuccess: invalidate })
}

export function useStartSync() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: { full?: boolean; wellness_days?: number }) => post<SyncStatus>('/sync/start', b),
    onSuccess: (data) => qc.setQueryData(['sync', 'status'], data),
  })
}

export function useImportFiles() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (files: File[]) => {
      const fd = new FormData()
      files.forEach((f) => fd.append('files', f))
      return api<SyncStatus>('/import/files', { method: 'POST', body: fd })
    },
    onSuccess: (data) => qc.setQueryData(['sync', 'status'], data),
  })
}

export interface AutoSyncRun {
  day: string
  started_at: string
  attempts: number
  running?: boolean
  ok?: boolean
  finished_at?: string | null
  new_activities?: number
  new_wellness_days?: number
  error?: string | null
}

export interface AutoSync {
  enabled: boolean
  time: string
  /** False when this server isn't the background service (the scheduler only runs there). */
  active: boolean
  last: AutoSyncRun | null
  next_run: string | null
}

export function useAutoSync() {
  // Polled slowly so a scheduled run that starts while the page is open shows up.
  return useQuery({ queryKey: ['sync', 'auto'], queryFn: () => api<AutoSync>('/sync/auto'), refetchInterval: 60_000 })
}

export function useSetAutoSync() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: { enabled: boolean; time: string }) => api<AutoSync>('/sync/auto', { method: 'PUT', body: JSON.stringify(b) }),
    onSuccess: (data) => qc.setQueryData(['sync', 'auto'], data),
  })
}

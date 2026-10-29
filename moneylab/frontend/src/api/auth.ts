import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, post } from './client'

export interface AuthStatus {
  local: boolean
  pin_set: boolean
  authed: boolean
  retry_after: number
}

export interface RemoteStatus {
  installed: boolean
  running: boolean
  dns_name: string | null
  url: string | null
  serving: boolean
  serve_cmd: string
  pin_set: boolean
  qr_svg: string | null
}

export const AUTH_KEY = ['auth', 'status'] as const

export function useAuthStatus() {
  return useQuery({ queryKey: AUTH_KEY, queryFn: () => api<AuthStatus>('/auth/status'), staleTime: Infinity, retry: 1, retryDelay: 500 })
}

export function useUnlock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (pin: string) => post<{ ok: boolean }>('/auth/unlock', { pin }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: AUTH_KEY })
      // Anything that failed while locked should load now.
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'auth' })
    },
  })
}

export function useLock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await post('/auth/lock')
      // Drop the offline copy too, so a locked phone shows nothing.
      if ('caches' in window) await caches.delete('moneylab-api').catch(() => false)
    },
    onSuccess: () => {
      qc.clear()
      qc.invalidateQueries({ queryKey: AUTH_KEY })
    },
  })
}

export function useSetPin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (pin: string | null) => api<{ pin_set: boolean }>('/auth/pin', { method: 'PUT', body: JSON.stringify({ pin }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: AUTH_KEY })
      qc.invalidateQueries({ queryKey: ['remote'] })
    },
  })
}

export function useRemoteStatus() {
  return useQuery({ queryKey: ['remote', 'status'], queryFn: () => api<RemoteStatus>('/remote/status'), staleTime: 10_000 })
}

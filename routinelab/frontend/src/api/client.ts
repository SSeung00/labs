import { useQuery } from '@tanstack/react-query'
import { useNet } from '@/stores/net'

export class ApiError extends Error {
  readonly status: number
  readonly code: string | null
  constructor(status: number, message: string, code: string | null = null) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** Fired when the server says this (remote) device is locked; AuthGate re-checks and shows the PIN pad. */
export const LOCKED_EVENT = 'routinelab:locked'

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const isJson = typeof init?.body === 'string'
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: { ...(isJson ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    })
  } catch (e) {
    useNet.getState().setStale(true)
    throw e
  }
  // The service worker marks answers it made up from its saved copy while the PC is unreachable.
  useNet.getState().setStale(res.headers.get('x-routinelab-offline') === '1')
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let detail = text || res.statusText
    let code: string | null = null
    try {
      const parsed = JSON.parse(text)
      if (typeof parsed?.detail === 'string') detail = parsed.detail
      else if (typeof parsed?.detail?.message === 'string') {
        detail = parsed.detail.message
        code = parsed.detail.code ?? null
      } else if (Array.isArray(parsed?.detail) && parsed.detail[0]?.msg) detail = String(parsed.detail[0].msg)
      if (typeof parsed?.code === 'string') code = parsed.code
    } catch {
      /* not JSON */
    }
    if (code === 'locked' || code === 'pin_not_set') window.dispatchEvent(new Event(LOCKED_EVENT))
    throw new ApiError(res.status, detail, code)
  }
  return res.json() as Promise<T>
}

export interface Health {
  status: 'ok'
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => api<Health>('/health'),
    refetchInterval: 30_000,
  })
}

export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) })

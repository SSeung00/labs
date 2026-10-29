import { useCallback, useEffect, useState } from 'react'
import { CloudOff, Loader2, RotateCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useNet } from '@/stores/net'

const host = window.location.hostname
const onThisPc = ['localhost', '127.0.0.1', '[::1]'].includes(host) || host.endsWith('.localhost')

/**
 * Shown while answers come from the service worker's saved copy. Polls /api/ping (never cached)
 * and, as soon as the PC answers again, hides itself and refetches everything.
 */
export function OfflineBanner() {
  const stale = useNet((s) => s.stale)
  const setStale = useNet((s) => s.setStale)
  const qc = useQueryClient()
  const [checking, setChecking] = useState(false)

  const probe = useCallback(async () => {
    setChecking(true)
    try {
      const res = await fetch('/api/ping', { cache: 'no-store' })
      if (res.status < 500) {
        setStale(false)
        qc.invalidateQueries()
      }
    } catch {
      /* still unreachable */
    } finally {
      setChecking(false)
    }
  }, [qc, setStale])

  useEffect(() => {
    if (!stale) return
    const t = window.setInterval(probe, 5000)
    const onVisible = () => document.visibilityState === 'visible' && probe()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', probe)
    return () => {
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', probe)
    }
  }, [stale, probe])

  if (!stale) return null
  return (
    <div className="flex items-start gap-2 border-b bg-warn/15 px-4 py-2 text-xs text-warn sm:px-6">
      <CloudOff className="mt-px size-4 shrink-0" />
      <span className="flex-1">
        PC에 연결할 수 없어 마지막으로 받은 데이터를 보여주고 있어요.
        {!onThisPc && <span className="block text-[11px] opacity-80">휴대폰의 Tailscale이 켜져 있는지, PC가 켜져 있는지 확인해 주세요. 연결되면 자동으로 새로 불러와요.</span>}
      </span>
      <button onClick={probe} className="flex shrink-0 items-center gap-1 font-semibold" disabled={checking}>
        {checking ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />} 다시 시도
      </button>
    </div>
  )
}

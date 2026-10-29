import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

/** Something the user may be typing that a reload would throw away. */
function busy() {
  if (document.querySelector('[role=dialog]')) return true
  return [...document.querySelectorAll('textarea')].some((t) => t.value.trim().length > 0)
}

/**
 * Notices a newer web build on the PC. Opening the app always loads the latest build; this
 * covers a phone that kept RunLab open in the background while the PC rebuilt it.
 * Coming back to the app after a minute or more reloads silently (unless you're mid-edit);
 * otherwise a small banner offers the reload.
 */
export function UpdateBanner() {
  const [newer, setNewer] = useState(false)

  useEffect(() => {
    if (!import.meta.env.PROD) return
    let hiddenAt = 0
    const check = async (resumed: boolean) => {
      try {
        const res = await fetch('/version.json', { cache: 'no-store' })
        const v = res.ok ? ((await res.json()) as { build?: string }) : null
        navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => undefined)
        if (!v?.build || v.build === __BUILD_ID__) return
        if (resumed && !busy()) window.location.reload()
        else setNewer(true)
      } catch {
        /* PC unreachable: nothing to compare against */
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        return
      }
      check(hiddenAt > 0 && Date.now() - hiddenAt > 60_000)
    }
    document.addEventListener('visibilitychange', onVisibility)
    const timer = window.setInterval(() => check(false), 10 * 60_000)
    void check(false)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearInterval(timer)
    }
  }, [])

  if (!newer) return null
  return (
    <div className="flex items-center gap-2 border-b bg-accent-soft px-4 py-2 text-xs sm:px-6">
      <RefreshCw className="size-4 shrink-0 text-accent" />
      <span className="flex-1">RunLab이 업데이트됐어요.</span>
      <button onClick={() => window.location.reload()} className="font-semibold text-accent">
        새로고침
      </button>
    </div>
  )
}

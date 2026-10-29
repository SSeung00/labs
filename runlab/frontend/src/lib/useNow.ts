import { useEffect, useState } from 'react'

/** Current time as render-stable state; refreshes just after midnight so "today" rolls over. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const next = new Date(now)
    next.setHours(24, 0, 5, 0)
    const t = window.setTimeout(() => setNow(new Date()), next.getTime() - now.getTime())
    return () => window.clearTimeout(t)
  }, [now])
  return now
}

import { useSyncExternalStore } from 'react'

const subscribers = new Map<string, (cb: () => void) => () => void>()

function subscriber(query: string) {
  let fn = subscribers.get(query)
  if (!fn) {
    fn = (cb) => {
      const mql = matchMedia(query)
      mql.addEventListener('change', cb)
      return () => mql.removeEventListener('change', cb)
    }
    subscribers.set(query, fn)
  }
  return fn
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(subscriber(query), () => matchMedia(query).matches, () => false)
}

/** Same thresholds as the `split:` / `fold:` Tailwind breakpoints in index.css. */
export const useSplit = () => useMediaQuery('(min-width: 46rem)')
export const useUnfolded = () => useMediaQuery('(min-width: 37.5rem)')

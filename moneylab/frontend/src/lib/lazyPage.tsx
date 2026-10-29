import { lazy, Suspense, type ComponentType } from 'react'
import { PageSkeleton } from '@/components/layout/PageSkeleton'

/** Route element for a lazily loaded named-export page component. */
export function lazyPage<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M & string) {
  const Page = lazy(() => load().then((m) => ({ default: m[name] as ComponentType })))
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Page />
    </Suspense>
  )
}

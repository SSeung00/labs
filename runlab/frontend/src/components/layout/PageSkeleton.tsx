export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="h-9 w-44 animate-pulse rounded-lg bg-surface" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-card bg-surface" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-card bg-surface" />
    </div>
  )
}

export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="shimmer h-9 w-44 rounded-lg" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="shimmer h-24 rounded-card" />
        ))}
      </div>
      <div className="shimmer h-72 rounded-card" />
    </div>
  )
}

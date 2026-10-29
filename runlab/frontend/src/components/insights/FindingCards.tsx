import { Link } from 'react-router'
import { Lightbulb, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useFindings, useInsightMetrics, type Finding } from '@/api/life'
import { cn } from '@/lib/utils'

function FindingRow({ f }: { f: Finding }) {
  const Icon = f.good ? ThumbsUp : ThumbsDown
  return (
    <li className="flex gap-3 rounded-xl border bg-surface-2/40 px-3.5 py-3">
      <Icon className={cn('mt-0.5 size-4 shrink-0', f.good ? 'text-good' : 'text-warn')} />
      <div className="min-w-0">
        <p className="text-sm leading-relaxed">{f.text}</p>
        <p className="mt-0.5 text-[11px] text-subtle">{f.basis}</p>
      </div>
    </li>
  )
}

/**
 * Relationships found in the data, as sentences. `category` picks the ones that belong on this screen;
 * with none, an empty state says what would unlock them.
 */
export function FindingCards({ category, emptyHint }: { category: Finding['category']; emptyHint?: string }) {
  const { data, isPending } = useFindings()
  const { data: metrics = [] } = useInsightMetrics()
  const list = (data ?? []).filter((f) => f.category === category)
  const checkins = Math.max(0, ...metrics.filter((m) => m.group === '일지').map((m) => m.count))

  if (isPending) return <div className="h-20 animate-pulse rounded-xl bg-surface-2" />
  if (!list.length) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-dashed px-4 py-3 text-sm text-muted">
        <Lightbulb className="mt-0.5 size-4 shrink-0 text-subtle" />
        <span>
          {emptyHint ?? '아직 뚜렷한 패턴은 없어요.'} 체크인이 {checkins}일 쌓였어요. 15일 이상 모이면 수면·피로도가 러닝에 주는 영향을 찾아 드려요.{' '}
          <Link to="/journal" className="font-medium text-accent">
            일지 쓰기
          </Link>
        </span>
      </div>
    )
  }
  return (
    <ul className="space-y-2">
      {list.map((f) => (
        <FindingRow key={f.key} f={f} />
      ))}
      <li className="pt-1 text-[11px] text-subtle">함께 움직인다는 뜻이지 원인이라는 뜻은 아니에요. 거리와 기온의 영향은 빼고 비교했어요.</li>
    </ul>
  )
}

import { ArrowLeftRight, CreditCard, HandCoins, Landmark, PiggyBank, TrendingUp, Wallet } from 'lucide-react'
import type { Category, Kind, Txn } from '@/api/money'
import { useCategories } from '@/api/money'
import { wonSigned } from '@/lib/format'
import { cn } from '@/lib/utils'

/** What to call a row: my own title if I gave one, else the merchant text. */
export const txnName = (t: { title?: string | null; merchant: string }) => t.title || t.merchant || '(내용 없음)'

export function useCategoryMap(): Map<string, Category> {
  const { data } = useCategories()
  return new Map((data ?? []).map((c) => [c.name, c]))
}

export interface CategoryBranch {
  parent: Category
  children: Category[]
}

/** 대분류 with their 소분류, in display order. income: only 수입, false: everything but 수입. */
export function useCategoryTree(income?: boolean): CategoryBranch[] {
  const { data } = useCategories()
  const all = [...(data ?? [])].sort((a, b) => a.sort - b.sort)
  return all
    .filter((c) => !c.parent && (income == null || (c.group === '수입') === income))
    .map((p) => ({ parent: p, children: all.filter((c) => c.parent === p.name) }))
}

/** <option>s grouped by 대분류; picking the 대분류 itself means "this, not more specific". */
export function CategoryOptions({ income }: { income?: boolean }) {
  const tree = useCategoryTree(income)
  return (
    <>
      {tree.map(({ parent, children }) =>
        children.length ? (
          <optgroup key={parent.name} label={parent.name}>
            <option value={parent.name}>{parent.name} (전체)</option>
            {children.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </optgroup>
        ) : (
          <option key={parent.name} value={parent.name}>
            {parent.name}
          </option>
        ),
      )}
    </>
  )
}

export function CategoryDot({ color, className }: { color?: string; className?: string }) {
  return <span className={cn('inline-block size-2 shrink-0 rounded-full', className)} style={{ background: color ?? 'var(--text-subtle)' }} />
}

const NON_SPENDING: Record<Exclude<Kind, 'expense' | 'income'>, { label: string; icon: typeof Wallet }> = {
  transfer: { label: '이체', icon: ArrowLeftRight },
  card_payment: { label: '카드대금', icon: CreditCard },
  savings: { label: '저축', icon: PiggyBank },
  invest: { label: '투자', icon: TrendingUp },
  claim: { label: '정산', icon: HandCoins },
}

export function CategoryBadge({ txn, onClick }: { txn: Pick<Txn, 'kind' | 'category'>; onClick?: () => void }) {
  const cats = useCategoryMap()
  const Tag = onClick ? 'button' : 'span'
  if (txn.kind !== 'expense' && txn.kind !== 'income') {
    const k = NON_SPENDING[txn.kind]
    return (
      <Tag onClick={onClick} className="inline-flex h-6 items-center gap-1 rounded-md bg-surface-3 px-2 text-[11.5px] font-medium text-muted">
        <k.icon className="size-3" /> {k.label}
      </Tag>
    )
  }
  const c = cats.get(txn.category)
  const uncategorized = txn.category === '미분류'
  return (
    <Tag
      onClick={onClick}
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[11.5px] font-medium',
        uncategorized ? 'border border-dashed border-warn/60 text-warn' : 'bg-surface-2 text-text',
      )}
    >
      {!uncategorized && <CategoryDot color={c?.color} />}
      {txn.category}
    </Tag>
  )
}

export function Amount({ txn, className }: { txn: Pick<Txn, 'amount' | 'kind' | 'dup_of_id'>; className?: string }) {
  const muted = txn.kind !== 'expense' && txn.kind !== 'income'
  return (
    <span
      className={cn(
        'num whitespace-nowrap font-semibold',
        txn.amount > 0 && !muted && 'text-good',
        muted && 'text-muted',
        txn.dup_of_id && 'text-subtle line-through',
        className,
      )}
    >
      {wonSigned(txn.amount)}
    </span>
  )
}

export function AccountIcon({ kind, className }: { kind: string; className?: string }) {
  const Icon =
    kind === 'card' || kind === 'check_card' ? CreditCard : kind === 'pay' ? Wallet : kind === 'savings' ? PiggyBank : kind === 'invest' ? TrendingUp : Landmark
  return <Icon className={cn('size-3.5 shrink-0', className)} />
}

import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useMotionValue, useTransform, type PanInfo } from 'framer-motion'
import { Copy, Plane, Radio, Sparkles } from 'lucide-react'
import type { Txn } from '@/api/money'
import { fmtDay, fmtMonth, fmtTime, wonSigned } from '@/lib/format'
import { cn } from '@/lib/utils'
import { AccountIcon, Amount, CategoryBadge, txnName } from './bits'
import { TxnSheet } from './TxnSheet'

export interface SwipeAction {
  label: ReactNode
  className: string // background color classes
  run: (t: Txn) => void
}

const SWIPE_AT = 88

function RowBody({ txn }: { txn: Txn }) {
  return (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{txnName(txn)}</span>
          {txn.provisional && <Radio className="size-3.5 shrink-0 text-accent" aria-label="실시간 알림" />}
          {txn.trip_id && <Plane className="size-3.5 shrink-0 text-accent" aria-label="여행에 포함" />}
          {txn.dup_of_id && <Copy className="size-3.5 shrink-0 text-warn" aria-label="중복" />}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-subtle">
          <span className="num">{fmtTime(txn.occurred_at)}</span>
          <span>·</span>
          <AccountIcon kind={txn.account.kind} />
          <span className="max-w-[40%] shrink-0 truncate">{txn.account.name}</span>
          {txn.title && txn.merchant && <span className="truncate">· {txn.merchant}</span>}
          {txn.note && <span className="truncate text-muted">· {txn.note}</span>}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Amount txn={txn} className="text-sm" />
        <div className="flex items-center gap-1">
          {txn.ai && txn.ai.category !== '모름' && (
            <span className="inline-flex h-6 items-center gap-1 rounded-md bg-accent-soft px-1.5 text-[11px] font-medium text-accent" title={txn.ai.reason ?? ''}>
              <Sparkles className="size-3" />
              {txn.ai.category}?
            </span>
          )}
          <CategoryBadge txn={txn} />
        </div>
      </div>
    </>
  )
}

export function TxnRow({
  txn,
  onOpen,
  trailing,
  selected,
  swipeRight,
  index = 0,
}: {
  txn: Txn
  onOpen: () => void
  trailing?: ReactNode
  selected?: boolean
  swipeRight?: SwipeAction
  index?: number
}) {
  const x = useMotionValue(0)
  const reveal = useTransform(x, [0, SWIPE_AT], [0, 1])
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (swipeRight && info.offset.x > SWIPE_AT) swipeRight.run(txn)
  }

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: txn.dup_of_id ? 0.6 : 1, y: 0 }}
      exit={{ opacity: 0, x: 60, height: 0, transition: { duration: 0.22 } }}
      transition={{ duration: 0.25, delay: Math.min(index, 12) * 0.02 }}
      className="relative overflow-hidden"
    >
      {swipeRight && (
        <motion.div style={{ opacity: reveal }} className={cn('absolute inset-0 flex items-center pl-5 text-sm font-semibold', swipeRight.className)}>
          {swipeRight.label}
        </motion.div>
      )}
      <motion.div
        style={{ x }}
        drag={swipeRight ? 'x' : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0, right: 0.6 }}
        dragSnapToOrigin
        onDragEnd={onDragEnd}
        className={cn(
          'relative flex items-center gap-3 bg-surface px-4 py-2.5 transition-colors sm:px-5',
          selected ? 'bg-accent-soft' : 'hover:bg-surface-2/50',
        )}
      >
        <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <RowBody txn={txn} />
        </button>
        {trailing}
      </motion.div>
    </motion.li>
  )
}

/** Day-grouped ledger. Opens a bottom sheet by default; pass onSelect for a side pane instead. */
export function TxnList({
  items,
  emptyText = '거래가 없어요',
  trailing,
  selectedId,
  onSelect,
  swipeRight,
}: {
  items: Txn[]
  emptyText?: string
  trailing?: (t: Txn) => ReactNode
  selectedId?: number | null
  onSelect?: (t: Txn) => void
  swipeRight?: SwipeAction
}) {
  const [open, setOpen] = useState<Txn | null>(null)
  if (!items.length) return <p className="px-5 py-10 text-center text-sm text-subtle">{emptyText}</p>

  const days: { day: string; items: Txn[]; net: number }[] = []
  for (const t of items) {
    const day = t.occurred_at.slice(0, 10)
    let g = days[days.length - 1]
    if (!g || g.day !== day) days.push((g = { day, items: [], net: 0 }))
    g.items.push(t)
    if (t.kind === 'expense' && !t.dup_of_id) g.net += t.amount
  }

  // A list spanning months (or years) gets a month heading wherever the month changes.
  const months = new Set(days.map((g) => g.day.slice(0, 7)))
  const showMonths = months.size > 1

  let i = 0
  return (
    <>
      <div className="divide-y">
        <AnimatePresence initial={false}>
          {days.map((g, gi) => (
            <motion.section key={g.day} layout="position" exit={{ opacity: 0 }}>
              {showMonths && (gi === 0 || days[gi - 1].day.slice(0, 7) !== g.day.slice(0, 7)) && (
                <div className="flex items-baseline gap-2 border-b bg-surface px-4 pb-1.5 pt-4 sm:px-5">
                  <span className="text-sm font-bold">{fmtMonth(g.day.slice(0, 7))}</span>
                </div>
              )}
              <header className="sticky top-14 z-[1] flex items-center justify-between bg-surface-2/85 px-4 py-1.5 text-xs font-medium text-muted backdrop-blur sm:px-5">
                <span>{fmtDay(g.day)}</span>
                {g.net !== 0 && <span className="num">{wonSigned(g.net)}</span>}
              </header>
              <ul className="divide-y divide-border/60">
                <AnimatePresence initial={false}>
                  {g.items.map((t) => (
                    <TxnRow
                      key={t.id}
                      txn={t}
                      index={i++}
                      selected={selectedId === t.id}
                      onOpen={() => (onSelect ? onSelect(t) : setOpen(t))}
                      trailing={trailing?.(t)}
                      swipeRight={swipeRight}
                    />
                  ))}
                </AnimatePresence>
              </ul>
            </motion.section>
          ))}
        </AnimatePresence>
      </div>
      {!onSelect && <TxnSheet txn={open} onClose={() => setOpen(null)} />}
    </>
  )
}

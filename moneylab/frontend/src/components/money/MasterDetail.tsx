import { useMemo, useState, type ReactNode } from 'react'
import type { Txn } from '@/api/money'
import { useSplit } from '@/lib/useMedia'
import { TxnPane, TxnSheet } from './TxnSheet'

/**
 * List on the left, editor on the right when there's room (unfolded Fold, tablet, PC);
 * a bottom sheet on the cover screen. Keeps the selection by id so a refetched list
 * (after an edit) still shows the same row, and keeps showing a row that left the list.
 */
export function useTxnSelection(items: Txn[]) {
  const [selected, setSelected] = useState<Txn | null>(null)
  const fresh = useMemo(() => (selected ? (items.find((t) => t.id === selected.id) ?? selected) : null), [items, selected])
  return { selected: fresh, select: setSelected, clear: () => setSelected(null) }
}

export function MasterDetail({
  list,
  selected,
  onClose,
}: {
  list: ReactNode
  selected: Txn | null
  onClose: () => void
}) {
  const split = useSplit()
  if (!split) {
    return (
      <>
        {list}
        <TxnSheet txn={selected} onClose={onClose} />
      </>
    )
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(300px,0.85fr)] items-start gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(360px,1fr)]">
      <div className="min-w-0">{list}</div>
      <TxnPane txn={selected} onClose={onClose} />
    </div>
  )
}

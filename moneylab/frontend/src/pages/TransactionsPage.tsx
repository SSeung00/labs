import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ChevronLeft, ChevronRight, Plus, Search, X } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { ManualEntry } from '@/pages/ai/ManualEntry'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/controls'
import { TxnList } from '@/components/money/TxnList'
import { MasterDetail, useTxnSelection } from '@/components/money/MasterDetail'
import { KIND_LABEL, type Kind, type TxnFilters, useAccounts, useTransactions } from '@/api/money'
import { CategoryOptions } from '@/components/money/bits'
import { addMonths, fmtDate, fmtMonth, monthRange, thisMonth, won } from '@/lib/format'

const PAGE = 200

/** Filters live in the URL so dashboard links (category, month) land here pre-filtered. */
export function TransactionsPage() {
  const [params, setParams] = useSearchParams()
  const [limit, setLimit] = useState(PAGE)
  const [q, setQ] = useState(params.get('q') ?? '')
  const [adding, setAdding] = useState(false)

  const start = params.get('start') ?? undefined
  const end = params.get('end') ?? undefined
  const month = !start && !end && !params.has('all') ? (params.get('month') ?? thisMonth()) : null
  const range = month ? monthRange(month) : { start, end }

  const filters: TxnFilters = {
    ...range,
    category: params.get('category') ?? undefined,
    kind: params.get('kind') ?? undefined,
    account_id: params.get('account') ? Number(params.get('account')) : undefined,
    q: params.get('q') ?? undefined,
    include_dups: params.get('dups') === '1',
    limit,
  }
  const { data, isFetching } = useTransactions(filters)
  const sel = useTxnSelection(data?.items ?? [])
  const { data: accounts } = useAccounts()

  useEffect(() => setLimit(PAGE), [params])

  // Debounced search box → URL
  useEffect(() => {
    const id = setTimeout(() => set({ q: q || null }), 300)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  function set(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '') next.delete(k)
      else next.set(k, v)
    }
    if (next.toString() !== params.toString()) setParams(next, { replace: true })
  }

  const periodLabel = month ? fmtMonth(month) : start || end ? `${fmtDate(start)} ~ ${fmtDate(end)}` : '전체 기간'
  const anyFilter = ['category', 'kind', 'account', 'q', 'dups'].some((k) => params.has(k))

  return (
    <>
      <Dialog open={adding} onClose={() => setAdding(false)} title="거래 직접 넣기" description="현금 결제나 엑셀보다 먼저 기록하고 싶은 결제" className="sm:max-w-3xl">
        <div className="px-5 py-4">{adding && <ManualEntry compact onDone={() => setAdding(false)} />}</div>
      </Dialog>
      <PageHeader
        actions={
          <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
            <Plus /> 직접 넣기
          </Button>
        }
        title="거래내역"
        subtitle={
          data ? (
            <>
              {periodLabel} · {data.total.toLocaleString()}건 · 지출 <span className="num font-semibold text-text">{won(data.spending)}</span>
            </>
          ) : (
            periodLabel
          )
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border bg-surface p-0.5">
          <Button size="icon" variant="ghost" className="size-8" aria-label="이전 달" onClick={() => set({ month: addMonths(month ?? thisMonth(), -1), start: null, end: null, all: null })}>
            <ChevronLeft />
          </Button>
          <button
            className="num min-w-[104px] px-1 text-center text-sm font-semibold"
            onClick={() => set({ month: null, start: null, end: null, all: month ? '1' : null })}
            title={month ? '전체 기간 보기' : '이번 달로'}
          >
            {month ? fmtMonth(month) : '전체 기간'}
          </button>
          <Button size="icon" variant="ghost" className="size-8" aria-label="다음 달" onClick={() => set({ month: addMonths(month ?? thisMonth(), 1), start: null, end: null, all: null })}>
            <ChevronRight />
          </Button>
        </div>

        <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="가맹점·메모 검색" className="h-9 pl-9" />
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select value={params.get('category') ?? ''} onChange={(e) => set({ category: e.target.value })} aria-label="카테고리">
          <option value="">모든 카테고리</option>
          <CategoryOptions />
        </Select>
        <Select value={params.get('kind') ?? ''} onChange={(e) => set({ kind: e.target.value })} aria-label="종류">
          <option value="">모든 종류</option>
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </Select>
        <Select value={params.get('account') ?? ''} onChange={(e) => set({ account: e.target.value })} aria-label="계좌·카드">
          <option value="">모든 계좌·카드</option>
          {(accounts ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.label || a.name}
            </option>
          ))}
        </Select>
        <label className="flex h-10 items-center gap-2 rounded-lg border bg-surface-2/60 px-3 text-sm text-muted">
          <input type="checkbox" checked={params.get('dups') === '1'} onChange={(e) => set({ dups: e.target.checked ? '1' : null })} className="accent-[var(--accent)]" />
          중복도 보기
        </label>
      </div>

      {anyFilter && (
        <button onClick={() => { setQ(''); set({ category: null, kind: null, account: null, q: null, dups: null }) }} className="mb-3 inline-flex items-center gap-1 text-xs text-muted hover:text-text">
          <X className="size-3.5" /> 필터 지우기
        </button>
      )}

      <MasterDetail
        selected={sel.selected}
        onClose={sel.clear}
        list={
          <Card className="overflow-clip">
            <div className={isFetching ? 'opacity-70 transition-opacity' : undefined}>
              <TxnList
                items={data?.items ?? []}
                emptyText={data ? '이 조건의 거래가 없어요' : '불러오는 중…'}
                selectedId={sel.selected?.id}
                onSelect={sel.select}
              />
            </div>
            {data && data.items.length < data.total && (
              <div className="border-t p-3 text-center">
                <Button size="sm" onClick={() => setLimit((l) => l + PAGE)}>
                  더 보기 ({data.items.length.toLocaleString()} / {data.total.toLocaleString()})
                </Button>
              </div>
            )}
          </Card>
        }
      />
    </>
  )
}

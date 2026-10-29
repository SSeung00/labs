import { useSearchParams } from 'react-router'
import { Check, Loader2, PartyPopper, Sparkles } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Segmented } from '@/components/ui/controls'
import { TxnList } from '@/components/money/TxnList'
import { MasterDetail, useTxnSelection } from '@/components/money/MasterDetail'
import { CategoryDot, useCategoryMap } from '@/components/money/bits'
import { type Txn, useBulkPatch, useOverview, usePatchTxn, useTransactions } from '@/api/money'
import { useAiStatus, useAiSuggest } from '@/api/extra'
import { useHealth } from '@/api/client'
import { won } from '@/lib/format'
import { useSplit } from '@/lib/useMedia'

type Tab = 'uncategorized' | 'dups' | 'big_transfers' | 'live'

const TABS: { value: Tab; label: string; hint: string }[] = [
  { value: 'uncategorized', label: '미분류', hint: '결제대행사(이니시스·NICE 등)로만 찍혀 무엇을 샀는지 모르는 결제예요. 카테고리를 골라 주세요.' },
  { value: 'dups', label: '중복 의심', hint: '간편결제·체크카드와 카드에 같은 금액이 같이 찍혀서 한 번만 셌어요. 맞는지 확인해 주세요.' },
  { value: 'big_transfers', label: '큰 송금', hint: '10만 원 이상 다른 사람에게 보낸 돈이에요. 숙소 예약금이나 회비처럼 실제로 쓴 돈이면 카테고리를, 학회·연구실 비용 정산이면 거래를 눌러 “정산”으로 묶어 주세요.' },
  { value: 'live', label: '실시간', hint: '결제 알림으로 먼저 들어온 거래예요. 엑셀을 가져오면 같은 결제로 자동 교체돼요.' },
]

// One-tap categories for the review queue; the full list is in the detail editor.
const QUICK = ['외식', '카페·간식', '온라인쇼핑', '러닝', '문화·여가', '선물·기념품']

export function ReviewPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'uncategorized'
  const { data: overview } = useOverview()
  const { data: health } = useHealth()
  const { data } = useTransactions({ view: tab, limit: 300 })
  const patch = usePatchTxn()
  const bulk = useBulkPatch()
  const cats = useCategoryMap()
  const split = useSplit()
  const items = data?.items ?? []
  const sel = useTxnSelection(items)
  const info = TABS.find((t) => t.value === tab)!
  const counts: Record<Tab, number> = {
    uncategorized: overview?.review.uncategorized ?? 0,
    dups: overview?.review.dups ?? 0,
    big_transfers: overview?.review.big_transfers ?? 0,
    live: health?.live ?? 0,
  }

  const done = (t: Txn) => patch.mutate({ id: t.id, patch: { reviewed: true } })

  // Quick actions only where there's horizontal room and no side pane (wide single-column).
  const quick = (t: Txn) => (
    <div className="hidden shrink-0 items-center gap-1 2xl:flex">
      {tab === 'dups' ? (
        <>
          <Button size="sm" variant="ghost" onClick={() => done(t)}>
            <Check /> 중복 맞음
          </Button>
          <Button size="sm" variant="ghost" onClick={() => patch.mutate({ id: t.id, patch: { not_duplicate: true, reviewed: true } })}>
            아님
          </Button>
        </>
      ) : tab !== 'live' ? (
        <>
          {(t.ai && t.ai.category !== '모름' ? [t.ai.category, ...QUICK.filter((c) => c !== t.ai!.category).slice(0, 4)] : QUICK).map((c) => (
            <button
              key={c}
              onClick={() => patch.mutate({ id: t.id, patch: { category: c, reviewed: true } })}
              className="inline-flex h-7 items-center gap-1 rounded-md border bg-surface-2/60 px-2 text-xs text-muted transition-transform hover:text-text active:scale-95"
              title={`${c}(으)로 분류`}
            >
              <CategoryDot color={cats.get(c)?.color} className="size-1.5" />
              {c}
            </button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => done(t)} title="이대로 둘게요">
            <Check />
          </Button>
        </>
      ) : null}
    </div>
  )

  return (
    <>
      <PageHeader title="확인하기" subtitle="자동으로 판단하기 어려운 거래만 모았어요. 한 번 확인하면 다시 안 나와요." />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          value={tab}
          onChange={(v) => {
            sel.clear()
            setParams({ tab: v }, { replace: true })
          }}
          options={TABS.map((t) => ({
            value: t.value,
            label: (
              <>
                {t.label}
                {counts[t.value] > 0 && <span className="num rounded-full bg-warn/20 px-1.5 text-[11px] text-warn">{counts[t.value]}</span>}
              </>
            ),
          }))}
        />
        {tab === 'uncategorized' && <AiButton />}
      </div>
      <p className="mb-4 text-[13px] text-muted">
        {info.hint}
        {!split && tab !== 'live' && items.length > 0 && <span className="text-subtle"> 오른쪽으로 밀면 "이대로 둘게요".</span>}
      </p>

      {data && items.length === 0 ? (
        <Card>
          <EmptyState icon={PartyPopper} title={tab === 'live' ? '대기 중인 실시간 결제가 없어요' : '모두 확인했어요'}>
            {tab === 'live' ? '설정 → 결제 알림 연동을 켜면 카드 결제가 바로 여기에 들어와요.' : '새로 가져온 거래 중에 확인할 게 생기면 여기에 다시 모여요.'}
          </EmptyState>
        </Card>
      ) : (
        <MasterDetail
          selected={sel.selected}
          onClose={sel.clear}
          list={
            <Card className="overflow-clip">
              <div className="flex items-center justify-between border-b px-4 py-2.5 text-xs text-muted sm:px-5">
                <span>
                  {items.length}건 · 합계 <span className="num">{won(Math.abs(items.reduce((s, t) => s + t.amount, 0)))}</span>
                </span>
                {items.length > 0 && tab !== 'live' && (
                  <Button size="sm" variant="ghost" disabled={bulk.isPending} onClick={() => bulk.mutate({ ids: items.map((t) => t.id), patch: { reviewed: true } })}>
                    <Check /> 전부 이대로 둘게요
                  </Button>
                )}
              </div>
              <TxnList
                items={items}
                emptyText="불러오는 중…"
                trailing={split ? undefined : quick}
                selectedId={sel.selected?.id}
                onSelect={sel.select}
                swipeRight={
                  !split && tab !== 'live'
                    ? { label: <><Check className="mr-1.5 size-4" /> 이대로 둘게요</>, className: 'bg-good/20 text-good', run: done }
                    : undefined
                }
              />
            </Card>
          }
        />
      )}

      <Card className="mt-4">
        <CardBody className="pt-4 text-[13px] leading-relaxed text-muted">
          거래를 누르면 종류·카테고리·여행·메모를 바꿀 수 있어요. 같은 가맹점이 자주 나오면 상세 화면의 <b className="text-text">"항상 이 카테고리"</b> 버튼으로 규칙을 만들어 두세요.
        </CardBody>
      </Card>
    </>
  )
}

function AiButton() {
  const { data } = useAiStatus()
  const run = useAiSuggest()
  if (!data) return null
  if (!data.available) {
    return <span className="text-xs text-subtle">AI 분류 제안: 설정에서 Claude API를 연결하면 쓸 수 있어요</span>
  }
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending || data.pending === 0} title="가맹점 이름·금액·날짜만 보내요">
        {run.isPending ? <Loader2 className="animate-spin" /> : <Sparkles className="text-accent" />}
        AI 분류 제안 {data.pending > 0 && <span className="num text-subtle">({data.pending})</span>}
      </Button>
      {run.data && <span className="text-xs text-good">{run.data.suggested}곳 제안 받음</span>}
      {run.error && <span className="text-xs text-bad">{run.error.message}</span>}
    </div>
  )
}

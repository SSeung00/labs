import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Copy, Globe, HandCoins, Loader2, Radio, RotateCcw, Sparkles, Trash2, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { type ClaimKind, useClaims, useCreateClaim, useDeleteTxn } from '@/api/tools'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Segmented, Select, Textarea } from '@/components/ui/controls'
import {
  KIND_LABEL,
  type Kind,
  type Txn,
  type TxnPatch,
  useCategories,
  useMakeRule,
  usePatchTxn,
  useTrips,
} from '@/api/money'
import { fmtDay, fmtTime, wonSigned } from '@/lib/format'
import { cn } from '@/lib/utils'
import { AccountIcon, CategoryDot, txnName, useCategoryTree } from './bits'

const KINDS: Kind[] = ['expense', 'income', 'transfer', 'card_payment', 'savings', 'invest']

const KIND_HELP: Partial<Record<Kind, string>> = {
  transfer: '이체는 지출 합계에 들어가지 않아요. 실제로 쓴 돈이면 아래에서 카테고리를 고르세요.',
  card_payment: '카드 사용 내역이 이미 지출로 잡혀 있어서, 통장에서 나간 카드값은 지출에서 빼요.',
  savings: '적금·청약에 넣은 돈이에요. 예산의 저축 항목으로 집계돼요.',
  invest: '증권 계좌로 옮긴 돈이에요. 자산 → 투자의 월별 투자금으로 집계돼요.',
  claim: '정산(학회비처럼 대신 내고 돌려받는 돈)이라 내 지출·수입에서 빠져 있어요. 자산 → 받을 돈에서 확인해요.',
}

/** Bottom sheet on the cover screen / narrow windows. */
export function TxnSheet({ txn, onClose }: { txn: Txn | null; onClose: () => void }) {
  return (
    <Dialog
      open={!!txn}
      onClose={onClose}
      title={txn ? txnName(txn) : '거래'}
      description={txn ? `${fmtDay(txn.occurred_at)} ${fmtTime(txn.occurred_at)}${txn.title ? ` · ${txn.merchant}` : ''}` : undefined}
    >
      {txn && <TxnDetail key={txn.id} txn={txn} />}
    </Dialog>
  )
}

/** Side pane on the unfolded screen: same editor, sticky next to the list. */
export function TxnPane({ txn, onClose }: { txn: Txn | null; onClose: () => void }) {
  return (
    <div className="sticky top-[calc(3.5rem+1rem)] max-h-[calc(100dvh-5.5rem)] overflow-y-auto rounded-card border bg-surface shadow-card">
      {txn ? (
        <motion.div key={txn.id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.22 }}>
          <div className="flex items-start gap-3 border-b px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-semibold tracking-tight">{txnName(txn)}</h2>
              <p className="mt-0.5 truncate text-xs text-subtle">
                {fmtDay(txn.occurred_at)} {fmtTime(txn.occurred_at)}
                {txn.title && ` · ${txn.merchant}`}
              </p>
            </div>
            <button onClick={onClose} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text" aria-label="닫기">
              <X className="size-4" />
            </button>
          </div>
          <TxnDetail txn={txn} />
        </motion.div>
      ) : (
        <div className="grid min-h-64 place-items-center px-6 py-16 text-center text-sm text-subtle">거래를 고르면 여기에서 바로 고칠 수 있어요</div>
      )}
    </div>
  )
}

export function TxnDetail({ txn: initial }: { txn: Txn }) {
  const [txn, setTxn] = useState(initial)
  const [note, setNote] = useState(initial.note ?? '')
  const [title, setTitle] = useState(initial.title ?? '')
  const [ruleMade, setRuleMade] = useState<number | null>(null)
  const patch = usePatchTxn()
  const makeRule = useMakeRule()
  const { data: categories } = useCategories()
  const { data: trips } = useTrips()

  useEffect(() => {
    setTxn(initial)
    setNote(initial.note ?? '')
    setTitle(initial.title ?? '')
  }, [initial])

  const apply = (p: TxnPatch) => patch.mutate({ id: txn.id, patch: p }, { onSuccess: (t) => setTxn(t) })
  const del = useDeleteTxn()
  const [deleted, setDeleted] = useState(false)

  const isSpending = txn.kind === 'expense'
  const tree = useCategoryTree(txn.kind === 'income')
  const anyLocked = Object.values(txn.locked).some(Boolean) || txn.reviewed
  const color = (name: string) => categories?.find((c) => c.name === name)?.color

  return (
    <div className="space-y-5 px-5 py-4">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0 text-xs text-muted">
          <div className="flex items-center gap-1.5">
            <AccountIcon kind={txn.account.kind} /> <span className="truncate">{txn.account.name}</span>
          </div>
          <div className="mt-1 text-subtle">
            {txn.source === 'notify'
              ? '결제 알림으로 들어온 거래'
              : txn.source === 'file'
                ? '카드사·은행 파일에서 가져온 거래'
                : `뱅크샐러드 분류: ${[txn.src.type, txn.src.cat, txn.src.sub].filter((s) => s && s !== '미분류').join(' › ') || '없음'}`}
          </div>
        </div>
        <div className={cn('num shrink-0 text-2xl font-bold tracking-tight', txn.amount > 0 && isSpending && 'text-good')}>{wonSigned(txn.amount)}</div>
      </div>

      {txn.provisional && (
        <div className="flex items-start gap-2.5 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2.5 text-[13px]">
          <Radio className="mt-0.5 size-4 shrink-0 text-accent" />
          <div>
            <b>실시간</b> 결제 알림이에요. 다음에 뱅크샐러드 엑셀을 가져오면 같은 결제로 자동 교체돼요.
          </div>
        </div>
      )}

      {txn.dup_of_id && (
        <div className="flex items-start gap-2.5 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2.5 text-[13px]">
          <Copy className="mt-0.5 size-4 shrink-0 text-warn" />
          <div className="flex-1">
            {txn.provisional ? '엑셀에 같은 결제가 들어와서 이 알림 기록은 합계에서 뺐어요.' : <>간편결제·체크카드 쪽에 같은 결제가 있어서 <b>중복</b>으로 보고 합계에서 뺐어요.</>}
            {!txn.provisional && (
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={() => apply({ reviewed: true })} disabled={txn.reviewed}>
                  <Check /> 중복 맞아요
                </Button>
                <Button size="sm" variant="ghost" onClick={() => apply({ not_duplicate: true, reviewed: true })}>
                  중복 아니에요
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {txn.ai && txn.ai.category !== '모름' && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2.5 rounded-lg border border-accent/30 bg-accent-soft/60 px-3 py-2.5 text-[13px]">
          <Sparkles className="size-4 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            AI 제안: <b>{txn.ai.category}</b>
            {txn.ai.reason && <span className="text-muted"> · {txn.ai.reason}</span>}
          </div>
          <Button size="sm" variant="primary" onClick={() => apply({ category: txn.ai!.category, reviewed: true })}>
            적용
          </Button>
        </motion.div>
      )}

      <section>
        <h4 className="mb-2 text-xs font-semibold text-muted">종류</h4>
        <Segmented
          size="sm"
          value={txn.kind}
          onChange={(k) => apply({ kind: k })}
          options={KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
          className="flex w-full [&>button]:flex-1"
        />
        {KIND_HELP[txn.kind] && <p className="mt-1.5 text-xs text-subtle">{KIND_HELP[txn.kind]}</p>}
      </section>

      {(isSpending || txn.kind === 'income' || txn.kind === 'transfer') && (
        <section>
          <h4 className="mb-2 text-xs font-semibold text-muted">카테고리</h4>
          <div className="space-y-2">
            {tree.map(({ parent, children }) => {
              const cs = [parent, ...children]
              return (
                <div key={parent.name} className="flex flex-wrap items-center gap-1.5">
                  {cs.map((c) => {
                    const active = (isSpending || txn.kind === 'income') && txn.category === c.name
                    return (
                      <button
                        key={c.name}
                        onClick={() => apply({ category: c.name, reviewed: true })}
                        title={c.parent ? `${c.parent} › ${c.name}` : children.length ? `${c.name} (소분류 없이)` : c.name}
                        className={cn(
                          'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] transition-all active:scale-95',
                          !c.parent && children.length > 0 && 'font-semibold',
                          active ? 'border-accent bg-accent-soft font-semibold text-text' : 'bg-surface-2/60 text-muted hover:text-text',
                        )}
                      >
                        <CategoryDot color={c.color} />
                        {c.name}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
          {(isSpending || txn.kind === 'income') && txn.merchant && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
              <Button
                size="sm"
                variant="ghost"
                disabled={makeRule.isPending}
                onClick={() =>
                  makeRule.mutate(
                    { id: txn.id, set_category: txn.category, ...(txn.locked.kind ? { set_kind: txn.kind } : {}) },
                    { onSuccess: (r) => setRuleMade(r.matched) },
                  )
                }
              >
                {makeRule.isPending ? <Loader2 className="animate-spin" /> : <CategoryDot color={color(txn.category)} />}'{txn.merchant.slice(0, 16)}'은(는) 항상 {txn.category}
              </Button>
              {ruleMade != null && <span className="text-good">규칙을 만들었어요 · {ruleMade}건에 적용</span>}
            </div>
          )}
        </section>
      )}

      {isSpending && !txn.dup_of_id && (
        <section>
          <h4 className="mb-2 text-xs font-semibold text-muted">여행</h4>
          <Select value={txn.trip_id ?? ''} onChange={(e) => apply({ trip_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">여행 아님</option>
            {(trips ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.start_date.slice(2).replaceAll('-', '.')}~)
              </option>
            ))}
          </Select>
        </section>
      )}

      {isSpending && !txn.dup_of_id && <FxSection txn={txn} onSave={apply} />}

      {(isSpending || txn.kind === 'claim' || ((txn.kind === 'transfer' || txn.kind === 'income') && txn.amount > 0)) && !txn.dup_of_id && (
        <ClaimSection txn={txn} onSave={apply} />
      )}

      <section>
        <h4 className="mb-2 text-xs font-semibold text-muted">이름</h4>
        <div className="flex gap-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={txn.merchant || '예: 러닝화 1080 V15'} maxLength={80} className="h-9" />
          {title !== (txn.title ?? '') && (
            <Button size="sm" variant="primary" onClick={() => apply({ title })}>
              저장
            </Button>
          )}
        </div>
        <p className="mt-1 text-[11px] text-subtle">목록에 결제처 대신 보여요. 결제처는 아래에 작게 남아요.</p>
      </section>

      <section>
        <h4 className="mb-2 text-xs font-semibold text-muted">메모</h4>
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 오사카 숙소 2박, 러닝화 교체" />
        {note !== (txn.note ?? '') && (
          <Button size="sm" variant="primary" className="mt-2" onClick={() => apply({ note })}>
            메모 저장
          </Button>
        )}
      </section>

      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <span className="text-xs text-subtle">{deleted ? '지웠어요' : patch.isPending ? '저장 중…' : patch.error ? patch.error.message : txn.reviewed ? '확인 완료' : ''}</span>
        <div className="flex gap-2">
          {(txn.source === 'manual' || txn.source === 'notify') && !deleted && (
            <Button size="sm" variant="ghost" onClick={() => confirm('이 거래를 지울까요?') && del.mutate(txn.id, { onSuccess: () => setDeleted(true) })}>
              <Trash2 /> 지우기
            </Button>
          )}
          {anyLocked && (
            <Button size="sm" variant="ghost" onClick={() => apply({ reset: true })} title="손으로 바꾼 것을 지우고 자동 분류로">
              <RotateCcw /> 자동으로 되돌리기
            </Button>
          )}
          {!txn.reviewed && (
            <Button size="sm" onClick={() => apply({ reviewed: true })}>
              <Check /> 확인 완료
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

const CURRENCIES = ['JPY', 'USD', 'EUR', 'AUD', 'CNY', 'TWD', 'THB', 'VND', 'GBP', 'SGD', 'HKD', 'NZD', 'CAD']

/** Overseas payment details: local-currency amount and card fees (Banksalad only gives KRW). */
function FxSection({ txn, onSave }: { txn: Txn; onSave: (p: TxnPatch) => void }) {
  const looksForeign = !!txn.fx || txn.src.sub === '해외결제' || !!txn.trip_id || /^[A-Z0-9 *.,'&-]{6,}$/.test(txn.merchant)
  const [open, setOpen] = useState(!!txn.fx)
  const [cur, setCur] = useState(txn.fx?.currency ?? 'JPY')
  const [amt, setAmt] = useState(txn.fx?.amount != null ? String(txn.fx.amount) : '')
  const [fee, setFee] = useState(txn.fx?.fee ? String(txn.fx.fee) : '')
  if (!looksForeign && !open) return null
  const rate = amt && Number(amt) > 0 ? Math.abs(txn.amount) / Number(amt) : null
  const dirty = (txn.fx?.currency ?? '') !== (amt ? cur : '') || String(txn.fx?.amount ?? '') !== amt || String(txn.fx?.fee ?? '') !== fee
  return (
    <section>
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted">
        <Globe className="size-3.5" /> 해외 결제
      </h4>
      {!open ? (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          현지 통화 금액 적기
        </Button>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Select value={cur} onChange={(e) => setCur(e.target.value)} className="w-24 shrink-0 [&_select]:h-9">
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
            <Input value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ''))} placeholder="현지 금액" inputMode="decimal" className="num h-9" />
            <Input value={fee} onChange={(e) => setFee(e.target.value.replace(/\D/g, ''))} placeholder="수수료(원)" inputMode="numeric" className="num h-9 w-28 shrink-0" />
          </div>
          <div className="flex items-center justify-between gap-2 text-xs text-subtle">
            <span className="num">{rate ? `실제 적용 환율 1 ${cur} = ${rate.toFixed(cur === 'JPY' || cur === 'VND' ? 3 : 1)}원` : '영수증·카드 앱의 현지 금액을 넣으면 실제 환율이 나와요'}</span>
            {dirty && (
              <Button size="sm" variant="primary" onClick={() => onSave({ fx_currency: amt ? cur : null, fx_amount: amt ? Number(amt) : null, fee: fee ? Number(fee) : null })}>
                저장
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

/** 정산: paid for the lab/conference and to be paid back, or the pay-back itself. */
function ClaimSection({ txn, onSave }: { txn: Txn; onSave: (p: TxnPatch) => void }) {
  const { data } = useClaims()
  const create = useCreateClaim()
  const [name, setName] = useState('')
  const [adding, setAdding] = useState<ClaimKind | null>(null)
  const current = data?.claims.find((c) => c.id === txn.claim_id)
  const open = (data?.claims ?? []).filter((c) => c.status === 'open')
  const incoming = txn.amount > 0

  return (
    <section>
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted">
        <HandCoins className="size-3.5" /> 정산 {incoming ? '(돌려받은 돈)' : '(대신 낸 돈)'}
      </h4>
      {current ? (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-2/60 px-3 py-2 text-[13px]">
          <span className="min-w-0 truncate">
            <b>{current.name}</b>
            <span className="text-muted"> · 받을 돈 {current.outstanding.toLocaleString()}원</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => onSave({ claim_id: null })}>
            빼기
          </Button>
        </div>
      ) : adding ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) create.mutate({ name: name.trim(), kind: adding, txn_ids: [txn.id] }, { onSuccess: (c) => onSave({ claim_id: c.id }) })
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={adding === 'loan' ? '예: 부모님께 빌려드린 돈' : '예: 2026 추계 통계학회'} autoFocus className="h-9" />
          <Button size="sm" variant="primary" type="submit" disabled={!name.trim() || create.isPending}>
            만들기
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {open.length > 0 && (
            <Select value="" onChange={(e) => e.target.value && onSave({ claim_id: Number(e.target.value) })} className="min-w-40 flex-1 [&_select]:h-9">
              <option value="">{incoming ? '어느 정산의 환급인가요?' : '진행 중인 정산에 넣기'}</option>
              {open.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} (받을 돈 {c.outstanding.toLocaleString()}원)
                </option>
              ))}
            </Select>
          )}
          {!incoming && (
            <Button size="sm" variant="ghost" onClick={() => setAdding('reimburse')}>
              새 정산 만들기
            </Button>
          )}
          {!incoming && txn.kind === 'transfer' && (
            <Button size="sm" variant="ghost" onClick={() => setAdding('loan')}>
              빌려준 돈으로
            </Button>
          )}
          <span className="w-full text-[11px] text-subtle">
            {incoming && txn.kind === 'transfer'
              ? '친구가 자기 몫(더치페이)을 보낸 돈이면 정산 대신 종류를 "지출", 카테고리를 그 식사의 카테고리로 바꾸세요. 그만큼 내 지출에서 빠져요.'
              : '학회·연구실 비용을 내 카드로 내고 돌려받는 경우: 내 지출에서 빼고, 돌려받을 때까지 따로 챙겨요.'}
          </span>
        </div>
      )}
    </section>
  )
}

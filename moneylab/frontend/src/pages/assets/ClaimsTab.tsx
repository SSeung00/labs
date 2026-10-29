import { useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, ChevronDown, GraduationCap, HandCoins, HeartHandshake, Link2, Plus, RotateCcw, Trash2, Unlink } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input, Label } from '@/components/ui/input'
import { AnimatedNumber, GrowBar, Stagger, StaggerItem } from '@/components/ui/motion'
import { Segmented } from '@/components/ui/controls'
import { type Claim, type ClaimKind, claimInput, useClaim, useClaims, useCloseClaim, useCreateClaim, useDeleteClaim, useLinkClaim, useUpdateClaim } from '@/api/tools'
import { fmtDate, won, wonSigned } from '@/lib/format'
import { cn } from '@/lib/utils'
import { txnName } from '@/components/money/bits'

/** 정산: conference/lab costs paid on my card, money lent, and what has come back so far. */
export function ClaimsTab() {
  const { data } = useClaims()
  const create = useCreateClaim()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ClaimKind>('reimburse')
  const [openId, setOpenId] = useState<number | null>(null)
  if (!data) return <div className="shimmer h-80 rounded-card" />

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim()) create.mutate({ name: name.trim(), kind }, { onSuccess: (c) => { setName(''); setOpenId(c.id) } })
  }

  return (
    <Stagger className="grid grid-cols-1 gap-4">
      <StaggerItem className="grid grid-cols-1 gap-3 split:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="rounded-card border bg-surface px-4 py-3.5 shadow-card">
          <div className="text-xs font-medium text-muted">아직 돌려받지 못한 돈</div>
          <AnimatedNumber value={data.outstanding} format={won} className="mt-1 block text-2xl font-bold" />
          <div className="text-xs text-subtle">진행 중 {data.claims.filter((c) => c.status === 'open').length}건 · 순자산에 포함돼요</div>
        </div>
        <Card>
          <CardBody className="pt-4 text-[13px] leading-relaxed text-muted">
            <p className="mb-2 flex items-center gap-1.5 font-semibold text-text">
              <HandCoins className="size-4 text-accent" /> 학회·연구실 비용을 내 카드로 냈다면
            </p>
            <ol className="list-decimal space-y-1 pl-4 marker:text-subtle">
              <li>여행·행사에서 학회를 '학회·행사'로 만들면 정산이 그 행사에 묶여요. 여기서 바로 만들어도 돼요.</li>
              <li>남 대신 낸 결제와, 돌려받은 입금(랩비·여비·동료 송금)을 같은 정산에 넣어요. 내 몫(개인 소비)은 넣지 않아요.</li>
              <li>다 끝나면 '끝내기'. 못 받은 돈은 내 지출로, 더 받은 돈(일비 등)은 수입으로 한 번만 기록돼요.</li>
            </ol>
            <p className="mt-2">
              <b className="text-text">빌려준 돈</b>(가족 등)은 종류를 '빌려준 돈'으로: 지출이 아니라 받을 돈으로 남고, 갚기로 한 날을 넣으면 자금 계획에 들어와요.
            </p>
          </CardBody>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <form onSubmit={submit} className="flex flex-wrap gap-2">
          <Segmented
            size="sm"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'reimburse', label: '정산' },
              { value: 'loan', label: '빌려준 돈' },
            ]}
          />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={kind === 'loan' ? '예: 부모님께 빌려드린 돈' : '새 정산 이름 (예: 2026 추계 통계학회)'}
            className="min-w-0 max-w-md flex-1"
          />
          <Button type="submit" variant="primary" disabled={!name.trim() || create.isPending}>
            <Plus /> 만들기
          </Button>
        </form>
      </StaggerItem>

      {data.claims.length === 0 ? (
        <StaggerItem>
          <Card>
            <EmptyState icon={HandCoins} title="정산이 없어요">
              대신 낸 돈은 내 지출에서 빠지고, 돌려받을 때까지 여기서 챙길 수 있어요.
            </EmptyState>
          </Card>
        </StaggerItem>
      ) : (
        data.claims.map((c) => (
          <StaggerItem key={c.id}>
            <ClaimCard claim={c} open={openId === c.id} onToggle={() => setOpenId(openId === c.id ? null : c.id)} />
          </StaggerItem>
        ))
      )}
    </Stagger>
  )
}

function ClaimCard({ claim: c, open, onToggle }: { claim: Claim; open: boolean; onToggle: () => void }) {
  const done = c.status === 'closed'
  return (
    <Card className={cn(done && 'opacity-70')}>
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-5 py-4 text-left">
        {done ? (
          <CheckCircle2 className="size-5 shrink-0 text-good" />
        ) : c.kind === 'loan' ? (
          <HeartHandshake className="size-5 shrink-0 text-accent" />
        ) : (
          <HandCoins className="size-5 shrink-0 text-accent" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-semibold">{c.name}</span>
            {c.kind === 'loan' && <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-muted">빌려준 돈</span>}
            {c.trip_name && (
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                <GraduationCap className="size-3" /> {c.trip_name}
              </span>
            )}
          </div>
          <div className="text-xs text-subtle">
            {c.kind === 'loan' ? '빌려준 돈' : '낸 돈'} {won(c.paid)} · 돌려받음 {won(c.reimbursed)} · {c.count}건
            {c.expected_date ? ` · ${c.kind === 'loan' ? '갚기로 한 날' : '예상'} ${fmtDate(c.expected_date)}` : ''}
          </div>
          <GrowBar value={c.paid ? c.reimbursed / c.paid : 0} className="mt-2 h-1.5" color={done ? 'var(--good)' : undefined} />
        </div>
        <div className="text-right">
          {done ? (
            <>
              <div className="font-bold text-good">완료</div>
              <div className="num text-[11px] text-subtle">
                {c.outstanding > 0 ? `내 부담 ${won(c.outstanding)}` : c.outstanding < 0 ? `수입 ${won(-c.outstanding)}` : ''}
              </div>
            </>
          ) : (
            <>
              <div className={cn('num font-bold', c.outstanding > 0 ? 'text-warn' : 'text-good')}>
                {c.outstanding > 0 ? won(c.outstanding) : c.outstanding < 0 ? `+${won(-c.outstanding)}` : '0원'}
              </div>
              <div className="text-[11px] text-subtle">{c.outstanding > 0 ? '받을 돈' : c.outstanding < 0 ? '더 받음' : '다 받음'}</div>
            </>
          )}
        </div>
        <ChevronDown className={cn('size-4 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <ClaimDetail id={c.id} />
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  )
}

function ClaimDetail({ id }: { id: number }) {
  const { data: c } = useClaim(id)
  const link = useLinkClaim()
  const close = useCloseClaim()
  const del = useDeleteClaim()
  const update = useUpdateClaim()
  const [expected, setExpected] = useState<string | null>(null)
  if (!c) return <div className="shimmer mx-5 mb-4 h-24 rounded-lg" />
  const done = c.status === 'closed'

  return (
    <CardBody className="space-y-4 border-t pt-4">
      <div>
        <div className="mb-1.5 text-xs font-semibold text-muted">묶인 거래</div>
        {!c.items?.length && <p className="text-xs text-subtle">거래내역에서 결제를 눌러 '정산'에 넣거나, 아래 후보에서 고르세요.</p>}
        <ul className="divide-y rounded-lg border">
          {c.items?.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="w-20 shrink-0 text-xs text-subtle">{fmtDate(t.occurred_at)}</span>
              <span className="min-w-0 flex-1 truncate">
                {txnName(t)}
                {t.title && <span className="ml-1.5 text-xs text-subtle">{t.merchant}</span>}
              </span>
              <span className={cn('num font-semibold', t.amount > 0 && 'text-good')}>{wonSigned(t.amount)}</span>
              <Button size="icon" variant="ghost" className="size-7" title="정산에서 빼기" onClick={() => link.mutate({ id, txn_ids: [t.id], linked: false })}>
                <Unlink />
              </Button>
            </li>
          ))}
        </ul>
      </div>

      {!done && (c.candidates?.length ?? 0) > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-semibold text-muted">
            {c.kind === 'loan' ? '갚은 돈 같은 입금 (같은 사람 먼저)' : '환급 같은 입금 (받을 돈과 금액이 가까운 순)'}
          </div>
          <ul className="divide-y rounded-lg border border-dashed">
            {c.candidates!.slice(0, 6).map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-20 shrink-0 text-xs text-subtle">{fmtDate(t.occurred_at)}</span>
                <span className="min-w-0 flex-1 truncate">{txnName(t)}</span>
                <span className="num text-good">{wonSigned(t.amount)}</span>
                <Button size="sm" variant="ghost" onClick={() => link.mutate({ id, txn_ids: [t.id], linked: true })}>
                  <Link2 /> 연결
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        {!done ? (
          <div className="flex items-end gap-2">
            <div>
              <Label htmlFor={`exp-${id}`}>{c.kind === 'loan' ? '갚기로 한 날' : '환급 예상일'}</Label>
              <Input id={`exp-${id}`} type="date" className="h-9" value={expected ?? c.expected_date ?? ''} onChange={(e) => setExpected(e.target.value)} />
            </div>
            {expected != null && expected !== (c.expected_date ?? '') && (
              <Button size="sm" onClick={() => update.mutate(claimInput(c, { expected_date: expected || null }), { onSuccess: () => setExpected(null) })}>
                저장
              </Button>
            )}
          </div>
        ) : (
          <span className="text-xs text-subtle">끝낸 정산이에요.</span>
        )}
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => confirm(`'${c.name}' 정산을 지울까요? 거래는 원래대로 돌아가요.`) && del.mutate(id)}>
            <Trash2 /> 지우기
          </Button>
          {done ? (
            <Button size="sm" onClick={() => close.mutate({ id, reopen: true })}>
              <RotateCcw /> 다시 열기
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                if (c.outstanding > 0 && !confirm(`${won(c.outstanding)}을 돌려받지 못했어요. 이 금액을 내 지출로 기록하고 끝낼까요?`)) return
                if (c.outstanding < 0 && !confirm(`낸 돈보다 ${won(-c.outstanding)} 더 받았어요. 이 금액을 수입으로 기록하고 끝낼까요?`)) return
                close.mutate({ id, book_shortfall: true })
              }}
            >
              <CheckCircle2 /> 끝내기
            </Button>
          )}
        </div>
      </div>
    </CardBody>
  )
}

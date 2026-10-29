import { useState, type FormEvent } from 'react'
import { Landmark, Loader2, Pencil, PiggyBank, Plane, Plus, Trash2 } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input, Label } from '@/components/ui/input'
import { Progress, Segmented, Select } from '@/components/ui/controls'
import { AnimatedNumber } from '@/components/ui/motion'
import { type Goal, type GoalInput, useAccounts, useDeleteGoal, useGoals, useSaveGoal } from '@/api/money'
import { fmtDate, fmtMonth, parseWon, won, wonShort } from '@/lib/format'

/** 여행 기금 · 적금 목표 (자산 → 목표 탭). */
export function GoalsPanel() {
  const { data } = useGoals()
  const [editing, setEditing] = useState<Partial<Goal> | null>(null)

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[13px] text-muted">적금 상품과 따로 모으는 돈이 목표까지 얼마나 왔는지</p>
        <Button variant="primary" size="sm" onClick={() => setEditing({ kind: 'fund' })}>
          <Plus /> 목표 추가
        </Button>
      </div>

      {data?.suggestions.map((s) => (
        <div key={s.account_id} className="mb-3 flex flex-wrap items-center gap-3 rounded-card border bg-surface px-4 py-3 text-sm shadow-card">
          <PiggyBank className="size-5 shrink-0 text-accent" />
          <span className="flex-1">
            <b>{s.name}</b>
            {s.balance != null && <> · 잔액 <span className="num">{won(s.balance)}</span></>}
            {s.monthly_amount && <> · 매달 <span className="num">{wonShort(s.monthly_amount)}</span></>}
          </span>
          <Button
            size="sm"
            onClick={() => setEditing({ kind: 'savings', name: s.name, account_id: s.account_id, monthly_amount: s.monthly_amount })}
          >
            적금 목표로 추가
          </Button>
        </div>
      ))}

      {data && data.goals.length === 0 ? (
        <Card>
          <EmptyState icon={Plane} title="모으고 있는 돈을 목표로 만들어 보세요" action={<Button variant="primary" onClick={() => setEditing({ kind: 'fund', name: '다음 여행 기금' })}><Plus /> 여행 기금 만들기</Button>}>
            목표 금액과 날짜를 정하면 한 달에 얼마씩 더 모아야 하는지 알려 드려요.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {data?.goals.map((g) => <GoalCard key={g.id} goal={g} onEdit={() => setEditing(g)} />)}
        </div>
      )}

      <GoalForm goal={editing} onClose={() => setEditing(null)} />
    </>
  )
}

function GoalCard({ goal: g, onEdit }: { goal: Goal; onEdit: () => void }) {
  const del = useDeleteGoal()
  const maxDep = Math.max(1, ...g.deposits.map((d) => d.amount))
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-1.5 text-text">
            {g.kind === 'savings' ? <Landmark className="size-4 text-accent" /> : <Plane className="size-4 text-accent" />}
            {g.name}
          </span>
        }
        hint={g.account_name ? `${g.account_name} 잔액 기준${g.balance_as_of ? ` (${fmtDate(g.balance_as_of)} + 이후 입금)` : ''}` : '직접 입력한 금액 기준'}
        action={
          <div className="flex">
            <Button size="icon" variant="ghost" onClick={onEdit} aria-label="수정">
              <Pencil />
            </Button>
            <Button size="icon" variant="ghost" aria-label="삭제" onClick={() => confirm(`'${g.name}' 목표를 지울까요?`) && del.mutate(g.id)}>
              <Trash2 />
            </Button>
          </div>
        }
      />
      <CardBody>
        <div className="flex items-end justify-between gap-3">
          <div className="num text-3xl font-bold tracking-tight">{won(g.current)}</div>
          {g.target_amount ? <div className="num pb-1 text-sm text-muted">/ {won(g.target_amount)}</div> : null}
        </div>
        {g.progress != null && <Progress value={g.progress} className="mt-3 h-2.5" />}

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
          {g.target_date && (
            <Row label={g.kind === 'savings' ? '만기' : '목표일'} value={`${fmtDate(g.target_date)}${g.months_left != null ? ` (${g.months_left}개월 남음)` : ''}`} />
          )}
          {g.monthly_amount ? <Row label="매달 넣는 돈" value={won(g.monthly_amount)} /> : null}
          {g.need_per_month != null && <Row label="목표까지 매달" value={won(g.need_per_month)} strong />}
          {g.projected != null && <Row label={g.kind === 'savings' ? '만기 예상 원금' : '목표일 예상'} value={won(g.projected)} strong />}
        </dl>
        {g.maturity ? (
          <div className="mt-4 rounded-xl bg-surface-2/60 p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium text-muted">만기 때 받을 돈 (추정)</span>
              <AnimatedNumber value={g.maturity.total} format={won} className="text-lg font-bold" />
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <Row label={`원금 (${g.maturity.months}개월)`} value={won(g.maturity.principal)} />
              <Row label={`이자 (연 ${g.rate ?? 0}%)`} value={won(g.maturity.interest)} />
              <Row label="정부 기여금" value={won(g.maturity.gov)} />
              <Row label={g.tax_free ? '세금 (비과세)' : '세금 15.4%'} value={g.tax_free ? '0원' : `−${won(g.maturity.tax)}`} />
            </dl>
            <p className="mt-2 text-[11px] text-subtle">매달 같은 돈을 넣는다고 보고 단리로 계산한 값이에요. 실제 금리·기여금·비과세 여부는 상품 약관과 은행 앱으로 확인하세요.</p>
          </div>
        ) : (
          g.kind === 'savings' && <p className="mt-2 text-[11px] text-subtle">시작일·만기일·금리를 넣으면 만기 때 받을 돈을 계산해 드려요.</p>
        )}

        {g.deposits.length > 1 && (
          <div className="mt-4">
            <div className="mb-1.5 text-xs text-muted">월별 입금</div>
            <div className="flex h-14 items-end gap-[3px]">
              {g.deposits.map((d) => (
                <div key={d.month} className="flex-1 rounded-t bg-accent/70" style={{ height: `${(d.amount / maxDep) * 100}%` }} title={`${fmtMonth(d.month)} ${won(d.amount)}`} />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-subtle">
              <span>{fmtMonth(g.deposits[0].month)}</span>
              <span>{fmtMonth(g.deposits[g.deposits.length - 1].month)}</span>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className={strong ? 'num font-semibold' : 'num'}>{value}</dd>
    </div>
  )
}

function GoalForm({ goal, onClose }: { goal: Partial<Goal> | null; onClose: () => void }) {
  return (
    <Dialog open={!!goal} onClose={onClose} title={goal?.id ? '목표 수정' : '목표 추가'}>
      {goal && <GoalFormBody key={goal.id ?? 'new'} goal={goal} onDone={onClose} />}
    </Dialog>
  )
}

function GoalFormBody({ goal, onDone }: { goal: Partial<Goal>; onDone: () => void }) {
  const { data: accounts } = useAccounts()
  const save = useSaveGoal()
  const [kind, setKind] = useState<'fund' | 'savings'>(goal.kind ?? 'fund')
  const [name, setName] = useState(goal.name ?? '')
  const [target, setTarget] = useState(goal.target_amount ? String(goal.target_amount) : '')
  const [targetDate, setTargetDate] = useState(goal.target_date ?? '')
  const [startDate, setStartDate] = useState(goal.start_date ?? '')
  const [monthly, setMonthly] = useState(goal.monthly_amount ? String(goal.monthly_amount) : '')
  const [accountId, setAccountId] = useState(goal.account_id ? String(goal.account_id) : '')
  const [manual, setManual] = useState(goal.saved_manual ? String(goal.saved_manual) : '')
  const [rate, setRate] = useState(goal.rate != null ? String(goal.rate) : '')
  const [gov, setGov] = useState(goal.gov_monthly ? String(goal.gov_monthly) : '')
  const [taxFree, setTaxFree] = useState(goal.tax_free ?? true)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const body: GoalInput = {
      name: name.trim(),
      kind,
      target_amount: parseWon(target),
      target_date: targetDate || null,
      start_date: startDate || null,
      monthly_amount: parseWon(monthly),
      account_id: accountId ? Number(accountId) : null,
      saved_manual: accountId ? null : parseWon(manual),
      note: null,
      rate: kind === 'savings' && rate ? Number(rate) : null,
      gov_monthly: kind === 'savings' ? parseWon(gov) : null,
      tax_free: taxFree,
    }
    save.mutate({ id: goal.id, ...body }, { onSuccess: onDone })
  }

  return (
    <form onSubmit={submit} className="space-y-4 px-5 py-4">
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: 'fund', label: '모으는 돈 (여행 기금 등)' },
          { value: 'savings', label: '적금 상품' },
        ]}
      />
      <div>
        <Label htmlFor="g-name">이름</Label>
        <Input id="g-name" value={name} onChange={(e) => setName(e.target.value)} required placeholder={kind === 'savings' ? '청년도약계좌' : '2027 유럽 여행'} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="g-target">목표 금액</Label>
          <Input id="g-target" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="예: 400만" inputMode="numeric" />
        </div>
        <div>
          <Label htmlFor="g-date">{kind === 'savings' ? '만기일' : '목표일'}</Label>
          <Input id="g-date" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="g-monthly">매달 넣는 돈</Label>
          <Input id="g-monthly" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="예: 70만" inputMode="numeric" />
        </div>
        <div>
          <Label htmlFor="g-start">시작일 (선택)</Label>
          <Input id="g-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
      </div>
      {kind === 'savings' && (
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-dashed p-3">
          <div>
            <Label htmlFor="g-rate">연 금리 % (우대 포함)</Label>
            <Input id="g-rate" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="예: 6.0" />
          </div>
          <div>
            <Label htmlFor="g-gov">정부 기여금 (월)</Label>
            <Input id="g-gov" value={gov} onChange={(e) => setGov(e.target.value)} inputMode="numeric" placeholder="해당 없으면 비워 두세요" />
          </div>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={taxFree} onChange={(e) => setTaxFree(e.target.checked)} className="accent-[var(--accent)]" />
            이자 비과세
          </label>
          <p className="col-span-2 text-[11px] text-subtle">숫자는 은행 앱의 상품 정보(적용 금리, 기여금 내역)를 보고 넣어 주세요.</p>
        </div>
      )}
      <div>
        <Label htmlFor="g-account">잔액을 가져올 계좌</Label>
        <Select id="g-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">직접 입력</option>
          {(accounts ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.label || a.name}
            </option>
          ))}
        </Select>
        <p className="mt-1 text-[11px] text-subtle">적금·청약 계좌는 뱅크샐러드 내보내기의 잔액 + 이후 입금으로 계산해요.</p>
      </div>
      {!accountId && (
        <div>
          <Label htmlFor="g-manual">지금까지 모은 돈</Label>
          <Input id="g-manual" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="예: 120만" inputMode="numeric" />
        </div>
      )}
      {save.error && <p className="text-sm text-bad">{save.error.message}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          취소
        </Button>
        <Button type="submit" variant="primary" disabled={!name.trim() || save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" />}
          저장
        </Button>
      </div>
    </form>
  )
}

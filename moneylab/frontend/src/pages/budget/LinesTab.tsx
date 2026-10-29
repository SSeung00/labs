import { useState, type FormEvent } from 'react'
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label } from '@/components/ui/input'
import { Segmented } from '@/components/ui/controls'
import { CategoryDot, useCategoryTree } from '@/components/money/bits'
import { useAccounts } from '@/api/money'
import {
  type BudgetLine,
  LINE_KIND_LABEL,
  type LineKind,
  useBudgetLines,
  useDeleteLine,
  useReorderLines,
  useSaveLine,
} from '@/api/plan'
import { parseWon, thisMonth, won } from '@/lib/format'
import { cn } from '@/lib/utils'
import { DraftCard } from './DraftCard'

const KIND_HELP: Record<LineKind, string> = {
  spend: '매달 이 카테고리들에 쓸 수 있는 한도',
  fund: '매달 조금씩 쌓아 두고, 이 카테고리에 쓸 때 꺼내 쓰는 봉투 (여행·장비처럼 가끔 크게 쓰는 돈)',
  save: '매달 적금·청약 계좌에 넣을 돈',
  invest: '매달 투자에 넣을 돈 (증권 계좌로 옮긴 돈을 집계)',
}

const COLORS = ['#2f9e44', '#868e96', '#2a78d6', '#e8590c', '#9c36b5', '#0ca678', '#7048e8', '#f59f00', '#e64980']

export function LinesTab() {
  const { data: lines } = useBudgetLines()
  const del = useDeleteLine()
  const reorder = useReorderLines()
  const [editing, setEditing] = useState<Partial<BudgetLine> | null>(null)
  const [redraft, setRedraft] = useState(false)

  if (redraft) return <DraftCard replacing onDone={() => setRedraft(false)} />

  const move = (i: number, d: -1 | 1) => {
    if (!lines) return
    const ids = lines.map((l) => l.id)
    const j = i + d
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    reorder.mutate(ids)
  }

  return (
    <Card>
      <CardHeader
        title="예산 항목"
        hint="한 지출은 위에 있는 항목부터 한 곳에만 들어가요. 여행 기간 지출은 '여행 포함' 봉투로 가요."
        action={
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setRedraft(true)}>
              <Sparkles /> 초안 다시
            </Button>
            <Button size="sm" variant="primary" onClick={() => setEditing({ kind: 'spend', categories: [], monthly_amount: 0, color: COLORS[(lines?.length ?? 0) % COLORS.length] })}>
              <Plus /> 추가
            </Button>
          </div>
        }
      />
      <CardBody className="px-0 pb-1">
        <ul className="divide-y">
          <AnimatePresence initial={false}>
            {lines?.map((l, i) => (
              <motion.li key={l.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }} className="flex items-center gap-3 px-5 py-3">
                <CategoryDot color={l.color ?? undefined} className="size-2.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-sm font-semibold">
                    {l.name}
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">{LINE_KIND_LABEL[l.kind]}</span>
                    {l.include_trips && <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">여행 포함</span>}
                  </div>
                  <div className="truncate text-xs text-subtle">
                    {l.kind === 'spend' || l.kind === 'fund' ? (l.categories.join(', ') || '카테고리 없음') : l.categories.length ? `계좌 ${l.categories.length}개` : '모든 계좌'}
                  </div>
                </div>
                <span className="num shrink-0 text-sm font-semibold">{won(l.monthly_amount)}</span>
                <div className="flex shrink-0">
                  <Button size="icon" variant="ghost" className="size-7" disabled={i === 0} onClick={() => move(i, -1)} aria-label="위로">
                    <ArrowUp />
                  </Button>
                  <Button size="icon" variant="ghost" className="size-7" disabled={i === lines.length - 1} onClick={() => move(i, 1)} aria-label="아래로">
                    <ArrowDown />
                  </Button>
                  <Button size="icon" variant="ghost" className="size-7" onClick={() => setEditing(l)} aria-label="수정">
                    <Pencil />
                  </Button>
                  <Button size="icon" variant="ghost" className="size-7" onClick={() => confirm(`'${l.name}' 항목을 지울까요?`) && del.mutate(l.id)} aria-label="삭제">
                    <Trash2 />
                  </Button>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </CardBody>
      <LineDialog line={editing} onClose={() => setEditing(null)} />
    </Card>
  )
}

function LineDialog({ line, onClose }: { line: Partial<BudgetLine> | null; onClose: () => void }) {
  return (
    <Dialog open={!!line} onClose={onClose} title={line?.id ? '예산 항목 수정' : '예산 항목 추가'}>
      {line && <LineBody key={line.id ?? 'new'} line={line} onDone={onClose} />}
    </Dialog>
  )
}

function LineBody({ line, onDone }: { line: Partial<BudgetLine>; onDone: () => void }) {
  const save = useSaveLine()
  const tree = useCategoryTree(false)
  const { data: accounts } = useAccounts()
  const [kind, setKind] = useState<LineKind>(line.kind ?? 'spend')
  const [name, setName] = useState(line.name ?? '')
  const [amount, setAmount] = useState(line.monthly_amount ? String(line.monthly_amount) : '')
  const [cats, setCats] = useState<(string | number)[]>(line.categories ?? [])
  const [trips, setTrips] = useState(line.include_trips ?? false)
  const [start, setStart] = useState(line.start_month ?? thisMonth())
  const [opening, setOpening] = useState(line.opening_balance ? String(line.opening_balance) : '')
  const [color, setColor] = useState(line.color ?? COLORS[0])

  const isCatLine = kind === 'spend' || kind === 'fund'
  const accountChoices = (accounts ?? []).filter((a) => (kind === 'save' ? a.kind === 'savings' : a.kind === 'invest' || a.kind === 'bank'))
  const toggle = (v: string | number) => setCats((cs) => (cs.includes(v) ? cs.filter((c) => c !== v) : [...cs, v]))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(
      {
        id: line.id, name: name.trim(), kind, categories: cats, include_trips: kind === 'fund' && trips,
        monthly_amount: parseWon(amount) ?? 0, start_month: kind === 'fund' ? start : null,
        opening_balance: kind === 'fund' ? (parseWon(opening) ?? 0) : 0, color, active: true,
      },
      { onSuccess: onDone },
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4 px-5 py-4">
      <Segmented
        value={kind}
        onChange={(k) => {
          setKind(k)
          setCats([])
        }}
        options={(Object.keys(LINE_KIND_LABEL) as LineKind[]).map((k) => ({ value: k, label: LINE_KIND_LABEL[k] }))}
      />
      <p className="-mt-2 text-xs text-subtle">{KIND_HELP[kind]}</p>
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div>
          <Label htmlFor="ln-name">이름</Label>
          <Input id="ln-name" value={name} onChange={(e) => setName(e.target.value)} required placeholder={kind === 'fund' ? '예: 카메라 봉투' : '예: 생활비'} />
        </div>
        <div>
          <Label htmlFor="ln-amount">매달</Label>
          <Input id="ln-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="예: 30만" className="w-32" />
        </div>
      </div>

      {isCatLine ? (
        <div>
          <Label>카테고리</Label>
          <p className="mb-1.5 text-[11px] text-subtle">대분류를 고르면 그 아래 소분류가 모두 들어가요.</p>
          <div className="space-y-1.5">
            {tree.map(({ parent, children }) => (
              <div key={parent.name} className="flex flex-wrap gap-1.5">
                {[parent, ...children].map((c) => {
                  const covered = !!c.parent && cats.includes(c.parent)
                  return (
                    <button
                      type="button"
                      key={c.name}
                      onClick={() => toggle(c.name)}
                      disabled={covered}
                      className={cn(
                        'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] transition-all active:scale-95 disabled:opacity-50',
                        !c.parent && 'font-semibold',
                        cats.includes(c.name) || covered ? 'border-accent bg-accent-soft font-semibold' : 'bg-surface-2/60 text-muted',
                      )}
                    >
                      <CategoryDot color={c.color} />
                      {c.name}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <Label>계좌 (안 고르면 전부)</Label>
          <div className="flex flex-wrap gap-1.5">
            {accountChoices.map((a) => (
              <button
                type="button"
                key={a.id}
                onClick={() => toggle(a.id)}
                className={cn('h-8 rounded-lg border px-2.5 text-[13px]', cats.includes(a.id) ? 'border-accent bg-accent-soft font-semibold' : 'bg-surface-2/60 text-muted')}
              >
                {a.label || a.name}
              </button>
            ))}
            {!accountChoices.length && <span className="text-xs text-subtle">해당 계좌가 없어요</span>}
          </div>
        </div>
      )}

      {kind === 'fund' && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={trips} onChange={(e) => setTrips(e.target.checked)} className="accent-[var(--accent)]" />
            여행 기간의 지출도 이 봉투에서 (여행 봉투 하나에만)
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ln-start">쌓기 시작한 달</Label>
              <Input id="ln-start" type="month" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ln-open">시작할 때 이미 있던 돈</Label>
              <Input id="ln-open" value={opening} onChange={(e) => setOpening(e.target.value)} inputMode="numeric" placeholder="0" />
            </div>
          </div>
        </>
      )}

      <div>
        <Label>색</Label>
        <div className="flex gap-2">
          {COLORS.map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => setColor(c)}
              className={cn('size-7 rounded-full border-2 transition-transform', color === c ? 'scale-110 border-text' : 'border-transparent')}
              style={{ background: c }}
              aria-label={c}
            />
          ))}
        </div>
      </div>

      {save.error && <p className="text-sm text-bad">{save.error.message}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          취소
        </Button>
        <Button type="submit" variant="primary" disabled={!name.trim() || save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" />}저장
        </Button>
      </div>
    </form>
  )
}

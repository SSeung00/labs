import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Camera, CheckCircle2, ImagePlus, Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { Select } from '@/components/ui/controls'
import { useAccounts } from '@/api/money'
import { CategoryOptions } from '@/components/money/bits'
import { useAiStatus } from '@/api/extra'
import { type ReceiptItem, useCreateAccount, useCreateManual, useReadReceipts } from '@/api/tools'
import { parseWon, todayIso, won } from '@/lib/format'
import { cn } from '@/lib/utils'

interface Row {
  key: number
  date: string
  time: string
  merchant: string
  krw: string
  currency: string
  fx: string
  category: string
  refund: boolean
}

let seq = 0
const blank = (): Row => ({ key: ++seq, date: todayIso(), time: '', merchant: '', krw: '', currency: 'KRW', fx: '', category: '', refund: false })

function fromReceipt(it: ReceiptItem): Row {
  return {
    key: ++seq,
    date: it.date ?? todayIso(),
    time: it.time ?? '',
    merchant: it.merchant,
    krw: it.krw_amount ? String(it.krw_amount) : '',
    currency: it.currency || 'KRW',
    fx: it.fx_amount ? String(it.fx_amount) : '',
    category: it.category ?? '',
    refund: it.refund,
  }
}

/**
 * Add transactions by hand or from receipt photos / payment screenshots.
 * On a connected card/bank they're temporary until the export brings the same charge;
 * on a cash account they stay.
 */
export function ManualEntry({ onDone, compact }: { onDone?: () => void; compact?: boolean }) {
  const { data: accounts } = useAccounts()
  const { data: ai } = useAiStatus()
  const read = useReadReceipts()
  const create = useCreateManual()
  const createAccount = useCreateAccount()
  const [rows, setRows] = useState<Row[]>([blank()])
  const [accountId, setAccountId] = useState('')
  const [saved, setSaved] = useState<number | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)

  const cash = accounts?.find((a) => a.kind === 'cash')
  useEffect(() => {
    if (!accountId && accounts?.length) setAccountId(String((cash ?? accounts.find((a) => a.kind === 'card') ?? accounts[0]).id))
  }, [accounts, accountId, cash])

  const account = accounts?.find((a) => String(a.id) === accountId)
  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const valid = rows.filter((r) => r.merchant.trim() && (parseWon(r.krw) ?? 0) > 0 && r.date)

  const readFiles = (files: File[]) => {
    if (!files.length) return
    setSaved(null)
    read.mutate(files.slice(0, 5), {
      onSuccess: (r) => {
        const got = r.items.map(fromReceipt)
        setRows((rs) => [...rs.filter((x) => x.merchant.trim() || x.krw), ...got].slice(-50))
      },
    })
  }

  const save = () => {
    if (!account) return
    create.mutate(
      valid.map((r) => {
        const krw = parseWon(r.krw) ?? 0
        return {
          account_id: account.id,
          occurred_at: `${r.date}T${(r.time || '12:00').slice(0, 5)}:00`,
          amount: r.refund ? krw : -krw,
          merchant: r.merchant.trim(),
          category: r.category || null,
          fx_currency: r.currency !== 'KRW' ? r.currency : null,
          fx_amount: r.currency !== 'KRW' && r.fx ? Number(r.fx) : null,
        }
      }),
      {
        onSuccess: (res) => {
          setSaved(res.items.length)
          setRows([blank()])
          onDone?.()
        },
      },
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => cameraInput.current?.click()} disabled={!ai?.available || read.isPending} title={ai?.available ? '' : 'Claude API를 연결하면 쓸 수 있어요'}>
          {read.isPending ? <Loader2 className="animate-spin" /> : <Camera />} 영수증 찍기
        </Button>
        <Button variant="ghost" onClick={() => fileInput.current?.click()} disabled={!ai?.available || read.isPending}>
          <ImagePlus /> 사진·스크린샷 고르기
        </Button>
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { readFiles([...(e.target.files ?? [])]); e.target.value = '' }} />
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { readFiles([...(e.target.files ?? [])]); e.target.value = '' }} />
        {!ai?.available && <span className="text-xs text-subtle">사진 읽기는 Claude API 연결 후 쓸 수 있어요. 직접 입력은 지금도 돼요.</span>}
        {read.error && <span className="text-xs text-bad">{read.error.message}</span>}
      </div>

      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {rows.map((r) => (
            <motion.div
              key={r.key}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              className={cn('grid gap-2 rounded-xl border bg-surface-2/40 p-3', compact ? 'grid-cols-2' : 'grid-cols-2 split:grid-cols-[120px_80px_minmax(0,1fr)_120px_130px_120px_auto]')}
            >
              <Input type="date" value={r.date} onChange={(e) => update(r.key, { date: e.target.value })} aria-label="날짜" className="h-9" />
              <Input type="time" value={r.time} onChange={(e) => update(r.key, { time: e.target.value })} aria-label="시간" className="h-9" />
              <Input value={r.merchant} onChange={(e) => update(r.key, { merchant: e.target.value })} placeholder="어디서 (가맹점)" className="col-span-2 h-9 split:col-span-1" aria-label="가맹점" />
              <Input value={r.krw} onChange={(e) => update(r.key, { krw: e.target.value })} placeholder="원화 금액" inputMode="numeric" className="num h-9" aria-label="원화 금액" />
              <div className="flex gap-1">
                <Select value={r.currency} onChange={(e) => update(r.key, { currency: e.target.value })} className="w-[72px] shrink-0 [&_select]:h-9 [&_select]:px-2 [&_select]:text-xs" aria-label="통화">
                  {['KRW', 'JPY', 'USD', 'EUR', 'AUD', 'CNY', 'TWD', 'THB', 'VND', 'GBP'].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
                {r.currency !== 'KRW' && <Input value={r.fx} onChange={(e) => update(r.key, { fx: e.target.value.replace(/[^\d.]/g, '') })} placeholder="현지 금액" inputMode="decimal" className="num h-9" aria-label="현지 통화 금액" />}
              </div>
              <Select value={r.category} onChange={(e) => update(r.key, { category: e.target.value })} className="[&_select]:h-9 [&_select]:text-xs" aria-label="카테고리">
                <option value="">카테고리 자동</option>
                <CategoryOptions income={false} />
              </Select>
              <div className="flex items-center justify-end gap-1">
                <label className="flex items-center gap-1 text-xs text-muted">
                  <input type="checkbox" checked={r.refund} onChange={(e) => update(r.key, { refund: e.target.checked })} className="accent-[var(--accent)]" /> 환불
                </label>
                <Button size="icon" variant="ghost" className="size-8" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [blank()]))} aria-label="이 줄 지우기">
                  <Trash2 />
                </Button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        <Button size="sm" variant="ghost" onClick={() => setRows((rs) => [...rs, blank()])}>
          <Plus /> 한 줄 더
        </Button>
      </div>

      <div className="grid grid-cols-1 items-end gap-3 split:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <Label>어느 계좌 · 카드로 냈나요?</Label>
          <div className="flex gap-2">
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="flex-1">
              {(accounts ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label || a.name}
                </option>
              ))}
            </Select>
            {!cash && (
              <Button variant="ghost" onClick={() => createAccount.mutate({ name: '현금', kind: 'cash' }, { onSuccess: (a) => setAccountId(String(a.id)) })}>
                현금 계좌 만들기
              </Button>
            )}
          </div>
          <p className="mt-1 text-[11px] text-subtle">
            {account?.kind === 'cash'
              ? '현금은 엑셀에 안 나오니 그대로 남아요.'
              : '카드·은행은 다음 뱅크샐러드 엑셀에 같은 결제(같은 금액, ±4일)가 오면 자동으로 교체돼요. 외화·메모는 직접 옮겨 주세요.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="num text-sm text-muted">{valid.length}건 · {won(valid.reduce((s, r) => s + (parseWon(r.krw) ?? 0) * (r.refund ? -1 : 1), 0))}</span>
          <Button variant="primary" onClick={save} disabled={!valid.length || !account || create.isPending}>
            {create.isPending && <Loader2 className="animate-spin" />}저장
          </Button>
        </div>
      </div>
      {create.error && <p className="text-sm text-bad">{create.error.message}</p>}
      <AnimatePresence>
        {saved != null && (
          <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-1.5 text-sm text-good">
            <CheckCircle2 className="size-4" /> {saved}건을 넣었어요
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

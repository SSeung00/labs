import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { motion } from 'framer-motion'
import { CheckCircle2, FileSpreadsheet, Loader2, Wand2, X } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { Segmented, Select } from '@/components/ui/controls'
import { ACCOUNT_KIND_LABEL, type AccountKind, useAccounts } from '@/api/money'
import { type FileCommitResult, type FileMapping, type FilePreview, useFileCommit, useFilePreview } from '@/api/extra'
import { fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'

type Role = 'date' | 'time' | 'merchant' | 'amount' | 'out' | 'in' | 'memo'

const ROLES: { key: Role; label: string; required?: boolean }[] = [
  { key: 'date', label: '날짜', required: true },
  { key: 'time', label: '시간' },
  { key: 'merchant', label: '내용 · 가맹점' },
  { key: 'amount', label: '금액 (한 열)' },
  { key: 'out', label: '출금' },
  { key: 'in', label: '입금' },
  { key: 'memo', label: '비고 · 취소 여부' },
]

/** Column-mapping importer for card company / bank statement files (anything but Banksalad). */
export function FileMapper({ file, onClose }: { file: File; onClose: () => void }) {
  const preview = useFilePreview()
  const commit = useFileCommit()
  const { data: accounts } = useAccounts()
  const [p, setP] = useState<FilePreview | null>(null)
  const [mapping, setMapping] = useState<FileMapping | null>(null)
  const [accountId, setAccountId] = useState<string>('')
  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState<AccountKind>('card')
  const [cutoff, setCutoff] = useState('')
  const [template, setTemplate] = useState('')
  const [result, setResult] = useState<FileCommitResult | null>(null)

  useEffect(() => {
    preview.mutate(file, {
      onSuccess: (r) => {
        setP(r)
        setMapping(r.mapping)
        setAccountId(r.account_id ? String(r.account_id) : '')
        setCutoff(r.cutoff ?? '')
        setTemplate(r.template?.name ?? file.name.replace(/\.[^.]+$/, ''))
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  // Default cutoff = the first day Banksalad already has for the chosen account.
  const account = accounts?.find((a) => String(a.id) === accountId)
  useEffect(() => {
    if (account?.first_at && !p?.template) setCutoff(account.first_at.slice(0, 10))
    if (account) setNewKind(account.kind)
  }, [account, p?.template])

  const roleOf = useMemo(() => {
    const m = new Map<number, Role>()
    if (mapping) for (const r of ROLES) if (mapping[r.key] != null) m.set(mapping[r.key] as number, r.key)
    return m
  }, [mapping])

  if (preview.isPending || (!p && !preview.error)) {
    return (
      <Card>
        <CardBody className="flex items-center gap-3 pt-5 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" /> {file.name} 읽는 중…
        </CardBody>
      </Card>
    )
  }
  if (preview.error || !p || !mapping) {
    return (
      <Card>
        <CardBody className="flex items-center justify-between gap-3 pt-5 text-sm">
          <span className="text-bad">{preview.error?.message ?? '읽지 못했어요'}</span>
          <Button size="sm" variant="ghost" onClick={onClose}>
            닫기
          </Button>
        </CardBody>
      </Card>
    )
  }

  if (result) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
        <Card>
          <CardBody className="space-y-3 pt-5">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 size-5 text-good" />
              <div className="text-sm">
                <div className="font-semibold">{result.account}에 {result.rows_new}건을 채웠어요</div>
                <div className="mt-0.5 text-muted">
                  {fmtDate(result.period_start)} ~ {fmtDate(result.period_end)} · 이미 있던 {result.rows_existing}건 · 기준일 이후라 건너뛴 {result.after_cutoff}건
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Link to="/review">
                <Button size="sm" variant="primary">확인할 거래 보기</Button>
              </Link>
              <Button size="sm" onClick={onClose}>닫기</Button>
            </div>
          </CardBody>
        </Card>
      </motion.div>
    )
  }

  const usesInOut = mapping.out != null || mapping.in != null
  const setRole = (role: Role, idx: string) => {
    const v = idx === '' ? null : Number(idx)
    setMapping((m) => {
      if (!m) return m
      const next = { ...m, [role]: v }
      if (role === 'amount' && v != null) Object.assign(next, { out: null, in: null })
      if ((role === 'out' || role === 'in') && v != null) next.amount = null
      return next
    })
  }
  const ready = mapping.date != null && (mapping.amount != null || usesInOut) && (accountId || newName.trim())

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-1.5 text-text">
            <FileSpreadsheet className="size-4 text-accent" /> {file.name}
          </span>
        }
        hint={`${p.rows}건 · ${fmtDate(p.first)} ~ ${fmtDate(p.last)}${p.template ? ` · '${p.template.name}' 형식으로 인식했어요` : ' · 열을 자동으로 추측했어요. 맞는지 확인해 주세요.'}`}
        action={
          <Button size="icon" variant="ghost" onClick={onClose} aria-label="닫기">
            <X />
          </Button>
        }
      />
      <CardBody className="space-y-5">
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-max text-left text-xs">
            <thead>
              <tr className="bg-surface-2/70">
                {p.header.map((h, i) => (
                  <th key={i} className={cn('whitespace-nowrap px-2.5 py-2 font-semibold', roleOf.has(i) && 'bg-accent-soft text-accent')}>
                    {h || `열 ${i + 1}`}
                    {roleOf.has(i) && <div className="text-[10px] font-medium">{ROLES.find((r) => r.key === roleOf.get(i))?.label}</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {p.sample.slice(0, 5).map((row, ri) => (
                <tr key={ri}>
                  {p.header.map((_, i) => (
                    <td key={i} className={cn('max-w-[180px] truncate whitespace-nowrap px-2.5 py-1.5 text-muted', roleOf.has(i) && 'text-text')}>
                      {row[i] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ROLES.map((r) => (
            <div key={r.key}>
              <Label>
                {r.label}
                {r.required && <span className="text-bad"> *</span>}
              </Label>
              <Select value={mapping[r.key] ?? ''} onChange={(e) => setRole(r.key, e.target.value)}>
                <option value="">없음</option>
                {p.header.map((h, i) => (
                  <option key={i} value={i}>
                    {h || `열 ${i + 1}`}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </div>

        {mapping.amount != null && (
          <div>
            <Label>금액 열의 의미</Label>
            <Segmented
              size="sm"
              value={mapping.sign}
              onChange={(v) => setMapping((m) => (m ? { ...m, sign: v } : m))}
              options={[
                { value: 'expense_positive', label: '쓴 돈이 + (카드 명세서)' },
                { value: 'signed', label: '+ 입금 / − 출금 (은행)' },
              ]}
            />
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label>어느 계좌 · 카드의 내역인가요?</Label>
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">새로 만들기</option>
              {(accounts ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label || a.name}
                </option>
              ))}
            </Select>
            {!accountId && (
              <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="예: 현대카드 M" />
                <Select value={newKind} onChange={(e) => setNewKind(e.target.value as AccountKind)} className="w-28">
                  {(Object.keys(ACCOUNT_KIND_LABEL) as AccountKind[]).map((k) => (
                    <option key={k} value={k}>
                      {ACCOUNT_KIND_LABEL[k]}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
          <div>
            <Label htmlFor="fm-cutoff">이 날짜 전 거래만 가져오기</Label>
            <Input id="fm-cutoff" type="date" value={cutoff} onChange={(e) => setCutoff(e.target.value)} />
            <p className="mt-1 text-[11px] text-subtle">뱅크샐러드가 이미 가진 날부터는 건너뛰어서 겹치지 않아요. 비우면 전부.</p>
          </div>
          {(account?.kind ?? newKind) !== 'card' && (account?.kind ?? newKind) !== 'check_card' && (
            <div>
              <Label>은행 출금은 기본적으로</Label>
              <Segmented
                size="sm"
                value={mapping.bank_default ?? '이체'}
                onChange={(v) => setMapping((m) => (m ? { ...m, bank_default: v } : m))}
                options={[
                  { value: '이체', label: '이체로 (나중에 고르기)' },
                  { value: '지출', label: '지출로' },
                ]}
              />
            </div>
          )}
          <div>
            <Label htmlFor="fm-tpl">이 형식 기억하기 (이름)</Label>
            <Input id="fm-tpl" value={template} onChange={(e) => setTemplate(e.target.value)} placeholder="비우면 기억하지 않아요" />
          </div>
        </div>

        {commit.error && <p className="text-sm text-bad">{commit.error.message}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button
            variant="primary"
            disabled={!ready || commit.isPending}
            onClick={() =>
              commit.mutate(
                {
                  file, mapping, cutoff: cutoff || null, save_template: template.trim() || null,
                  account_id: accountId ? Number(accountId) : null,
                  new_account: accountId ? null : { name: newName.trim(), kind: newKind },
                },
                { onSuccess: setResult },
              )
            }
          >
            {commit.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />}
            가져오기
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

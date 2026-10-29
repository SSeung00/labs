import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label } from '@/components/ui/input'
import { Segmented, Select } from '@/components/ui/controls'
import { AccountIcon, CategoryDot, CategoryOptions, useCategoryMap } from '@/components/money/bits'
import {
  ACCOUNT_KIND_LABEL,
  type AccountKind,
  ISSUERS,
  KIND_LABEL,
  type Kind,
  type Rule,
  useAccounts,
  useDeleteRule,
  usePatchAccount,
  useRulePreview,
  useRules,
  useSaveRule,
} from '@/api/money'
import { fmtDate, won } from '@/lib/format'
import { cn } from '@/lib/utils'
import { MobileCard } from './MobileCard'
import { AiCard, NotifyCard, TemplatesCard } from './settings/ConnectCards'
import { AutostartCard, BackupCard, LedgerCard } from './settings/BackupCards'

type Tab = 'rules' | 'accounts' | 'connect' | 'backup' | 'phone'

const TABS: { value: Tab; label: string }[] = [
  { value: 'rules', label: '분류 규칙' },
  { value: 'accounts', label: '계좌 · 카드' },
  { value: 'connect', label: '알림 · AI' },
  { value: 'backup', label: '백업 · 자동 실행' },
  { value: 'phone', label: '휴대폰' },
]

export function SettingsPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'rules'
  return (
    <>
      <PageHeader title="설정" subtitle="분류 규칙 · 계좌 · 결제 알림 · AI · 휴대폰 연결" />
      <Segmented value={tab} onChange={(v) => setParams(v === 'rules' ? {} : { tab: v }, { replace: true })} options={TABS} className="mb-4" />
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>
          {tab === 'rules' && <RulesCard />}
          {tab === 'accounts' && (
            <div className="grid grid-cols-1 items-start gap-4 split:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <AccountsCard />
              <div className="grid gap-4">
                <LedgerCard />
                <TemplatesCard />
              </div>
            </div>
          )}
          {tab === 'connect' && (
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <NotifyCard />
              <AiCard />
            </div>
          )}
          {tab === 'backup' && (
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
              <BackupCard />
              <AutostartCard />
            </div>
          )}
          {tab === 'phone' && <MobileCard />}
        </motion.div>
      </AnimatePresence>
    </>
  )
}

function RulesCard() {
  const { data: rules } = useRules()
  const del = useDeleteRule()
  const save = useSaveRule()
  const cats = useCategoryMap()
  const [editing, setEditing] = useState<Partial<Rule> | null>(null)

  return (
    <Card>
      <CardHeader
        title="분류 규칙"
        hint="가맹점 이름에 키워드가 있으면 자동으로 분류해요. 위에 있는 규칙이 먼저 적용돼요."
        action={
          <Button size="sm" variant="primary" onClick={() => setEditing({ priority: 1, enabled: true })}>
            <Plus /> 규칙 추가
          </Button>
        }
      />
      <CardBody className="px-0 pb-1">
        <ul className="divide-y">
          {rules?.map((r) => (
            <li key={r.id} className={cn('flex items-center gap-3 px-5 py-2.5', !r.enabled && 'opacity-50')}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {r.name || r.pattern.slice(0, 20)}
                  <span className="flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-normal text-muted">
                    → {r.set_category && <CategoryDot color={cats.get(r.set_category)?.color} className="size-1.5" />}
                    {[r.set_category, r.set_kind && KIND_LABEL[r.set_kind]].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-subtle" title={r.pattern}>
                  {r.pattern}
                </div>
              </div>
              <span className="num shrink-0 text-xs text-muted">{r.matched}건</span>
              <label className="flex shrink-0 items-center" title={r.enabled ? '끄기' : '켜기'}>
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={(e) => save.mutate({ ...r, enabled: e.target.checked })}
                  className="accent-[var(--accent)]"
                />
              </label>
              <Button size="icon" variant="ghost" className="size-8" onClick={() => setEditing(r)} aria-label="수정">
                <Pencil />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                aria-label="삭제"
                onClick={() => confirm(`'${r.name || r.pattern}' 규칙을 지울까요?`) && del.mutate(r.id)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      </CardBody>
      <RuleDialog rule={editing} onClose={() => setEditing(null)} />
    </Card>
  )
}

function RuleDialog({ rule, onClose }: { rule: Partial<Rule> | null; onClose: () => void }) {
  return (
    <Dialog open={!!rule} onClose={onClose} title={rule?.id ? '규칙 수정' : '규칙 추가'} description="키워드는 | 로 구분해요. 예: 니콘|캐논|카메라 (대소문자 무시, 정규식 가능)">
      {rule && <RuleBody key={rule.id ?? 'new'} rule={rule} onDone={onClose} />}
    </Dialog>
  )
}

function RuleBody({ rule, onDone }: { rule: Partial<Rule>; onDone: () => void }) {
  const save = useSaveRule()
  const preview = useRulePreview()
  const [name, setName] = useState(rule.name ?? '')
  const [pattern, setPattern] = useState(rule.pattern ?? '')
  const [category, setCategory] = useState(rule.set_category ?? '')
  const [kind, setKind] = useState<Kind | ''>(rule.set_kind ?? '')
  const [accountKind, setAccountKind] = useState<AccountKind | ''>(rule.account_kind ?? '')
  const [priority, setPriority] = useState(String(rule.priority ?? 1))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(
      {
        id: rule.id,
        name: name.trim(),
        pattern,
        set_category: category || null,
        set_kind: kind || null,
        account_kind: accountKind || null,
        priority: Number(priority) || 1,
        enabled: rule.enabled ?? true,
      },
      { onSuccess: onDone },
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4 px-5 py-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Label htmlFor="r-name">이름</Label>
          <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 카메라 매장" />
        </div>
        <div>
          <Label htmlFor="r-prio">순서</Label>
          <Input id="r-prio" value={priority} onChange={(e) => setPriority(e.target.value.replace(/\D/g, ''))} inputMode="numeric" title="작을수록 먼저" />
        </div>
      </div>
      <div>
        <Label htmlFor="r-pattern">키워드</Label>
        <div className="flex gap-2">
          <Input id="r-pattern" value={pattern} onChange={(e) => setPattern(e.target.value)} required className="font-mono text-[13px]" />
          <Button type="button" onClick={() => preview.mutate({ pattern, account_kind: accountKind || null })} disabled={!pattern}>
            <Search /> 미리보기
          </Button>
        </div>
        {preview.data && (
          <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border bg-surface-2/50 px-3 py-2 text-xs">
            <div className="mb-1 font-medium text-muted">지출 {preview.data.count}건이 걸려요</div>
            {preview.data.merchants.map((m) => (
              <div key={m.merchant} className="flex justify-between gap-2 text-subtle">
                <span className="truncate">{m.merchant}</span>
                <span className="num shrink-0">
                  {m.count}건 · {won(m.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
        {preview.error && <p className="mt-1 text-xs text-bad">{preview.error.message}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="r-cat">카테고리</Label>
          <Select id="r-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">바꾸지 않음</option>
            <CategoryOptions />
          </Select>
        </div>
        <div>
          <Label htmlFor="r-kind">종류</Label>
          <Select id="r-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind | '')}>
            <option value="">바꾸지 않음</option>
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="r-acc">이 종류의 계좌·카드에서만 (선택)</Label>
        <Select id="r-acc" value={accountKind} onChange={(e) => setAccountKind(e.target.value as AccountKind | '')}>
          <option value="">전부</option>
          {(Object.keys(ACCOUNT_KIND_LABEL) as AccountKind[]).map((k) => (
            <option key={k} value={k}>
              {ACCOUNT_KIND_LABEL[k]}
            </option>
          ))}
        </Select>
        <p className="mt-1 text-[11px] text-subtle">종류를 안 바꾸는 규칙은 지출 거래에만 적용돼요. 이체를 지출로 바꾸려면 종류도 '지출'로 정하세요.</p>
      </div>
      {save.error && <p className="text-sm text-bad">{save.error.message}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          취소
        </Button>
        <Button type="submit" variant="primary" disabled={!pattern || (!category && !kind) || save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" />}
          저장
        </Button>
      </div>
    </form>
  )
}

function AccountsCard() {
  const { data: accounts } = useAccounts()
  const patch = usePatchAccount()
  const stale = (accounts ?? []).filter((a) => a.stale)
  return (
    <Card>
      <CardHeader title="계좌 · 카드" hint="종류에 따라 카드대금·중복·저축을 판단해요. 카드는 카드사를 정하면 알림·결제액과 짝지어져요." />
      <CardBody className="space-y-3">
        {stale.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2.5 text-[13px]">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
            <span>
              <b>{stale.map((a) => a.label || a.name).join(', ')}</b>의 최근 거래가 두 달 넘게 없어요. 안 쓰는 거라면 괜찮지만, 계속 쓰고 있다면
              뱅크샐러드에서 연결(마이데이터 동의)이 끊겼는지 확인해 보세요.
            </span>
          </div>
        )}
        {!accounts?.length && <p className="text-sm text-subtle">엑셀을 가져오면 여기에 나와요.</p>}
        {accounts?.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-2.5">
            <AccountIcon kind={a.kind} className="size-4 text-muted" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm" title={a.name}>
                {a.label || a.name}
              </div>
              <div className={cn('text-[11px]', a.stale ? 'text-warn' : 'text-subtle')}>
                {a.txn_count}건{a.first_at && ` · ${fmtDate(a.first_at)} ~ ${fmtDate(a.last_at)}`}
              </div>
            </div>
            {(a.kind === 'card' || a.kind === 'check_card') && (
              <Select
                value={a.issuer ?? ''}
                onChange={(e) => patch.mutate({ id: a.id, issuer: e.target.value || null })}
                className={cn('w-[96px] shrink-0 [&_select]:h-8 [&_select]:text-xs', !a.issuer && '[&_select]:border-warn')}
                aria-label={`${a.name} 카드사`}
              >
                <option value="">카드사?</option>
                {ISSUERS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </Select>
            )}
            {a.kind === 'check_card' && (
              <Select
                value={a.funding_account_id ?? ''}
                onChange={(e) => patch.mutate({ id: a.id, funding_account_id: e.target.value ? Number(e.target.value) : null })}
                className={cn('w-[120px] shrink-0 [&_select]:h-8 [&_select]:text-xs', !a.funding_account_id && '[&_select]:border-warn')}
                aria-label={`${a.name} 출금 통장`}
                title="이 체크카드가 돈을 빼 가는 통장 (잔액 검증에 쓰여요)"
              >
                <option value="">출금 통장?</option>
                {accounts
                  .filter((b) => b.kind === 'bank')
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {(b.label || b.name).slice(0, 12)}
                    </option>
                  ))}
              </Select>
            )}
            <Select
              value={a.kind}
              onChange={(e) => patch.mutate({ id: a.id, kind: e.target.value as AccountKind })}
              className="w-[108px] shrink-0 [&_select]:h-8 [&_select]:text-xs"
              aria-label={`${a.name} 종류`}
            >
              {(Object.keys(ACCOUNT_KIND_LABEL) as AccountKind[]).map((k) => (
                <option key={k} value={k}>
                  {ACCOUNT_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </div>
        ))}
      </CardBody>
    </Card>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, post } from './client'
import type { Txn } from './money'

function useInvalidate(keys: string[]) {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ predicate: (q) => keys.includes(String(q.queryKey[0])) })
}

/** Everything except auth: used after edits that touch transactions. */
function useInvalidateData() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'auth' && q.queryKey[0] !== 'remote' })
}

// ---------- AI helper ----------

export interface AskTurn {
  q: string
  a: string
  tool_calls?: { name: string; input: unknown }[]
}

export function useAsk() {
  return useMutation({
    mutationFn: (body: { question: string; history: AskTurn[] }) =>
      post<{ answer: string; tool_calls: { name: string; input: unknown }[]; usage: { input: number; output: number } }>('/ai/ask', body),
  })
}

export interface ReportMeta {
  id: number
  month: string
  created_at: string
  model: string
  input_tokens: number
  output_tokens: number
}

export interface Report extends ReportMeta {
  markdown: string
}

export const useReports = () => useQuery({ queryKey: ['reports'], queryFn: () => api<ReportMeta[]>('/ai/reports') })

export const useReport = (id: number | null) =>
  useQuery({ queryKey: ['reports', id], queryFn: () => api<Report>(`/ai/reports/${id}`), enabled: id != null })

export function useMakeReport() {
  const done = useInvalidate(['reports'])
  return useMutation({ mutationFn: (month: string) => post<Report>(`/ai/reports?month=${month}`), onSuccess: done })
}

export function useDeleteReport() {
  const done = useInvalidate(['reports'])
  return useMutation({ mutationFn: (id: number) => api(`/ai/reports/${id}`, { method: 'DELETE' }), onSuccess: done })
}

export interface ReceiptItem {
  date: string | null
  time: string | null
  merchant: string
  currency: string
  fx_amount: number | null
  krw_amount: number | null
  refund: boolean
  category: string | null
  memo: string | null
}

export function useReadReceipts() {
  return useMutation({
    mutationFn: (files: File[]) => {
      const form = new FormData()
      for (const f of files) form.append('files', f, f.name)
      return api<{ items: ReceiptItem[] }>('/ai/receipts', { method: 'POST', body: form })
    },
  })
}

export interface ManualInput {
  account_id: number
  occurred_at: string
  amount: number
  merchant: string
  category?: string | null
  note?: string | null
  fx_currency?: string | null
  fx_amount?: number | null
}

export function useCreateManual() {
  const done = useInvalidateData()
  return useMutation({ mutationFn: (items: ManualInput[]) => post<{ items: Txn[] }>('/transactions/manual', items), onSuccess: done })
}

export function useDeleteTxn() {
  const done = useInvalidateData()
  return useMutation({ mutationFn: (id: number) => api(`/transactions/${id}`, { method: 'DELETE' }), onSuccess: done })
}

export function useCreateAccount() {
  const done = useInvalidate(['accounts'])
  return useMutation({ mutationFn: (body: { name: string; kind: string }) => post<{ id: number; name: string }>('/accounts', body), onSuccess: done })
}

// ---------- recurring ----------

export interface RecurringItem {
  key: string
  merchant: string
  category: string
  account_id: number
  cadence: 'weekly' | 'monthly' | 'yearly'
  amount: number
  last_amount: number
  count: number
  first_date: string
  last_date: string
  next_date: string
  day_of_month: number | null
  active: boolean
  monthly_cost: number
  yearly_cost: number
  ignored: boolean
}

export interface RecurringData {
  items: RecurringItem[]
  monthly_total: number
  yearly_total: number
  upcoming: { date: string; merchant: string; amount: number; category: string; key: string }[]
}

export const useRecurring = (includeIgnored = false) =>
  useQuery({ queryKey: ['recurring', includeIgnored], queryFn: () => api<RecurringData>(`/recurring?include_ignored=${includeIgnored}`) })

export function useIgnoreRecurring() {
  const done = useInvalidate(['recurring'])
  return useMutation({ mutationFn: (body: { key: string; ignored: boolean }) => post('/recurring/ignore', body), onSuccess: done })
}

// ---------- balance checks ----------

export interface CheckReport {
  account: { id: number; name: string; kind?: string }
  anchor: { date: string; amount: number; source: 'banksalad' | 'check' } | null
  first_date: string | null
  opening_implied: number | null
  negative: { date: string; implied: number } | null
  checks: { id: number; on_date: string; actual: number; implied: number; diff: number; note: string | null; is_anchor: boolean }[]
  intervals: { from: string; to: string; unrecorded: number; ok: boolean }[]
  monthly: { date: string; implied: number }[]
}

export const useCheckReport = (accountId: number | null) =>
  useQuery({ queryKey: ['checks', accountId], queryFn: () => api<CheckReport>(`/checks/${accountId}`), enabled: accountId != null })

export function useAddCheck() {
  const done = useInvalidate(['checks'])
  return useMutation({
    mutationFn: (body: { account_id: number; on_date: string; amount: number; note?: string | null }) => post<CheckReport>('/checks', body),
    onSuccess: done,
  })
}

export function useDeleteCheck() {
  const done = useInvalidate(['checks'])
  return useMutation({ mutationFn: (id: number) => api<CheckReport>(`/checks/${id}`, { method: 'DELETE' }), onSuccess: done })
}

// ---------- backups & autostart ----------

export interface BackupStatus {
  dir: string
  default_dir: string
  key_file: string
  key_exists: boolean
  last: string | null
  keep: number
  files: { name: string; bytes: number; at: string }[]
}

export const useBackup = () => useQuery({ queryKey: ['backup'], queryFn: () => api<BackupStatus>('/backup') })

export function useRunBackup() {
  const done = useInvalidate(['backup'])
  return useMutation({ mutationFn: () => post<{ file: string; bytes: number }>('/backup/run'), onSuccess: done })
}

export function useBackupDir() {
  const done = useInvalidate(['backup'])
  return useMutation({ mutationFn: (dir: string | null) => api<BackupStatus>('/backup/settings', { method: 'PUT', body: JSON.stringify({ dir }) }), onSuccess: done })
}

export function useRevealKey() {
  return useMutation({ mutationFn: () => api<{ key: string; file: string }>('/backup/key') })
}

export interface ServiceStatus {
  supervised: boolean // this server was started by the background service
  service: string | null // the service's status line, null when it isn't running
  autostart: boolean // starts at Windows log-in
  shortcuts: boolean // Start menu / desktop icons exist
  build: { build: string } | null
  windows: boolean
}

export const useService = () => useQuery({ queryKey: ['service'], queryFn: () => api<ServiceStatus>('/system/service') })

export function useSetAutostart() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (enabled: boolean) => api<ServiceStatus>('/system/autostart', { method: 'PUT', body: JSON.stringify({ enabled }) }),
    onSuccess: (d) => qc.setQueryData(['service'], d),
  })
}

export function useMakeShortcuts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => post<ServiceStatus & { made: string[] }>('/system/shortcuts'),
    onSuccess: (d) => qc.setQueryData(['service'], d),
  })
}

export function useRestartService() {
  return useMutation({ mutationFn: () => post<{ ok: boolean }>('/system/restart') })
}

// ---------- running ----------

export interface RunningData {
  connected: boolean
  runlab_db: string
  months: { month: string; spend: number; km: number }[]
  total_spend: number
  total_km: number
  cost_per_km: number | null
  shoes: { id: number; name: string; brand: string | null; purchased_on: string | null; retired: boolean; km: number; price: number | null; cost_per_km: number | null }[]
  races: { id: number; name: string; race_day: string; distance_km: number; fee: number | null }[]
  purchases: { id: number; date: string; merchant: string; amount: number; gear_id: number | null; race_id: number | null }[]
}

export const useRunning = () => useQuery({ queryKey: ['running'], queryFn: () => api<RunningData>('/running') })

export function useRunLink() {
  const done = useInvalidate(['running'])
  return useMutation({
    mutationFn: (body: { txn_id: number; gear_id: number | null; race_id: number | null }) =>
      api<RunningData>('/running/link', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: done,
  })
}

// ---------- 정산 (reimbursements) ----------

export type ClaimKind = 'reimburse' | 'loan'

export interface Claim {
  id: number
  name: string
  kind: ClaimKind
  trip_id: number | null
  trip_name: string | null
  status: 'open' | 'closed'
  expected_date: string | null
  note: string | null
  paid: number
  reimbursed: number
  outstanding: number
  count: number
  first_date: string | null
  items?: Txn[]
  candidates?: Txn[]
}

export interface ClaimInput {
  name: string
  kind?: ClaimKind
  trip_id?: number | null
  expected_date?: string | null
  note?: string | null
}

/** Body for PUT /claims/{id}: everything the claim already has, with some fields changed. */
export const claimInput = (c: Claim, patch: Partial<ClaimInput> = {}): ClaimInput & { id: number } => ({
  id: c.id, name: c.name, kind: c.kind, trip_id: c.trip_id, expected_date: c.expected_date, note: c.note, ...patch,
})

export const useClaims = () => useQuery({ queryKey: ['claims'], queryFn: () => api<{ claims: Claim[]; outstanding: number }>('/claims') })

export const useClaim = (id: number | null) =>
  useQuery({ queryKey: ['claims', id], queryFn: () => api<Claim>(`/claims/${id}`), enabled: id != null })

export function useCreateClaim() {
  const done = useInvalidateData()
  return useMutation({
    mutationFn: (body: ClaimInput & { txn_ids?: number[] }) => post<Claim>('/claims', body),
    onSuccess: done,
  })
}

export function useUpdateClaim() {
  const done = useInvalidateData()
  return useMutation({
    mutationFn: ({ id, ...body }: ClaimInput & { id: number }) =>
      api<Claim>(`/claims/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: done,
  })
}

export function useLinkClaim() {
  const done = useInvalidateData()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; txn_ids: number[]; linked: boolean }) => post<Claim>(`/claims/${id}/link`, body),
    onSuccess: done,
  })
}

export function useCloseClaim() {
  const done = useInvalidateData()
  return useMutation({
    mutationFn: ({ id, reopen, book_shortfall }: { id: number; reopen?: boolean; book_shortfall?: boolean }) =>
      reopen ? post<Claim>(`/claims/${id}/reopen`) : post<Claim>(`/claims/${id}/close`, { book_shortfall: book_shortfall ?? true }),
    onSuccess: done,
  })
}

export function useDeleteClaim() {
  const done = useInvalidateData()
  return useMutation({ mutationFn: (id: number) => api(`/claims/${id}`, { method: 'DELETE' }), onSuccess: done })
}

// ---------- data range ----------

export const useLedger = () => useQuery({ queryKey: ['ledger'], queryFn: () => api<{ start: string | null }>('/ledger') })

export function useSetLedger() {
  const done = useInvalidateData()
  return useMutation({
    mutationFn: (start: string | null) =>
      api<{ start: string | null; removed: number; checks_removed: number }>('/ledger', { method: 'PUT', body: JSON.stringify({ start }) }),
    onSuccess: done,
  })
}

// ---------- bank statement check ----------

export interface StatementResult {
  account: string
  statement: { rows: number; first: string; last: string; last_balance: number | null }
  ledger: { rows: number; first: string; last: string }
  compared: number
  matched: number
  via_other: { date: string; merchant: string; memo: string | null; amount: number; booked_on: string; booked_as: string }[]
  via_other_total: number
  missing: { date: string; merchant: string; memo: string | null; amount: number }[]
  missing_total: number
  extra: { date: string; merchant: string; amount: number; id: number }[]
  before: { rows: number; first: string | null; last: string | null; balance: number | null }
  checks_added: number
  report: CheckReport
}

// ---------- card statements ----------

export interface CardBill {
  month: string
  filename: string
  lines: number
  total: number
  first: string
  last: string
  matched: number
  fx: { date: string; merchant: string; statement: number; moneylab: number; diff: number; currency: string | null; txn_id: number }[]
  fx_total: number
  missing: { date: string; merchant: string; amount: number; currency: string | null; fee: boolean }[]
  benefits: { date: string; merchant: string; amount: number; benefit: string; benefit_amount: number }[]
  bank_paid: number
  bank_payments: number[]
}

export interface CardRow {
  id: number
  date: string
  amount: number
  merchant: string
  title: string | null
  account: string
  dup: boolean
}

export interface CardIssuerReport {
  issuer: string
  cards: string[]
  first: string
  last: string
  bills: CardBill[]
  extra: CardRow[]
  released: CardRow[]
}

export interface CardStatementResult {
  added: { date: string; amount: number; title: string }[]
  report: { issuers: CardIssuerReport[] }
}

export function useCardStatements() {
  const done = useInvalidateData()
  return useMutation({
    mutationFn: ({ files, apply }: { files: File[]; apply: boolean }) => {
      const form = new FormData()
      for (const f of files) form.append('files', f, f.name)
      form.append('apply', String(apply))
      return api<CardStatementResult>('/checks/card-statements', { method: 'POST', body: form })
    },
    onSuccess: (r) => r.added.length && done(),
  })
}

export function useCheckStatement() {
  const done = useInvalidate(['checks'])
  return useMutation({
    mutationFn: ({ file, account_id }: { file: File; account_id: number }) => {
      const form = new FormData()
      form.append('file', file, file.name)
      form.append('account_id', String(account_id))
      return api<StatementResult>('/checks/statement', { method: 'POST', body: form })
    },
    onSuccess: done,
  })
}

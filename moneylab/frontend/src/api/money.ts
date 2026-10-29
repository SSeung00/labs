import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, post } from './client'

// ---------- types ----------

export type Kind = 'expense' | 'income' | 'transfer' | 'card_payment' | 'savings' | 'invest' | 'claim'
export type AccountKind = 'bank' | 'card' | 'check_card' | 'pay' | 'savings' | 'invest' | 'cash' | 'other'

export interface Txn {
  id: number
  occurred_at: string
  amount: number
  currency: string
  merchant: string
  /** my own name for it ("러닝화 1080 V15"); shown instead of the merchant when set */
  title: string | null
  account: { id: number; name: string; kind: AccountKind }
  kind: Kind
  category: string
  src: { type: string; cat: string; sub: string }
  rule_id: number | null
  trip_id: number | null
  dup_of_id: number | null
  note: string | null
  reviewed: boolean
  locked: { kind: boolean; category: boolean; trip: boolean; dup: boolean }
  source: 'banksalad' | 'file' | 'notify' | 'manual'
  provisional: boolean
  ai: { category: string; confidence: 'high' | 'medium' | 'low' | null; reason: string | null } | null
  fx: { currency: string | null; amount: number | null; fee: number | null } | null
  claim_id: number | null
  funded_by: number | null
}

export interface TxnPage {
  items: Txn[]
  total: number
  spending: number
}

export interface TxnFilters {
  start?: string
  end?: string
  category?: string
  kind?: string
  account_id?: number
  trip_id?: number
  q?: string
  view?: 'all' | 'review' | 'uncategorized' | 'dups' | 'big_transfers' | 'live'
  include_dups?: boolean
  limit?: number
  offset?: number
}

export interface Category {
  name: string
  group: string
  color: string
  sort: number
  /** 대분류 of a 소분류; null for a 대분류 */
  parent: string | null
}

export interface Account {
  id: number
  name: string
  kind: AccountKind
  label: string | null
  hidden: boolean
  issuer: string | null
  funding_account_id: number | null
  txn_count: number
  first_at: string | null
  last_at: string | null
  stale: boolean
  days_since: number | null
}

export interface MonthSummary {
  month: string
  spending: number
  income: number
  savings_in: number
  card_payments: number
  by_group: Record<string, number>
  by_category: Record<string, number>
  /** spending outside any trip/event, and inside them */
  daily: number
  trips: number
  trip_names: Record<string, number>
  by_group_daily: Record<string, number>
  by_category_daily: Record<string, number>
}

export interface CategoryAmount {
  category: string
  group: string
  color: string
  amount: number
  count: number
}

export interface Balances {
  as_of: string
  assets: number
  debts: number
  net: number
  groups: { side: 'asset' | 'debt'; group: string; amount: number; items: { name: string; amount: number }[] }[]
}

export interface ReviewCounts {
  uncategorized: number
  dups: number
  big_transfers: number
  total: number
}

export interface Overview {
  empty: boolean
  review: ReviewCounts
  range?: { first: string; last: string }
  months?: MonthSummary[]
  year?: number
  ytd?: CategoryAmount[]
  ytd_daily?: { category: string; amount: number; count: number }[]
  hobbies?: { category: string; color: string; ytd: number; last12: number }[]
  corrected?: {
    card_payments_as_spending: { amount: number; count: number }
    duplicates: { amount: number; count: number }
  }
  balances?: Balances | null
  claims_outstanding?: number
}

export type TripKind = 'travel' | 'event'

export interface Trip {
  id: number
  name: string
  kind: TripKind
  start_date: string
  end_date: string
  budget: number | null
  note: string | null
  days: number
  spent: number
  count: number
  per_day: number
  /** 학회·행사: what I paid for others there and how much came back */
  claims: { ids: number[]; paid: number; reimbursed: number; outstanding: number; open: boolean } | null
}

export interface TripDetail extends Trip {
  fx: { currency: string; foreign: number; krw: number; count: number; rate: number | null }[]
  fees: number
  phase: { before: number; during: number; after: number }
  by_category: { category: string; amount: number; color: string }[]
  by_day: { date: string; amount: number }[]
  items: Txn[]
  candidates: Txn[]
  /** 학회·행사: rows in its 정산 (paid for others, paid back) */
  claim_items: Txn[]
}

export interface TripInput {
  name: string
  kind: TripKind
  start_date: string
  end_date: string
  budget: number | null
  note?: string | null
}

export interface Rule {
  id: number
  name: string
  pattern: string
  account_kind: AccountKind | null
  set_category: string | null
  set_kind: Kind | null
  priority: number
  enabled: boolean
  builtin: boolean
  matched: number
}

export type RuleInput = Omit<Rule, 'id' | 'builtin' | 'matched'>

export interface Goal {
  id: number
  name: string
  kind: 'fund' | 'savings'
  target_amount: number | null
  target_date: string | null
  start_date: string | null
  monthly_amount: number | null
  account_id: number | null
  saved_manual: number | null
  note: string | null
  account_name: string | null
  current: number | null
  balance_as_of: string | null
  months_left: number | null
  projected: number | null
  rate: number | null
  gov_monthly: number | null
  tax_free: boolean
  maturity: { months: number; principal: number; interest: number; tax: number; gov: number; total: number } | null
  need_per_month: number | null
  progress: number | null
  deposits: { month: string; amount: number }[]
}

export type GoalInput = Pick<
  Goal,
  | 'name'
  | 'kind'
  | 'target_amount'
  | 'target_date'
  | 'start_date'
  | 'monthly_amount'
  | 'account_id'
  | 'saved_manual'
  | 'note'
  | 'rate'
  | 'gov_monthly'
  | 'tax_free'
>

export interface ImportResult {
  filename: string
  error?: string
  batch_id?: number
  period_start?: string
  period_end?: string
  rows_total?: number
  rows_new?: number
  rows_existing?: number
  rows_skipped?: number
  new_accounts?: { name: string; kind: AccountKind }[]
  already_imported?: boolean
}

export interface ImportBatch {
  id: number
  filename: string
  imported_at: string
  period_start: string | null
  period_end: string | null
  rows_total: number
  rows_new: number
  rows_existing: number
  rows_skipped: number
}

export interface TxnPatch {
  kind?: Kind
  category?: string
  trip_id?: number | null
  title?: string | null
  note?: string | null
  reviewed?: boolean
  not_duplicate?: boolean
  reset?: boolean
  fx_currency?: string | null
  fx_amount?: number | null
  fee?: number | null
  claim_id?: number | null
}

// ---------- labels ----------

export const KIND_LABEL: Record<Kind, string> = {
  expense: '지출',
  income: '수입',
  transfer: '이체',
  card_payment: '카드대금',
  savings: '저축',
  invest: '투자',
  claim: '정산',
}

export const ISSUERS = ['삼성', '현대', '신한', 'KB국민', '롯데', '하나', '우리', 'BC', 'NH농협', '씨티', '카카오뱅크'] as const

export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  bank: '은행',
  card: '신용카드',
  check_card: '체크카드',
  pay: '간편결제',
  savings: '적금·청약',
  invest: '투자',
  cash: '현금',
  other: '기타',
}

// ---------- queries ----------

function qs(params: object): string {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') s.set(k, String(v))
  }
  const out = s.toString()
  return out ? `?${out}` : ''
}

export function useOverview() {
  return useQuery({ queryKey: ['overview'], queryFn: () => api<Overview>('/summary/overview') })
}

export function useTransactions(filters: TxnFilters) {
  return useQuery({
    queryKey: ['transactions', filters],
    queryFn: () => api<TxnPage>(`/transactions${qs(filters)}`),
    placeholderData: keepPreviousData,
  })
}

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/categories'), staleTime: Infinity })
}

export function useAccounts() {
  return useQuery({ queryKey: ['accounts'], queryFn: () => api<Account[]>('/accounts') })
}

export function useCategoryTotals(start?: string, end?: string) {
  return useQuery({
    queryKey: ['summary', 'categories', start, end],
    queryFn: () => api<CategoryAmount[]>(`/summary/categories${qs({ start, end })}`),
  })
}

export function useTrips() {
  return useQuery({ queryKey: ['trips'], queryFn: () => api<Trip[]>('/trips') })
}

export function useTrip(id: number) {
  return useQuery({ queryKey: ['trips', id], queryFn: () => api<TripDetail>(`/trips/${id}`) })
}

export function useRules() {
  return useQuery({ queryKey: ['rules'], queryFn: () => api<Rule[]>('/rules') })
}

export function useGoals() {
  return useQuery({
    queryKey: ['goals'],
    queryFn: () =>
      api<{ goals: Goal[]; suggestions: { account_id: number; name: string; balance: number | null; monthly_amount: number | null }[] }>(
        '/goals',
      ),
  })
}

export function useImports() {
  return useQuery({ queryKey: ['imports'], queryFn: () => api<ImportBatch[]>('/imports') })
}

// ---------- mutations ----------

/** Almost every edit re-derives categories/trips server-side, so refresh all money views. */
function useInvalidateAll() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'auth' && q.queryKey[0] !== 'remote' })
}

export function usePatchTxn() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: TxnPatch }) =>
      api<Txn>(`/transactions/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: invalidate,
  })
}

export function useBulkPatch() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (body: { ids: number[]; patch: TxnPatch }) => post<{ updated: number }>('/transactions/bulk', body),
    onSuccess: invalidate,
  })
}

export function useMakeRule() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; pattern?: string; set_category?: string; set_kind?: Kind }) =>
      post<{ rule_id: number; matched: number }>(`/transactions/${id}/rule`, body),
    onSuccess: invalidate,
  })
}

export function useUpload() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: async (files: File[]) => {
      const form = new FormData()
      for (const f of files) form.append('files', f, f.name)
      return api<{ results: ImportResult[] }>('/imports', { method: 'POST', body: form })
    },
    onSuccess: invalidate,
  })
}

export function useSaveTrip() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ id, ...body }: TripInput & { id?: number }) =>
      id ? api<Trip>(`/trips/${id}`, { method: 'PUT', body: JSON.stringify(body) }) : post<Trip>('/trips', body),
    onSuccess: invalidate,
  })
}

export function useDeleteTrip() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (id: number) => api(`/trips/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })
}

export function useSaveRule() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ id, ...body }: RuleInput & { id?: number }) =>
      id ? api<Rule>(`/rules/${id}`, { method: 'PUT', body: JSON.stringify(body) }) : post<Rule>('/rules', body),
    onSuccess: invalidate,
  })
}

export function useDeleteRule() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (id: number) => api(`/rules/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })
}

export function useRulePreview() {
  return useMutation({
    mutationFn: (body: { pattern: string; account_kind?: string | null }) =>
      post<{ count: number; merchants: { merchant: string; count: number; amount: number }[] }>('/rules/preview', body),
  })
}

export function useSaveGoal() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ id, ...body }: GoalInput & { id?: number }) =>
      id ? api<Goal>(`/goals/${id}`, { method: 'PUT', body: JSON.stringify(body) }) : post<Goal>('/goals', body),
    onSuccess: invalidate,
  })
}

export function useDeleteGoal() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (id: number) => api(`/goals/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })
}

export function usePatchAccount() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; kind?: AccountKind; label?: string | null; hidden?: boolean; issuer?: string | null; funding_account_id?: number | null }) =>
      api<Account>(`/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: invalidate,
  })
}

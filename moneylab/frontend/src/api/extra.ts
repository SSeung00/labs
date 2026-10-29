import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, post } from './client'

// ---------- investing ----------

export interface Holding {
  id: number
  account: string
  name: string
  ticker: string | null
  asset_class: string
  quantity: number | null
  cost: number
  value: number
  updated_at: string | null
  source: 'manual' | 'banksalad'
  note: string | null
}

export type HoldingInput = Pick<Holding, 'account' | 'name' | 'ticker' | 'asset_class' | 'quantity' | 'cost' | 'value' | 'note'>

export interface InvestPolicy {
  goal?: string
  horizon?: string
  risk?: string
  rules?: string
  notes?: string
  updated_at?: string
}

export interface InvestOverview {
  holdings: Holding[]
  totals: { cost: number; value: number; gain: number; gain_pct: number | null }
  classes: { asset_class: string; value: number; pct: number; target_pct: number | null; diff: number | null }[]
  targets: Record<string, number>
  asset_classes: string[]
  contributions: { month: string; amount: number }[]
  accounts: { as_of: string | null; items: { name: string; amount: number; group: string }[] }
  snapshots: { as_of: string; cost: number; value: number }[]
  policy: InvestPolicy
}

export const useInvest = () => useQuery({ queryKey: ['invest'], queryFn: () => api<InvestOverview>('/invest') })

function useInvalidate(keys: string[]) {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ predicate: (q) => keys.includes(String(q.queryKey[0])) })
}

export function useSaveHolding() {
  const done = useInvalidate(['invest'])
  return useMutation({
    mutationFn: ({ id, ...body }: HoldingInput & { id?: number }) =>
      id ? api<Holding>(`/invest/holdings/${id}`, { method: 'PUT', body: JSON.stringify(body) }) : post<Holding>('/invest/holdings', body),
    onSuccess: done,
  })
}

export function useDeleteHolding() {
  const done = useInvalidate(['invest'])
  return useMutation({ mutationFn: (id: number) => api(`/invest/holdings/${id}`, { method: 'DELETE' }), onSuccess: done })
}

export function useSaveTargets() {
  const done = useInvalidate(['invest'])
  return useMutation({
    mutationFn: (targets: Record<string, number>) => api('/invest/targets', { method: 'PUT', body: JSON.stringify({ targets }) }),
    onSuccess: done,
  })
}

export function useSavePolicy() {
  const done = useInvalidate(['invest'])
  return useMutation({
    mutationFn: (policy: InvestPolicy) => api<InvestPolicy>('/invest/policy', { method: 'PUT', body: JSON.stringify(policy) }),
    onSuccess: done,
  })
}

// ---------- net worth & cards ----------

export interface NetWorthPoint {
  as_of: string
  assets: number
  debts: number
  net: number
  groups: Record<string, number>
}

export const useNetWorth = () => useQuery({ queryKey: ['networth'], queryFn: () => api<NetWorthPoint[]>('/summary/networth') })

export interface CardsSummary {
  months: string[]
  issuers: { issuer: string; cards: { name: string; months: number[] }[]; used: number[]; paid: number[] }[]
}

export const useCards = () => useQuery({ queryKey: ['cards'], queryFn: () => api<CardsSummary>('/summary/cards') })

// ---------- live notifications ----------

export interface NotifyLog {
  id: number
  received_at: string
  app: string
  title: string
  text: string
  status: 'added' | 'duplicate' | 'ignored' | 'error'
  detail: string | null
  txn_id: number | null
}

export interface NotifyStatus {
  token: string
  path: string
  mapping: Record<string, number>
  pending: number
  pending_amount: number
  logs: NotifyLog[]
}

export const useNotifyStatus = () =>
  useQuery({ queryKey: ['notify'], queryFn: () => api<NotifyStatus>('/hooks/notify/status'), refetchInterval: 15_000 })

export function useRotateToken() {
  const done = useInvalidate(['notify'])
  return useMutation({ mutationFn: () => post<{ token: string }>('/hooks/notify/rotate'), onSuccess: done })
}

export function useSaveNotifyMapping() {
  const done = useInvalidate(['notify'])
  return useMutation({
    mutationFn: (mapping: Record<string, number | null>) => api('/hooks/notify/accounts', { method: 'PUT', body: JSON.stringify({ mapping }) }),
    onSuccess: done,
  })
}

export function useTestNotify() {
  return useMutation({
    mutationFn: (body: { app?: string; title?: string; text: string }) =>
      post<{ ok: boolean; amount?: number; occurred_at?: string; merchant?: string; issuer?: string | null; account?: string | null }>(
        '/hooks/notify/test',
        body,
      ),
  })
}

// ---------- AI suggestions ----------

export const useAiStatus = () =>
  useQuery({ queryKey: ['ai'], queryFn: () => api<{ available: boolean; model: string; pending: number }>('/ai/status') })

export function useAiSuggest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => post<{ asked: number; suggested: number; remaining?: number; model?: string }>('/ai/suggest'),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => ['ai', 'transactions'].includes(String(q.queryKey[0])) }),
  })
}

// ---------- other bank / card files ----------

export interface FileMapping {
  date: number | null
  time: number | null
  merchant: number | null
  amount: number | null
  out: number | null
  in: number | null
  memo: number | null
  sign: 'expense_positive' | 'signed'
  bank_default?: '이체' | '지출'
}

export interface FilePreview {
  filename: string
  header_row: number
  header: string[]
  sample: string[][]
  mapping: FileMapping
  template: { id: number; name: string } | null
  account_id: number | null
  cutoff: string | null
  rows: number
  skipped: number
  first: string | null
  last: string | null
  parsed_sample: { occurred_at: string; merchant: string; amount: number; memo: string | null }[]
}

export interface FileCommitResult {
  filename: string
  account: string
  period_start: string | null
  period_end: string | null
  rows_total: number
  rows_new: number
  rows_existing: number
  rows_skipped: number
  after_cutoff: number
}

export function useFilePreview() {
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file, file.name)
      return api<FilePreview>('/imports/file/preview', { method: 'POST', body: form })
    },
  })
}

export function useFileCommit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: {
      file: File
      mapping: FileMapping
      account_id?: number | null
      new_account?: { name: string; kind: string } | null
      cutoff?: string | null
      save_template?: string | null
    }) => {
      const form = new FormData()
      form.append('file', args.file, args.file.name)
      form.append('mapping', JSON.stringify(args.mapping))
      if (args.account_id) form.append('account_id', String(args.account_id))
      if (args.new_account) form.append('new_account', JSON.stringify(args.new_account))
      if (args.cutoff) form.append('cutoff', args.cutoff)
      if (args.save_template) form.append('save_template', args.save_template)
      return api<FileCommitResult>('/imports/file/commit', { method: 'POST', body: form })
    },
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'auth' && q.queryKey[0] !== 'remote' }),
  })
}

// ---------- saved file layouts ----------

export interface ImportTemplate {
  id: number
  signature: string
  name: string
  mapping: string
  account_id: number | null
}

export const useTemplates = () => useQuery({ queryKey: ['templates'], queryFn: () => api<ImportTemplate[]>('/imports/templates') })

export function useDeleteTemplate() {
  const done = useInvalidate(['templates'])
  return useMutation({ mutationFn: (id: number) => api(`/imports/templates/${id}`, { method: 'DELETE' }), onSuccess: done })
}

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, post } from './client'

export type LineKind = 'spend' | 'fund' | 'save' | 'invest'

export const LINE_KIND_LABEL: Record<LineKind, string> = {
  spend: '지출 한도',
  fund: '적립 봉투',
  save: '저축',
  invest: '투자',
}

export interface BudgetLine {
  id: number
  name: string
  kind: LineKind
  categories: (string | number)[]
  include_trips: boolean
  monthly_amount: number
  start_month: string | null
  opening_balance: number
  color: string | null
  sort: number
  active: boolean
}

export type BudgetLineInput = Omit<BudgetLine, 'id' | 'sort'> & { sort?: number }

export interface MonthLine {
  id: number
  name: string
  kind: LineKind
  color: string | null
  categories: (string | number)[]
  include_trips: boolean
  planned: number
  actual: number
  balance?: number
}

export interface MonthBudget {
  month: string
  pace: number
  configured: boolean
  income: { planned: number; actual: number }
  lines: MonthLine[]
  unbudgeted: { category: string; amount: number; color: string }[]
  totals: { spend_planned: number; spent: number; save_planned: number; invest_planned: number }
  settings: { income: number; emergency_months: number }
}

export interface ForecastMonth {
  month: string
  income: number
  spend: number
  transfers: number
  events: { id: number | null; name: string; amount: number; line_id: number | null; trip_id: number | null }[]
  event_out: number
  cash: number
  reserved: number
  emergency: number
  free: number
  funds: Record<string, number>
}

export interface Forecast {
  monthly_balance: number
  committed: number
  start_cash: number | null
  cash_as_of: string | null
  cash_known: boolean
  settings: { income: number; emergency_months: number }
  emergency_target: number
  months: ForecastMonth[]
  funds: { id: number; name: string; color: string | null }[]
  warnings: { month: string; kind: string; message: string }[]
}

export interface PlanEvent {
  id: number
  month: string
  name: string
  amount: number
  line_id: number | null
  trip_id: number | null
  note: string | null
}

export type PlanEventInput = Omit<PlanEvent, 'id'>

export interface DraftLine {
  name: string
  kind: LineKind
  monthly_amount: number
  categories: (string | number)[]
  include_trips?: boolean
  color?: string
  basis?: string
}

export interface Draft {
  income: number
  income_basis: string
  lines: DraftLine[]
  surplus: number
}

export interface BudgetHistoryMonth {
  month: string
  income: number
  lines: { id: number; planned: number; actual: number }[]
  unbudgeted: number
}

export function useMonthBudget(month: string) {
  return useQuery({
    queryKey: ['budget', month],
    queryFn: () => api<MonthBudget>(`/budget?month=${month}`),
    placeholderData: keepPreviousData,
  })
}

export function useBudgetHistory(months = 6) {
  return useQuery({ queryKey: ['budget', 'history', months], queryFn: () => api<BudgetHistoryMonth[]>(`/budget/history?months=${months}`) })
}

export function useBudgetLines() {
  return useQuery({ queryKey: ['budget', 'lines'], queryFn: () => api<BudgetLine[]>('/budget/lines') })
}

export function useForecast(months = 12) {
  return useQuery({ queryKey: ['forecast', months], queryFn: () => api<Forecast>(`/plan/forecast?months=${months}`) })
}

export function usePlanEvents() {
  return useQuery({ queryKey: ['plan', 'events'], queryFn: () => api<PlanEvent[]>('/plan/events') })
}

export function useDraft(enabled: boolean) {
  return useQuery({ queryKey: ['budget', 'draft'], queryFn: () => api<Draft>('/budget/draft'), enabled, staleTime: 0 })
}

function useInvalidatePlan() {
  const qc = useQueryClient()
  return () =>
    qc.invalidateQueries({ predicate: (q) => ['budget', 'forecast', 'plan', 'overview'].includes(String(q.queryKey[0])) })
}

export function useSaveLine() {
  const done = useInvalidatePlan()
  return useMutation({
    mutationFn: ({ id, ...body }: BudgetLineInput & { id?: number }) =>
      id ? api<BudgetLine>(`/budget/lines/${id}`, { method: 'PUT', body: JSON.stringify(body) }) : post<BudgetLine>('/budget/lines', body),
    onSuccess: done,
  })
}

export function useDeleteLine() {
  const done = useInvalidatePlan()
  return useMutation({ mutationFn: (id: number) => api(`/budget/lines/${id}`, { method: 'DELETE' }), onSuccess: done })
}

export function useReorderLines() {
  const done = useInvalidatePlan()
  return useMutation({ mutationFn: (ids: number[]) => api('/budget/order', { method: 'PUT', body: JSON.stringify({ ids }) }), onSuccess: done })
}

export function useSavePlanSettings() {
  const done = useInvalidatePlan()
  return useMutation({
    mutationFn: (body: { income: number; emergency_months: number }) => api('/budget/settings', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: done,
  })
}

export function useApplyDraft() {
  const done = useInvalidatePlan()
  return useMutation({ mutationFn: (body: { income: number; lines: DraftLine[] }) => post('/budget/draft/apply', body), onSuccess: done })
}

export function useSaveEvent() {
  const done = useInvalidatePlan()
  return useMutation({
    mutationFn: ({ id, ...body }: PlanEventInput & { id?: number }) =>
      id ? api<PlanEvent>(`/plan/events/${id}`, { method: 'PUT', body: JSON.stringify(body) }) : post<PlanEvent>('/plan/events', body),
    onSuccess: done,
  })
}

export function useDeleteEvent() {
  const done = useInvalidatePlan()
  return useMutation({ mutationFn: (id: number) => api(`/plan/events/${id}`, { method: 'DELETE' }), onSuccess: done })
}

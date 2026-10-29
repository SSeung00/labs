import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, post } from './client'

export interface CoachReport {
  id: number
  week_start: string
  created_at: string
  model: string
  markdown: string
  input_tokens: number | null
  output_tokens: number | null
}

export const useCoachStatus = () => useQuery({ queryKey: ['coach', 'status'], queryFn: () => api<{ available: boolean; model: string }>('/coach/status') })
export const useCoachReports = () => useQuery({ queryKey: ['coach', 'reports'], queryFn: () => api<CoachReport[]>('/coach/reports?limit=5') })
export const useCoachContext = (enabled: boolean) =>
  useQuery({ queryKey: ['coach', 'context'], queryFn: () => api<Record<string, unknown>>('/coach/context'), enabled })

export function useGenerateReport() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: () => post<CoachReport>('/coach/weekly'), onSuccess: () => qc.invalidateQueries({ queryKey: ['coach'] }) })
}

export function useSendToGarmin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => post<{ ok: boolean; garmin_workout_id: number }>(`/workouts/${id}/garmin`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plan'] }),
  })
}

// ---------- usage & budget ----------

export interface AiUsage {
  available: boolean
  model: string
  budget_usd: number
  spent_usd: number
  remaining_usd: number
  this_month_usd: number
  by_feature: Record<string, { calls: number; usd: number }>
  by_model: Record<string, { calls: number; usd: number }>
}

export const useAiUsage = () => useQuery({ queryKey: ['coach', 'usage'], queryFn: () => api<AiUsage>('/coach/usage') })

export function useSetBudget() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (usd: number) => api<AiUsage>('/coach/budget', { method: 'PUT', body: JSON.stringify({ usd }) }),
    onSuccess: (d) => qc.setQueryData(['coach', 'usage'], d),
  })
}

/** Any AI call changes spend; refresh the meter afterwards. */
function useAfterAi() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['coach', 'usage'] })
}

// ---------- single run ----------

export interface ActivityInsight {
  id: number
  activity_id: number
  created_at: string
  model: string
  markdown: string
  cost_usd: number | null
}

export const useActivityInsight = (id: number) =>
  useQuery({ queryKey: ['coach', 'activity', id], queryFn: () => api<ActivityInsight | null>(`/coach/activity/${id}`) })

export const useActivityAiContext = (id: number, enabled: boolean) =>
  useQuery({ queryKey: ['coach', 'activity', id, 'context'], queryFn: () => api<Record<string, unknown>>(`/coach/activity/${id}/context`), enabled })

export function useAnalyzeActivity(id: number) {
  const qc = useQueryClient()
  const after = useAfterAi()
  return useMutation({
    mutationFn: () => post<ActivityInsight>(`/coach/activity/${id}`),
    onSuccess: (d) => {
      qc.setQueryData(['coach', 'activity', id], d)
      after()
    },
    onError: after,
  })
}

// ---------- journal ----------

export interface ParsedInjury {
  body_part: string
  side: 'left' | 'right' | 'center'
  severity: number
  note: string
}

export interface ParsedJournal {
  day: string
  values: Record<string, number | string>
  current: Record<string, number | string | null>
  injuries: ParsedInjury[]
  summary: string
  unclear: string[]
}

export function useParseJournal() {
  const after = useAfterAi()
  return useMutation({
    mutationFn: (b: { text: string; injury_parts: string[] }) => post<ParsedJournal>('/coach/journal/parse', b),
    onSettled: after,
  })
}

// ---------- plan ----------

export interface PlanChange {
  workout_id: number
  action: 'move' | 'set_distance' | 'to_easy' | 'to_rest' | 'skip'
  new_day: string | null
  new_km: number | null
  reason: string
  before: { day: string; title: string; kind: string; km: number }
}

export interface PlanProposal {
  summary: string
  advice: string
  changes: PlanChange[]
}

export function useProposePlan() {
  const after = useAfterAi()
  return useMutation({ mutationFn: (text: string) => post<PlanProposal>('/coach/plan/propose', { text }), onSettled: after })
}

export function useApplyPlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (changes: PlanChange[]) => post<{ applied: number }>('/coach/plan/apply', { changes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plan'] }),
  })
}

// ---------- chat ----------

export interface ChatItem {
  role: 'user' | 'assistant'
  text: string
  tools?: string[]
}

export interface ChatView {
  id: number
  title: string
  created_at: string
  updated_at: string
  cost_usd: number
  items: ChatItem[]
}

export const useChats = () =>
  useQuery({ queryKey: ['coach', 'chats'], queryFn: () => api<{ id: number; title: string; updated_at: string; cost_usd: number }[]>('/coach/chats') })

export const useChat = (id: number | null) =>
  useQuery({ queryKey: ['coach', 'chat', id], queryFn: () => api<ChatView>(`/coach/chats/${id}`), enabled: id != null })

export function useSendChat() {
  const qc = useQueryClient()
  const after = useAfterAi()
  return useMutation({
    mutationFn: (b: { chat_id: number | null; text: string }) => post<ChatView>('/coach/chats', b),
    onSuccess: (d) => {
      qc.setQueryData(['coach', 'chat', d.id], d)
      qc.invalidateQueries({ queryKey: ['coach', 'chats'] })
    },
    onSettled: after,
  })
}

export function useDeleteChat() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api(`/coach/chats/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coach', 'chats'] }),
  })
}

export const fmtUsd = (v: number | null | undefined) => (v == null ? '—' : v < 0.01 ? '<$0.01' : `$${v.toFixed(2)}`)

// ---------- per-feature model & effort ----------

export interface AiConfig {
  features: { key: string; label: string; model: string; effort: string; default_model: string; default_effort: string }[]
  models: { id: string; label: string; input_per_mtok: number; output_per_mtok: number }[]
  efforts: string[]
}

export const useAiConfig = () => useQuery({ queryKey: ['coach', 'config'], queryFn: () => api<AiConfig>('/coach/config') })

export function useSetAiConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: { feature: string; model: string; effort: string }) => api<AiConfig>('/coach/config', { method: 'PUT', body: JSON.stringify(b) }),
    onSuccess: (d) => qc.setQueryData(['coach', 'config'], d),
  })
}

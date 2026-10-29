import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, post } from './client'
import type {
  AiConfig,
  AiUsage,
  CardItem,
  CardCounts,
  Conversation,
  Gloss,
  Mistake,
  PlacementView,
  ProfileResponse,
  Reading,
  ReadingSummary,
  Scenario,
  Stats,
  Today,
  TtsClip,
  Profile,
} from './types'

export const put = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) })
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) })
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' })

/** multipart POST (audio uploads); the browser sets the boundary header itself */
export const postForm = <T>(path: string, form: FormData) => api<T>(path, { method: 'POST', body: form })

// ---------- today / progress ----------

export const useToday = () => useQuery({ queryKey: ['today'], queryFn: () => api<Today>('/today'), staleTime: 15_000 })
export const useStats = () => useQuery({ queryKey: ['stats'], queryFn: () => api<Stats>('/stats') })

export function useCoachTip(enabled: boolean) {
  return useQuery({
    queryKey: ['coach', new Date().toDateString()],
    queryFn: () => post<{ day: string; text: string }>('/today/coach'),
    enabled,
    staleTime: Infinity,
    retry: false,
  })
}

export function useLogActivity() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: { kind: string; minutes: number; note?: string }) => post<Today>('/activity', b),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['today'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
    },
  })
}

/** After anything that studies: refresh the plan, streak and stats. */
export function useRefreshProgress() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['today'] })
    qc.invalidateQueries({ queryKey: ['stats'] })
  }
}

// ---------- profile / settings ----------

export const useProfile = () => useQuery({ queryKey: ['profile'], queryFn: () => api<ProfileResponse>('/profile') })

export function useUpdateProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (changes: Partial<Profile>) => put<{ profile: Profile }>('/profile', { changes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile'] })
      qc.invalidateQueries({ queryKey: ['today'] })
    },
  })
}

export const useAi = () => useQuery({ queryKey: ['ai'], queryFn: () => api<{ usage: AiUsage; config: AiConfig }>('/ai') })

// ---------- speech ----------

export const tts = (text: string, rate?: number) => post<TtsClip>('/tts', { text, rate })
export const ttsUrl = (key: string) => `/api/tts/${key}.mp3`

// ---------- reading ----------

export const useReadings = () => useQuery({ queryKey: ['readings'], queryFn: () => api<ReadingSummary[]>('/readings') })
export const useReading = (id: number) => useQuery({ queryKey: ['reading', id], queryFn: () => api<Reading>(`/readings/${id}`) })
export const gloss = (term: string, sentence: string) => post<Gloss>('/gloss', { term, sentence })

// ---------- cards ----------

export const useCards = (q: string, kind: string) =>
  useQuery({
    queryKey: ['cards', q, kind],
    queryFn: () =>
      api<{ total: number; cards: CardItem[]; counts: CardCounts; retention: { reviews: number; retention: number | null } }>(
        `/cards?q=${encodeURIComponent(q)}&kind=${kind}`,
      ),
  })

export function useAddCard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: { term: string; context?: string; meaning_ko?: string; definition_en?: string; kind?: string; source_kind?: string; source_id?: number }) =>
      post<CardItem>('/cards', b),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cards'] })
      qc.invalidateQueries({ queryKey: ['today'] })
    },
  })
}

export const useMistakes = () => useQuery({ queryKey: ['mistakes'], queryFn: () => api<Mistake[]>('/mistakes') })

// ---------- talk ----------

export const useScenarios = () => useQuery({ queryKey: ['scenarios'], queryFn: () => api<Scenario[]>('/talk/scenarios'), staleTime: Infinity })
export const useConversations = () => useQuery({ queryKey: ['talks'], queryFn: () => api<Conversation[]>('/talk') })
export const useConversation = (id: number) => useQuery({ queryKey: ['talk', id], queryFn: () => api<Conversation>(`/talk/${id}`) })

// ---------- placement ----------

export const usePlacement = (id: number | null) =>
  useQuery({
    queryKey: ['placement', id],
    queryFn: () => api<PlacementView>(`/placement/${id}`),
    enabled: id != null,
    refetchInterval: (q) => (q.state.data?.status === 'generating' ? 2000 : false),
  })

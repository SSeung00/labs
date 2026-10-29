import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, post } from './client'
import { del, patch, postForm, put } from './el'
import type { BookDetail, BookSummary, Checkin, Forecast, InkDoc, PlanResponse, StudyPlan, WritingItem, WritingTask } from './types'

// ---------- plan & forecast ----------

export const usePlan = () =>
  useQuery({
    queryKey: ['plan'],
    queryFn: () => api<PlanResponse>('/plan'),
    refetchInterval: (q) => (q.state.data?.generating ? 3000 : false),
  })

export const useForecast = () => useQuery({ queryKey: ['forecast'], queryFn: () => api<Forecast>('/forecast') })

export function useMakePlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (note: string) => post<StudyPlan>('/plan', { note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plan'] }),
  })
}

export function useCheckin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (force: boolean) => post<Checkin>('/plan/checkin', { force }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plan'] }),
  })
}

/** After anything that changes the plan's inputs. */
export function useRefreshPlan() {
  const qc = useQueryClient()
  return () => {
    for (const key of ['plan', 'today', 'stats', 'forecast', 'books']) qc.invalidateQueries({ queryKey: [key] })
  }
}

// ---------- books ----------

export const useBooks = () => useQuery({ queryKey: ['books'], queryFn: () => api<BookSummary[]>('/books') })

export const useBook = (id: number) =>
  useQuery({
    queryKey: ['book', id],
    queryFn: () => api<BookDetail>(`/books/${id}`),
    refetchInterval: (q) => (q.state.data?.status === 'researching' ? 3000 : false),
  })

export const addBook = (b: { title: string; author?: string; notes?: string }) => post<BookDetail>('/books', b)
export const activateBook = (id: number, b: { start?: string; days_per_week?: number; minutes_per_session?: number }) =>
  post<BookDetail>(`/books/${id}/activate`, b)
export const editBook = (id: number, b: Partial<{ status: string; title: string; units_done: number[]; units: { title: string; minutes: number }[]; unit_label: string }>) =>
  patch<BookDetail>(`/books/${id}`, b)
export const logBookSession = (id: number, b: { minutes: number; units: number[]; score?: number | null; band?: number | null; note?: string }) =>
  post<BookDetail>(`/books/${id}/sessions`, b)
export const retryBook = (id: number) => post<BookDetail>(`/books/${id}/retry`)
export const deleteBook = (id: number) => del<{ ok: boolean }>(`/books/${id}`)
export const addEvidence = (b: { skill: string; level: number; note?: string }) => post('/levels/evidence', b)

// ---------- writing ----------

export const useWritingTasks = () => useQuery({ queryKey: ['writing-tasks'], queryFn: () => api<WritingTask[]>('/writing/tasks'), staleTime: Infinity })
export const useWritings = () => useQuery({ queryKey: ['writings'], queryFn: () => api<WritingItem[]>('/writing') })
export const useWriting = (id: number | null) =>
  useQuery({ queryKey: ['writing', id], queryFn: () => api<WritingItem>(`/writing/${id}`), enabled: id != null })
export const writingPrompt = (task: string) => post<{ prompt: string; tip_ko: string }>('/writing/prompt', { task })
export const submitWriting = (form: FormData) => postForm<WritingItem>('/writing', form)

// ---------- ink ----------

export const getInk = (scope: string, refId: number) => api<InkDoc>(`/ink/${scope}/${refId}`)
export const putInk = (scope: string, refId: number, doc: Pick<InkDoc, 'strokes' | 'highlights' | 'height'> & { title?: string }) =>
  put<InkDoc>(`/ink/${scope}/${refId}`, doc)
export const useNotes = () => useQuery({ queryKey: ['notes'], queryFn: () => api<InkDoc[]>('/notes') })
export const getNote = (id: number) => api<InkDoc>(`/notes/${id}`)
export const newNote = (title?: string) => post<InkDoc>('/notes', { title })
export const putNote = (id: number, doc: Pick<InkDoc, 'strokes' | 'highlights' | 'height'> & { title?: string | null }) => put<InkDoc>(`/notes/${id}`, doc)
export const deleteNote = (id: number) => del<{ ok: boolean }>(`/notes/${id}`)

export const quickGloss = (readingId: number) => post<{ meanings: Record<string, string> }>(`/readings/${readingId}/quickgloss`)

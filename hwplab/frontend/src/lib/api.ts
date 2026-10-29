import type { JSONContent } from '@tiptap/core'
import type { PageSetup } from '@/editor/units'

export interface DocMeta {
  id: string
  title: string
  sourceName: string | null
  format: 'hwp' | 'hwpx' | 'new'
  created: string
  updated: string
  savedVersion: number
}

export interface PageNumber {
  pos: string
  side: string
}

export interface HwpDoc {
  page: PageSetup
  header: JSONContent[] | null
  footer: JSONContent[] | null
  pageNumber: PageNumber | null
  hideFirst?: { header?: boolean; footer?: boolean; pageNum?: boolean } | null
  content: JSONContent
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.detail) msg = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {
      /* not JSON */
    }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

const json = (body: unknown): RequestInit => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  list: () => req<DocMeta[]>('/api/docs'),
  get: (id: string) => req<{ meta: DocMeta; doc: HwpDoc }>(`/api/docs/${id}`),
  create: (title = '') => req<DocMeta>('/api/docs/new', { method: 'POST', ...json({ title }) }),
  upload: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return req<DocMeta>('/api/docs', { method: 'POST', body: fd })
  },
  save: (id: string, doc: HwpDoc, title: string, baseVersion: number) =>
    req<DocMeta>(`/api/docs/${id}`, { method: 'PUT', ...json({ doc, title, baseVersion }) }),
  rename: (id: string, title: string) => req<DocMeta>(`/api/docs/${id}`, { method: 'PATCH', ...json({ title }) }),
  remove: (id: string) => req<{ ok: boolean }>(`/api/docs/${id}`, { method: 'DELETE' }),
  addImage: (id: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return req<{ src: string; pixelWidth: number; pixelHeight: number }>(`/api/docs/${id}/bin`, {
      method: 'POST',
      body: fd,
    })
  },
  latex: (script: string) =>
    req<{ latex: string | null }>('/api/equation/latex', { method: 'POST', ...json({ script }) }),
  exportUrl: (id: string) => `/api/docs/${id}/export.hwpx`,
  sourceUrl: (id: string) => `/api/docs/${id}/source`,
  binUrl: (id: string, name: string) => `/api/docs/${id}/bin/${encodeURIComponent(name)}`,
}

export const isHwpFile = (f: File) => /\.(hwp|hwpx)$/i.test(f.name)

import clsx from 'clsx'
import { Download, FilePlus2, FileText, FolderOpen, Loader2, Pencil, Trash2, Upload } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Btn, Toast } from '@/components/ui'
import { api, isHwpFile, type DocMeta } from '@/lib/api'

const FORMAT_LABEL: Record<string, string> = { hwp: 'HWP', hwpx: 'HWPX', new: '새 문서' }

function when(iso: string) {
  const d = new Date(iso)
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return '방금'
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function LibraryPage() {
  const navigate = useNavigate()
  const [docs, setDocs] = useState<DocMeta[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const [toast, setToast] = useState<{ message: string; kind?: 'info' | 'error' } | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const notify = (message: string, kind?: 'info' | 'error') => {
    setToast({ message, kind })
    window.setTimeout(() => setToast(null), 3200)
  }
  const load = useCallback(() => api.list().then(setDocs, (e: Error) => notify(e.message, 'error')), [])
  useEffect(() => {
    load()
  }, [load])

  const openFiles = async (files: File[]) => {
    const hwp = files.filter(isHwpFile)
    if (!hwp.length) return notify('.hwp 또는 .hwpx 파일만 열 수 있어요.', 'error')
    let last: DocMeta | null = null
    for (const f of hwp) {
      setBusy(`${f.name} 여는 중…`)
      try {
        last = await api.upload(f)
      } catch (e) {
        notify(`${f.name}: ${(e as Error).message}`, 'error')
      }
    }
    setBusy(null)
    if (hwp.length === 1 && last) navigate(`/doc/${last.id}`)
    else load()
  }

  return (
    <div
      className="h-full overflow-auto bg-app"
      onDragOver={(e) => {
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDrag(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        openFiles([...e.dataTransfer.files])
      }}
    >
      <div className="mx-auto max-w-5xl px-6 py-8">
        <header className="mb-6 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="h-8 w-8" />
            <div>
              <h1 className="text-[20px] font-bold text-ink">HwpLab</h1>
              <p className="text-[12px] text-muted">한글(HWP·HWPX) 문서를 열고, 고치고, HWPX로 저장해요</p>
            </div>
          </div>
          <div className="ml-auto flex gap-2">
            <Btn
              onClick={async () => {
                const m = await api.create()
                navigate(`/doc/${m.id}`)
              }}
            >
              <FilePlus2 size={15} /> 새 문서
            </Btn>
            <Btn primary onClick={() => input.current?.click()}>
              <FolderOpen size={15} /> 파일 열기
            </Btn>
          </div>
        </header>

        <button
          type="button"
          onClick={() => input.current?.click()}
          className={clsx(
            'mb-6 flex w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed py-8 text-[13px] transition-colors',
            drag ? 'border-accent bg-accent/5 text-accent-strong' : 'border-line text-muted hover:border-accent/60',
          )}
        >
          {busy ? (
            <>
              <Loader2 className="animate-spin" size={22} />
              {busy}
            </>
          ) : (
            <>
              <Upload size={22} />
              HWP·HWPX 파일을 여기로 끌어다 놓거나 눌러서 고르세요
              <span className="text-[11px]">원본 파일은 바뀌지 않아요. 고친 내용은 HWPX로 내려받아요.</span>
            </>
          )}
        </button>

        <h2 className="mb-2 text-[13px] font-semibold text-muted">문서함 {docs ? `(${docs.length})` : ''}</h2>
        {docs === null ? (
          <div className="flex items-center gap-2 text-muted">
            <Loader2 className="animate-spin" size={16} /> 불러오는 중…
          </div>
        ) : docs.length === 0 ? (
          <p className="rounded-lg border border-line bg-panel p-6 text-center text-[13px] text-muted">아직 문서가 없어요.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
            {docs.map((d) => (
              <li key={d.id} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-hover/60">
                <FileText size={18} className="shrink-0 text-accent" />
                <button className="min-w-0 flex-1 text-left" onClick={() => navigate(`/doc/${d.id}`)}>
                  <div className="truncate text-[14px] font-medium text-ink">{d.title}</div>
                  <div className="truncate text-[12px] text-muted">
                    {FORMAT_LABEL[d.format] ?? d.format}
                    {d.sourceName ? ` · ${d.sourceName}` : ''} · {when(d.updated)}
                  </div>
                </button>
                <div className="flex shrink-0 items-center gap-0.5 opacity-60 group-hover:opacity-100">
                  <a className="rounded p-1.5 hover:bg-active" href={api.exportUrl(d.id)} title="HWPX로 내려받기" aria-label="HWPX로 내려받기">
                    <Download size={15} />
                  </a>
                  <button
                    className="rounded p-1.5 hover:bg-active"
                    title="이름 바꾸기"
                    aria-label="이름 바꾸기"
                    onClick={async () => {
                      const t = prompt('새 이름', d.title)
                      if (t && t.trim() && t !== d.title) {
                        await api.rename(d.id, t.trim())
                        load()
                      }
                    }}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className="rounded p-1.5 text-bad hover:bg-active"
                    title="지우기"
                    aria-label="지우기"
                    onClick={async () => {
                      if (!confirm(`'${d.title}'을(를) 문서함에서 지울까요?\n(원본 파일은 그대로예요. data/trash 폴더에 보관돼요.)`)) return
                      await api.remove(d.id)
                      load()
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept=".hwp,.hwpx"
        multiple
        hidden
        onChange={(e) => {
          openFiles([...(e.target.files || [])])
          e.target.value = ''
        }}
      />
      {toast && <Toast message={toast.message} kind={toast.kind} />}
    </div>
  )
}

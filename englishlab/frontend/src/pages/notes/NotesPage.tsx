import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, BookMarked, BookOpen, Highlighter, Maximize2, Minimize2, NotebookPen, Plus, Trash2 } from 'lucide-react'
import { deleteNote, getNote, newNote, putNote, useNotes } from '@/api/plan'
import type { InkDoc } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageSkeleton } from '@/components/layout/PageSkeleton'
import { InkPad, InkPreview } from '@/components/ink/InkPad'
import { useFocusMode } from '@/stores/focus'

function link(n: InkDoc): string {
  if (n.scope === 'reading' || n.scope === 'readnote') return `/read/${n.ref_id}`
  if (n.scope === 'book') return `/plan/books/${n.ref_id}`
  return `/notes/${n.id}`
}

const SCOPE_LABEL: Record<string, [string, typeof NotebookPen]> = {
  note: ['노트', NotebookPen],
  book: ['교재 노트', BookMarked],
  readnote: ['읽기 메모', BookOpen],
  reading: ['읽기 필기', Highlighter],
}

export function NotesPage() {
  const { data } = useNotes()
  const nav = useNavigate()
  const qc = useQueryClient()
  if (!data) return <PageSkeleton />
  const create = async () => {
    const n = await newNote()
    qc.invalidateQueries({ queryKey: ['notes'] })
    nav(`/notes/${n.id}`)
  }
  return (
    <div className="space-y-5">
      <PageHeader
        title="노트"
        subtitle="손글씨 노트, 교재 노트, 읽기 자료에 한 필기와 형광펜을 한곳에서 봐요."
        actions={
          <Button variant="primary" size="sm" onClick={create}>
            <Plus /> 새 노트
          </Button>
        }
      />
      {data.length === 0 ? (
        <Card>
          <EmptyState icon={NotebookPen} title="아직 노트가 없어요" action={<Button variant="primary" onClick={create}><Plus /> 새 노트</Button>}>
            태블릿에서 S Pen으로 표현 정리, 문법 메모, 쉐도잉 메모를 써 보세요. 읽기 화면의 펜 도구로 한 필기도 여기에 모여요.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {data.map((n) => {
            const [label, Icon] = SCOPE_LABEL[n.scope] ?? ['노트', NotebookPen]
            return (
              <Link key={n.id} to={link(n)} className="lift overflow-hidden rounded-card border bg-surface shadow-card">
                <div className="aspect-[4/5] overflow-hidden border-b bg-surface">
                  {n.strokes && n.strokes.length ? (
                    <InkPreview strokes={n.strokes} className="size-full" />
                  ) : (
                    <div className="grid size-full place-items-center text-subtle">
                      <Icon className="size-8" strokeWidth={1.5} />
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <div className="truncate text-sm font-semibold">{n.title}</div>
                  <div className="num mt-0.5 flex items-center gap-1 text-[11px] text-subtle">
                    <Icon className="size-3" /> {label} · {n.updated_at?.slice(5, 10).replace('-', '/')}
                    {n.scope === 'reading' && ` · 필기 ${n.stroke_count} · 형광펜 ${n.highlight_count}`}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function NoteEditorPage() {
  const id = Number(useParams().id)
  const [doc, setDoc] = useState<InkDoc | null>(null)
  const [title, setTitle] = useState('')
  const { focus, setFocus } = useFocusMode()
  const nav = useNavigate()
  const qc = useQueryClient()
  const titleTimer = useRef<number | undefined>(undefined)
  useEffect(() => {
    getNote(id).then((d) => {
      setDoc(d)
      setTitle(d.title === '메모' ? '' : d.title ?? '')
    })
  }, [id])
  useEffect(() => () => useFocusMode.getState().setFocus(false), [])
  if (!doc) return <PageSkeleton />
  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => nav('/notes')} aria-label="노트 목록">
          <ArrowLeft />
        </Button>
        <input
          value={title}
          onChange={(e) => {
            const v = e.target.value
            setTitle(v)
            window.clearTimeout(titleTimer.current)
            titleTimer.current = window.setTimeout(() => {
              void putNote(id, { strokes: doc.strokes, highlights: [], height: doc.height, title: v })
              qc.invalidateQueries({ queryKey: ['notes'] })
            }, 800)
          }}
          placeholder="제목 없는 노트"
          className="min-w-0 flex-1 bg-transparent text-xl font-bold tracking-tight outline-none placeholder:text-subtle"
        />
        <Button variant="ghost" size="icon" onClick={() => setFocus(!focus)} aria-label="집중 모드" title={focus ? '집중 모드 끄기' : '집중 모드 (전체 화면)'}>
          {focus ? <Minimize2 /> : <Maximize2 />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="노트 삭제"
          onClick={async () => {
            if (!confirm('이 노트를 삭제할까요?')) return
            await deleteNote(id)
            qc.invalidateQueries({ queryKey: ['notes'] })
            nav('/notes')
          }}
        >
          <Trash2 />
        </Button>
      </div>
      <div className="overflow-hidden rounded-card border shadow-card">
        <InkPad
          initial={doc.strokes}
          initialHeight={doc.height || 1400}
          onSave={(d) => {
            setDoc((x) => (x ? { ...x, strokes: d.strokes, height: d.height } : x))
            void putNote(id, { ...d, highlights: [], title: title || null }).then(() => qc.invalidateQueries({ queryKey: ['notes'] }))
          }}
        />
      </div>
    </div>
  )
}

import type { Editor, JSONContent } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { ArrowLeft, Download, FileDown, Loader2, Printer, Save, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { CharDialog, EquationDialog, FootnoteDialog, PageDialog, ParagraphDialog } from '@/components/dialogs'
import { FindBar } from '@/components/FindBar'
import { Toolbar } from '@/components/Toolbar'
import { Btn, Toast } from '@/components/ui'
import { setCurrentDocId } from '@/editor/extensions'
import { COMMON_FONTS, DEFAULT_SIZE } from '@/editor/fonts'
import { pageOfPos, repaginate, type PageChrome } from '@/editor/pagination'
import { currentChar, editorExtensions, staticHtml, type EditorHooks } from '@/editor/setup'
import { ptToPx, type PageSetup } from '@/editor/units'
import { api, isHwpFile, type DocMeta, type HwpDoc } from '@/lib/api'

type Loaded = { meta: DocMeta; doc: HwpDoc }

export function EditorPage() {
  const { id = '' } = useParams()
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    setData(null)
    setError('')
    setCurrentDocId(id)
    api.get(id).then(setData, (e: Error) => setError(e.message))
  }, [id])
  if (error)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-ink">
        <p>{error}</p>
        <Link className="text-accent hover:underline" to="/">
          문서함으로
        </Link>
      </div>
    )
  if (!data)
    return (
      <div className="flex h-full items-center justify-center gap-2 text-muted">
        <Loader2 className="animate-spin" size={18} /> 문서를 여는 중…
      </div>
    )
  return <DocEditor key={id} initial={data} />
}

type DialogState =
  | { kind: 'para' }
  | { kind: 'char' }
  | { kind: 'page' }
  | { kind: 'equation'; pos: number | null; script: string; size: number }
  | { kind: 'footnote'; pos: number | null; content: JSONContent[] | null }
  | null

type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

function collectFonts(node: JSONContent | undefined, out: Set<string>) {
  if (!node) return out
  for (const m of node.marks || []) {
    if (m.type === 'textStyle') {
      if (m.attrs?.fontHangul) out.add(m.attrs.fontHangul)
      if (m.attrs?.fontLatin) out.add(m.attrs.fontLatin)
    }
  }
  for (const c of node.content || []) collectFonts(c, out)
  return out
}

function DocEditor({ initial }: { initial: Loaded }) {
  const navigate = useNavigate()
  const docId = initial.meta.id
  const [meta, setMeta] = useState(initial.meta)
  const [title, setTitle] = useState(initial.meta.title)
  const [page, setPage] = useState<PageSetup>(initial.doc.page)
  const [zoom, setZoom] = useState(() => Number(localStorage.getItem('hwplab-zoom')) || 1)
  const [pages, setPages] = useState(1)
  const [curPage, setCurPage] = useState(1)
  const [chars, setChars] = useState(0)
  const [save, setSave] = useState<SaveState>('saved')
  const [dialog, setDialog] = useState<DialogState>(null)
  const [find, setFind] = useState<{ replace: boolean } | null>(null)
  const [toast, setToast] = useState<{ message: string; kind?: 'info' | 'error' } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const versionRef = useRef(initial.meta.savedVersion)
  const saveTimer = useRef(0)
  const editorRef = useRef<Editor | null>(null)

  const fonts = useMemo(() => [...collectFonts(initial.doc.content, new Set<string>()), ...COMMON_FONTS].filter((v, i, a) => a.indexOf(v) === i), [initial])

  const notify = useCallback((message: string, kind?: 'info' | 'error') => {
    setToast({ message, kind })
    window.setTimeout(() => setToast(null), 2600)
  }, [])

  // page chrome shared with the pagination plugin (a new object => repaginate)
  const chromeRef = useRef<PageChrome>({
    page: initial.doc.page,
    headerHtml: staticHtml(initial.doc.header),
    footerHtml: staticHtml(initial.doc.footer),
    pageNumber: initial.doc.pageNumber,
    hideFirst: initial.doc.hideFirst,
  })

  const hooksRef = useRef<EditorHooks>(null as unknown as EditorHooks)
  const extensions = useMemo(
    () =>
      editorExtensions(
        { getChrome: () => chromeRef.current, onPages: (n) => setPages(n) },
        () => hooksRef.current,
      ),
    [],
  )

  const editor = useEditor({
    extensions,
    content: initial.doc.content,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: 'hwp-page', spellcheck: 'false' },
      handleDoubleClickOn(_view, _pos, node, nodePos) {
        if (node.type.name === 'equation') {
          setDialog({ kind: 'equation', pos: nodePos, script: node.attrs.script, size: node.attrs.size })
          return true
        }
        if (node.type.name === 'footnote') {
          setDialog({ kind: 'footnote', pos: nodePos, content: node.attrs.content })
          return true
        }
        return false
      },
      handleDrop(view, event) {
        const files = [...(event.dataTransfer?.files || [])]
        if (!files.length) return false
        event.preventDefault()
        const hwp = files.find(isHwpFile)
        if (hwp) {
          openOther(hwp)
          return true
        }
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        insertImages(files.filter((f) => f.type.startsWith('image/')), pos)
        return true
      },
      handlePaste(_view, event) {
        const files = [...(event.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'))
        if (!files.length) return false
        insertImages(files)
        return true
      },
    },
    onUpdate: ({ editor: e, transaction }) => {
      if (!transaction.docChanged) return
      markDirty()
      setChars(e.state.doc.textContent.length)
    },
    onSelectionUpdate: ({ editor: e }) => setCurPage(pageOfPos(e.state, e.state.selection.from)),
  })
  editorRef.current = editor
  ;(window as unknown as { hwpEditor?: Editor | null }).hwpEditor = editor // for debugging from the console

  useEffect(() => {
    if (editor) setChars(editor.state.doc.textContent.length)
  }, [editor])

  // ---------- saving ----------

  const pageRef = useRef(page)
  pageRef.current = page
  const titleRef = useRef(title)
  titleRef.current = title

  const doSave = useCallback(async () => {
    const e = editorRef.current
    if (!e) return false
    window.clearTimeout(saveTimer.current)
    setSave('saving')
    const doc: HwpDoc = {
      page: pageRef.current,
      header: initial.doc.header,
      footer: initial.doc.footer,
      pageNumber: initial.doc.pageNumber,
      hideFirst: initial.doc.hideFirst,
      content: e.getJSON(),
    }
    try {
      const m = await api.save(docId, doc, titleRef.current.trim() || '제목 없음', versionRef.current)
      versionRef.current = m.savedVersion
      setMeta(m)
      setSave('saved')
      return true
    } catch (err) {
      setSave('error')
      notify(`저장하지 못했어요: ${(err as Error).message}`, 'error')
      return false
    }
  }, [docId, initial, notify])

  const markDirty = useCallback(() => {
    setSave('dirty')
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => void doSave(), 2500)
  }, [doSave])

  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      if (save === 'dirty' || save === 'saving') e.preventDefault()
    }
    window.addEventListener('beforeunload', onBefore)
    return () => window.removeEventListener('beforeunload', onBefore)
  }, [save])

  const downloadHwpx = async () => {
    if (save !== 'saved' && !(await doSave())) return
    const a = document.createElement('a')
    a.href = api.exportUrl(docId)
    a.download = `${titleRef.current || '문서'}.hwpx`
    a.click()
  }

  const print = () => {
    let style = document.getElementById('hwp-page-style') as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = 'hwp-page-style'
      document.head.appendChild(style)
    }
    style.textContent = `@page { size: ${page.width}pt ${page.height}pt; margin: 0 }`
    window.print()
  }

  // ---------- inserting ----------

  const insertImages = async (files: File[], pos?: number) => {
    const e = editorRef.current
    if (!e || !files.length) return
    const maxW = pageRef.current.width - pageRef.current.left - pageRef.current.right
    for (const f of files) {
      try {
        const r = await api.addImage(docId, f)
        let w = (r.pixelWidth || 200) * 0.75
        let h = (r.pixelHeight || 200) * 0.75
        if (w > maxW) {
          h = (h * maxW) / w
          w = maxW
        }
        const node = { type: 'image', attrs: { src: r.src, width: Math.round(w * 10) / 10, height: Math.round(h * 10) / 10, alt: f.name } }
        if (pos !== undefined) e.chain().focus().insertContentAt(pos, node).run()
        else e.chain().focus().insertContent(node).run()
      } catch (err) {
        notify(`그림을 넣지 못했어요: ${(err as Error).message}`, 'error')
      }
    }
  }

  const openOther = async (file: File) => {
    try {
      if (save !== 'saved') await doSave()
      const m = await api.upload(file)
      navigate(`/doc/${m.id}`)
    } catch (err) {
      notify((err as Error).message, 'error')
    }
  }

  hooksRef.current = {
    onSave: () => void doSave().then((ok) => ok && notify('저장했어요.')),
    onFind: (replace) => setFind({ replace }),
    onParagraphDialog: () => setDialog({ kind: 'para' }),
    onCharDialog: () => setDialog({ kind: 'char' }),
    onPageDialog: () => setDialog({ kind: 'page' }),
    onPrint: print,
  }

  // Ctrl+S etc. while focus is outside the editor (toolbar, title)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 's') {
        e.preventDefault()
        hooksRef.current.onSave()
      } else if (k === 'p') {
        e.preventDefault()
        print()
      } else if (k === 'f' && !editor?.isFocused) {
        e.preventDefault()
        setFind({ replace: false })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const applyPage = (p: PageSetup) => {
    setPage(p)
    chromeRef.current = { ...chromeRef.current, page: p }
    markDirty()
    if (editor) requestAnimationFrame(() => repaginate(editor.view))
  }

  useEffect(() => {
    localStorage.setItem('hwplab-zoom', String(zoom))
  }, [zoom])

  if (!editor) return null

  const pageStyle = {
    width: `${ptToPx(page.width)}px`,
    '--pg-left': `${ptToPx(page.left)}px`,
    '--pg-right': `${ptToPx(page.right)}px`,
  } as React.CSSProperties

  return (
    <div className="flex h-full flex-col bg-app">
      {/* title bar */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-panel px-2 print:hidden">
        <Link to="/" className="flex h-8 items-center gap-1 rounded-md px-2 text-[13px] text-ink hover:bg-hover" title="문서함">
          <ArrowLeft size={16} />
          <span className="font-semibold text-accent-strong">HwpLab</span>
        </Link>
        <input
          aria-label="문서 제목"
          className="h-8 min-w-0 max-w-[28rem] flex-1 rounded-md border border-transparent bg-transparent px-2 text-[14px] font-medium text-ink outline-none hover:border-line focus:border-accent focus:bg-field"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            markDirty()
          }}
        />
        <span className="text-[12px] text-muted">
          {meta.sourceName ? `원본: ${meta.sourceName}` : '새 문서'}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <SaveBadge state={save} />
          <Btn onClick={() => hooksRef.current.onSave()}>
            <Save size={14} /> 저장
          </Btn>
          <Btn primary onClick={downloadHwpx}>
            <Download size={14} /> HWPX로 내려받기
          </Btn>
          {meta.sourceName && (
            <a className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[13px] text-muted hover:bg-hover" href={api.sourceUrl(docId)} title="가져온 원본 파일 그대로 받기">
              <FileDown size={14} /> 원본
            </a>
          )}
          <Btn onClick={print}>
            <Printer size={14} /> 인쇄·PDF
          </Btn>
        </div>
      </header>

      <div className="print:hidden">
        <Toolbar
          editor={editor}
          fonts={fonts}
          page={page}
          actions={{
            onInsertImage: () => fileInput.current?.click(),
            onInsertEquation: () => setDialog({ kind: 'equation', pos: null, script: '', size: currentChar(editor).size || DEFAULT_SIZE }),
            onInsertFootnote: () => setDialog({ kind: 'footnote', pos: null, content: null }),
            onParagraphDialog: () => setDialog({ kind: 'para' }),
            onCharDialog: () => setDialog({ kind: 'char' }),
            onPageDialog: () => setDialog({ kind: 'page' }),
            onFind: () => setFind({ replace: false }),
          }}
        />
      </div>

      <main className="relative min-h-0 flex-1">
        {find && <FindBar editor={editor} replace={find.replace} onClose={() => (setFind(null), editor.commands.focus())} notify={notify} />}
        <div className="hwp-scroll h-full overflow-auto">
          <div className="hwp-zoom mx-auto w-max py-6 print:p-0" style={{ zoom }}>
            <div className="hwp-sheet" style={pageStyle}>
              <EditorContent editor={editor} />
            </div>
          </div>
        </div>
      </main>

      {/* status bar */}
      <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-line bg-panel px-3 text-[12px] text-muted print:hidden">
        <span className="tabular-nums">
          {curPage} / {pages} 쪽
        </span>
        <span className="tabular-nums">{chars.toLocaleString()}자</span>
        <span>
          {Math.round(page.width * 0.3528)}×{Math.round(page.height * 0.3528)}mm {page.landscape ? '가로' : '세로'}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button className="rounded p-0.5 hover:bg-hover" aria-label="축소" onClick={() => setZoom((z) => Math.max(0.3, Math.round((z - 0.1) * 10) / 10))}>
            <ZoomOut size={14} />
          </button>
          <input type="range" min={30} max={250} step={10} value={Math.round(zoom * 100)} onChange={(e) => setZoom(Number(e.target.value) / 100)} aria-label="확대 비율" className="w-28 accent-[var(--accent)]" />
          <button className="rounded p-0.5 hover:bg-hover" aria-label="확대" onClick={() => setZoom((z) => Math.min(2.5, Math.round((z + 0.1) * 10) / 10))}>
            <ZoomIn size={14} />
          </button>
          <button className="w-11 rounded px-1 tabular-nums hover:bg-hover" title="100%로" onClick={() => setZoom(1)}>
            {Math.round(zoom * 100)}%
          </button>
        </div>
      </footer>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          insertImages([...(e.target.files || [])])
          e.target.value = ''
        }}
      />

      {dialog?.kind === 'para' && <ParagraphDialog editor={editor} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'char' && <CharDialog editor={editor} fonts={fonts} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'page' && <PageDialog page={page} onApply={applyPage} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'equation' && (
        <EquationDialog
          initial={dialog}
          onClose={() => setDialog(null)}
          onApply={({ script, latex, size }) => {
            const attrs = { script, latex, size, width: 0, height: 0, color: '#000000' }
            if (dialog.pos === null) editor.chain().focus().insertContent({ type: 'equation', attrs }).run()
            else {
              const node = editor.state.doc.nodeAt(dialog.pos)
              editor.view.dispatch(editor.state.tr.setNodeMarkup(dialog.pos, undefined, { ...node?.attrs, ...attrs, width: 0, height: 0 }))
            }
          }}
        />
      )}
      {dialog?.kind === 'footnote' && (
        <FootnoteDialog
          initial={dialog.content}
          onClose={() => setDialog(null)}
          onApply={(content) => {
            if (dialog.pos === null) editor.chain().focus().insertContent({ type: 'footnote', attrs: { kind: 'foot', content } }).run()
            else {
              const node = editor.state.doc.nodeAt(dialog.pos)
              editor.view.dispatch(editor.state.tr.setNodeMarkup(dialog.pos, undefined, { ...node?.attrs, content }))
            }
          }}
        />
      )}
      {toast && <Toast message={toast.message} kind={toast.kind} />}
    </div>
  )
}

function SaveBadge({ state }: { state: SaveState }) {
  const label = { saved: '저장됨', dirty: '수정됨', saving: '저장 중…', error: '저장 실패' }[state]
  const color = { saved: 'text-good', dirty: 'text-muted', saving: 'text-muted', error: 'text-bad' }[state]
  return <span className={`mr-1 text-[12px] ${color}`}>{label}</span>
}

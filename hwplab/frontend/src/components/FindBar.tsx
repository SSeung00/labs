import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { gotoMatch, replaceAll, replaceCurrent, searchKey, setSearch } from '@/editor/search'
import { Btn } from './ui'

export function FindBar({ editor, replace, onClose, notify }: { editor: Editor; replace: boolean; onClose: () => void; notify: (m: string) => void }) {
  const [query, setQuery] = useState(() => {
    const { from, to } = editor.state.selection
    return to > from && to - from < 80 ? editor.state.doc.textBetween(from, to) : ''
  })
  const [repl, setRepl] = useState('')
  const [caseSensitive, setCase] = useState(false)
  const [showReplace, setShowReplace] = useState(replace)
  const inputRef = useRef<HTMLInputElement>(null)
  const info = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const s = searchKey.getState(e.state)
      return { count: s?.matches.length ?? 0, index: s?.index ?? -1 }
    },
  })
  const run = (fn: (state: typeof editor.state, dispatch: typeof editor.view.dispatch) => unknown) => fn(editor.state, editor.view.dispatch)

  useEffect(() => {
    run((st, d) => setSearch(st, d, query, caseSensitive))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, caseSensitive])
  useEffect(() => {
    setShowReplace(replace)
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [replace])
  useEffect(
    () => () => {
      editor.view.dispatch(editor.state.tr.setMeta(searchKey, { query: '' }))
    },
    [editor],
  )

  return (
    <div className="absolute right-4 top-2 z-40 w-[22rem] rounded-xl border border-line bg-panel p-2.5 shadow-pop">
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          autoFocus
          className="h-8 flex-1 rounded-md border border-line bg-field px-2 text-[13px] outline-none focus:border-accent"
          placeholder="찾을 내용"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') run((st, d) => gotoMatch(st, d, e.shiftKey ? -1 : info.index < 0 ? 0 : 1))
            if (e.key === 'Escape') onClose()
          }}
        />
        <span className="w-14 text-center text-[12px] tabular-nums text-muted">{query ? `${info.count ? info.index + 1 : 0}/${info.count}` : ''}</span>
        <button className="rounded p-1 hover:bg-hover" aria-label="이전" onClick={() => run((st, d) => gotoMatch(st, d, -1))}>
          <ChevronUp size={16} />
        </button>
        <button className="rounded p-1 hover:bg-hover" aria-label="다음" onClick={() => run((st, d) => gotoMatch(st, d, 1))}>
          <ChevronDown size={16} />
        </button>
        <button className="rounded p-1 hover:bg-hover" aria-label="닫기" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[12px] text-muted">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={caseSensitive} onChange={(e) => setCase(e.target.checked)} />
          대소문자 구분
        </label>
        <button className="text-accent hover:underline" onClick={() => setShowReplace((v) => !v)}>
          {showReplace ? '바꾸기 닫기' : '바꾸기…'}
        </button>
      </div>
      {showReplace && (
        <div className="mt-2 flex items-center gap-1.5">
          <input
            className="h-8 flex-1 rounded-md border border-line bg-field px-2 text-[13px] outline-none focus:border-accent"
            placeholder="바꿀 내용"
            value={repl}
            onChange={(e) => setRepl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && run((st, d) => replaceCurrent(st, d, repl))}
          />
          <Btn onClick={() => run((st, d) => replaceCurrent(st, d, repl))} disabled={!info.count}>
            바꾸기
          </Btn>
          <Btn
            onClick={() => {
              const n = run((st, d) => replaceAll(st, d, repl)) as number
              notify(`${n}개를 바꿨어요.`)
            }}
            disabled={!info.count}
          >
            모두
          </Btn>
        </div>
      )}
    </div>
  )
}

import type { Editor, JSONContent } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  Baseline,
  Bold,
  Columns3,
  FileText,
  Grid2x2Plus,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  ListIndentDecrease,
  ListIndentIncrease,
  Merge,
  Minus,
  PanelBottomClose,
  Plus,
  Redo2,
  Rows3,
  ScanSearch,
  Sigma,
  SeparatorHorizontal,
  Split,
  Square,
  SquareDashed,
  Strikethrough,
  Subscript as SubIcon,
  Superscript as SupIcon,
  Table2,
  Trash2,
  Type,
  Underline,
  Undo2,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyEnd,
  Asterisk,
  Pilcrow,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { PARA_DEFAULTS, type Borders } from '@/editor/extensions'
import { COMMON_FONTS } from '@/editor/fonts'
import { currentChar, currentPara, insertPageBreak, setChar, setFont, setPara, shiftMargin, stepFontSize, toggleIndent } from '@/editor/setup'
import { ptToPx, type PageSetup } from '@/editor/units'
import { ColorButton, TableGridPicker } from './pickers'
import { Sep, ToolButton } from './ui'

const SIZES = [8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 48, 72]
const LINE_SPACINGS = [100, 110, 120, 130, 140, 150, 160, 170, 180, 200, 250, 300]

export interface ToolbarActions {
  onInsertImage: () => void
  onInsertEquation: () => void
  onInsertFootnote: () => void
  onParagraphDialog: () => void
  onCharDialog: () => void
  onPageDialog: () => void
  onFind: () => void
}

export function Toolbar({
  editor,
  fonts,
  page,
  actions,
}: {
  editor: Editor
  fonts: string[]
  page: PageSetup
  actions: ToolbarActions
}) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const c = currentChar(e)
      const p = currentPara(e)
      return {
        font: c.fontHangul,
        size: c.size,
        color: c.color,
        shade: c.shade,
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        underline: e.isActive('underline'),
        strike: e.isActive('strike'),
        sup: e.isActive('superscript'),
        sub: e.isActive('subscript'),
        align: p.align,
        lineType: p.lineType,
        line: p.line,
        indent: p.indent,
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
        inTable: e.isActive('table'),
        image: e.isActive('image') ? (e.getAttributes('image') as { width: number; height: number; src: string }) : null,
        canMerge: e.can().mergeCells(),
        canSplit: e.can().splitCell(),
      }
    },
  })

  const contentWidth = page.width - page.left - page.right
  const insertTable = (rows: number, cols: number) => {
    const w = Math.floor(ptToPx(contentWidth) / cols) - 1
    const para: JSONContent = { type: 'paragraph', attrs: { ...PARA_DEFAULTS, line: 160, size: s.size } }
    const table: JSONContent = {
      type: 'table',
      content: Array.from({ length: rows }, () => ({
        type: 'tableRow',
        attrs: { height: 0 },
        content: Array.from({ length: cols }, () => ({
          type: 'tableCell',
          attrs: { colspan: 1, rowspan: 1, colwidth: [w], padding: { left: 5.1, right: 5.1, top: 1.41, bottom: 1.41 } },
          content: [para],
        })),
      })),
    }
    editor.chain().focus().insertContent([table, { type: 'paragraph', attrs: { ...PARA_DEFAULTS, size: s.size } }]).run()
  }

  return (
    <div className="border-b border-line bg-panel">
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1">
        <ToolButton title="실행 취소 (Ctrl+Z)" disabled={!s.canUndo} onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 size={16} />
        </ToolButton>
        <ToolButton title="다시 실행 (Ctrl+Y)" disabled={!s.canRedo} onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 size={16} />
        </ToolButton>
        <Sep />
        <FontInput value={s.font} fonts={fonts} onCommit={(f) => setFont(editor, f)} />
        <SizeInput value={s.size} onCommit={(v) => setChar(editor, { size: v })} />
        <ToolButton title="글자 크게 (Ctrl+])" onClick={() => stepFontSize(editor, 1)}>
          <Plus size={14} />
        </ToolButton>
        <ToolButton title="글자 작게 (Ctrl+[)" onClick={() => stepFontSize(editor, -1)}>
          <Minus size={14} />
        </ToolButton>
        <Sep />
        <ToolButton title="진하게 (Ctrl+B)" active={s.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold size={16} />
        </ToolButton>
        <ToolButton title="기울임 (Ctrl+I)" active={s.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic size={16} />
        </ToolButton>
        <ToolButton title="밑줄 (Ctrl+U)" active={s.underline} onClick={() => editor.chain().focus().toggleMark('underline').run()}>
          <Underline size={16} />
        </ToolButton>
        <ToolButton title="취소선" active={s.strike} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <Strikethrough size={16} />
        </ToolButton>
        <ToolButton title="위 첨자" active={s.sup} onClick={() => editor.chain().focus().unsetSubscript().toggleSuperscript().run()}>
          <SupIcon size={16} />
        </ToolButton>
        <ToolButton title="아래 첨자" active={s.sub} onClick={() => editor.chain().focus().unsetSuperscript().toggleSubscript().run()}>
          <SubIcon size={16} />
        </ToolButton>
        <ColorButton title="글자 색" color={s.color} icon={<Baseline size={15} />} onPick={(c) => setChar(editor, { color: c || '#000000' })} />
        <ColorButton title="형광펜(음영 색)" color={s.shade || '#ffff00'} icon={<Highlighter size={15} />} allowNone onPick={(c) => setChar(editor, { shade: c })} />
        <ToolButton title="글자 모양 (Alt+L)" onClick={actions.onCharDialog}>
          <Type size={16} />
        </ToolButton>
        <Sep />
        <ToolButton title="양쪽 정렬 (Ctrl+Shift+M)" active={s.align === 'justify'} onClick={() => setPara(editor, { align: 'justify' })}>
          <AlignJustify size={16} />
        </ToolButton>
        <ToolButton title="왼쪽 정렬 (Ctrl+Shift+L)" active={s.align === 'left'} onClick={() => setPara(editor, { align: 'left' })}>
          <AlignLeft size={16} />
        </ToolButton>
        <ToolButton title="가운데 정렬 (Ctrl+Shift+C)" active={s.align === 'center'} onClick={() => setPara(editor, { align: 'center' })}>
          <AlignCenter size={16} />
        </ToolButton>
        <ToolButton title="오른쪽 정렬 (Ctrl+Shift+R)" active={s.align === 'right'} onClick={() => setPara(editor, { align: 'right' })}>
          <AlignRight size={16} />
        </ToolButton>
        <ToolButton title="배분 정렬 (Ctrl+Shift+T)" active={s.align === 'distribute' || s.align === 'distribute_space'} onClick={() => setPara(editor, { align: 'distribute' })}>
          <Columns3 size={16} />
        </ToolButton>
        <select
          title="줄 간격"
          aria-label="줄 간격"
          className="h-7 rounded-md border border-line bg-field px-1 text-[13px] tabular-nums outline-none"
          value={s.lineType === 'percent' ? String(s.line) : ''}
          onChange={(e) => setPara(editor, { lineType: 'percent', line: Number(e.target.value) })}
        >
          {s.lineType !== 'percent' && <option value="">{`고정 ${s.line}pt`}</option>}
          {!LINE_SPACINGS.includes(s.line) && s.lineType === 'percent' && <option value={String(s.line)}>{s.line}%</option>}
          {LINE_SPACINGS.map((v) => (
            <option key={v} value={v}>
              {v}%
            </option>
          ))}
        </select>
        <ToolButton title="첫 줄 들여쓰기" active={s.indent > 0} onClick={() => toggleIndent(editor, false)}>
          <IndentIncrease size={16} />
        </ToolButton>
        <ToolButton title="첫 줄 내어쓰기" active={s.indent < 0} onClick={() => toggleIndent(editor, true)}>
          <IndentDecrease size={16} />
        </ToolButton>
        <ToolButton title="왼쪽 여백 줄이기" onClick={() => shiftMargin(editor, -10)}>
          <ListIndentDecrease size={16} />
        </ToolButton>
        <ToolButton title="왼쪽 여백 늘리기" onClick={() => shiftMargin(editor, 10)}>
          <ListIndentIncrease size={16} />
        </ToolButton>
        <ToolButton title="문단 모양 (Alt+T)" onClick={actions.onParagraphDialog}>
          <Pilcrow size={16} />
        </ToolButton>
        <Sep />
        <TableGridPicker onPick={insertTable}>
          <Table2 size={16} />
          <span className="text-[12px]">표</span>
        </TableGridPicker>
        <ToolButton title="그림 넣기" onClick={actions.onInsertImage}>
          <ImagePlus size={16} />
          <span className="text-[12px]">그림</span>
        </ToolButton>
        <ToolButton title="수식 넣기" onClick={actions.onInsertEquation}>
          <Sigma size={16} />
          <span className="text-[12px]">수식</span>
        </ToolButton>
        <ToolButton title="각주 넣기" onClick={actions.onInsertFootnote}>
          <Asterisk size={16} />
          <span className="text-[12px]">각주</span>
        </ToolButton>
        <ToolButton title="쪽 나누기 (Ctrl+Enter)" onClick={() => insertPageBreak(editor)}>
          <SeparatorHorizontal size={16} />
        </ToolButton>
        <Sep />
        <ToolButton title="편집 용지 (F7)" onClick={actions.onPageDialog}>
          <FileText size={16} />
          <span className="text-[12px]">용지</span>
        </ToolButton>
        <ToolButton title="찾기·바꾸기 (Ctrl+F)" onClick={actions.onFind}>
          <ScanSearch size={16} />
        </ToolButton>
      </div>

      {s.inTable && !s.image && <TableBar editor={editor} canMerge={s.canMerge} canSplit={s.canSplit} />}
      {s.image && <ImageBar editor={editor} image={s.image} maxWidth={contentWidth} />}
    </div>
  )
}

function TableBar({ editor, canMerge, canSplit }: { editor: Editor; canMerge: boolean; canSplit: boolean }) {
  const c = () => editor.chain().focus()
  const setBorders = (kind: 'all' | 'none') => {
    const side = kind === 'all' ? { type: 'SOLID', width: 0.12, color: '#000000' } : { type: 'NONE', width: 0.12, color: '#000000' }
    const borders: Borders = { left: side, right: side, top: side, bottom: side }
    c().setCellAttribute('borders', borders).run()
  }
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-t border-line bg-ribbon px-2 py-1 text-[12px]">
      <span className="mr-1 rounded bg-accent/10 px-1.5 py-0.5 font-medium text-accent-strong">표</span>
      <ToolButton title="위에 줄 추가" onClick={() => c().addRowBefore().run()}>
        <ArrowUpToLine size={15} />
        줄
      </ToolButton>
      <ToolButton title="아래에 줄 추가" onClick={() => c().addRowAfter().run()}>
        <ArrowDownToLine size={15} />
        줄
      </ToolButton>
      <ToolButton title="왼쪽에 칸 추가" onClick={() => c().addColumnBefore().run()}>
        <Plus size={14} />
        왼칸
      </ToolButton>
      <ToolButton title="오른쪽에 칸 추가" onClick={() => c().addColumnAfter().run()}>
        <Plus size={14} />
        오른칸
      </ToolButton>
      <ToolButton title="줄 지우기" onClick={() => c().deleteRow().run()}>
        <Rows3 size={15} />
        줄 지우기
      </ToolButton>
      <ToolButton title="칸 지우기" onClick={() => c().deleteColumn().run()}>
        <Columns3 size={15} />
        칸 지우기
      </ToolButton>
      <Sep />
      <ToolButton title="셀 합치기 (여러 셀을 끌어서 고른 뒤)" disabled={!canMerge} onClick={() => c().mergeCells().run()}>
        <Merge size={15} />
        합치기
      </ToolButton>
      <ToolButton title="셀 나누기" disabled={!canSplit} onClick={() => c().splitCell().run()}>
        <Split size={15} />
        나누기
      </ToolButton>
      <Sep />
      <ColorButton title="셀 배경색" color="#dce6f1" icon={<Grid2x2Plus size={15} />} allowNone onPick={(col) => c().setCellAttribute('background', col).run()} />
      <ToolButton title="테두리 모두" onClick={() => setBorders('all')}>
        <Square size={15} />
      </ToolButton>
      <ToolButton title="테두리 없음" onClick={() => setBorders('none')}>
        <SquareDashed size={15} />
      </ToolButton>
      <ToolButton title="셀 위쪽 정렬" onClick={() => c().setCellAttribute('vAlign', 'top').run()}>
        <AlignVerticalJustifyStart size={15} />
      </ToolButton>
      <ToolButton title="셀 가운데 정렬" onClick={() => c().setCellAttribute('vAlign', 'middle').run()}>
        <AlignVerticalJustifyCenter size={15} />
      </ToolButton>
      <ToolButton title="셀 아래쪽 정렬" onClick={() => c().setCellAttribute('vAlign', 'bottom').run()}>
        <AlignVerticalJustifyEnd size={15} />
      </ToolButton>
      <Sep />
      <ToolButton title="표 지우기" onClick={() => c().deleteTable().run()} className="text-bad">
        <Trash2 size={15} />
        표 지우기
      </ToolButton>
    </div>
  )
}

function ImageBar({ editor, image, maxWidth }: { editor: Editor; image: { width: number; height: number }; maxWidth: number }) {
  const [w, setW] = useState(image.width)
  const [h, setH] = useState(image.height)
  const [lock, setLock] = useState(true)
  useEffect(() => {
    setW(image.width)
    setH(image.height)
  }, [image.width, image.height])
  const ratio = image.height / (image.width || 1)
  const apply = (nw: number, nh: number) => editor.chain().focus().updateAttributes('image', { width: Math.max(4, nw), height: Math.max(4, nh) }).run()
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line bg-ribbon px-2 py-1 text-[12px] text-ink">
      <span className="rounded bg-accent/10 px-1.5 py-0.5 font-medium text-accent-strong">그림</span>
      <label className="flex items-center gap-1">
        너비
        <input
          type="number"
          className="h-7 w-20 rounded-md border border-line bg-field px-1.5 text-right"
          value={Math.round(w * 10) / 10}
          onChange={(e) => {
            const v = Number(e.target.value)
            setW(v)
            if (lock) setH(v * ratio)
          }}
          onBlur={() => apply(w, lock ? w * ratio : h)}
          onKeyDown={(e) => e.key === 'Enter' && apply(w, lock ? w * ratio : h)}
        />
        pt
      </label>
      <label className="flex items-center gap-1">
        높이
        <input
          type="number"
          className="h-7 w-20 rounded-md border border-line bg-field px-1.5 text-right"
          value={Math.round(h * 10) / 10}
          onChange={(e) => {
            const v = Number(e.target.value)
            setH(v)
            if (lock) setW(v / ratio)
          }}
          onBlur={() => apply(lock ? h / ratio : w, h)}
          onKeyDown={(e) => e.key === 'Enter' && apply(lock ? h / ratio : w, h)}
        />
        pt
      </label>
      <label className="flex items-center gap-1">
        <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />
        비율 유지
      </label>
      <ToolButton title="본문 너비에 맞추기" onClick={() => apply(maxWidth, maxWidth * ratio)}>
        <PanelBottomClose size={15} />
        폭 맞춤
      </ToolButton>
      <ToolButton title="그림 지우기" className="text-bad" onClick={() => editor.chain().focus().deleteSelection().run()}>
        <Trash2 size={15} />
      </ToolButton>
    </div>
  )
}

function FontInput({ value, fonts, onCommit }: { value: string; fonts: string[]; onCommit: (f: string) => void }) {
  const [text, setText] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (document.activeElement !== ref.current) setText(value)
  }, [value])
  const list = [...new Set([...fonts, ...COMMON_FONTS])]
  return (
    <>
      <input
        ref={ref}
        list="hwp-fonts"
        aria-label="글꼴"
        title="글꼴"
        className="h-7 w-36 rounded-md border border-line bg-field px-2 text-[13px] outline-none focus:border-accent"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          // picking from the datalist fires a change with a full font name
          if (list.includes(e.target.value)) onCommit(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text.trim()) onCommit(text.trim())
        }}
        onBlur={() => setText(value)}
      />
      <datalist id="hwp-fonts">
        {list.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
    </>
  )
}

function SizeInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value))
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (document.activeElement !== ref.current) setText(String(value))
  }, [value])
  const commit = () => {
    const v = Number(text)
    if (v > 0 && v <= 4096) onCommit(v)
  }
  return (
    <>
      <input
        ref={ref}
        list="hwp-sizes"
        aria-label="글자 크기"
        title="글자 크기 (pt)"
        className="h-7 w-14 rounded-md border border-line bg-field px-1.5 text-right text-[13px] tabular-nums outline-none focus:border-accent"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          if (SIZES.includes(Number(e.target.value)) && (e.nativeEvent as InputEvent).inputType === undefined) onCommit(Number(e.target.value))
        }}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        onBlur={() => setText(String(value))}
      />
      <datalist id="hwp-sizes">
        {SIZES.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
    </>
  )
}

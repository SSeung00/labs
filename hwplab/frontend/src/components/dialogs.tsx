import type { Editor, JSONContent } from '@tiptap/core'
import katex from 'katex'
import { useEffect, useMemo, useRef, useState } from 'react'
import { footnoteText, PARA_DEFAULTS, type ParaAttrs } from '@/editor/extensions'
import { currentChar, currentPara, setChar, setPara } from '@/editor/setup'
import { mmToPt, PAPER_SIZES, ptToMm, round, type PageSetup } from '@/editor/units'
import { api } from '@/lib/api'
import { Btn, Dialog, NumField, SelectField } from './ui'

// ---------------------------------------------------------------------------------------------
// 문단 모양

export function ParagraphDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [a, setA] = useState<ParaAttrs>(() => currentPara(editor))
  const set = (patch: Partial<ParaAttrs>) => setA((p) => ({ ...p, ...patch }))
  const indentKind = a.indent > 0 ? 'indent' : a.indent < 0 ? 'hanging' : 'none'
  return (
    <Dialog
      title="문단 모양"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>취소</Btn>
          <Btn
            primary
            onClick={() => {
              setPara(editor, a)
              onClose()
            }}
          >
            설정
          </Btn>
        </>
      }
    >
      <div className="grid gap-2.5">
        <SelectField
          label="정렬"
          value={a.align}
          options={[
            { value: 'justify', label: '양쪽 정렬' },
            { value: 'left', label: '왼쪽 정렬' },
            { value: 'center', label: '가운데 정렬' },
            { value: 'right', label: '오른쪽 정렬' },
            { value: 'distribute', label: '배분 정렬' },
            { value: 'distribute_space', label: '나눔 정렬' },
          ]}
          onChange={(v) => set({ align: v })}
        />
        <Section>여백</Section>
        <NumField label="왼쪽" unit="pt" value={a.left} onChange={(v) => set({ left: v })} />
        <NumField label="오른쪽" unit="pt" value={a.right} onChange={(v) => set({ right: v })} />
        <SelectField
          label="첫 줄"
          value={indentKind}
          options={[
            { value: 'none', label: '보통' },
            { value: 'indent', label: '들여쓰기' },
            { value: 'hanging', label: '내어쓰기' },
          ]}
          onChange={(v) => set({ indent: v === 'none' ? 0 : (v === 'indent' ? 1 : -1) * (Math.abs(a.indent) || 20) })}
        />
        {indentKind !== 'none' && (
          <NumField label="첫 줄 간격" unit="pt" min={0} value={Math.abs(a.indent)} onChange={(v) => set({ indent: (indentKind === 'indent' ? 1 : -1) * Math.abs(v) })} />
        )}
        <Section>간격</Section>
        <SelectField
          label="줄 간격 종류"
          value={a.lineType}
          options={[
            { value: 'percent', label: '글자에 따라(%)' },
            { value: 'fixed', label: '고정 값(pt)' },
            { value: 'between', label: '여백만 지정(pt)' },
            { value: 'atleast', label: '최소(pt)' },
          ]}
          onChange={(v) => set({ lineType: v, line: v === 'percent' ? 160 : v === 'between' ? 6 : 16 })}
        />
        <NumField label="줄 간격" unit={a.lineType === 'percent' ? '%' : 'pt'} step={a.lineType === 'percent' ? 5 : 0.5} value={a.line} onChange={(v) => set({ line: v })} />
        <NumField label="문단 위" unit="pt" value={a.before} onChange={(v) => set({ before: v })} />
        <NumField label="문단 아래" unit="pt" value={a.after} onChange={(v) => set({ after: v })} />
        <Section>줄 나눔</Section>
        <SelectField
          label="한글 단위"
          value={a.keepWord ? 'word' : 'char'}
          options={[
            { value: 'char', label: '글자' },
            { value: 'word', label: '어절' },
          ]}
          onChange={(v) => set({ keepWord: v === 'word' })}
        />
        <label className="flex items-center gap-2 text-[13px] text-ink">
          <input type="checkbox" checked={a.pageBreak} onChange={(e) => set({ pageBreak: e.target.checked })} />
          문단 앞에서 항상 쪽 나눔
        </label>
        <button className="justify-self-start text-[12px] text-accent hover:underline" onClick={() => setA({ ...PARA_DEFAULTS, size: a.size })}>
          기본값(바탕글)으로
        </button>
      </div>
    </Dialog>
  )
}

const Section = ({ children }: { children: string }) => (
  <div className="mt-1 border-b border-line pb-1 text-[12px] font-semibold text-muted">{children}</div>
)

// ---------------------------------------------------------------------------------------------
// 글자 모양

export function CharDialog({ editor, fonts, onClose }: { editor: Editor; fonts: string[]; onClose: () => void }) {
  const init = useMemo(() => currentChar(editor), [editor])
  const [a, setA] = useState(init)
  const [split, setSplit] = useState(init.fontLatin !== init.fontHangul)
  const set = (patch: Partial<typeof a>) => setA((p) => ({ ...p, ...patch }))
  const FontPick = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
    <label className="flex items-center justify-between gap-3 text-[13px]">
      <span className="text-muted">{label}</span>
      <input list="hwp-fonts-dlg" className="h-7 w-44 rounded-md border border-line bg-field px-2 outline-none focus:border-accent" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
  return (
    <Dialog
      title="글자 모양"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>취소</Btn>
          <Btn
            primary
            onClick={() => {
              setChar(editor, {
                fontHangul: a.fontHangul,
                fontLatin: split ? a.fontLatin : a.fontHangul,
                size: a.size,
                spacing: a.spacing,
                ratio: a.ratio,
              })
              onClose()
            }}
          >
            설정
          </Btn>
        </>
      }
    >
      <datalist id="hwp-fonts-dlg">
        {fonts.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      <div className="grid gap-2.5">
        <NumField label="기준 크기" unit="pt" step={0.5} min={1} value={a.size} onChange={(v) => set({ size: v })} />
        <FontPick label={split ? '한글 글꼴' : '글꼴'} value={a.fontHangul} onChange={(v) => set({ fontHangul: v })} />
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} />
          영문 글꼴 따로 지정
        </label>
        {split && <FontPick label="영문 글꼴" value={a.fontLatin} onChange={(v) => set({ fontLatin: v })} />}
        <NumField label="장평" unit="%" step={1} min={50} max={200} value={a.ratio} onChange={(v) => set({ ratio: v })} />
        <NumField label="자간" unit="%" step={1} min={-50} max={50} value={a.spacing} onChange={(v) => set({ spacing: v })} />
        <div className="mt-1 rounded-md border border-line bg-white p-3 text-black" style={{ fontSize: `${Math.min(a.size, 28)}pt` }}>
          <span style={{ fontFamily: `"${a.fontHangul}", serif`, letterSpacing: `${a.spacing / 100}em` }}>한글 ABC 123 가나다</span>
        </div>
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------------------------
// 편집 용지

export function PageDialog({ page, onApply, onClose }: { page: PageSetup; onApply: (p: PageSetup) => void; onClose: () => void }) {
  const [p, setP] = useState<PageSetup>(page)
  const mm = (k: keyof PageSetup) => round(ptToMm(p[k] as number), 1)
  const setMm = (k: keyof PageSetup) => (v: number) => setP((x) => ({ ...x, [k]: mmToPt(v) }))
  const short = Math.min(p.width, p.height)
  const long = Math.max(p.width, p.height)
  const sizeName = PAPER_SIZES.find((s) => Math.abs(s.width - short) < 2 && Math.abs(s.height - long) < 2)?.name ?? 'custom'
  return (
    <Dialog
      title="편집 용지"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>취소</Btn>
          <Btn
            primary
            onClick={() => {
              onApply(p)
              onClose()
            }}
          >
            설정
          </Btn>
        </>
      }
    >
      <div className="grid gap-2.5">
        <SelectField
          label="용지 종류"
          value={sizeName}
          options={[...PAPER_SIZES.map((s) => ({ value: s.name, label: s.name })), { value: 'custom', label: '사용자 정의' }]}
          onChange={(v) => {
            const s = PAPER_SIZES.find((x) => x.name === v)
            if (s) setP((x) => (x.landscape ? { ...x, width: s.height, height: s.width } : { ...x, width: s.width, height: s.height }))
          }}
        />
        <SelectField
          label="용지 방향"
          value={p.landscape ? 'landscape' : 'portrait'}
          options={[
            { value: 'portrait', label: '세로' },
            { value: 'landscape', label: '가로' },
          ]}
          onChange={(v) => setP((x) => ({ ...x, landscape: v === 'landscape', width: v === 'landscape' ? long : short, height: v === 'landscape' ? short : long }))}
        />
        <NumField label="폭" unit="mm" value={mm('width')} onChange={setMm('width')} />
        <NumField label="길이" unit="mm" value={mm('height')} onChange={setMm('height')} />
        <Section>여백</Section>
        <NumField label="위쪽" unit="mm" value={mm('top')} onChange={setMm('top')} />
        <NumField label="아래쪽" unit="mm" value={mm('bottom')} onChange={setMm('bottom')} />
        <NumField label="왼쪽" unit="mm" value={mm('left')} onChange={setMm('left')} />
        <NumField label="오른쪽" unit="mm" value={mm('right')} onChange={setMm('right')} />
        <NumField label="머리말" unit="mm" value={mm('header')} onChange={setMm('header')} />
        <NumField label="꼬리말" unit="mm" value={mm('footer')} onChange={setMm('footer')} />
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------------------------
// 수식

const EQ_SNIPPETS: [string, string][] = [
  ['분수', '{a} over {b}'],
  ['제곱근', 'sqrt {x}'],
  ['n제곱근', 'root {n} of {x}'],
  ['위첨자', 'x ^{2}'],
  ['아래첨자', 'x _{i}'],
  ['합', 'sum _{i=1} ^{n} {a _{i}}'],
  ['적분', 'int _{a} ^{b} {f(x)dx}'],
  ['극한', 'lim _{x -> 0} {f(x)}'],
  ['괄호', 'LEFT ( {a} over {b} RIGHT )'],
  ['행렬', 'matrix{a & b # c & d}'],
  ['≤', 'LEQ'],
  ['×', 'times'],
  ['±', '+-'],
  ['α', 'alpha'],
  ['φ', 'phi'],
]

export function EquationDialog({
  initial,
  onApply,
  onClose,
}: {
  initial: { script: string; size: number }
  onApply: (attrs: { script: string; latex: string | null; size: number }) => void
  onClose: () => void
}) {
  const [script, setScript] = useState(initial.script)
  const [latex, setLatex] = useState<string | null>(null)
  const [size, setSize] = useState(initial.size || 10)
  const previewRef = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        setLatex((await api.latex(script)).latex)
      } catch {
        setLatex(null)
      }
    }, 200)
    return () => clearTimeout(t)
  }, [script])
  useEffect(() => {
    const el = previewRef.current
    if (!el) return
    if (latex) {
      try {
        katex.render(latex, el, { throwOnError: true, displayMode: true, strict: 'ignore' })
        return
      } catch {
        /* show message below */
      }
    }
    el.textContent = script.trim() ? '미리 볼 수 없는 수식이에요. 저장하면 한글에서는 그대로 보여요.' : ''
  }, [latex, script])
  const insertSnippet = (s: string) => {
    const el = areaRef.current
    if (!el) return setScript((x) => `${x} ${s}`)
    const { selectionStart: a, selectionEnd: b } = el
    const next = `${script.slice(0, a)}${s}${script.slice(b)}`
    setScript(next)
    requestAnimationFrame(() => {
      el.focus()
      el.selectionStart = el.selectionEnd = a + s.length
    })
  }
  return (
    <Dialog
      title="수식 편집"
      width={600}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>취소</Btn>
          <Btn
            primary
            disabled={!script.trim()}
            onClick={() => {
              onApply({ script: script.trim(), latex, size })
              onClose()
            }}
          >
            넣기
          </Btn>
        </>
      }
    >
      <div className="mb-2 flex flex-wrap gap-1">
        {EQ_SNIPPETS.map(([label, s]) => (
          <button key={label} type="button" className="rounded border border-line px-2 py-0.5 text-[12px] hover:bg-hover" onClick={() => insertSnippet(s)}>
            {label}
          </button>
        ))}
      </div>
      <textarea
        ref={areaRef}
        autoFocus
        className="h-28 w-full resize-y rounded-md border border-line bg-field p-2 font-mono text-[13px] outline-none focus:border-accent"
        placeholder="한글 수식 스크립트 (예: {a+b} over {2})"
        value={script}
        onChange={(e) => setScript(e.target.value)}
      />
      <div className="mt-2 flex items-center justify-between text-[12px] text-muted">
        <span>한글 수식 편집기 문법을 그대로 써요.</span>
        <label className="flex items-center gap-1">
          크기
          <input type="number" className="h-6 w-14 rounded border border-line bg-field px-1 text-right" value={size} step={0.5} onChange={(e) => setSize(Number(e.target.value))} />
          pt
        </label>
      </div>
      <div ref={previewRef} className="mt-2 min-h-16 overflow-x-auto rounded-md border border-line bg-white p-3 text-[13px] text-black" />
    </Dialog>
  )
}

// ---------------------------------------------------------------------------------------------
// 각주

export function FootnoteDialog({
  initial,
  onApply,
  onClose,
}: {
  initial: JSONContent[] | null
  onApply: (content: JSONContent[]) => void
  onClose: () => void
}) {
  const [text, setText] = useState(() => footnoteText(initial))
  return (
    <Dialog
      title="각주"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>취소</Btn>
          <Btn
            primary
            onClick={() => {
              if (initial?.length && text === footnoteText(initial)) return onClose() // keep formatting
              const paras = text.split('\n').map((line) => ({
                type: 'paragraph',
                attrs: { ...PARA_DEFAULTS, line: 130, size: 9 },
                content: line ? [{ type: 'text', text: line, marks: [{ type: 'textStyle', attrs: { size: 9 } }] }] : undefined,
              }))
              onApply(paras as JSONContent[])
              onClose()
            }}
          >
            설정
          </Btn>
        </>
      }
    >
      <textarea
        autoFocus
        className="h-32 w-full resize-y rounded-md border border-line bg-field p-2 text-[13px] outline-none focus:border-accent"
        placeholder="각주 내용"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {initial && initial.length > 0 && <p className="mt-1 text-[12px] text-muted">각주 안의 글자 서식은 단순한 글로 바뀌어요.</p>}
    </Dialog>
  )
}

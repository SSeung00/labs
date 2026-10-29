// TipTap schema for HWP documents. Formatting is stored resolved (font, size, colour on every
// run; margins and line spacing on every paragraph) - see backend app/hwp/model.py.
import { mergeAttributes, Mark, Node, type Attribute } from '@tiptap/core'
import { Paragraph } from '@tiptap/extension-paragraph'
import { Table, TableCell, TableHeader, TableRow, TableView } from '@tiptap/extension-table'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TextStyle } from '@tiptap/extension-text-style'
import katex from 'katex'
import { api } from '@/lib/api'
import { DEFAULT_SIZE, fontStack } from './fonts'
import { ptToPx } from './units'

// ---------------------------------------------------------------------------------------------
// helpers

/** Attributes kept in one data-hwp JSON blob so copy/paste inside the editor keeps them. */
function hwpAttrs(defaults: Record<string, unknown>, keepOnSplit: string[] = []): Record<string, Attribute> {
  const out: Record<string, Attribute> = {}
  for (const [key, def] of Object.entries(defaults)) {
    out[key] = {
      default: def,
      keepOnSplit: keepOnSplit.includes(key),
      parseHTML: (el) => {
        try {
          const data = JSON.parse((el as HTMLElement).dataset.hwp || '{}')
          return key in data ? data[key] : def
        } catch {
          return def
        }
      },
      renderHTML: () => ({}),
    }
  }
  return out
}

const pick = (attrs: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(keys.filter((k) => attrs[k] !== null && attrs[k] !== undefined).map((k) => [k, attrs[k]]))

let currentDocId = ''
export const setCurrentDocId = (id: string) => {
  currentDocId = id
}
export const imageUrl = (src: string) => (/^(https?:|data:|blob:|\/)/.test(src) ? src : api.binUrl(currentDocId, src))

// ---------------------------------------------------------------------------------------------
// paragraph

export interface ParaAttrs {
  align: 'justify' | 'left' | 'right' | 'center' | 'distribute' | 'distribute_space'
  left: number
  right: number
  indent: number
  before: number
  after: number
  lineType: 'percent' | 'fixed' | 'between' | 'atleast'
  line: number
  pageBreak: boolean
  keepWord: boolean
  size: number | null
  hf: string[] | null
}

export const PARA_DEFAULTS: ParaAttrs = {
  align: 'justify',
  left: 0,
  right: 0,
  indent: 0,
  before: 0,
  after: 0,
  lineType: 'percent',
  line: 160,
  pageBreak: false,
  keepWord: false,
  size: null,
  hf: null,
}
const PARA_KEYS = Object.keys(PARA_DEFAULTS)

export function paraStyle(a: ParaAttrs): string {
  const size = a.size || DEFAULT_SIZE
  const s: string[] = []
  const align = a.align || 'justify'
  if (align === 'distribute' || align === 'distribute_space') s.push('text-align:justify', 'text-align-last:justify')
  else s.push(`text-align:${align}`)
  // Hangul: negative indent = hanging (내어쓰기): later lines move right, the first stays at the margin.
  const indent = a.indent || 0
  s.push(`padding-left:${(a.left || 0) + Math.max(0, -indent)}pt`)
  if (a.right) s.push(`padding-right:${a.right}pt`)
  if (indent) s.push(`text-indent:${indent}pt`)
  if (a.before) s.push(`padding-top:${a.before}pt`)
  if (a.after) s.push(`padding-bottom:${a.after}pt`)
  s.push(`font-size:${size}pt`)
  const line = a.line ?? 160
  let pitch: number // pt from one line to the next
  switch (a.lineType) {
    case 'fixed':
    case 'atleast':
      pitch = line
      s.push(`line-height:${line}pt`)
      break
    case 'between':
      pitch = size + line
      s.push(`line-height:${pitch}pt`)
      break
    default:
      pitch = (size * line) / 100
      s.push(`line-height:${line / 100}`)
  }
  // Hangul puts a line's text at the top of its box and all the spacing below it; CSS splits
  // the leading above and below. Shift the paragraph up by half the leading and keep the
  // other half after it, so text sits where Hangul draws it (tables drop the last line's
  // spacing, see index.css).
  const hl = Math.round(((pitch - size) / 2) * 100) / 100
  if (hl) s.push(`--hl:${hl}pt`, `margin-top:${-hl}pt`, `margin-bottom:${hl}pt`)
  if (a.keepWord) s.push('word-break:keep-all')
  return s.join(';')
}

export const HwpParagraph = Paragraph.extend({
  addAttributes() {
    return hwpAttrs({ ...PARA_DEFAULTS }, PARA_KEYS.filter((k) => k !== 'pageBreak' && k !== 'hf'))
  },
  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs as ParaAttrs
    // The paragraph's own font (its line "strut") follows its first run: mixing fonts with
    // different ascents on one baseline would make every line taller than Hangul's.
    let font = ''
    const first = node.firstChild
    const ts = first?.marks.find((m) => m.type.name === 'textStyle')
    if (ts && (ts.attrs.fontLatin || ts.attrs.fontHangul)) font = `;font-family:${fontStack(ts.attrs.fontLatin, ts.attrs.fontHangul)}`
    return [
      'p',
      mergeAttributes(HTMLAttributes, {
        style: paraStyle(a) + font,
        'data-hwp': JSON.stringify(pick(node.attrs, PARA_KEYS)),
        class: a.pageBreak ? 'hwp-pb' : undefined,
      }),
      0,
    ]
  },
})

// ---------------------------------------------------------------------------------------------
// character style

export interface CharAttrs {
  fontLatin: string | null
  fontHangul: string | null
  size: number | null
  color: string | null
  shade: string | null
  spacing: number
  ratio: number
}
const CHAR_DEFAULTS: CharAttrs = {
  fontLatin: null,
  fontHangul: null,
  size: null,
  color: null,
  shade: null,
  spacing: 0,
  ratio: 100,
}
const CHAR_KEYS = Object.keys(CHAR_DEFAULTS)

export function charStyle(a: Partial<CharAttrs>): string {
  const s: string[] = []
  if (a.fontLatin || a.fontHangul) s.push(`font-family:${fontStack(a.fontLatin, a.fontHangul)}`)
  if (a.size) s.push(`font-size:${a.size}pt`)
  if (a.color && a.color !== '#000000') s.push(`color:${a.color}`)
  if (a.shade) s.push(`background-color:${a.shade}`)
  // 자간 is a percentage of the font size. 장평 (glyph width) has no CSS equivalent for inline
  // text that still wraps, so its effect on line fill is approximated with letter-spacing.
  const ls = (a.spacing || 0) / 100 + ((a.ratio || 100) - 100) / 100 * 0.85
  if (Math.abs(ls) > 0.001) s.push(`letter-spacing:${Math.round(ls * 1000) / 1000}em`)
  return s.join(';')
}

export const HwpTextStyle = TextStyle.extend({
  priority: 101,
  addAttributes() {
    return hwpAttrs({ ...CHAR_DEFAULTS })
  },
  parseHTML() {
    return [{ tag: 'span[data-hwp]' }]
  },
  renderHTML({ mark }) {
    const style = charStyle(mark.attrs as CharAttrs)
    return ['span', { style: style || undefined, 'data-hwp': JSON.stringify(pick(mark.attrs, CHAR_KEYS)) }, 0]
  },
})

export const HwpUnderline = Mark.create({
  name: 'underline',
  addAttributes() {
    return { type: { default: 'bottom', parseHTML: (el) => (el.classList.contains('hwp-over') ? 'top' : 'bottom') } }
  },
  parseHTML() {
    return [{ tag: 'u' }, { style: 'text-decoration', getAttrs: (v) => (/underline/.test(String(v)) ? null : false) }]
  },
  renderHTML({ mark }) {
    return ['u', mark.attrs.type === 'top' ? { class: 'hwp-over' } : {}, 0]
  },
  addKeyboardShortcuts() {
    return { 'Mod-u': () => this.editor.commands.toggleMark(this.name) }
  },
})

// ---------------------------------------------------------------------------------------------
// tables

export interface BorderSide {
  type: string
  width: number
  color: string
}
export type Borders = Partial<Record<'left' | 'right' | 'top' | 'bottom', BorderSide>>

const CSS_BORDER: Record<string, string> = {
  SOLID: 'solid',
  DOT: 'dotted',
  CIRCLE: 'dotted',
  DASH: 'dashed',
  LONG_DASH: 'dashed',
  DASH_DOT: 'dashed',
  DASH_DOT_DOT: 'dashed',
  DOUBLE_SLIM: 'double',
  SLIM_THICK: 'double',
  THICK_SLIM: 'double',
  SLIM_THICK_SLIM: 'double',
  WAVE: 'solid',
  DOUBLE_WAVE: 'double',
  THICK_3D: 'ridge',
  THICK_3D_REVERS_LIGHTING: 'groove',
  '3D': 'ridge',
  '3D_REVERS_LIGHTING': 'groove',
}

const SIDES = ['left', 'right', 'top', 'bottom'] as const

function cellStyle(a: Record<string, any>) {
  const s: string[] = []
  const classes: string[] = []
  const b: Borders | null = a.borders
  for (const side of SIDES) {
    const bs = b ? b[side] : { type: 'SOLID', width: 0.12, color: '#000000' }
    const css = bs ? CSS_BORDER[bs.type] : undefined
    if (!bs || !css) {
      classes.push(`nb-${side[0]}`)
      continue
    }
    const min = css === 'double' ? 0.8 : 0.1
    s.push(`border-${side}:${Math.max(bs.width || 0.12, min)}mm ${css} ${bs.color || '#000'}`)
  }
  if (a.background) s.push(`background-color:${a.background}`)
  if (a.vAlign && a.vAlign !== 'top') s.push(`vertical-align:${a.vAlign}`)
  const p = a.padding
  if (p) s.push(`padding:${p.top ?? 1.41}pt ${p.right ?? 5.1}pt ${p.bottom ?? 1.41}pt ${p.left ?? 5.1}pt`)
  return { style: s.join(';'), class: classes.join(' ') || undefined }
}

const CELL_DEFAULTS = { background: null, borders: null, vAlign: 'top', padding: null }

export const HwpTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...hwpAttrs({ ...CELL_DEFAULTS }) }
  },
  renderHTML({ node, HTMLAttributes }) {
    const { style, class: cls } = cellStyle(node.attrs)
    return [
      'td',
      mergeAttributes(HTMLAttributes, {
        style,
        class: cls,
        'data-hwp': JSON.stringify(pick(node.attrs, Object.keys(CELL_DEFAULTS))),
      }),
      0,
    ]
  },
})

export const HwpTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...hwpAttrs({ ...CELL_DEFAULTS }) }
  },
})

export const HwpTableRow = TableRow.extend({
  addAttributes() {
    return {
      height: {
        default: 0,
        parseHTML: (el) => Number((el as HTMLElement).dataset.h || 0),
        renderHTML: (attrs) => (attrs.height ? { 'data-h': attrs.height, style: `height:${attrs.height}pt` } : {}),
      },
    }
  },
})

// ---------------------------------------------------------------------------------------------
// floating objects (not "treated as a character")

export interface FloatAttrs {
  wrap: 'SQUARE' | 'TOP_AND_BOTTOM' | 'BEHIND_TEXT' | 'IN_FRONT_OF_TEXT'
  vertRelTo: 'PAPER' | 'PAGE' | 'PARA'
  horzRelTo: 'PAPER' | 'PAGE' | 'COLUMN' | 'PARA'
  vertAlign: string
  horzAlign: string
  vertOffset: number
  horzOffset: number
  width: number
  height: number
  z: number
  hidden?: boolean
}

/** Drawn over or under the text without taking space in the flow (글 앞으로 / 글 뒤로). */
export const isOverlay = (f: FloatAttrs | null | undefined): boolean =>
  !!f && (f.wrap === 'BEHIND_TEXT' || f.wrap === 'IN_FRONT_OF_TEXT')

function floatClasses(f: FloatAttrs | null | undefined): string[] {
  if (!f) return []
  if (f.hidden) return ['hwp-covered']
  if (isOverlay(f)) return ['hwp-float', f.wrap === 'BEHIND_TEXT' ? 'hwp-behind' : 'hwp-front']
  return ['hwp-placed']
}

class HwpTableView extends TableView {
  constructor(node: PMNode, cellMinWidth: number, view: unknown, attrs?: Record<string, unknown>) {
    super(node, cellMinWidth, view as never, attrs)
    this.decorate(node)
  }
  update(node: PMNode) {
    const ok = super.update(node)
    if (ok) this.decorate(node)
    return ok
  }
  decorate(node: PMNode) {
    const f = node.attrs.float as FloatAttrs | null
    const keep = ['tableWrapper']
    this.dom.className = [...keep, ...floatClasses(f), !f && node.attrs.align !== 'left' ? `hwp-align-${node.attrs.align}` : ''].filter(Boolean).join(' ')
    this.dom.style.zIndex = f && isOverlay(f) ? String(f.wrap === 'BEHIND_TEXT' ? -1 : 5 + Math.max(0, Math.min(f.z || 0, 1000))) : ''
  }
}

export const HwpTable = Table.extend({
  addAttributes() {
    return {
      width: { default: null, renderHTML: () => ({}) },
      cellSpacing: { default: 0, renderHTML: () => ({}) },
      align: { default: 'left', renderHTML: () => ({}) },
      float: { default: null, renderHTML: () => ({}) },
    }
  },
}).configure({
  resizable: true,
  cellMinWidth: 8,
  lastColumnResizable: true,
  allowTableNodeSelection: true,
  View: HwpTableView as unknown as typeof TableView,
})

// ---------------------------------------------------------------------------------------------
// inline objects

export const HwpImage = Node.create({
  name: 'image',
  group: 'inline',
  inline: true,
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      src: { default: '' },
      width: { default: 100 },
      height: { default: 100 },
      alt: { default: '' },
      float: { default: null },
    }
  },
  parseHTML() {
    return [
      {
        tag: 'img[data-src]',
        getAttrs: (el) => {
          const e = el as HTMLElement
          let float = null
          try {
            float = JSON.parse(e.dataset.float || 'null')
          } catch {
            /* ignore */
          }
          return { src: e.dataset.src, width: Number(e.dataset.w), height: Number(e.dataset.h), alt: e.getAttribute('alt') || '', float }
        },
      },
    ]
  },
  renderHTML({ node }) {
    const { src, width, height, alt, float } = node.attrs
    const f = float as FloatAttrs | null
    const z = f && isOverlay(f) ? `;z-index:${f.wrap === 'BEHIND_TEXT' ? -1 : 5 + Math.max(0, Math.min(f.z || 0, 1000))}` : ''
    return [
      'img',
      {
        src: imageUrl(src),
        'data-src': src,
        'data-w': width,
        'data-h': height,
        'data-float': f ? JSON.stringify(f) : undefined,
        alt,
        class: ['hwp-img', ...floatClasses(f)].join(' '),
        draggable: 'true',
        style: `width:${ptToPx(width)}px;height:${ptToPx(height)}px${z}`,
      },
    ]
  },
})

// Equations: KaTeX rendering of the LaTeX derived from Hangul's equation script, done lazily
// when the equation scrolls into view (KDS-style documents hold thousands of them).
const eqObserver =
  typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue
            const el = e.target as HTMLElement & { _render?: () => void }
            eqObserver?.unobserve(el)
            el._render?.()
          }
        },
        { rootMargin: '1200px 0px' },
      )
    : null

function renderEquation(el: HTMLElement, attrs: Record<string, any>) {
  el.textContent = ''
  if (attrs.latex) {
    try {
      katex.render(attrs.latex, el, { throwOnError: true, output: 'html', strict: 'ignore' })
      el.classList.remove('hwp-eq-raw')
      return
    } catch {
      /* fall through to the raw script */
    }
  }
  el.classList.add('hwp-eq-raw')
  el.textContent = attrs.script || '수식'
}

export const HwpEquation = Node.create({
  name: 'equation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      script: { default: '' },
      latex: { default: null },
      width: { default: 0 },
      height: { default: 0 },
      size: { default: 10 },
      color: { default: '#000000' },
    }
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-eq]',
        getAttrs: (el) => {
          try {
            return JSON.parse((el as HTMLElement).dataset.eq || '{}')
          } catch {
            return false
          }
        },
      },
    ]
  },
  renderHTML({ node }) {
    return ['span', { 'data-eq': JSON.stringify(node.attrs), class: 'hwp-eq' }, node.attrs.script]
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span') as HTMLSpanElement & { _render?: () => void }
      dom.className = 'hwp-eq'
      dom.contentEditable = 'false'
      let attrs = node.attrs
      const apply = () => {
        dom.style.fontSize = `${attrs.size || 10}pt`
        dom.style.color = attrs.color && attrs.color !== '#000000' ? attrs.color : ''
        dom.title = attrs.script
      }
      apply()
      // placeholder keeps the original size so pagination is right before KaTeX runs
      dom.textContent = attrs.script
      dom.classList.add('hwp-eq-raw')
      dom._render = () => renderEquation(dom, attrs)
      if (eqObserver) eqObserver.observe(dom)
      else dom._render()
      return {
        dom,
        update(updated) {
          if (updated.type.name !== 'equation') return false
          attrs = updated.attrs
          apply()
          renderEquation(dom, attrs)
          return true
        },
        destroy() {
          eqObserver?.unobserve(dom)
        },
      }
    }
  },
})

/** Footnote / endnote: an inline marker that carries its note paragraphs as an attribute. */
export const HwpFootnote = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { kind: { default: 'foot' }, content: { default: [] } }
  },
  parseHTML() {
    return [
      {
        tag: 'sup[data-fn]',
        getAttrs: (el) => {
          try {
            return JSON.parse((el as HTMLElement).dataset.fn || '{}')
          } catch {
            return false
          }
        },
      },
    ]
  },
  renderHTML({ node }) {
    return [
      'sup',
      {
        'data-fn': JSON.stringify(node.attrs),
        class: node.attrs.kind === 'end' ? 'hwp-fn hwp-en' : 'hwp-fn',
        title: footnoteText(node.attrs.content),
      },
    ]
  },
})

export function footnoteText(content: any[] | null | undefined): string {
  const out: string[] = []
  const walk = (n: any) => {
    if (!n) return
    if (n.type === 'text') out.push(n.text)
    for (const c of n.content || []) walk(c)
    if (n.type === 'paragraph') out.push('\n')
  }
  for (const p of content || []) walk(p)
  return out.join('').trim()
}

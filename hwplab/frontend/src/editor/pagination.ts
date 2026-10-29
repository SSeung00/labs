// Page view for a continuous ProseMirror document.
//
// The editor is one long white column. After every layout change we measure the natural
// height of each top-level block (ignoring our own spacers) and insert widget decorations
// where a page ends: between blocks, between table rows, or between the lines of a long
// paragraph. A widget draws the end of one page (bottom margin, footer, page number), the gap
// between sheets and the top of the next page (top margin, header). Start and end widgets
// draw the first page's top margin and fill the last page.
//
// Hangul's page geometry (편집 용지): from the paper top come the top margin (위쪽) and then
// the header area (머리말); from the paper bottom the bottom margin (아래쪽) and the footer
// area (꼬리말). The body is what remains in between.
import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { isOverlay, type FloatAttrs } from './extensions'
import { ptToPx, type PageSetup } from './units'

export const GAP_PX = 28

export interface PageChrome {
  page: PageSetup
  headerHtml: string
  footerHtml: string
  pageNumber: { pos: string; side: string } | null
  hideFirst?: { header?: boolean; footer?: boolean; pageNum?: boolean } | null
}

/** px from the paper top to the body, and from the body to the paper bottom */
export const bodyTop = (p: PageSetup) => ptToPx(p.top + p.header)
export const bodyBottom = (p: PageSetup) => ptToPx(p.bottom + p.footer)
export const bodyHeight = (p: PageSetup) => ptToPx(p.height) - bodyTop(p) - bodyBottom(p)

type BreakKind = 'block' | 'row' | 'line'
interface Brk {
  pos: number
  kind: BreakKind
  filler: number // px of empty space left on the page being closed
  page: number // index of the page being closed (0-based)
  rowOffset?: number // px from the body's left edge to the widget's containing box
  spacer?: boolean // invisible twin in the other cells of a row split across pages
  block?: boolean // placed between blocks inside a table cell (rendered as a div)
}
interface FloatDeco {
  from: number
  to: number
  style: string
}
interface HfFrom {
  header: number // first page index showing the header (Infinity: none yet)
  footer: number
}
interface PagState {
  hf: HfFrom
  floats: FloatDeco[]
  breaks: Brk[]
  pages: number
  lastFill: number
  deco: DecorationSet
}

export const paginationKey = new PluginKey<PagState>('hwp-pagination')

const sameBreaks = (a: Brk[], b: Brk[]) =>
  a.length === b.length &&
  a.every((x, i) => x.pos === b[i].pos && x.kind === b[i].kind && Math.abs(x.filler - b[i].filler) < 0.5)

// ---------------------------------------------------------------------------------------------
// widget DOM

function pageNumberText(n: number, side: string) {
  return side ? `${side} ${n} ${side}` : String(n)
}

function frame(
  tag: 'div' | 'span',
  chrome: PageChrome,
  parts: { bottom?: number; top?: boolean; pageNo?: number; footer?: boolean; header?: boolean },
) {
  const { page } = chrome
  const L = ptToPx(page.left)
  const R = ptToPx(page.right)
  const el = document.createElement(tag)
  el.className = 'hwp-pg'
  el.contentEditable = 'false'
  el.setAttribute('data-pg', '1')
  el.style.marginLeft = `${-L}px`
  el.style.marginRight = `${-R}px`
  el.style.width = `${ptToPx(page.width)}px`

  if (parts.bottom !== undefined) {
    const bottom = document.createElement(tag)
    bottom.className = 'hwp-pg-bottom'
    bottom.style.height = `${parts.bottom + bodyBottom(page)}px`
    const first = parts.pageNo === 1
    if (parts.footer !== false && !(first && chrome.hideFirst?.footer)) {
      const footerBox = document.createElement(tag)
      footerBox.className = 'hwp-pg-footer'
      footerBox.style.left = `${L}px`
      footerBox.style.right = `${R}px`
      footerBox.style.bottom = `${ptToPx(page.bottom)}px`
      footerBox.style.height = `${ptToPx(page.footer)}px`
      footerBox.innerHTML = chrome.footerHtml
      bottom.appendChild(footerBox)
    }
    const pn = chrome.pageNumber
    if (pn && parts.pageNo && /BOTTOM/.test(pn.pos) && !(first && chrome.hideFirst?.pageNum)) {
      const num = document.createElement(tag)
      num.className = `hwp-pg-num ${pn.pos.toLowerCase()}`
      num.style.left = `${L}px`
      num.style.right = `${R}px`
      num.style.bottom = `${ptToPx(page.bottom)}px`
      num.textContent = pageNumberText(parts.pageNo, pn.side)
      bottom.appendChild(num)
    }
    el.appendChild(bottom)
  }
  if (parts.top) {
    if (parts.bottom !== undefined) {
      const gap = document.createElement(tag)
      gap.className = 'hwp-pg-gap'
      gap.style.height = `${GAP_PX}px`
      el.appendChild(gap)
    }
    const top = document.createElement(tag)
    top.className = 'hwp-pg-top'
    top.style.height = `${bodyTop(page)}px`
    const nextNo = (parts.pageNo ?? 0) + 1
    const firstPage = nextNo === 1
    if (parts.header !== false && !(firstPage && chrome.hideFirst?.header)) {
      const headerBox = document.createElement(tag)
      headerBox.className = 'hwp-pg-header'
      headerBox.style.left = `${L}px`
      headerBox.style.right = `${R}px`
      headerBox.style.top = `${ptToPx(page.top)}px`
      headerBox.style.height = `${ptToPx(page.header)}px`
      headerBox.innerHTML = chrome.headerHtml
      top.appendChild(headerBox)
    }
    const pn = chrome.pageNumber
    if (pn && /TOP/.test(pn.pos) && !(firstPage && chrome.hideFirst?.pageNum)) {
      const num = document.createElement(tag)
      num.className = `hwp-pg-num ${pn.pos.toLowerCase()}`
      num.style.left = `${L}px`
      num.style.right = `${R}px`
      num.style.top = `${ptToPx(page.top)}px`
      num.textContent = pageNumberText(nextNo, pn.side)
      top.appendChild(num)
    }
    el.appendChild(top)
  }
  return el
}

function breakWidget(chrome: PageChrome, b: Brk, hf: HfFrom) {
  const pageNo = b.page + 1
  if (b.spacer) {
    const el = document.createElement(b.block ? 'div' : 'span')
    el.className = 'hwp-pg hwp-pg-spacer hwp-pg-inline'
    el.setAttribute('data-pg', '1')
    el.contentEditable = 'false'
    el.style.height = `${b.filler + bodyBottom(chrome.page) + GAP_PX + bodyTop(chrome.page)}px`
    return el
  }
  const show = { footer: b.page >= hf.footer, header: b.page + 1 >= hf.header }
  if (b.kind === 'row') {
    const tr = document.createElement('tr')
    tr.className = 'hwp-pg-row'
    tr.setAttribute('data-pg', '1')
    tr.contentEditable = 'false'
    const td = document.createElement('td')
    td.colSpan = 999
    const inner = frame('div', chrome, { bottom: b.filler, top: true, pageNo, ...show })
    inner.style.marginLeft = `${-(ptToPx(chrome.page.left) + (b.rowOffset || 0))}px`
    td.appendChild(inner)
    tr.appendChild(td)
    return tr
  }
  const el = frame(b.kind === 'line' && !b.block ? 'span' : 'div', chrome, { bottom: b.filler, top: true, pageNo, ...show })
  if (b.kind === 'line') {
    // inside a paragraph: also step out of the paragraph's own left padding (margin/indent)
    el.classList.add('hwp-pg-inline')
    el.style.marginLeft = `${-(ptToPx(chrome.page.left) + (b.rowOffset || 0))}px`
  }
  return el
}

const HF_ALL: HfFrom = { header: 0, footer: 0 }

function buildDeco(
  state: EditorState,
  chrome: PageChrome,
  breaks: Brk[],
  pages: number,
  lastFill: number,
  floats: FloatDeco[] = [],
  hf: HfFrom = HF_ALL,
) {
  const decos: Decoration[] = [
    ...floats
      .filter((f) => f.to <= state.doc.content.size && state.doc.nodeAt(f.from))
      .map((f) => Decoration.node(f.from, f.to, { style: f.style })),
    Decoration.widget(0, () => frame('div', chrome, { top: true, pageNo: 0, header: hf.header <= 0 }), {
      side: -1,
      key: `pg-start-${chrome.page.top}-${chrome.headerHtml.length}-${hf.header <= 0}`,
      ignoreSelection: true,
    }),
  ]
  for (const b of breaks) {
    decos.push(
      Decoration.widget(b.pos, () => breakWidget(chrome, b, hf), {
        side: b.kind === 'line' ? 0 : -1,
        key: `pg-${b.kind}-${b.pos}-${Math.round(b.filler)}-${b.page}-${Math.round(b.rowOffset ?? 0)}-${b.spacer ? 's' : ''}${b.block ? 'b' : ''}-${b.page >= hf.footer}${b.page + 1 >= hf.header}`,
        ignoreSelection: true,
        marks: [],
      }),
    )
  }
  decos.push(
    Decoration.widget(state.doc.content.size, () => frame('div', chrome, { bottom: lastFill, pageNo: pages, footer: pages - 1 >= hf.footer }), {
      side: 1,
      key: `pg-end-${Math.round(lastFill)}-${pages}-${pages - 1 >= hf.footer}`,
      ignoreSelection: true,
    }),
  )
  return DecorationSet.create(state.doc, decos)
}

// ---------------------------------------------------------------------------------------------
// measuring

/** Height of an element without our page widgets inside it. */
function naturalHeight(el: HTMLElement, scale: number) {
  let h = el.getBoundingClientRect().height / scale
  el.querySelectorAll<HTMLElement>('[data-pg]').forEach((w) => {
    if (w.parentElement?.closest('[data-pg]')) return
    h -= w.getBoundingClientRect().height / scale
  })
  return h
}

interface Line {
  top: number
  bottom: number
}

/** Line boxes of a paragraph, relative to its top, with page widgets taken out. */
function paragraphLines(el: HTMLElement, scale: number): Line[] {
  const base = el.getBoundingClientRect().top
  const widgets = [...el.querySelectorAll<HTMLElement>('.hwp-pg-inline')].map((w) => {
    const r = w.getBoundingClientRect()
    return { top: r.top, h: r.height }
  })
  const range = document.createRange()
  range.selectNodeContents(el)
  const rects = [...range.getClientRects()].filter((r) => r.height > 0 && r.width >= 0)
  const lines: Line[] = []
  for (const r of rects) {
    if (widgets.some((w) => r.top >= w.top - 0.5 && r.bottom <= w.top + w.h + 0.5)) continue // widget's own boxes
    const shift = widgets.filter((w) => w.top <= r.top - 0.5).reduce((s, w) => s + w.h, 0)
    const top = (r.top - base - shift) / scale
    const bottom = (r.bottom - base - shift) / scale
    const line = lines.find((l) => Math.abs(l.top - top) < 2 || (top < l.bottom - 2 && bottom > l.top + 2))
    if (line) {
      line.top = Math.min(line.top, top)
      line.bottom = Math.max(line.bottom, bottom)
    } else lines.push({ top, bottom })
  }
  return lines.sort((a, b) => a.top - b.top)
}

function posAtLineStart(view: EditorView, el: HTMLElement, line: Line, scale: number, nodePos: number, node: PMNode) {
  const r = el.getBoundingClientRect()
  const widgets = [...el.querySelectorAll<HTMLElement>('.hwp-pg-inline')]
    .map((w) => w.getBoundingClientRect())
    .filter((w) => w.top - r.top < line.top * scale + 0.5)
  const shift = widgets.reduce((s, w) => s + w.height, 0)
  const y = r.top + line.top * scale + shift + Math.min(4, (line.bottom - line.top) * scale / 2)
  const style = getComputedStyle(el)
  const x = r.left + parseFloat(style.paddingLeft) + 1
  const hit = view.posAtCoords({ left: x, top: y })
  if (!hit) return null
  const start = nodePos + 1
  const end = nodePos + node.nodeSize - 1
  let pos = Math.max(start, Math.min(end, hit.pos))
  // posAtCoords may land just before the line's first character; step to a real line start.
  const coords = view.coordsAtPos(pos, 1)
  if (coords.top < y - (line.bottom - line.top) * scale) pos = Math.min(end, pos + 1)
  return pos > start && pos < end ? pos : null
}

/** Where a floating object goes, in px: x from the body's left edge, y from the page body top. */
function floatPos(f: FloatAttrs, page: PageSetup, anchorY: number) {
  const L = ptToPx(page.left)
  const T = bodyTop(page)
  const bodyW = ptToPx(page.width - page.left - page.right)
  const bodyH = bodyHeight(page)
  const w = ptToPx(f.width)
  const h = ptToPx(f.height)
  const hoff = ptToPx(f.horzOffset)
  const voff = ptToPx(f.vertOffset)
  const [xs, xw] = f.horzRelTo === 'PAPER' ? [-L, ptToPx(page.width)] : [0, bodyW]
  const xr = f.horzAlign === 'CENTER' ? (xw - w) / 2 + hoff : f.horzAlign === 'RIGHT' ? xw - w - hoff : hoff
  let y: number
  if (f.vertRelTo === 'PARA') y = anchorY + voff
  else {
    const [ys, yh] = f.vertRelTo === 'PAPER' ? [-T, ptToPx(page.height)] : [0, bodyH]
    const yr = f.vertAlign === 'CENTER' ? (yh - h) / 2 + voff : f.vertAlign === 'BOTTOM' ? yh - h - voff : voff
    y = ys + yr
  }
  return { x: xs + xr, y, clip: Math.max(0, ptToPx(page.height) - T - y) }
}

function measure(view: EditorView, page: PageSetup) {
  const editorEl = view.dom as HTMLElement
  const scale = editorEl.getBoundingClientRect().width / editorEl.offsetWidth || 1
  const H = bodyHeight(page)
  const breaks: Brk[] = []
  const floats: FloatDeco[] = []
  // header/footer show from the page holding their control; documents without anchors show them everywhere
  const anchored = { header: false, footer: false }
  view.state.doc.forEach((n) => {
    for (const k of (n.attrs.hf as string[] | null) || []) if (k === 'header' || k === 'footer') anchored[k] = true
  })
  const hf: HfFrom = { header: anchored.header ? Infinity : 0, footer: anchored.footer ? Infinity : 0 }
  let y = 0
  let pageIdx = 0
  const contentLeft = editorEl.getBoundingClientRect().left / scale + ptToPx(page.left)

  const newPage = (pos: number, kind: BreakKind, filler: number, extra?: Partial<Brk>) => {
    breaks.push({ pos, kind, filler: Math.max(0, filler), page: pageIdx, ...extra })
    pageIdx += 1
  }

  // floating pictures inside a paragraph: absolutely placed from their static spot
  const measureFloatingImages = (para: PMNode, paraPos: number, paraEl: HTMLElement, paraY: number) => {
    para.descendants((child, rel) => {
      if (child.type.name !== 'image' || !isOverlay(child.attrs.float)) return false
      const f = child.attrs.float as FloatAttrs
      if (f.hidden) return false
      const pos = paraPos + 1 + rel
      const img = view.nodeDOM(pos) as HTMLElement | null
      if (!img) return false
      const r = img.getBoundingClientRect()
      const cs = getComputedStyle(img)
      const staticX = (r.left / scale - parseFloat(cs.marginLeft)) - contentLeft
      const staticY = paraY + (r.top - paraEl.getBoundingClientRect().top) / scale - parseFloat(cs.marginTop)
      const p = floatPos(f, page, paraY)
      floats.push({ from: pos, to: pos + 1, style: `margin-left:${p.x - staticX}px;margin-top:${p.y - staticY}px` })
      return false
    })
  }

  view.state.doc.forEach((node, offset, index) => {
    const startBreaks = breaks.length
    const pageBefore = pageIdx
    try {
      layoutBlock(node, offset, index)
    } finally {
      const kinds = (node.attrs.hf as string[] | null) || []
      if (kinds.length) {
        const pushed = breaks.slice(startBreaks).find((b) => b.pos === offset && b.kind === 'block')
        const startPage = pushed ? pushed.page + 1 : pageBefore
        for (const k of kinds) if (k === 'header' || k === 'footer') hf[k] = Math.min(hf[k], startPage)
      }
    }
  })

  // ---- rows taller than a page ----

  interface Piece {
    pos: number // where a widget goes to push this piece to the next page
    top: number // natural px from the row top
    bottom: number
    offset: number // px from the body's left edge to the widget's containing box
    block: boolean
  }
  interface CellPieces {
    pieces: Piece[]
    bottom: number // natural content bottom (row coordinates)
  }

  /** Lines of every paragraph (and whole nested blocks) in each cell, without our widgets. */
  function rowCells(rowNode: PMNode, rowPos: number, rowEl: HTMLElement) {
    const rowTop = rowEl.getBoundingClientRect().top
    const out: CellPieces[] = []
    let widgetH = 0
    rowNode.forEach((cellNode, cellOff) => {
      const cellPos = rowPos + 1 + cellOff
      const td = view.nodeDOM(cellPos) as HTMLElement | null
      if (!td) return
      const pieces: Piece[] = []
      let bottom = 0
      // our widgets in this cell (between blocks or inside paragraphs), outermost only
      const widgets = [...td.querySelectorAll<HTMLElement>('[data-pg]')]
        .filter((w) => !w.parentElement?.closest('[data-pg]'))
        .map((w) => w.getBoundingClientRect())
      const cellWidgets = widgets.reduce((sum, w) => sum + w.height / scale, 0)
      widgetH = Math.max(widgetH, cellWidgets)
      cellNode.forEach((child, childOff) => {
        const childPos = cellPos + 1 + childOff
        const el = view.nodeDOM(childPos) as HTMLElement | null
        if (!el || !(el instanceof HTMLElement)) return
        const r = el.getBoundingClientRect()
        const above = widgets.filter((w) => w.top < r.top - 0.5).reduce((sum, w) => sum + w.height / scale, 0)
        const inside = widgets.filter((w) => w.top >= r.top - 0.5 && w.bottom <= r.bottom + 0.5).reduce((sum, w) => sum + w.height / scale, 0)
        const top = (r.top - rowTop) / scale - above
        const cs = getComputedStyle(el)
        const offset = r.left / scale + parseFloat(cs.paddingLeft || '0') - contentLeft
        const h = r.height / scale - inside
        if (child.type.name === 'paragraph') {
          const lines = child.textContent.length ? paragraphLines(el, scale) : []
          if (!lines.length) pieces.push({ pos: childPos + 1, top, bottom: top + h, offset, block: false })
          lines.forEach((ln, i) => {
            const pos = i === 0 ? childPos + 1 : posAtLineStart(view, el, ln, scale, childPos, child)
            if (pos !== null) pieces.push({ pos, top: top + ln.top, bottom: top + ln.bottom, offset, block: false })
            else if (pieces.length) pieces[pieces.length - 1].bottom = top + ln.bottom
          })
        } else {
          pieces.push({ pos: childPos, top, bottom: top + h, offset: r.left / scale - contentLeft, block: true })
        }
        bottom = Math.max(bottom, top + h + (childOff + child.nodeSize === cellNode.content.size ? parseFloat(cs.marginBottom) || 0 : 0))
      })
      const pad = parseFloat(getComputedStyle(td).paddingBottom || '0')
      out.push({ pieces, bottom: bottom + pad })
    })
    return Object.assign(out, { widgetH })
  }

  /** Breaks a tall row across pages; returns y on the page where the row ends. */
  function splitRow(cells: CellPieces[], yStart: number) {
    const origin = cells.map(() => -yStart) // natural y of the current page's top, per cell
    for (let round = 0; round < 200; round++) {
      const over = cells.map((c, i) => c.pieces.find((p) => p.bottom - origin[i] > H + 0.5 && p.top - origin[i] > 0.5) ?? null)
      if (!over.some(Boolean)) break
      let drawn = false
      const page = pageIdx
      over.forEach((p, i) => {
        if (!p) {
          origin[i] += H
          return
        }
        const filler = H - (p.top - origin[i])
        if (!drawn) {
          breaks.push({ pos: p.pos, kind: 'line', filler: Math.max(0, filler), page, rowOffset: p.offset, block: p.block })
          drawn = true
        } else {
          breaks.push({ pos: p.pos, kind: 'line', filler: Math.max(0, filler), page, spacer: true, block: p.block })
        }
        origin[i] = p.top
      })
      pageIdx += 1
    }
    return Math.max(0, ...cells.map((c, i) => c.bottom - origin[i]))
  }

  function layoutBlock(node: PMNode, offset: number, index: number) {
    const el = view.nodeDOM(offset) as HTMLElement | null
    if (!el || !(el instanceof HTMLElement)) return
    const domBlock = (node.type.name === 'table' ? el.querySelector('table') ?? el : el) as HTMLElement
    const fl = node.type.name === 'table' ? (node.attrs.float as FloatAttrs | null) : null
    if (fl?.hidden) return
    if (fl && isOverlay(fl)) {
      // drawn over the page from its anchor; takes no room in the flow
      const p = floatPos(fl, page, y)
      floats.push({ from: offset, to: offset + node.nodeSize, style: `margin-left:${p.x}px;margin-top:${p.y - y}px;max-height:${p.clip}px` })
      return
    }
    let h = naturalHeight(el, scale)
    let mt = 0
    let mb = 0
    if (node.type.name === 'paragraph') {
      const cs = getComputedStyle(el)
      mt = parseFloat(cs.marginTop) || 0
      mb = parseFloat(cs.marginBottom) || 0
    }
    // spacing after a paragraph's last line may run past the page end (Hangul fits text, not leading)
    const slack = node.type.name === 'paragraph' ? Math.max(0, 2 * mb) : 0
    if (fl) {
      const p = floatPos(fl, page, y)
      const mt = fl.vertRelTo === 'PARA' ? Math.max(0, ptToPx(fl.vertOffset)) : 0
      floats.push({ from: offset, to: offset + node.nodeSize, style: `margin-left:${Math.max(-ptToPx(page.left), p.x)}px;margin-top:${mt}px` })
      h += mt
    }
    if (node.type.name === 'paragraph') measureFloatingImages(node, offset, el, y)

    if (index > 0 && node.type.name === 'paragraph' && node.attrs.pageBreak) {
      newPage(offset, 'block', H - y)
      y = 0
    }
    if (y + mt + h + mb - slack <= H + 0.5) {
      y += mt + h + mb
      return
    }

    if (node.type.name === 'table') {
      // split between rows
      const rows = [...domBlock.querySelectorAll<HTMLTableRowElement>(':scope > tbody > tr:not([data-pg])')]
      const rowsH = rows.reduce((s, r) => s + r.getBoundingClientRect().height / scale, 0)
      const lead = Math.max(0, h - rowsH)
      const tableLeft = domBlock.getBoundingClientRect().left / scale - contentLeft
      let rowStart = offset + 1
      let first = true
      if (y > 0 && rows.length && y + lead + rows[0].getBoundingClientRect().height / scale > H) {
        newPage(offset, 'block', H - y)
        y = 0
      }
      y += lead
      node.forEach((rowNode, rowOff, ri) => {
        const rowEl = rows[ri]
        const pos = rowStart + rowOff
        if (!rowEl) return
        const cells = rowCells(rowNode, pos, rowEl)
        // natural row height: the tallest cell's content (the row box itself is stretched by widgets)
        const rh = cells.widgetH > 0 ? Math.max(0, ...cells.map((c) => c.bottom)) : rowEl.getBoundingClientRect().height / scale
        if (y + rh > H + 0.5 && rh > H + 0.5) {
          // taller than a whole page: split inside the cells, like Hangul does
          y = splitRow(cells, y)
        } else {
          if (!first && y + rh > H + 0.5 && y > 0) {
            newPage(pos, 'row', H - y, { rowOffset: tableLeft })
            y = 0
          }
          y += rh
        }
        first = false
      })
      return
    }

    if (node.type.name === 'paragraph' && node.textContent.length > 0) {
      const lines = paragraphLines(el, scale)
      if (lines.length > 1) {
        let topOnPage = y + mt // where the paragraph's box top sits on the current page
        let firstOnPage = y === 0
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          if (topOnPage + line.bottom > H + 0.5 && !firstOnPage) {
            if (i === 0) {
              newPage(offset, 'block', H - y)
              topOnPage = mt
            } else {
              const pos = posAtLineStart(view, el, line, scale, offset, node)
              if (pos === null) break
              newPage(pos, 'line', H - (topOnPage + line.top), {
                rowOffset: el.getBoundingClientRect().left / scale + (parseFloat(getComputedStyle(el).paddingLeft) || 0) - contentLeft,
              })
              topOnPage = -line.top
            }
          }
          firstOnPage = false
        }
        y = topOnPage + h + mb
        return
      }
    }

    if (y > 0) {
      newPage(offset, 'block', H - y)
      y = 0
    }
    y += mt + h + mb
    // a single block taller than a page keeps flowing past the page end
    while (y > H) y -= H
  }

  return { breaks, floats, hf, pages: pageIdx + 1, lastFill: Math.max(0, H - y) }
}

// ---------------------------------------------------------------------------------------------
// extension

export interface PaginationOptions {
  getChrome: () => PageChrome
  onPages?: (pages: number) => void
}

export const Pagination = Extension.create<PaginationOptions>({
  name: 'hwpPagination',
  addOptions() {
    return { getChrome: () => ({ page: null as unknown as PageSetup, headerHtml: '', footerHtml: '', pageNumber: null }), onPages: undefined }
  },
  addProseMirrorPlugins() {
    const options = this.options
    let frameReq = 0
    let lastChrome: PageChrome | null = null

    const plugin: Plugin<PagState> = new Plugin<PagState>({
      key: paginationKey,
      state: {
        init: (_, state) => ({ breaks: [], floats: [], hf: HF_ALL, pages: 1, lastFill: 0, deco: buildDeco(state, options.getChrome(), [], 1, 0) }),
        apply(tr, value, _old, state) {
          const meta = tr.getMeta(paginationKey) as (Omit<PagState, 'deco'> & { force?: boolean }) | undefined
          if (meta) return { ...meta, deco: buildDeco(state, options.getChrome(), meta.breaks, meta.pages, meta.lastFill, meta.floats, meta.hf) }
          if (!tr.docChanged) return value
          // keep current spacers (mapped) until the next measurement replaces them
          const breaks = value.breaks
            .map((b) => ({ ...b, pos: tr.mapping.map(b.pos, b.kind === 'line' ? 1 : -1) }))
            .filter((b) => b.pos > 0 && b.pos < state.doc.content.size)
          const floats = value.floats
            .map((f) => ({ ...f, from: tr.mapping.map(f.from), to: tr.mapping.map(f.to, -1) }))
            .filter((f) => f.to > f.from)
          return { ...value, breaks, floats, deco: buildDeco(state, options.getChrome(), breaks, value.pages, value.lastFill, floats, value.hf) }
        },
      },
      props: {
        decorations: (state) => plugin.getState(state)?.deco,
      },
      view(view) {
        // Animation frames can stop while the window is hidden or covered (layout still works),
        // so whichever comes first - the next frame or a short timer - runs the measurement.
        let timer = 0
        const cancel = () => {
          cancelAnimationFrame(frameReq)
          window.clearTimeout(timer)
        }
        const nextFrame = (fn: () => void) => {
          let done = false
          const run = () => {
            if (done) return
            done = true
            cancel()
            fn()
          }
          timer = window.setTimeout(run, 150)
          return requestAnimationFrame(run)
        }
        const schedule = () => {
          cancel()
          frameReq = nextFrame(() => {
            if (!view.dom.isConnected) return
            const chrome = options.getChrome()
            if (!chrome.page) return
            const current = plugin.getState(view.state)!
            const result = measure(view, chrome.page)
            const chromeChanged = chrome !== lastChrome
            lastChrome = chrome
            if (
              !chromeChanged &&
              sameBreaks(result.breaks, current.breaks) &&
              result.hf.header === current.hf.header &&
              result.hf.footer === current.hf.footer &&
              result.floats.length === current.floats.length &&
              result.floats.every((f, i) => f.from === current.floats[i].from && f.style === current.floats[i].style) &&
              result.pages === current.pages &&
              Math.abs(result.lastFill - current.lastFill) < 0.5
            ) {
              options.onPages?.(result.pages)
              return
            }
            view.dispatch(view.state.tr.setMeta(paginationKey, result).setMeta('addToHistory', false))
            options.onPages?.(result.pages)
          })
        }
        const onLoad = (e: Event) => {
          if ((e.target as HTMLElement)?.tagName === 'IMG') schedule()
        }
        view.dom.addEventListener('load', onLoad, true)
        const ro = new ResizeObserver(schedule)
        ro.observe(view.dom)
        document.fonts?.addEventListener?.('loadingdone', schedule)
        ;(view.dom as HTMLElement & { _hwpRepaginate?: () => void })._hwpRepaginate = schedule
        schedule()
        return {
          update(v, prev) {
            if (v.state.doc !== prev.doc || plugin.getState(v.state) !== plugin.getState(prev)) schedule()
          },
          destroy() {
            cancel()
            view.dom.removeEventListener('load', onLoad, true)
            ro.disconnect()
            document.fonts?.removeEventListener?.('loadingdone', schedule)
          },
        }
      },
    })
    return [plugin]
  },
})

export function repaginate(view: EditorView) {
  ;(view.dom as HTMLElement & { _hwpRepaginate?: () => void })._hwpRepaginate?.()
}

/** Page index (1-based) that contains a document position. */
export function pageOfPos(state: EditorState, pos: number) {
  const s = paginationKey.getState(state)
  if (!s) return 1
  let page = 1
  for (const b of s.breaks) if (b.pos <= pos) page = b.page + 2
  return page
}

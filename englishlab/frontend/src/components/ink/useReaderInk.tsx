import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Highlight, Stroke } from '@/api/types'
import { getInk, putInk } from '@/api/plan'
import { HL_SIZES, PEN_SIZES, distanceTo, hlColor, isDark, penColor, pushHistory, strokeLength, strokePath, uid, useInkTool, usePenInput, type InkPoint } from '@/lib/ink'

type Box = { top: number; left: number; width: number }
type Anchor = { left: number; top: number; h: number }
type Doc = { strokes: Stroke[]; highlights: Highlight[] }

/** Words under a stroke: inside a word's box (with some room for underlines), or — for a closed loop
 *  drawn around words — word centres inside the loop. → [paragraph, wordIndex][] in reading order. */
export function wordsUnder(root: HTMLElement, pts: InkPoint[]): [number, number][] {
  if (!pts.length) return []
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const bb = { l: Math.min(...xs) - 12, r: Math.max(...xs) + 12, t: Math.min(...ys) - 16, b: Math.max(...ys) + 12 }
  const span = Math.max(bb.r - bb.l, bb.b - bb.t)
  const closed = pts.length > 8 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < Math.max(28, span * 0.35)
  const inside = (x: number, y: number) => {
    let hit = false
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i]
      const b = pts[j]
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit
    }
    return hit
  }
  const out: [number, number][] = []
  root.querySelectorAll<HTMLElement>('[data-p]').forEach((pEl) => {
    const pr = pEl.getBoundingClientRect()
    if (pr.bottom < bb.t || pr.top > bb.b) return
    const p = Number(pEl.dataset.p)
    pEl.querySelectorAll<HTMLElement>('span[data-wi]').forEach((w) => {
      const r = w.getBoundingClientRect()
      if (r.right < bb.l || r.left > bb.r || r.bottom < bb.t || r.top > bb.b) return
      // A loop selects the words whose centre it encloses (its outline may brush the neighbours);
      // a line selects the words it passes over or underlines.
      const hit = closed
        ? inside(r.left + r.width / 2, r.top + r.height / 2)
        : pts.some((q) => q.x >= r.left - 1 && q.x <= r.right + 1 && q.y >= r.top - 3 && q.y <= r.bottom + 9)
      if (hit) out.push([p, Number(w.dataset.wi)])
    })
  })
  return out
}

function toRanges(words: [number, number][], c: number): Highlight[] {
  const byP = new Map<number, number[]>()
  for (const [p, w] of words) byP.set(p, [...(byP.get(p) ?? []), w])
  const out: Highlight[] = []
  for (const [p, list] of byP) {
    const sorted = [...new Set(list)].sort((a, b) => a - b)
    let a = sorted[0]
    let prev = a
    for (const w of sorted.slice(1)) {
      if (w !== prev + 1) {
        out.push({ p, a, b: prev, c })
        a = w
      }
      prev = w
    }
    out.push({ p, a, b: prev, c })
  }
  return out
}

/** Pen annotations on a reading: free strokes anchored to the nearest word (so an underline or a circle
 *  follows its word when the page reflows — rotating the tablet, a new font size), highlighter strokes
 *  turned into word highlights, the lookup pen, and the eraser. */
export function useReaderInk({
  readingId,
  wrap,
  ready,
  onLookup,
}: {
  readingId: number
  wrap: React.RefObject<HTMLDivElement | null>
  ready: boolean // the text is on screen (the wrapper is mounted)
  onLookup: (words: [number, number][]) => void
}) {
  const [doc, setDoc] = useState<Doc>({ strokes: [], highlights: [] })
  const [loaded, setLoaded] = useState(false)
  const [live, setLive] = useState<Stroke | null>(null)
  const [boxes, setBoxes] = useState<Box[]>([])
  const [anchors, setAnchors] = useState<Record<string, Anchor>>({})
  const { tool, handDraws } = useInkTool()
  const hist = useRef<{ past: Doc[]; future: Doc[] }>({ past: [], future: [] })
  const cur = useRef<{ tool: string; erase: boolean; pts: InkPoint[]; stroke: Stroke | null; before: Doc | null; startAt: InkPoint | null }>({
    tool: 'none', erase: false, pts: [], stroke: null, before: null, startAt: null,
  })
  const docRef = useRef(doc)
  docRef.current = doc
  const saveTimer = useRef<number | undefined>(undefined)
  const lastTap = useRef(0)

  useEffect(() => {
    let live = true
    getInk('reading', readingId)
      .then((d) => {
        if (!live) return
        setDoc({ strokes: d.strokes ?? [], highlights: d.highlights ?? [] })
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
    return () => {
      live = false
    }
  }, [readingId])

  const save = useCallback(
    (d: Doc) => {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = undefined
        void putInk('reading', readingId, { ...d, height: 0 })
      }, 1000)
    },
    [readingId],
  )
  useEffect(
    () => () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current)
        void putInk('reading', readingId, { ...docRef.current, height: 0 })
      }
    },
    [readingId],
  )

  const commit = useCallback(
    (next: Doc, prev: Doc) => {
      pushHistory(hist.current, prev)
      setDoc(next)
      save(next)
    },
    [save],
  )

  // Paragraph boxes and the boxes of the words strokes are anchored to, relative to the wrapper.
  const measure = useCallback(() => {
    const w = wrap.current
    if (!w) return
    const wr = w.getBoundingClientRect()
    const list: Box[] = []
    w.querySelectorAll<HTMLElement>('[data-p]').forEach((el) => {
      const r = el.getBoundingClientRect()
      list[Number(el.dataset.p)] = { top: r.top - wr.top, left: r.left - wr.left, width: r.width }
    })
    const found: Record<string, Anchor> = {}
    for (const st of docRef.current.strokes) {
      if (st.wi == null) continue
      const key = `${st.p}:${st.wi}`
      const el = w.querySelector<HTMLElement>(`[data-p="${st.p}"] span[data-wi="${st.wi}"]`)
      if (!el || found[key]) continue
      const r = el.getBoundingClientRect()
      found[key] = { left: r.left - wr.left, top: r.top - wr.top, h: r.height }
    }
    setBoxes(list)
    setAnchors(found)
  }, [wrap])
  useLayoutEffect(() => {
    measure()
    const w = wrap.current
    if (!w) return
    const ro = new ResizeObserver(() => measure())
    ro.observe(w)
    return () => ro.disconnect()
  }, [measure, wrap, loaded, ready])
  useLayoutEffect(() => measure(), [doc.strokes, measure])

  /** Where a stroke's own coordinates start, and how much to scale them, in the current layout. */
  const frame = (st: Stroke): { x0: number; y0: number; k: number } | null => {
    if (st.wi != null) {
      const a = anchors[`${st.p}:${st.wi}`]
      return a ? { x0: a.left, y0: a.top, k: a.h / (st.h || a.h) } : null
    }
    const b = boxes[st.p ?? 0]
    return b ? { x0: b.left, y0: b.top, k: b.width / (st.w || b.width) } : null
  }

  const relPoint = (p: InkPoint): [number, number, number] => {
    const wr = wrap.current!.getBoundingClientRect()
    return [Math.round((p.x - wr.left) * 10) / 10, Math.round((p.y - wr.top) * 10) / 10, Math.round(p.p * 100) / 100]
  }

  const eraseAt = (p: InkPoint) => {
    const w = wrap.current
    if (!w) return
    const wr = w.getBoundingClientRect()
    const d = docRef.current
    const x = p.x - wr.left
    const y = p.y - wr.top
    const strokes = d.strokes.filter((s) => {
      const f = frame(s)
      if (!f) return true
      return distanceTo(s, (x - f.x0) / f.k, (y - f.y0) / f.k) > 14 / f.k + s.size / 2
    })
    const hits = wordsUnder(w, [p])
    const highlights = hits.length ? d.highlights.filter((h) => !hits.some(([hp, hw]) => hp === h.p && hw >= h.a && hw <= h.b)) : d.highlights
    if (strokes.length !== d.strokes.length || highlights.length !== d.highlights.length) {
      const next = { strokes, highlights }
      docRef.current = next
      setDoc(next)
    }
  }

  usePenInput(
    wrap,
    {
      start: (p, ctx) => {
        const t = useInkTool.getState().tool
        if (t === 'none' && !ctx.erase) return false
        const erase = ctx.erase || t === 'eraser'
        cur.current = { tool: erase ? 'eraser' : t, erase, pts: [p], stroke: null, before: docRef.current, startAt: p }
        if (erase) {
          eraseAt(p)
          return
        }
        const st = useInkTool.getState()
        const stroke: Stroke = {
          id: uid(),
          tool: t === 'hl' ? 'hl' : 'pen',
          color: t === 'lookup' ? 2 : st.color,
          size: t === 'hl' ? HL_SIZES[st.size] : t === 'lookup' ? 2 : PEN_SIZES[st.size],
          pts: [relPoint(p)],
        }
        cur.current.stroke = stroke
        setLive(stroke)
      },
      move: (pts) => {
        const c = cur.current
        c.pts.push(...pts)
        if (c.erase) {
          pts.forEach(eraseAt)
          return
        }
        if (!c.stroke) return
        c.stroke.pts.push(...pts.map(relPoint))
        setLive({ ...c.stroke, pts: [...c.stroke.pts] })
      },
      end: ({ durationMs, cancelled }) => {
        const c = cur.current
        cur.current = { tool: 'none', erase: false, pts: [], stroke: null, before: null, startAt: null }
        setLive(null)
        const w = wrap.current
        if (!w || cancelled) return
        if (c.erase) {
          if (c.before && c.before !== docRef.current) commit(docRef.current, c.before)
          return
        }
        const s = c.stroke
        if (!s) return
        const tap = strokeLength(s.pts) < 8 && durationMs < 400
        if (tap || c.tool === 'lookup') {
          // A pen tap (any tool) or a lookup stroke looks up the word(s) under it.
          const words = tap ? wordsUnder(w, [c.startAt!]) : wordsUnder(w, c.pts)
          if (words.length) {
            lastTap.current = Date.now()
            onLookup(words.slice(0, 8))
          }
          return
        }
        if (c.tool === 'hl') {
          const words = wordsUnder(w, c.pts)
          if (!words.length) return
          const ranges = toRanges(words, s.color)
          const d = docRef.current
          // Replace overlapping highlights with the new colour.
          const keep = d.highlights.filter((h) => !ranges.some((r) => r.p === h.p && r.a <= h.b && h.a <= r.b))
          commit({ ...d, highlights: [...keep, ...ranges] }, d)
          return
        }
        // Free pen stroke: anchor it to the word nearest to its middle.
        const wr = w.getBoundingClientRect()
        const xs = c.pts.map((q) => q.x)
        const ys = c.pts.map((q) => q.y)
        const mx = (Math.min(...xs) + Math.max(...xs)) / 2
        const my = (Math.min(...ys) + Math.max(...ys)) / 2
        let best: HTMLElement | null = null
        let bestD = Infinity
        w.querySelectorAll<HTMLElement>('span[data-wi]').forEach((el) => {
          const r = el.getBoundingClientRect()
          const dx = Math.max(r.left - mx, 0, mx - r.right)
          const dy = Math.max(r.top - my, 0, my - r.bottom)
          const dist = Math.hypot(dx, dy * 1.5)
          if (dist < bestD) {
            bestD = dist
            best = el
          }
        })
        const el = best as HTMLElement | null
        if (!el) return
        const r = el.getBoundingClientRect()
        const ax = r.left - wr.left
        const ay = r.top - wr.top
        const pIndex = Number(el.closest<HTMLElement>('[data-p]')?.dataset.p ?? 0)
        const anchored: Stroke = {
          ...s,
          p: pIndex,
          wi: Number(el.dataset.wi),
          h: Math.round(r.height * 10) / 10,
          pts: s.pts.map(([x, y, pr]) => [Math.round((x - ax) * 10) / 10, Math.round((y - ay) * 10) / 10, pr]),
        }
        commit({ ...docRef.current, strokes: [...docRef.current.strokes, anchored] }, docRef.current)
      },
    },
    { enabled: true, handDraws },
  )

  const undo = () => {
    const prev = hist.current.past.pop()
    if (!prev) return
    hist.current.future.push(docRef.current)
    setDoc(prev)
    save(prev)
  }
  const redo = () => {
    const next = hist.current.future.pop()
    if (!next) return
    hist.current.past.push(docRef.current)
    setDoc(next)
    save(next)
  }
  const clear = () => {
    const d = docRef.current
    if ((!d.strokes.length && !d.highlights.length) || !confirm('이 글의 필기와 형광펜을 모두 지울까요? (되돌리기로 복구할 수 있어요)')) return
    commit({ strokes: [], highlights: [] }, d)
  }

  /** paragraph → word index → highlight colour */
  const marks = useMemo(() => {
    const m = new Map<number, Map<number, number>>()
    for (const h of doc.highlights) {
      const pm = m.get(h.p) ?? new Map<number, number>()
      for (let i = h.a; i <= h.b; i++) pm.set(i, h.c)
      m.set(h.p, pm)
    }
    return m
  }, [doc.highlights])

  const dark = isDark()
  const overlay = (
    <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden>
      {doc.strokes.map((s) => {
        const f = frame(s)
        if (!f) return null
        return (
          <g key={s.id} transform={`translate(${f.x0} ${f.y0}) scale(${f.k})`}>
            <path d={strokePath(s)} fill={penColor(s.color, dark)} />
          </g>
        )
      })}
      {live && (
        <path
          d={strokePath(live, false)}
          fill={live.tool === 'hl' ? hlColor(live.color, dark) : penColor(live.color, dark)}
          opacity={live.tool === 'hl' ? 0.45 : cur.current.tool === 'lookup' ? 0.6 : 1}
        />
      )}
    </svg>
  )

  return {
    overlay,
    marks,
    tool,
    drawing: tool !== 'none',
    /** true right after a pen tap handled a lookup (so the word's click handler doesn't open it twice) */
    justTapped: () => Date.now() - lastTap.current < 500,
    undo,
    redo,
    clear,
    canUndo: hist.current.past.length > 0,
    canRedo: hist.current.future.length > 0,
    count: doc.strokes.length + doc.highlights.length,
    remeasure: measure,
  }
}

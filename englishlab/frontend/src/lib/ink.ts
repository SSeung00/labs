import { useEffect, useRef } from 'react'
import { getStroke } from 'perfect-freehand'
import { create } from 'zustand'
import type { Stroke } from '@/api/types'

// ---------- tool state (shared by every pen surface, remembered per device) ----------

export type InkTool = 'pen' | 'hl' | 'eraser' | 'lookup' | 'none'

interface ToolState {
  tool: InkTool
  color: number
  size: number // 0 thin, 1 medium, 2 thick
  handDraws: boolean // mouse and finger draw too (devices without a pen)
  set: (s: Partial<Pick<ToolState, 'tool' | 'color' | 'size' | 'handDraws'>>) => void
}

const KEY = 'englishlab-ink'

function load(): Partial<ToolState> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    return {}
  }
}

export const useInkTool = create<ToolState>((set, get) => ({
  tool: 'none',
  color: 0,
  size: 1,
  handDraws: false,
  ...load(),
  set: (s) => {
    set(s)
    const { tool, color, size, handDraws } = { ...get(), ...s }
    try {
      localStorage.setItem(KEY, JSON.stringify({ tool, color, size, handDraws }))
    } catch {
      /* storage unavailable */
    }
  },
}))

// ---------- colours & stroke geometry ----------

export const PEN_COLORS = { light: ['#1f2328', '#d1242f', '#0969da', '#1a7f37'], dark: ['#e6edf3', '#ff7b72', '#58a6ff', '#56d364'] }
export const HL_COLORS = { light: ['#ffd33d', '#7ee2a8', '#ff9ec4', '#8ec5ff'], dark: ['#bb8009', '#2ea043', '#bf4b8a', '#1f6feb'] }
export const PEN_SIZES = [2.2, 3.6, 6]
export const HL_SIZES = [14, 20, 28]

export const isDark = () => document.documentElement.classList.contains('dark')
export const penColor = (c: number, dark = isDark()) => (dark ? PEN_COLORS.dark : PEN_COLORS.light)[c] ?? PEN_COLORS.light[0]
export const hlColor = (c: number, dark = isDark()) => (dark ? HL_COLORS.dark : HL_COLORS.light)[c] ?? HL_COLORS.light[0]

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

function pathFromOutline(points: number[][]): string {
  if (points.length < 2) return ''
  const d: (string | number)[] = ['M', points[0][0].toFixed(1), points[0][1].toFixed(1), 'Q']
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i]
    const [x1, y1] = points[(i + 1) % points.length]
    d.push(x0.toFixed(1), y0.toFixed(1), ((x0 + x1) / 2).toFixed(1), ((y0 + y1) / 2).toFixed(1))
  }
  d.push('Z')
  return d.join(' ')
}

/** Filled outline path of a stroke (pressure-sensitive for a pen, even width for the highlighter). */
export function strokePath(s: Pick<Stroke, 'pts' | 'tool' | 'size'>, done = true): string {
  const hasPressure = s.pts.some((p) => p[2] !== 0.5 && p[2] > 0)
  const outline = getStroke(s.pts, {
    size: s.size,
    thinning: s.tool === 'hl' ? 0 : 0.62,
    smoothing: 0.5,
    streamline: s.tool === 'hl' ? 0.6 : 0.42,
    simulatePressure: s.tool !== 'hl' && !hasPressure,
    last: done,
    start: { cap: true },
    end: { cap: true },
  })
  return pathFromOutline(outline)
}

/** Shortest distance from (x, y) to a stroke's points (in the stroke's own units). */
export function distanceTo(s: Stroke, x: number, y: number): number {
  let best = Infinity
  for (let i = 0; i < s.pts.length; i++) {
    const [ax, ay] = s.pts[i]
    const [bx, by] = s.pts[Math.min(i + 1, s.pts.length - 1)]
    const dx = bx - ax
    const dy = by - ay
    const t = dx || dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)))
  }
  return best
}

export function strokeLength(pts: [number, number, number][]): number {
  let n = 0
  for (let i = 1; i < pts.length; i++) n += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  return n
}

/** Note pages → PNG (white paper, dark ink, cropped to the writing) for the AI to read. */
export async function strokesToPng(strokes: Stroke[], pageWidth = 1000): Promise<Blob | null> {
  if (!strokes.length) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const s of strokes)
    for (const [x, y] of s.pts) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  const pad = 30
  minX = Math.max(0, minX - pad)
  minY = Math.max(0, minY - pad)
  maxX = Math.min(pageWidth, maxX + pad)
  maxY += pad
  const scale = Math.min(1.6, 1600 / Math.max(1, maxX - minX))
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil((maxX - minX) * scale)
  canvas.height = Math.min(8000, Math.ceil((maxY - minY) * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(scale, 0, 0, scale, -minX * scale, -minY * scale)
  for (const s of strokes) {
    ctx.fillStyle = s.tool === 'hl' ? 'rgba(255, 211, 61, 0.45)' : penColor(s.color, false)
    ctx.fill(new Path2D(strokePath(s)))
  }
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'))
}

// ---------- pen input ----------

export interface InkPoint {
  x: number // client coordinates
  y: number
  p: number
}

export interface PenHandlers {
  /** A drawing pointer went down; return false to let the page handle it (e.g. finger scrolling). */
  start: (pt: InkPoint, ctx: { erase: boolean; pointerType: string; target: EventTarget | null }) => boolean | void
  move: (pts: InkPoint[]) => void
  end: (ctx: { cancelled: boolean; durationMs: number }) => void
}

/** Pointer handling for a pen surface.
 *  - A pen always draws; mouse and finger only when `handDraws` is on, and never once a pen was seen
 *    (palm rejection: the hand resting on the screen while writing).
 *  - The pen's eraser end or barrel button erases.
 *  - Scrolling with the pen is blocked (touchstart is cancelled right after a pen pointerdown) while
 *    finger scrolling keeps working. */
export function usePenInput(ref: React.RefObject<HTMLElement | null>, handlers: PenHandlers, opts: { enabled: boolean; handDraws: boolean }) {
  const h = useRef(handlers)
  const o = useRef(opts)
  h.current = handlers
  o.current = opts
  const attached = useRef<{ el: HTMLElement; detach: () => void } | null>(null)
  // The surface may mount after the first render (e.g. once its data has loaded): re-check every render
  // and (re)attach when the element changes.
  useEffect(() => {
    const el = ref.current
    if (attached.current?.el === el) return
    attached.current?.detach()
    attached.current = null
    if (!el) return
    let active: number | null = null
    let startedAt = 0
    let penAt = 0
    let penSeen = false
    const pt = (e: PointerEvent): InkPoint => ({ x: e.clientX, y: e.clientY, p: e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5 })

    const down = (e: PointerEvent) => {
      if (!o.current.enabled || active !== null) return
      if (e.pointerType === 'pen') {
        penAt = Date.now()
        penSeen = true
      } else if (!o.current.handDraws || (e.pointerType === 'touch' && penSeen) || (e.pointerType === 'mouse' && e.button !== 0)) {
        return
      }
      const erase = e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0 || (e.buttons & 2) !== 0)
      if (h.current.start(pt(e), { erase, pointerType: e.pointerType, target: e.target }) === false) return
      active = e.pointerId
      startedAt = Date.now()
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* pointer already gone */
      }
      e.preventDefault()
    }
    const move = (e: PointerEvent) => {
      if (e.pointerId !== active) return
      const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
      h.current.move((list.length ? list : [e]).map(pt))
      e.preventDefault()
    }
    const finish = (cancelled: boolean) => (e: PointerEvent) => {
      if (e.pointerId !== active) return
      active = null
      try {
        el.releasePointerCapture(e.pointerId)
      } catch {
        /* not captured */
      }
      h.current.end({ cancelled, durationMs: Date.now() - startedAt })
    }
    const up = finish(false)
    const cancel = finish(true)
    // Pointer events fire before the touch events of the same contact: cancel the touch for a pen so the
    // page doesn't scroll (or select text) under the stroke.
    const touchstart = (e: TouchEvent) => {
      if (Date.now() - penAt < 80 && active !== null) e.preventDefault()
    }
    const touchmove = (e: TouchEvent) => {
      if (active !== null) e.preventDefault()
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', cancel)
    el.addEventListener('touchstart', touchstart, { passive: false })
    el.addEventListener('touchmove', touchmove, { passive: false })
    attached.current = {
      el,
      detach: () => {
        el.removeEventListener('pointerdown', down)
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
        el.removeEventListener('pointercancel', cancel)
        el.removeEventListener('touchstart', touchstart)
        el.removeEventListener('touchmove', touchmove)
      },
    }
  })
  useEffect(
    () => () => {
      attached.current?.detach()
      attached.current = null
    },
    [],
  )
}

/** Undo/redo history of an ink document. */
export function pushHistory<T>(hist: { past: T[]; future: T[] }, prev: T, limit = 60) {
  hist.past.push(prev)
  if (hist.past.length > limit) hist.past.shift()
  hist.future.length = 0
}

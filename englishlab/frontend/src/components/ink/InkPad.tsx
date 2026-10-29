import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Stroke } from '@/api/types'
import { HL_SIZES, PEN_SIZES, distanceTo, hlColor, penColor, pushHistory, strokePath, uid, useInkTool, usePenInput, type InkPoint } from '@/lib/ink'
import { useTheme } from '@/stores/theme'
import { cn } from '@/lib/utils'
import { InkToolbar } from './InkToolbar'

export const PAGE_W = 1000
const GROW = 700

function StrokeShape({ s, dark }: { s: Stroke; dark: boolean }) {
  const d = useMemo(() => strokePath(s), [s])
  return s.tool === 'hl' ? (
    <path d={d} fill={hlColor(s.color, dark)} opacity={dark ? 0.55 : 0.45} style={{ mixBlendMode: dark ? 'screen' : 'multiply' }} />
  ) : (
    <path d={d} fill={penColor(s.color, dark)} />
  )
}

/** Read-only page (note thumbnails), cropped to the written part. */
export function InkPreview({ strokes, className }: { strokes: Stroke[]; className?: string }) {
  const { pref } = useTheme()
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  const maxY = strokes.reduce((m, s) => Math.max(m, ...s.pts.map((p) => p[1])), 0)
  const h = Math.max(400, Math.min(maxY + 40, 1600))
  return (
    <svg viewBox={`0 0 ${PAGE_W} ${h}`} className={className} preserveAspectRatio="xMidYMin slice" aria-hidden>
      {strokes.map((s) => (
        <StrokeShape key={s.id} s={s} dark={dark} />
      ))}
    </svg>
  )
}

/** A handwritten page: pen, highlighter, eraser; grows as you write near the bottom. Saves itself
 *  (debounced) through `onSave`. */
export function InkPad({
  initial,
  initialHeight = 1400,
  onSave,
  onStrokes,
  ruled = true,
  className,
  toolbarClassName,
}: {
  initial: Stroke[]
  initialHeight?: number
  onSave?: (doc: { strokes: Stroke[]; height: number }) => void
  onStrokes?: (strokes: Stroke[]) => void
  ruled?: boolean
  className?: string
  toolbarClassName?: string
}) {
  const [strokes, setStrokes] = useState<Stroke[]>(initial)
  const [height, setHeight] = useState(Math.max(initialHeight, 900))
  const [live, setLive] = useState<Stroke | null>(null)
  const { tool, handDraws } = useInkTool()
  const { pref } = useTheme()
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  const box = useRef<HTMLDivElement>(null)
  const cur = useRef<{ stroke: Stroke | null; erase: boolean; before: Stroke[] | null }>({ stroke: null, erase: false, before: null })
  const hist = useRef<{ past: Stroke[][]; future: Stroke[][] }>({ past: [], future: [] })
  const [, force] = useState(0)
  const saveTimer = useRef<number | undefined>(undefined)
  const state = useRef({ strokes, height })
  state.current = { strokes, height }

  const commit = useCallback(
    (next: Stroke[], prev: Stroke[], nextHeight?: number) => {
      pushHistory(hist.current, prev)
      setStrokes(next)
      if (nextHeight) setHeight(nextHeight)
      onStrokes?.(next)
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => onSave?.({ strokes: next, height: nextHeight ?? state.current.height }), 900)
    },
    [onSave, onStrokes],
  )
  // Save whatever is pending when leaving the page.
  useEffect(
    () => () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current)
        onSave?.(state.current)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const toPage = (p: InkPoint): [number, number, number] => {
    const r = box.current!.getBoundingClientRect()
    const k = PAGE_W / r.width
    return [Math.round((p.x - r.left) * k * 10) / 10, Math.round((p.y - r.top) * k * 10) / 10, Math.round(p.p * 100) / 100]
  }
  const unit = () => PAGE_W / (box.current?.getBoundingClientRect().width || PAGE_W)

  const eraseAt = (pt: [number, number, number]) => {
    const radius = 12 * unit()
    const list = state.current.strokes
    const keep = list.filter((s) => distanceTo(s, pt[0], pt[1]) > radius + s.size / 2)
    if (keep.length !== list.length) {
      setStrokes(keep)
      state.current.strokes = keep
    }
  }

  usePenInput(
    box,
    {
      start: (p, ctx) => {
        const t = useInkTool.getState().tool
        if (t === 'none' && !ctx.erase && ctx.pointerType !== 'pen') return false
        const pt = toPage(p)
        const erase = ctx.erase || t === 'eraser'
        cur.current = { stroke: null, erase, before: state.current.strokes }
        if (erase) {
          eraseAt(pt)
          return
        }
        const hl = t === 'hl'
        const st = useInkTool.getState()
        cur.current.stroke = { id: uid(), tool: hl ? 'hl' : 'pen', color: st.color, size: Math.round((hl ? HL_SIZES : PEN_SIZES)[st.size] * unit() * 10) / 10, pts: [pt] }
        setLive({ ...cur.current.stroke })
      },
      move: (pts) => {
        const c = cur.current
        if (c.erase) {
          pts.forEach((p) => eraseAt(toPage(p)))
          return
        }
        if (!c.stroke) return
        c.stroke.pts.push(...pts.map(toPage))
        setLive({ ...c.stroke, pts: [...c.stroke.pts] })
      },
      end: () => {
        const c = cur.current
        cur.current = { stroke: null, erase: false, before: null }
        setLive(null)
        if (c.erase) {
          if (c.before && c.before.length !== state.current.strokes.length) commit(state.current.strokes, c.before)
          return
        }
        if (!c.stroke) return
        const bottom = Math.max(...c.stroke.pts.map((p) => p[1]))
        const grow = bottom > state.current.height - 220 ? state.current.height + GROW : undefined
        commit([...state.current.strokes, c.stroke], state.current.strokes, grow)
      },
    },
    { enabled: true, handDraws },
  )

  const undo = () => {
    const prev = hist.current.past.pop()
    if (!prev) return
    hist.current.future.push(strokes)
    setStrokes(prev)
    onStrokes?.(prev)
    onSave?.({ strokes: prev, height })
    force((n) => n + 1)
  }
  const redo = () => {
    const next = hist.current.future.pop()
    if (!next) return
    hist.current.past.push(strokes)
    setStrokes(next)
    onStrokes?.(next)
    onSave?.({ strokes: next, height })
    force((n) => n + 1)
  }
  const clear = () => {
    if (!strokes.length || !confirm('이 페이지의 필기를 모두 지울까요? (되돌리기로 복구할 수 있어요)')) return
    commit([], strokes)
  }

  const drawing = tool !== 'none'
  return (
    <div className={cn('flex flex-col', className)}>
      <div className={cn('sticky top-[var(--chrome-top)] z-10 border-b bg-surface/95 px-2 py-1.5 backdrop-blur', toolbarClassName)}>
        <InkToolbar onUndo={undo} onRedo={redo} onClear={clear} canUndo={hist.current.past.length > 0} canRedo={hist.current.future.length > 0} />
      </div>
      <div
        ref={box}
        className={cn('relative w-full select-none bg-surface', drawing && handDraws ? 'touch-none' : 'touch-pan-y', drawing && 'cursor-crosshair')}
        style={{ aspectRatio: `${PAGE_W} / ${height}` }}
      >
        <svg viewBox={`0 0 ${PAGE_W} ${height}`} className="absolute inset-0 size-full" aria-label="필기 페이지">
          {ruled && (
            <>
              <defs>
                <pattern id="ruled" width={PAGE_W} height={52} patternUnits="userSpaceOnUse">
                  <line x1={0} x2={PAGE_W} y1={51.5} y2={51.5} stroke="var(--border)" strokeWidth={1.2} />
                </pattern>
              </defs>
              <rect x={0} y={0} width={PAGE_W} height={height} fill="url(#ruled)" />
            </>
          )}
          {strokes.map((s) => (
            <StrokeShape key={s.id} s={s} dark={dark} />
          ))}
          {live && <StrokeShape s={live} dark={dark} />}
        </svg>
        {!strokes.length && !live && (
          <p className="pointer-events-none absolute inset-x-0 top-16 text-center text-sm text-subtle">
            {drawing ? '펜으로 써 보세요' : '위에서 펜이나 형광펜을 고르고 써 보세요 (S Pen은 바로 써져요)'}
          </p>
        )}
      </div>
    </div>
  )
}

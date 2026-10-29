import { Eraser, Hand, Highlighter, PenLine, Redo2, Search, Trash2, Undo2 } from 'lucide-react'
import { HL_COLORS, PEN_COLORS, type InkTool, isDark, useInkTool } from '@/lib/ink'
import { useTheme } from '@/stores/theme'
import { cn } from '@/lib/utils'

function ToolButton({ active, onClick, label, children }: { active: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-lg transition-colors [&_svg]:size-[18px]',
        active ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-surface-2 hover:text-text',
      )}
    >
      {children}
    </button>
  )
}

/** Pen tools: pen, highlighter, eraser, (lookup on readings), colours, thickness, undo/redo, clear. */
export function InkToolbar({
  lookup = false,
  onUndo,
  onRedo,
  onClear,
  canUndo,
  canRedo,
  className,
  compact = false,
}: {
  lookup?: boolean
  onUndo: () => void
  onRedo: () => void
  onClear?: () => void
  canUndo: boolean
  canRedo: boolean
  className?: string
  compact?: boolean
}) {
  const { tool, color, size, handDraws, set } = useInkTool()
  useTheme() // re-render swatches when the theme flips
  const dark = isDark()
  const pick = (t: InkTool) => set({ tool: tool === t ? 'none' : t })
  const palette = tool === 'hl' ? (dark ? HL_COLORS.dark : HL_COLORS.light) : dark ? PEN_COLORS.dark : PEN_COLORS.light
  return (
    <div className={cn('flex max-w-full items-center gap-1 overflow-x-auto [scrollbar-width:none]', className)} role="toolbar" aria-label="펜 도구">
      <ToolButton active={tool === 'pen'} onClick={() => pick('pen')} label="펜">
        <PenLine />
      </ToolButton>
      <ToolButton active={tool === 'hl'} onClick={() => pick('hl')} label="형광펜">
        <Highlighter />
      </ToolButton>
      <ToolButton active={tool === 'eraser'} onClick={() => pick('eraser')} label="지우개 (S Pen 버튼을 누른 채 써도 지워져요)">
        <Eraser />
      </ToolButton>
      {lookup && (
        <ToolButton active={tool === 'lookup'} onClick={() => pick('lookup')} label="펜으로 그어서 뜻 찾기">
          <Search />
        </ToolButton>
      )}
      {(tool === 'pen' || tool === 'hl') && (
        <>
          <span className="mx-1 h-6 w-px shrink-0 bg-border" />
          {palette.map((c, i) => (
            <button
              key={c}
              type="button"
              onClick={() => set({ color: i })}
              aria-label={`색 ${i + 1}`}
              className={cn('grid size-8 shrink-0 place-items-center rounded-full', color === i && 'ring-2 ring-accent ring-offset-2 ring-offset-surface')}
            >
              <span className="size-5 rounded-full border border-black/10" style={{ background: c }} />
            </button>
          ))}
          {!compact && (
            <div className="ml-1 flex shrink-0 items-center gap-0.5 rounded-lg border bg-surface-2/60 p-0.5">
              {[0, 1, 2].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => set({ size: s })}
                  aria-label={['가늘게', '보통', '굵게'][s]}
                  className={cn('grid size-7 place-items-center rounded-md', size === s ? 'bg-surface shadow-sm' : 'text-muted')}
                >
                  <span className="rounded-full bg-current" style={{ width: 4 + s * 4, height: 4 + s * 4 }} />
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <span className="mx-1 h-6 w-px shrink-0 bg-border" />
      <ToolButton active={false} onClick={onUndo} label="되돌리기">
        <Undo2 className={cn(!canUndo && 'opacity-35')} />
      </ToolButton>
      <ToolButton active={false} onClick={onRedo} label="다시 하기">
        <Redo2 className={cn(!canRedo && 'opacity-35')} />
      </ToolButton>
      {onClear && (
        <ToolButton active={false} onClick={onClear} label="필기 모두 지우기">
          <Trash2 />
        </ToolButton>
      )}
      <ToolButton active={handDraws} onClick={() => set({ handDraws: !handDraws })} label="손가락·마우스로도 쓰기 (펜이 없을 때)">
        <Hand />
      </ToolButton>
    </div>
  )
}

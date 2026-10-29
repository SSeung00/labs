import clsx from 'clsx'
import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Popover } from './ui'

// Hangul's basic palette rows (theme colours, then lighter/darker steps).
const PALETTE = [
  ['#000000', '#404040', '#7f7f7f', '#bfbfbf', '#d9d9d9', '#f2f2f2', '#ffffff'],
  ['#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0'],
  ['#0070c0', '#002060', '#7030a0', '#e36c09', '#4f81bd', '#1f497d', '#8064a2'],
  ['#f2dcdb', '#fde9d9', '#fff2cc', '#ebf1de', '#dbeef3', '#dce6f1', '#e5e0ec'],
  ['#e6b9b8', '#fbd4b4', '#ffe699', '#d7e4bc', '#b7dde8', '#b8cce4', '#ccc1d9'],
]

export function ColorButton({
  title,
  color,
  icon,
  allowNone,
  onPick,
}: {
  title: string
  color: string | null
  icon: ReactNode
  allowNone?: boolean
  onPick: (c: string | null) => void
}) {
  return (
    <Popover
      title={title}
      trigger={(open, toggle) => (
        <div className={clsx('flex h-8 items-stretch rounded-md hover:bg-hover', open && 'bg-active')}>
          <button
            type="button"
            aria-label={title}
            className="flex w-8 flex-col items-center justify-center"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(color)}
          >
            {icon}
            <span className="mt-0.5 h-[3px] w-4 rounded-sm" style={{ background: color || 'transparent', outline: color ? undefined : '1px solid #c5cad3' }} />
          </button>
          <button type="button" aria-label={`${title} 고르기`} className="px-0.5 text-muted" onMouseDown={(e) => e.preventDefault()} onClick={toggle}>
            <ChevronDown size={12} />
          </button>
        </div>
      )}
    >
      {(close) => (
        <div className="w-[13.5rem]">
          <div className="grid grid-cols-7 gap-1">
            {PALETTE.flat().map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                className="h-6 w-6 rounded border border-black/10 hover:scale-110"
                style={{ background: c }}
                onClick={() => {
                  onPick(c)
                  close()
                }}
              />
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2 text-[12px]">
            {allowNone ? (
              <button
                type="button"
                className="rounded px-2 py-1 text-ink hover:bg-hover"
                onClick={() => {
                  onPick(null)
                  close()
                }}
              >
                색 없음
              </button>
            ) : (
              <span />
            )}
            <label className="flex items-center gap-1 text-muted">
              다른 색
              <input
                type="color"
                className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0"
                defaultValue={color || '#000000'}
                onChange={(e) => onPick(e.target.value)}
              />
            </label>
          </div>
        </div>
      )}
    </Popover>
  )
}

export function TableGridPicker({ onPick, children }: { onPick: (rows: number, cols: number) => void; children: ReactNode }) {
  const [hover, setHover] = useState<[number, number]>([0, 0])
  const R = 10
  const C = 10
  return (
    <Popover
      title="표 만들기"
      trigger={(open, toggle) => (
        <button
          type="button"
          aria-label="표 만들기"
          onMouseDown={(e) => e.preventDefault()}
          onClick={toggle}
          className={clsx('inline-flex h-8 items-center gap-1 rounded-md px-1.5 text-[13px] hover:bg-hover', open && 'bg-active')}
        >
          {children}
        </button>
      )}
    >
      {(close) => (
        <div>
          <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${C}, 16px)` }} onMouseLeave={() => setHover([0, 0])}>
            {Array.from({ length: R * C }, (_, i) => {
              const r = Math.floor(i / C) + 1
              const c = (i % C) + 1
              const on = r <= hover[0] && c <= hover[1]
              return (
                <button
                  key={i}
                  type="button"
                  aria-label={`${r}줄 ${c}칸`}
                  className={clsx('h-4 w-4 rounded-[3px] border', on ? 'border-accent bg-accent/25' : 'border-line bg-field')}
                  onMouseEnter={() => setHover([r, c])}
                  onClick={() => {
                    onPick(r, c)
                    close()
                  }}
                />
              )
            })}
          </div>
          <div className="mt-1.5 text-center text-[12px] text-muted">{hover[0] ? `${hover[0]}줄 × ${hover[1]}칸` : '크기를 고르세요'}</div>
        </div>
      )}
    </Popover>
  )
}

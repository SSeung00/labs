import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Check, Coffee, Feather, Flame, Minus, Pencil, Plus, RotateCcw } from 'lucide-react'
import type { DayHabit, EntryState } from '@/api/types'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/controls'
import { cn } from '@/lib/utils'
import { fmtValue } from '@/lib/day'
import { CATEGORY, targetText } from './HabitRow'

const QUICK: Record<string, number[]> = { count: [1, 2, 5], minutes: [5, 10, 30], number: [1, 5, 10] }

/** Details for one routine on one day: amount, done / easy / rest, a memo. */
export function HabitSheet({
  h,
  onClose,
  onChange,
}: {
  h: DayHabit | null
  onClose: () => void
  onChange: (h: DayHabit, change: { value?: number; state?: EntryState; note?: string }) => void
}) {
  const [note, setNote] = useState('')
  const [typed, setTyped] = useState('')
  useEffect(() => {
    setNote(h?.entry?.note ?? '')
    setTyped('')
  }, [h?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!h) return null
  const state = h.entry?.state ?? ''
  const value = h.entry?.value ?? 0
  const quantity = h.kind !== 'check'
  const set = (change: { value?: number; state?: EntryState; note?: string }) => onChange(h, change)
  const saveNote = () => note !== (h.entry?.note ?? '') && set({ note })

  return (
    <Dialog
      open
      onClose={() => {
        saveNote()
        onClose()
      }}
      title={
        <span className="flex items-center gap-2">
          <span className="text-2xl">{h.emoji}</span>
          {h.name}
        </span>
      }
      description={[CATEGORY[h.category]?.label, h.cue, quantity ? `목표 ${targetText(h)}` : null].filter(Boolean).join(' · ')}
    >
      <div className="space-y-5 px-5 py-5">
        {(h.streak.current > 0 || h.schedule === 'weekly') && (
          <div className="flex flex-wrap gap-2 text-xs">
            {h.streak.current > 0 && (
              <span className={cn('flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold', h.streak.at_risk ? 'bg-warn/15 text-warn' : 'bg-surface-2 text-muted')}>
                <Flame className="size-3.5" /> {h.streak.current}번 연속{h.streak.at_risk && ' · 어제 놓쳤어요, 오늘 하면 이어져요'}
              </span>
            )}
            {h.schedule === 'weekly' && (
              <span className="rounded-full bg-surface-2 px-2.5 py-1 font-semibold text-muted">
                이번 주 {h.week_done}/{h.per_week}회
              </span>
            )}
          </div>
        )}

        {quantity && (
          <div>
            <div className="flex items-center justify-center gap-4">
              <Button size="icon" variant="secondary" className="size-11 rounded-full" onClick={() => set({ value: Math.max(0, value - (QUICK[h.kind][0] ?? 1)) })} aria-label="빼기">
                <Minus />
              </Button>
              <div className="min-w-[120px] text-center">
                <div className="text-4xl font-bold tracking-tight num">{fmtValue(value)}</div>
                <div className="text-xs text-subtle">
                  / {targetText(h)}
                </div>
              </div>
              <Button size="icon" variant="secondary" className="size-11 rounded-full" onClick={() => set({ value: value + (QUICK[h.kind][0] ?? 1) })} aria-label="더하기">
                <Plus />
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {QUICK[h.kind].map((q) => (
                <Button key={q} size="sm" variant="ghost" className="border" onClick={() => set({ value: value + q })}>
                  +{q}
                  {h.unit}
                </Button>
              ))}
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault()
                  const v = parseFloat(typed)
                  if (!Number.isNaN(v)) set({ value: v })
                  setTyped('')
                }}
              >
                <Input value={typed} onChange={(e) => setTyped(e.target.value)} inputMode="decimal" placeholder="직접" className="h-8 w-20 text-center" aria-label="값 직접 입력" />
              </form>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button variant={state === 'done' ? 'primary' : 'secondary'} className="h-11" onClick={() => set({ state: state === 'done' ? '' : 'done' })}>
            <Check /> {state === 'done' ? '완료됨' : '완료'}
          </Button>
          <Button
            variant={state === 'skip' ? 'primary' : 'secondary'}
            className="h-11"
            onClick={() => set({ state: state === 'skip' ? '' : 'skip' })}
            title="오늘 신호등 계산에서 빠져요"
          >
            <Coffee /> 오늘은 쉬어요
          </Button>
          {h.easy_name && (
            <Button variant={state === 'easy' ? 'primary' : 'secondary'} className="col-span-2 h-11" onClick={() => set({ state: state === 'easy' ? '' : 'easy' })}>
              <Feather /> 가볍게 했어요 · {h.easy_name}
            </Button>
          )}
        </div>
        {!h.easy_name && (
          <p className="-mt-2 text-xs text-subtle">
            컨디션이 안 좋은 날을 위한 <b className="text-muted">가벼운 버전</b>을 정해 두면, 그것만 해도 연속 기록이 이어져요.
          </p>
        )}

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted">메모</label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} onBlur={saveNote} rows={2} placeholder="예: 10km, 페이스 5'30&quot;" />
        </div>

        <div className="flex items-center justify-between border-t pt-4">
          {(state || value > 0 || h.entry?.note) ? (
            <Button variant="ghost" size="sm" onClick={() => { setNote(''); set({ state: '', value: 0, note: '' }) }}>
              <RotateCcw /> 기록 지우기
            </Button>
          ) : <span />}
          <Link to={`/routines?edit=${h.id}`}>
            <Button variant="ghost" size="sm" tabIndex={-1}>
              <Pencil /> 루틴 편집
            </Button>
          </Link>
        </div>
      </div>
    </Dialog>
  )
}

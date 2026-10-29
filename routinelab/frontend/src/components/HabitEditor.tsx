import { useEffect, useState, type ReactNode } from 'react'
import { Loader2, Minus, Plus } from 'lucide-react'
import type { Category, Habit, HabitInput, Kind, Mode, Schedule, Slot } from '@/api/types'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { Segmented } from '@/components/ui/controls'
import { useHabitMutations } from '@/api/rl'
import { cn } from '@/lib/utils'
import { SLOTS, WEEKDAYS_MON } from '@/lib/day'
import { CATEGORY } from './HabitRow'

export const EMPTY_HABIT: HabitInput = {
  name: '', emoji: '✅', color: 'green', category: 'life', slot: 'anytime', kind: 'check', target: 1, unit: '',
  schedule: 'daily', days: [], per_week: 3, easy_name: '', cue: '', reminder: null, modes: [], note: '',
}

const EMOJIS = ['✅', '💧', '💊', '🧘', '🏃', '🏋️', '🚶', '🚴', '🏊', '📖', '📄', '🔤', '✍️', '🧠', '🛏️', '⏰', '🍎', '🥗', '🧹', '📝', '🙏', '📵', '☀️', '🌙']

const KINDS: { value: Kind; label: string; unit: string; target: number }[] = [
  { value: 'check', label: '체크', unit: '', target: 1 },
  { value: 'count', label: '횟수', unit: '회', target: 3 },
  { value: 'minutes', label: '시간', unit: '분', target: 30 },
  { value: 'number', label: '수치', unit: 'km', target: 5 },
]

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-subtle">{hint}</p>}
    </div>
  )
}

function Chip({ on, onClick, children, className }: { on: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-8 rounded-full border px-3 text-[13px] font-medium transition-colors',
        on ? 'border-accent bg-accent-soft text-text' : 'text-muted hover:border-border-strong hover:text-text',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function HabitEditor({
  open,
  habit,
  modes,
  onClose,
}: {
  open: boolean
  habit: Habit | null // null = new
  modes: Mode[]
  onClose: () => void
}) {
  const [f, setF] = useState<HabitInput>(EMPTY_HABIT)
  const [more, setMore] = useState(false)
  const { save } = useHabitMutations()

  useEffect(() => {
    if (!open) return
    setF(habit ? { ...EMPTY_HABIT, ...habit } : EMPTY_HABIT)
    setMore(!!habit && (habit.modes.length > 0 || !!habit.note))
    save.reset()
  }, [open, habit]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof HabitInput>(k: K, v: HabitInput[K]) => setF((p) => ({ ...p, [k]: v }))
  const setKind = (k: Kind) => {
    const def = KINDS.find((x) => x.value === k)!
    setF((p) => ({ ...p, kind: k, unit: k === p.kind ? p.unit : def.unit, target: k === p.kind ? p.target : def.target }))
  }
  const valid = f.name.trim() && (f.schedule !== 'days' || f.days.length > 0) && (f.kind === 'check' || f.target > 0)

  return (
    <Dialog open={open} onClose={onClose} title={habit ? '루틴 편집' : '새 루틴'} description="작게 시작할수록 오래가요.">
      <form
        className="space-y-5 px-5 py-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          save.mutate({ id: habit?.id, body: { ...f, name: f.name.trim() } }, { onSuccess: onClose })
        }}
      >
        <div className="flex gap-2">
          <Input value={f.emoji} onChange={(e) => set('emoji', e.target.value.slice(0, 8))} className="w-14 text-center text-xl" aria-label="이모지" />
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="예: 물 마시기, 러닝, 영어 단어" autoFocus={!habit} aria-label="이름" />
        </div>
        <div className="-mt-2 flex flex-wrap gap-1">
          {EMOJIS.map((em) => (
            <button key={em} type="button" onClick={() => set('emoji', em)} className={cn('grid size-8 place-items-center rounded-lg text-lg hover:bg-surface-2', f.emoji === em && 'bg-surface-3')}>
              {em}
            </button>
          ))}
        </div>

        <Field label="언제 할까요?">
          <Segmented<Slot> value={f.slot} onChange={(v) => set('slot', v)} options={SLOTS.map((s) => ({ value: s.key, label: `${s.emoji} ${s.label}` }))} size="sm" />
        </Field>

        <Field label="기록 방식">
          <Segmented<Kind> value={f.kind} onChange={setKind} options={KINDS.map((k) => ({ value: k.value, label: k.label }))} size="sm" />
          {f.kind !== 'check' && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-sm text-muted">하루 목표</span>
              <Input type="number" min={0} step="any" value={f.target} onChange={(e) => set('target', parseFloat(e.target.value) || 0)} className="w-24 text-center" aria-label="목표" />
              <Input value={f.unit} onChange={(e) => set('unit', e.target.value.slice(0, 12))} className="w-20 text-center" placeholder="단위" aria-label="단위" />
            </div>
          )}
        </Field>

        <Field label="반복">
          <Segmented<Schedule>
            value={f.schedule}
            onChange={(v) => set('schedule', v)}
            options={[
              { value: 'daily', label: '매일' },
              { value: 'days', label: '요일 지정' },
              { value: 'weekly', label: '주 N회' },
            ]}
            size="sm"
          />
          {f.schedule === 'days' && (
            <div className="mt-2 flex gap-1">
              {WEEKDAYS_MON.map((w, i) => (
                <Chip key={w} on={f.days.includes(i)} onClick={() => set('days', f.days.includes(i) ? f.days.filter((d) => d !== i) : [...f.days, i])} className="w-9 px-0">
                  {w}
                </Chip>
              ))}
            </div>
          )}
          {f.schedule === 'weekly' && (
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span className="text-muted">일주일에</span>
              <Button type="button" size="icon" variant="secondary" className="size-8" onClick={() => set('per_week', Math.max(1, f.per_week - 1))} aria-label="줄이기">
                <Minus />
              </Button>
              <span className="w-6 text-center font-semibold num">{f.per_week}</span>
              <Button type="button" size="icon" variant="secondary" className="size-8" onClick={() => set('per_week', Math.min(7, f.per_week + 1))} aria-label="늘리기">
                <Plus />
              </Button>
              <span className="text-muted">번</span>
            </div>
          )}
        </Field>

        <Field label="가벼운 버전 (컨디션 나쁜 날)" hint="이것만 해도 완료로 쳐서 연속 기록이 이어져요.">
          <Input value={f.easy_name} onChange={(e) => set('easy_name', e.target.value)} placeholder="예: 20분 걷기, 단어 10개만" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="언제 붙여서 할까요? (습관 쌓기)">
            <Input value={f.cue} onChange={(e) => set('cue', e.target.value)} placeholder="예: 아침 커피 후" />
          </Field>
          <Field label="알림 (안 했으면)">
            <div className="flex gap-2">
              <Input type="time" value={f.reminder ?? ''} onChange={(e) => set('reminder', e.target.value || null)} aria-label="알림 시간" />
              {f.reminder && (
                <Button type="button" variant="ghost" onClick={() => set('reminder', null)}>
                  끄기
                </Button>
              )}
            </div>
          </Field>
        </div>

        <Field label="분류">
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(CATEGORY) as Category[]).map((c) => (
              <Chip key={c} on={f.category === c} onClick={() => set('category', c)}>
                <span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: CATEGORY[c].color }} />
                {CATEGORY[c].label}
              </Chip>
            ))}
          </div>
        </Field>

        {more ? (
          <>
            <Field label="어떤 모드에서 할까요?" hint="아무것도 고르지 않으면 모든 모드에서 보여요.">
              <div className="flex flex-wrap gap-1.5">
                {modes.map((m) => (
                  <Chip key={m.id} on={f.modes.includes(m.id)} onClick={() => set('modes', f.modes.includes(m.id) ? f.modes.filter((x) => x !== m.id) : [...f.modes, m.id])}>
                    {m.emoji} {m.name}
                  </Chip>
                ))}
              </div>
            </Field>
            <Field label="메모">
              <Input value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="왜 이 루틴을 하는지 적어 두면 힘들 때 도움이 돼요" />
            </Field>
          </>
        ) : (
          <button type="button" onClick={() => setMore(true)} className="text-xs font-medium text-accent">
            모드 · 메모 설정 더 보기
          </button>
        )}

        {save.error && <p className="text-sm text-bad">{save.error.message}</p>}
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" variant="primary" disabled={!valid || save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />}
            {habit ? '저장' : '만들기'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

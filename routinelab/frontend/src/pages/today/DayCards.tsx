import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Check, Clock, Plus, Undo2, X } from 'lucide-react'
import type { DayPayload, Todo } from '@/api/types'
import { useDayActions, useDayMutations } from '@/api/rl'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export const MOODS = ['😣', '😕', '😐', '🙂', '😄']
export const ENERGY = ['🪫', '😮‍💨', '🙂', '💪', '⚡']

function TodoItem({ t, day }: { t: Todo; day: string }) {
  const { updateTodo, deleteTodo } = useDayActions(day)
  return (
    <li className="group flex items-center gap-2.5 py-1.5">
      <button
        onClick={() => updateTodo(t, { done: !t.done })}
        className={cn('grid size-6 shrink-0 place-items-center rounded-md border-2 transition-colors', t.done ? 'border-accent bg-accent text-accent-fg' : 'border-border-strong')}
        aria-label={t.done ? '완료 취소' : '완료'}
      >
        {t.done && <Check className="size-4" strokeWidth={3} />}
      </button>
      <span className={cn('min-w-0 flex-1 truncate text-sm', t.done && 'text-subtle line-through')}>{t.title}</span>
      {t.time && <span className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted num">{t.time}</span>}
      <button onClick={() => deleteTodo(t)} className="grid size-7 shrink-0 place-items-center rounded-md text-subtle opacity-60 hover:bg-surface-2 hover:text-text group-hover:opacity-100" aria-label="삭제">
        <X className="size-3.5" />
      </button>
    </li>
  )
}

export function TodoCard({ data }: { data: DayPayload }) {
  const { addTodo } = useDayActions(data.day)
  const { carry } = useDayMutations()
  const [title, setTitle] = useState('')
  const [time, setTime] = useState('')
  const [showTime, setShowTime] = useState(false)
  const todos = [...data.todos].sort((a, b) => Number(a.done) - Number(b.done) || (a.time ?? '99').localeCompare(b.time ?? '99'))
  const left = data.todos.filter((t) => !t.done).length

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    addTodo(title.trim(), time || null)
    setTitle('')
    setTime('')
  }

  return (
    <Card>
      <CardHeader title="할 일" hint={data.todos.length ? `${left}개 남음` : '루틴 말고 오늘만 할 일'} />
      <CardBody className="pt-2">
        <form onSubmit={submit} className="flex gap-1.5">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="할 일 추가" aria-label="할 일" />
          {showTime ? (
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-[110px] shrink-0" aria-label="시간" />
          ) : (
            <Button type="button" variant="ghost" size="icon" className="size-10 shrink-0" onClick={() => setShowTime(true)} title="시간 정하기" aria-label="시간 정하기">
              <Clock />
            </Button>
          )}
          <Button type="submit" variant="primary" size="icon" className="size-10 shrink-0" disabled={!title.trim()} aria-label="추가">
            <Plus />
          </Button>
        </form>
        {todos.length > 0 && (
          <ul className="mt-2">
            {todos.map((t) => (
              <TodoItem key={t.id} t={t} day={data.day} />
            ))}
          </ul>
        )}
        {data.overdue > 0 && (
          <button
            onClick={() => carry.mutate(data.day)}
            disabled={carry.isPending}
            className="mt-3 flex w-full items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-left text-xs text-muted hover:text-text"
          >
            <Undo2 className="size-3.5" />
            <span className="flex-1">지난 할 일 {data.overdue}개를 오늘로 가져오기</span>
          </button>
        )}
      </CardBody>
    </Card>
  )
}

export function ReviewCard({ data }: { data: DayPayload }) {
  const { saveLog } = useDayActions(data.day)
  const log = data.log
  const answered = Object.entries(log.answers).filter(([, a]) => a.trim())
  return (
    <Card>
      <CardHeader
        title="하루 돌아보기"
        hint="기분과 한 줄이면 충분해요"
        action={
          <Link to={`/journal?day=${data.day}`} className="flex items-center gap-1 text-xs font-medium text-accent">
            회고 쓰기 <ArrowRight className="size-3.5" />
          </Link>
        }
      />
      <CardBody className="space-y-3 pt-3">
        <div className="flex items-center justify-between gap-1">
          <span className="w-10 text-xs text-subtle">기분</span>
          {MOODS.map((m, i) => (
            <button
              key={m}
              onClick={() => saveLog({ mood: log.mood === i + 1 ? null : i + 1 })}
              className={cn('grid size-10 place-items-center rounded-xl text-[22px] transition-all', log.mood === i + 1 ? 'scale-110 bg-accent-soft' : 'opacity-50 grayscale hover:opacity-100 hover:grayscale-0')}
              aria-label={`기분 ${i + 1}`}
              aria-pressed={log.mood === i + 1}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-1">
          <span className="w-10 text-xs text-subtle">에너지</span>
          {ENERGY.map((m, i) => (
            <button
              key={m}
              onClick={() => saveLog({ energy: log.energy === i + 1 ? null : i + 1 })}
              className={cn('grid size-10 place-items-center rounded-xl text-[20px] transition-all', log.energy === i + 1 ? 'scale-110 bg-accent-soft' : 'opacity-50 grayscale hover:opacity-100 hover:grayscale-0')}
              aria-label={`에너지 ${i + 1}`}
              aria-pressed={log.energy === i + 1}
            >
              {m}
            </button>
          ))}
        </div>
        {(answered.length > 0 || log.note) && (
          <div className="rounded-lg bg-surface-2 px-3 py-2 text-xs leading-relaxed text-muted">
            {answered.length > 0 ? (
              <>
                <span className="text-subtle">{answered[0][0]}</span> {answered[0][1]}
              </>
            ) : (
              log.note
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

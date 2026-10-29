import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Archive, ArchiveRestore, Bell, ChevronDown, ChevronUp, Loader2, Pencil, Plus, Sparkles, Star, Trash2 } from 'lucide-react'
import type { Habit, Mode } from '@/api/types'
import { useHabitMutations, useHabits, useModeMutations, useModes, useTemplates } from '@/api/rl'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageSkeleton } from '@/components/layout/PageSkeleton'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { Segmented, Select } from '@/components/ui/controls'
import { Dialog } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { HabitEditor } from '@/components/HabitEditor'
import { CATEGORY, targetText } from '@/components/HabitRow'
import { cn } from '@/lib/utils'
import { addDays, shortDay, SLOTS, WEEKDAYS_MON } from '@/lib/day'

function scheduleText(h: Habit): string {
  if (h.schedule === 'weekly') return `주 ${h.per_week}회`
  if (h.schedule === 'days') return h.days.map((d) => WEEKDAYS_MON[d]).join('·')
  return '매일'
}

function HabitLine({ h, modes, first, last, onEdit, onMove }: { h: Habit; modes: Mode[]; first: boolean; last: boolean; onEdit: () => void; onMove: (dir: -1 | 1) => void }) {
  const { archive } = useHabitMutations()
  const modeNames = h.modes.map((id) => modes.find((m) => m.id === id)).filter(Boolean).map((m) => `${m!.emoji}${m!.name}`)
  const sub = [scheduleText(h), targetText(h), h.easy_name && `가볍게: ${h.easy_name}`, h.cue, modeNames.length ? modeNames.join(' ') : null].filter(Boolean)
  return (
    <li className="flex items-center gap-2 py-2">
      <div className="flex flex-col">
        <button onClick={() => onMove(-1)} disabled={first} className="grid h-4 w-6 place-items-center text-subtle hover:text-text disabled:opacity-20" aria-label="위로">
          <ChevronUp className="size-4" />
        </button>
        <button onClick={() => onMove(1)} disabled={last} className="grid h-4 w-6 place-items-center text-subtle hover:text-text disabled:opacity-20" aria-label="아래로">
          <ChevronDown className="size-4" />
        </button>
      </div>
      <span className="text-xl">{h.emoji}</span>
      <button onClick={onEdit} className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-2">
          <span className="truncate text-[15px] font-medium">{h.name}</span>
          <span className="size-1.5 shrink-0 rounded-full" style={{ background: CATEGORY[h.category]?.color }} title={CATEGORY[h.category]?.label} />
          {h.reminder && (
            <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-subtle num">
              <Bell className="size-3" />
              {h.reminder}
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-subtle">{sub.join(' · ')}</span>
      </button>
      <Button variant="ghost" size="icon" onClick={onEdit} aria-label="편집">
        <Pencil />
      </Button>
      <Button variant="ghost" size="icon" onClick={() => archive.mutate({ id: h.id, archived: true })} aria-label="보관" title="보관함으로 (기록은 남아요)">
        <Archive />
      </Button>
    </li>
  )
}

function TemplatesDialog({ open, onClose, existing }: { open: boolean; onClose: () => void; existing: Set<string> }) {
  const { data } = useTemplates()
  const { bulk } = useHabitMutations()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  useEffect(() => setPicked(new Set()), [open])
  const all = (data?.themes ?? []).flatMap((t) => t.habits.map((h) => ({ id: `${t.key}:${h.name}`, theme: t, h })))
  return (
    <Dialog open={open} onClose={onClose} title="추천 루틴" description="골라서 한 번에 추가해요. 추가한 뒤 자유롭게 고칠 수 있어요.">
      <div className="space-y-4 px-5 py-4">
        {(data?.themes ?? []).map((t) => (
          <div key={t.key}>
            <div className="mb-1 text-xs font-semibold text-muted">
              {t.emoji} {t.name}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {all.filter((x) => x.theme.key === t.key).map(({ id, h }) => {
                const have = existing.has(h.name ?? '')
                const on = picked.has(id)
                return (
                  <button
                    key={id}
                    disabled={have}
                    onClick={() => {
                      const next = new Set(picked)
                      if (on) next.delete(id)
                      else next.add(id)
                      setPicked(next)
                    }}
                    className={cn('h-8 rounded-full border px-3 text-[13px] transition-colors', on ? 'border-accent bg-accent-soft' : 'text-muted hover:text-text', have && 'opacity-40')}
                  >
                    {h.emoji} {h.name}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="ghost" onClick={onClose}>
            닫기
          </Button>
          <Button
            variant="primary"
            disabled={!picked.size || bulk.isPending}
            onClick={() => bulk.mutate(all.filter((x) => picked.has(x.id)).map((x) => x.h), { onSuccess: onClose })}
          >
            {bulk.isPending && <Loader2 className="animate-spin" />}
            {picked.size}개 추가
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function RoutineList({ habits, modes, onEdit, onNew }: { habits: Habit[]; modes: Mode[]; onEdit: (h: Habit) => void; onNew: () => void }) {
  const { reorder, archive, remove } = useHabitMutations()
  const [showArchived, setShowArchived] = useState(false)
  const [templates, setTemplates] = useState(false)
  const active = habits.filter((h) => !h.archived)
  const archived = habits.filter((h) => h.archived)

  const move = (h: Habit, dir: -1 | 1) => {
    const group = active.filter((x) => x.slot === h.slot)
    const i = group.findIndex((x) => x.id === h.id)
    const j = i + dir
    if (j < 0 || j >= group.length) return
    const swapped = [...group]
    ;[swapped[i], swapped[j]] = [swapped[j], swapped[i]]
    const order = SLOTS.flatMap((s) => (s.key === h.slot ? swapped : active.filter((x) => x.slot === s.key)))
    reorder.mutate(order.map((x) => x.id))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={onNew}>
          <Plus /> 새 루틴
        </Button>
        <Button onClick={() => setTemplates(true)}>
          <Sparkles /> 추천 루틴에서 고르기
        </Button>
      </div>

      {active.length === 0 ? (
        <Card>
          <EmptyState icon={Sparkles} title="아직 루틴이 없어요">
            추천 루틴에서 고르거나 새로 만들어 보세요. 처음엔 3~5개면 충분해요.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-3 split:grid-cols-2">
          {SLOTS.map((s) => {
            const items = active.filter((h) => h.slot === s.key)
            if (!items.length) return null
            return (
              <Card key={s.key}>
                <CardHeader title={`${s.emoji} ${s.label}`} hint={`${items.length}개`} />
                <CardBody className="pt-1">
                  <ul className="divide-y">
                    {items.map((h, i) => (
                      <HabitLine key={h.id} h={h} modes={modes} first={i === 0} last={i === items.length - 1} onEdit={() => onEdit(h)} onMove={(d) => move(h, d)} />
                    ))}
                  </ul>
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}

      {archived.length > 0 && (
        <Card>
          <button onClick={() => setShowArchived(!showArchived)} className="flex w-full items-center justify-between px-5 py-3.5 text-[13px] font-semibold text-muted">
            보관함 {archived.length}개
            <ChevronDown className={cn('size-4 transition-transform', showArchived && 'rotate-180')} />
          </button>
          {showArchived && (
            <CardBody className="pt-0">
              <p className="mb-2 text-xs text-subtle">보관한 루틴은 오늘 목록에서 빠지지만 지난 기록은 남아요.</p>
              <ul className="divide-y">
                {archived.map((h) => (
                  <li key={h.id} className="flex items-center gap-2 py-2">
                    <span className="text-xl opacity-60">{h.emoji}</span>
                    <span className="flex-1 truncate text-sm text-muted">{h.name}</span>
                    <Button variant="ghost" size="sm" onClick={() => archive.mutate({ id: h.id, archived: false })}>
                      <ArchiveRestore /> 꺼내기
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => confirm(`'${h.name}'과 모든 기록을 지울까요? 되돌릴 수 없어요.`) && remove.mutate(h.id)}
                      aria-label="완전히 지우기"
                      title="완전히 지우기"
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            </CardBody>
          )}
        </Card>
      )}
      <TemplatesDialog open={templates} onClose={() => setTemplates(false)} existing={new Set(active.map((h) => h.name))} />
    </div>
  )
}

const MODE_EMOJIS = ['🌤️', '🛋️', '🧳', '📚', '🏃', '🤒', '🎄', '🏖️', '🔬', '✈️']

function ModesTab() {
  const { data } = useModes()
  const { create, update, remove, addPeriod, removePeriod } = useModeMutations()
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('📚')
  const today = data?.today ?? ''
  const [p, setP] = useState({ kind: 'break' as 'mode' | 'break', mode_id: '' as string, start: '', end: '', note: '' })
  useEffect(() => {
    if (today && !p.start) setP((x) => ({ ...x, start: today, end: addDays(today, 2) }))
  }, [today, p.start])

  if (!data) return <PageSkeleton />
  const modeName = (id: number | null) => data.modes.find((m) => m.id === id)

  return (
    <div className="grid gap-4 split:grid-cols-2 split:items-start">
      <Card>
        <CardHeader title="루틴 모드" hint="평일·주말·출장처럼 상황마다 다른 루틴 세트. 루틴 편집에서 어느 모드에 넣을지 골라요." />
        <CardBody className="space-y-3">
          <ul className="divide-y">
            {data.modes.map((m) => (
              <li key={m.id} className="flex items-center gap-2 py-2">
                <span className="text-xl">{m.emoji}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {m.name}
                    {m.is_default && <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent">기본</span>}
                  </span>
                  <span className="block text-xs text-subtle">루틴 {m.habits}개</span>
                </span>
                {!m.is_default && (
                  <>
                    <Button variant="ghost" size="icon" title="기본 모드로" aria-label="기본 모드로" onClick={() => update.mutate({ id: m.id, name: m.name, emoji: m.emoji, is_default: true })}>
                      <Star />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="지우기" onClick={() => confirm(`'${m.name}' 모드를 지울까요?`) && remove.mutate(m.id)}>
                      <Trash2 />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim()) create.mutate({ name: name.trim(), emoji }, { onSuccess: () => setName('') })
            }}
          >
            <Select value={emoji} onChange={(e) => setEmoji(e.target.value)} className="w-20 shrink-0" aria-label="이모지">
              {MODE_EMOJIS.map((em) => (
                <option key={em}>{em}</option>
              ))}
            </Select>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="새 모드 (예: 시험 기간)" />
            <Button type="submit" disabled={!name.trim()}>
              추가
            </Button>
          </form>
          {(remove.error || update.error) && <p className="text-sm text-bad">{(remove.error ?? update.error)?.message}</p>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="예약 · 휴가" hint="기간을 정해 모드를 바꾸거나, 휴가로 신호등과 알림을 쉬게 해요." />
        <CardBody className="space-y-4">
          <form
            className="space-y-3 rounded-xl border bg-surface-2/50 p-3"
            onSubmit={(e) => {
              e.preventDefault()
              addPeriod.mutate(
                { kind: p.kind, mode_id: p.kind === 'mode' ? Number(p.mode_id) : null, start: p.start, end: p.end, note: p.note },
                { onSuccess: () => setP((x) => ({ ...x, note: '' })) },
              )
            }}
          >
            <Segmented
              value={p.kind}
              onChange={(kind) => setP({ ...p, kind })}
              options={[
                { value: 'break', label: '🏝️ 휴가' },
                { value: 'mode', label: '🔁 모드 바꾸기' },
              ]}
              size="sm"
            />
            {p.kind === 'mode' && (
              <Select value={p.mode_id} onChange={(e) => setP({ ...p, mode_id: e.target.value })} aria-label="모드">
                <option value="">모드 고르기</option>
                {data.modes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.emoji} {m.name}
                  </option>
                ))}
              </Select>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>시작</Label>
                <Input type="date" value={p.start} onChange={(e) => setP({ ...p, start: e.target.value, end: p.end < e.target.value ? e.target.value : p.end })} />
              </div>
              <div>
                <Label>끝</Label>
                <Input type="date" value={p.end} min={p.start} onChange={(e) => setP({ ...p, end: e.target.value })} />
              </div>
            </div>
            <Input value={p.note} onChange={(e) => setP({ ...p, note: e.target.value })} placeholder={p.kind === 'break' ? '메모 (예: 오사카 마라톤 여행)' : '메모 (예: 학회 출장)'} />
            <Button type="submit" variant="primary" className="w-full" disabled={!p.start || !p.end || (p.kind === 'mode' && !p.mode_id) || addPeriod.isPending}>
              예약하기
            </Button>
            {addPeriod.error && <p className="text-sm text-bad">{addPeriod.error.message}</p>}
          </form>

          {data.periods.length === 0 ? (
            <p className="text-center text-xs text-subtle">예약된 기간이 없어요.</p>
          ) : (
            <ul className="divide-y">
              {data.periods.map((x) => {
                const m = modeName(x.mode_id)
                const now = x.start <= today && today <= x.end
                return (
                  <li key={x.id} className="flex items-center gap-2 py-2">
                    <span className="text-lg">{x.kind === 'break' ? '🏝️' : (m?.emoji ?? '🔁')}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {x.kind === 'break' ? '휴가' : `${m?.name ?? '모드'} 모드`}
                        {x.note && <span className="font-normal text-muted"> · {x.note}</span>}
                        {now && <span className="ml-2 rounded-full bg-good/15 px-2 py-0.5 text-[11px] text-good">진행 중</span>}
                      </span>
                      <span className="block text-xs text-subtle num">
                        {shortDay(x.start)}
                        {x.end !== x.start && ` – ${shortDay(x.end)}`}
                      </span>
                    </span>
                    <Button variant="ghost" size="icon" aria-label="취소" onClick={() => removePeriod.mutate(x.id)}>
                      <Trash2 />
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

export function RoutinesPage() {
  const [params, setParams] = useSearchParams()
  const { data } = useHabits()
  const tab = params.get('tab') === 'modes' ? 'modes' : 'list'
  const editId = params.get('edit')
  const isNew = params.get('new') === '1'
  const editing = data?.habits.find((h) => String(h.id) === editId) ?? null

  const close = () => {
    params.delete('edit')
    params.delete('new')
    setParams(params, { replace: true })
  }

  return (
    <div>
      <PageHeader
        title="루틴"
        subtitle="작게 시작해서, 컨디션 나쁜 날엔 가벼운 버전으로."
        actions={
          <Segmented
            value={tab}
            onChange={(t) => setParams(t === 'modes' ? { tab: 'modes' } : {}, { replace: true })}
            options={[
              { value: 'list', label: '루틴' },
              { value: 'modes', label: '모드 · 휴가' },
            ]}
          />
        }
      />
      {!data ? (
        <PageSkeleton />
      ) : tab === 'modes' ? (
        <ModesTab />
      ) : (
        <RoutineList
          habits={data.habits}
          modes={data.modes}
          onEdit={(h) => setParams({ edit: String(h.id) }, { replace: true })}
          onNew={() => setParams({ new: '1' }, { replace: true })}
        />
      )}
      <HabitEditor open={isNew || !!editing} habit={isNew ? null : editing} modes={data?.modes ?? []} onClose={close} />
    </div>
  )
}

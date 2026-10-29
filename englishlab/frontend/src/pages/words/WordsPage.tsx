import { useState } from 'react'
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Layers, Pause, Play, Plus, Search, Trash2, Volume2 } from 'lucide-react'
import { del, patch, useAddCard, useCards, useMistakes } from '@/api/el'
import type { CardItem } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Segmented, Stat } from '@/components/ui/controls'
import { Dialog } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input, Label } from '@/components/ui/input'
import { PageHeader } from '@/components/layout/PageHeader'
import { speak } from '@/lib/audio'
import { cn } from '@/lib/utils'

const KIND_LABEL = { word: '단어', phrase: '표현', correction: '교정' } as const

function dueLabel(c: CardItem) {
  if (c.reps === 0) return '새 카드'
  const days = (new Date(c.due).getTime() - Date.now()) / 86400000
  if (days <= 0) return '복습할 때'
  if (days < 1) return `${Math.max(1, Math.round(days * 24))}시간 뒤`
  return `${Math.round(days)}일 뒤`
}

function CardRow({ c, onOpen }: { c: CardItem; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className={cn('flex w-full items-center gap-3 rounded-xl border bg-surface-2/40 px-3 py-2.5 text-left', c.suspended && 'opacity-50')}>
      <span className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold text-muted">{KIND_LABEL[c.kind]}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{c.term}</div>
        <div className="truncate text-xs text-subtle">{c.meaning_ko ?? (c.enriched ? '' : 'AI가 채우는 중…')}</div>
      </div>
      <span className="num shrink-0 text-xs text-subtle">{dueLabel(c)}</span>
    </button>
  )
}

function CardDetail({ c, onClose }: { c: CardItem | null; onClose: () => void }) {
  const qc = useQueryClient()
  if (!c) return <Dialog open={false} onClose={onClose} title="">{null}</Dialog>
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['cards'] })
    qc.invalidateQueries({ queryKey: ['today'] })
  }
  return (
    <Dialog open={!!c} onClose={onClose} title={c.term} description={[KIND_LABEL[c.kind], c.ipa && `/${c.ipa}/`, `복습 ${c.reps}회 · 잊음 ${c.lapses}회`].filter(Boolean).join(' · ')}>
      <div className="space-y-3 p-5 text-sm">
        {c.prompt && (
          <div>
            <div className="text-xs text-subtle">내가 한 말</div>
            <div className="text-bad line-through">{c.prompt}</div>
          </div>
        )}
        {c.meaning_ko && <div className="text-base font-semibold">{c.meaning_ko}</div>}
        {c.definition_en && <div className="text-muted">{c.definition_en}</div>}
        {c.context && <div className="rounded-lg bg-surface-2/60 px-3 py-2 italic">{c.context}</div>}
        {c.examples.map((e, i) => (
          <div key={i}>
            <div>{e.en}</div>
            <div className="text-xs text-subtle">{e.ko}</div>
          </div>
        ))}
        {c.note && <div className="text-xs text-muted">{c.note}</div>}
        <div className="flex gap-2 pt-2">
          <Button variant="secondary" onClick={() => speak(c.term)}>
            <Volume2 /> 발음
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              await patch(`/cards/${c.id}`, { suspended: !c.suspended })
              refresh()
              onClose()
            }}
          >
            {c.suspended ? <Play /> : <Pause />} {c.suspended ? '복습 재개' : '복습 중지'}
          </Button>
          <Button
            variant="ghost"
            className="ml-auto text-bad"
            onClick={async () => {
              await del(`/cards/${c.id}`)
              refresh()
              onClose()
            }}
          >
            <Trash2 /> 삭제
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function AddDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [term, setTerm] = useState('')
  const [context, setContext] = useState('')
  const add = useAddCard()
  return (
    <Dialog open={open} onClose={onClose} title="카드 직접 추가" description="뜻·예문·발음은 AI가 채워요">
      <div className="space-y-3 p-5">
        <div>
          <Label>단어나 표현</Label>
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="e.g. get the hang of" />
        </div>
        <div>
          <Label>만난 문장 (선택)</Label>
          <Input value={context} onChange={(e) => setContext(e.target.value)} placeholder="It took me a while to get the hang of it." />
        </div>
        <Button
          variant="primary"
          className="w-full"
          disabled={!term.trim() || add.isPending}
          onClick={() =>
            add.mutate(
              { term, context: context || undefined, source_kind: 'manual' },
              {
                onSuccess: () => {
                  setTerm('')
                  setContext('')
                  onClose()
                },
              },
            )
          }
        >
          <Plus /> 추가
        </Button>
      </div>
    </Dialog>
  )
}

function Mistakes() {
  const { data } = useMistakes()
  const qc = useQueryClient()
  if (!data) return null
  if (!data.length)
    return (
      <EmptyState icon={AlertTriangle} title="아직 기록된 실수가 없어요">
        AI 대화나 레벨 진단을 하면 반복되는 실수 패턴이 여기에 모여요.
      </EmptyState>
    )
  return (
    <div className="space-y-2">
      {data.map((m) => (
        <div key={m.id} className={cn('rounded-xl border p-3', m.resolved && 'opacity-50')}>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-muted">
                {m.pattern} <span className="num text-subtle">×{m.count}</span>
              </div>
              <div className="mt-1 text-sm">
                <span className="text-bad line-through">{m.wrong}</span> → <span className="font-medium text-good">{m.right}</span>
              </div>
              <div className="mt-1 text-xs text-subtle">{m.explanation_ko}</div>
            </div>
            <button
              onClick={async () => {
                await patch(`/mistakes/${m.id}`, { resolved: !m.resolved })
                qc.invalidateQueries({ queryKey: ['mistakes'] })
              }}
              className={cn('shrink-0 text-xs', m.resolved ? 'text-subtle' : 'text-good')}
              title={m.resolved ? '다시 열기' : '해결됨으로 표시'}
            >
              <CheckCircle2 className="size-5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

export function WordsPage() {
  const [tab, setTab] = useState<'cards' | 'mistakes'>('cards')
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const [open, setOpen] = useState<CardItem | null>(null)
  const [adding, setAdding] = useState(false)
  const { data } = useCards(q, kind)
  const counts = data?.counts

  return (
    <div>
      <PageHeader
        title="단어"
        subtitle="FSRS가 잊어버리기 직전에 다시 보여줘요. 하루 새 카드 수는 설정에서 정해요"
        actions={
          <Button variant="secondary" onClick={() => setAdding(true)}>
            <Plus /> 추가
          </Button>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="복습할 카드" value={counts?.due ?? '–'} />
        <Stat label="새 카드" value={counts?.new ?? '–'} sub={counts ? `오늘 ${counts.new_today}개 시작` : undefined} />
        <Stat label="전체" value={counts?.total ?? '–'} />
        <Stat label="최근 30일 기억률" value={data?.retention.retention != null ? `${Math.round(data.retention.retention * 100)}%` : '–'} sub={data ? `${data.retention.reviews}회 복습` : undefined} />
      </div>
      <Link to="/words/review">
        <Button variant="primary" className="mb-5 h-12 w-full text-base">
          <Layers className="size-5" /> 복습 시작 {counts ? `(${counts.due + Math.min(counts.new, 20)})` : ''}
        </Button>
      </Link>
      <Card>
        <CardHeader
          title={
            <Segmented
              size="sm"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'cards', label: '단어장' },
                { value: 'mistakes', label: '실수 노트' },
              ]}
            />
          }
        />
        <CardBody>
          {tab === 'cards' ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="검색" className="pl-9" />
                </div>
                <select value={kind} onChange={(e) => setKind(e.target.value)} className="h-10 rounded-lg border bg-surface-2/60 px-2 text-sm">
                  <option value="">전체</option>
                  <option value="word">단어</option>
                  <option value="phrase">표현</option>
                  <option value="correction">교정</option>
                </select>
              </div>
              {data?.cards.length === 0 && (
                <EmptyState icon={Layers} title="카드가 없어요">
                  읽기에서 단어를 탭해 추가하거나, 대화 리포트의 표현을 넣어 보세요.
                </EmptyState>
              )}
              <div className="grid gap-2 split:grid-cols-2">
                {data?.cards.map((c) => (
                  <CardRow key={c.id} c={c} onOpen={() => setOpen(c)} />
                ))}
              </div>
            </div>
          ) : (
            <Mistakes />
          )}
        </CardBody>
      </Card>
      <CardDetail c={open} onClose={() => setOpen(null)} />
      <AddDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}

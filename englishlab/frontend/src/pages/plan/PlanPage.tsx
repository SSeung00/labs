import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { AlertTriangle, ArrowRight, BookMarked, BookPlus, CalendarRange, CheckCircle2, Flag, Loader2, RefreshCw, Sparkles, Target } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { addBook, addEvidence, useBooks, useCheckin, useMakePlan, usePlan } from '@/api/plan'
import { del } from '@/api/el'
import type { BlockKey, BookSummary, PlanResponse, PlanTrack, StudyPlan, TrackState } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Progress, Select, Textarea } from '@/components/ui/controls'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label } from '@/components/ui/input'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageSkeleton } from '@/components/layout/PageSkeleton'
import { cefr } from '@/lib/level'
import { cn } from '@/lib/utils'
import { ForecastCard, SKILLS } from './ForecastCard'

export const BLOCK_LABEL: Record<BlockKey, string> = { review: '복습', read: '읽기', listen: '듣기', talk: '말하기', write: '쓰기', book: '교재' }
// Sequential-free categorical set for the six blocks (fixed order, so a block keeps its colour everywhere).
export const BLOCK_COLOR: Record<BlockKey, string> = {
  read: '#2a78d6', listen: '#eb6834', talk: '#1baf7a', review: '#8b5cf6', write: '#eda100', book: '#e05a8a',
}
const BLOCKS: BlockKey[] = ['read', 'listen', 'talk', 'review', 'write', 'book']
const DAY_LABEL: Record<string, string> = { mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일' }

export const STATE_LABEL: Record<TrackState, string> = { ahead: '앞서감', on_track: '계획대로', slightly_behind: '조금 뒤처짐', behind: '뒤처짐', none: '기록 없음' }
export const STATE_CLS: Record<TrackState, string> = {
  ahead: 'bg-good/15 text-good',
  on_track: 'bg-good/15 text-good',
  slightly_behind: 'bg-warn/15 text-warn',
  behind: 'bg-bad/15 text-bad',
  none: 'bg-surface-3 text-muted',
}
const MS_STATUS = {
  on_track: ['도달 예상', 'text-good', 'bg-good/15 text-good'],
  with_plan: ['계획대로 하면 도달', 'text-accent', 'bg-accent-soft text-accent'],
  at_risk: ['부족 예상', 'text-warn', 'bg-warn/15 text-warn'],
} as const

const BOOK_STATE: Record<string, [string, string]> = {
  researching: ['조사 중', 'bg-accent-soft text-accent'],
  ready: ['계획 대기', 'bg-surface-3 text-muted'],
  active: ['진행 중', 'bg-good/15 text-good'],
  paused: ['멈춤', 'bg-surface-3 text-muted'],
  done: ['완료', 'bg-good/15 text-good'],
  error: ['조사 실패', 'bg-bad/15 text-bad'],
}

function MakePlanDialog({ open, onClose, again }: { open: boolean; onClose: () => void; again: boolean }) {
  const [note, setNote] = useState('')
  const make = useMakePlan()
  return (
    <Dialog open={open} onClose={onClose} title={again ? '계획 다시 짜기' : '공부 계획 만들기'} description="지금 실력 추정, 예측, 최근 공부량, 자주 하는 실수, 추가한 교재를 보고 목표일까지 계획을 짜요 (1–3분).">
      <div className="space-y-4 p-5">
        <div>
          <Label>바라는 점 (선택)</Label>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 4월에 토플 시험 예정, 주말엔 4시간 가능, 말하기를 특히 늘리고 싶어요" />
        </div>
        {make.isError && <p className="text-sm text-bad">{(make.error as Error).message}</p>}
        <Button
          variant="primary"
          className="w-full"
          disabled={make.isPending}
          onClick={() => make.mutate(note, { onSuccess: () => onClose() })}
        >
          {make.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} {again ? '다시 짜기' : '계획 짜기'}
        </Button>
      </div>
    </Dialog>
  )
}

export function AddBookDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const nav = useNavigate()
  const qc = useQueryClient()
  return (
    <Dialog open={open} onClose={onClose} title="교재 추가" description="AI가 웹에서 교재를 조사해 수준·구성·추천 기간과 강도를 제안하고, 계획에 맞춰 일정을 잡아 줘요.">
      <div className="space-y-4 p-5">
        <div>
          <Label>책 제목</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 해커스 토플 리딩 (Hackers TOEFL Reading)" autoFocus />
        </div>
        <div>
          <Label>저자·출판사 (선택)</Label>
          <Input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="예: 해커스어학연구소" />
        </div>
        <div>
          <Label>메모 (선택)</Label>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="예: 2026 개정판, 이미 2챕터까지 풀었음, 시험 전에 끝내고 싶음" />
        </div>
        {err && <p className="text-sm text-bad">{err}</p>}
        <Button
          variant="primary"
          className="w-full"
          disabled={!title.trim() || busy}
          onClick={async () => {
            setBusy(true)
            setErr(null)
            try {
              const b = await addBook({ title, author: author || undefined, notes: notes || undefined })
              qc.invalidateQueries({ queryKey: ['books'] })
              qc.invalidateQueries({ queryKey: ['plan'] })
              onClose()
              nav(`/plan/books/${b.id}`)
            } catch (e) {
              setErr((e as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? <Loader2 className="animate-spin" /> : <BookPlus />} 추가하고 조사하기
        </Button>
      </div>
    </Dialog>
  )
}

function EvidenceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [skill, setSkill] = useState('reading')
  const [band, setBand] = useState('4.5')
  const [note, setNote] = useState('')
  const qc = useQueryClient()
  return (
    <Dialog open={open} onClose={onClose} title="시험 점수 넣기" description="공식 TOEFL이나 모의고사의 섹션 밴드(1–6)를 넣으면 실력 추정에 강한 근거로 반영돼요.">
      <div className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>섹션</Label>
            <Select value={skill} onChange={(e) => setSkill(e.target.value)}>
              {SKILLS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>밴드 (1–6)</Label>
            <Input type="number" step="0.5" min="1" max="6" value={band} onChange={(e) => setBand(e.target.value)} />
          </div>
        </div>
        <div>
          <Label>메모</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: ETS 공식 모의고사 1회" />
        </div>
        <Button
          variant="primary"
          className="w-full"
          disabled={!(Number(band) >= 1 && Number(band) <= 6)}
          onClick={async () => {
            await addEvidence({ skill, level: Number(band), note: note || undefined })
            for (const k of ['plan', 'today', 'stats']) qc.invalidateQueries({ queryKey: [k] })
            onClose()
          }}
        >
          넣기
        </Button>
      </div>
    </Dialog>
  )
}

function WeekCard({ t }: { t: PlanTrack }) {
  const w = t.week
  return (
    <Card>
      <CardHeader
        title="이번 주 진행"
        hint={`${w.start.slice(5).replace('-', '/')}부터 ${w.elapsed_days}일째 · 어제까지 했어야 할 양 대비`}
        action={<span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', STATE_CLS[t.verdict.state])}>{STATE_LABEL[t.verdict.state]}</span>}
      />
      <CardBody className="space-y-3">
        <p className="text-[15px] font-medium">{t.verdict.text_ko}</p>
        <div className="num flex items-baseline gap-2 text-sm text-muted">
          <span className="text-2xl font-bold text-text">{Math.round(w.done / 60 * 10) / 10}시간</span>
          <span>/ 이번 주 목표 {Math.round(w.target / 60 * 10) / 10}시간</span>
          {w.ratio != null && <span className="ml-auto">진도 {Math.round(w.ratio * 100)}%</span>}
        </div>
        <div className="space-y-2.5">
          {w.blocks.map((b) => (
            <div key={b.key}>
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span className="flex items-center gap-2 font-medium">
                  <span className="size-2.5 rounded-full" style={{ background: BLOCK_COLOR[b.key] }} />
                  {b.title}
                </span>
                <span className="num text-xs text-muted">
                  {Math.round(b.done)} / {b.target}분 <span className={cn('ml-1 rounded px-1.5 py-0.5', STATE_CLS[b.state])}>{STATE_LABEL[b.state]}</span>
                </span>
              </div>
              <Progress value={b.target ? b.done / b.target : 0} marker={b.target ? b.expected / b.target : null} color={BLOCK_COLOR[b.key]} className="h-2" />
            </div>
          ))}
        </div>
        <p className="text-xs text-subtle">막대의 세로선 = 어제까지 했어야 할 양. 못 한 시간은 남은 날의 '오늘의 코스'에 조금씩 나눠 들어가요.</p>
        {t.weeks.length > 0 && (
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted">지난 주들</div>
            <div className="flex items-end gap-1.5">
              {t.weeks.map((wk) => (
                <div key={wk.start} className="flex flex-1 flex-col items-center gap-1" title={`${wk.start} · ${wk.done}/${wk.target}분`}>
                  <div className="relative h-14 w-full overflow-hidden rounded bg-surface-3">
                    <div
                      className={cn('absolute inset-x-0 bottom-0 rounded', (wk.ratio ?? 0) >= 0.85 ? 'bg-good' : (wk.ratio ?? 0) >= 0.6 ? 'bg-warn' : 'bg-bad')}
                      style={{ height: `${Math.min(100, (wk.ratio ?? 0) * 100)}%` }}
                    />
                  </div>
                  <span className="num text-[10px] text-subtle">{wk.start.slice(5).replace('-', '/')}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function CheckinCard({ data }: { data: PlanResponse }) {
  const checkin = useCheckin()
  const c = checkin.data ?? data.checkin
  return (
    <Card>
      <CardHeader
        title="AI 주간 점검"
        hint="이번 주 기록과 계획을 비교해 조정할 점을 짚어 줘요 (한 주에 한 번 저장)"
        action={
          <Button size="sm" variant="secondary" disabled={checkin.isPending} onClick={() => checkin.mutate(!!c)}>
            {checkin.isPending ? <Loader2 className="animate-spin" /> : c ? <RefreshCw /> : <Sparkles />} {c ? '다시 점검' : '점검 받기'}
          </Button>
        }
      />
      <CardBody>
        {checkin.isError && <p className="mb-2 text-sm text-bad">{(checkin.error as Error).message}</p>}
        {c ? (
          <div className="space-y-3">
            <p className="text-[15px] leading-relaxed">{c.text_ko}</p>
            <ul className="space-y-1.5">
              {c.adjustments_ko.map((a, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <ArrowRight className="mt-0.5 size-4 shrink-0 text-accent" /> {a}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted">버튼을 누르면 이번 주 진행을 보고 코치가 조정할 점을 알려줘요.</p>
        )}
      </CardBody>
    </Card>
  )
}

function Milestones({ t }: { t: PlanTrack }) {
  if (!t.milestones.length) return null
  return (
    <Card>
      <CardHeader title="마일스톤" hint="지금 페이스 = 최근 2주처럼 공부할 때 · 계획대로 = 이 계획의 시간을 지킬 때" />
      <CardBody className="space-y-2.5">
        {t.milestones.map((m) => (
          <div key={m.date + m.title_ko} className={cn('rounded-xl border p-3', m.past && 'opacity-60')}>
            <div className="flex flex-wrap items-center gap-2">
              <Flag className={cn('size-4', MS_STATUS[m.status][1])} />
              <span className="num text-xs text-subtle">{m.date}</span>
              <span className="font-semibold">{m.title_ko}</span>
              {!m.past && <span className={cn('ml-auto rounded-full px-2 py-0.5 text-xs font-medium', MS_STATUS[m.status][2])}>{MS_STATUS[m.status][0]}</span>}
            </div>
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {SKILLS.map(([k, label]) => {
                const target = m.skill_targets[k]
                const pred = m.forecast[k]
                const byPlan = m.plan_forecast?.[k]
                const ok = (v: number | undefined) => v == null || v >= target - 0.15
                return (
                  <div key={k} className="rounded-lg bg-surface-2/60 px-2 py-1.5 text-center">
                    <div className="text-[11px] text-subtle">{label}</div>
                    <div className="num text-sm font-semibold">{cefr(target)}</div>
                    {pred != null && <div className={cn('num text-[11px]', ok(pred) ? 'text-good' : 'text-warn')}>페이스 {cefr(pred)}</div>}
                    {byPlan != null && <div className={cn('num text-[11px]', ok(byPlan) ? 'text-good' : 'text-warn')}>계획 {cefr(byPlan)}</div>}
                  </div>
                )
              })}
            </div>
            {m.check_ko && <p className="mt-2 text-xs text-muted">확인 방법: {m.check_ko}</p>}
          </div>
        ))}
      </CardBody>
    </Card>
  )
}

function Phases({ plan, current }: { plan: StudyPlan; current: number | null }) {
  return (
    <Card>
      <CardHeader title="단계" hint={`${plan.start} → ${plan.end}`} />
      <CardBody className="space-y-3">
        {plan.phases.map((ph, i) => {
          const total = BLOCKS.reduce((s, b) => s + (ph.weekly_minutes[b] || 0), 0) || 1
          return (
            <div key={i} className={cn('rounded-xl border p-3', i === current && 'border-accent bg-accent-soft/40')}>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-semibold">{ph.name_ko}</span>
                {i === current && <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-fg">지금</span>}
                <span className="num ml-auto text-xs text-subtle">
                  {ph.start} ~ {ph.end}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted">{ph.focus_ko}</p>
              <div className="mt-2 flex h-2.5 overflow-hidden rounded-full">
                {BLOCKS.filter((b) => ph.weekly_minutes[b]).map((b) => (
                  <span key={b} style={{ width: `${(ph.weekly_minutes[b] / total) * 100}%`, background: BLOCK_COLOR[b] }} title={`${BLOCK_LABEL[b]} ${ph.weekly_minutes[b]}분/주`} />
                ))}
              </div>
              <div className="num mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
                {BLOCKS.filter((b) => ph.weekly_minutes[b]).map((b) => (
                  <span key={b} className="flex items-center gap-1">
                    <span className="size-2 rounded-full" style={{ background: BLOCK_COLOR[b] }} />
                    {BLOCK_LABEL[b]} {Math.round(ph.weekly_minutes[b] / 7)}분/일
                  </span>
                ))}
              </div>
              {ph.targets_ko.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs">
                  {ph.targets_ko.map((x, j) => (
                    <li key={j} className="flex gap-1.5">
                      <Target className="mt-0.5 size-3 shrink-0 text-accent" /> {x}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </CardBody>
    </Card>
  )
}

function Routine({ plan }: { plan: StudyPlan }) {
  if (!plan.routine.length) return null
  return (
    <Card>
      <CardHeader title="한 주 루틴" hint="오늘의 코스는 이 루틴과 이번 주 진행에 맞춰 바뀌어요" />
      <CardBody className="grid gap-2 split:grid-cols-2 xl:grid-cols-4">
        {plan.routine.map((d) => (
          <div key={d.day} className={cn('rounded-xl border p-3', ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'][(new Date().getDay() + 6) % 7] === d.day && 'border-accent')}>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="font-semibold">{DAY_LABEL[d.day]}</span>
              <span className="num text-xs text-subtle">{d.items.reduce((s, i) => s + i.minutes, 0)}분</span>
            </div>
            <ul className="space-y-1">
              {d.items.map((it, i) => (
                <li key={i} className="flex gap-2 text-xs">
                  <span className="mt-1 size-2 shrink-0 rounded-full" style={{ background: BLOCK_COLOR[it.block] }} />
                  <span>
                    <span className="num font-medium">{it.minutes}분</span> {it.what_ko}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardBody>
    </Card>
  )
}

export function BookRow({ b }: { b: BookSummary }) {
  const [label, cls] = BOOK_STATE[b.status] ?? ['', '']
  const p = b.progress
  return (
    <Link to={`/plan/books/${b.id}`} className="lift flex items-center gap-3 rounded-xl border bg-surface-2/40 p-3">
      <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
        {b.status === 'researching' ? <Loader2 className="size-5 animate-spin" /> : <BookMarked className="size-5" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold">{b.title}</span>
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', cls)}>{label}</span>
        </div>
        {p.total > 0 ? (
          <>
            <div className="num mt-0.5 text-xs text-muted">
              {p.done}/{p.total} {b.unit_label} · 주 {b.days_per_week}회 × {b.minutes_per_session}분
              {b.status === 'active' && p.state === 'behind' && <span className="ml-1 text-warn">· {p.behind_days}일 늦음</span>}
              {b.status === 'ready' && b.start_date && <span className="ml-1 text-accent">· {b.start_date.slice(5).replace('-', '/')} 시작 예정</span>}
              {b.end_date && b.status === 'active' && <span className="ml-1">· {b.end_date.slice(5).replace('-', '/')} 끝</span>}
            </div>
            <Progress value={p.done / p.total} marker={b.status === 'active' ? p.expected / p.total : null} className="mt-1.5 h-1.5" />
          </>
        ) : (
          <div className="mt-0.5 text-xs text-muted">{b.status === 'researching' ? '웹에서 교재 정보를 조사하는 중…' : b.error || b.summary_ko}</div>
        )}
      </div>
      <ArrowRight className="size-4 shrink-0 text-subtle" />
    </Link>
  )
}

function BooksCard({ books }: { books: BookSummary[] }) {
  const [open, setOpen] = useState(false)
  return (
    <Card>
      <CardHeader
        title="교재"
        hint="책을 추가하면 AI가 조사해서 기간·강도를 제안하고, 계획과 오늘의 코스에 넣어요"
        action={
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            <BookPlus /> 책 추가
          </Button>
        }
      />
      <CardBody className="space-y-2">
        {books.length ? books.map((b) => <BookRow key={b.id} b={b} />) : <p className="text-sm text-muted">아직 교재가 없어요. 토플 교재나 원서를 추가해 보세요.</p>}
      </CardBody>
      <AddBookDialog open={open} onClose={() => setOpen(false)} />
    </Card>
  )
}

export function PlanPage() {
  const { data } = usePlan()
  const [makeOpen, setMakeOpen] = useState(false)
  const [evOpen, setEvOpen] = useState(false)
  const qc = useQueryClient()
  if (!data) return <PageSkeleton />
  const { plan, track, generating, failed } = data
  const f = track?.forecast ?? data.forecast!
  const books = track?.books ?? []
  return (
    <div className="space-y-5">
      <PageHeader
        title="계획"
        subtitle={`목표일 ${f.target_date} · D-${f.days_left}${plan ? ` · ${plan.created_at.slice(0, 10)}에 만든 계획` : ''}`}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => setEvOpen(true)}>
              시험 점수 넣기
            </Button>
            <Button size="sm" variant={plan ? 'secondary' : 'primary'} disabled={!!generating} onClick={() => setMakeOpen(true)}>
              {generating ? <Loader2 className="animate-spin" /> : plan ? <RefreshCw /> : <Sparkles />} {plan ? '다시 짜기' : '계획 만들기'}
            </Button>
          </>
        }
      />

      {generating && (
        <Card className="border-accent/40">
          <CardBody className="flex items-center gap-3 pt-5">
            <Loader2 className="size-5 animate-spin text-accent" />
            <div>
              <div className="font-semibold">AI가 계획을 짜고 있어요 (1–3분)</div>
              <p className="text-sm text-muted">다른 화면으로 가도 계속 진행돼요.</p>
            </div>
          </CardBody>
        </Card>
      )}
      {failed && (
        <Card className="border-bad/40">
          <CardBody className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-center">
            <AlertTriangle className="size-5 shrink-0 text-bad" />
            <div className="flex-1">
              <div className="font-semibold">계획을 만들지 못했어요</div>
              <p className="text-sm text-muted">{failed.error}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={async () => {
                await del('/plan/failed')
                qc.invalidateQueries({ queryKey: ['plan'] })
              }}>
                닫기
              </Button>
              <Button size="sm" variant="primary" onClick={() => setMakeOpen(true)}>
                다시 시도
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {!plan && !generating && (
        <Card className="overflow-hidden border-accent/40">
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
            <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent">
              <CalendarRange className="size-6" />
            </div>
            <div className="flex-1">
              <div className="font-semibold">목표일까지의 공부 계획을 AI가 짜 드려요</div>
              <p className="mt-1 text-sm text-muted">단계별 주간 시간, 마일스톤, 한 주 루틴, 교재 일정까지. 오늘의 코스가 계획을 따라가고, 계획대로 가는지 매주 확인해요.</p>
            </div>
            <Button variant="primary" onClick={() => setMakeOpen(true)}>
              계획 만들기 <ArrowRight />
            </Button>
          </div>
        </Card>
      )}

      <ForecastCard f={f} detail={data.levels.detail} rate={data.levels.rate} />

      {plan && track && (
        <>
          {(plan.summary_ko || plan.realistic_goal_ko) && (
            <Card>
              <CardHeader title="계획 요약" />
              <CardBody className="space-y-3 text-[15px] leading-relaxed">
                {plan.summary_ko && <p>{plan.summary_ko}</p>}
                {plan.realistic_goal_ko && (
                  <p className="rounded-xl bg-surface-2/60 px-3.5 py-2.5 text-sm">
                    <CheckCircle2 className="mr-1.5 inline size-4 text-good" />
                    {plan.realistic_goal_ko}
                  </p>
                )}
                <div className="grid grid-cols-4 gap-1.5">
                  {SKILLS.map(([k, label]) => (
                    <div key={k} className="rounded-lg border bg-surface-2/40 px-2 py-1.5 text-center">
                      <div className="text-[11px] text-subtle">{label} 목표</div>
                      <div className="num font-semibold">{cefr(plan.goal[k])}</div>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}
          <div className="grid gap-5 split:grid-cols-2">
            <WeekCard t={track} />
            <div className="space-y-5">
              <CheckinCard data={data} />
              <BooksCard books={books} />
            </div>
          </div>
          <div className="grid gap-5 split:grid-cols-2">
            <Phases plan={plan} current={track.phase?.index ?? null} />
            <Milestones t={track} />
          </div>
          <Routine plan={plan} />
          {plan.tips_ko.length > 0 && (
            <Card>
              <CardHeader title="코치 팁" />
              <CardBody>
                <ul className="space-y-1.5 text-sm">
                  {plan.tips_ko.map((tip, i) => (
                    <li key={i} className="flex gap-2">
                      <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" /> {tip}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </>
      )}
      {!plan && <NoPlanBooks />}

      <p className="text-center text-xs text-subtle">
        <Link to="/stats" className="underline">
          기록(출석·입력 시간·배지) 보기
        </Link>
      </p>
      <MakePlanDialog open={makeOpen} onClose={() => setMakeOpen(false)} again={!!plan} />
      <EvidenceDialog open={evOpen} onClose={() => setEvOpen(false)} />
    </div>
  )
}

/** Without a plan the plan response has no track (and so no book list): load the books on their own. */
function NoPlanBooks() {
  const { data } = useBooks()
  return <BooksCard books={data ?? []} />
}

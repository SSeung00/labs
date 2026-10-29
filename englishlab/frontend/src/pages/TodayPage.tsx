import { useState } from 'react'
import { Link } from 'react-router'
import { motion } from 'framer-motion'
import { ArrowRight, BarChart3, BookMarked, BookOpen, CalendarCheck, Check, Compass, Flag, Flame, Headphones, Layers, MessagesSquare, NotebookPen, PenLine, Plus, Snowflake, Sparkles, Tv } from 'lucide-react'
import { useCoachTip, useLogActivity, useToday } from '@/api/el'
import { usePlan } from '@/api/plan'
import type { Block, Levels } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Progress } from '@/components/ui/controls'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label } from '@/components/ui/input'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { PageSkeleton } from '@/components/layout/PageSkeleton'
import { cefr } from '@/lib/level'
import { cn } from '@/lib/utils'

const ICONS = { review: Layers, read: BookOpen, listen: Headphones, talk: MessagesSquare, write: PenLine, book: BookMarked } as const

function Ring({ value, size = 132, children }: { value: number; size?: number; children?: React.ReactNode }) {
  const r = (size - 14) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(1, value))
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={12} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={v >= 1 ? 'var(--good)' : 'var(--accent)'}
          strokeWidth={12}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - v) }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  )
}

function BlockRow({ b }: { b: Block }) {
  const Icon = ICONS[b.key]
  const ratio = b.target ? b.done / b.target : 0
  return (
    <Link to={b.link} className="lift flex items-center gap-3 rounded-2xl border bg-surface-2/40 p-3.5">
      <div className={cn('grid size-11 shrink-0 place-items-center rounded-xl', b.complete ? 'bg-good/15 text-good' : 'bg-accent-soft text-accent')}>
        {b.complete ? <Check className="size-5" /> : <Icon className="size-5" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-semibold">{b.title}</span>
          <span className="num text-xs text-muted">
            {Math.round(b.done)} / {b.target}분
          </span>
        </div>
        <div className="truncate text-xs text-subtle">{b.desc}</div>
        <Progress value={ratio} className="mt-2 h-1.5" color={b.complete ? 'var(--good)' : undefined} />
      </div>
      <ArrowRight className="size-4 shrink-0 text-subtle" />
    </Link>
  )
}

export function LevelChips({ levels }: { levels: Levels }) {
  const items: [string, keyof Levels['labels']][] = [
    ['읽기', 'reading'],
    ['듣기', 'listening'],
    ['말하기', 'speaking'],
    ['쓰기', 'writing'],
    ['어휘', 'vocab'],
  ]
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {items.map(([label, k]) => (
        <div key={k} className="rounded-xl border bg-surface-2/50 px-1 py-2 text-center">
          <div className="text-[11px] text-subtle">{label}</div>
          <div className="num text-base font-bold">{levels.labels[k]}</div>
        </div>
      ))}
    </div>
  )
}

function ExternalLog() {
  const [open, setOpen] = useState(false)
  const [minutes, setMinutes] = useState('40')
  const [note, setNote] = useState('')
  const [subs, setSubs] = useState('영어 자막')
  const log = useLogActivity()
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Tv /> 넷플릭스·팟캐스트 기록
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="앱 밖에서 듣기 기록" description="넷플릭스·유튜브·팟캐스트도 입력 시간에 들어가요">
        <div className="space-y-4 p-5">
          <div>
            <Label>무엇을 봤나요/들었나요?</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: Friends S1E3, Huberman Lab" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>시간 (분)</Label>
              <Input type="number" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </div>
            <div>
              <Label>자막</Label>
              <div className="flex gap-1">
                {['한국어 자막', '영어 자막', '자막 없음'].map((s) => (
                  <button
                    key={s}
                    onClick={() => setSubs(s)}
                    className={cn('h-10 flex-1 rounded-lg border px-1 text-[11px] font-medium', subs === s ? 'border-accent bg-accent-soft text-accent' : 'text-muted')}
                  >
                    {s.replace(' 자막', '')}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-subtle">
            한국어 자막 → 영어 자막 → 자막 없음 순서로 줄여가는 게 목표예요. 한국어 자막으로 본 시간은 입력 시간의 절반만 쳐요.
          </p>
          <Button
            variant="primary"
            className="w-full"
            disabled={!Number(minutes) || log.isPending}
            onClick={() => {
              const m = Number(minutes)
              log.mutate(
                { kind: 'external', minutes: subs === '한국어 자막' ? m / 2 : m, note: `${note || '외부 듣기'} · ${subs} · ${m}분` },
                { onSuccess: () => setOpen(false) },
              )
            }}
          >
            <Plus /> 기록하기
          </Button>
        </div>
      </Dialog>
    </>
  )
}

const STATE_TEXT = { ahead: '앞서감', on_track: '계획대로', slightly_behind: '조금 뒤처짐', behind: '뒤처짐', none: '기록 없음' } as const
const STATE_CLS = {
  ahead: 'bg-good/15 text-good',
  on_track: 'bg-good/15 text-good',
  slightly_behind: 'bg-warn/15 text-warn',
  behind: 'bg-bad/15 text-bad',
  none: 'bg-surface-3 text-muted',
} as const

/** This week against the plan, the next milestone and the forecast — or an invitation to make a plan. */
function PlanCard() {
  const { data } = usePlan()
  if (!data) return null
  const t = data.track
  if (!data.plan || !t) {
    return (
      <Link to="/plan" className="lift flex items-center gap-3 rounded-card border bg-surface p-4 shadow-card">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <CalendarCheck className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{data.generating ? 'AI가 공부 계획을 짜는 중…' : '공부 계획 만들기'}</div>
          <div className="text-xs text-muted">목표일까지 단계·주간 시간·교재 일정을 짜고, 오늘의 코스가 그 계획을 따라가요.</div>
        </div>
        <ArrowRight className="size-4 shrink-0 text-subtle" />
      </Link>
    )
  }
  const next = t.milestones.find((m) => !m.past)
  const f = t.forecast
  return (
    <Link to="/plan" className="lift block rounded-card border bg-surface p-4 shadow-card">
      <div className="flex items-center gap-2">
        <CalendarCheck className="size-4 text-accent" />
        <span className="text-[13px] font-semibold text-muted">계획 · {t.phase?.name_ko ?? ''}</span>
        <span className={cn('ml-auto rounded-full px-2 py-0.5 text-xs font-semibold', STATE_CLS[t.verdict.state])}>{STATE_TEXT[t.verdict.state]}</span>
      </div>
      <div className="mt-3 flex items-end gap-4">
        <div>
          <div className="text-xs text-subtle">이번 주</div>
          <div className="num text-lg font-bold">
            {Math.round((t.week.done / 60) * 10) / 10} / {Math.round((t.week.target / 60) * 10) / 10}시간
          </div>
        </div>
        {f.overall.pace != null && (
          <div>
            <div className="text-xs text-subtle">목표일 예상</div>
            <div className="num text-lg font-bold">
              {cefr(f.overall.pace)} <span className="text-xs font-normal text-subtle">목표 {cefr(f.overall.goal)}</span>
            </div>
          </div>
        )}
      </div>
      <Progress value={t.week.target ? t.week.done / t.week.target : 0} marker={t.week.target ? t.week.expected / t.week.target : null} className="mt-2.5 h-1.5" />
      {next && (
        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-muted">
          <Flag className={cn('size-3.5', next.status === 'at_risk' ? 'text-warn' : 'text-good')} />
          <span className="num">{next.date.slice(5).replace('-', '/')}</span> {next.title_ko} ·{' '}
          {next.status === 'on_track' ? '도달 예상' : next.status === 'with_plan' ? '계획대로 하면 도달' : '부족 예상'}
        </div>
      )}
    </Link>
  )
}

export function TodayPage() {
  const { data, isPending } = useToday()
  const tip = useCoachTip(!!data && !data.needs_placement && !data.coach_tip)
  if (isPending || !data) return <PageSkeleton />
  const goalRatio = data.minutes / data.goal_minutes
  const coach = data.coach_tip ?? tip.data?.text
  const hour = new Date().getHours()
  const hello = hour < 6 ? '늦은 밤이에요' : hour < 12 ? '좋은 아침이에요' : hour < 18 ? '오늘도 영어 한 걸음' : '오늘 하루 마무리'

  return (
    <Stagger className="space-y-5">
      <StaggerItem>
        <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">{hello}</h1>
        <p className="mt-1 text-sm text-muted">
          {data.streak.studied_today ? '오늘 출석 완료! 목표까지 이어가 볼까요?' : data.streak.at_risk ? `오늘 공부하면 ${data.streak.current + 1}일 연속이에요.` : '오늘의 첫 공부를 시작해 볼까요?'}
        </p>
      </StaggerItem>

      {data.needs_placement && (
        <StaggerItem>
          <Card className="overflow-hidden border-accent/40">
            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
              <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent">
                <Compass className="size-6" />
              </div>
              <div className="flex-1">
                <div className="font-semibold">먼저 레벨 진단부터 해요 (약 25분)</div>
                <p className="mt-1 text-sm text-muted">어휘·읽기·듣기·말하기·쓰기를 재서, 글 난이도와 AI 대화 수준을 지금 실력에 맞춰요.</p>
              </div>
              <Link to="/placement">
                <Button variant="primary">
                  진단 시작 <ArrowRight />
                </Button>
              </Link>
            </div>
          </Card>
        </StaggerItem>
      )}

      <div className="grid gap-5 split:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <StaggerItem>
          <Card>
            <CardBody className="flex items-center gap-5 pt-5">
              <Ring value={goalRatio}>
                <div>
                  <div className="num text-2xl font-bold">{Math.round(data.minutes)}</div>
                  <div className="text-xs text-subtle">/ {data.goal_minutes}분</div>
                </div>
              </Ring>
              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex items-center gap-2">
                  <Flame className={cn('size-6', data.streak.studied_today ? 'text-warn' : 'text-subtle')} />
                  <div>
                    <div className="num text-lg font-bold leading-tight">{data.streak.current}일 연속</div>
                    <div className="text-xs text-subtle">최장 {data.streak.longest}일</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted">
                  <Snowflake className="size-4 text-fitness" /> 프리즈 {data.streak.freezes}개 (매주 2개)
                </div>
                <div className="text-sm text-muted">
                  {data.goal_met ? <span className="font-semibold text-good">오늘 목표 달성!</span> : <>목표까지 {Math.max(0, Math.round(data.goal_minutes - data.minutes))}분</>}
                </div>
              </div>
            </CardBody>
          </Card>
        </StaggerItem>

        <StaggerItem>
          <Card className="h-full">
            <CardHeader title="AI 코치 한마디" action={<Sparkles className="size-4 text-accent" />} />
            <CardBody>
              {coach ? (
                <p className="text-[15px] leading-relaxed">{coach}</p>
              ) : data.needs_placement ? (
                <p className="text-sm text-muted">진단을 마치면 매일 오늘 할 일을 짚어 드릴게요.</p>
              ) : tip.isError ? (
                <p className="text-sm text-subtle">{(tip.error as Error).message}</p>
              ) : (
                <div className="space-y-2">
                  <div className="shimmer h-4 w-full rounded" />
                  <div className="shimmer h-4 w-2/3 rounded" />
                </div>
              )}
              {data.levels.overall != null && (
                <div className="mt-4">
                  <LevelChips levels={data.levels} />
                </div>
              )}
            </CardBody>
          </Card>
        </StaggerItem>
      </div>

      <StaggerItem>
        <Card>
          <CardHeader
            title="오늘의 코스"
            hint={`하루 ${data.blocks.reduce((s, b) => s + b.target, 0)}분 · ${data.has_plan ? '공부 계획의 이번 주 목표에 맞춘 코스' : '입력(읽기+듣기) 중심 기본 코스'}`}
            action={<ExternalLog />}
          />
          <CardBody className="grid gap-2.5 split:grid-cols-2">
            {data.blocks.filter((b) => b.target > 0 || b.done > 0).map((b) => (
              <BlockRow key={b.key + (b.book_id ?? '')} b={b} />
            ))}
          </CardBody>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <PlanCard />
      </StaggerItem>

      <StaggerItem className="grid grid-cols-3 gap-3">
        <Link to="/stats" className="rounded-card border bg-surface p-3.5 shadow-card">
          <div className="text-xs text-muted">아는 단어 (추정)</div>
          <div className="num mt-1 text-lg font-bold">{data.needs_placement ? '진단 전' : data.known_words.toLocaleString()}</div>
        </Link>
        <Link to="/stats" className="rounded-card border bg-surface p-3.5 shadow-card">
          <div className="text-xs text-muted">누적 입력</div>
          <div className="num mt-1 text-lg font-bold">{data.input_hours}시간</div>
        </Link>
        <Link to="/words" className="rounded-card border bg-surface p-3.5 shadow-card">
          <div className="text-xs text-muted">복습할 카드</div>
          <div className="num mt-1 text-lg font-bold">{data.cards.due}</div>
        </Link>
      </StaggerItem>

      <StaggerItem className="grid grid-cols-3 gap-3">
        {[
          ['/write', PenLine, '쓰기 첨삭'],
          ['/notes', NotebookPen, '손글씨 노트'],
          ['/stats', BarChart3, '기록·배지'],
        ].map(([to, Icon, label]) => {
          const I = Icon as typeof PenLine
          return (
            <Link key={to as string} to={to as string} className="lift flex items-center gap-2 rounded-card border bg-surface px-3.5 py-3 text-sm font-medium shadow-card">
              <I className="size-4 text-accent" /> {label as string}
            </Link>
          )
        })}
      </StaggerItem>
    </Stagger>
  )
}

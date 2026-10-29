import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, Check, ExternalLink, Loader2, NotebookPen, Pause, Play, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { activateBook, deleteBook, editBook, getInk, logBookSession, putInk, retryBook, useBook, useRefreshPlan } from '@/api/plan'
import type { BookDetail, Stroke } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Progress, Segmented, Textarea } from '@/components/ui/controls'
import { Input, Label } from '@/components/ui/input'
import { PageSkeleton } from '@/components/layout/PageSkeleton'
import { InkPad } from '@/components/ink/InkPad'
import { useToday } from '@/api/el'
import { cefr } from '@/lib/level'
import { cn } from '@/lib/utils'

const FIT: Record<string, [string, string]> = {
  too_easy: ['너무 쉬움', 'bg-surface-3 text-muted'],
  slightly_easy: ['약간 쉬움', 'bg-good/15 text-good'],
  just_right: ['지금 딱 맞음', 'bg-good/15 text-good'],
  challenging: ['도전적', 'bg-warn/15 text-warn'],
  too_hard: ['아직 어려움', 'bg-bad/15 text-bad'],
}
const SKILL_KO: Record<string, string> = { reading: '읽기', listening: '듣기', speaking: '말하기', writing: '쓰기', vocab: '어휘', grammar: '문법', mixed: '종합' }

function Schedule({ b, onSaved }: { b: BookDetail; onSaved: () => void }) {
  const rec = b.info.recommended
  const [start, setStart] = useState(b.start_date ?? new Date().toISOString().slice(0, 10))
  const [days, setDays] = useState(String(b.days_per_week))
  const [mins, setMins] = useState(String(b.minutes_per_session))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const avg = b.units.length ? b.units.reduce((s, u) => s + u.minutes, 0) / b.units.length : 0
  const remaining = b.units.reduce((s, u, i) => s + (b.units_done.includes(i) ? 0 : u.minutes), 0)
  const weeks = remaining / Math.max(1, Number(days) * Number(mins))
  return (
    <Card>
      <CardHeader title="일정" hint={rec ? `AI 추천: ${rec.weeks}주 · 주 ${rec.days_per_week}회 × ${rec.minutes_per_session}분 — ${rec.start_ko}` : undefined} />
      <CardBody className="space-y-3">
        {rec?.intensity_ko && <p className="text-sm text-muted">{rec.intensity_ko}</p>}
        {b.status === 'ready' && b.start_date && (
          <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">계획에 따라 {b.start_date}부터 자동으로 시작돼요. 지금 시작하려면 시작일을 오늘로 바꾸고 '계획에 넣기'를 누르세요.</p>
        )}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label>시작일</Label>
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <Label>주 몇 회</Label>
            <Input type="number" min={1} max={7} value={days} onChange={(e) => setDays(e.target.value)} />
          </div>
          <div>
            <Label>1회 (분)</Label>
            <Input type="number" min={10} max={240} step={5} value={mins} onChange={(e) => setMins(e.target.value)} />
          </div>
        </div>
        {b.units.length > 0 && (
          <p className="num text-sm text-muted">
            남은 {b.units.length - b.units_done.length}개 {b.unit_label} (약 {Math.round(remaining / 60)}시간) → 약 {Math.ceil(weeks)}주, {avg ? `한 주에 ${((Number(days) * Number(mins)) / avg).toFixed(1)}개` : ''}
          </p>
        )}
        {err && <p className="text-sm text-bad">{err}</p>}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={busy || !b.units.length}
            onClick={async () => {
              setBusy(true)
              setErr(null)
              try {
                await activateBook(b.id, { start, days_per_week: Number(days), minutes_per_session: Number(mins) })
                onSaved()
              } catch (e) {
                setErr((e as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Check />} {b.status === 'active' ? '일정 바꾸기' : '계획에 넣기'}
          </Button>
          {b.status === 'active' && (
            <Button
              variant="secondary"
              onClick={async () => {
                await editBook(b.id, { status: 'paused' })
                onSaved()
              }}
            >
              <Pause /> 잠시 멈춤
            </Button>
          )}
          {b.status === 'paused' && (
            <Button
              variant="secondary"
              onClick={async () => {
                await editBook(b.id, { status: 'active' })
                onSaved()
              }}
            >
              <Play /> 다시 시작
            </Button>
          )}
        </div>
        <p className="text-xs text-subtle">계획에 넣으면 '오늘의 코스'에 이 책 블록이 생기고, 그 시간만큼 같은 기능(예: 리딩 교재 → 읽기)의 시간이 줄어요.</p>
      </CardBody>
    </Card>
  )
}

function LogSession({ b, onSaved }: { b: BookDetail; onSaved: () => void }) {
  const next = b.progress.next_unit
  const [mins, setMins] = useState(String(b.minutes_per_session))
  const [units, setUnits] = useState<number[]>(next != null ? [next] : [])
  const [mode, setMode] = useState<'none' | 'score' | 'band'>('none')
  const [right, setRight] = useState('')
  const [total, setTotal] = useState('')
  const [band, setBand] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => setUnits(next != null ? [next] : []), [next])
  const score = mode === 'score' && Number(total) > 0 ? Math.min(1, Number(right) / Number(total)) : null
  return (
    <Card>
      <CardHeader title="공부 기록" hint="시간은 오늘 공부 시간에, 점수는 실력 추정에 들어가요" />
      <CardBody className="space-y-3">
        <div>
          <Label>끝낸 {b.unit_label}</Label>
          <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
            {b.units.map((u, i) =>
              b.units_done.includes(i) ? null : (
                <button
                  key={i}
                  onClick={() => setUnits((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]))}
                  className={cn('rounded-full border px-3 py-1.5 text-xs', units.includes(i) ? 'border-accent bg-accent-soft text-accent' : 'text-muted')}
                >
                  {i + 1}. {u.title.length > 28 ? `${u.title.slice(0, 28)}…` : u.title}
                </button>
              ),
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>공부한 시간 (분)</Label>
            <Input type="number" inputMode="numeric" value={mins} onChange={(e) => setMins(e.target.value)} />
          </div>
          <div>
            <Label>점수</Label>
            <Segmented
              size="sm"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'none', label: '없음' },
                { value: 'score', label: '맞은 개수' },
                { value: 'band', label: '모의고사 밴드' },
              ]}
            />
          </div>
        </div>
        {mode === 'score' && (
          <div className="flex items-center gap-2 text-sm">
            <Input className="w-20" type="number" inputMode="numeric" value={right} onChange={(e) => setRight(e.target.value)} placeholder="맞음" />
            <span>/</span>
            <Input className="w-20" type="number" inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="전체" />
            {score != null && <span className="num text-muted">{Math.round(score * 100)}%</span>}
          </div>
        )}
        {mode === 'band' && (
          <div className="flex items-center gap-2 text-sm">
            <Input className="w-24" type="number" step="0.5" min={1} max={6} value={band} onChange={(e) => setBand(e.target.value)} placeholder="1–6" />
            <span className="text-muted">전체 섹션을 시험처럼 푼 경우</span>
          </div>
        )}
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="메모 (예: 추론 문제 3개 틀림)" />
        <Button
          variant="primary"
          className="w-full"
          disabled={busy || !(Number(mins) >= 0)}
          onClick={async () => {
            setBusy(true)
            try {
              await logBookSession(b.id, { minutes: Number(mins) || 0, units, score, band: mode === 'band' && band ? Number(band) : null, note: note || undefined })
              setRight('')
              setTotal('')
              setBand('')
              setNote('')
              onSaved()
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Plus />} 기록하기
        </Button>
        {b.sessions.length > 0 && (
          <div className="space-y-1 border-t pt-3">
            {b.sessions.slice(0, 8).map((s) => (
              <div key={s.id} className="num flex flex-wrap gap-x-2 text-xs text-muted">
                <span>{s.day.slice(5).replace('-', '/')}</span>
                <span>{Math.round(s.minutes)}분</span>
                {s.units.length > 0 && <span>{s.units.map((u) => u + 1).join(', ')}번</span>}
                {s.score != null && <span className="text-text">{Math.round(s.score * 100)}%</span>}
                {s.band != null && <span className="text-text">밴드 {s.band}</span>}
                {s.note && <span className="text-subtle">{s.note}</span>}
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function Units({ b, onSaved }: { b: BookDetail; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const done = new Set(b.units_done)
  return (
    <Card>
      <CardHeader
        title={`목차 (${b.units.length}개 ${b.unit_label})`}
        hint={b.info.structure_confidence === 'estimated' ? '목차를 찾지 못해 AI가 추정한 구성이에요. 실제 목차로 고쳐 주세요.' : b.info.structure_confidence === 'partial' ? '일부만 확인된 목차예요.' : '조사한 실제 목차예요.'}
        action={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setText(b.units.map((u) => `${u.title} | ${u.minutes}`).join('\n'))
              setEditing(!editing)
            }}
          >
            {editing ? '취소' : '고치기'}
          </Button>
        }
      />
      <CardBody>
        {editing ? (
          <div className="space-y-2">
            <p className="text-xs text-subtle">한 줄에 하나씩 '제목 | 분' 형식으로 써 주세요.</p>
            <Textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" />
            <Button
              variant="primary"
              onClick={async () => {
                const units = text
                  .split('\n')
                  .map((l) => l.trim())
                  .filter(Boolean)
                  .map((l) => {
                    const [t, m] = l.split('|').map((x) => x.trim())
                    return { title: t, minutes: Number(m) || 45 }
                  })
                await editBook(b.id, { units })
                setEditing(false)
                onSaved()
              }}
            >
              저장
            </Button>
          </div>
        ) : (
          <ol className="grid gap-1 split:grid-cols-2">
            {b.units.map((u, i) => (
              <li key={i}>
                <button
                  onClick={async () => {
                    const next = done.has(i) ? b.units_done.filter((x) => x !== i) : [...b.units_done, i]
                    await editBook(b.id, { units_done: next })
                    onSaved()
                  }}
                  className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2', b.progress.next_unit === i && 'bg-accent-soft/50')}
                >
                  <span className={cn('grid size-5 shrink-0 place-items-center rounded border', done.has(i) ? 'border-good bg-good text-white' : 'border-border-strong')}>
                    {done.has(i) && <Check className="size-3.5" />}
                  </span>
                  <span className={cn('min-w-0 flex-1 truncate', done.has(i) && 'text-subtle line-through')}>
                    {i + 1}. {u.title}
                  </span>
                  <span className="num shrink-0 text-xs text-subtle">{u.minutes}분</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  )
}

function BookNotes({ bookId }: { bookId: number }) {
  const [initial, setInitial] = useState<Stroke[] | null>(null)
  const [height, setHeight] = useState(1400)
  useEffect(() => {
    getInk('book', bookId).then((d) => {
      setInitial(d.strokes ?? [])
      setHeight(d.height || 1400)
    })
  }, [bookId])
  return (
    <Card className="overflow-hidden">
      <CardHeader title="교재 노트 (손글씨)" hint="풀이 메모, 틀린 문제 정리 — S Pen으로 바로 써져요" action={<NotebookPen className="size-4 text-accent" />} />
      <div className="mt-3 border-t">
        {initial ? <InkPad initial={initial} initialHeight={height} onSave={(d) => void putInk('book', bookId, { ...d, highlights: [] })} /> : <div className="p-4 text-sm text-muted">불러오는 중…</div>}
      </div>
    </Card>
  )
}

export function BookPage() {
  const id = Number(useParams().id)
  const { data: b, refetch } = useBook(id)
  const { data: today } = useToday()
  const refreshPlan = useRefreshPlan()
  const qc = useQueryClient()
  const nav = useNavigate()
  if (!b) return <PageSkeleton />
  const saved = () => {
    void refetch()
    refreshPlan()
    qc.invalidateQueries({ queryKey: ['book', id] })
  }
  const info = b.info
  const [fitLabel, fitCls] = FIT[info.fit ?? ''] ?? ['', '']
  const myLevel = today?.levels.levels[(b.skill as 'reading') ?? 'reading'] ?? today?.levels.overall
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => nav('/plan')} aria-label="계획으로">
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold tracking-tight">{b.title}</h1>
          <div className="flex flex-wrap gap-x-2 text-xs text-subtle">
            {(info.author || b.author) && <span>{info.author || b.author}</span>}
            {info.publisher && info.publisher !== (info.author || b.author) && <span>{info.publisher}</span>}
            {info.edition && <span>{info.edition}</span>}
            {info.year && <span>{info.year}</span>}
            <span>{SKILL_KO[b.skill] ?? b.skill}</span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="교재 삭제"
          onClick={async () => {
            if (!confirm('이 교재와 기록을 삭제할까요?')) return
            await deleteBook(b.id)
            refreshPlan()
            nav('/plan')
          }}
        >
          <Trash2 />
        </Button>
      </div>

      {b.status === 'researching' && (
        <Card className="border-accent/40">
          <CardBody className="flex items-center gap-3 pt-5">
            <Loader2 className="size-5 animate-spin text-accent" />
            <div>
              <div className="font-semibold">웹에서 교재를 조사하고 있어요 (보통 1–3분)</div>
              <p className="text-sm text-muted">판·출판연도, 시험 형식이 최신인지, 수준과 목차, 추천 기간과 강도를 찾고 있어요. 다른 화면으로 가도 계속돼요.</p>
            </div>
          </CardBody>
        </Card>
      )}
      {b.status === 'error' && (
        <Card className="border-bad/40">
          <CardBody className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-center">
            <AlertTriangle className="size-5 shrink-0 text-bad" />
            <div className="flex-1">
              <div className="font-semibold">조사하지 못했어요</div>
              <p className="text-sm text-muted">{b.error}</p>
            </div>
            <Button
              variant="primary"
              onClick={async () => {
                await retryBook(b.id)
                saved()
              }}
            >
              <RefreshCw /> 다시 조사
            </Button>
          </CardBody>
        </Card>
      )}

      {info.summary_ko && (
        <div className="grid gap-5 split:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader title="AI 조사 결과" action={fitLabel && <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', fitCls)}>{fitLabel}</span>} />
            <CardBody className="space-y-3 text-sm leading-relaxed">
              <p className="text-[15px]">{info.summary_ko}</p>
              {!info.identified && <p className="rounded-lg bg-warn/10 px-3 py-2 text-warn">정확히 이 책을 찾지는 못했어요. 비슷한 책을 바탕으로 추정했어요 — 메모에 판·출판사를 적고 다시 조사해 보세요.</p>}
              {info.exam && (
                <div className="rounded-lg border px-3 py-2">
                  <div className="text-xs text-subtle">대상 시험</div>
                  <div className="font-medium">{info.exam}</div>
                  {info.format_note_ko && <p className="mt-1 text-muted">{info.format_note_ko}</p>}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-subtle">교재 수준</span>
                <span className="num rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium">
                  {cefr(info.level_min)} – {cefr(info.level_max)}
                </span>
                {myLevel != null && (
                  <>
                    <span className="text-xs text-subtle">내 {SKILL_KO[b.skill] ?? ''} 추정</span>
                    <span className="num rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">{cefr(myLevel)}</span>
                  </>
                )}
              </div>
              {info.fit_reason_ko && <p>{info.fit_reason_ko}</p>}
              {info.plan_fit_ko && <p className="rounded-lg bg-surface-2/60 px-3 py-2">{info.plan_fit_ko}</p>}
              {info.cautions_ko && info.cautions_ko.length > 0 && (
                <ul className="space-y-1">
                  {info.cautions_ko.map((c, i) => (
                    <li key={i} className="flex gap-2 text-warn">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" /> <span className="text-text">{c}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <div className="space-y-5">
            {info.method_ko && info.method_ko.length > 0 && (
              <Card>
                <CardHeader title="이렇게 공부해요" />
                <CardBody>
                  <ol className="space-y-1.5 text-sm">
                    {info.method_ko.map((m, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="num grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">{i + 1}</span>
                        {m}
                      </li>
                    ))}
                  </ol>
                </CardBody>
              </Card>
            )}
            {b.progress.total > 0 && (
              <Card>
                <CardHeader title="진도" hint={b.status === 'active' && b.end_date ? `${b.start_date} → ${b.end_date}` : undefined} />
                <CardBody className="space-y-2">
                  <div className="num flex items-baseline gap-2">
                    <span className="text-2xl font-bold">{b.progress.done}</span>
                    <span className="text-sm text-muted">/ {b.progress.total} {b.unit_label}</span>
                    {b.status === 'active' && (
                      <span className={cn('ml-auto text-sm font-medium', b.progress.state === 'behind' ? 'text-warn' : 'text-good')}>
                        {b.progress.state === 'behind' ? `${b.progress.behind_days}일 늦음` : b.progress.state === 'ahead' ? '앞서감' : b.progress.state === 'done' ? '완료' : '일정대로'}
                      </span>
                    )}
                  </div>
                  <Progress value={b.progress.done / b.progress.total} marker={b.status === 'active' ? b.progress.expected / b.progress.total : null} className="h-2" />
                  <p className="text-xs text-subtle">세로선 = 오늘까지 끝냈어야 할 위치</p>
                </CardBody>
              </Card>
            )}
            {info.sources && info.sources.length > 0 && (
              <Card>
                <CardHeader title="조사 출처" />
                <CardBody className="space-y-1">
                  {info.sources.slice(0, 8).map((s) => (
                    <a key={s} href={s} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 truncate text-xs text-accent underline">
                      <ExternalLink className="size-3 shrink-0" /> {s.replace(/^https?:\/\//, '').slice(0, 70)}
                    </a>
                  ))}
                </CardBody>
              </Card>
            )}
          </div>
        </div>
      )}

      {b.status !== 'researching' && b.status !== 'error' && (
        <>
          <div className="grid gap-5 split:grid-cols-2">
            <Schedule b={b} onSaved={saved} />
            <LogSession b={b} onSaved={saved} />
          </div>
          <Units b={b} onSaved={saved} />
          <BookNotes bookId={b.id} />
        </>
      )}
      <p className="text-center text-xs text-subtle">
        <Link to="/plan" className="underline">
          계획으로 돌아가기
        </Link>
      </p>
    </div>
  )
}

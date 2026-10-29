import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Check, Headphones, Loader2, Play, RotateCcw } from 'lucide-react'
import { api, post } from '@/api/client'
import { del, postForm, usePlacement, useProfile, useRefreshProgress, useUpdateProfile } from '@/api/el'
import type { PlacementResult, PlacementView, TtsClip } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Textarea } from '@/components/ui/controls'
import { Input, Label } from '@/components/ui/input'
import { RecordButton } from '@/components/RecordButton'
import { blobForm, playKey } from '@/lib/audio'
import { cn } from '@/lib/utils'
import { PlacementResultView } from './PlacementResultView'

const STEPS = [
  { key: 'self', label: '자기 평가' },
  { key: 'vocab', label: '어휘' },
  { key: 'reading', label: '읽기' },
  { key: 'listening', label: '듣기' },
  { key: 'speaking', label: '말하기' },
  { key: 'writing', label: '쓰기' },
] as const
type StepKey = (typeof STEPS)[number]['key'] | 'finish'

const CAN_DO = [
  ['a2_shop', '가게·식당에서 필요한 것을 영어로 요청하고 간단한 질문에 답할 수 있다'],
  ['b1_travel', '여행 중 생기는 대부분의 상황(길 찾기, 예약 변경, 문제 해결)을 영어로 처리할 수 있다'],
  ['b1_story', '최근 겪은 일이나 계획을 이유를 붙여 몇 분 동안 이어서 말할 수 있다'],
  ['b2_debate', '익숙한 주제로 원어민과 토론하며 내 의견을 장단점과 함께 설명할 수 있다'],
  ['b2_tv', '영어 자막을 켜면 미국 드라마의 대부분을 따라갈 수 있다'],
  ['c1_notv', '자막 없이 영화·드라마를 보며 농담이나 빠른 대화도 대부분 이해한다'],
  ['c1_academic', '내 전공 분야 학회 발표를 하고 예상 못 한 질문에도 즉석에서 답할 수 있다'],
  ['c2_nuance', '말투와 뉘앙스(비꼼, 완곡, 격식)를 상황에 맞게 골라 쓰고 알아챈다'],
] as const

function Stepper({ pl, step, setStep }: { pl: PlacementView; step: StepKey; setStep: (s: StepKey) => void }) {
  return (
    <div className="mb-5 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
      {STEPS.map((s, i) => {
        const done = pl.done.includes(s.key)
        return (
          <button
            key={s.key}
            onClick={() => pl.status === 'ready' && setStep(s.key)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium',
              step === s.key ? 'border-accent bg-accent-soft text-accent' : done ? 'text-good' : 'text-muted',
            )}
          >
            {done ? <Check className="size-3.5" /> : <span className="num">{i + 1}</span>}
            {s.label}
          </button>
        )
      })}
    </div>
  )
}

function ProfileForm({ onStart, starting }: { onStart: () => void; starting: boolean }) {
  const { data } = useProfile()
  const update = useUpdateProfile()
  const [interests, setInterests] = useState('')
  const [daily, setDaily] = useState('180')
  const [target, setTarget] = useState('2027-03-01')
  useEffect(() => {
    if (!data) return
    setInterests(data.profile.interests.join(', '))
    setDaily(String(data.profile.daily_minutes))
    setTarget(data.profile.target_date)
  }, [data])
  return (
    <Card>
      <CardBody className="space-y-4 pt-5">
        <div>
          <h2 className="text-lg font-semibold">레벨 진단</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            자기 평가 → 어휘 → 읽기 → 듣기(받아쓰기) → 말하기 → 쓰기 순서로 약 25분 걸려요. 문제는 관심사에 맞춰 AI가 새로 만들어요. 결과로
            영역별 CEFR 레벨과 TOEFL 밴드 추정, 집중할 점 3가지를 알려드려요.
          </p>
        </div>
        <div>
          <Label>관심사 (쉼표로 구분) — 읽기 자료와 대화 주제에 쓰여요</Label>
          <Input value={interests} onChange={(e) => setInterests(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>하루 공부 시간 (분)</Label>
            <Input type="number" value={daily} onChange={(e) => setDaily(e.target.value)} />
          </div>
          <div>
            <Label>목표 날짜</Label>
            <Input type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
          </div>
        </div>
        <Button
          variant="primary"
          className="w-full"
          disabled={starting || update.isPending}
          onClick={() =>
            update.mutate(
              { interests: interests.split(',').map((s) => s.trim()).filter(Boolean), daily_minutes: Number(daily) || 180, target_date: target },
              { onSuccess: onStart },
            )
          }
        >
          {starting ? <Loader2 className="animate-spin" /> : <ArrowRight />} 진단 시작
        </Button>
      </CardBody>
    </Card>
  )
}

function SelfStep({ pl, onDone }: { pl: PlacementView; onDone: () => void }) {
  const [ans, setAns] = useState<Record<string, boolean>>({})
  const qc = useQueryClient()
  return (
    <Card>
      <CardBody className="space-y-3 pt-5">
        <p className="text-sm text-muted">
          {pl.status === 'generating' ? 'AI가 문제를 만드는 동안(30초~1분) 아래 문장 중 지금 할 수 있는 것을 골라 주세요.' : '지금 할 수 있는 것을 골라 주세요.'}
        </p>
        {CAN_DO.map(([k, text]) => (
          <button
            key={k}
            onClick={() => setAns((a) => ({ ...a, [k]: !a[k] }))}
            className={cn('flex w-full items-start gap-3 rounded-xl border p-3 text-left text-sm', ans[k] ? 'border-accent bg-accent-soft' : '')}
          >
            <span className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border', ans[k] && 'border-accent bg-accent text-accent-fg')}>
              {ans[k] && <Check className="size-3.5" />}
            </span>
            {text}
          </button>
        ))}
        <Button
          variant="primary"
          className="w-full"
          onClick={async () => {
            await post(`/placement/${pl.id}/self`, { answers: Object.fromEntries(CAN_DO.map(([k]) => [k, !!ans[k]])) })
            qc.invalidateQueries({ queryKey: ['placement', pl.id] })
            onDone()
          }}
        >
          다음 <ArrowRight />
        </Button>
      </CardBody>
    </Card>
  )
}

function VocabStep({ pl, onDone }: { pl: PlacementView; onDone: () => void }) {
  const [known, setKnown] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const qc = useQueryClient()
  const words = pl.vocab ?? []
  return (
    <Card>
      <CardBody className="space-y-4 pt-5">
        <p className="text-sm leading-relaxed text-muted">
          <b className="text-text">뜻을 확실히 아는 단어만</b> 눌러 주세요. 실제로 없는 가짜 단어도 섞여 있어서, 찍으면 점수가 깎여요.
        </p>
        <div className="flex flex-wrap gap-2">
          {words.map((w) => (
            <button
              key={w}
              onClick={() => setKnown((k) => ({ ...k, [w]: !k[w] }))}
              className={cn('rounded-full border px-3.5 py-2 text-[15px] font-medium transition-colors', known[w] ? 'border-accent bg-accent text-accent-fg' : 'bg-surface-2/50')}
            >
              {w}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between text-sm text-muted">
          <span className="num">
            {Object.values(known).filter(Boolean).length} / {words.length} 선택
          </span>
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await post(`/placement/${pl.id}/vocab`, { answers: Object.fromEntries(words.map((w) => [w, !!known[w]])) })
              await qc.invalidateQueries({ queryKey: ['placement', pl.id] })
              setBusy(false)
              onDone()
            }}
          >
            다음 <ArrowRight />
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

function ReadingStep({ pl, onDone }: { pl: PlacementView; onDone: () => void }) {
  const passages = pl.reading ?? []
  const [idx, setIdx] = useState(0)
  const [ans, setAns] = useState<number[][]>(passages.map((p) => p.questions.map(() => -1)))
  const qc = useQueryClient()
  const p = passages[idx]
  if (!p) return null
  const complete = ans[idx].every((a) => a >= 0)
  return (
    <Card>
      <CardBody className="space-y-4 pt-5">
        <div className="flex items-center justify-between text-xs text-subtle">
          <span>
            지문 {idx + 1} / {passages.length}
          </span>
          <span>사전 없이 풀어 주세요</span>
        </div>
        <h3 className="text-lg font-semibold">{p.title}</h3>
        <div className="space-y-3 font-serif text-[17px] leading-8">
          {p.text.split(/\n\s*\n/).map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
        <div className="space-y-4 border-t pt-4">
          {p.questions.map((q, qi) => (
            <div key={qi}>
              <div className="mb-2 text-[15px] font-medium">
                {qi + 1}. {q.q}
              </div>
              <div className="grid gap-1.5">
                {q.choices.map((c, ci) => (
                  <button
                    key={ci}
                    onClick={() => setAns((a) => a.map((row, r) => (r === idx ? row.map((v, j) => (j === qi ? ci : v)) : row)))}
                    className={cn('rounded-lg border px-3 py-2 text-left text-sm', ans[idx][qi] === ci ? 'border-accent bg-accent-soft' : '')}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-between">
          <Button variant="ghost" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>
            <ArrowLeft /> 이전
          </Button>
          {idx < passages.length - 1 ? (
            <Button variant="primary" disabled={!complete} onClick={() => setIdx(idx + 1)}>
              다음 지문 <ArrowRight />
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={!complete}
              onClick={async () => {
                await post(`/placement/${pl.id}/reading`, { answers: ans })
                await qc.invalidateQueries({ queryKey: ['placement', pl.id] })
                onDone()
              }}
            >
              제출 <ArrowRight />
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  )
}

function ListeningStep({ pl, onDone }: { pl: PlacementView; onDone: () => void }) {
  const items = pl.dictation ?? []
  const [answers, setAnswers] = useState<string[]>(items.map(() => ''))
  const [plays, setPlays] = useState<number[]>(items.map(() => 0))
  const [loading, setLoading] = useState<number | null>(null)
  const qc = useQueryClient()
  const play = async (i: number) => {
    if (plays[i] >= 2) return
    setLoading(i)
    try {
      const clip = await post<TtsClip>(`/placement/${pl.id}/dictation/${i}/audio`)
      await playKey(clip.key)
      setPlays((p) => p.map((v, j) => (j === i ? v + 1 : v)))
    } finally {
      setLoading(null)
    }
  }
  return (
    <Card>
      <CardBody className="space-y-4 pt-5">
        <p className="text-sm text-muted">
          <Headphones className="mr-1 inline size-4" />
          문장을 듣고 들리는 대로 받아 써 주세요. 문장마다 <b className="text-text">두 번까지</b> 들을 수 있어요. 철자·문장부호는 크게 신경 쓰지 않아도 돼요.
        </p>
        {items.map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <Button size="icon" variant={plays[i] >= 2 ? 'ghost' : 'secondary'} disabled={plays[i] >= 2 || loading !== null} onClick={() => play(i)} aria-label="듣기">
              {loading === i ? <Loader2 className="animate-spin" /> : <Play />}
            </Button>
            <span className="num w-5 text-xs text-subtle">{i + 1}</span>
            <Input value={answers[i]} onChange={(e) => setAnswers((a) => a.map((v, j) => (j === i ? e.target.value : v)))} placeholder={plays[i] ? '들은 문장' : '먼저 들어 보세요'} autoComplete="off" autoCorrect="off" spellCheck={false} />
          </div>
        ))}
        <Button
          variant="primary"
          className="w-full"
          onClick={async () => {
            await post(`/placement/${pl.id}/listening`, { answers })
            await qc.invalidateQueries({ queryKey: ['placement', pl.id] })
            onDone()
          }}
        >
          제출 <ArrowRight />
        </Button>
      </CardBody>
    </Card>
  )
}

function SpeakingStep({ pl, onDone }: { pl: PlacementView; onDone: () => void }) {
  const prompts = pl.speaking ?? []
  const [results, setResults] = useState<({ text: string } | null)[]>(prompts.map(() => null))
  const [busy, setBusy] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const qc = useQueryClient()
  return (
    <Card>
      <CardBody className="space-y-5 pt-5">
        <p className="text-sm text-muted">TOEFL 'Take an Interview'처럼 질문마다 약 45초 동안 답해 주세요. 질문을 읽고 준비되면 녹음을 시작하세요.</p>
        {prompts.map((p, i) => (
          <div key={i} className="space-y-3 rounded-2xl border p-4">
            <div className="flex items-start gap-2">
              <span className="num mt-0.5 text-xs text-subtle">Q{i + 1}</span>
              <p className="flex-1 text-[15px] font-medium">{p.prompt}</p>
              <Button size="sm" variant="ghost" onClick={() => post<TtsClip>('/tts', { text: p.prompt }).then((c) => playKey(c.key))}>
                <Play /> 듣기
              </Button>
            </div>
            {results[i] ? (
              <div className="rounded-xl bg-surface-2/60 p-3 text-sm">
                <div className="mb-1 text-xs text-subtle">인식된 답변</div>
                {results[i]!.text || '(인식된 말이 없어요)'}
                <button className="mt-2 flex items-center gap-1 text-xs text-accent" onClick={() => setResults((r) => r.map((v, j) => (j === i ? null : v)))}>
                  <RotateCcw className="size-3" /> 다시 녹음
                </button>
              </div>
            ) : (
              <RecordButton
                size="md"
                maxSeconds={(p.seconds || 45) + 15}
                busy={busy === i}
                disabled={busy !== null && busy !== i}
                onRecorded={async (blob) => {
                  setBusy(i)
                  setErr(null)
                  try {
                    const r = await postForm<{ text: string }>(`/placement/${pl.id}/speaking/${i}`, blobForm(blob))
                    setResults((rs) => rs.map((v, j) => (j === i ? r : v)))
                  } catch (e) {
                    setErr((e as Error).message)
                  } finally {
                    setBusy(null)
                  }
                }}
              />
            )}
          </div>
        ))}
        {err && <p className="text-sm text-bad">{err}</p>}
        <div className="flex justify-between">
          <Button variant="ghost" onClick={onDone}>
            건너뛰기
          </Button>
          <Button
            variant="primary"
            disabled={results.some((r) => !r)}
            onClick={async () => {
              await qc.invalidateQueries({ queryKey: ['placement', pl.id] })
              onDone()
            }}
          >
            다음 <ArrowRight />
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

function WritingStep({ pl, onDone }: { pl: PlacementView; onDone: () => void }) {
  const [text, setText] = useState('')
  const qc = useQueryClient()
  const w = pl.writing
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  if (!w) return null
  return (
    <Card>
      <CardBody className="space-y-4 pt-5">
        <p className="text-[15px] leading-relaxed">{w.prompt}</p>
        <Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write your answer in English…" spellCheck={false} className="font-serif text-[16px] leading-7" />
        <div className="flex items-center justify-between">
          <span className={cn('num text-sm', words < w.min_words ? 'text-subtle' : 'text-good')}>
            {words}단어 (권장 {w.min_words}–{w.max_words})
          </span>
          <Button
            variant="primary"
            disabled={words < 20}
            onClick={async () => {
              await post(`/placement/${pl.id}/writing`, { text })
              await qc.invalidateQueries({ queryKey: ['placement', pl.id] })
              onDone()
            }}
          >
            제출 <ArrowRight />
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

function FinishStep({ pl }: { pl: PlacementView }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const qc = useQueryClient()
  const refresh = useRefreshProgress()
  const missing = STEPS.filter((s) => !pl.done.includes(s.key)).map((s) => s.label)
  return (
    <Card>
      <CardBody className="space-y-4 pt-5 text-center">
        <h2 className="text-lg font-semibold">수고했어요!</h2>
        <p className="text-sm text-muted">
          {missing.length ? `${missing.join(', ')} 영역은 건너뛰었어요. 나머지 결과로 추정해요.` : '모든 영역을 마쳤어요.'} AI가 답변을 분석하는 데 30초~1분 걸려요.
        </p>
        {err && <p className="text-sm text-bad">{err}</p>}
        <Button
          variant="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setErr(null)
            try {
              await post(`/placement/${pl.id}/finish`)
              await qc.invalidateQueries({ queryKey: ['placement', pl.id] })
              refresh()
            } catch (e) {
              setErr((e as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Check />} 결과 보기
        </Button>
      </CardBody>
    </Card>
  )
}

export function PlacementPage() {
  const [pid, setPid] = useState<number | null>(null)
  const [step, setStep] = useState<StepKey>('self')
  const [starting, setStarting] = useState(false)
  const [checked, setChecked] = useState(false)
  const nav = useNavigate()
  const qc = useQueryClient()
  const { data: pl } = usePlacement(pid)

  // Resume an unfinished test if there is one.
  useEffect(() => {
    api<{ id: number; finished_at: string | null }[]>('/placement').then((rows) => {
      const open = rows.find((r) => !r.finished_at)
      if (open) setPid(open.id)
      setChecked(true)
    })
  }, [])

  useEffect(() => {
    if (!pl || pl.status !== 'ready') return
    const next = STEPS.find((s) => !pl.done.includes(s.key))
    if (next && step === 'self' && pl.done.includes('self')) setStep(next.key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pl?.status])

  const goNext = (from: StepKey) => {
    const i = STEPS.findIndex((s) => s.key === from)
    setStep(i >= 0 && i < STEPS.length - 1 ? STEPS[i + 1].key : 'finish')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (!checked) return null

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => nav(-1)} aria-label="뒤로">
          <ArrowLeft />
        </Button>
        <h1 className="text-xl font-bold tracking-tight">레벨 진단</h1>
      </div>

      {!pid ? (
        <ProfileForm
          starting={starting}
          onStart={async () => {
            setStarting(true)
            const created = await post<PlacementView>('/placement')
            setPid(created.id)
            setStarting(false)
          }}
        />
      ) : !pl ? (
        <div className="shimmer h-64 rounded-card" />
      ) : pl.finished && pl.result ? (
        <ResultBlock result={pl.result as PlacementResult} />
      ) : (
        <>
          <Stepper pl={pl} step={step} setStep={setStep} />
          {pl.status === 'error' && (
            <Card className="mb-4 border-bad/40">
              <CardBody className="space-y-3 pt-4">
                <p className="text-sm text-bad">문제를 만들지 못했어요: {pl.error}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={async () => {
                      await post(`/placement/${pl.id}/retry`)
                      qc.invalidateQueries({ queryKey: ['placement', pl.id] })
                    }}
                  >
                    <RotateCcw /> 문제 다시 만들기
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await del(`/placement/${pl.id}`)
                      setPid(null)
                      setStep('self')
                    }}
                  >
                    처음부터 새로 시작
                  </Button>
                </div>
              </CardBody>
            </Card>
          )}
          {step === 'self' && <SelfStep pl={pl} onDone={() => goNext('self')} />}
          {step !== 'self' && pl.status === 'generating' && (
            <Card>
              <CardBody className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
                <Loader2 className="size-4 animate-spin" /> AI가 문제를 만들고 있어요…
              </CardBody>
            </Card>
          )}
          {pl.status === 'ready' && (
            <>
              {step === 'vocab' && <VocabStep pl={pl} onDone={() => goNext('vocab')} />}
              {step === 'reading' && <ReadingStep pl={pl} onDone={() => goNext('reading')} />}
              {step === 'listening' && <ListeningStep pl={pl} onDone={() => goNext('listening')} />}
              {step === 'speaking' && <SpeakingStep pl={pl} onDone={() => goNext('speaking')} />}
              {step === 'writing' && <WritingStep pl={pl} onDone={() => goNext('writing')} />}
              {step === 'finish' && <FinishStep pl={pl} />}
            </>
          )}
        </>
      )}
    </div>
  )
}

function ResultBlock({ result }: { result: PlacementResult }) {
  return (
    <div className="space-y-4">
      <PlacementResultView result={result} />
      <div className="flex gap-2">
        <Link to="/" className="flex-1">
          <Button variant="primary" className="w-full">
            오늘의 코스 시작 <ArrowRight />
          </Button>
        </Link>
      </div>
    </div>
  )
}


import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, Keyboard, Loader2, PenLine, Plus, Send, Sparkles, Timer, Volume2 } from 'lucide-react'
import { submitWriting, useWriting, useWritings, useWritingTasks, writingPrompt } from '@/api/plan'
import { useAddCard, useRefreshProgress } from '@/api/el'
import type { Stroke, WritingItem, WritingTask } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Segmented, Textarea } from '@/components/ui/controls'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageSkeleton } from '@/components/layout/PageSkeleton'
import { InkPad } from '@/components/ink/InkPad'
import { strokesToPng } from '@/lib/ink'
import { speak } from '@/lib/audio'
import { cefr } from '@/lib/level'
import { cn } from '@/lib/utils'

const countWords = (t: string) => (t.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) ?? []).length

function useTimer(running: boolean) {
  const [sec, setSec] = useState(0)
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => document.visibilityState === 'visible' && setSec((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [running])
  return [sec, setSec] as const
}

function Result({ w }: { w: WritingItem }) {
  const r = w.result
  const add = useAddCard()
  const [saved, setSaved] = useState<Set<string>>(new Set())
  if (!r) return null
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="첨삭 결과" hint={`${w.task_title} · ${w.words}단어${w.handwritten ? ' · 손글씨' : ''}`} />
        <CardBody className="space-y-3">
          <div className="grid grid-cols-5 gap-1.5 text-center">
            <div className="rounded-xl border bg-accent-soft/40 py-2">
              <div className="text-[11px] text-subtle">레벨</div>
              <div className="num font-bold">{cefr(r.level)}</div>
            </div>
            <div className="rounded-xl border bg-accent-soft/40 py-2">
              <div className="text-[11px] text-subtle">TOEFL</div>
              <div className="num font-bold">{r.band.toFixed(1)}</div>
            </div>
            {(['task', 'organization', 'language'] as const).map((k) => (
              <div key={k} className="rounded-xl border bg-surface-2/40 py-2">
                <div className="text-[11px] text-subtle">{{ task: '과제 수행', organization: '구성', language: '언어' }[k]}</div>
                <div className="num font-bold">{r.scores[k]}/6</div>
              </div>
            ))}
          </div>
          <p className="text-[15px] leading-relaxed">{r.summary_ko}</p>
          {r.handwriting_ko && <p className="rounded-lg bg-surface-2/60 px-3 py-2 text-sm">손글씨: {r.handwriting_ko}</p>}
          {w.handwritten && r.transcript && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted">AI가 읽은 손글씨</summary>
              <p className="mt-1 whitespace-pre-wrap font-serif">{r.transcript}</p>
            </details>
          )}
        </CardBody>
      </Card>
      {r.corrections.length > 0 && (
        <Card>
          <CardHeader title="고칠 곳" />
          <CardBody className="space-y-2">
            {r.corrections.map((c, i) => (
              <div key={i} className="rounded-xl border bg-surface-2/40 p-3 text-sm">
                <div className="text-bad line-through decoration-bad/60">{c.original}</div>
                <div className="font-medium text-good">{c.better}</div>
                <div className="mt-1 text-xs text-muted">{c.note_ko}</div>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
      <Card>
        <CardHeader title="고친 글" action={<Button size="sm" variant="ghost" onClick={() => speak(r.corrected)}><Volume2 /></Button>} />
        <CardBody className="whitespace-pre-wrap font-serif text-[16px] leading-7">{r.corrected}</CardBody>
      </Card>
      <Card>
        <CardHeader title="C1 수준으로 다듬은 글" hint="같은 생각을 더 자연스럽게 — 소리 내어 읽어 보세요" action={<Button size="sm" variant="ghost" onClick={() => speak(r.upgraded)}><Volume2 /></Button>} />
        <CardBody className="whitespace-pre-wrap font-serif text-[16px] leading-7">{r.upgraded}</CardBody>
      </Card>
      {r.expressions.length > 0 && (
        <Card>
          <CardHeader title="가져갈 표현" />
          <CardBody className="space-y-2">
            {r.expressions.map((e) => (
              <div key={e.expr} className="flex items-center gap-3 rounded-xl border bg-surface-2/40 p-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{e.expr}</div>
                  <div className="text-sm text-muted">{e.meaning_ko}</div>
                </div>
                <Button
                  size="sm"
                  variant={saved.has(e.expr) ? 'ghost' : 'secondary'}
                  disabled={saved.has(e.expr)}
                  onClick={() => add.mutate({ term: e.expr, meaning_ko: e.meaning_ko, source_kind: 'writing', source_id: w.id }, { onSuccess: () => setSaved((s) => new Set(s).add(e.expr)) })}
                >
                  {saved.has(e.expr) ? <Check /> : <Plus />}
                </Button>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
      {r.mistakes.length > 0 && <p className="text-center text-xs text-subtle">반복되는 실수 {r.mistakes.length}개를 실수 노트와 교정 카드에 넣었어요.</p>}
    </div>
  )
}

function Editor({ task, onDone }: { task: WritingTask; onDone: (w: WritingItem) => void }) {
  const [prompt, setPrompt] = useState(task.key === 'free' ? '' : '')
  const [tip, setTip] = useState('')
  const [gen, setGen] = useState(false)
  const [input, setInput] = useState<'type' | 'pen'>(() => (matchMedia('(pointer: coarse)').matches ? 'pen' : 'type'))
  const [text, setText] = useState('')
  const strokes = useRef<Stroke[]>([])
  const [hasInk, setHasInk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [sec] = useTimer(true)
  const refresh = useRefreshProgress()
  const qc = useQueryClient()
  const words = countWords(text)
  const limit = task.minutes * 60
  const getPrompt = async () => {
    setGen(true)
    setErr(null)
    try {
      const p = await writingPrompt(task.key)
      setPrompt(p.prompt)
      setTip(p.tip_ko)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setGen(false)
    }
  }
  useEffect(() => {
    if (task.key !== 'free') void getPrompt()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.key])
  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      const form = new FormData()
      form.set('task', task.key)
      form.set('prompt', prompt || '(free writing)')
      form.set('minutes', String(Math.max(1, Math.round(sec / 6) / 10)))
      if (input === 'pen') {
        const png = await strokesToPng(strokes.current)
        if (!png) throw new Error('먼저 손글씨로 써 주세요.')
        form.set('image', png, 'handwriting.png')
      } else form.set('text', text)
      const w = await submitWriting(form)
      qc.invalidateQueries({ queryKey: ['writings'] })
      refresh()
      onDone(w)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={task.title}
          hint={`${task.min_words}–${task.max_words}단어 · 권장 ${task.minutes}분`}
          action={
            task.key !== 'free' && (
              <Button size="sm" variant="ghost" disabled={gen} onClick={getPrompt}>
                {gen ? <Loader2 className="animate-spin" /> : <Sparkles />} 다른 문제
              </Button>
            )
          }
        />
        <CardBody className="space-y-2">
          {task.key === 'free' ? (
            <Textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="무엇에 대해 쓸지 적어 주세요 (예: 내가 달리기를 좋아하는 이유)" />
          ) : gen && !prompt ? (
            <div className="space-y-2">
              <div className="shimmer h-4 w-full rounded" />
              <div className="shimmer h-4 w-4/5 rounded" />
              <div className="shimmer h-4 w-2/3 rounded" />
            </div>
          ) : (
            <p className="whitespace-pre-wrap font-serif text-[15px] leading-7">{prompt}</p>
          )}
          {tip && <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">{tip}</p>}
        </CardBody>
      </Card>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
          <Segmented
            size="sm"
            value={input}
            onChange={setInput}
            options={[
              { value: 'type', label: <><Keyboard className="size-3.5" /> 키보드</> },
              { value: 'pen', label: <><PenLine className="size-3.5" /> 손글씨</> },
            ]}
          />
          <span className={cn('num ml-auto flex items-center gap-1 text-sm', sec > limit ? 'text-warn' : 'text-muted')}>
            <Timer className="size-4" /> {Math.floor(sec / 60)}:{String(sec % 60).padStart(2, '0')} / {task.minutes}:00
          </span>
          {input === 'type' && <span className={cn('num text-sm', words < task.min_words ? 'text-muted' : 'text-good')}>{words}단어</span>}
        </div>
        {input === 'type' ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="sentences"
            placeholder="여기에 영어로 쓰세요. (태블릿 키보드의 필기 입력으로 써도 돼요 — 맞춤법 검사는 꺼 두었어요)"
            className="block w-full resize-y bg-transparent px-4 py-3 font-serif text-[17px] leading-8 outline-none placeholder:font-sans placeholder:text-sm placeholder:text-subtle"
          />
        ) : (
          <InkPad
            initial={[]}
            initialHeight={1100}
            onStrokes={(s) => {
              strokes.current = s
              setHasInk(s.length > 0)
            }}
            toolbarClassName="static"
          />
        )}
      </Card>
      {err && <p className="text-sm text-bad">{err}</p>}
      <Button variant="primary" className="w-full" disabled={busy || (input === 'type' ? words < 15 : !hasInk) || (task.key === 'free' && !prompt.trim())} onClick={submit}>
        {busy ? <Loader2 className="animate-spin" /> : <Send />} {busy ? (input === 'pen' ? '손글씨를 읽고 첨삭하는 중…' : '첨삭하는 중…') : '제출하고 첨삭 받기'}
      </Button>
    </div>
  )
}

function History({ onOpen }: { onOpen: (id: number) => void }) {
  const { data } = useWritings()
  if (!data?.length) return null
  return (
    <Card>
      <CardHeader title="지난 글" />
      <CardBody className="space-y-1.5">
        {data.slice(0, 12).map((w) => (
          <button key={w.id} onClick={() => onOpen(w.id)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-2">
            <span className="num w-12 shrink-0 text-xs text-subtle">{w.created_at.slice(5, 10).replace('-', '/')}</span>
            <span className="min-w-0 flex-1 truncate text-sm">
              <span className="font-medium">{w.task_title}</span> <span className="text-muted">{w.prompt.slice(0, 60)}</span>
            </span>
            {w.handwritten && <PenLine className="size-3.5 shrink-0 text-subtle" />}
            <span className="num shrink-0 text-sm font-semibold">{cefr(w.level)}</span>
          </button>
        ))}
      </CardBody>
    </Card>
  )
}

export function WritePage() {
  const { data: tasks } = useWritingTasks()
  const [task, setTask] = useState<WritingTask | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const { data: opened } = useWriting(openId)
  const [result, setResult] = useState<WritingItem | null>(null)
  if (!tasks) return <PageSkeleton />
  const shown = result ?? (openId ? opened : null)
  return (
    <div className="space-y-5">
      <PageHeader
        title="쓰기"
        subtitle="TOEFL 쓰기 과제나 자유 주제로 쓰고 AI 첨삭을 받아요. 손글씨(S Pen)로 써도 AI가 읽어서 고쳐 줘요."
        actions={
          (task || shown) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setTask(null)
                setResult(null)
                setOpenId(null)
              }}
            >
              <ArrowLeft /> 과제 고르기
            </Button>
          )
        }
      />
      {shown ? (
        <div className="mx-auto max-w-3xl">
          <Result w={shown} />
        </div>
      ) : task ? (
        <div className="mx-auto max-w-3xl">
          <Editor task={task} onDone={setResult} />
        </div>
      ) : (
        <div className="grid gap-5 split:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="grid gap-3 sm:grid-cols-2">
            {tasks.map((t) => (
              <button key={t.key} onClick={() => setTask(t)} className="lift rounded-card border bg-surface p-4 text-left shadow-card">
                <div className="font-semibold">{t.title}</div>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  {{ email: '상황에 맞는 이메일 (TOEFL Write an Email)', discussion: '교수 질문 + 두 학생 의견에 내 의견 더하기 (TOEFL Academic Discussion)', journal: '주제에 대한 내 생각·일기', free: '쓰고 싶은 것 아무거나' }[t.key]}
                </p>
                <div className="num mt-2 text-xs text-subtle">
                  {t.min_words}–{t.max_words}단어 · {t.minutes}분
                </div>
              </button>
            ))}
          </div>
          <History onOpen={setOpenId} />
        </div>
      )}
    </div>
  )
}

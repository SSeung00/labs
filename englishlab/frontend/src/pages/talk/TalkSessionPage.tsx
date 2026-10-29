import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Eye, Keyboard, Languages, Lightbulb, Loader2, RotateCcw, Send, Square, Volume2 } from 'lucide-react'
import { post } from '@/api/client'
import { postForm, useConversation, useProfile, useRefreshProgress } from '@/api/el'
import type { ChatMessage, TalkMetrics, TalkReport } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { RecordButton } from '@/components/RecordButton'
import { PageSkeleton } from '@/components/layout/PageSkeleton'
import { blobForm, playKey, speak, stopAudio, usePlayingKey } from '@/lib/audio'
import { cn } from '@/lib/utils'
import { ReportView } from './ReportView'

interface TurnResponse {
  user: ChatMessage
  assistant: ChatMessage
  audio: string | null
}

function AssistantBubble({ m, audioKey, hideText, onRetry, showRetry }: { m: ChatMessage; audioKey?: string | null; hideText: boolean; onRetry: () => void; showRetry: boolean }) {
  const [revealed, setRevealed] = useState(!hideText)
  const playing = usePlayingKey()
  const isPlaying = !!audioKey && playing === audioKey
  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex max-w-[88%] items-end gap-2">
        <div
          onClick={() => setRevealed(true)}
          className={cn('rounded-2xl rounded-bl-md border bg-surface px-4 py-2.5 text-[16px] leading-relaxed shadow-card', !revealed && 'cursor-pointer select-none blur-sm')}
        >
          {m.text}
        </div>
        <button
          onClick={() => (audioKey ? (isPlaying ? stopAudio() : playKey(audioKey)) : speak(m.text))}
          className={cn('grid size-8 shrink-0 place-items-center rounded-full border bg-surface-2 text-muted', isPlaying && 'text-accent')}
          aria-label="다시 듣기"
        >
          {isPlaying ? <Square className="size-3.5 fill-current" /> : <Volume2 className="size-4" />}
        </button>
        {!revealed && (
          <button onClick={() => setRevealed(true)} className="grid size-8 shrink-0 place-items-center rounded-full text-subtle" aria-label="텍스트 보기">
            <Eye className="size-4" />
          </button>
        )}
      </div>
      {m.data?.nudge && (
        <div className="flex max-w-[88%] items-start gap-2 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-warn" />
          <div className="flex-1">
            <div>{m.data.nudge}</div>
            {showRetry && (
              <button onClick={onRetry} className="mt-1 flex items-center gap-1 text-xs font-semibold text-warn">
                <RotateCcw className="size-3" /> 고쳐서 다시 말하기
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function UserBubble({ m }: { m: ChatMessage }) {
  const [open, setOpen] = useState(false)
  const corr = m.data?.corrections ?? []
  const upgrade = m.data?.upgrade
  return (
    <div className={cn('flex flex-col items-end gap-1', m.replaced && 'opacity-45')}>
      <div className={cn('max-w-[88%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[16px] leading-relaxed text-accent-fg', m.replaced && 'line-through')}>{m.text}</div>
      {(corr.length > 0 || upgrade || m.data?.stats) && !m.replaced && (
        <button onClick={() => setOpen(!open)} className="flex items-center gap-2 text-[11px] text-subtle">
          {m.data?.stats && <span className="num">{m.data.stats.wpm} wpm</span>}
          {corr.length > 0 && <span className="rounded-full bg-warn/15 px-1.5 font-semibold text-warn">교정 {corr.length}</span>}
          {upgrade && <span className="rounded-full bg-accent-soft px-1.5 font-semibold text-accent">더 자연스럽게</span>}
        </button>
      )}
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="w-full max-w-[88%] overflow-hidden">
            <div className="space-y-1.5 rounded-xl border bg-surface-2/60 p-3 text-sm">
              {corr.map((c, i) => (
                <div key={i}>
                  <span className="text-bad line-through">{c.original}</span> → <span className="font-medium text-good">{c.better}</span>
                  {c.note_ko && <div className="text-xs text-subtle">{c.note_ko}</div>}
                </div>
              ))}
              {upgrade && (
                <div className="flex items-start gap-1.5">
                  <span className="text-accent">✦</span>
                  <span className="flex-1">{upgrade}</span>
                  <button onClick={() => speak(upgrade)} className="text-subtle" aria-label="듣기">
                    <Volume2 className="size-4" />
                  </button>
                </div>
              )}
              {m.data?.stats?.unclear_words?.length ? <div className="text-xs text-subtle">발음이 불분명했던 단어: {m.data.stats.unclear_words.join(', ')}</div> : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function HelpDialog({ open, onClose, cid }: { open: boolean; onClose: () => void; cid: number }) {
  const [ko, setKo] = useState('')
  const [busy, setBusy] = useState(false)
  const [opts, setOpts] = useState<{ en: string; note_ko: string }[]>([])
  return (
    <Dialog open={open} onClose={onClose} title="영어로 어떻게 말해요?" description="한국어로 적으면 지금 대화에 맞는 자연스러운 표현을 알려줘요">
      <div className="space-y-3 p-5">
        <div className="flex gap-2">
          <Input value={ko} onChange={(e) => setKo(e.target.value)} placeholder="예: 체크아웃을 좀 늦출 수 있을까요?" />
          <Button
            variant="primary"
            disabled={!ko.trim() || busy}
            onClick={async () => {
              setBusy(true)
              try {
                const r = await post<{ options: { en: string; note_ko: string }[] }>(`/talk/${cid}/help`, { korean: ko })
                setOpts(r.options)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Languages />}
          </Button>
        </div>
        {opts.map((o, i) => (
          <button key={i} onClick={() => speak(o.en)} className="block w-full rounded-xl border p-3 text-left">
            <div className="font-medium">{o.en}</div>
            <div className="text-xs text-subtle">{o.note_ko}</div>
          </button>
        ))}
      </div>
    </Dialog>
  )
}

export function TalkSessionPage() {
  const id = Number(useParams().id)
  const loc = useLocation()
  const nav = useNavigate()
  const qc = useQueryClient()
  const refresh = useRefreshProgress()
  const { data: convo } = useConversation(id)
  const { data: prof } = useProfile()
  const [msgs, setMsgs] = useState<ChatMessage[]>([])
  const [keys, setKeys] = useState<Record<number, string | null>>({})
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [retry, setRetry] = useState(false)
  const [typing, setTyping] = useState(false)
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [ending, setEnding] = useState(false)
  const [report, setReport] = useState<{ report: TalkReport | null; metrics: TalkMetrics; note?: string } | null>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const first = useRef(true)

  useEffect(() => {
    if (!convo?.messages) return
    setMsgs(convo.messages)
    if (first.current) {
      first.current = false
      const audio = (loc.state as { audio?: string | null } | null)?.audio
      const last = convo.messages[convo.messages.length - 1]
      if (audio && last && !convo.ended_at) {
        setKeys((k) => ({ ...k, [last.id]: audio }))
        void playKey(audio)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convo?.messages])

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [msgs.length, busy])

  useEffect(() => () => stopAudio(), [])

  const send = async (payload: { blob?: Blob; text?: string }) => {
    setBusy(true)
    setErr(null)
    try {
      const form = new FormData()
      if (payload.blob) {
        // Step 1: show what was heard at once; step 2 (the AI reply) takes several seconds.
        const heard = await postForm<{ text: string; stats: object }>(`/talk/${id}/transcribe`, blobForm(payload.blob))
        setPending(heard.text)
        form.append('text', heard.text)
        form.append('stats', JSON.stringify(heard.stats))
      } else {
        setPending(payload.text ?? '')
        form.append('text', payload.text ?? '')
      }
      form.append('retry', String(retry))
      const r = await postForm<TurnResponse>(`/talk/${id}/turn`, form)
      setMsgs((prev) => {
        let base = prev
        if (retry) {
          // mirror the server: the last attempt and the reply to it are replaced
          const ids = prev.filter((m) => !m.replaced).slice(-2).map((m) => m.id)
          base = prev.map((m) => (ids.includes(m.id) ? { ...m, replaced: true } : m))
        }
        return [...base, r.user, r.assistant]
      })
      setKeys((k) => ({ ...k, [r.assistant.id]: r.audio }))
      setRetry(false)
      setText('')
      if (r.audio) void playKey(r.audio)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
      setPending(null)
    }
  }

  const end = async () => {
    setEnding(true)
    stopAudio()
    try {
      const r = await post<{ report: TalkReport | null; metrics: TalkMetrics; note?: string }>(`/talk/${id}/end`)
      setReport(r)
      qc.invalidateQueries({ queryKey: ['talk', id] })
      qc.invalidateQueries({ queryKey: ['talks'] })
      qc.invalidateQueries({ queryKey: ['mistakes'] })
      qc.invalidateQueries({ queryKey: ['cards'] })
      refresh()
      window.scrollTo({ top: 0 })
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setEnding(false)
    }
  }

  if (!convo) return <PageSkeleton />
  const ended = !!convo.ended_at || !!report
  const shownReport = report?.report ?? convo.report ?? null
  const metrics = (report?.metrics ?? convo.metrics) as TalkMetrics
  const live = msgs.filter((m) => !m.replaced)
  const lastAssistant = [...live].reverse().find((m) => m.role === 'assistant')
  const interview = convo.mode === 'interview'

  if (ended) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => nav('/talk')} aria-label="뒤로">
            <ArrowLeft />
          </Button>
          <h1 className="truncate text-xl font-bold tracking-tight">{convo.title}</h1>
        </div>
        {report?.note && <p className="mb-4 text-sm text-muted">{report.note}</p>}
        {shownReport ? <ReportView cid={id} report={shownReport} metrics={metrics} /> : !report?.note && <p className="text-sm text-muted">리포트가 없어요.</p>}
        <details className="mt-5 rounded-card border bg-surface p-4 shadow-card">
          <summary className="cursor-pointer text-sm font-semibold text-muted">대화 전체 보기</summary>
          <div className="mt-4 space-y-3">
            {msgs.map((m) => (m.role === 'assistant' ? <AssistantBubble key={m.id} m={m} hideText={false} onRetry={() => undefined} showRetry={false} /> : <UserBubble key={m.id} m={m} />))}
          </div>
        </details>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-7rem)] max-w-3xl flex-col">
      <div className="mb-3 flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => nav('/talk')} aria-label="뒤로">
          <ArrowLeft />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold tracking-tight">{convo.title}</h1>
        <Button variant="secondary" size="sm" disabled={ending || busy} onClick={end}>
          {ending ? <Loader2 className="animate-spin" /> : null} {ending ? '리포트 작성 중…' : '끝내고 리포트'}
        </Button>
      </div>

      <div className="flex-1 space-y-4 pb-48">
        {msgs.map((m) =>
          m.role === 'assistant' ? (
            <AssistantBubble
              key={m.id}
              m={m}
              audioKey={keys[m.id]}
              hideText={!!prof?.profile.hide_ai_text}
              showRetry={m.id === lastAssistant?.id && !busy}
              onRetry={() => setRetry(true)}
            />
          ) : (
            <UserBubble key={m.id} m={m} />
          ),
        )}
        {busy && pending == null && (
          <div className="flex justify-end">
            <div className="flex items-center gap-2 rounded-2xl bg-accent/40 px-4 py-2.5 text-sm text-accent-fg">
              <Loader2 className="size-4 animate-spin" /> 알아듣는 중…
            </div>
          </div>
        )}
        {busy && pending != null && (
          <>
            <div className="flex justify-end">
              <div className="max-w-[88%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[16px] leading-relaxed text-accent-fg">{pending}</div>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="size-4 animate-spin" /> AI가 대답을 생각하는 중…
            </div>
          </>
        )}
        <div ref={bottom} />
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-bg/90 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur-md fold:left-[76px] xl:left-60">
        <div className="mx-auto max-w-3xl px-4">
          {err && <p className="mb-2 text-center text-sm text-bad">{err}</p>}
          {retry && (
            <div className="mb-2 flex items-center justify-center gap-2 text-sm text-warn">
              <RotateCcw className="size-4" /> 고쳐 말하기 모드 — 방금 문장을 다시 말해 보세요
              <button className="text-xs text-subtle underline" onClick={() => setRetry(false)}>
                취소
              </button>
            </div>
          )}
          {typing ? (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => setTyping(false)} aria-label="음성으로">
                <Keyboard />
              </Button>
              <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && text.trim() && !busy && send({ text })} placeholder="영어로 입력…" />
              <Button variant="primary" size="icon" disabled={!text.trim() || busy} onClick={() => send({ text })} aria-label="보내기">
                <Send />
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="icon" onClick={() => setTyping(true)} aria-label="키보드로 입력" title="키보드로 입력">
                <Keyboard />
              </Button>
              <RecordButton busy={busy} maxSeconds={interview ? 45 : 120} onRecorded={(blob) => send({ blob })} label={interview ? '45초 안에 답하기' : undefined} />
              <Button variant="ghost" size="icon" onClick={() => setHelpOpen(true)} aria-label="영어로 뭐라고?" title="영어로 뭐라고?">
                <Languages />
              </Button>
            </div>
          )}
        </div>
      </div>
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} cid={id} />
    </div>
  )
}

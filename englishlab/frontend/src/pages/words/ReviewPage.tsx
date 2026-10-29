import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ArrowLeft, Check, PartyPopper, Volume2 } from 'lucide-react'
import { api, post } from '@/api/client'
import { useRefreshProgress } from '@/api/el'
import type { CardItem } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { speak } from '@/lib/audio'
import { cn } from '@/lib/utils'

interface Queue {
  cards: CardItem[]
  due_total: number
  new_left_today: number
}

const RATINGS = [
  { r: 1, label: '다시', cls: 'border-bad/50 text-bad' },
  { r: 2, label: '어려움', cls: 'border-warn/50 text-warn' },
  { r: 3, label: '알맞음', cls: 'border-good/50 text-good' },
  { r: 4, label: '쉬움', cls: 'border-fitness/50 text-fitness' },
] as const

function fmt(days: number | undefined) {
  if (days == null) return ''
  if (days < 1 / 24) return `${Math.max(1, Math.round(days * 1440))}분`
  if (days < 1) return `${Math.round(days * 24)}시간`
  if (days < 30) return `${Math.round(days)}일`
  if (days < 365) return `${Math.round(days / 30)}달`
  return `${(days / 365).toFixed(1)}년`
}

/** Blank out the term inside its context sentence (cloze). */
function Cloze({ text, term, reveal }: { text: string; term: string; reveal: boolean }) {
  const i = text.toLowerCase().indexOf(term.toLowerCase())
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <span className={cn('rounded px-1', reveal ? 'bg-accent-soft font-semibold text-accent' : 'bg-surface-3 text-transparent')}>{text.slice(i, i + term.length)}</span>
      {text.slice(i + term.length)}
    </>
  )
}

export function ReviewPage() {
  const nav = useNavigate()
  const refresh = useRefreshProgress()
  const { data, refetch, isFetching } = useQuery({ queryKey: ['queue'], queryFn: () => api<Queue>('/cards/queue?limit=40'), staleTime: 0, gcTime: 0 })
  const [idx, setIdx] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [done, setDone] = useState(0)
  const [busy, setBusy] = useState(false)
  const started = useRef(Date.now())
  const shownAt = useRef(Date.now())
  const logged = useRef(false)

  const cards = data?.cards ?? []
  const card = cards[idx]

  const logSession = useCallback(() => {
    if (logged.current || done === 0) return
    logged.current = true
    const minutes = Math.min(120, (Date.now() - started.current) / 60000)
    void post('/cards/session', { minutes: Math.max(0.05, Math.round(minutes * 100) / 100), count: done }).then(refresh)
  }, [done, refresh])

  useEffect(() => () => logSession(), [logSession])

  const rate = useCallback(
    async (r: number) => {
      if (!card || busy) return
      setBusy(true)
      try {
        await post(`/cards/${card.id}/grade`, { rating: r, duration_ms: Date.now() - shownAt.current })
        setDone((d) => d + 1)
        setFlipped(false)
        shownAt.current = Date.now()
        if (idx + 1 < cards.length) setIdx(idx + 1)
        else {
          const next = await refetch()
          setIdx(0)
          if (!next.data?.cards.length) logSession()
        }
      } finally {
        setBusy(false)
      }
    },
    [card, busy, idx, cards.length, refetch, logSession],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return
      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault()
        if (!flipped) setFlipped(true)
        else void rate(3)
      } else if (flipped && ['1', '2', '3', '4'].includes(e.key)) void rate(Number(e.key))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flipped, rate])

  useEffect(() => {
    if (flipped && card && card.kind !== 'correction') void speak(card.term).catch(() => undefined)
  }, [flipped, card])

  const header = (
    <div className="mb-4 flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => {
          logSession()
          nav('/words')
        }}
        aria-label="뒤로"
      >
        <ArrowLeft />
      </Button>
      <h1 className="flex-1 text-xl font-bold tracking-tight">복습</h1>
      <span className="num text-sm text-muted">
        {done}개 완료{data ? ` · 남은 복습 ${data.due_total}` : ''}
      </span>
    </div>
  )

  if (!data) return <div className="mx-auto max-w-xl">{header}</div>

  if (!card)
    return (
      <div className="mx-auto max-w-xl">
        {header}
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-14 text-center">
            <PartyPopper className="size-10 text-warn" />
            <div className="text-lg font-semibold">{done ? `오늘 복습 끝! ${done}개 했어요` : '지금은 복습할 카드가 없어요'}</div>
            <p className="text-sm text-muted">{data.new_left_today === 0 ? '오늘 새 카드 한도를 다 썼어요.' : '읽기·대화에서 새 표현을 모아 보세요.'}</p>
            <Button variant="primary" onClick={() => nav('/')} disabled={isFetching}>
              <Check /> 오늘로 돌아가기
            </Button>
          </CardBody>
        </Card>
      </div>
    )

  const isCorrection = card.kind === 'correction'
  return (
    <div className="mx-auto max-w-xl">
      {header}
      <motion.div key={card.id + (flipped ? 'b' : 'f')} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
        <Card className="min-h-[360px]">
          <CardBody className="flex min-h-[360px] flex-col gap-4 pt-6">
            <div className="flex items-center justify-between text-xs text-subtle">
              <span>{card.reps === 0 ? '새 카드' : isCorrection ? '교정 카드' : '복습'}</span>
              {!isCorrection && (
                <button onClick={() => speak(card.term)} className="flex items-center gap-1 text-muted">
                  <Volume2 className="size-4" /> 발음
                </button>
              )}
            </div>

            {isCorrection ? (
              <>
                <div className="text-sm text-muted">더 자연스럽게 고쳐 말해 보세요</div>
                <div className="font-serif text-xl leading-relaxed">{card.prompt}</div>
                {flipped && (
                  <div className="space-y-2 border-t pt-4">
                    <button onClick={() => speak(card.term)} className="flex items-start gap-2 text-left font-serif text-xl font-semibold leading-relaxed text-good">
                      <Volume2 className="mt-1.5 size-4 shrink-0" />
                      {card.term}
                    </button>
                    {card.meaning_ko && <div className="text-sm text-muted">{card.meaning_ko}</div>}
                    {card.note && <div className="text-xs text-subtle">{card.note}</div>}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="text-3xl font-bold tracking-tight">{card.term}</div>
                {card.context && (
                  <div className="font-serif text-lg leading-relaxed text-muted">
                    <Cloze text={card.context} term={card.term} reveal />
                  </div>
                )}
                {flipped && (
                  <div className="space-y-2 border-t pt-4">
                    {card.ipa && <div className="text-sm text-subtle">/{card.ipa}/</div>}
                    <div className="text-xl font-semibold">{card.meaning_ko ?? '…'}</div>
                    {card.definition_en && <div className="text-sm text-muted">{card.definition_en}</div>}
                    {card.examples.slice(0, 2).map((e, i) => (
                      <div key={i} className="text-sm">
                        <div>{e.en}</div>
                        <div className="text-xs text-subtle">{e.ko}</div>
                      </div>
                    ))}
                    {card.note && <div className="text-xs text-subtle">{card.note}</div>}
                  </div>
                )}
              </>
            )}
            <div className="flex-1" />
            {!flipped ? (
              <Button variant="primary" className="h-12 w-full text-base" onClick={() => setFlipped(true)}>
                정답 보기 (Space)
              </Button>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {RATINGS.map((b) => (
                  <button key={b.r} disabled={busy} onClick={() => rate(b.r)} className={cn('flex h-14 flex-col items-center justify-center rounded-xl border bg-surface-2/40 text-sm font-semibold', b.cls)}>
                    {b.label}
                    <span className="num text-[11px] font-normal text-subtle">{fmt(card.intervals?.[String(b.r)])}</span>
                  </button>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </motion.div>
      <p className="mt-3 text-center text-xs text-subtle">'알맞음'이 기본이에요. 기억해 내는 데 오래 걸렸으면 '어려움', 바로 떠올랐으면 '쉬움'.</p>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { ArrowUp, Bot, Loader2, MessageSquarePlus, Search, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Markdown } from '@/components/ui/markdown'
import { CoachCard } from '@/components/coach/CoachCard'
import { fmtUsd, useAiUsage, useChat, useChats, useDeleteChat, useSendChat, type ChatItem } from '@/api/coach'
import { cn } from '@/lib/utils'

const STARTERS = [
  '이번 달 훈련 어땠는지 지난달이랑 비교해 줘',
  '서울마라톤 목표 2:59, 지금 체력으로 가능할까? 레이스 페이스 전략도 짜 줘',
  '최근 3개월 이지런 심박이 같은 페이스에서 내려갔어?',
  '더운 날엔 내 페이스가 얼마나 떨어져?',
  '신발별로 효율 차이가 있어?',
  '요즘 피로가 쌓인 것 같은데, 데이터로 보면 어때?',
]

function Bubble({ item }: { item: ChatItem }) {
  if (item.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-sm text-accent-fg">{item.text}</div>
      </div>
    )
  }
  return (
    <div className="flex gap-3">
      <span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
        <Bot className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        {!!item.tools?.length && (
          <div className="mb-1 flex flex-wrap items-center gap-1 text-[11px] text-subtle">
            <Search className="size-3" /> 찾아본 기록: {item.tools.join(' · ')}
          </div>
        )}
        <div className="rounded-2xl rounded-tl-md border bg-surface px-4 py-2">
          <Markdown source={item.text} />
        </div>
      </div>
    </div>
  )
}

export function CoachPage() {
  const { data: usage } = useAiUsage()
  const { data: chats } = useChats()
  const [chatId, setChatId] = useState<number | null>(null)
  const { data: chat } = useChat(chatId)
  const send = useSendChat()
  const del = useDeleteChat()
  const [text, setText] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const bottom = useRef<HTMLDivElement>(null)

  const items = chatId && chat ? chat.items : []
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [items.length, pending])

  const ask = (q: string) => {
    const t = q.trim()
    if (!t || send.isPending) return
    setPending(t)
    setText('')
    send.mutate(
      { chat_id: chatId, text: t },
      {
        onSuccess: (d) => setChatId(d.id),
        onError: () => setText(t),
        onSettled: () => setPending(null),
      },
    )
  }

  if (usage && !usage.available) {
    return (
      <>
        <PageHeader title="AI 코치" subtitle="내 기록으로 묻고 답하기" />
        <CoachCard />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="AI 코치"
        subtitle="내 기록을 직접 찾아보고 답해요 · 데이터는 읽기만 해요"
        actions={
          usage && (
            <span className="num rounded-lg bg-surface-2 px-3 py-1.5 text-xs text-muted">
              남은 예산 <b className="text-text">{fmtUsd(usage.remaining_usd)}</b> / ${usage.budget_usd.toFixed(0)}
            </span>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Conversations */}
        <Card className="h-fit p-2 lg:sticky lg:top-20">
          <Button variant="primary" className="w-full" onClick={() => setChatId(null)}>
            <MessageSquarePlus /> 새 대화
          </Button>
          <ul className="mt-2 flex gap-1 overflow-x-auto lg:max-h-[60vh] lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden">
            {chats?.map((c) => (
              <li key={c.id} className="group relative shrink-0 lg:shrink">
                <button
                  onClick={() => setChatId(c.id)}
                  className={cn(
                    'w-44 rounded-lg px-3 py-2 text-left lg:w-full',
                    c.id === chatId ? 'bg-surface-2 text-text' : 'text-muted hover:bg-surface-2/60',
                  )}
                >
                  <div className="truncate text-[13px] font-medium">{c.title}</div>
                  <div className="num text-[10px] text-subtle">
                    {format(parseISO(c.updated_at), 'M/d HH:mm', { locale: ko })} · {fmtUsd(c.cost_usd)}
                  </div>
                </button>
                <button
                  onClick={() => confirm('이 대화를 지울까요?') && del.mutate(c.id, { onSuccess: () => c.id === chatId && setChatId(null) })}
                  className="absolute right-1.5 top-2 hidden rounded p-1 text-subtle hover:text-bad group-hover:block"
                  aria-label="대화 삭제"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </Card>

        {/* Thread */}
        <div className="flex min-h-[60vh] flex-col">
          <div className="flex-1 space-y-4">
            {!items.length && !pending && (
              <div className="py-6">
                <div className="mb-4 flex items-center gap-2 text-sm text-muted">
                  <Bot className="size-5 text-accent" /> 훈련, 컨디션, 기록, 레이스 전략까지 무엇이든 물어보세요.
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {STARTERS.map((s) => (
                    <button key={s} onClick={() => ask(s)} className="rounded-xl border bg-surface px-4 py-3 text-left text-sm text-muted transition-colors hover:border-border-strong hover:text-text">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {items.map((it, i) => (
              <Bubble key={i} item={it} />
            ))}
            {pending && (
              <>
                <Bubble item={{ role: 'user', text: pending }} />
                <div className="flex items-center gap-3 text-sm text-subtle">
                  <span className="grid size-7 place-items-center rounded-full bg-accent-soft text-accent">
                    <Loader2 className="size-4 animate-spin" />
                  </span>
                  기록을 찾아보고 있어요… (보통 20초~1분)
                </div>
              </>
            )}
            {send.error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-bad">{send.error.message}</p>}
            <div ref={bottom} />
          </div>

          <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] mt-4 md:bottom-4">
            <div className="flex items-end gap-2 rounded-2xl border bg-surface p-2 shadow-card">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    ask(text)
                  }
                }}
                rows={1}
                placeholder={chatId ? '이어서 물어보기…' : '무엇이든 물어보세요'}
                className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-subtle"
              />
              <Button variant="primary" size="icon" onClick={() => ask(text)} disabled={!text.trim() || send.isPending} aria-label="보내기">
                {send.isPending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
              </Button>
            </div>
            {chat && chatId && <div className="num mt-1 text-right text-[10px] text-subtle">이 대화 {fmtUsd(chat.cost_usd)}</div>}
          </div>
        </div>
      </div>
    </>
  )
}

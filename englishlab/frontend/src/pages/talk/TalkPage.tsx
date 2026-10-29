import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Loader2, MessagesSquare, Mic, PenLine, Sparkles } from 'lucide-react'
import { post } from '@/api/client'
import { useConversations, useScenarios } from '@/api/el'
import type { Conversation } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Textarea } from '@/components/ui/controls'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/layout/PageHeader'
import { cefr } from '@/lib/level'
import { cn } from '@/lib/utils'

export function TalkPage() {
  const { data: scenarios } = useScenarios()
  const { data: history } = useConversations()
  const [busy, setBusy] = useState<string | null>(null)
  const [custom, setCustom] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const nav = useNavigate()
  const qc = useQueryClient()

  const start = async (scenario: string) => {
    setBusy(scenario)
    setErr(null)
    try {
      const res = await post<{ conversation: Conversation; audio: string | null }>('/talk', { scenario, custom: scenario === 'custom' ? custom : undefined })
      qc.invalidateQueries({ queryKey: ['talks'] })
      nav(`/talk/${res.conversation.id}`, { state: { audio: res.audio } })
    } catch (e) {
      setErr((e as Error).message)
      setBusy(null)
    }
  }

  return (
    <div>
      <PageHeader title="AI 대화" subtitle="말하면 AI가 알아듣고 대답해요. 틀린 부분은 스스로 고치도록 힌트를 주고, 끝나면 리포트를 드려요" />
      {err && <p className="mb-3 text-sm text-bad">{err}</p>}
      <div className="grid gap-5 split:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="상황 고르기" />
            <CardBody className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {scenarios?.map((s) => (
                <button
                  key={s.key}
                  disabled={!!busy}
                  onClick={() => start(s.key)}
                  className={cn(
                    'lift relative flex min-h-[84px] flex-col items-start gap-1 rounded-2xl border p-3 text-left disabled:opacity-60',
                    s.key === 'free' && 'border-accent/50 bg-accent-soft',
                    s.key === 'interview' && 'border-fitness/50',
                  )}
                >
                  <span className="text-[15px] font-semibold">{s.title}</span>
                  <span className="text-xs text-subtle">{s.desc}</span>
                  {busy === s.key && <Loader2 className="absolute right-3 top-3 size-4 animate-spin text-accent" />}
                </button>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="내 상황으로 롤플레이" hint="곧 겪을 일을 적으면 그 상황을 연습해요" />
            <CardBody className="space-y-3">
              <Textarea rows={3} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="예: 다음 달 오사카 마라톤 후 호텔에서 체크아웃 시간을 늦춰 달라고 부탁하기" />
              <Button variant="primary" disabled={!custom.trim() || !!busy} onClick={() => start('custom')}>
                {busy === 'custom' ? <Loader2 className="animate-spin" /> : <PenLine />} 이 상황으로 시작
              </Button>
            </CardBody>
          </Card>
          <div className="flex items-start gap-2 rounded-xl border bg-surface-2/40 p-3 text-xs leading-relaxed text-muted">
            <Mic className="mt-0.5 size-4 shrink-0" />
            휴대폰에서는 Tailscale https 주소로 열어야 마이크가 켜져요. 이어폰을 쓰면 AI 목소리가 다시 녹음되지 않아 인식이 더 정확해요.
          </div>
        </div>
        <Card>
          <CardHeader title="지난 대화" />
          <CardBody className="space-y-2">
            {history?.length === 0 && (
              <EmptyState icon={MessagesSquare} title="첫 대화를 시작해 보세요">
                자유 대화부터 해도 좋아요. AI가 지난 대화를 기억하고 이어가요.
              </EmptyState>
            )}
            {history?.map((c) => (
              <Link key={c.id} to={`/talk/${c.id}`} className="lift flex items-center gap-3 rounded-xl border bg-surface-2/40 p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{c.title}</div>
                  <div className="num text-xs text-subtle">
                    {c.created_at.replace('T', ' ').slice(5, 16)} · {c.minutes}분
                    {'wpm' in c.metrics && c.metrics.wpm ? ` · ${c.metrics.wpm} wpm` : ''}
                  </div>
                </div>
                {c.level != null ? (
                  <span className="num rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">{cefr(c.level)}</span>
                ) : c.ended_at ? (
                  <CheckCircle2 className="size-4 text-good" />
                ) : (
                  <Sparkles className="size-4 text-subtle" />
                )}
              </Link>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

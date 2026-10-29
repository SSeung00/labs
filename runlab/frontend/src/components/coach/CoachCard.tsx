import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { Bot, Eye, KeyRound, Loader2, Sparkles } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Markdown } from '@/components/ui/markdown'
import { useCoachContext, useCoachReports, useCoachStatus, useGenerateReport } from '@/api/coach'

function ContextDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, isLoading } = useCoachContext(open)
  return (
    <Dialog open={open} onClose={onClose} title="코치에게 보내는 데이터" description="요약 통계만 보내요 · GPS 경로·초 단위 기록은 보내지 않아요" className="sm:max-w-2xl">
      <pre className="m-5 max-h-[60vh] overflow-auto rounded-xl bg-bg/70 p-4 text-[11px] leading-relaxed text-muted">
        {isLoading ? '불러오는 중…' : JSON.stringify(data, null, 2)}
      </pre>
    </Dialog>
  )
}

export function CoachCard() {
  const { data: status } = useCoachStatus()
  const { data: reports } = useCoachReports()
  const gen = useGenerateReport()
  const [peek, setPeek] = useState(false)
  const latest = reports?.[0]

  return (
    <Card>
      <CardHeader
        title="AI 코치 주간 리포트"
        hint={status?.available ? `Claude (${status.model}) · 내 기록 요약을 바탕으로 작성` : 'Claude API 연결 필요'}
        action={
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setPeek(true)} title="보낼 데이터 보기">
              <Eye />
            </Button>
            {status?.available && (
              <Button size="sm" variant="primary" onClick={() => gen.mutate()} disabled={gen.isPending}>
                {gen.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {gen.isPending ? '작성 중…' : latest ? '다시 작성' : '리포트 받기'}
              </Button>
            )}
          </div>
        }
      />
      <CardBody>
        {gen.error && <p className="mb-3 rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-bad">{gen.error.message}</p>}
        {!status?.available ? (
          <div className="flex items-start gap-3 rounded-xl bg-surface-2/60 p-4 text-sm text-muted">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-accent" />
            <div>
              <p>
                <code className="rounded bg-surface-3 px-1 text-xs">backend/.env</code>에 <code className="rounded bg-surface-3 px-1 text-xs">ANTHROPIC_API_KEY=…</code>를 넣고 백엔드를 다시 시작하면 매주 코치 리포트를 받을 수 있어요.
              </p>
              <p className="mt-1 text-xs text-subtle">API 사용량만큼 Anthropic 요금이 청구돼요. 리포트 1회는 보통 몇 센트 수준이에요.</p>
            </div>
          </div>
        ) : latest ? (
          <>
            <div className="mb-2 flex items-center gap-2 text-[11px] text-subtle">
              <Bot className="size-3.5" />
              {format(parseISO(latest.created_at), 'M월 d일 (EEE) HH:mm', { locale: ko })} 작성
            </div>
            <Markdown source={latest.markdown} />
          </>
        ) : (
          <p className="py-6 text-center text-sm text-subtle">아직 리포트가 없어요. 위의 버튼으로 이번 주 리포트를 받아 보세요.</p>
        )}
      </CardBody>
      <ContextDialog open={peek} onClose={() => setPeek(false)} />
    </Card>
  )
}

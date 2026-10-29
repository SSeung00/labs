import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { ChevronDown, Eye, Loader2, RotateCw, Sparkles } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Markdown } from '@/components/ui/markdown'
import { fmtUsd, useActivityAiContext, useActivityInsight, useAiUsage, useAnalyzeActivity } from '@/api/coach'
import { cn } from '@/lib/utils'

function ContextDialog({ id, open, onClose }: { id: number; open: boolean; onClose: () => void }) {
  const { data, isLoading } = useActivityAiContext(id, open)
  return (
    <Dialog open={open} onClose={onClose} title="AI에 보내는 데이터" description="요약 수치·랩·그날 컨디션만 보내요 · GPS 경로는 보내지 않아요" className="sm:max-w-2xl">
      <pre className="m-5 max-h-[60vh] overflow-auto rounded-xl bg-bg/70 p-4 text-[11px] leading-relaxed text-muted">
        {isLoading ? '불러오는 중…' : JSON.stringify(data, null, 2)}
      </pre>
    </Dialog>
  )
}

/** "Analyze this run" — Claude reads the laps, HR drift, conditions and plan for this one run. */
export function ActivityAiCard({ id }: { id: number }) {
  const { data: usage } = useAiUsage()
  const { data: insight } = useActivityInsight(id)
  const run = useAnalyzeActivity(id)
  const [peek, setPeek] = useState(false)
  const [open, setOpen] = useState(true)

  if (usage && !usage.available) return null
  const busy = run.isPending

  if (!insight) {
    return (
      <Card className="mb-4 flex flex-wrap items-center gap-3 px-5 py-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <Sparkles className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">AI 코치 분석</div>
          <div className="text-xs text-subtle">랩 흐름 · 심박 드리프트 · 날씨 · 계획 대비 · 최근 같은 종류와 비교 (1회 몇 센트)</div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setPeek(true)} title="보낼 데이터 보기">
          <Eye />
        </Button>
        <Button size="sm" variant="primary" onClick={() => run.mutate()} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {busy ? '분석 중… (20초 안팎)' : '분석 받기'}
        </Button>
        {run.error && <p className="w-full rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-bad">{run.error.message}</p>}
        <ContextDialog id={id} open={peek} onClose={() => setPeek(false)} />
      </Card>
    )
  }

  return (
    <Card className="mb-4">
      <CardHeader
        title={
          <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-accent" /> AI 코치 분석
            <ChevronDown className={cn('size-3.5 transition-transform', !open && '-rotate-90')} />
          </button>
        }
        hint={`${format(parseISO(insight.created_at), 'M월 d일 HH:mm', { locale: ko })} · ${fmtUsd(insight.cost_usd)}`}
        action={
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setPeek(true)} title="보낸 데이터 보기">
              <Eye />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => run.mutate()} disabled={busy} title="다시 분석 (RPE·메모를 고친 뒤에)">
              {busy ? <Loader2 className="animate-spin" /> : <RotateCw />}
              <span className="hidden sm:inline">{busy ? '분석 중…' : '다시 분석'}</span>
            </Button>
          </div>
        }
      />
      {open && (
        <CardBody>
          {run.error && <p className="mb-3 rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-bad">{run.error.message}</p>}
          <Markdown source={insight.markdown} />
        </CardBody>
      )}
      <ContextDialog id={id} open={peek} onClose={() => setPeek(false)} />
    </Card>
  )
}

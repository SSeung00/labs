import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUp, Database, FileText, KeyRound, Loader2, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, Segmented, Textarea } from '@/components/ui/controls'
import { Markdown } from '@/components/ui/markdown'
import { useAiStatus } from '@/api/extra'
import { type AskTurn, useAsk, useDeleteReport, useMakeReport, useReport, useReports } from '@/api/tools'
import { addMonths, fmtDate, fmtMonth, thisMonth } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ManualEntry } from './ManualEntry'

type Tab = 'ask' | 'report' | 'entry'

const TABS: { value: Tab; label: string }[] = [
  { value: 'ask', label: '질문하기' },
  { value: 'report', label: '월간 리포트' },
  { value: 'entry', label: '영수증 · 직접 입력' },
]

const SUGGESTIONS = [
  '이번 달 예산 얼마나 남았어?',
  '올해 여행에 쓴 돈을 여행별로 알려줘',
  '구독·정기결제는 한 달에 얼마야?',
  '최근 3개월 동안 가장 많이 쓴 가맹점 5곳',
  '러닝에 올해 얼마 썼어?',
  '지난달보다 많이 쓴 카테고리는?',
]

const TOOL_LABEL: Record<string, string> = {
  spending_summary: '지출 합계',
  find_transactions: '거래 검색',
  budget_status: '예산',
  cash_plan: '자금 계획',
  trips: '여행',
  balances: '잔액',
  recurring: '정기결제',
}

export function AiPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'ask'
  const { data: status } = useAiStatus()

  return (
    <>
      <PageHeader title="AI 도우미" subtitle="내 가계부 데이터로 답하고, 매달 정리해 주고, 영수증을 읽어요" />
      <Segmented value={tab} onChange={(v) => setParams(v === 'ask' ? {} : { tab: v }, { replace: true })} options={TABS} className="mb-4" />
      {status && !status.available && tab !== 'entry' && <SetupCard />}
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>
          {tab === 'ask' && <AskTab disabled={!status?.available} />}
          {tab === 'report' && <ReportTab disabled={!status?.available} />}
          {tab === 'entry' && (
            <Card>
              <CardHeader title="영수증 · 스크린샷 · 직접 입력" hint="현금 결제, 해외 결제, 엑셀보다 먼저 기록하고 싶은 결제를 넣어요" />
              <CardBody>
                <ManualEntry />
              </CardBody>
            </Card>
          )}
        </motion.div>
      </AnimatePresence>
    </>
  )
}

function SetupCard() {
  return (
    <Card className="mb-4 border-accent/40">
      <CardBody className="flex flex-wrap items-start gap-3 pt-4 text-[13px] text-muted">
        <KeyRound className="mt-0.5 size-5 text-accent" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-semibold text-text">Claude API를 연결해 주세요</p>
          <p>
            Max 플랜이면 매달 API 크레딧이 나와요: claude.ai → 설정 → 결제 → API credits에서 Console 조직을 연결하고, Console에서 API 키를 만들어
            <code className="mx-1 rounded bg-surface-2 px-1">backend/.env</code>에 <code className="rounded bg-surface-2 px-1">ANTHROPIC_API_KEY=…</code>로 넣은 뒤 MoneyLab을 다시 실행하세요.
          </p>
        </div>
        <Link to="/settings?tab=connect">
          <Button size="sm">설정 보기</Button>
        </Link>
      </CardBody>
    </Card>
  )
}

const STORE = 'moneylab-ask'

function loadTurns(): AskTurn[] {
  try {
    return JSON.parse(sessionStorage.getItem(STORE) ?? '[]')
  } catch {
    return []
  }
}

function AskTab({ disabled }: { disabled: boolean }) {
  const ask = useAsk()
  const [turns, setTurns] = useState<AskTurn[]>(loadTurns)
  const [q, setQ] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(turns.slice(-20)))
    } catch {
      /* storage unavailable */
    }
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns, pending])

  const send = (question: string) => {
    const text = question.trim()
    if (!text || ask.isPending) return
    setPending(text)
    setQ('')
    ask.mutate(
      { question: text, history: turns.slice(-3).map(({ q, a }) => ({ q, a })) },
      {
        onSuccess: (r) => setTurns((ts) => [...ts, { q: text, a: r.answer, tool_calls: r.tool_calls }]),
        onSettled: () => setPending(null),
      },
    )
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    send(q)
  }

  return (
    <Card className="flex min-h-[60dvh] flex-col">
      <CardBody className="flex-1 space-y-5 pt-5">
        {turns.length === 0 && !pending && (
          <div className="py-6 text-center">
            <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-accent-soft">
              <Sparkles className="size-6 text-accent" />
            </div>
            <p className="mt-3 text-sm text-muted">가계부에 대해 궁금한 걸 물어보세요. 거래 데이터를 직접 조회해서 답해요.</p>
            <div className="mx-auto mt-4 flex max-w-xl flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s, i) => (
                <motion.button
                  key={s}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.04 * i }}
                  onClick={() => send(s)}
                  disabled={disabled}
                  className="rounded-full border bg-surface-2/60 px-3 py-1.5 text-[13px] text-muted transition-colors hover:border-accent/50 hover:text-text disabled:opacity-50"
                >
                  {s}
                </motion.button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <Turn key={i} turn={t} />
        ))}
        {pending && (
          <div className="space-y-2">
            <Bubble text={pending} />
            <div className="flex items-center gap-2 text-sm text-muted">
              <span className="flex gap-1">
                {[0, 1, 2].map((d) => (
                  <motion.span key={d} className="size-1.5 rounded-full bg-accent" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: d * 0.15 }} />
                ))}
              </span>
              데이터를 찾아보는 중…
            </div>
          </div>
        )}
        {ask.error && <p className="text-sm text-bad">{ask.error.message}</p>}
        <div ref={end} />
      </CardBody>
      <form onSubmit={submit} className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] flex items-end gap-2 border-t bg-surface p-3 fold:bottom-0">
        {turns.length > 0 && (
          <Button type="button" size="icon" variant="ghost" title="새 대화" onClick={() => setTurns([])}>
            <RotateCcw />
          </Button>
        )}
        <Textarea
          rows={1}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send(q)
            }
          }}
          placeholder={disabled ? 'Claude API를 연결하면 물어볼 수 있어요' : '예: 지난 3개월 카페에 얼마 썼어?'}
          disabled={disabled}
          className="max-h-32 min-h-10 resize-none"
        />
        <Button type="submit" variant="primary" size="icon" disabled={disabled || !q.trim() || ask.isPending} aria-label="보내기">
          {ask.isPending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
        </Button>
      </form>
    </Card>
  )
}

function Bubble({ text }: { text: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-sm text-accent-fg">{text}</div>
    </motion.div>
  )
}

function Turn({ turn }: { turn: AskTurn }) {
  const used = Array.from(new Set((turn.tool_calls ?? []).map((c) => TOOL_LABEL[c.name] ?? c.name)))
  return (
    <div className="space-y-2">
      <Bubble text={turn.q} />
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="max-w-[95%]">
        <Markdown source={turn.a} />
        {used.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-subtle">
            <Database className="size-3" /> 조회: {used.join(' · ')}
          </div>
        )}
      </motion.div>
    </div>
  )
}

// Opus 5.5 list prices per 1M tokens; other models just show token counts.
const PRICE: Record<string, [number, number]> = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5] }

function cost(model: string, i: number, o: number) {
  const p = PRICE[model]
  return p ? `약 $${((i * p[0] + o * p[1]) / 1e6).toFixed(3)}` : `${i + o} 토큰`
}

function ReportTab({ disabled }: { disabled: boolean }) {
  const { data: reports } = useReports()
  const make = useMakeReport()
  const del = useDeleteReport()
  const [month, setMonth] = useState(addMonths(thisMonth(), -1))
  const [selected, setSelected] = useState<number | null>(null)
  const current = selected ?? reports?.[0]?.id ?? null
  const { data: report, isFetching } = useReport(current)
  const months = Array.from({ length: 12 }, (_, i) => addMonths(thisMonth(), -i))

  return (
    <div className="grid grid-cols-1 items-start gap-4 split:grid-cols-[minmax(220px,0.8fr)_minmax(0,2fr)]">
      <Card>
        <CardHeader title="리포트 만들기" hint="그 달의 지출·예산·정기결제를 정리하고 다음 달 제안을 써요" />
        <CardBody className="space-y-3">
          <div className="flex gap-2">
            <Select value={month} onChange={(e) => setMonth(e.target.value)} className="flex-1">
              {months.map((m) => (
                <option key={m} value={m}>
                  {fmtMonth(m)}
                  {m === thisMonth() ? ' (진행 중)' : ''}
                </option>
              ))}
            </Select>
            <Button variant="primary" disabled={disabled || make.isPending} onClick={() => make.mutate(month, { onSuccess: (r) => setSelected(r.id) })}>
              {make.isPending ? <Loader2 className="animate-spin" /> : <Plus />}만들기
            </Button>
          </div>
          {make.isPending && <p className="text-xs text-muted">30초쯤 걸려요…</p>}
          {make.error && <p className="text-xs text-bad">{make.error.message}</p>}
          <ul className="space-y-1">
            {reports?.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => setSelected(r.id)}
                  className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors', current === r.id ? 'bg-accent-soft' : 'hover:bg-surface-2')}
                >
                  <FileText className="size-4 text-muted" />
                  <span className="flex-1">{fmtMonth(r.month)}</span>
                  <span className="text-[11px] text-subtle">{fmtDate(r.created_at)}</span>
                </button>
              </li>
            ))}
            {reports?.length === 0 && <li className="text-xs text-subtle">아직 없어요</li>}
          </ul>
        </CardBody>
      </Card>
      <Card className="min-h-80">
        {report ? (
          <motion.div key={report.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <CardHeader
              title={<span className="text-text">{fmtMonth(report.month)} 리포트</span>}
              hint={`${fmtDate(report.created_at)} · ${report.model} · ${cost(report.model, report.input_tokens, report.output_tokens)}`}
              action={
                <Button size="icon" variant="ghost" aria-label="삭제" onClick={() => confirm('이 리포트를 지울까요?') && del.mutate(report.id, { onSuccess: () => setSelected(null) })}>
                  <Trash2 />
                </Button>
              }
            />
            <CardBody className={cn(isFetching && 'opacity-70')}>
              <Markdown source={report.markdown} />
            </CardBody>
          </motion.div>
        ) : (
          <CardBody className="grid min-h-80 place-items-center text-center text-sm text-subtle">
            {disabled ? 'Claude API를 연결하면 리포트를 만들 수 있어요' : '왼쪽에서 달을 고르고 만들기를 눌러 보세요'}
          </CardBody>
        )}
      </Card>
    </div>
  )
}

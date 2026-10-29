import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { ArrowRight, Check, Loader2, Sparkles } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useApplyPlan, useProposePlan, type PlanChange } from '@/api/coach'
import { cn } from '@/lib/utils'

const PRESETS = [
  '이번 주 수·목은 출장이라 못 뛰어요',
  '어제부터 종아리가 뻐근해요. 강도 낮춰 주세요',
  '이번 주말 비 예보가 있어요. 롱런을 옮기고 싶어요',
  '요즘 너무 피곤해서 회복 주가 필요해요',
]

const day = (iso: string) => format(parseISO(iso), 'M/d (EEE)', { locale: ko })

function after(c: PlanChange) {
  switch (c.action) {
    case 'move':
      return `${day(c.new_day!)}로 이동`
    case 'set_distance':
      return `${c.new_km}km로`
    case 'to_easy':
      return '이지런으로 낮춤'
    case 'to_rest':
      return '휴식으로'
    case 'skip':
      return '건너뛰기'
  }
}

/** Describe what's going on; Claude proposes minimal edits to the next 3 weeks; you pick which to apply. */
export function PlanAiDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState('')
  const propose = useProposePlan()
  const applyM = useApplyPlan()
  const [off, setOff] = useState<Set<number>>(new Set())
  const p = propose.data

  const close = () => {
    propose.reset()
    applyM.reset()
    setOff(new Set())
    onClose()
  }
  const chosen = p ? p.changes.filter((_, i) => !off.has(i)) : []

  return (
    <Dialog open={open} onClose={close} title="AI로 계획 조정" description="상황을 적으면 앞으로 3주 계획에서 꼭 필요한 것만 고쳐 제안해요" className="sm:max-w-xl">
      <div className="space-y-4 p-5">
        {!p && (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              autoFocus
              placeholder="예: 이번 주 화·목은 야근이라 저녁 러닝이 어려워요"
              className="w-full resize-y rounded-lg border bg-surface-2/60 px-3 py-2 text-sm outline-none placeholder:text-subtle focus:border-accent"
            />
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((t) => (
                <button key={t} onClick={() => setText(t)} className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] text-muted hover:text-text">
                  {t}
                </button>
              ))}
            </div>
            {propose.error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-bad">{propose.error.message}</p>}
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => propose.mutate(text)} disabled={!text.trim() || propose.isPending}>
                {propose.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {propose.isPending ? '계획 살펴보는 중… (20~40초)' : '조정안 받기'}
              </Button>
            </div>
          </>
        )}

        {p && !applyM.isSuccess && (
          <>
            <p className="rounded-xl bg-accent-soft px-4 py-3 text-sm">{p.summary}</p>
            {p.changes.length === 0 ? (
              <p className="text-sm text-muted">바꿀 훈련은 없어요.</p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {p.changes.map((c, i) => (
                  <li key={i} className={cn('flex gap-3 px-3 py-2.5', off.has(i) && 'opacity-40')}>
                    <button
                      onClick={() => setOff((s) => (s.has(i) ? new Set([...s].filter((x) => x !== i)) : new Set([...s, i])))}
                      className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border', !off.has(i) && 'border-accent bg-accent text-accent-fg')}
                      aria-label={off.has(i) ? '포함' : '제외'}
                    >
                      {!off.has(i) && <Check className="size-3.5" strokeWidth={3} />}
                    </button>
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="num text-muted">{day(c.before.day)}</span>
                        <span className="font-semibold">{c.before.title}</span>
                        <ArrowRight className="size-3.5 text-subtle" />
                        <span className="font-semibold text-accent">{after(c)}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-subtle">{c.reason}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {p.advice && <p className="text-[13px] leading-relaxed text-muted">{p.advice}</p>}
            {applyM.error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-bad">{applyM.error.message}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => propose.reset()}>
                다시 쓰기
              </Button>
              {chosen.length > 0 && (
                <Button variant="primary" onClick={() => applyM.mutate(chosen)} disabled={applyM.isPending}>
                  {applyM.isPending ? <Loader2 className="animate-spin" /> : <Check />} {chosen.length}개 적용
                </Button>
              )}
            </div>
          </>
        )}

        {applyM.isSuccess && (
          <div className="space-y-4 py-4 text-center">
            <p className="text-sm">
              <b>{applyM.data.applied}개</b> 훈련을 고쳤어요. 캘린더에서 확인하세요.
            </p>
            <Button onClick={close}>닫기</Button>
          </div>
        )}
      </div>
    </Dialog>
  )
}

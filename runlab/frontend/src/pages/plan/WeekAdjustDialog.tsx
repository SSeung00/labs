import { useEffect } from 'react'
import { format, parseISO } from 'date-fns'
import { Check, Loader2 } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ChangeList } from '@/components/race/ChangeList'
import { useApplyWeek, useWeekPreview, type WeekAction } from '@/api/planner'

const TEXT: Record<WeekAction, { title: string; desc: string }> = {
  lighter: { title: '이 주 가볍게', desc: '첫 강훈련은 그대로 두고, 나머지 강훈련은 이지런으로, 다른 훈련은 거리를 20% 줄여요.' },
  recovery: { title: '회복 주로 바꾸기', desc: '남은 훈련을 모두 쉬운 조깅으로 바꾸고 거리를 40% 줄여요. 다음 주부터는 원래 계획대로 가요.' },
}

/** Preview, then apply, a week-level adjustment. */
export function WeekAdjustDialog({ req, onClose }: { req: { week_start: string; action: WeekAction } | null; onClose: () => void }) {
  const preview = useWeekPreview()
  const apply = useApplyWeek()
  const { mutate } = preview
  useEffect(() => {
    if (req) mutate(req)
  }, [req, mutate])

  if (!req) return <Dialog open={false} onClose={onClose} title="">{null}</Dialog>
  const changes = preview.data?.changes ?? []
  const t = TEXT[req.action]
  const err = preview.error ?? apply.error
  return (
    <Dialog open onClose={onClose} title={t.title} description={`${format(parseISO(req.week_start), 'M월 d일')} 주 · 오늘 이후의 계획만 바뀌어요`} className="sm:max-w-xl">
      <div className="space-y-4 p-5">
        <p className="rounded-xl bg-surface-2/70 px-4 py-3 text-[13px] leading-relaxed text-muted">{t.desc}</p>
        {preview.isPending ? (
          <div className="h-24 animate-pulse rounded-xl bg-surface-2" />
        ) : changes.length ? (
          <ChangeList changes={changes} />
        ) : (
          <p className="text-sm text-subtle">바꿀 훈련이 없어요. 이미 가벼운 주이거나 남은 훈련이 없어요.</p>
        )}
        {err && <p className="rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-bad">{err.message}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" disabled={!changes.length || apply.isPending} onClick={() => apply.mutate(req, { onSuccess: onClose })}>
            {apply.isPending ? <Loader2 className="animate-spin" /> : <Check />} {changes.length}개 변경 적용
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

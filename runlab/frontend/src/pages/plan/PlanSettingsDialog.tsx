import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { ArrowRight, Check, Loader2 } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { useRegenerate, useRegenPreview, type ActivePlan } from '@/api/planner'
import { cn } from '@/lib/utils'
import { Seg } from '@/components/ui/seg'
import { DOW, PHASE } from './workoutMeta'

/** Change the plan's weekly layout and rebuild only the weeks ahead. */
export function PlanSettingsDialog({ data, open, onClose }: { data: ActivePlan; open: boolean; onClose: () => void }) {
  const prm = data.plan.params
  const [days, setDays] = useState(prm.days_per_week ?? 5)
  const [longDow, setLongDow] = useState(prm.long_run_dow ?? 6)
  const [peak, setPeak] = useState(prm.peak_weekly_km ? String(prm.peak_weekly_km) : '')
  const preview = useRegenPreview()
  const regen = useRegenerate()
  const body = { days_per_week: days, long_run_dow: longDow, peak_weekly_km: peak ? Number(peak) : null }
  const sum = preview.data
  const err = preview.error ?? regen.error
  const close = () => {
    preview.reset()
    regen.reset()
    onClose()
  }
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    preview.reset() // settings changed: the preview is stale
  }

  return (
    <Dialog open={open} onClose={close} title="플랜 설정 바꾸기" description="이번 주는 그대로 두고 다음 주부터 다시 짜요 · 그 뒤에 직접 바꾼 훈련도 새로 짜여요" className="sm:max-w-xl">
      <div className="space-y-5 p-5">
        {regen.isSuccess ? (
          <div className="space-y-4 py-4 text-center">
            <p className="text-sm">새 설정으로 {format(parseISO(regen.data.from_day), 'M월 d일')}부터 다시 짰어요.</p>
            <Button onClick={close}>닫기</Button>
          </div>
        ) : (
          <>
            <div>
              <Label>주당 훈련일</Label>
              <Seg value={days} onChange={edit(setDays)} options={[3, 4, 5, 6, 7].map((n) => ({ v: n, l: `${n}일` }))} />
            </div>
            <div>
              <Label>롱런 요일</Label>
              <Seg value={longDow} onChange={edit(setLongDow)} options={DOW.map((d, i) => ({ v: i, l: d }))} />
            </div>
            <div className="max-w-48">
              <Label htmlFor="ps-peak">최고 주간 거리 (km)</Label>
              <Input id="ps-peak" inputMode="decimal" value={peak} onChange={(e) => edit(setPeak)(e.target.value)} placeholder="자동" className="num" />
            </div>

            {sum && (
              <div className="space-y-3 rounded-xl border p-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="text-muted">{format(parseISO(sum.from_day), 'M월 d일 (EEE)', { locale: ko })}부터</span>
                  <span className="num">
                    훈련 {sum.replaced}개 → {sum.created}개
                  </span>
                  <span className="num inline-flex items-center gap-1 text-muted">
                    총 {sum.old_km.toFixed(0)}km <ArrowRight className="size-3" /> <b className="text-text">{sum.new_km.toFixed(0)}km</b>
                  </span>
                </div>
                <p className="text-[11px] text-subtle">등록된 대회 앞뒤의 테이퍼·회복 조정은 적용할 때 다시 반영돼요.</p>
                <div className="grid max-h-52 grid-cols-2 gap-x-4 gap-y-1 overflow-y-auto text-xs sm:grid-cols-3">
                  {sum.weeks.map((w) => (
                    <div key={w.week_start} className="num flex items-center gap-1.5">
                      <span className="size-1.5 shrink-0 rounded-full" style={{ background: PHASE[w.phase].color }} />
                      <span className="w-9 text-subtle">{format(parseISO(w.week_start), 'M/d')}</span>
                      <span className="text-muted">{w.old_km.toFixed(0)}</span>
                      <ArrowRight className="size-3 text-subtle" />
                      <span className={cn('font-semibold', w.new_km > w.old_km + 2 ? 'text-warn' : w.new_km < w.old_km - 2 ? 'text-fitness' : '')}>{w.new_km.toFixed(0)}km</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {err && <p className="rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-bad">{err.message}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close}>
                취소
              </Button>
              {sum ? (
                <Button variant="primary" disabled={regen.isPending} onClick={() => regen.mutate(body)}>
                  {regen.isPending ? <Loader2 className="animate-spin" /> : <Check />} 이대로 다시 짜기
                </Button>
              ) : (
                <Button variant="primary" disabled={preview.isPending} onClick={() => preview.mutate(body)}>
                  {preview.isPending && <Loader2 className="animate-spin" />} 미리 보기
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}

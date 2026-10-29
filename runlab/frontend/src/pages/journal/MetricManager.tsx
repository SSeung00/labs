import { useState } from 'react'
import { Eye, EyeOff, Loader2, Plus } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { useCreateMetricDef, useMetricDefs, usePatchMetricDef, type MetricDef } from '@/api/analytics'
import { cn } from '@/lib/utils'

const KINDS: { v: MetricDef['kind']; l: string; hint: string }[] = [
  { v: 'scale', l: '1–5 점수', hint: '예: 다리 무거움, 동기부여' },
  { v: 'number', l: '숫자', hint: '예: 카페인 mg, 음주 잔, 체지방률' },
  { v: 'bool', l: '예/아니오', hint: '예: 스트레칭 했음, 폼롤러' },
  { v: 'select', l: '선택지', hint: '예: 식사 (가볍게/보통/과식)' },
  { v: 'text', l: '텍스트', hint: '자유 메모' },
]
const POL: { v: NonNullable<MetricDef['polarity']>; l: string }[] = [
  { v: 'higher_better', l: '높을수록 좋음' },
  { v: 'lower_better', l: '낮을수록 좋음' },
  { v: 'neutral', l: '중립' },
]

export function MetricManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: defs = [] } = useMetricDefs(true)
  const create = useCreateMetricDef()
  const patch = usePatchMetricDef()
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<MetricDef['kind']>('scale')
  const [unit, setUnit] = useState('')
  const [options, setOptions] = useState('')
  const [polarity, setPolarity] = useState<NonNullable<MetricDef['polarity']>>('neutral')

  return (
    <Dialog open={open} onClose={onClose} title="일지 지표 관리" description="가민에 없는 어떤 것이든 기록하고, 컨디션 화면과 일지 아래 '직접 비교해 보기'에서 러닝과의 관계를 볼 수 있어요">
      <div className="space-y-6 p-5">
        <form
          className="space-y-3 rounded-xl border bg-surface-2/40 p-4"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate(
              {
                label,
                kind,
                unit: unit || null,
                polarity,
                options: kind === 'select' ? options.split(',').map((o) => o.trim()).filter(Boolean) : null,
              },
              { onSuccess: () => { setLabel(''); setUnit(''); setOptions('') } },
            )
          }}
        >
          <div className="text-sm font-semibold">새 지표</div>
          <div>
            <Label htmlFor="m-label">이름</Label>
            <Input id="m-label" required value={label} onChange={(e) => setLabel(e.target.value)} placeholder="예: 카페인" />
          </div>
          <div>
            <Label>형식</Label>
            <div className="flex flex-wrap gap-1.5">
              {KINDS.map((k) => (
                <button key={k.v} type="button" onClick={() => setKind(k.v)} className={cn('h-8 rounded-full px-3 text-xs font-medium', kind === k.v ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-muted hover:text-text')}>
                  {k.l}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-subtle">{KINDS.find((k) => k.v === kind)?.hint}</p>
          </div>
          {kind === 'number' && (
            <div>
              <Label htmlFor="m-unit">단위</Label>
              <Input id="m-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="mg, 잔, %" />
            </div>
          )}
          {kind === 'select' && (
            <div>
              <Label htmlFor="m-opt">선택지 (쉼표로 구분)</Label>
              <Input id="m-opt" value={options} onChange={(e) => setOptions(e.target.value)} placeholder="가볍게, 보통, 과식" />
            </div>
          )}
          {kind !== 'text' && kind !== 'select' && (
            <div>
              <Label>방향</Label>
              <div className="flex gap-1.5">
                {POL.map((p) => (
                  <button key={p.v} type="button" onClick={() => setPolarity(p.v)} className={cn('h-8 flex-1 rounded-lg text-xs font-medium', polarity === p.v ? 'bg-surface text-text shadow-sm ring-1 ring-border-strong' : 'bg-surface-2 text-muted')}>
                    {p.l}
                  </button>
                ))}
              </div>
            </div>
          )}
          {create.error && <p className="text-xs text-bad">{create.error.message}</p>}
          <Button type="submit" variant="primary" className="w-full" disabled={!label || create.isPending}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />} 추가
          </Button>
        </form>

        <div>
          <div className="mb-2 text-xs font-medium text-muted">지표 목록 · 숨긴 지표는 체크인에 나오지 않지만 기록은 보존돼요</div>
          <ul className="space-y-1.5">
            {defs.map((d) => (
              <li key={d.key} className={cn('flex items-center gap-3 rounded-lg bg-surface-2/60 px-3 py-2', d.archived && 'opacity-50')}>
                <span className="flex-1 text-sm">
                  {d.label}
                  <span className="ml-2 text-[11px] text-subtle">{KINDS.find((k) => k.v === d.kind)?.l}{d.unit ? ` · ${d.unit}` : ''}{d.builtin ? ' · 기본' : ''}</span>
                </span>
                <Button size="icon" variant="ghost" onClick={() => patch.mutate({ key: d.key, archived: !d.archived })} aria-label={d.archived ? '다시 보이기' : '숨기기'}>
                  {d.archived ? <EyeOff /> : <Eye />}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Dialog>
  )
}

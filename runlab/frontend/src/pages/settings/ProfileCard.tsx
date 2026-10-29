import { useState } from 'react'
import { HeartPulse, Loader2, Save } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { useProfile, useSaveProfile, type Profile } from '@/api/analytics'
import { cn } from '@/lib/utils'

const LTHR_F = [0.85, 0.89, 0.94, 1.0]
const MAX_F = [0.68, 0.78, 0.87, 0.93]

type Field = 'max_hr' | 'rest_hr' | 'lthr'

const FIELDS: { key: Field; label: string; help: string }[] = [
  { key: 'max_hr', label: '최대 심박', help: '기록 중 상위 2% 최대 심박으로 추정' },
  { key: 'lthr', label: '젖산역치 심박 (LTHR)', help: '30분 전력 달리기 평균 심박 근처. 25–80분 고강도 러닝으로 추정' },
  { key: 'rest_hr', label: '안정 심박', help: '아침에 일어나 측정한 값. 수면 기록이 있는 날만 추정에 사용' },
]

function Form({ p }: { p: Profile }) {
  const save = useSaveProfile()
  const manual = (k: Field) => (p.sources[k] === 'manual' ? String(Math.round(p[k])) : '')
  const [vals, setVals] = useState<Record<Field, string>>({ max_hr: manual('max_hr'), rest_hr: manual('rest_hr'), lthr: manual('lthr') })
  const [method, setMethod] = useState<'lthr' | 'max'>(p.zone_method === 'max' ? 'max' : 'lthr')

  const num = (k: Field) => (vals[k] ? Number(vals[k]) : (p.estimates[k] ?? p[k]))
  const bounds = method === 'max' ? MAX_F.map((f) => Math.round(num('max_hr') * f)) : LTHR_F.map((f) => Math.round(num('lthr') * f))
  const lowers = [0, ...bounds.map((b) => b + 1)]

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate({
          max_hr: vals.max_hr ? Number(vals.max_hr) : null,
          resting_hr: vals.rest_hr ? Number(vals.rest_hr) : null,
          lthr: vals.lthr ? Number(vals.lthr) : null,
          hr_zone_method: method,
        })
      }}
    >
      {FIELDS.map((f) => (
        <div key={f.key}>
          <div className="flex items-baseline justify-between">
            <Label htmlFor={f.key}>{f.label}</Label>
            <span className={cn('text-[10px] font-medium', vals[f.key] ? 'text-accent' : 'text-subtle')}>
              {vals[f.key] ? '직접 입력' : p.estimates[f.key] ? `추정 ${Math.round(p.estimates[f.key]!)}` : '기본값'}
            </span>
          </div>
          <div className="relative">
            <Input
              id={f.key}
              inputMode="numeric"
              value={vals[f.key]}
              placeholder={String(Math.round(p.estimates[f.key] ?? p[f.key]))}
              onChange={(e) => setVals((s) => ({ ...s, [f.key]: e.target.value.replace(/\D/g, '') }))}
              className="num pr-12"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-subtle">bpm</span>
          </div>
          <p className="mt-1 text-[11px] text-subtle">{f.help}</p>
        </div>
      ))}

      <div>
        <Label>심박 존 기준</Label>
        <div className="flex rounded-lg border bg-surface-2 p-0.5">
          {(['lthr', 'max'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={cn('h-8 flex-1 rounded-md text-xs font-medium', method === m ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text')}
            >
              {m === 'lthr' ? 'LTHR 기준 (권장)' : '최대 심박 기준'}
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-5 gap-1.5">
          {p.zone_names.map((n, i) => (
            <div key={n} className="rounded-lg bg-surface-2/70 px-2 py-2 text-center">
              <div className="mx-auto mb-1 h-1 w-6 rounded-full" style={{ background: `var(--z${i + 1})` }} />
              <div className="text-[10px] text-subtle">{n.split(' ')[0]}</div>
              <div className="num text-xs font-semibold">{i === 4 ? `${lowers[4]}+` : `${i === 0 ? '~' : lowers[i]}–${bounds[i]}`}</div>
            </div>
          ))}
        </div>
      </div>

      {save.error && <p className="text-xs text-bad">{save.error.message}</p>}
      <div className="flex items-center gap-3">
        <span className="text-[11px] text-subtle">저장하면 모든 활동의 부하·존을 다시 계산해요</span>
        <Button type="submit" variant="primary" className="ml-auto" disabled={save.isPending}>
          {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
          {save.isPending ? '재계산 중…' : save.isSuccess ? '저장됨' : '저장'}
        </Button>
      </div>
    </form>
  )
}

export function ProfileCard() {
  const { data } = useProfile()
  return (
    <Card>
      <CardHeader
        title="심박 프로필"
        hint="비워 두면 기록에서 자동 추정해요"
        action={
          <div className="grid size-8 place-items-center rounded-lg bg-surface-2 text-fatigue">
            <HeartPulse className="size-4" />
          </div>
        }
      />
      <CardBody>{data ? <Form key={JSON.stringify(data.sources) + data.zone_method} p={data} /> : <div className="h-80 animate-pulse rounded-xl bg-surface-2" />}</CardBody>
    </Card>
  )
}

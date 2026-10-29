import { useState } from 'react'
import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import { Check, Loader2, Trash2 } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { useDeleteInjury, useInjuries, useSaveInjury, type InjuryRec } from '@/api/life'
import { cn } from '@/lib/utils'
import { BodyMap } from './BodyMap'
import type { Spot } from './spots'
import { useNow } from '@/lib/useNow'

const SIDE = { left: '왼쪽', right: '오른쪽', center: '' } as Record<string, string>
const SEV = ['', '약간 불편', '신경 쓰임', '훈련에 영향', '달리기 어려움', '달릴 수 없음']

function InjuryForm({ spot, onDone }: { spot: Spot; onDone: () => void }) {
  const now = useNow()
  const save = useSaveInjury()
  const [sev, setSev] = useState(2)
  const [start, setStart] = useState(format(now, 'yyyy-MM-dd'))
  const [note, setNote] = useState('')
  return (
    <form
      className="space-y-3 rounded-xl border bg-surface-2/50 p-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate({ body_part: spot.part, side: spot.side, map_x: spot.x, map_y: spot.y, severity: sev, start_day: start, note: note || null }, { onSuccess: onDone })
      }}
    >
      <div className="text-sm font-semibold">
        {SIDE[spot.side]} {spot.part}
      </div>
      <div>
        <Label>정도</Label>
        <div className="grid grid-cols-5 gap-1">
          {[1, 2, 3, 4, 5].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setSev(v)}
              className={cn('num h-9 rounded-lg text-sm font-semibold', sev === v ? (v >= 4 ? 'bg-bad text-white' : v >= 3 ? 'bg-warn text-black' : 'bg-accent text-accent-fg') : 'bg-surface-2 text-muted')}
            >
              {v}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-subtle">{SEV[sev]}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="inj-start">시작일</Label>
          <Input id="inj-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="inj-note">메모</Label>
          <Input id="inj-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="언제 아픈지, 원인 추정" />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>취소</Button>
        <Button type="submit" variant="primary" size="sm" disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" />} 기록
        </Button>
      </div>
    </form>
  )
}

function InjuryRow({ i }: { i: InjuryRec }) {
  const now = useNow()
  const save = useSaveInjury()
  const del = useDeleteInjury()
  const today = format(now, 'yyyy-MM-dd')
  const active = !i.end_day || i.end_day >= today
  const days = differenceInCalendarDays(i.end_day ? parseISO(i.end_day) : now, parseISO(i.start_day)) + 1
  return (
    <li className="flex items-center gap-3 rounded-xl bg-surface-2/60 px-3 py-2.5">
      <span className={cn('size-2.5 shrink-0 rounded-full', active ? 'bg-bad' : 'bg-surface-3')} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">
          {SIDE[i.side ?? 'center']} {i.body_part} <span className="text-xs font-normal text-subtle">· {SEV[i.severity]}</span>
        </div>
        <div className="text-[11px] text-subtle">
          {format(parseISO(i.start_day), 'yy.M.d')} – {i.end_day ? format(parseISO(i.end_day), 'yy.M.d') : '진행 중'} · {days}일{i.note ? ` · ${i.note}` : ''}
        </div>
      </div>
      {active && (
        <Button size="sm" onClick={() => save.mutate({ id: i.id, end_day: today })}>
          <Check /> 회복
        </Button>
      )}
      <Button size="icon" variant="ghost" onClick={() => confirm('이 기록을 삭제할까요?') && del.mutate(i.id)} aria-label="삭제">
        <Trash2 />
      </Button>
    </li>
  )
}

export function InjuryPanel() {
  const { data = [] } = useInjuries()
  const [spot, setSpot] = useState<Spot | null>(null)
  return (
    <Card>
      <CardHeader title="부상 기록" hint="부위를 눌러 기록하세요 · 진행 중인 부상은 준비도와 훈련 제안에 반영돼요" />
      <CardBody>
        <div className="grid gap-5 md:grid-cols-[auto_1fr]">
          <BodyMap injuries={data} onPick={setSpot} selected={spot ? { part: spot.part, side: spot.side } : null} />
          <div className="space-y-3">
            {spot && <InjuryForm key={`${spot.part}-${spot.side}`} spot={spot} onDone={() => setSpot(null)} />}
            {data.length ? (
              <ul className="space-y-2">{data.map((i) => <InjuryRow key={i.id} i={i} />)}</ul>
            ) : (
              !spot && <p className="py-8 text-center text-sm text-subtle">기록된 부상이 없어요. 계속 그렇길! 🏃</p>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  )
}

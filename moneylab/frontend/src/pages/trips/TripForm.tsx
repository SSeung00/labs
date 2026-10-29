import { useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { Segmented } from '@/components/ui/controls'
import { type Trip, type TripKind, useSaveTrip } from '@/api/money'
import { parseWon } from '@/lib/format'

const HINT: Record<TripKind, string> = {
  travel: '기간 안의 지출과, 출발 전 1년 안의 항공·숙소 결제가 자동으로 묶여요. 여행 봉투 예산에서 빠져요.',
  event:
    '학회·단체 행사: 기간 안의 내 지출은 "학회·행사"로 따로 모이고(생활비·여행 예산과 별개), 남 대신 낸 돈은 받을 돈 탭의 정산으로 묶어요.',
}

export function TripForm({ open, onClose, trip }: { open: boolean; onClose: () => void; trip?: Trip }) {
  return (
    <Dialog open={open} onClose={onClose} title={trip ? '수정' : '여행·행사 추가'}>
      <Body key={trip?.id ?? 'new'} trip={trip} onDone={onClose} />
    </Dialog>
  )
}

function Body({ trip, onDone }: { trip?: Trip; onDone: () => void }) {
  const [kind, setKind] = useState<TripKind>(trip?.kind ?? 'travel')
  const [name, setName] = useState(trip?.name ?? '')
  const [start, setStart] = useState(trip?.start_date ?? '')
  const [end, setEnd] = useState(trip?.end_date ?? '')
  const [budget, setBudget] = useState(trip?.budget ? String(trip.budget) : '')
  const save = useSaveTrip()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(
      { id: trip?.id, kind, name: name.trim(), start_date: start, end_date: end || start, budget: parseWon(budget) },
      { onSuccess: onDone },
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4 px-5 py-4">
      <div>
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'travel', label: '여행' },
            { value: 'event', label: '학회·행사' },
          ]}
        />
        <p className="mt-2 text-xs leading-relaxed text-muted">{HINT[kind]}</p>
      </div>
      <div>
        <Label htmlFor="trip-name">이름</Label>
        <Input id="trip-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'event' ? '예: 2026 경주 지진공학회' : '예: 2026 브리즈번'} required autoFocus />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="trip-start">{kind === 'event' ? '시작' : '출발'}</Label>
          <Input id="trip-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="trip-end">{kind === 'event' ? '끝' : '도착'}</Label>
          <Input id="trip-end" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      <div>
        <Label htmlFor="trip-budget">예산 (선택)</Label>
        <Input id="trip-budget" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="예: 250만" inputMode="numeric" />
      </div>
      {save.error && <p className="text-sm text-bad">{save.error.message}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          취소
        </Button>
        <Button type="submit" variant="primary" disabled={!name.trim() || !start || save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" />}
          저장
        </Button>
      </div>
    </form>
  )
}

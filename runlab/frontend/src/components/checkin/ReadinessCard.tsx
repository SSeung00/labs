import { useState } from 'react'
import { format } from 'date-fns'
import { ClipboardCheck, TriangleAlert } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { useReadiness, type Readiness } from '@/api/analytics'
import { CheckinForm } from './CheckinForm'
import { useNow } from '@/lib/useNow'

const LEVEL: Record<Readiness['level'], { label: string; color: string }> = {
  high: { label: '좋음', color: 'var(--good)' },
  ok: { label: '보통', color: 'var(--form)' },
  low: { label: '주의', color: 'var(--warn)' },
  very_low: { label: '회복 필요', color: 'var(--bad)' },
}

function Gauge({ score, color }: { score: number; color: string }) {
  // 240° arc gauge.
  const r = 46
  const c = 2 * Math.PI * r
  const arc = c * (240 / 360)
  const filled = arc * (score / 100)
  return (
    <svg viewBox="0 0 120 108" className="h-28 w-32 shrink-0" role="img" aria-label={`준비도 ${score}점`}>
      <g transform="rotate(150 60 60)">
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${arc} ${c}`} />
        <circle
          cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={`${filled} ${c}`} style={{ transition: 'stroke-dasharray .8s ease' }}
        />
      </g>
      <text x="60" y="64" textAnchor="middle" className="fill-[var(--text)] text-[28px] font-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {score}
      </text>
      <text x="60" y="82" textAnchor="middle" className="fill-[var(--text-subtle)] text-[10px]">
        / 100
      </text>
    </svg>
  )
}

export function ReadinessCard() {
  const now = useNow()
  const { data } = useReadiness()
  const [open, setOpen] = useState(false)
  const today = format(now, 'yyyy-MM-dd')

  return (
    <Card className="flex flex-col">
      <CardHeader
        title="오늘의 준비도"
        hint="훈련 부하 + 아침 체크인"
        action={
          <Button size="sm" variant={data?.has_checkin ? 'ghost' : 'primary'} onClick={() => setOpen(true)}>
            <ClipboardCheck />
            {data?.has_checkin ? '수정' : '체크인'}
          </Button>
        }
      />
      <CardBody className="flex-1">
        {!data ? (
          <div className="h-36 animate-pulse rounded-xl bg-surface-2" />
        ) : (
          <>
            <div className="flex flex-col items-center text-center">
              <Gauge score={data.score} color={LEVEL[data.level].color} />
              <span
                className="-mt-3 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold"
                style={{ color: LEVEL[data.level].color, background: `color-mix(in srgb, ${LEVEL[data.level].color} 14%, transparent)` }}
              >
                {LEVEL[data.level].label}
              </span>
              <p className="mt-2 text-sm leading-snug">{data.advice}</p>
              {!data.has_checkin && <p className="mt-1 text-[11px] text-subtle">체크인하면 수면·피로도까지 반영돼요</p>}
            </div>
            <div className="mt-3 space-y-1.5">
              {data.components.map((c) => (
                <div key={c.key} className="grid grid-cols-[5.5rem_1fr_3.5rem] items-center gap-2 text-[11px]">
                  <span className="truncate text-muted">{c.label}</span>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                    <div className="h-full rounded-full bg-[var(--form)]" style={{ width: `${c.score}%` }} />
                  </div>
                  <span className="num text-right text-subtle">{c.detail}</span>
                </div>
              ))}
            </div>
            {data.flags.length > 0 && (
              <ul className="mt-3 space-y-1">
                {data.flags.map((f) => (
                  <li key={f} className="flex items-start gap-1.5 text-[11px] text-warn">
                    <TriangleAlert className="mt-px size-3 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardBody>
      <Dialog open={open} onClose={() => setOpen(false)} title="아침 체크인" description="30초면 끝나요 · 비워 둔 항목은 저장되지 않아요">
        {data && <CheckinForm key={data.day + JSON.stringify(data.checkin)} day={today} initial={data.checkin} onSaved={() => setOpen(false)} />}
      </Dialog>
    </Card>
  )
}

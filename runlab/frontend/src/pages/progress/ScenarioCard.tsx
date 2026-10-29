import { format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { Info } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import type { Scenarios } from '@/api/progress'
import { fmtDuration } from '@/lib/format'
import { cn } from '@/lib/utils'

/** What-if table: race-day fitness when the active plan is followed at different compliance levels. */
export function ScenarioCard({ data }: { data: Scenarios }) {
  const { link } = data
  return (
    <Card>
      <CardHeader
        title={`플랜 이행률별 레이스 예측 · ${data.plan_name}`}
        hint={`${format(parseISO(data.race_day), 'yyyy년 M월 d일', { locale: ko })} 레이스 · 목표 ${data.goal_time_s ? fmtDuration(data.goal_time_s) : '없음'}${
          data.actual_compliance != null ? ` · 지금까지 이행률 ${Math.round(data.actual_compliance * 100)}%` : ''
        }`}
      />
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-sm sm:min-w-[560px]">
          <thead>
            <tr className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
              <th className="py-2 pl-5 text-left">시나리오</th>
              <th className="px-2 text-right">VDOT</th>
              <th className="px-2 text-right">예상 기록</th>
              <th className="py-2 pl-2 pr-5 text-right sm:pr-2">목표 대비</th>
              <th className="hidden px-2 text-right sm:table-cell">최고 CTL</th>
              <th className="hidden py-2 pr-5 text-right sm:table-cell">레이스 날 TSB</th>
            </tr>
          </thead>
          <tbody>
            {data.scenarios.map((s, i) => (
              <tr key={s.label} className="border-t">
                <td className="py-3 pl-5">
                  <span className="inline-flex items-center gap-2 font-medium">
                    <span className="h-0.5 w-4 rounded-full bg-accent" style={{ opacity: Math.max(0.35, 1 - i * 0.22) }} />
                    {s.label}
                  </span>
                </td>
                <td className="num px-2 text-right font-semibold">{s.race_day_vdot.toFixed(1)}</td>
                <td className="num px-2 text-right text-base font-bold">{fmtDuration(s.predicted_time_s)}</td>
                <td className={cn('num py-3 pl-2 pr-5 text-right sm:pr-2', s.vs_goal_s == null ? 'text-subtle' : s.vs_goal_s <= 0 ? 'text-good' : 'text-warn')}>
                  {s.vs_goal_s == null ? '—' : `${s.vs_goal_s <= 0 ? '−' : '+'}${fmtDuration(Math.abs(s.vs_goal_s))}`}
                </td>
                <td className="num hidden px-2 text-right sm:table-cell">{s.peak_ctl.toFixed(0)}</td>
                <td className={cn('num hidden py-3 pr-5 text-right sm:table-cell', s.race_day_tsb >= 5 && s.race_day_tsb <= 25 ? 'text-good' : 'text-muted')}>
                  {s.race_day_tsb > 0 ? '+' : ''}
                  {s.race_day_tsb.toFixed(0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CardBody className="pt-3">
        <div className="flex items-start gap-2 rounded-xl bg-surface-2/60 p-3 text-[11px] leading-relaxed text-subtle">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <p>
            남은 계획 부하에 이행률을 곱해 체력(CTL)의 흐름을 계산하고, 내 기록에서 학습한 관계(CTL 1 ↑ → {link.lag}일 뒤 VDOT {link.slope.toFixed(2)} ↑
            {link.r != null ? `, 상관 r=${link.r.toFixed(2)}` : ''}
            {link.fallback ? ' · 데이터 부족으로 기본값 사용' : ''})로 VDOT을 예측해요. 계획 부하는 내 실제 기록 기준으로 ×{link.load_calibration} 보정했고, 지금까지 경험한 최고 CTL({link.hist_max_ctl.toFixed(0)}) 이상은 효과를 할인했으며, 향상 속도는 주당 {link.max_gain_per_week} VDOT 근처에서 완만해지도록 제한했어요.
            테이퍼 효과(레이스 날 TSB)는 기록에 따로 더하지 않았으니, TSB가 +5~+25면 예상보다 조금 더 잘 뛸 수 있어요.
          </p>
        </div>
      </CardBody>
    </Card>
  )
}

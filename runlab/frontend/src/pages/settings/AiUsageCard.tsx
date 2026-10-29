import { useState } from 'react'
import { Check, KeyRound, RotateCcw, Sparkles } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { fmtUsd, useAiConfig, useAiUsage, useSetAiConfig, useSetBudget } from '@/api/coach'
import { cn } from '@/lib/utils'

const FEATURES: Record<string, string> = {
  chat: 'AI 코치 대화',
  activity: '러닝 분석',
  weekly: '주간 리포트',
  plan: '계획 조정',
  journal: '말로 기록',
}

const EFFORT_LABEL: Record<string, string> = { low: 'low · 빠름', medium: 'medium', high: 'high · 깊게', xhigh: 'xhigh · 아주 깊게' }
const SHORT: Record<string, string> = { 'claude-opus-5-5': 'Opus', 'claude-sonnet-5-5': 'Sonnet', 'claude-haiku-5-5': 'Haiku' }

const selectCls = 'h-8 rounded-lg border bg-surface-2/70 px-2 text-xs outline-none focus:border-accent'

/** Which model and how much thinking each AI feature uses. */
function ModelSettings() {
  const { data } = useAiConfig()
  const setCfg = useSetAiConfig()
  if (!data) return null
  return (
    <div className="space-y-2 border-t pt-4">
      <div className="text-xs font-semibold text-muted">기능별 모델 · effort</div>
      <ul className="space-y-3">
        {data.features.map((f) => {
          const custom = f.model !== f.default_model || f.effort !== f.default_effort
          const put = (model: string, effort: string) => setCfg.mutate({ feature: f.key, model, effort })
          return (
            <li key={f.key}>
              <div className="flex items-center justify-between">
                <span className="text-sm">{f.label}</span>
                {custom && (
                  <button
                    onClick={() => put(f.default_model, f.default_effort)}
                    className="inline-flex items-center gap-1 text-[11px] text-subtle hover:text-text"
                    title={`기본값: ${SHORT[f.default_model]} · ${f.default_effort}`}
                  >
                    <RotateCcw className="size-3" /> 기본값으로
                  </button>
                )}
              </div>
              <div className="mt-1 flex gap-2">
                <select value={f.model} onChange={(e) => put(e.target.value, f.effort)} className={cn(selectCls, 'min-w-0 flex-1')} aria-label={`${f.label} 모델`}>
                  {data.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} (${m.input_per_mtok}/${m.output_per_mtok})
                    </option>
                  ))}
                </select>
                <select value={f.effort} onChange={(e) => put(f.model, e.target.value)} className={cn(selectCls, 'w-32')} aria-label={`${f.label} effort`}>
                  {data.efforts.map((e) => (
                    <option key={e} value={e}>
                      {EFFORT_LABEL[e] ?? e}
                    </option>
                  ))}
                </select>
              </div>
            </li>
          )
        })}
      </ul>
      {setCfg.error && <p className="text-xs text-bad">{setCfg.error.message}</p>}
      <p className="text-[11px] leading-relaxed text-subtle">
        가격은 100만 토큰당 입력/출력 달러. effort가 높을수록 더 오래 생각하고(생각도 출력 요금) 느려져요. 코치 대화는 시작할 때의 모델로 끝까지 이어가요.
      </p>
    </div>
  )
}

/** Spend meter for the Claude API, with an app-side budget cap. */
export function AiUsageCard() {
  const { data: u } = useAiUsage()
  const setBudget = useSetBudget()
  const [draft, setDraft] = useState<string | null>(null)
  if (!u) return null

  const pct = u.budget_usd ? Math.min(1, u.spent_usd / u.budget_usd) : 0
  return (
    <Card>
      <CardHeader title="AI 사용량" hint={u.available ? `예산을 다 쓰면 AI 기능이 멈춰요` : 'API 키가 없어요'} action={<Sparkles className="size-4 text-accent" />} />
      <CardBody className="space-y-4">
        {!u.available ? (
          <div className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-muted">
            <KeyRound className="mt-0.5 size-3.5 shrink-0 text-accent" />
            backend/.env에 ANTHROPIC_API_KEY=… 를 넣고 RunLab을 다시 시작하세요.
          </div>
        ) : (
          <>
            <div>
              <div className="flex items-baseline justify-between">
                <span className="num text-2xl font-bold">{fmtUsd(u.spent_usd)}</span>
                <span className="num text-xs text-subtle">예산 ${u.budget_usd.toFixed(0)} · 남음 {fmtUsd(u.remaining_usd)}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3">
                <div className={cn('h-full rounded-full', pct > 0.9 ? 'bg-bad' : pct > 0.7 ? 'bg-warn' : 'bg-accent')} style={{ width: `${Math.max(pct * 100, pct ? 1.5 : 0)}%` }} />
              </div>
              <div className="num mt-1 text-[11px] text-subtle">이번 달 {fmtUsd(u.this_month_usd)}</div>
            </div>
            {Object.keys(u.by_feature).length > 0 && (
              <ul className="space-y-1.5 text-sm">
                {Object.entries(u.by_feature)
                  .sort((a, b) => b[1].usd - a[1].usd)
                  .map(([k, v]) => (
                    <li key={k} className="flex items-center justify-between">
                      <span className="text-muted">{FEATURES[k] ?? k}</span>
                      <span className="num text-xs">
                        {v.calls}회 · <b>{fmtUsd(v.usd)}</b>
                      </span>
                    </li>
                  ))}
              </ul>
            )}
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                const v = Number(draft)
                if (draft != null && v >= 0) setBudget.mutate(v, { onSuccess: () => setDraft(null) })
              }}
            >
              <span className="text-xs text-muted">예산 $</span>
              <Input
                value={draft ?? String(u.budget_usd)}
                onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ''))}
                inputMode="decimal"
                className="num h-8 w-24"
                aria-label="AI 예산 (달러)"
              />
              {draft != null && (
                <Button size="sm" type="submit" disabled={setBudget.isPending}>
                  <Check /> 저장
                </Button>
              )}
            </form>
            {Object.keys(u.by_model ?? {}).length > 1 && (
              <p className="num text-[11px] text-subtle">
                모델별:{' '}
                {Object.entries(u.by_model)
                  .map(([m, v]) => `${SHORT[m] ?? m} ${fmtUsd(v.usd)}`)
                  .join(' · ')}
              </p>
            )}
            <ModelSettings />
            <p className="text-[11px] leading-relaxed text-subtle">
              앱이 계산한 추정치예요. 정확한 청구액은 console.anthropic.com에서 확인하세요. 실측: 러닝 분석 Opus 5.5센트 · Sonnet 2센트, 코치 질문 7~16센트(Opus), 말로 기록 0.1센트 미만(Haiku).
            </p>
          </>
        )}
      </CardBody>
    </Card>
  )
}

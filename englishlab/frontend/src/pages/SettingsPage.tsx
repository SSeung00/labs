import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Compass, Loader2, Save, Volume2, X } from 'lucide-react'
import { put, useAi, useProfile, useUpdateProfile } from '@/api/el'
import type { Profile } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Progress, Select } from '@/components/ui/controls'
import { Input, Label } from '@/components/ui/input'
import { PageHeader } from '@/components/layout/PageHeader'
import { speak } from '@/lib/audio'
import { cn } from '@/lib/utils'
import { MobileCard } from './settings/MobileCard'
import { PcAppCard } from './settings/PcAppCard'

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="flex w-full items-center gap-3 text-left">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-subtle">{hint}</div>}
      </div>
      <span className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors', on ? 'bg-accent' : 'bg-surface-3')}>
        <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform', on ? 'translate-x-[22px]' : 'translate-x-0.5')} />
      </span>
    </button>
  )
}

function GoalCard({ p }: { p: Profile }) {
  const update = useUpdateProfile()
  const [f, setF] = useState(p)
  const [interest, setInterest] = useState('')
  useEffect(() => setF(p), [p])
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setF((x) => ({ ...x, [k]: v }))
  return (
    <Card>
      <CardHeader title="목표와 공부량" />
      <CardBody className="space-y-4">
        <div>
          <Label>목표 (AI 튜터와 리포트가 참고해요)</Label>
          <Input value={f.goal} onChange={(e) => set('goal', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <Label>목표 날짜</Label>
            <Input type="date" value={f.target_date} onChange={(e) => set('target_date', e.target.value)} />
          </div>
          <div>
            <Label>하루 계획 (분)</Label>
            <Input type="number" value={f.daily_minutes} onChange={(e) => set('daily_minutes', Number(e.target.value))} />
          </div>
          <div>
            <Label>일일 목표 링 (분)</Label>
            <Input type="number" value={f.daily_goal_minutes} onChange={(e) => set('daily_goal_minutes', Number(e.target.value))} />
          </div>
          <div>
            <Label>하루 새 카드</Label>
            <Input type="number" value={f.new_cards_per_day} onChange={(e) => set('new_cards_per_day', Number(e.target.value))} />
          </div>
        </div>
        <div>
          <Label>관심사</Label>
          <div className="flex flex-wrap gap-1.5">
            {f.interests.map((i) => (
              <span key={i} className="flex items-center gap-1 rounded-full border bg-surface-2/60 py-1 pl-3 pr-1.5 text-sm">
                {i}
                <button onClick={() => set('interests', f.interests.filter((x) => x !== i))} className="text-subtle" aria-label="삭제">
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
            <input
              value={interest}
              onChange={(e) => setInterest(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && interest.trim()) {
                  set('interests', [...f.interests, interest.trim()])
                  setInterest('')
                }
              }}
              placeholder="+ 추가 (Enter)"
              className="h-8 min-w-32 flex-1 rounded-full border bg-transparent px-3 text-sm outline-none"
            />
          </div>
        </div>
        <Button variant="primary" disabled={update.isPending} onClick={() => update.mutate(f)}>
          {update.isPending ? <Loader2 className="animate-spin" /> : <Save />} 저장
        </Button>
      </CardBody>
    </Card>
  )
}

function VoiceCard({ p, voices }: { p: Profile; voices: { id: string; label: string }[] }) {
  const update = useUpdateProfile()
  return (
    <Card>
      <CardHeader title="목소리 · 듣기" hint="여러 억양에 익숙해지려면 가끔 바꿔 보세요" />
      <CardBody className="space-y-4">
        <div className="flex gap-2">
          <Select value={p.voice} onChange={(e) => update.mutate({ voice: e.target.value })} className="flex-1">
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </Select>
          <Button variant="secondary" onClick={() => speak("Hi! I'm your English partner. Shall we talk about your day?")}>
            <Volume2 /> 미리 듣기
          </Button>
        </div>
        <div>
          <Label>
            말하기 속도 {p.tts_rate > 0 ? '+' : ''}
            {p.tts_rate}% (레벨이 낮으면 자동으로 조금 느려져요)
          </Label>
          <input type="range" min={-30} max={30} step={5} value={p.tts_rate} onChange={(e) => update.mutate({ tts_rate: Number(e.target.value) })} className="w-full accent-[var(--accent)]" />
        </div>
        <Toggle on={p.hide_ai_text} onChange={(v) => update.mutate({ hide_ai_text: v })} label="AI 대답 글자 가리기" hint="먼저 귀로 듣고, 탭해서 확인 (듣기 훈련)" />
        <Toggle on={p.auto_mistake_cards} onChange={(v) => update.mutate({ auto_mistake_cards: v })} label="실수를 교정 카드로 자동 추가" hint="대화·진단에서 찾은 반복 실수를 복습 카드로" />
      </CardBody>
    </Card>
  )
}

function MemoryCard({ memory }: { memory: string[] }) {
  const qc = useQueryClient()
  const [items, setItems] = useState(memory)
  useEffect(() => setItems(memory), [memory])
  return (
    <Card>
      <CardHeader title="AI 튜터의 기억" hint="대화가 끝날 때마다 AI가 기억할 것을 정리해요. 틀린 건 지워 주세요" />
      <CardBody className="space-y-2">
        {items.length === 0 && <p className="text-sm text-subtle">아직 기억하는 게 없어요.</p>}
        {items.map((m, i) => (
          <div key={i} className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
            <span className="flex-1">{m}</span>
            <button
              onClick={async () => {
                const next = items.filter((_, j) => j !== i)
                setItems(next)
                await put('/memory', { facts: next })
                qc.invalidateQueries({ queryKey: ['profile'] })
              }}
              className="text-subtle"
              aria-label="지우기"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </CardBody>
    </Card>
  )
}

function AiCard() {
  const { data } = useAi()
  const qc = useQueryClient()
  const [budget, setBudget] = useState('')
  useEffect(() => {
    if (data) setBudget(String(data.usage.budget_usd))
  }, [data])
  if (!data) return null
  const u = data.usage
  const refresh = () => qc.invalidateQueries({ queryKey: ['ai'] })
  return (
    <Card>
      <CardHeader
        title="AI (Claude)"
        hint={
          u.provider === 'cli'
            ? u.cli.available
              ? `Claude 구독으로 실행 중 (Claude Code ${u.cli.version ?? ''}) · 호출당 비용 없음, 요금제 사용 한도에서 차감`
              : u.cli.reason ?? 'Claude CLI를 쓸 수 없어요'
            : u.api_key
              ? 'API 키로 실행 중 · 모든 호출은 비용이 기록되고 월 상한에서 멈춰요'
              : 'API 키가 없어요: backend/.env에 ANTHROPIC_API_KEY를 넣고 다시 시작하세요'
        }
      />
      <CardBody className="space-y-4">
        <div>
          <Label>실행 방식</Label>
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                ['auto', '자동', 'CLI가 되면 CLI'],
                ['cli', 'Claude 구독', 'claude -p (CLI)'],
                ['api', 'API 키', '사용량만큼 과금'],
              ] as const
            ).map(([k, label, sub]) => (
              <button
                key={k}
                onClick={async () => {
                  await put('/ai/provider', { provider: k })
                  refresh()
                }}
                className={cn('rounded-xl border px-2 py-2 text-center', u.provider_pref === k ? 'border-accent bg-accent-soft' : '')}
              >
                <div className="text-sm font-semibold">{label}</div>
                <div className="text-[11px] text-subtle">{sub}</div>
              </button>
            ))}
          </div>
          {u.provider === 'cli' && (
            <p className="mt-2 text-xs text-subtle">
              이번 달 CLI 사용량을 API 요금으로 환산하면 약 ${u.cli_month_equiv_usd.toFixed(2)}예요 (실제 청구 없음). API보다 응답이 1~2초 느려요.
            </p>
          )}
        </div>
        <div>
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className="text-muted">이번 달 API 청구액</span>
            <span className="num font-semibold">
              ${u.month_usd.toFixed(2)} / ${u.budget_usd}
            </span>
          </div>
          <Progress value={u.month_usd / Math.max(0.01, u.budget_usd)} />
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label>월 상한 ($)</Label>
            <Input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} />
          </div>
          <Button
            onClick={async () => {
              await put('/ai/budget', { budget_usd: Number(budget) || 0 })
              refresh()
            }}
          >
            저장
          </Button>
        </div>
        <div className="space-y-2">
          {data.config.features.map((f) => (
            <div key={f.key} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-36 flex-1">{f.label}</span>
              <select
                value={f.model}
                onChange={async (e) => {
                  await put(`/ai/features/${f.key}`, { model: e.target.value, effort: f.effort })
                  refresh()
                }}
                className="h-8 rounded-lg border bg-surface-2/60 px-2 text-xs"
              >
                {data.config.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <select
                value={f.effort}
                onChange={async (e) => {
                  await put(`/ai/features/${f.key}`, { model: f.model, effort: e.target.value })
                  refresh()
                }}
                className="h-8 rounded-lg border bg-surface-2/60 px-2 text-xs"
              >
                {data.config.efforts.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
              <span className="num w-14 text-right text-xs text-subtle">${(u.by_feature[f.key]?.usd ?? 0).toFixed(2)}</span>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  )
}

export function SettingsPage() {
  const { data } = useProfile()
  if (!data) return null
  return (
    <div className="space-y-5">
      <PageHeader
        title="설정"
        actions={
          <Link to="/placement">
            <Button variant="secondary">
              <Compass /> 레벨 다시 진단
            </Button>
          </Link>
        }
      />
      <GoalCard p={data.profile} />
      <div className="grid gap-5 split:grid-cols-2">
        <VoiceCard p={data.profile} voices={data.voices} />
        <MemoryCard memory={data.memory} />
      </div>
      <AiCard />
      <div className="grid gap-5 split:grid-cols-2">
        <PcAppCard />
        <MobileCard />
      </div>
    </div>
  )
}

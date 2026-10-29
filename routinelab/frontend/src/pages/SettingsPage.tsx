import { useEffect, useState, type ReactNode } from 'react'
import { BellOff, BellRing, Download, Loader2, Monitor, Plus, Send, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import type { Settings } from '@/api/types'
import { post } from '@/api/client'
import { useAuthStatus } from '@/api/auth'
import { useDesktop, usePushInfo, useSaveSettings, useSetAutostart, useSettings } from '@/api/rl'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageSkeleton } from '@/components/layout/PageSkeleton'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/controls'
import { useTheme, type ThemePref } from '@/stores/theme'
import { currentEndpoint, disablePush, enablePush, pushSupported } from '@/lib/push'
import { cn } from '@/lib/utils'
import { MobileCard } from './settings/MobileCard'

function Row({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-[180px] flex-1">
        <div className="text-sm font-medium">{title}</div>
        {hint && <div className="mt-0.5 text-xs leading-relaxed text-subtle">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors', on ? 'bg-accent' : 'bg-surface-3')}
    >
      <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', on ? 'left-[22px]' : 'left-0.5')} />
    </button>
  )
}

function NotifyCard({ s, save }: { s: Settings; save: (c: Partial<Settings>) => void }) {
  const qc = useQueryClient()
  const { data: info } = usePushInfo()
  const [endpoint, setEndpoint] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => {
    currentEndpoint().then(setEndpoint).catch(() => setEndpoint(null))
  }, [])
  const here = !!endpoint && !!info?.devices.some((d) => d.endpoint === endpoint)

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
      setMsg({ ok: true, text: ok })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setEndpoint(await currentEndpoint().catch(() => null))
      qc.invalidateQueries({ queryKey: ['push'] })
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader title="알림" hint="PC가 휴대폰으로 보내요. 앱을 닫아 둬도 와요." />
      <CardBody className="pt-1">
        <div className="rounded-xl border bg-surface-2/50 p-3">
          {!pushSupported() ? (
            <p className="text-xs text-subtle">이 브라우저에서는 알림을 받을 수 없어요. 휴대폰 Chrome에서 홈 화면에 추가한 RoutineLab으로 열어 주세요.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex-1 text-sm">{here ? '이 기기에서 알림을 받고 있어요.' : '이 기기는 아직 알림을 받지 않아요.'}</span>
              {here ? (
                <>
                  <Button size="sm" disabled={busy} onClick={() => run(() => post<{ sent: number }>('/push/test').then((r) => { if (!r.sent) throw new Error('보낸 기기가 없어요.') }), '테스트 알림을 보냈어요. 몇 초 안에 와요.')}>
                    <Send /> 테스트
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(disablePush, '이 기기 알림을 껐어요.')}>
                    <BellOff /> 끄기
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="primary" disabled={busy || !info} onClick={() => run(() => enablePush(info!.key), '알림을 켰어요. 테스트를 눌러 확인해 보세요.')}>
                  {busy ? <Loader2 className="animate-spin" /> : <BellRing />} 이 기기에서 알림 받기
                </Button>
              )}
            </div>
          )}
          {msg && <p className={cn('mt-2 text-xs', msg.ok ? 'text-good' : 'text-bad')}>{msg.text}</p>}
          {info && info.devices.length > 0 && (
            <p className="mt-2 text-[11px] text-subtle">알림 받는 기기: {info.devices.map((d) => d.label || '기기').join(', ')}</p>
          )}
        </div>
        <div className="divide-y">
          <Row title="아침 알림" hint="오늘의 루틴 개수와 첫 루틴을 알려 줘요">
            <Input type="time" value={s.morning_time} onChange={(e) => e.target.value && save({ morning_time: e.target.value })} className="w-[120px]" disabled={!s.morning_on} />
            <Toggle on={s.morning_on} onChange={(v) => save({ morning_on: v })} label="아침 알림" />
          </Row>
          <Row title="회고 알림" hint="저녁에 신호등 결과와 함께 하루 돌아보기를 권해요">
            <Input type="time" value={s.review_time} onChange={(e) => e.target.value && save({ review_time: e.target.value })} className="w-[120px]" disabled={!s.review_on} />
            <Toggle on={s.review_on} onChange={(v) => save({ review_on: v })} label="회고 알림" />
          </Row>
          <Row title="주말엔 쉬기" hint="토·일에는 아침·회고 알림을 보내지 않아요 (루틴별 알림은 그대로)">
            <Toggle on={s.weekend_quiet} onChange={(v) => save({ weekend_quiet: v })} label="주말엔 쉬기" />
          </Row>
          <p className="pt-3 text-xs text-subtle">루틴별 알림은 루틴 편집에서 시간을 정하면, 그때까지 안 했을 때만 와요. 알림의 ‘했어요’ 버튼으로 바로 체크할 수 있어요.</p>
        </div>
      </CardBody>
    </Card>
  )
}

function QuestionsCard({ s, save }: { s: Settings; save: (c: Partial<Settings>) => void }) {
  const [qs, setQs] = useState(s.questions)
  useEffect(() => setQs(s.questions), [s.questions])
  const commit = (next: string[]) => save({ questions: next.filter((q) => q.trim()) })
  return (
    <Card>
      <CardHeader title="회고 질문" hint="매일 밤 이 질문에 한두 줄씩 답해요" />
      <CardBody className="space-y-2 pt-2">
        {qs.map((q, i) => (
          <div key={i} className="flex gap-2">
            <Input value={q} onChange={(e) => setQs(qs.map((x, j) => (j === i ? e.target.value : x)))} onBlur={() => commit(qs)} />
            <Button variant="ghost" size="icon" className="size-10" onClick={() => commit(qs.filter((_, j) => j !== i))} aria-label="질문 지우기">
              <X />
            </Button>
          </div>
        ))}
        {qs.length < 8 && (
          <Button size="sm" variant="ghost" onClick={() => setQs([...qs, ''])}>
            <Plus /> 질문 추가
          </Button>
        )}
      </CardBody>
    </Card>
  )
}

function PcCard() {
  const { data: auth } = useAuthStatus()
  const { data } = useDesktop()
  const set = useSetAutostart()
  if (!auth?.local || !data?.windows) return null
  return (
    <Card>
      <CardHeader title="PC 앱" hint="RunLab처럼 PC를 켜면 창 없이 뒤에서 실행돼요" />
      <CardBody className="divide-y pt-1">
        <Row title="Windows 시작 시 자동 실행" hint={data.service ? `서비스 실행 중 (${data.service.replace(/^ok /, '')})` : '서비스가 꺼져 있어요. start-routinelab.bat으로 켤 수 있어요.'}>
          <Toggle on={data.autostart} onChange={(v) => set.mutate(v)} label="자동 실행" />
        </Row>
        <Row title="바로가기" hint="시작 메뉴와 바탕 화면의 RoutineLab 아이콘으로 창을 열어요">
          <span className={cn('text-xs', data.shortcuts ? 'text-good' : 'text-subtle')}>{data.shortcuts ? '있어요' : '없어요'}</span>
        </Row>
        {set.error && <p className="pt-2 text-xs text-bad">{set.error.message}</p>}
      </CardBody>
    </Card>
  )
}

export function SettingsPage() {
  const { data: s } = useSettings()
  const saveM = useSaveSettings()
  const { pref, setPref } = useTheme()
  if (!s) return <PageSkeleton />
  const save = (c: Partial<Settings>) => saveM.mutate(c)

  return (
    <div>
      <PageHeader title="설정" />
      <div className="grid gap-4 split:grid-cols-2 split:items-start">
        <div className="space-y-4">
          <NotifyCard s={s} save={save} />
          <Card>
            <CardHeader title="신호등" hint="마이루틴처럼, 다 못 해도 초록불이 켜지게" />
            <CardBody className="divide-y pt-1">
              <Row title={`초록불 기준 ${Math.round(s.green_at * 100)}%`} hint="하루 루틴 중 이만큼 하면 초록불">
                <input type="range" min={30} max={100} step={5} value={Math.round(s.green_at * 100)} onChange={(e) => save({ green_at: Number(e.target.value) / 100 })} className="w-40 accent-[var(--good)]" aria-label="초록불 기준" />
              </Row>
              <Row title={`노란불 기준 ${Math.round(s.yellow_at * 100)}%`} hint="이보다 적으면 빨간불">
                <input type="range" min={0} max={90} step={5} value={Math.round(s.yellow_at * 100)} onChange={(e) => save({ yellow_at: Number(e.target.value) / 100 })} className="w-40 accent-[var(--warn)]" aria-label="노란불 기준" />
              </Row>
              <Row title="하루가 바뀌는 시각" hint="새벽에 한 ‘자기 전’ 루틴은 전날로 쳐요">
                <select value={s.day_start_hour} onChange={(e) => save({ day_start_hour: Number(e.target.value) })} className="h-9 rounded-lg border bg-surface-2/60 px-2 text-sm" aria-label="하루 시작 시각">
                  {[0, 1, 2, 3, 4, 5, 6].map((h) => (
                    <option key={h} value={h}>
                      새벽 {h}시
                    </option>
                  ))}
                </select>
              </Row>
              <Row title="축하 효과" hint="초록불이 켜지거나 전부 해낸 날 폭죽">
                <Toggle on={s.celebrate} onChange={(v) => save({ celebrate: v })} label="축하 효과" />
              </Row>
              <Row title="화면 테마">
                <Segmented<ThemePref>
                  value={pref}
                  onChange={setPref}
                  size="sm"
                  options={[
                    { value: 'dark', label: '다크' },
                    { value: 'light', label: '라이트' },
                    { value: 'system', label: '시스템' },
                  ]}
                />
              </Row>
            </CardBody>
          </Card>
          <QuestionsCard s={s} save={save} />
        </div>
        <div className="space-y-4">
          <MobileCard />
          <PcCard />
          <Card>
            <CardHeader title="데이터" hint="모든 기록은 이 PC의 RoutineLab 폴더(data)에만 저장돼요" />
            <CardBody className="space-y-2 pt-2 text-xs text-muted">
              <a href="/api/export" download>
                <Button size="sm" tabIndex={-1}>
                  <Download /> 전체 기록 내보내기 (JSON)
                </Button>
              </a>
              <p className="flex items-center gap-1.5">
                <Monitor className="size-3.5" /> 매일 자동 백업: data/backups (최근 14일치)
              </p>
            </CardBody>
          </Card>
          {saveM.error && <p className="text-sm text-bad">{saveM.error.message}</p>}
        </div>
      </div>
    </div>
  )
}

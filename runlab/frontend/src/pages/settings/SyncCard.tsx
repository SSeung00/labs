import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { format, isToday, isTomorrow, parseISO } from 'date-fns'
import { motion } from 'framer-motion'
import { Check, CloudDownload, History, Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useAutoSync, useGarminStatus, useSetAutoSync, useStartSync, useSyncStatus, type AutoSync, type SyncPhase } from '@/api/garmin'
import { cn } from '@/lib/utils'

const SYNC_STEPS: { phase: SyncPhase; label: string }[] = [
  { phase: 'activities', label: '활동 목록' },
  { phase: 'streams', label: '기록 다운로드' },
  { phase: 'wellness', label: '수면·HRV' },
  { phase: 'weather', label: '날씨 보강' },
  { phase: 'analysis', label: '분석' },
]
const IMPORT_STEPS: { phase: SyncPhase; label: string }[] = [
  { phase: 'import', label: '파일 가져오기' },
  { phase: 'weather', label: '날씨 보강' },
  { phase: 'analysis', label: '분석' },
]

const BACKFILL_OPTIONS = [
  { days: 90, label: '3개월' },
  { days: 180, label: '6개월' },
  { days: 365, label: '1년' },
  { days: 730, label: '2년' },
]

function Steps({ phase, steps }: { phase: SyncPhase; steps: typeof SYNC_STEPS }) {
  const idx = steps.findIndex((s) => s.phase === phase)
  const allDone = phase === 'done'
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
      {steps.map((s, i) => {
        const done = allDone || (idx >= 0 && i < idx)
        const active = i === idx
        return (
          <li key={s.phase} className="flex items-center gap-2">
            <span
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors',
                done && 'border-good/30 bg-good/10 text-good',
                active && 'border-accent/40 bg-accent-soft text-accent',
                !done && !active && 'text-subtle',
              )}
            >
              {done ? <Check className="size-3.5" /> : active ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {s.label}
            </span>
            {i < steps.length - 1 && <span className="h-px w-3 bg-border-strong" />}
          </li>
        )
      })}
    </ol>
  )
}

function when(iso: string) {
  const d = parseISO(iso)
  const day = isToday(d) ? '오늘' : isTomorrow(d) ? '내일' : format(d, 'M/d')
  return `${day} ${format(d, 'HH:mm')}`
}

function autoSummary(a: AutoSync, connected: boolean) {
  if (!a.enabled) return '꺼져 있어요'
  if (!a.active) return '백그라운드 서비스로 실행할 때만 돌아요'
  if (!connected) return '가민 계정을 연결하면 시작해요'
  const parts: string[] = []
  const l = a.last
  if (l?.running) parts.push('지금 자동 동기화 중')
  else if (l?.ok) parts.push(`최근 ${when(l.finished_at ?? l.started_at)} · 새 활동 ${l.new_activities ?? 0}개`)
  else if (l) parts.push(`${when(l.started_at)} 실패 (${l.attempts}/3회)`)
  if (a.next_run && !l?.running) parts.push(`다음 ${when(a.next_run)}`)
  return parts.join(' · ') || 'PC가 꺼져 있었으면 켜질 때 바로 해요'
}

/** Daily light sync run by the background service; missed runs catch up when the PC wakes. */
function AutoSyncRow({ connected }: { connected: boolean }) {
  const qc = useQueryClient()
  const { data: auto } = useAutoSync()
  const save = useSetAutoSync()
  const autoRunning = !!auto?.last?.running
  // A scheduled run started: fetch the sync status so its progress shows in this card.
  useEffect(() => {
    if (autoRunning) qc.invalidateQueries({ queryKey: ['sync', 'status'] })
  }, [autoRunning, qc])
  if (!auto) return null
  const failed = auto.last && !auto.last.running && auto.last.ok === false
  return (
    <div className="space-y-2 rounded-lg border bg-surface-2/40 px-3 py-2.5">
      <div className="flex items-center gap-3">
        <Switch label="매일 자동 동기화" on={auto.enabled} disabled={save.isPending} onChange={(enabled) => save.mutate({ enabled, time: auto.time })} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">매일 자동 동기화</div>
          <div className={cn('text-xs leading-snug', failed ? 'text-warn' : 'text-subtle')}>{autoSummary(auto, connected)}</div>
        </div>
        <Input
          type="time"
          aria-label="자동 동기화 시각"
          className="h-8 w-28 shrink-0 px-2"
          disabled={!auto.enabled || save.isPending}
          defaultValue={auto.time}
          key={auto.time}
          onBlur={(e) => e.target.value && e.target.value !== auto.time && save.mutate({ enabled: auto.enabled, time: e.target.value })}
        />
      </div>
      {failed && auto.last?.error && <p className="truncate text-xs text-subtle" title={auto.last.error}>{auto.last.error}</p>}
      {save.error && <p className="text-xs text-bad">{save.error.message}</p>}
    </div>
  )
}

export function SyncCard() {
  const qc = useQueryClient()
  const { data: garmin } = useGarminStatus()
  const { data: sync } = useSyncStatus()
  const start = useStartSync()
  const [days, setDays] = useState(180)
  const logRef = useRef<HTMLDivElement>(null)
  const wasRunning = useRef(false)

  const running = !!sync?.running
  const isImport = sync?.phase === 'import' || (sync?.log ?? []).some((l) => l.includes('FIT 파일'))
  const steps = isImport ? IMPORT_STEPS : SYNC_STEPS
  const pct = sync && sync.total > 0 ? Math.min(100, (sync.current / sync.total) * 100) : running ? 4 : 0

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [sync?.log.length])

  // When a job finishes, refresh everything that depends on stored data.
  useEffect(() => {
    if (wasRunning.current && !running) {
      qc.invalidateQueries({ queryKey: ['health'] })
      qc.invalidateQueries({ queryKey: ['garmin'] })
      qc.invalidateQueries({ queryKey: ['activities'] })
      qc.invalidateQueries({ queryKey: ['fitness'] })
      qc.invalidateQueries({ queryKey: ['readiness'] })
      qc.invalidateQueries({ queryKey: ['progress'] })
    }
    wasRunning.current = running
  }, [running, qc])

  const connected = !!garmin?.connected
  const hasRun = !!sync && sync.phase !== 'idle'

  return (
    <Card>
      <CardHeader
        title="동기화"
        hint={connected ? '새 활동과 웰니스 데이터를 가져옵니다' : '가민 계정을 연결하면 사용할 수 있어요'}
        action={
          <div className="grid size-8 place-items-center rounded-lg bg-surface-2 text-accent">
            <CloudDownload className="size-4" />
          </div>
        }
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={!connected || running || start.isPending} onClick={() => start.mutate({ wellness_days: days })}>
            <RefreshCw className={cn(running && 'animate-spin')} />
            지금 동기화
          </Button>
          <Button disabled={!connected || running || start.isPending} onClick={() => start.mutate({ full: true, wellness_days: days })} title="빠진 활동과 기록 파일을 처음부터 다시 확인합니다">
            <History />
            전체 다시 확인
          </Button>
          <div className="ml-auto flex items-center gap-2 text-xs text-subtle">
            첫 수집 기간
            <div className="flex rounded-lg border bg-surface-2 p-0.5">
              {BACKFILL_OPTIONS.map((o) => (
                <button
                  key={o.days}
                  onClick={() => setDays(o.days)}
                  className={cn(
                    'h-7 rounded-md px-2.5 text-xs font-medium transition-colors',
                    days === o.days ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text',
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {start.error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-bad">{start.error.message}</p>}
        <AutoSyncRow connected={connected} />

        {hasRun && sync && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-3 overflow-hidden">
            <Steps phase={sync.phase} steps={steps} />
            <div>
              <div className="mb-1.5 flex items-baseline justify-between text-xs">
                <span className="truncate text-muted">{sync.message}</span>
                {sync.total > 0 && (
                  <span className="num shrink-0 pl-3 text-subtle">
                    {sync.current.toLocaleString()} / {sync.total.toLocaleString()}
                  </span>
                )}
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                <motion.div
                  className={cn('h-full rounded-full', sync.phase === 'error' ? 'bg-bad' : sync.phase === 'done' ? 'bg-good' : 'bg-accent')}
                  animate={{ width: `${sync.phase === 'done' ? 100 : pct}%` }}
                  transition={{ ease: 'easeOut', duration: 0.4 }}
                />
              </div>
            </div>

            {(sync.phase === 'done' || sync.phase === 'error') && (
              <div
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm',
                  sync.phase === 'done' ? 'bg-good/10 text-good' : 'bg-bad/10 text-bad',
                )}
              >
                {sync.phase === 'done' ? <Check className="size-4" /> : <TriangleAlert className="size-4" />}
                {sync.phase === 'done'
                  ? `새 활동 ${sync.new_activities}개 · 웰니스 ${sync.new_wellness_days}일 추가`
                  : sync.error}
              </div>
            )}

            <div ref={logRef} className="num max-h-36 overflow-y-auto rounded-lg border bg-bg/60 px-3 py-2 font-mono text-[11px] leading-5 text-subtle">
              {sync.log.map((l, i) => (
                <div key={i} className="truncate">
                  {l}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </CardBody>
    </Card>
  )
}

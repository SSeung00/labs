import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Monitor, RotateCw } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { api, post } from '@/api/client'
import { useAuthStatus } from '@/api/auth'
import { cn } from '@/lib/utils'

interface ServiceStatus {
  supervised: boolean
  service: string | null
  autostart: boolean
  shortcuts: boolean
  build: { build: string } | null
  windows: boolean
}

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50', on ? 'bg-accent' : 'bg-surface-3')}
    >
      <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', on ? 'left-[22px]' : 'left-0.5')} />
    </button>
  )
}

/** Run EnglishLab like an installed program: background server, start at log-in, app window shortcuts. */
export function PcAppCard() {
  const qc = useQueryClient()
  const { data: auth } = useAuthStatus()
  const { data: st, isPending } = useQuery({ queryKey: ['system', 'service'], queryFn: () => api<ServiceStatus>('/system/service') })
  const set = (d: ServiceStatus) => qc.setQueryData(['system', 'service'], d)
  const autostart = useMutation({ mutationFn: (enabled: boolean) => api<ServiceStatus>('/system/autostart', { method: 'PUT', body: JSON.stringify({ enabled }) }), onSuccess: set })
  const shortcuts = useMutation({ mutationFn: () => post<ServiceStatus>('/system/shortcuts'), onSuccess: set })
  const restart = useMutation({
    mutationFn: () => post('/system/restart'),
    onSuccess: () => setTimeout(() => window.location.reload(), 6000),
  })

  if (auth && !auth.local) return null // these are PC settings
  if (isPending || !st?.windows) return null
  const background = !!st.service
  const err = autostart.error ?? shortcuts.error ?? restart.error

  return (
    <Card>
      <CardHeader title="PC 앱 · 자동 실행" hint="창 없이 뒤에서 돌고, 켜면 바로 열려요" action={<Monitor className="size-4 text-subtle" />} />
      <CardBody className="space-y-4">
        <div className="flex items-center gap-2 text-sm">
          <span className={cn('size-2 rounded-full', background ? 'bg-good' : 'bg-warn')} />
          {background ? '백그라운드 서비스로 실행 중' : '창(터미널)으로 실행 중 — 아래를 켜면 다음부터 창 없이 돌아요'}
        </div>

        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">컴퓨터를 켜면 자동 실행</div>
            <p className="text-xs text-subtle">로그인하면 창 없이 서버가 켜져요. 휴대폰에서도 바로 열 수 있어요.</p>
          </div>
          <Toggle on={st.autostart} onChange={(v) => autostart.mutate(v)} disabled={autostart.isPending} />
        </div>

        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">시작 메뉴 · 바탕화면 아이콘</div>
            <p className="text-xs text-subtle">
              {st.shortcuts ? '있어요. 누르면 EnglishLab이 프로그램 창으로 열려요. 시작 메뉴에서 우클릭 → 작업 표시줄에 고정도 돼요.' : '누르면 EnglishLab이 프로그램 창으로 열리는 아이콘을 만들어요.'}
            </p>
          </div>
          <Button size="sm" onClick={() => shortcuts.mutate()} disabled={shortcuts.isPending}>
            {shortcuts.isPending && <Loader2 className="animate-spin" />}
            {st.shortcuts ? '다시 만들기' : '만들기'}
          </Button>
        </div>

        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">서버 다시 시작</div>
            <p className="text-xs text-subtle">
              코드가 바뀌면 자동으로 다시 빌드·재시작돼요. 이상할 때만 눌러 주세요.
              {st.build && <span className="num"> · 화면 버전 {new Date(st.build.build).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
            </p>
          </div>
          <Button size="sm" onClick={() => restart.mutate()} disabled={!background || restart.isPending || restart.isSuccess}>
            {restart.isPending || restart.isSuccess ? <Loader2 className="animate-spin" /> : <RotateCw />}
            {restart.isSuccess ? '재시작 중…' : '재시작'}
          </Button>
        </div>

        {err && <p className="rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-bad">{err.message}</p>}
        <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-muted">
          휴대폰으로 보려면 PC가 절전 모드에 들어가지 않아야 해요. Windows 설정 → 시스템 → 전원 → 절전 모드: 전원 연결 시 "안 함". 화면 끄기는 그대로 둬도 돼요.
        </p>
      </CardBody>
    </Card>
  )
}

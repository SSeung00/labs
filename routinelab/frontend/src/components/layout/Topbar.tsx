import { Link } from 'react-router'
import { Flame, Lock, Monitor, Moon, Settings, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/stores/theme'
import { useDay } from '@/api/rl'
import { useAuthStatus, useLock } from '@/api/auth'
import { SignalDots } from '@/components/SignalLight'

function ThemeButton() {
  const { pref, cycle } = useTheme()
  const Icon = pref === 'dark' ? Moon : pref === 'light' ? Sun : Monitor
  const label = pref === 'dark' ? '다크' : pref === 'light' ? '라이트' : '시스템'
  return (
    <Button variant="ghost" size="icon" onClick={cycle} title={`테마: ${label}`} aria-label={`테마 전환 (현재 ${label})`}>
      <Icon />
    </Button>
  )
}

export function Topbar() {
  const { data } = useDay()
  const { data: auth } = useAuthStatus()
  const lock = useLock()
  return (
    <div className="sticky top-0 z-30 border-b bg-bg/75 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="flex h-14 items-center gap-2 px-4 sm:px-6">
        <img src="/favicon.svg" alt="RoutineLab" className="size-7 fold:hidden" />
        <span className="text-[15px] font-bold tracking-tight fold:hidden">RoutineLab</span>
        <div className="ml-auto flex items-center gap-1">
          {data && data.signal.total > 0 && (
            <Link
              to="/stats"
              className="mr-1 flex h-8 items-center gap-2 rounded-full border bg-surface-2/70 px-3 text-sm font-semibold"
              title={`오늘 ${data.signal.done}/${data.signal.total} · 초록불 ${data.streak.current}일 연속`}
            >
              <SignalDots color={data.signal.color} size="xs" />
              <span className="flex items-center gap-0.5">
                <Flame className={data.streak.current ? 'size-4 text-warn' : 'size-4 text-subtle'} />
                <span className="num">{data.streak.current}</span>
              </span>
            </Link>
          )}
          <ThemeButton />
          {auth && !auth.local && (
            <Button variant="ghost" size="icon" onClick={() => lock.mutate()} title="잠그기" aria-label="잠그기">
              <Lock />
            </Button>
          )}
          <Link to="/settings" aria-label="설정">
            <Button variant="ghost" size="icon" tabIndex={-1}>
              <Settings />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  )
}

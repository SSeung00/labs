import { Link } from 'react-router'
import { Flame, Lock, Monitor, Moon, Settings, Snowflake, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/stores/theme'
import { useToday } from '@/api/el'
import { useAuthStatus, useLock } from '@/api/auth'
import { cn } from '@/lib/utils'

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
  const { data } = useToday()
  const { data: auth } = useAuthStatus()
  const lock = useLock()
  const s = data?.streak
  return (
    <div className="sticky top-0 z-30 border-b bg-bg/75 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="flex h-14 items-center gap-2 px-4 sm:px-6">
        <img src="/favicon.svg" alt="EnglishLab" className="size-7 fold:hidden" />
        <span className="text-[15px] font-bold tracking-tight fold:hidden">EnglishLab</span>
        <div className="ml-auto flex items-center gap-1">
          {s && (
            <Link
              to="/stats"
              className="mr-1 flex h-8 items-center gap-1.5 rounded-full border bg-surface-2/70 px-3 text-sm font-semibold"
              title={`연속 ${s.current}일 · 프리즈 ${s.freezes}개`}
            >
              <Flame className={cn('size-4', s.studied_today ? 'text-warn' : 'text-subtle')} />
              <span className="num">{s.current}</span>
              <span className="ml-1 flex items-center gap-0.5 text-xs font-medium text-fitness">
                <Snowflake className="size-3.5" />
                <span className="num">{s.freezes}</span>
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

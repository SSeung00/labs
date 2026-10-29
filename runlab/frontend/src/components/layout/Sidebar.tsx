import { NavLink } from 'react-router'
import { motion } from 'framer-motion'
import { NAV, type NavItem } from '@/lib/nav'
import { cn } from '@/lib/utils'
import { useHealth } from '@/api/client'

const GROUPS: { key: NavItem['group']; label: string }[] = [
  { key: 'main', label: '대시보드' },
  { key: 'log', label: '기록 & 분석' },
  { key: 'system', label: '' },
]

export function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <img src="/favicon.svg" alt="" className="size-8" />
      <div className="leading-none">
        <div className="text-[15px] font-bold tracking-tight">RunLab</div>
        <div className="mt-0.5 text-[11px] text-subtle">personal running lab</div>
      </div>
    </div>
  )
}

export function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-5">
      {GROUPS.map((g) => (
        <div key={g.key}>
          {g.label && (
            <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-subtle">
              {g.label}
            </div>
          )}
          <ul className="flex flex-col gap-0.5">
            {NAV.filter((n) => n.group === g.key).map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  end={item.path === '/'}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'relative flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                      isActive ? 'text-text' : 'text-muted hover:bg-surface-2 hover:text-text',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <motion.span
                          layoutId="nav-active"
                          className="absolute inset-0 rounded-lg border bg-surface-2"
                          transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                        />
                      )}
                      <item.icon
                        className={cn('relative size-[18px]', isActive && 'text-accent')}
                        strokeWidth={1.9}
                      />
                      <span className="relative">{item.label}</span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function SyncStatus() {
  const { data, isError } = useHealth()
  const online = !!data && !isError
  return (
    <div className="rounded-xl border bg-surface-2/60 p-3">
      <div className="flex items-center gap-2 text-xs font-medium">
        <span className="relative flex size-2">
          {online && (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-good opacity-60" />
          )}
          <span className={cn('relative inline-flex size-2 rounded-full', online ? 'bg-good' : 'bg-bad')} />
        </span>
        {online ? '로컬 서버 연결됨' : '서버 연결 안 됨'}
      </div>
      <div className="mt-1.5 text-[11px] text-subtle num">
        {online ? `활동 ${data.activities.toLocaleString()}개 · 웰니스 ${data.wellness_days}일` : 'backend를 실행하세요'}
      </div>
    </div>
  )
}

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-surface/60 px-3 py-5 backdrop-blur md:flex">
      <Logo />
      <div className="mt-7 flex-1 overflow-y-auto">
        <NavList />
      </div>
      <SyncStatus />
    </aside>
  )
}

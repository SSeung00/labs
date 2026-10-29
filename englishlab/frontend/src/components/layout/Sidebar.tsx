import { NavLink } from 'react-router'
import { motion } from 'framer-motion'
import { Flame } from 'lucide-react'
import { NAV, type NavItem } from '@/lib/nav'
import { cn } from '@/lib/utils'
import { useHealth } from '@/api/client'
import { useToday } from '@/api/el'

export function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <img src="/favicon.svg" alt="" className="size-8" />
      <div className="leading-none">
        <div className="text-[15px] font-bold tracking-tight">EnglishLab</div>
        <div className="mt-0.5 text-[11px] text-subtle">B2 → C2 with AI</div>
      </div>
    </div>
  )
}

export function Badge({ n, className }: { n: number; className?: string }) {
  if (!n) return null
  return (
    <motion.span
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={cn('num grid h-[18px] min-w-[18px] place-items-center rounded-full bg-warn px-1 text-[10.5px] font-bold text-black/80', className)}
    >
      {n > 99 ? '99+' : n}
    </motion.span>
  )
}

/** Cards due, shown on 단어. */
export function useNavBadge(item: NavItem): number {
  const { data } = useToday()
  return item.path === '/words' ? (data?.cards.due ?? 0) : 0
}

function SideLink({ item }: { item: NavItem }) {
  const badge = useNavBadge(item)
  return (
    <NavLink
      to={item.path}
      end={item.path === '/'}
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
            <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg border bg-surface-2" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />
          )}
          <item.icon className={cn('relative size-[18px]', isActive && 'text-accent')} strokeWidth={1.9} />
          <span className="relative flex-1">{item.label}</span>
          <Badge n={badge} className="relative" />
        </>
      )}
    </NavLink>
  )
}

function StatusBox() {
  const { data, isError } = useHealth()
  const { data: today } = useToday()
  const online = !!data && !isError
  const stt = data?.stt
  return (
    <div className="space-y-2">
      {today && (
        <div className="flex items-center gap-2 rounded-xl border bg-surface-2/60 p-3 text-xs">
          <Flame className={cn('size-5', today.streak.studied_today ? 'text-warn' : 'text-subtle')} />
          <div>
            <div className="num font-semibold">{today.streak.current}일 연속</div>
            <div className="text-subtle">프리즈 {today.streak.freezes}개 남음</div>
          </div>
        </div>
      )}
      <div className="rounded-xl border bg-surface-2/60 p-3">
        <div className="flex items-center gap-2 text-xs font-medium">
          <span className="relative flex size-2">
            {online && <span className="absolute inline-flex size-full animate-ping rounded-full bg-good opacity-60" />}
            <span className={cn('relative inline-flex size-2 rounded-full', online ? 'bg-good' : 'bg-bad')} />
          </span>
          {online ? '로컬 서버 연결됨' : '서버 연결 안 됨'}
        </div>
        <div className="mt-1.5 text-[11px] text-subtle">
          {!online ? 'start-englishlab.bat을 실행하세요' : stt?.loaded ? `음성 인식 준비됨 (${stt.device === 'cuda' ? 'GPU' : 'CPU'})` : '음성 인식 불러오는 중…'}
        </div>
      </div>
    </div>
  )
}

/** Wide screens (≥ 1280px): labelled sidebar. */
export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-surface/60 px-3 py-5 backdrop-blur xl:flex">
      <Logo />
      <nav className="mt-7 flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {NAV.map((item) => (
          <SideLink key={item.path} item={item} />
        ))}
      </nav>
      <StatusBox />
    </aside>
  )
}

function RailLink({ item }: { item: NavItem }) {
  const badge = useNavBadge(item)
  return (
    <NavLink to={item.path} end={item.path === '/'} className="group flex flex-col items-center gap-1 py-1.5" title={item.label}>
      {({ isActive }) => (
        <>
          <span className="relative grid h-8 w-14 place-items-center">
            {isActive && (
              <motion.span layoutId="rail-active" className="absolute inset-0 rounded-full bg-accent-soft" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />
            )}
            <item.icon className={cn('relative size-[21px] transition-colors', isActive ? 'text-accent' : 'text-muted group-hover:text-text')} strokeWidth={1.9} />
            <Badge n={badge} className="absolute -right-0.5 -top-1" />
          </span>
          <span className={cn('text-[11px] font-medium', isActive ? 'text-text' : 'text-subtle')}>{item.short}</span>
        </>
      )}
    </NavLink>
  )
}

/** Unfolded Fold / tablets (600–1279px): navigation rail. */
export function NavRail() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-[76px] shrink-0 flex-col items-center border-r bg-surface/60 pb-[env(safe-area-inset-bottom)] pt-[calc(env(safe-area-inset-top)+0.75rem)] backdrop-blur fold:flex xl:hidden">
      <img src="/favicon.svg" alt="EnglishLab" className="size-9" />
      <nav className="mt-5 flex flex-1 flex-col gap-1 overflow-y-auto">
        {NAV.map((item) => (
          <RailLink key={item.path} item={item} />
        ))}
      </nav>
    </aside>
  )
}

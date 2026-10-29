import { useState } from 'react'
import { NavLink, useLocation } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { Lock, MoreHorizontal } from 'lucide-react'
import { NAV } from '@/lib/nav'
import { cn } from '@/lib/utils'
import { useAuthStatus, useLock } from '@/api/auth'
import { useHealth } from '@/api/client'
import { Badge } from './Sidebar'

/** Cover screen (< 600px): the things you check on the go. Everything else sits under 더보기. */
const TABS = ['/', '/transactions', '/budget', '/trips']
const tabs = TABS.map((p) => NAV.find((n) => n.path === p)!)
const more = NAV.filter((n) => !TABS.includes(n.path))

export function BottomNav() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const moreActive = more.some((n) => pathname.startsWith(n.path))
  const { data: auth } = useAuthStatus()
  const { data: health } = useHealth()
  const lock = useLock()
  const review = health?.review ?? 0

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md fold:hidden">
        <ul className="grid h-16 grid-cols-5">
          {tabs.map((item) => (
            <li key={item.path}>
              <NavLink to={item.path} end={item.path === '/'} className="flex h-full flex-col items-center justify-center gap-1">
                {({ isActive }) => (
                  <>
                    <span className="relative grid h-7 w-12 place-items-center">
                      {isActive && (
                        <motion.span
                          layoutId="tab-active"
                          className="absolute inset-0 rounded-full bg-accent-soft"
                          transition={{ type: 'spring', stiffness: 520, damping: 36 }}
                        />
                      )}
                      <item.icon className={cn('relative size-[21px]', isActive ? 'text-accent' : 'text-subtle')} strokeWidth={1.9} />
                    </span>
                    <span className={cn('text-[11px] font-medium', isActive ? 'text-text' : 'text-subtle')}>{item.short}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
          <li>
            <button onClick={() => setOpen(true)} className="flex h-full w-full flex-col items-center justify-center gap-1">
              <span className="relative grid h-7 w-12 place-items-center">
                {moreActive && <span className="absolute inset-0 rounded-full bg-accent-soft" />}
                <MoreHorizontal className={cn('relative size-[21px]', moreActive ? 'text-accent' : 'text-subtle')} strokeWidth={1.9} />
                <Badge n={review} className="absolute -right-0.5 -top-1" />
              </span>
              <span className={cn('text-[11px] font-medium', moreActive ? 'text-text' : 'text-subtle')}>더보기</span>
            </button>
          </li>
        </ul>
      </nav>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/50 fold:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.div
              className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border-t bg-surface px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 fold:hidden"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 420, damping: 40 }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={(_, info) => info.offset.y > 80 && setOpen(false)}
            >
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border-strong" />
              <ul className="grid grid-cols-3 gap-2">
                {more.map((item, i) => (
                  <motion.li key={item.path} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 * i }}>
                    <NavLink
                      to={item.path}
                      onClick={() => setOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          'relative flex flex-col items-center gap-1.5 rounded-2xl border px-2 py-3.5 text-center active:scale-[0.97] transition-transform',
                          isActive ? 'border-accent/50 bg-accent-soft text-accent' : 'bg-surface-2/60 text-text',
                        )
                      }
                    >
                      <item.icon className="size-6" strokeWidth={1.8} />
                      <span className="text-[13px] font-semibold">{item.label}</span>
                      <span className="line-clamp-1 text-[10px] text-subtle">{item.description}</span>
                      {item.path === '/review' && <Badge n={review} className="absolute right-2 top-2" />}
                    </NavLink>
                  </motion.li>
                ))}
                {auth && !auth.local && (
                  <li>
                    <button
                      onClick={() => lock.mutate()}
                      className="flex w-full flex-col items-center gap-1.5 rounded-2xl border bg-surface-2/60 px-2 py-3.5 text-center"
                    >
                      <Lock className="size-6 text-muted" strokeWidth={1.8} />
                      <span className="text-[13px] font-semibold">잠그기</span>
                      <span className="text-[10px] text-subtle">다음엔 PIN 필요</span>
                    </button>
                  </li>
                )}
              </ul>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}

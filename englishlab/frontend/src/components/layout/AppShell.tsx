import { Outlet, useLocation } from 'react-router'
import { motion } from 'framer-motion'
import { NavRail, Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { BottomNav } from './BottomNav'
import { AuthGate } from './AuthGate'
import { OfflineBanner } from './OfflineBanner'
import { BadgeToasts } from './BadgeToasts'
import { UpdateBanner } from './UpdateBanner'
import { useFocusMode } from '@/stores/focus'
import { cn } from '@/lib/utils'

export function AppShell() {
  const location = useLocation()
  const focus = useFocusMode((s) => s.focus)
  return (
    <AuthGate>
      {/* --chrome-top: where sticky bars stop (under the top bar, or at the very top in focus mode) */}
      <div
        className="flex min-h-dvh"
        style={{ '--chrome-top': focus ? 'env(safe-area-inset-top)' : 'calc(env(safe-area-inset-top) + 3.5rem)' } as React.CSSProperties}
      >
        {!focus && <Sidebar />}
        {!focus && <NavRail />}
        <div className="flex min-w-0 flex-1 flex-col">
          {!focus && <Topbar />}
          <OfflineBanner />
          <UpdateBanner />
          <motion.main
            key={location.pathname}
            className={cn(
              'mx-auto w-full max-w-6xl flex-1 px-4 pb-[calc(env(safe-area-inset-bottom)+6rem)] pt-5 fold:px-6 fold:pb-10 fold:pt-7 lg:px-10',
              focus && 'max-w-7xl pt-[calc(env(safe-area-inset-top)+0.75rem)] fold:pt-4',
            )}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <Outlet />
          </motion.main>
        </div>
        {!focus && <BottomNav />}
        <BadgeToasts />
      </div>
    </AuthGate>
  )
}

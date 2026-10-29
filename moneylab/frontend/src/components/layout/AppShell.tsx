import { Outlet, useLocation } from 'react-router'
import { motion } from 'framer-motion'
import { NavRail, Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { CommandPalette } from './CommandPalette'
import { BottomNav } from './BottomNav'
import { AuthGate } from './AuthGate'
import { OfflineBanner } from './OfflineBanner'
import { UpdateBanner } from './UpdateBanner'

export function AppShell() {
  const location = useLocation()
  // Detail routes (/trips/3) animate as a new page; tab/filter changes in the query string don't.
  return (
    <AuthGate>
      <div className="flex min-h-dvh">
        <Sidebar />
        <NavRail />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <OfflineBanner />
          <UpdateBanner />
          <motion.main
            key={location.pathname}
            className="mx-auto w-full max-w-7xl flex-1 px-4 pb-[calc(env(safe-area-inset-bottom)+6rem)] pt-5 fold:px-6 fold:pb-10 fold:pt-7 lg:px-10"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <Outlet />
          </motion.main>
        </div>
        <BottomNav />
        <CommandPalette />
      </div>
    </AuthGate>
  )
}

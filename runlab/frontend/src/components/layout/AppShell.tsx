import { Outlet, useLocation } from 'react-router'
import { motion } from 'framer-motion'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { CommandPalette } from './CommandPalette'
import { BottomNav } from './BottomNav'
import { AuthGate } from './AuthGate'
import { OfflineBanner } from './OfflineBanner'
import { UpdateBanner } from './UpdateBanner'

export function AppShell() {
  const location = useLocation()
  return (
    <AuthGate>
      <div className="flex min-h-dvh">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <OfflineBanner />
          <UpdateBanner />
          {/* Enter-only transition: exit animations would briefly render the next route's Outlet. */}
          <motion.main
            key={location.pathname}
            className="mx-auto w-full max-w-7xl flex-1 px-4 pb-[calc(env(safe-area-inset-bottom)+6rem)] pt-5 sm:px-6 sm:pt-8 md:pb-8 lg:px-10"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
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

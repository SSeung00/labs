import { Outlet, useLocation } from 'react-router'
import { motion } from 'framer-motion'
import { NavRail, Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { BottomNav } from './BottomNav'
import { AuthGate } from './AuthGate'
import { OfflineBanner } from './OfflineBanner'
import { UpdateBanner } from './UpdateBanner'
import { Toasts } from './Toasts'
import { useOutboxSync } from '@/api/rl'

function Synced() {
  useOutboxSync()
  return null
}

export function AppShell() {
  const location = useLocation()
  return (
    <AuthGate>
      <Synced />
      <div className="flex min-h-dvh">
        <Sidebar />
        <NavRail />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <UpdateBanner />
          <OfflineBanner />
          <motion.main
            key={location.pathname}
            className="mx-auto w-full max-w-6xl flex-1 px-4 pb-[calc(env(safe-area-inset-bottom)+6rem)] pt-4 fold:px-6 fold:pb-10 fold:pt-6 lg:px-10"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <Outlet />
          </motion.main>
        </div>
        <BottomNav />
        <Toasts />
      </div>
    </AuthGate>
  )
}

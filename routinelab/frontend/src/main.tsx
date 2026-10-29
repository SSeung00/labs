import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'framer-motion'
import './index.css'
import { AppShell } from '@/components/layout/AppShell'
import { NotFound, RouteError } from '@/components/layout/RouteError'
import { lazyPage } from '@/lib/lazyPage'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
})

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      {
        errorElement: <RouteError />,
        children: [
          { index: true, element: lazyPage(() => import('@/pages/TodayPage'), 'TodayPage') },
          { path: 'routines', element: lazyPage(() => import('@/pages/RoutinesPage'), 'RoutinesPage') },
          { path: 'journal', element: lazyPage(() => import('@/pages/JournalPage'), 'JournalPage') },
          { path: 'stats', element: lazyPage(() => import('@/pages/StatsPage'), 'StatsPage') },
          { path: 'settings', element: lazyPage(() => import('@/pages/SettingsPage'), 'SettingsPage') },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
])

// Installable app, offline copy and push reminders. Production build only.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => undefined))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <RouterProvider router={router} />
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
)

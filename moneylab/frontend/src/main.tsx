import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'framer-motion'
import './index.css'
import { AppShell } from '@/components/layout/AppShell'
import { NotFound, RouteError } from '@/components/layout/RouteError'
import { lazyPage } from '@/lib/lazyPage'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false } },
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
          { index: true, element: lazyPage(() => import('@/pages/HomePage'), 'HomePage') },
          { path: 'transactions', element: lazyPage(() => import('@/pages/TransactionsPage'), 'TransactionsPage') },
          { path: 'review', element: lazyPage(() => import('@/pages/ReviewPage'), 'ReviewPage') },
          { path: 'trips', element: lazyPage(() => import('@/pages/trips/TripsPage'), 'TripsPage') },
          { path: 'trips/:id', element: lazyPage(() => import('@/pages/trips/TripDetailPage'), 'TripDetailPage') },
          { path: 'budget', element: lazyPage(() => import('@/pages/budget/BudgetPage'), 'BudgetPage') },
          { path: 'assets', element: lazyPage(() => import('@/pages/assets/AssetsPage'), 'AssetsPage') },
          { path: 'goals', element: <Navigate to="/assets?tab=goals" replace /> },
          { path: 'hobbies', element: lazyPage(() => import('@/pages/hobbies/HobbiesPage'), 'HobbiesPage') },
          { path: 'ai', element: lazyPage(() => import('@/pages/ai/AiPage'), 'AiPage') },
          { path: 'import', element: lazyPage(() => import('@/pages/ImportPage'), 'ImportPage') },
          { path: 'settings', element: lazyPage(() => import('@/pages/SettingsPage'), 'SettingsPage') },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
])

// Installable app + offline copy + share target. Production build only.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => undefined))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Follow the OS "reduce motion" setting everywhere. */}
      <MotionConfig reducedMotion="user">
        <RouterProvider router={router} />
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
)

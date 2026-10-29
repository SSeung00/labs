import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import { AppShell } from '@/components/layout/AppShell'
import { NotFound, RouteError } from '@/components/layout/RouteError'
import { TodayPage } from '@/pages/TodayPage'
import { lazyPage } from '@/lib/lazyPage'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false } },
})

// Each screen is its own chunk, so ECharts/MapLibre load only where they're used.
const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      {
        errorElement: <RouteError />,
        children: [
          { index: true, element: <TodayPage /> },
          { path: 'activities', element: lazyPage(() => import('@/pages/activities/ActivitiesPage'), 'ActivitiesPage') },
          { path: 'activities/:id', element: lazyPage(() => import('@/pages/activity/ActivityDetailPage'), 'ActivityDetailPage') },
          { path: 'fitness', element: lazyPage(() => import('@/pages/fitness/FitnessPage'), 'FitnessPage') },
          { path: 'progress', element: lazyPage(() => import('@/pages/progress/ProgressPage'), 'ProgressPage') },
          { path: 'plan', element: lazyPage(() => import('@/pages/plan/PlanPage'), 'PlanPage') },
          { path: 'races', element: lazyPage(() => import('@/pages/races/RacesPage'), 'RacesPage') },
          { path: 'coach', element: lazyPage(() => import('@/pages/coach/CoachPage'), 'CoachPage') },
          { path: 'journal', element: lazyPage(() => import('@/pages/journal/JournalPage'), 'JournalPage') },
          // 인사이트 was folded into 컨디션, 성장 and 일지; keep old links working.
          { path: 'insights', element: <Navigate to="/journal?compare=1" replace /> },
          { path: 'gear', element: lazyPage(() => import('@/pages/gear/GearPage'), 'GearPage') },
          { path: 'settings', element: lazyPage(() => import('@/pages/settings/SettingsPage'), 'SettingsPage') },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
])

// Installable app + offline copy. Production build only (the dev server would serve stale modules).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => undefined))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)

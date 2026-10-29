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
          { path: 'placement', element: lazyPage(() => import('@/pages/placement/PlacementPage'), 'PlacementPage') },
          { path: 'read', element: lazyPage(() => import('@/pages/read/ReadPage'), 'ReadPage') },
          { path: 'read/:id', element: lazyPage(() => import('@/pages/read/ReaderPage'), 'ReaderPage') },
          { path: 'talk', element: lazyPage(() => import('@/pages/talk/TalkPage'), 'TalkPage') },
          { path: 'talk/:id', element: lazyPage(() => import('@/pages/talk/TalkSessionPage'), 'TalkSessionPage') },
          { path: 'words', element: lazyPage(() => import('@/pages/words/WordsPage'), 'WordsPage') },
          { path: 'words/review', element: lazyPage(() => import('@/pages/words/ReviewPage'), 'ReviewPage') },
          { path: 'stats', element: lazyPage(() => import('@/pages/StatsPage'), 'StatsPage') },
          { path: 'plan', element: lazyPage(() => import('@/pages/plan/PlanPage'), 'PlanPage') },
          { path: 'plan/books/:id', element: lazyPage(() => import('@/pages/plan/BookPage'), 'BookPage') },
          { path: 'write', element: lazyPage(() => import('@/pages/write/WritePage'), 'WritePage') },
          { path: 'notes', element: lazyPage(() => import('@/pages/notes/NotesPage'), 'NotesPage') },
          { path: 'notes/:id', element: lazyPage(() => import('@/pages/notes/NotesPage'), 'NoteEditorPage') },
          { path: 'settings', element: lazyPage(() => import('@/pages/SettingsPage'), 'SettingsPage') },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
])

// Installable app + offline copy. Production build only.
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

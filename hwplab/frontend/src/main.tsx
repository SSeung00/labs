import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import './index.css'
import { EditorPage } from '@/pages/EditorPage'
import { LibraryPage } from '@/pages/LibraryPage'

const router = createBrowserRouter([
  { path: '/', element: <LibraryPage /> },
  { path: '/doc/:id', element: <EditorPage /> },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)

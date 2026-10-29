import { Monitor, Moon, Search, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { useTheme } from '@/stores/theme'
import { useCommandPalette } from '@/stores/command'

function ThemeButton() {
  const { pref, cycle } = useTheme()
  const Icon = pref === 'dark' ? Moon : pref === 'light' ? Sun : Monitor
  const label = pref === 'dark' ? '다크' : pref === 'light' ? '라이트' : '시스템'
  return (
    <Button variant="ghost" size="icon" onClick={cycle} title={`테마: ${label}`} aria-label={`테마 전환 (현재 ${label})`}>
      <Icon />
    </Button>
  )
}

export function Topbar() {
  const openPalette = useCommandPalette((s) => s.setOpen)

  return (
    <div className="sticky top-0 z-30 border-b bg-bg/75 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="flex h-14 items-center gap-2 px-4 sm:px-6">
        <img src="/favicon.svg" alt="RunLab" className="size-7 md:hidden" />
        <button
          onClick={() => openPalette(true)}
          className="flex h-9 w-full max-w-sm items-center gap-2 rounded-lg border bg-surface-2/70 px-3 text-sm text-subtle transition-colors hover:border-border-strong hover:text-muted"
        >
          <Search className="size-4" />
          <span className="flex-1 text-left">검색 또는 이동…</span>
          <span className="hidden items-center gap-1 sm:flex">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
        <div className="ml-auto flex items-center gap-1">
          <ThemeButton />
        </div>
      </div>
    </div>
  )
}

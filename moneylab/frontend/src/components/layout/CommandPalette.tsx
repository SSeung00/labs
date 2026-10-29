import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { Command } from 'cmdk'
import { AnimatePresence, motion } from 'framer-motion'
import { Monitor, Moon, Sun, Upload } from 'lucide-react'
import { NAV } from '@/lib/nav'
import { Kbd } from '@/components/ui/kbd'
import { useCommandPalette } from '@/stores/command'
import { useTheme } from '@/stores/theme'

const itemClass =
  'flex h-11 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm text-muted data-[selected=true]:bg-surface-3 data-[selected=true]:text-text'

export function CommandPalette() {
  const { open, setOpen, toggle } = useCommandPalette()
  const setTheme = useTheme((s) => s.setPref)
  const navigate = useNavigate()

  // Ctrl/⌘+K toggles the palette; "G then <key>" jumps to a page.
  useEffect(() => {
    let pendingG = false
    let timer: number | undefined
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        toggle()
        return
      }
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, [contenteditable=true]') || e.metaKey || e.ctrlKey || e.altKey) return
      const key = e.key.toUpperCase()
      if (pendingG) {
        pendingG = false
        const hit = NAV.find((n) => n.shortcut === `G ${key}`)
        if (hit) navigate(hit.path)
        return
      }
      if (key === 'G') {
        pendingG = true
        window.clearTimeout(timer)
        timer = window.setTimeout(() => (pendingG = false), 1200)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, toggle])

  const run = (fn: () => void) => {
    setOpen(false)
    fn()
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[14vh]">
          <motion.div
            className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          />
          <motion.div
            className="relative w-full max-w-xl"
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -4 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
          >
            <Command
              label="커맨드 팔레트"
              loop
              className="overflow-hidden rounded-2xl border border-border-strong bg-surface shadow-2xl"
              onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
            >
              <Command.Input
                autoFocus
                placeholder="페이지, 명령 검색…"
                className="h-14 w-full border-b bg-transparent px-5 text-[15px] outline-none placeholder:text-subtle"
              />
              <Command.List className="max-h-[52vh] overflow-y-auto p-2 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-subtle">
                <Command.Empty className="py-10 text-center text-sm text-subtle">결과가 없어요</Command.Empty>
                <Command.Group heading="이동">
                  {NAV.map((n) => (
                    <Command.Item
                      key={n.path}
                      value={`${n.label} ${n.description} ${n.path}`}
                      onSelect={() => run(() => navigate(n.path))}
                      className={itemClass}
                    >
                      <n.icon className="size-4" />
                      <span className="text-text">{n.label}</span>
                      <span className="text-xs text-subtle">{n.description}</span>
                      <span className="ml-auto flex gap-1">
                        {n.shortcut.split(' ').map((k) => (
                          <Kbd key={k}>{k}</Kbd>
                        ))}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
                <Command.Group heading="작업">
                  <Command.Item value="엑셀 가져오기 import banksalad" onSelect={() => run(() => navigate('/import'))} className={itemClass}>
                    <Upload className="size-4" />
                    <span className="text-text">뱅크샐러드 엑셀 가져오기</span>
                  </Command.Item>
                  <Command.Item value="다크 테마 dark" onSelect={() => run(() => setTheme('dark'))} className={itemClass}>
                    <Moon className="size-4" />
                    <span className="text-text">다크 테마</span>
                  </Command.Item>
                  <Command.Item value="라이트 테마 light" onSelect={() => run(() => setTheme('light'))} className={itemClass}>
                    <Sun className="size-4" />
                    <span className="text-text">라이트 테마</span>
                  </Command.Item>
                  <Command.Item value="시스템 테마 system" onSelect={() => run(() => setTheme('system'))} className={itemClass}>
                    <Monitor className="size-4" />
                    <span className="text-text">시스템 테마 따르기</span>
                  </Command.Item>
                </Command.Group>
              </Command.List>
            </Command>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

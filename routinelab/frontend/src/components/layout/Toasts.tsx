import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { TriangleAlert } from 'lucide-react'
import { create } from 'zustand'
import { useOutbox } from '@/lib/outbox'
import { Confetti } from '@/components/Confetti'

interface Celebration {
  id: number
  emoji: string
  title: string
  body: string
}

/** Big moments on 오늘: the light turning green, a perfect day. */
export const useCelebrate = create<{ current: Celebration | null; fire: (c: Omit<Celebration, 'id'>) => void; clear: () => void }>((set) => ({
  current: null,
  fire: (c) => set({ current: { ...c, id: Date.now() } }),
  clear: () => set({ current: null }),
}))

export function Toasts() {
  const error = useOutbox((s) => s.error)
  const clearError = useOutbox((s) => s.clearError)
  const party = useCelebrate((s) => s.current)
  const clearParty = useCelebrate((s) => s.clear)

  useEffect(() => {
    if (!error) return
    const t = setTimeout(clearError, 5000)
    return () => clearTimeout(t)
  }, [error, clearError])

  useEffect(() => {
    if (!party) return
    const t = setTimeout(clearParty, 3200)
    return () => clearTimeout(t)
  }, [party, clearParty])

  return (
    <>
      {party && <Confetti key={party.id} />}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-50 flex flex-col items-center gap-2 px-4 fold:bottom-8">
        <AnimatePresence>
          {party && (
            <motion.button
              key={party.id}
              onClick={clearParty}
              initial={{ opacity: 0, y: 24, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ type: 'spring', stiffness: 380, damping: 26 }}
              className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-border-strong bg-surface px-4 py-3 text-left shadow-2xl"
            >
              <span className="text-3xl">{party.emoji}</span>
              <span>
                <span className="block text-sm font-bold">{party.title}</span>
                <span className="block text-xs text-muted">{party.body}</span>
              </span>
            </motion.button>
          )}
          {error && (
            <motion.div
              key="err"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="pointer-events-auto flex max-w-md items-center gap-2 rounded-xl border border-bad/40 bg-surface px-4 py-2.5 text-sm shadow-xl"
            >
              <TriangleAlert className="size-4 shrink-0 text-bad" />
              {error}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  )
}

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Award, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { post } from '@/api/client'
import { useToday } from '@/api/el'
import type { Badge } from '@/api/types'

/** Newly earned badges pop up once, then are marked seen. */
export function BadgeToasts() {
  const { data } = useToday()
  const qc = useQueryClient()
  const [shown, setShown] = useState<Badge[]>([])

  useEffect(() => {
    if (!data?.new_badges.length) return
    setShown(data.new_badges)
    post('/badges/seen').then(() => qc.invalidateQueries({ queryKey: ['stats'] }))
  }, [data?.new_badges, qc])

  useEffect(() => {
    if (!shown.length) return
    const t = window.setTimeout(() => setShown([]), 6000)
    return () => window.clearTimeout(t)
  }, [shown])

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+4rem)] z-50 flex flex-col items-center gap-2 px-4">
      <AnimatePresence>
        {shown.map((b, i) => (
          <motion.div
            key={b.key}
            initial={{ opacity: 0, y: -16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { delay: i * 0.15 } }}
            exit={{ opacity: 0, y: -10 }}
            className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl border border-warn/40 bg-surface px-4 py-3 shadow-2xl"
          >
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-warn/15 text-warn">
              <Award className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-subtle">새 배지</div>
              <div className="font-semibold">{b.title}</div>
              {b.desc && <div className="truncate text-xs text-muted">{b.desc}</div>}
            </div>
            <button onClick={() => setShown((s) => s.filter((x) => x.key !== b.key))} className="text-subtle" aria-label="닫기">
              <X className="size-4" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

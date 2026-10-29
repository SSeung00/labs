import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { Loader2, Mic, Square } from 'lucide-react'
import { useRecorder } from '@/lib/audio'
import { cn } from '@/lib/utils'

/** Tap to start, tap to stop. Stops by itself at maxSeconds. */
export function RecordButton({
  onRecorded,
  maxSeconds = 120,
  busy = false,
  disabled = false,
  size = 'lg',
  label,
}: {
  onRecorded: (blob: Blob, seconds: number) => void
  maxSeconds?: number
  busy?: boolean
  disabled?: boolean
  size?: 'md' | 'lg'
  label?: string
}) {
  const rec = useRecorder()
  const recording = rec.state === 'recording'

  const stop = async () => {
    const secs = rec.seconds
    const blob = await rec.stop()
    if (blob && secs >= 0.4) onRecorded(blob, secs)
  }

  useEffect(() => {
    if (recording && rec.seconds >= maxSeconds) void stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.seconds, recording, maxSeconds])

  // Space bar toggles recording on desktop (when not typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || (e.target as HTMLElement).closest('input, textarea, [contenteditable=true], button')) return
      e.preventDefault()
      if (busy || disabled) return
      if (recording) void stop()
      else void rec.start()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, busy, disabled])

  const dim = size === 'lg' ? 'size-20' : 'size-14'
  const left = Math.max(0, Math.ceil(maxSeconds - rec.seconds))

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        {recording && (
          <motion.span
            className="absolute inset-0 rounded-full bg-bad/30"
            animate={{ scale: 1 + rec.level * 0.6 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          />
        )}
        <button
          type="button"
          disabled={busy || disabled || rec.state === 'unsupported'}
          onClick={() => (recording ? stop() : rec.start())}
          className={cn(
            'relative grid place-items-center rounded-full text-white shadow-lg transition-transform active:scale-95 disabled:opacity-50',
            dim,
            recording ? 'bg-bad' : 'bg-accent',
          )}
          aria-label={recording ? '녹음 끝내기' : '녹음 시작'}
        >
          {busy ? <Loader2 className="size-7 animate-spin" /> : recording ? <Square className="size-7 fill-current" /> : <Mic className="size-8" />}
        </button>
      </div>
      <div className="num h-4 text-xs text-muted">
        {rec.state === 'denied'
          ? '마이크 권한이 필요해요'
          : rec.state === 'unsupported'
            ? '이 브라우저는 녹음을 지원하지 않아요 (https 필요)'
            : busy
              ? '알아듣는 중…'
              : recording
                ? `${rec.seconds.toFixed(0)}초 · ${maxSeconds < 120 ? `${left}초 남음 · ` : ''}눌러서 끝내기`
                : (label ?? '눌러서 말하기 (Space)')}
      </div>
    </div>
  )
}

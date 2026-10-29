import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Delete, Laptop, Lock } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { AUTH_KEY, useAuthStatus, useUnlock } from '@/api/auth'
import { LOCKED_EVENT } from '@/api/client'
import { cn } from '@/lib/utils'

// Remembers that this device was unlocked, so the app (and its offline copy) opens at once
// even when the PC is asleep and the status check would hang.
const REMEMBER = 'routinelab-unlocked'

function remembered(): boolean {
  try {
    return localStorage.getItem(REMEMBER) === '1'
  } catch {
    return false
  }
}

/** Phone/remote devices see a PIN pad until unlocked; this PC passes straight through. */
export function AuthGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const { data, isPending } = useAuthStatus()

  useEffect(() => {
    if (!data) return
    try {
      localStorage.setItem(REMEMBER, data.authed ? '1' : '0')
    } catch {
      /* storage unavailable */
    }
  }, [data])

  useEffect(() => {
    const onLocked = () => qc.invalidateQueries({ queryKey: AUTH_KEY })
    window.addEventListener(LOCKED_EVENT, onLocked)
    return () => window.removeEventListener(LOCKED_EVENT, onLocked)
  }, [qc])

  if (isPending && !remembered()) return <div className="min-h-dvh bg-bg" />
  // Unreachable server: let the app render so the offline copy (service worker) can show.
  if (!data || data.authed) return <>{children}</>
  return <LockScreen pinSet={data.pin_set} />
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'] as const

function LockScreen({ pinSet }: { pinSet: boolean }) {
  const [pin, setPin] = useState('')
  const [shake, setShake] = useState(0)
  const unlock = useUnlock()
  const input = useRef<HTMLInputElement>(null)

  const submit = (value: string) => {
    if (value.length < 4 || unlock.isPending) return
    unlock.mutate(value, {
      onError: () => {
        setShake((n) => n + 1)
        setPin('')
      },
    })
  }

  const press = (k: (typeof KEYS)[number]) => {
    if (!k) return
    unlock.reset()
    if (k === 'del') return setPin((p) => p.slice(0, -1))
    setPin((p) => (p.length < 8 ? p + k : p))
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <div className="w-full max-w-[320px] text-center">
        <img src="/favicon.svg" alt="" className="mx-auto size-14" />
        <h1 className="mt-4 text-xl font-bold tracking-tight">RoutineLab</h1>

        {!pinSet ? (
          <div className="mt-6 rounded-2xl border bg-surface p-5 text-left text-sm leading-relaxed text-muted">
            <Laptop className="mb-2 size-5 text-accent" />
            아직 PIN이 없어서 휴대폰 접속이 막혀 있어요.
            <br />
            PC에서 RoutineLab을 열고 <b className="text-text">설정 → 휴대폰에서 보기</b>에서 PIN을 정해 주세요.
          </div>
        ) : (
          <>
            <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-muted">
              <Lock className="size-3.5" /> PIN을 입력해 주세요
            </p>

            <motion.div
              key={shake}
              animate={shake ? { x: [0, -10, 10, -6, 6, 0] } : undefined}
              transition={{ duration: 0.35 }}
              className="mt-7 flex h-4 items-center justify-center gap-3"
              onClick={() => input.current?.focus()}
            >
              {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
                <span
                  key={i}
                  className={cn('size-3 rounded-full border-2 transition-colors', i < pin.length ? 'border-accent bg-accent' : 'border-border-strong')}
                />
              ))}
            </motion.div>
            {/* Real input for hardware keyboards and password managers; the keypad drives it on phones. */}
            <input
              ref={input}
              value={pin}
              onChange={(e) => {
                unlock.reset()
                setPin(e.target.value.replace(/\D/g, '').slice(0, 8))
              }}
              onKeyDown={(e) => e.key === 'Enter' && submit(pin)}
              inputMode="numeric"
              autoComplete="current-password"
              aria-label="PIN"
              className="sr-only"
            />
            <p className={cn('mt-4 h-5 text-xs', unlock.error ? 'text-bad' : 'text-subtle')}>
              {unlock.error ? unlock.error.message : unlock.isPending ? '확인 중…' : ' '}
            </p>

            <div className="mt-4 grid grid-cols-3 gap-3">
              {KEYS.map((k, i) => (
                <button
                  key={i}
                  type="button"
                  disabled={!k}
                  onClick={() => press(k)}
                  aria-label={k === 'del' ? '지우기' : k || undefined}
                  className={cn(
                    'num grid h-16 place-items-center rounded-2xl text-2xl font-semibold transition-colors',
                    k && k !== 'del' && 'bg-surface-2 active:bg-surface-3',
                    k === 'del' && 'text-muted active:text-text',
                    !k && 'invisible',
                  )}
                >
                  {k === 'del' ? <Delete className="size-6" /> : k}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => submit(pin)}
              disabled={pin.length < 4 || unlock.isPending}
              className="mt-5 h-12 w-full rounded-2xl bg-accent text-base font-semibold text-accent-fg transition-opacity disabled:opacity-40"
            >
              열기
            </button>
          </>
        )}
      </div>
    </div>
  )
}

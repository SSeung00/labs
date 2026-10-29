import { useCallback, useEffect, useRef, useState } from 'react'
import { tts, ttsUrl } from '@/api/el'

// ---------- playback: one shared <audio>, so starting a clip stops the previous one ----------

let shared: HTMLAudioElement | null = null
const listeners = new Set<(key: string | null) => void>()
let playingKey: string | null = null

function setPlaying(key: string | null) {
  playingKey = key
  listeners.forEach((fn) => fn(key))
}

export function stopAudio() {
  if (shared) {
    shared.pause()
    shared.onended = null
    shared.ontimeupdate = null
  }
  setPlaying(null)
}

export function playKey(key: string, opts: { speed?: number; onTime?: (t: number) => void; onEnd?: () => void } = {}) {
  stopAudio()
  shared = shared ?? new Audio()
  const a = shared
  a.src = ttsUrl(key)
  a.playbackRate = opts.speed ?? 1
  a.ontimeupdate = opts.onTime ? () => opts.onTime!(a.currentTime) : null
  a.onended = () => {
    setPlaying(null)
    opts.onEnd?.()
  }
  setPlaying(key)
  return a.play().catch(() => setPlaying(null))
}

/** Speak any text (synthesized on the PC and cached). */
export async function speak(text: string, opts: { rate?: number; speed?: number } = {}) {
  const clip = await tts(text, opts.rate)
  await playKey(clip.key, { speed: opts.speed })
  return clip
}

export function usePlayingKey() {
  const [key, setKey] = useState<string | null>(playingKey)
  useEffect(() => {
    listeners.add(setKey)
    return () => {
      listeners.delete(setKey)
    }
  }, [])
  return key
}

// ---------- recording ----------

function pickMime(): string | undefined {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  return types.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t))
}

export type RecorderState = 'idle' | 'recording' | 'denied' | 'unsupported'

/** Tap-to-start / tap-to-stop recorder with elapsed seconds and a rough input level (0–1). */
export function useRecorder() {
  const [state, setState] = useState<RecorderState>(
    typeof navigator !== 'undefined' && !!navigator.mediaDevices ? 'idle' : 'unsupported',
  )
  const [seconds, setSeconds] = useState(0)
  const [level, setLevel] = useState(0)
  const rec = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const stream = useRef<MediaStream | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const raf = useRef<number | undefined>(undefined)
  const started = useRef(0)
  const resolveStop = useRef<((b: Blob | null) => void) | null>(null)

  const cleanup = useCallback(() => {
    window.clearInterval(timer.current)
    if (raf.current) cancelAnimationFrame(raf.current)
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    setLevel(0)
  }, [])

  useEffect(() => cleanup, [cleanup])

  const start = useCallback(async () => {
    if (rec.current?.state === 'recording') return
    stopAudio()
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      stream.current = s
      const mime = pickMime()
      const r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined)
      chunks.current = []
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
      r.onstop = () => {
        const blob = chunks.current.length ? new Blob(chunks.current, { type: r.mimeType || 'audio/webm' }) : null
        cleanup()
        setState('idle')
        resolveStop.current?.(blob)
        resolveStop.current = null
      }
      rec.current = r
      r.start(250)
      started.current = Date.now()
      setSeconds(0)
      timer.current = window.setInterval(() => setSeconds((Date.now() - started.current) / 1000), 200)
      // input level meter
      try {
        const ctx = new AudioContext()
        const src = ctx.createMediaStreamSource(s)
        const an = ctx.createAnalyser()
        an.fftSize = 512
        src.connect(an)
        const buf = new Uint8Array(an.fftSize)
        const tick = () => {
          an.getByteTimeDomainData(buf)
          let peak = 0
          for (const v of buf) peak = Math.max(peak, Math.abs(v - 128))
          setLevel(Math.min(1, peak / 64))
          if (stream.current) raf.current = requestAnimationFrame(tick)
          else ctx.close().catch(() => undefined)
        }
        tick()
      } catch {
        /* meter is optional */
      }
      setState('recording')
    } catch {
      cleanup()
      setState('denied')
    }
  }, [cleanup])

  const stop = useCallback(
    () =>
      new Promise<Blob | null>((resolve) => {
        const r = rec.current
        if (!r || r.state !== 'recording') return resolve(null)
        resolveStop.current = resolve
        r.stop()
      }),
    [],
  )

  const cancel = useCallback(() => {
    resolveStop.current = null
    if (rec.current?.state === 'recording') {
      rec.current.onstop = () => {
        cleanup()
        setState('idle')
      }
      rec.current.stop()
    }
  }, [cleanup])

  return { state, seconds, level, start, stop, cancel }
}

export function blobForm(blob: Blob, field = 'audio', extra: Record<string, string> = {}) {
  const f = new FormData()
  const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'
  f.append(field, blob, `speech.${ext}`)
  for (const [k, v] of Object.entries(extra)) f.append(k, v)
  return f
}

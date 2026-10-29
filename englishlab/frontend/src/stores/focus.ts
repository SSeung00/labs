import { create } from 'zustand'

/** Focus mode: the app's navigation and top bar are hidden so a reading (and the pen) gets the whole screen. */
export const useFocusMode = create<{ focus: boolean; setFocus: (v: boolean) => void }>((set) => ({
  focus: false,
  setFocus: (focus) => {
    set({ focus })
    try {
      if (focus && !document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => undefined)
      if (!focus && document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined)
    } catch {
      /* fullscreen not allowed here */
    }
  },
}))

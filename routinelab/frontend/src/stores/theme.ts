import { create } from 'zustand'

export type ThemePref = 'dark' | 'light' | 'system'

const KEY = 'routinelab-theme'

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'dark' || v === 'light' || v === 'system') return v
  } catch {
    /* storage unavailable */
  }
  return 'dark'
}

function apply(pref: ThemePref) {
  const dark =
    pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  // Phone status bar / PWA chrome follows the page background.
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#0f1115' : '#f8f9fb')
}

interface ThemeState {
  pref: ThemePref
  setPref: (pref: ThemePref) => void
  cycle: () => void
}

export const useTheme = create<ThemeState>((set, get) => ({
  pref: readPref(),
  setPref: (pref) => {
    try {
      localStorage.setItem(KEY, pref)
    } catch {
      /* storage unavailable */
    }
    apply(pref)
    set({ pref })
  },
  cycle: () => {
    const order: ThemePref[] = ['dark', 'light', 'system']
    get().setPref(order[(order.indexOf(get().pref) + 1) % order.length])
  },
}))

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (useTheme.getState().pref === 'system') apply('system')
})

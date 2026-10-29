import { create } from 'zustand'

/** Set when the service worker answered from its offline copy (PC off or out of reach). */
export const useNet = create<{ stale: boolean; setStale: (v: boolean) => void }>((set) => ({
  stale: false,
  setStale: (stale) => set((s) => (s.stale === stale ? s : { stale })),
}))

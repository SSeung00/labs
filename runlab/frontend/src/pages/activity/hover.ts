import { create } from 'zustand'

/** Elapsed seconds under the chart crosshair, shared with the route map. */
export const useHoverT = create<{ t: number | null; set: (t: number | null) => void }>((set) => ({
  t: null,
  set: (t) => set({ t }),
}))

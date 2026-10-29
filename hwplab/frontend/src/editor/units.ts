// Document units: pt (1 pt = 100 HWPUNIT). Screen: CSS px at 96 dpi.
export const PX_PER_PT = 4 / 3

export const ptToPx = (pt: number) => pt * PX_PER_PT
export const pxToPt = (px: number) => px / PX_PER_PT
export const mmToPt = (mm: number) => (mm * 72) / 25.4
export const ptToMm = (pt: number) => (pt * 25.4) / 72

export const round = (v: number, digits = 2) => {
  const f = 10 ** digits
  return Math.round(v * f) / f
}

export interface PageSetup {
  width: number
  height: number
  left: number
  right: number
  top: number
  bottom: number
  header: number
  footer: number
  landscape: boolean
}

export const PAPER_SIZES: { name: string; width: number; height: number }[] = [
  { name: 'A4 (210×297mm)', width: mmToPt(210), height: mmToPt(297) },
  { name: 'A3 (297×420mm)', width: mmToPt(297), height: mmToPt(420) },
  { name: 'B5 (182×257mm)', width: mmToPt(182), height: mmToPt(257) },
  { name: 'B4 (257×364mm)', width: mmToPt(257), height: mmToPt(364) },
  { name: 'Letter (216×279mm)', width: 612, height: 792 },
  { name: 'Legal (216×356mm)', width: 612, height: 1008 },
]

export const defaultPage = (): PageSetup => ({
  width: 595.28,
  height: 841.89,
  left: 85.04,
  right: 85.04,
  top: 56.69,
  bottom: 42.52,
  header: 42.52,
  footer: 42.52,
  landscape: false,
})

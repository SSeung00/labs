export interface Spot {
  part: string
  side: 'left' | 'right' | 'center'
  view: 'front' | 'back'
  x: number
  y: number
}

// Coordinates in a 120×260 figure; `off` is the horizontal offset from the midline.
// Front view: the runner's right side is on the viewer's left. Back view: the reverse.
const PAIRS: { part: string; view: 'front' | 'back'; off: number; y: number }[] = [
  { part: '고관절', view: 'front', off: 15, y: 116 },
  { part: '대퇴사두', view: 'front', off: 12.5, y: 142 },
  { part: '무릎', view: 'front', off: 12.5, y: 172 },
  { part: '정강이', view: 'front', off: 12, y: 200 },
  { part: '발목', view: 'front', off: 12, y: 232 },
  { part: '발등', view: 'front', off: 14, y: 246 },
  { part: '둔근', view: 'back', off: 11, y: 110 },
  { part: '햄스트링', view: 'back', off: 12.5, y: 145 },
  { part: 'IT밴드', view: 'back', off: 21, y: 150 },
  { part: '종아리', view: 'back', off: 12, y: 192 },
  { part: '아킬레스건', view: 'back', off: 12, y: 226 },
  { part: '발뒤꿈치·족저근막', view: 'back', off: 14, y: 246 },
]

export const SPOTS: Spot[] = [
  ...PAIRS.flatMap((p) => {
    const viewerLeft: Spot['side'] = p.view === 'front' ? 'right' : 'left'
    const viewerRight: Spot['side'] = p.view === 'front' ? 'left' : 'right'
    return [
      { part: p.part, view: p.view, y: p.y, side: viewerLeft, x: 60 - p.off },
      { part: p.part, view: p.view, y: p.y, side: viewerRight, x: 60 + p.off },
    ]
  }),
  { part: '허리', view: 'back', side: 'center', x: 60, y: 92 },
]

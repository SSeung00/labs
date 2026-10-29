import { useEffect, useState } from 'react'

/** Resolved chart colors from the CSS design tokens; re-read when the theme class flips. */
export interface ChartTheme {
  dark: boolean
  text: string
  muted: string
  subtle: string
  grid: string
  surface: string
  surface2: string
  accent: string
  fitness: string
  fatigue: string
  form: string
  good: string
  warn: string
  bad: string
  zones: string[]
  /** Run-type colors (--rt-*), same as the heatmap and chips. */
  rt: Record<'easy' | 'long' | 'workout' | 'recovery' | 'race', string>
}

const VARS = {
  text: '--text', muted: '--text-muted', subtle: '--text-subtle', grid: '--border', surface: '--surface',
  surface2: '--surface-2', accent: '--accent', fitness: '--fitness', fatigue: '--fatigue', form: '--form',
  good: '--good', warn: '--warn', bad: '--bad',
} as const

// Canvas (ECharts) can't parse oklch on every browser; resolve through the
// browser's own color pipeline to rgb().
function resolve(cssVar: string): string {
  const probe = document.createElement('span')
  probe.style.color = `var(${cssVar})`
  probe.style.display = 'none'
  document.body.appendChild(probe)
  const c = getComputedStyle(probe).color
  probe.remove()
  return toRgb(c)
}

let ctx: CanvasRenderingContext2D | null = null
/** Paint one pixel and read it back: the only portable way to turn oklch()/color-mix() into rgb(). */
function toRgb(color: string): string {
  if (/^rgba?\(/.test(color)) return color
  ctx ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!ctx) return color
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
  return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${+(a / 255).toFixed(3)})`
}

function read(): ChartTheme {
  const out = Object.fromEntries(Object.entries(VARS).map(([k, v]) => [k, resolve(v)])) as Omit<ChartTheme, 'dark' | 'zones' | 'rt'>
  return {
    ...out,
    dark: document.documentElement.classList.contains('dark'),
    zones: ['--z1', '--z2', '--z3', '--z4', '--z5'].map(resolve),
    rt: {
      easy: resolve('--rt-easy'),
      long: resolve('--rt-long'),
      workout: resolve('--rt-workout'),
      recovery: resolve('--rt-recovery'),
      race: resolve('--rt-race'),
    },
  }
}

export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState(read)
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(read()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return theme
}

/** rgba() with alpha from an rgb()/hex color string. */
export function alpha(color: string, a: number): string {
  const m = color.match(/\d+(\.\d+)?/g)
  if (color.startsWith('rgb') && m && m.length >= 3) return `rgba(${m[0]}, ${m[1]}, ${m[2]}, ${a})`
  if (color.startsWith('#') && color.length === 7) {
    const n = parseInt(color.slice(1), 16)
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
  }
  return color
}

export function baseTooltip(t: ChartTheme) {
  return {
    backgroundColor: t.surface,
    borderColor: t.grid,
    borderWidth: 1,
    padding: [8, 12],
    textStyle: { color: t.text, fontFamily: 'Pretendard Variable, Pretendard, sans-serif', fontSize: 12 },
    extraCssText: 'border-radius:10px;box-shadow:0 8px 24px -8px rgba(0,0,0,.35);',
  }
}

export function baseAxis(t: ChartTheme) {
  return {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: t.subtle, fontSize: 11, fontFamily: 'Pretendard Variable, Pretendard, sans-serif' },
    splitLine: { lineStyle: { color: t.grid, width: 1 } },
  }
}

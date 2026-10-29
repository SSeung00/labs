import { useEffect, useMemo, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Map as MLMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// The library builds its worker URL at runtime, so the production bundle never includes it.
// Import it as an asset and point MapLibre at it explicitly.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { StreamData } from '@/api/activities'
import { useChartTheme } from '@/components/charts/theme'
import { fmtPaceSec } from '@/lib/format'
import { useHoverT } from './hover'

maplibregl.setWorkerUrl(workerUrl)

const STYLE = {
  dark: 'https://tiles.openfreemap.org/styles/dark',
  light: 'https://tiles.openfreemap.org/styles/positron',
}

function rgb(c: string): [number, number, number] {
  const m = c.match(/\d+(\.\d+)?/g)?.map(Number) ?? [0, 0, 0]
  return [m[0], m[1], m[2]]
}

/** Linear blend from `from` (k=0) to `to` (k=1) as rgb(). */
function mix(from: string, to: string, k: number) {
  const a = rgb(from)
  const b = rgb(to)
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(', ')})`
}

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return 0
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))
  return sorted[i]
}

export function RouteMap({ route }: { route: StreamData['route'] }) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const theme = useChartTheme()
  const hoverT = useHoverT((s) => s.t)

  // Pace domain from the 5th–95th percentile so a stop or a sprint doesn't flatten the gradient.
  const { fast, slow, stops } = useMemo(() => {
    const paces = route.map((r) => r[3]).filter((p): p is number => p != null).sort((a, b) => a - b)
    const fast = quantile(paces, 0.05)
    const slow = quantile(paces, 0.95)
    // line-progress is by distance along the line; approximate with cumulative segment length.
    let total = 0
    const cum = [0]
    for (let i = 1; i < route.length; i++) {
      total += Math.hypot(route[i][0] - route[i - 1][0], (route[i][1] - route[i - 1][1]) * 1.25)
      cum.push(total)
    }
    const slowColor = theme.dark ? 'rgb(70, 70, 78)' : 'rgb(205, 205, 212)'
    const stops: (number | string)[] = []
    const n = route.length
    const every = Math.max(1, Math.floor(n / 200))
    let lastP = -1
    for (let i = 0; i < n; i += every) {
      const prog = total ? cum[i] / total : i / n
      if (prog <= lastP) continue
      lastP = prog
      const p = route[i][3] ?? slow
      const k = slow > fast ? Math.min(1, Math.max(0, (slow - p) / (slow - fast))) : 0.5
      stops.push(prog, mix(slowColor, theme.accent, 0.15 + k * 0.85))
    }
    return { fast, slow, stops }
  }, [route, theme.accent, theme.dark])

  useEffect(() => {
    if (!ref.current || route.length < 2) return
    const map = new maplibregl.Map({
      container: ref.current,
      style: theme.dark ? STYLE.dark : STYLE.light,
      attributionControl: { compact: true },
      cooperativeGestures: true,
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

    const bounds = route.reduce((b, r) => b.extend([r[0], r[1]]), new maplibregl.LngLatBounds([route[0][0], route[0][1]], [route[0][0], route[0][1]]))
    map.fitBounds(bounds, { padding: 36, animate: false })

    // 'style.load' rather than 'load': 'load' waits on every tile/glyph and can stall indefinitely.
    const addRoute = () => {
      if (map.getSource('route')) return
      // The container may have been laid out after construction; refit to the real size.
      map.resize()
      map.fitBounds(bounds, { padding: 36, animate: false })
      map.addSource('route', {
        type: 'geojson',
        lineMetrics: true,
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.map((r) => [r[0], r[1]]) } },
      })
      map.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': theme.dark ? '#0b0c0f' : '#ffffff', 'line-width': 7, 'line-opacity': 0.9 },
      })
      map.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': 4,
          'line-gradient': (stops.length >= 4
            ? ['interpolate', ['linear'], ['line-progress'], ...stops]
            : theme.accent) as maplibregl.ExpressionSpecification,
        },
      })
      const ends = [
        { lnglat: route[0], color: theme.good },
        { lnglat: route[route.length - 1], color: theme.bad },
      ]
      map.addSource('ends', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: ends.map((e) => ({ type: 'Feature', properties: { color: e.color }, geometry: { type: 'Point', coordinates: [e.lnglat[0], e.lnglat[1]] } })),
        },
      })
      map.addLayer({
        id: 'ends',
        type: 'circle',
        source: 'ends',
        paint: { 'circle-radius': 5, 'circle-color': ['get', 'color'], 'circle-stroke-width': 2, 'circle-stroke-color': theme.dark ? '#0b0c0f' : '#ffffff' },
      })
    }
    map.on('style.load', addRoute)

    const el = document.createElement('div')
    el.className = 'size-3.5 rounded-full border-2 border-white bg-[var(--accent)] shadow-[0_0_0_4px_rgba(0,0,0,0.25)]'
    markerRef.current = new maplibregl.Marker({ element: el })

    return () => {
      markerRef.current?.remove()
      map.remove()
      mapRef.current = null
    }
  }, [route, stops, theme.dark, theme.accent, theme.good, theme.bad])

  // Move the hover marker to the route vertex nearest the chart crosshair.
  useEffect(() => {
    const map = mapRef.current
    const marker = markerRef.current
    if (!map || !marker) return
    if (hoverT == null) {
      marker.remove()
      return
    }
    let lo = 0
    let hi = route.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (route[mid][2] < hoverT) lo = mid + 1
      else hi = mid
    }
    const r = route[lo]
    if (r) marker.setLngLat([r[0], r[1]]).addTo(map)
  }, [hoverT, route])

  if (route.length < 2) {
    return <div className="grid h-full place-items-center text-sm text-subtle">GPS 경로가 없는 활동이에요 (실내/트레드밀)</div>
  }

  return (
    <div className="relative h-full">
      <div ref={ref} className="h-full w-full" />
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border bg-surface/90 px-3 py-2 text-[11px] backdrop-blur">
        <div className="mb-1 font-medium text-muted">페이스</div>
        <div className="flex items-center gap-2">
          <span className="num text-subtle">{fmtPaceSec(slow)}</span>
          <span
            className="h-1.5 w-20 rounded-full"
            style={{ background: `linear-gradient(90deg, ${mix(theme.dark ? 'rgb(70, 70, 78)' : 'rgb(205, 205, 212)', theme.accent, 0.15)}, ${theme.accent})` }}
          />
          <span className="num text-subtle">{fmtPaceSec(fast)}</span>
        </div>
      </div>
    </div>
  )
}

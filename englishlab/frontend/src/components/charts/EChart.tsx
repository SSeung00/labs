import { useEffect, useRef, type CSSProperties } from 'react'
import ReactEChartsCore from 'echarts-for-react/esm/core'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts'
import {
  AxisPointerComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'

echarts.use([
  LineChart, BarChart, PieChart, ScatterChart, GridComponent, LegendComponent, TooltipComponent,
  AxisPointerComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent, CanvasRenderer,
])

export function EChart({
  option,
  style,
  group,
  onEvents,
  className,
}: {
  option: EChartsOption
  style?: CSSProperties
  group?: string
  onEvents?: Record<string, (params: unknown) => void>
  className?: string
}) {
  const ref = useRef<ReactEChartsCore>(null)
  const box = useRef<HTMLDivElement>(null)

  // Charts can mount while their container is still 0px wide (grid/flex settling, page
  // transitions). Keep the canvas in sync with the container ourselves.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const chart = ref.current?.getEchartsInstance()
      if (chart && !chart.isDisposed()) {
        try {
          chart.resize()
        } catch (e) {
          console.error('chart resize failed', e)
        }
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={box} className={className} style={{ width: '100%', minWidth: 0 }}>
      <ReactEChartsCore
        ref={ref}
        echarts={echarts}
        option={option}
        notMerge
        lazyUpdate
        style={{ height: 200, width: '100%', ...style }}
        opts={{ renderer: 'canvas' }}
        onEvents={onEvents}
        onChartReady={(chart) => {
          requestAnimationFrame(() => !chart.isDisposed() && chart.resize())
          if (group) {
            chart.group = group
            echarts.connect(group)
          }
        }}
      />
    </div>
  )
}

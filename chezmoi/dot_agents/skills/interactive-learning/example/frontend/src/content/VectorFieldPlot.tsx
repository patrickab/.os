import type { KeyboardEvent, PointerEvent } from 'react'
import type { FieldPoint } from '../api'
import { useElementWidth } from '../lib/useElementWidth'

export type Mode = 'total' | 'potential' | 'rotation'
export type Probe = { x: number; y: number }

/** Component vector of a point for one mode. */
export function vectorOf(point: FieldPoint, mode: Mode): [number, number] {
  if (mode === 'potential') return [point.potential_x, point.potential_y]
  if (mode === 'rotation') return [point.rotation_x, point.rotation_y]
  return [point.total_x, point.total_y]
}

/** Series colors come from CSS tokens, never from chrome colors. */
const SERIES: Record<Mode, string> = {
  total: 'stroke-series-total fill-series-total',
  potential: 'stroke-series-potential fill-series-potential',
  rotation: 'stroke-series-rotation fill-series-rotation',
}

/** Half-extent of the plotted area in data units. The 9 x 9 grid spans [-1, 1], the rest holds the longest arrows. */
const EXTENT = 1.45
/** Margin for tick labels in px. */
const MARGIN = 30
/** Arrow length in axis units per unit of field magnitude. Fixed and identical for every figure, so slider changes visibly change arrow length and figures compare directly. */
export const ARROW_PER_UNIT = 0.1
const TICKS = [-1, -0.5, 0, 0.5, 1]

const tick = (value: number) => (value === 0 ? '0' : value.toFixed(1).replace('-', '\u2212'))

/** Pixels per unit of field magnitude for a plot of `size` px. */
const arrowPixels = (size: number) => ARROW_PER_UNIT * ((size - 2 * MARGIN) / (2 * EXTENT))

/**
 * Quiver plot with equal x and y scale. Pointer or arrow keys select a grid point.
 * Extent and arrow scale are constants, so several plots of the same size are directly comparable.
 * The wrapper is the only tab stop, the SVG itself is decorative and described by the caption outside it.
 * The first arrow key press without a probe selects the center grid point, later presses move it.
 */
export function VectorFieldPlot({ points, mode, probe, onProbe, dimmed, label, describedBy }: {
  points: FieldPoint[]; mode: Mode; probe: Probe | null; onProbe: (probe: Probe | null) => void
  dimmed: boolean; label: string; describedBy: string
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const size = Math.max(width, 0)
  const unit = (size - 2 * MARGIN) / (2 * EXTENT)
  const sx = (x: number) => MARGIN + (x + EXTENT) * unit
  const sy = (y: number) => MARGIN + (EXTENT - y) * unit
  const scale = arrowPixels(size)
  const xs = [...new Set(points.map((point) => point.x))].sort((a, b) => a - b)
  const ys = [...new Set(points.map((point) => point.y))].sort((a, b) => a - b)

  const nearest = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - box.left - MARGIN) / unit - EXTENT
    const y = EXTENT - (event.clientY - box.top - MARGIN) / unit
    const pick = (values: number[], target: number) => values.reduce((best, value) => (Math.abs(value - target) < Math.abs(best - target) ? value : best))
    onProbe({ x: pick(xs, x), y: pick(ys, y) })
  }

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }
    if (event.key === 'Escape') { onProbe(null); return }
    const delta = step[event.key]
    if (!delta) return
    event.preventDefault()
    const clamp = (values: number[], current: number | undefined, d: number) => {
      const at = current === undefined ? Math.floor(values.length / 2) : Math.min(values.length - 1, Math.max(0, values.indexOf(current) + d))
      return values[at]
    }
    onProbe({ x: clamp(xs, probe?.x, probe ? delta[0] : 0), y: clamp(ys, probe?.y, probe ? delta[1] : 0) })
  }

  const arrows = size > 2 * MARGIN ? points.map((point) => {
    const [vx, vy] = vectorOf(point, mode)
    const tx = sx(point.x)
    const ty = sy(point.y)
    const dx = vx * scale
    const dy = -vy * scale
    const length = Math.hypot(dx, dy)
    let d = ''
    if (length >= 0.75) {
      const ux = dx / length
      const uy = dy / length
      const head = Math.min(7, length * 0.45)
      const bx = tx + dx - ux * head
      const by = ty + dy - uy * head
      const half = head * 0.45
      d = `M${tx} ${ty}L${bx} ${by}M${tx + dx} ${ty + dy}L${bx - uy * half} ${by + ux * half}L${bx + uy * half} ${by - ux * half}Z`
    }
    return <path key={`${point.x},${point.y}`} d={d} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
  }) : null

  return <div ref={ref} className="w-full min-w-0">
    <div tabIndex={0} role="group" aria-label={label} aria-describedby={describedBy} onKeyDown={move}
      className="rounded-xl outline-offset-4">
      {size > 2 * MARGIN && <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true"
        className={`block max-w-full rounded-xl bg-surface-elevated ring-1 ring-divider-soft transition-opacity ${dimmed ? 'opacity-60' : ''}`}
        onPointerDown={nearest} onPointerMove={(event) => { if (event.pointerType === 'mouse') nearest(event) }}>
        <g className="stroke-divider-soft" strokeWidth={1}>
          {TICKS.map((value) => <g key={value}>
            <line x1={sx(value)} x2={sx(value)} y1={MARGIN} y2={size - MARGIN} className={value === 0 ? 'stroke-divider' : ''} />
            <line y1={sy(value)} y2={sy(value)} x1={MARGIN} x2={size - MARGIN} className={value === 0 ? 'stroke-divider' : ''} />
          </g>)}
        </g>
        <g className="fill-ink-muted text-[11px] tabular-nums">
          {TICKS.map((value) => <g key={value}>
            <text x={sx(value)} y={size - MARGIN + 15} textAnchor="middle">{tick(value)}</text>
            <text x={MARGIN - 6} y={sy(value)} textAnchor="end" dominantBaseline="central">{tick(value)}</text>
          </g>)}
          <text x={size - MARGIN} y={size - 5} textAnchor="end" className="italic">x</text>
          <text x={MARGIN - 6} y={MARGIN - 10} textAnchor="end" className="italic">y</text>
        </g>
        <g className="fill-ink-subtle">
          {points.map((point) => <circle key={`${point.x},${point.y}`} cx={sx(point.x)} cy={sy(point.y)} r={1.75} />)}
        </g>
        <g className={SERIES[mode]}>{arrows}</g>
        {probe && <circle cx={sx(probe.x)} cy={sy(probe.y)} r={8} fill="none" strokeWidth={1.5} className="stroke-ink" />}
      </svg>}
    </div>
  </div>
}

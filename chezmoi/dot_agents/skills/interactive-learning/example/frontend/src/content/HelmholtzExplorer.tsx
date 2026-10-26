import { useId, useState } from 'react'
import { postDecomposition } from '../api'
import type { Decomposition, FieldPoint } from '../api'
import { Button, Eq, InlineMath, Panel, RangeField } from '../components/ui'
import { formatNumber } from '../lib/format'
import { useDebounced } from '../lib/useDebounced'
import { useRequest } from '../lib/useRequest'
import { ARROW_PER_UNIT, VectorFieldPlot, vectorOf } from './VectorFieldPlot'
import type { Mode, Probe } from './VectorFieldPlot'

const FIELDS: { mode: Mode; title: string; formula: string; dot: string }[] = [
  { mode: 'potential', title: 'Potential', formula: String.raw`\mathbf{P} = a\,(x,\, y)`, dot: 'bg-series-potential' },
  { mode: 'rotation', title: 'Rotation', formula: String.raw`\mathbf{R} = b\,(-y,\, x)`, dot: 'bg-series-rotation' },
  { mode: 'total', title: 'Total', formula: String.raw`\mathbf{F} = \mathbf{P} + \mathbf{R}`, dot: 'bg-series-total' },
]
const DEFAULT = 1

function describe(mode: Mode, potential: number, rotation: number): string {
  if (mode === 'potential') return potential === 0 ? 'No potential contribution.' : 'Outward flow, with no local spin.'
  if (mode === 'rotation') return rotation === 0 ? 'No rotation contribution.' : 'Counterclockwise circulation, with no net spreading.'
  if (potential === 0 && rotation === 0) return 'Both components are zero.'
  if (potential === 0) return 'Only the circulation remains.'
  if (rotation === 0) return 'Only the outward flow remains.'
  return 'Outward flow and circulation combine into a spiral.'
}

export function HelmholtzExplorer() {
  const [potentialStrength, setPotentialStrength] = useState(DEFAULT)
  const [rotationStrength, setRotationStrength] = useState(DEFAULT)
  const [probe, setProbe] = useState<Probe | null>(null)
  const descriptionId = useId()
  const potential = useDebounced(potentialStrength, 150)
  const rotation = useDebounced(rotationStrength, 150)
  const [state, retry] = useRequest((signal) => postDecomposition({ potential, rotation }, signal), [potential, rotation])
  const data: Decomposition | undefined = state.status === 'done' ? state.data : state.status === 'loading' ? state.previous : undefined
  const updating = state.status === 'loading' || potential !== potentialStrength || rotation !== rotationStrength
  const selected = data && probe ? data.points.find((point) => point.x === probe.x && point.y === probe.y) : undefined

  return <Panel className="@container space-y-5">
    <div className="grid gap-x-8 gap-y-3 @lg:grid-cols-2" aria-label="Field parameters">
      <RangeField label="Potential strength a" value={potentialStrength} min={0} max={2} step={0.05} onChange={setPotentialStrength} />
      <RangeField label="Rotation strength b" value={rotationStrength} min={0} max={2} step={0.05} onChange={setRotationStrength} />
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-divider-soft pb-3 text-xs text-ink-muted">
      <p role="status">
        {state.status === 'error' ? 'Request failed' : updating ? 'Updating fields…' : data ? '' : 'Loading fields…'}
      </p>
      {(potentialStrength !== DEFAULT || rotationStrength !== DEFAULT) && <Button onClick={() => { setPotentialStrength(DEFAULT); setRotationStrength(DEFAULT) }}>Reset</Button>}
    </div>

    {state.status === 'error' ? <div role="alert" className="space-y-3 text-sm">
      <p className="text-danger">{state.error}</p>
      <p className="text-xs text-ink-muted">Start the Python API from the template root: <code className="break-words">uv run uvicorn backend.main:app --host 127.0.0.1 --port 8000</code></p>
      <Button onClick={retry}>Retry</Button>
    </div> : data ? <div className="space-y-4" aria-busy={updating}>
      <div className="grid grid-cols-1 gap-5 @xl:grid-cols-3" aria-label="Potential plus rotation equals total">
        {FIELDS.map((field) => <figure key={field.mode} className="min-w-0 space-y-3" aria-labelledby={`${descriptionId}-${field.mode}-title`}>
          <figcaption className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <h3 id={`${descriptionId}-${field.mode}-title`} className="flex items-center gap-2 font-medium">
              <span aria-hidden="true" className={`size-2 rounded-full ${field.dot}`} />{field.title}
            </h3>
            <span className="text-xs text-ink-muted"><InlineMath>{field.formula}</InlineMath></span>
          </figcaption>
          <VectorFieldPlot points={data.points} mode={field.mode} probe={selected ? probe : null} onProbe={setProbe} dimmed={updating}
            label={`${field.title} vector field. Arrow keys inspect the same point in all three plots.`} describedBy={`${descriptionId}-${field.mode}`} />
          <p id={`${descriptionId}-${field.mode}`} className="text-xs leading-relaxed text-ink-muted">{describe(field.mode, data.potential, data.rotation)}</p>
        </figure>)}
      </div>
      <p className="text-xs text-ink-muted">
        Same axes and arrow scale in all three plots. Magnitude 1 spans {ARROW_PER_UNIT} axis units. Coordinates are dimensionless.
      </p>
      <div className="space-y-1" aria-label="Live divergence and curl of the total field">
        <Eq>{String.raw`\operatorname{div}\mathbf{F} = 2a = ${formatNumber(data.divergence)}, \qquad \operatorname{curl}\mathbf{F} = 2b = ${formatNumber(data.curl)}`}</Eq>
        <p className="text-xs text-ink-muted">
          Divergence depends only on <InlineMath>a</InlineMath> and curl only on <InlineMath>b</InlineMath>: each part carries exactly one behaviour.
          Set <InlineMath>b = 0</InlineMath> for a pure source, or <InlineMath>a = 0</InlineMath> for a pure vortex.
          Both are the same at every point, so the arrows change length with distance but not the local spreading or spin.
        </p>
      </div>
      <ProbeReadout point={selected} />
    </div> : <div className="grid grid-cols-1 gap-5 @xl:grid-cols-3" role="status" aria-label="Loading comparison from the API">
      {FIELDS.map((field) => <div key={field.mode} className="aspect-square animate-pulse rounded-lg bg-hover-strong" />)}
    </div>}
  </Panel>
}

function ProbeReadout({ point }: { point: FieldPoint | undefined }) {
  return <div aria-live="polite" className="min-h-10 border-t border-divider-soft pt-3 text-xs text-ink-muted">
    {point ? <div className="flex flex-wrap gap-x-6 gap-y-2 tabular-nums">
      <p className="text-ink">Point ({formatNumber(point.x)}, {formatNumber(point.y)})</p>
      {FIELDS.map((field) => {
        const [x, y] = vectorOf(point, field.mode)
        return <p key={field.mode} className="flex items-center gap-1.5"><span aria-hidden="true" className={`size-2 rounded-full ${field.dot}`} />
          {field.title} ({formatNumber(x)}, {formatNumber(y)})
        </p>
      })}
    </div> : <p>Hover or tap a plot to compare the same point. Keyboard: focus a plot and use the arrow keys.</p>}
  </div>
}

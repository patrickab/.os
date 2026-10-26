import { Fragment, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Disclosure, Eq, HEADING, InlineMath, Panel, RangeField } from '../../components/ui'
import { formatNumber } from '../../lib/format'

const WRAP = 'space-y-4 text-sm leading-relaxed [&>p]:max-w-3xl [&>details]:max-w-3xl'

/** Compact table that scrolls inside its own box instead of widening the page. */
function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return <div className="overflow-x-auto" role="region" aria-label={head.join(', ')} tabIndex={0}>
    <table className="w-full min-w-[28rem] border-collapse text-left text-sm">
      <thead>
        <tr className="border-b border-divider text-ink-muted">
          {head.map((label) => <th key={label} scope="col" className="px-2 py-1.5 font-medium">{label}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => <tr key={i} className="border-b border-divider-soft align-top">
          {row.map((cell, j) => j === 0
            ? <th key={j} scope="row" className="px-2 py-1.5 font-medium">{cell}</th>
            : <td key={j} className="px-2 py-1.5 tabular-nums">{cell}</td>)}
        </tr>)}
      </tbody>
    </table>
  </div>
}

/** Adapt Heatmap.tsx's pixel indexing and TensorScenes.tsx's toy Gaussian field. */
function FieldSlicePlot() {
  const [slice, setSlice] = useState(15)
  const canvas = useRef<HTMLCanvasElement>(null)
  const edge = 32
  const z = slice / (edge - 1)
  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context) return
    const image = context.createImageData(edge, edge)
    for (let y = 0; y < edge; y++) {
      for (let x = 0; x < edge; x++) {
        const value = Math.exp(-((x / (edge - 1) - 0.5) ** 2 + (y / (edge - 1) - 0.5) ** 2 + (z - 0.5) ** 2) / 0.08)
        const pixel = 4 * (x + edge * (edge - 1 - y))
        image.data[pixel] = Math.round(255 * value)
        image.data[pixel + 1] = Math.round(255 * value)
        image.data[pixel + 2] = Math.round(255 * value)
        image.data[pixel + 3] = 255
      }
    }
    context.putImageData(image, 0, 0)
  }, [z])
  return <Panel className="space-y-3">
    <RangeField label="Z slice index" value={slice} min={0} max={edge - 1} step={1} onChange={setSlice} />
    <figure className="mx-auto max-w-80 space-y-2">
      <p className="text-xs text-ink-muted">y ↑ · XY slice · x →</p>
      <canvas ref={canvas} width={edge} height={edge} role="img"
        aria-label={`Gaussian field at z = ${z.toFixed(2)}. Brightness is field value on a fixed zero to one scale. The centre is brightest.`}
        className="block aspect-square w-full rounded-lg ring-1 ring-divider [image-rendering:pixelated]" />
      <div aria-label="Linear grayscale from black at zero to white at one" className="flex h-3" role="img">
        {Array.from({ length: 32 }, (_, index) => <span key={index} className="flex-1" style={{ background: `rgb(${index / 31 * 255} ${index / 31 * 255} ${index / 31 * 255})` }} />)}
      </div>
      <div className="flex justify-between text-xs text-ink-muted"><span>0 · black</span><span>1 · white</span></div>
      <figcaption className="text-xs text-ink-muted">Synthetic 32³ Gaussian field. Brightness is the value at each cell, on the same 0 to 1 scale for every slice.</figcaption>
    </figure>
    <p aria-live="polite" className="text-sm">Slice {slice + 1} of {edge}: {edge} × {edge} = {(edge * edge).toLocaleString('en-US')} values. The whole grid stores {edge}³ = {(edge ** 3).toLocaleString('en-US')} numbers, and nothing in them says where each cell sits or what it measures.</p>
  </Panel>
}

// ---------------------------------------------------------------------------
// Representation
// ---------------------------------------------------------------------------

export function RepresentationSection() {
  return <div className={WRAP}>
    <p>
      A physical <strong>field</strong> gives a value at every point, such as the temperature at each place in a room.
      A computer cannot hold infinitely many values, so a model works with a <strong>representation</strong>:
      a finite list of numbers that stands in for the field.
    </p>
    <p className="text-ink-muted">
      The same field can be stored in several ways. In every case the numbers only mean something next to a description of
      where they sit, which quantity they measure and in which units. A model that only sees bare numbers has to guess all of that.
    </p>

    <h3 className={HEADING}>Three common ways to store one field</h3>
    <Table
      head={['Representation', 'What the numbers are', 'What must travel with them']}
      rows={[
        ['Regular grid', 'One value per cell of an evenly spaced grid.', 'Domain size and cell spacing, which axis is which.'],
        ['Mesh or point cloud', 'One value per node, with nodes placed where detail is needed.', 'The position of every node, and how nodes connect.'],
        ['Coefficients', 'Weights of a fixed set of shapes, such as waves, that add up to the field.', 'Which shapes the weights belong to, in which order.'],
      ]}
    />
    <Disclosure label="What does a 3D grid look like slice by slice?">
      <FieldSlicePlot />
    </Disclosure>

    <p className="text-xs text-ink-muted">
      Source: field-as-function view, S4 §2 (that view only). Details in the last disclosure.
    </p>

    <Disclosure label="Example of a complete record (invented)">
      <p className="text-ink-muted">Invented example for illustration, not taken from a dataset.</p>
      <dl className="mt-3 grid gap-x-4 gap-y-1 sm:grid-cols-[9rem_1fr]">
        <dt className="text-ink-muted">Domain</dt><dd>A square, 1 m × 1 m</dd>
        <dt className="text-ink-muted">Layout</dt><dd>64 × 64 cells, each 1/64 m ≈ 15.6 mm wide</dd>
        <dt className="text-ink-muted">Coordinates</dt><dd>Cell centres at <InlineMath>{String.raw`x = (i + \tfrac{1}{2})\,\Delta x`}</InlineMath>, likewise for <InlineMath>y</InlineMath></dd>
        <dt className="text-ink-muted">Variables</dt><dd>Temperature in kelvin, pressure in pascal</dd>
        <dt className="text-ink-muted">Array</dt><dd className="tabular-nums">64 × 64 × 2 = 8,192 numbers</dd>
      </dl>
      <p className="mt-3 text-ink-muted">
        Drop any row and the array becomes ambiguous: the same 8,192 numbers could describe a table top or a continent.
      </p>
    </Disclosure>

    <Disclosure label="Why can't the model just take the array of numbers?">
      <p>
        An array's shape records only how many values there are. Two arrays of 64 × 64 numbers can cover 1 m or 100 km, so the
        spacing between neighbouring values differs enormously even though the shapes match.
        Rescaling each variable to a convenient range also hides its units unless the scale is kept alongside.
      </p>
      <Eq>{String.raw`\Delta x = \frac{L}{n}, \quad \text{with domain length } L \text{ and } n \text{ cells}`}</Eq>
      <p className="text-ink-muted">
        Conditions that describe the situation, such as boundary values or material properties, are numbers with the same need
        for meaning: the model should know which one is which, and in which units.
      </p>
    </Disclosure>

    <Disclosure label="Source details (S4)">
      <p id="src-representation-s4" className="text-ink-muted">
        <strong>S4</strong>, arXiv manuscript, 2020: Li et al., Fourier Neural Operator, §2 (functions mapped to solution functions, and discretization).{' '}
        <a className="underline" href="https://arxiv.org/abs/2010.08895" target="_blank" rel="noreferrer">arXiv:2010.08895</a> (HTML v3, 2021-05-17), checked 2026-10-24.
        Supports the field-as-function view only. The record above is our invented example.
      </p>
    </Disclosure>
  </div>
}

// ---------------------------------------------------------------------------
// Processing: local versus contextual mixing
// ---------------------------------------------------------------------------

const GRID = 7
const CELLS = GRID * GRID
const CELL_PX = 30
const PITCH = 34
const PAD = 6
const VIEW = PAD * 2 + GRID * PITCH - (PITCH - CELL_PX)
const centre = (index: number) => PAD + index * PITCH + CELL_PX / 2

type Cell = { r: number; c: number }
type Kind = 'local' | 'contextual'

const clampIndex = (value: number) => Math.max(0, Math.min(GRID - 1, value))

function reaches(kind: Kind, cell: Cell, sel: Cell, steps: number) {
  return kind === 'contextual' || Math.max(Math.abs(cell.r - sel.r), Math.abs(cell.c - sel.c)) <= steps
}

/** Cells inside a (2·steps+1) square window, clipped at the edge of the domain. */
function localWindowCount(sel: Cell, steps: number) {
  const rows = Math.min(sel.r + steps, GRID - 1) - Math.max(sel.r - steps, 0) + 1
  const cols = Math.min(sel.c + steps, GRID - 1) - Math.max(sel.c - steps, 0) + 1
  return rows * cols
}


const MOVES: Record<string, [number, number]> = {
  ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
}


function LegendSwatch({ children, label }: { children: ReactNode; label: string }) {
  return <span className="inline-flex items-center gap-1.5">
    <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" aria-hidden="true">{children}</svg>
    {label}
  </span>
}

function NeighborhoodDiagram({ kind, sel, steps, onSelect }: {
  kind: Kind; sel: Cell; steps: number; onSelect: (cell: Cell) => void
}) {
  const titleId = useId()
  const descId = useId()
  const count = kind === 'contextual' ? CELLS : localWindowCount(sel, steps)
  const title = kind === 'local' ? 'Local mixing' : 'Contextual mixing'
  const desc = kind === 'local'
    ? `A ${GRID} by ${GRID} grid of cells. The selected cell at row ${sel.r + 1}, column ${sel.c + 1} can read from the ${count} cells within ${steps} cell${steps === 1 ? '' : 's'} of it, marked with dots.`
    : `A ${GRID} by ${GRID} grid of cells. The selected cell at row ${sel.r + 1}, column ${sel.c + 1} is joined by lines to all ${CELLS} cells, each marked with a dot.`
  return <figure tabIndex={0} aria-label={`${title}. Use arrow keys to move the selected cell.`} onKeyDown={(event) => {
    const move = MOVES[event.key]
    if (!move) return
    event.preventDefault()
    onSelect({ r: clampIndex(sel.r + move[0]), c: clampIndex(sel.c + move[1]) })
  }} className="min-w-0 rounded-lg">
    <svg viewBox={`0 0 ${VIEW} ${VIEW}`} role="img" aria-labelledby={`${titleId} ${descId}`} className="mx-auto block w-full max-w-[16rem]">
      <title id={titleId}>{title}</title>
      <desc id={descId}>{desc}</desc>
      {kind === 'contextual' && Array.from({ length: CELLS }, (_, index) => {
        const r = Math.floor(index / GRID)
        const c = index % GRID
        if (r === sel.r && c === sel.c) return null
        return <line key={index} x1={centre(sel.c)} y1={centre(sel.r)} x2={centre(c)} y2={centre(r)}
          className="stroke-series-potential/35" strokeWidth={1} />
      })}
      {Array.from({ length: CELLS }, (_, index) => {
        const cell = { r: Math.floor(index / GRID), c: index % GRID }
        const isSel = cell.r === sel.r && cell.c === sel.c
        const reads = reaches(kind, cell, sel, steps)
        const x = PAD + cell.c * PITCH
        const y = PAD + cell.r * PITCH
        return <g key={index} className="cursor-pointer" onClick={() => onSelect(cell)}>
          <rect x={x} y={y} width={CELL_PX} height={CELL_PX} rx={5}
            className={isSel ? 'fill-series-total stroke-ink' : reads ? 'fill-series-potential/25 stroke-series-potential' : 'fill-paper stroke-divider'}
            strokeWidth={isSel ? 3 : 1} />
          {isSel
            ? <rect x={x + 10} y={y + 10} width={10} height={10} rx={2} className="fill-paper" />
            : reads && <circle cx={x + CELL_PX / 2} cy={y + CELL_PX / 2} r={4} className="fill-series-potential" />}
        </g>
      })}
    </svg>
    <figcaption className="mt-2 text-center">
      <span className={HEADING}>{title}</span>
      <span className="block text-ink-muted tabular-nums">
        {kind === 'local' ? `${steps} step${steps === 1 ? '' : 's'}: ` : 'one step: '}reads {count} of {CELLS} cells
      </span>
    </figcaption>
  </figure>
}

export function ProcessingSection() {
  const [sel, setSel] = useState<Cell>({ r: 3, c: 3 })
  const [steps, setSteps] = useState(1)
  const localCount = localWindowCount(sel, steps)
  return <div className={WRAP}>
    <p>
      Predicting a value at one place usually needs information from other places. The <strong>processing</strong> stage lets
      locations exchange information. <strong>Local mixing</strong> combines each cell with its immediate neighbours, like a
      stencil in a numerical scheme. A <a className="underline" href="#example-cnn/convolution">convolution</a> is the standard example.
      <strong> Global contextual mixing</strong> lets each cell consult every other cell, so distant regions can influence one another
      in a single step. <a className="underline" href="#example-attention/attention">Attention</a> is the standard example, and windowed variants restrict its reach.
    </p>
    <p className="text-ink-muted">
      Pick a cell and compare. Local mixing reaches one ring further with each repeated step. Contextual mixing reaches everywhere at once,
      at the price of many more connections. The diagrams show which cells <em>can</em> contribute, not how much each one does:
      in a real model those weights are learned from data and are not drawn here.
    </p>

    <Panel className="space-y-4">
      <div className="grid items-center gap-4 sm:grid-cols-2">
        <RangeField label="Repeated local steps" value={steps} min={1} max={3} step={1} onChange={setSteps} />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setSel({ r: 3, c: 3 })}>Centre cell</Button>
          <Button onClick={() => setSel({ r: 0, c: 0 })}>Corner cell</Button>
        </div>
      </div>
      <p className="text-xs text-ink-muted">Click a cell in either diagram, or focus a diagram and use the arrow keys.</p>
      <p aria-live="polite" className="text-xs tabular-nums text-ink-muted">
        Row {sel.r + 1}, column {sel.c + 1}. Local mixing reads {localCount} of {CELLS} cells. Global contextual mixing reads all {CELLS}.
      </p>

      <div className="grid gap-4 border-t border-divider-soft pt-4 sm:grid-cols-2">
        <NeighborhoodDiagram kind="local" sel={sel} steps={steps} onSelect={setSel} />
        <NeighborhoodDiagram kind="contextual" sel={sel} steps={steps} onSelect={setSel} />
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-ink-muted">
        <LegendSwatch label="selected cell">
          <rect x={1.5} y={1.5} width={13} height={13} rx={3} className="fill-series-total stroke-ink" strokeWidth={2} />
          <rect x={5} y={5} width={6} height={6} rx={1} className="fill-paper" />
        </LegendSwatch>
        <LegendSwatch label="can be read from">
          <rect x={1.5} y={1.5} width={13} height={13} rx={3} className="fill-series-potential/25 stroke-series-potential" />
          <circle cx={8} cy={8} r={2.5} className="fill-series-potential" />
        </LegendSwatch>
        <LegendSwatch label="ignored in this step">
          <rect x={1.5} y={1.5} width={13} height={13} rx={3} className="fill-paper stroke-divider" />
        </LegendSwatch>
      </div>

    </Panel>
    <p className="text-xs text-ink-muted">
      Source: attention mechanism, S3 §3.2 and §4 (mechanism only; not evidence about field surrogates). Details below. The 7 × 7 grids are our own illustration.
    </p>

    <Disclosure label="How is each connection combined into a new value?">
      <p>
        Write <InlineMath>{String.raw`v_i`}</InlineMath> for the stored numbers at cell <InlineMath>i</InlineMath>. Local mixing updates a cell from itself and the cells
        in its neighbourhood, using weights that are shared by every position.
        Contextual mixing updates it from all cells, with weights <InlineMath>{String.raw`w_{ij}`}</InlineMath> that depend on the content of cells <InlineMath>i</InlineMath> and <InlineMath>j</InlineMath>.
      </p>
      <Eq>{String.raw`\text{local:}\quad v'_i = f\bigl(v_i,\ \{\, v_j : j \text{ near } i \,\}\bigr)`}</Eq>
      <Eq>{String.raw`\text{contextual:}\quad v'_i = \sum_j w_{ij}\, g(v_j)`}</Eq>
      <p className="text-ink-muted">
        Attention is the best-known way to compute <InlineMath>{String.raw`w_{ij}`}</InlineMath>. Its weights are learned and differ for every input,
        so the diagram deliberately shows only which connections exist.
      </p>
    </Disclosure>

    <Disclosure label="Which one suits which physics?">
      <p>
        Effects that really are nearby, such as diffusion or transport over a short distance, match local mixing, whose connection count
        grows in proportion to the number of cells. Effects that couple distant places, such as a pressure wave crossing the
        whole domain or a global constraint, match contextual mixing, whose connection count grows with the square of the number of cells.
        Many models alternate both. Which works better for a given problem is an empirical question that this figure does not answer.
      </p>
      <p className="text-ink-muted">
        Near the edge a window is clipped, as in the corner cell. A real model needs a boundary rule there, such as padding with
        zeros, mirroring, or wrapping around for periodic domains.
      </p>
    </Disclosure>

    <Disclosure label="Source details (S3)">
      <p id="src-attention-s3">
        <strong>S3</strong>, conference paper (NeurIPS 2017): Vaswani et al., Attention Is All You Need, §3.2 (query, key and value weighted sums),
        §3.2.3 (global encoder self-attention, masked decoder) and §4 with Table 1 (global path length, cost quadratic in sequence length).{' '}
        <a className="underline" href="https://arxiv.org/abs/1706.03762" target="_blank" rel="noreferrer">arXiv:1706.03762</a> (PDF v7), checked 2026-10-24.
      </p>
      <p className="mt-2 text-ink-muted">
        The paper supports the mechanism only. Its domain is machine translation, so it says nothing about how well attention works for field surrogates.
        Contextual mixing is not always global, since windowed designs exist. The 7 × 7 grids here are our own illustration.
      </p>
    </Disclosure>
  </div>
}

// ---------------------------------------------------------------------------
// Resolution versus information capacity
// ---------------------------------------------------------------------------

const VARIABLES = 2

export function ResolutionSection() {
  const [cells, setCells] = useState(64)
  const [width, setWidth] = useState(1)
  const [kept, setKept] = useState(256)
  const spacingMm = (width / cells) * 1000
  const fieldNumbers = cells * cells * VARIABLES
  return <div className={WRAP}>
    <p>
      “Resolution” hides two different things. <strong>Grid resolution</strong> is physical: how finely the field is sampled,
      described by the cell width <InlineMath>{String.raw`\Delta x`}</InlineMath>. Structure below the sampling limit cannot be distinguished reliably.
      <strong> Information capacity</strong> is internal: how many numbers the model keeps while it works, such as the
      number of channels, the size of a latent vector or the number of retained modes.
    </p>
    <p className="text-ink-muted">
      Neither implies the other. A finer grid stores smaller features but does not enlarge what the model can hold inside, and a roomier
      model does not see detail the grid never sampled. Because the array shape alone hides <InlineMath>{String.raw`\Delta x`}</InlineMath>, the physical domain
      width has to be supplied with the grid, as the width slider shows.
    </p>

    <Panel className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <RangeField label="Cells per side" value={cells} min={8} max={256} step={8} onChange={setCells} />
        <RangeField label="Domain width (m)" value={width} min={0.5} max={4} step={0.5} onChange={setWidth} />
        <RangeField label="Internal numbers kept" value={kept} min={16} max={2048} step={16} onChange={setKept} />
      </div>
      <Table
        head={['Quantity', 'Value', 'Set by']}
        rows={[
          ['Cell width Δx = L / n', `${formatNumber(spacingMm, 1)} mm`, 'Grid resolution: domain width and cells per side'],
          ['Nyquist wavelength for regular sampling ≈ 2Δx', `${formatNumber(2 * spacingMm, 1)} mm`, 'Grid resolution'],
          [`Numbers in the field (n × n × ${VARIABLES} variables)`, fieldNumbers.toLocaleString('en-US'), 'Grid resolution and variable count'],
          ['Numbers kept inside the model', kept.toLocaleString('en-US'), 'Information capacity: model design'],
          ['Kept numbers per field number', `${formatNumber((kept / fieldNumbers) * 100, 1)} %`, 'Both, so the ratio changes when either changes'],
        ]}
      />
      <p className="text-ink-muted">
        Illustrative arithmetic for a made-up square domain with {VARIABLES} variables. It describes what the grid can store, not what any
        model has learned to predict.
      </p>
    </Panel>

    <p>
      Try this: set the cells per side to 64 and the width to 1 m, then change the width to 2 m. The array still has 64 × 64 entries,
      but <InlineMath>{String.raw`\Delta x`}</InlineMath> has doubled, so the shortest wave the grid can store is twice as long. A model that is not told the coordinates cannot tell these two
      situations apart.
    </p>

    <Disclosure label="Why is the shortest storable wavelength about two cells?">
      <p>
        A wave needs at least one sample near a crest and one near a trough to be recognised as a wave. A pattern that
        oscillates faster than that gives the same samples as a slower one, an ambiguity called aliasing.
      </p>
      <Eq>{String.raw`\lambda_{\min} = 2\,\Delta x, \qquad \text{equivalently } k_{\max} = \frac{\pi}{\Delta x}`}</Eq>
      <p className="text-ink-muted">
        This is a limit of the stored data. A model can fall short of it, and no model can recover detail the grid did not sample.
      </p>
    </Disclosure>
  </div>
}

// ---------------------------------------------------------------------------
// Bottleneck: keep only a few degrees of freedom
// ---------------------------------------------------------------------------

/** Adapt Cool Frog's ReconstructionDiagram without its model or palette dependencies. */
function ReconstructionDiagram() {
  return <Panel>
    <figure aria-label="An input field passes through an encoder, a learned bottleneck and a decoder to reconstruct the field at the same time. No bypass is shown.">
      <div className="grid items-center gap-3 text-center text-xs sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
        {[0, 1, 2].map((stage) => <Fragment key={stage}>
          {stage > 0 && <div className="text-ink-muted"><span className="block text-xl sm:-rotate-90" aria-hidden="true">↓</span>{stage === 1 ? 'Encoder' : 'Decoder'}</div>}
          <div className="space-y-2">
            <p className="font-medium">{['Input field · time t', 'Learned bottleneck', 'Reconstruction · time t'][stage]}</p>
            <svg viewBox="0 0 160 112" aria-hidden="true" className="mx-auto h-28 w-40 max-w-full" fill="none">
              {stage === 1 ? <g stroke="var(--ink-muted)" strokeWidth="1.5">
                {[0, 1, 2].map((layer) => <g key={layer} transform={`translate(${48 + layer * 9} ${36 - layer * 9})`}>
                  <rect width="48" height="48" fill="var(--surface)" />
                  <path d="M16 0v48M32 0v48M0 16h48M0 32h48" />
                </g>)}
              </g> : <>
                <g stroke="var(--ink-muted)">
                  <path d="M20 30h96v66H20zM20 30l24-18h96v66l-24 18M116 30l24-18M44 12v18M116 78h24" />
                  <path d="M44 30v66M68 30v66M92 30v66M20 52h96M20 74h96" strokeOpacity="0.3" />
                </g>
                <g stroke="var(--series-total)" strokeWidth="2">
                  <path d={stage === 0 ? 'M24 79C45 79 48 41 72 41S95 73 112 57' : 'M24 78C46 78 49 43 72 43S95 71 112 58'} />
                  <path d="M24 88C47 88 54 60 73 60S97 87 112 76" />
                </g>
              </>}
            </svg>
            <p className="text-ink-muted">{['One variable on a grid', 'Fewer positions, many feature channels', 'Original grid, approximate values'][stage]}</p>
          </div>
        </Fragment>)}
      </div>
      <figcaption className="mt-4 text-xs text-ink-muted">Schematic adapted from Cool Frog, not activations or measured values. In this no-skip autoencoder, all reconstruction information passes through the latent. Other architectures may include bypasses. The Fourier experiment below uses fixed wave coefficients instead of learned features.</figcaption>
    </figure>
  </Panel>
}

const N = 128
const MAX_MODES = 32
const TAU = 2 * Math.PI

/** Deterministic toy signal: three smooth waves plus one narrow bump, sampled on a periodic [0, 1) domain. */
const SIGNAL: number[] = Array.from({ length: N }, (_, i) => {
  const x = i / N
  const d = ((x - 0.62 + 0.5 + 1) % 1) - 0.5
  return Math.sin(TAU * x) + 0.5 * Math.sin(TAU * 3 * x + 0.6) + 0.3 * Math.sin(TAU * 7 * x + 1.9) + 0.9 * Math.exp(-((d / 0.025) ** 2))
})

/** Cosine and sine amplitudes of each Fourier mode, found by direct summation. */
const COS_AMP: number[] = []
const SIN_AMP: number[] = []
for (let k = 0; k <= MAX_MODES; k++) {
  let a = 0
  let b = 0
  for (let i = 0; i < N; i++) {
    a += SIGNAL[i] * Math.cos((TAU * k * i) / N)
    b += SIGNAL[i] * Math.sin((TAU * k * i) / N)
  }
  const scale = k === 0 ? 1 / N : 2 / N
  COS_AMP.push(a * scale)
  SIN_AMP.push(b * scale)
}
const AMPLITUDE = COS_AMP.map((a, k) => (k === 0 ? 0 : Math.hypot(a, SIN_AMP[k])))
const MAX_AMPLITUDE = Math.max(...AMPLITUDE)

/** RECONSTRUCTION[K] is the signal rebuilt from the mean and modes 1..K. */
const RECONSTRUCTION: number[][] = [Array.from({ length: N }, () => COS_AMP[0])]
for (let k = 1; k <= MAX_MODES; k++) {
  RECONSTRUCTION.push(RECONSTRUCTION[k - 1].map((value, i) =>
    value + COS_AMP[k] * Math.cos((TAU * k * i) / N) + SIN_AMP[k] * Math.sin((TAU * k * i) / N)))
}

/** One vertical range shared by both plots and every slider position, so curves stay comparable. */
const Y_MIN = Math.min(...SIGNAL, ...RECONSTRUCTION.flat()) - 0.2
const Y_MAX = Math.max(...SIGNAL, ...RECONSTRUCTION.flat()) + 0.2
const Y_TICKS = Array.from({ length: Math.floor(Y_MAX) - Math.ceil(Y_MIN) + 1 }, (_, i) => Math.ceil(Y_MIN) + i)

type Line = { values: number[]; className: string; dashed?: boolean }

function LinePlot({ title, desc, lines }: { title: string; desc: string; lines: Line[] }) {
  const titleId = useId()
  const descId = useId()
  const left = 30
  const right = 310
  const top = 8
  const bottom = 160
  const px = (i: number) => left + (i / N) * (right - left)
  const py = (v: number) => bottom - ((v - Y_MIN) / (Y_MAX - Y_MIN)) * (bottom - top)
  return <svg viewBox="0 0 320 190" role="img" aria-labelledby={`${titleId} ${descId}`} className="block w-full">
    <title id={titleId}>{title}</title>
    <desc id={descId}>{desc}</desc>
    {Y_TICKS.map((tick) => <g key={tick}>
      <line x1={left} x2={right} y1={py(tick)} y2={py(tick)} className="stroke-divider-soft" />
      <text x={left - 5} y={py(tick) + 3.5} textAnchor="end" fontSize={10} className="fill-ink-muted tabular-nums">{tick === 0 ? '0' : formatNumber(tick, 0)}</text>
    </g>)}
    <line x1={left} x2={left} y1={top} y2={bottom} className="stroke-divider" />
    {[0, 0.5, 1].map((tick) => <text key={tick} x={left + tick * (right - left)} y={bottom + 14} textAnchor="middle" fontSize={10} className="fill-ink-muted tabular-nums">{tick}</text>)}
    <text x={(left + right) / 2} y={184} textAnchor="middle" fontSize={10} className="fill-ink-muted">position (unitless toy domain)</text>
    {lines.map((line, index) => <path key={index} fill="none" strokeLinejoin="round" strokeLinecap="round"
      strokeWidth={line.dashed ? 1.5 : 2.25} strokeDasharray={line.dashed ? '4 3' : undefined} className={line.className}
      d={[...line.values, line.values[0]].map((v, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join('')} />)}
  </svg>
}

function ModeBars({ kept }: { kept: number }) {
  const titleId = useId()
  const descId = useId()
  const left = 30
  const width = 600
  const slot = width / MAX_MODES
  const base = 82
  const height = 66
  return <svg viewBox="0 0 640 120" role="img" aria-labelledby={`${titleId} ${descId}`} className="block w-full">
    <title id={titleId}>Strength of each wave pattern in the toy signal</title>
    <desc id={descId}>
      {`Bars for wave patterns 1 to ${MAX_MODES}, slowest first, on a linear amplitude scale. Solid bars are kept: ${kept === 0 ? 'none' : `patterns 1 to ${kept}`}. Dashed outlined bars are discarded. Heights show each pattern's amplitude in this particular toy signal.`}
    </desc>
    <line x1={left} x2={left + width} y1={base} y2={base} className="stroke-divider" />
    {Array.from({ length: MAX_MODES }, (_, index) => {
      const k = index + 1
      const h = (AMPLITUDE[k] / MAX_AMPLITUDE) * height
      const keep = k <= kept
      return <rect key={k} x={left + index * slot + 3} y={base - h} width={slot - 6} height={h}
        className={keep ? 'fill-series-total' : 'fill-none stroke-ink-subtle'} strokeWidth={1.25} strokeDasharray={keep ? undefined : '3 2'} />
    })}
    <line x1={left + kept * slot} x2={left + kept * slot} y1={6} y2={base + 4} strokeDasharray="2 3" strokeWidth={1.5} className="stroke-ink" />
    {[1, 8, 16, 24, 32].map((k) => <text key={k} x={left + (k - 0.5) * slot} y={base + 15} textAnchor="middle" fontSize={10} className="fill-ink-muted tabular-nums">{k}</text>)}
    <text x={left + width / 2} y={112} textAnchor="middle" fontSize={10} className="fill-ink-muted">wave pattern number (slow to fast), strength on a linear scale</text>
  </svg>
}

function describeKept(kept: number) {
  if (kept === 0) return 'Only the average survives, so the reconstruction is a flat line.'
  if (kept <= 3) return 'Only the broad, slow swells survive. The narrow bump is smeared into a gentle hump or missing.'
  if (kept <= 12) return 'The medium-sized waves are back, but the narrow bump is still too wide and surrounded by ripples.'
  if (kept < MAX_MODES) return 'Most of the bump has returned. What remains missing is the finest detail, which shows up as small wiggles.'
  return 'Almost everything in this toy signal is kept, so the two curves nearly coincide.'
}

export function BottleneckSection() {
  const [kept, setKept] = useState(4)
  const reconstruction = RECONSTRUCTION[kept]
  const numbers = 1 + 2 * kept
  return <div className={WRAP}>
    <p>
      Between reading the input and writing the output, many models squeeze the field through a <strong>bottleneck</strong>:
      a deliberately small set of numbers, often called a <em>latent representation</em>. The decoder rebuilds from what was kept.
    </p>
    <p>
      Compression pays twice. Processing a few hundred latent numbers is far cheaper than processing millions of grid values, and a small
      code forces the model to keep the structure that varies most across examples instead of memorising every cell. The price is that
      whatever the code drops cannot come back, and a small code alone does not guarantee a good reconstruction.
    </p>
    <ReconstructionDiagram />
    <p className="text-ink-muted">
      A learned model chooses its own features from data. To show only the effect of keeping few numbers, this demo uses a
      fixed compression instead: it keeps the first <InlineMath>K</InlineMath> Fourier modes (slow wave patterns) of one made-up signal and discards the
      faster ones.
    </p>

    <Panel className="space-y-4">
      <RangeField label="Retained Fourier modes K" value={kept} min={0} max={MAX_MODES} step={1} onChange={setKept} />
      <div className="grid gap-4 sm:grid-cols-2">
        <figure className="min-w-0">
          <LinePlot title="Original toy signal"
            desc="A smooth curve built from three waves plus one narrow bump near position 0.62. The bump is the sharpest feature."
            lines={[{ values: SIGNAL, className: 'stroke-series-total' }]} />
          <figcaption className={`${HEADING} text-center`}>Original, {N} samples</figcaption>
        </figure>
        <figure className="min-w-0">
          <LinePlot title="Reconstruction from retained modes"
            desc={`Solid curve: the signal rebuilt from the average and ${kept} wave pattern${kept === 1 ? '' : 's'}. Dashed curve: the original, for reference. ${describeKept(kept)}`}
            lines={[{ values: SIGNAL, className: 'stroke-ink-subtle', dashed: true }, { values: reconstruction, className: 'stroke-series-rotation' }]} />
          <figcaption className={`${HEADING} text-center`}>
            Reconstruction from {numbers} numbers <span className="font-normal text-ink-muted">(dashed: original)</span>
          </figcaption>
        </figure>
      </div>
      <Disclosure label="Which wave patterns are kept?">
      <figure>
        <ModeBars kept={kept} />
        <figcaption className="text-center text-ink-muted">
          Solid bars are kept, dashed outlines are discarded. The vertical dashed line is the cut-off.
        </figcaption>
      </figure>
      </Disclosure>
      <p aria-live="polite">
        <strong className="tabular-nums">{numbers}</strong> numbers kept out of {N} samples (the average, plus a cosine and a sine amplitude
        for each of {kept} mode{kept === 1 ? '' : 's'}). {describeKept(kept)}
      </p>
    </Panel>

    <p className="text-ink-muted">
      What this does not show: a learned bottleneck adapts its features to the problem, so it can spend its few numbers where a given
      family of fields varies most. The signal here is one-dimensional, noise-free and chosen by hand, and the ripples near the bump are a side effect of
      truncating this particular fixed set of waves.
    </p>
    <p className="text-xs text-ink-muted">
      Sources: autoencoder bottleneck idea, S1 ch. 14 §14.1; mode truncation in learned layers, S4 §3 to 4. This demo is our own toy, matching neither. Details below.
    </p>

    <Disclosure label="Why does dropping fast waves blur sharp features?">
      <p>
        A narrow bump is flat almost everywhere and rises sharply in one place. Built out of waves, that takes many fast ones, each
        added in exactly the right phase so they cancel away from the bump and reinforce at it. With only the slow waves
        kept, there is no way to cancel everywhere else, so the bump spreads out and gets ripples.
      </p>
    </Disclosure>

    <Disclosure label="How are the retained modes computed?">
      <p>
        The signal is sampled at <InlineMath>{String.raw`x_i = i/${N}`}</InlineMath>. Each mode <InlineMath>k</InlineMath> has a cosine and a sine amplitude found by summing the
        samples against that wave. The reconstruction adds back the modes up to <InlineMath>K</InlineMath>.
      </p>
      <Eq>{String.raw`\begin{aligned}
        a_k &= \frac{2}{${N}} \sum_i s_i \cos\frac{2\pi k i}{${N}} \\
        b_k &= \frac{2}{${N}} \sum_i s_i \sin\frac{2\pi k i}{${N}}
      \end{aligned}`}</Eq>
      <Eq>{String.raw`\hat{s}_i = a_0 + \sum_{k=1}^{K} \left[ a_k \cos\frac{2\pi k i}{${N}} + b_k \sin\frac{2\pi k i}{${N}} \right]`}</Eq>
      <p className="text-ink-muted">
        Here <InlineMath>{String.raw`a_0`}</InlineMath> is the plain average. The retained degrees of freedom are <InlineMath>{String.raw`1 + 2K`}</InlineMath>. The signal is
        evaluated from a fixed formula in your browser, with no data loaded.
      </p>
    </Disclosure>

    <Disclosure label="Source details (S1, S4)">
      <p id="src-bottleneck-s1">
        <strong>S1</strong>, textbook, 2016: Goodfellow, Bengio and Courville, <i>Deep Learning</i>, MIT Press, chapter 14 §14.1
        Undercomplete Autoencoders, pp. 499–501 (encoder, code, decoder, and how a small code limits capacity), with §14.2 on regularized alternatives.{' '}
        <a className="underline" href="https://www.deeplearningbook.org/contents/autoencoders.html" target="_blank" rel="noreferrer">deeplearningbook.org</a>, checked 2026-10-24.
      </p>
      <p id="src-bottleneck-s4" className="mt-2">
        <strong>S4</strong>, arXiv manuscript, 2020 (inspected HTML v3, 2021-05-17): Li et al., Fourier Neural Operator for Parametric Partial Differential Equations,
        §3 (lift, iterative processing, project) and §4 (kernel in Fourier space with truncated modes).{' '}
        <a className="underline" href="https://arxiv.org/abs/2010.08895" target="_blank" rel="noreferrer">arXiv:2010.08895</a>, checked 2026-10-24.
        Publication status beyond arXiv was not verified.
      </p>
      <p className="mt-2 text-ink-muted">
        Three different things share the idea of keeping few modes. This demo is a fixed toy Fourier truncation of our own signal.
        A learned autoencoder (S1) picks its features from data. A Fourier neural operator (S4) truncates modes inside learned layers on uniform grids.
        The sources do not show that this toy matches either, and they give no accuracy claims used here.
      </p>
    </Disclosure>
  </div>
}

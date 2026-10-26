import { Fragment, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type * as THREE from 'three'
import { InlineMath, Panel } from '../../components/ui'
import { Segmented, Slider } from '../../components/PlotControls'
import { useTheme } from '../../lib/theme'
import { colorAt, oklchCss, oklchHex, oklchToLinear, themeColors } from '../../lib/colors'
import type { Axis, ColorScale, Palette } from '../../lib/colors'
import { Scene, Voxels, boundsOf, dim, linearColor } from '../../components/Scene'
import type { Callout } from '../../components/Scene'

/** Adapt Cool Frog's tensor rearrangement, preserving each synthetic value across three layouts. */
type Stage = {
  title: string
  detail: string
  arrangement: 'volume' | 'crops' | 'batch'
  action: string
  explanation: string
}
const STAGES: Stage[] = [
  { title: 'Input', detail: 'Fields', arrangement: 'volume', action: 'Start with separate scalar fields', explanation: 'Each volume is one channel of one sample.' },
  { title: 'Cut into crops', detail: 'Split every axis', arrangement: 'crops', action: 'Separate the spatial crops', explanation: 'Same values, only moved apart.' },
  { title: 'Fold into batch', detail: 'C and crops join B', arrangement: 'batch', action: 'Give every crop its own batch entry', explanation: 'Each crop becomes an independent batch entry. No values change.' },
]

/* ---------- Toy tensor: one persistent element per input voxel ---------- */

const TOY_EDGE = 8
type Toy = { batch: number; channels: number; crop: number }
type Element = { b: number; c: number; u: number; v: number; w: number; i: number; j: number; k: number }
type Coordinate = 'b' | 'c' | 'u' | 'v' | 'w' | 'i' | 'j' | 'k'

function toyElements({ batch, channels, crop }: Toy): Element[] {
  const elements: Element[] = []
  for (let b = 0; b < batch; b++) for (let c = 0; c < channels; c++)
    for (let x = 0; x < TOY_EDGE; x++) for (let y = 0; y < TOY_EDGE; y++) for (let z = 0; z < TOY_EDGE; z++)
      elements.push({ b, c, u: Math.floor(x / crop), v: Math.floor(y / crop), w: Math.floor(z / crop), i: x % crop, j: y % crop, k: z % crop })
  return elements
}

const TOY_VALUE_SCALE: ColorScale = { colormap: 'sequential', range: [0, 1], log: false }
/** Toy field number `field` = b · C + c: a smooth blob whose center moves with the field. */
const toyValue = (field: number, x: number, y: number, z: number) => Math.exp(-(
  (x - 3.5 - 1.5 * Math.cos(2.4 * field)) ** 2 + (y - 3.5 - 1.5 * Math.sin(2.4 * field)) ** 2 + (z - 3.5 - Math.cos(1.3 * field)) ** 2) / 8)


/** Index of the element's crop within its field, the order `rearrange` flattens U, V, W in. */
const cropIndex = (element: Element, cropsPerAxis: number) => (element.u * cropsPerAxis + element.v) * cropsPerAxis + element.w


type Layout = { positions: Float32Array; scales: Float32Array }

function arrange(stage: Stage, toy: Toy, elements: Element[]): Layout {
  const { channels, crop } = toy
  const cropsPerAxis = TOY_EDGE / crop
  const positions = new Float32Array(elements.length * 3)
  const scales = new Float32Array(elements.length * 3).fill(0.86)
  elements.forEach((element, index) => {
    const { b, c, u, v, w, i, j, k } = element
    const field = b * channels + c
    if (stage.arrangement === 'batch') {
      positions.set([cropIndex(element, cropsPerAxis) * (crop + 1.5) + i, k + 0.43, field * (crop + 1.5) + j], index * 3)
    } else {
      const gap = stage.arrangement === 'crops' ? 1 : 0
      const width = TOY_EDGE + (cropsPerAxis - 1) * gap + 2
      positions.set([field * width + b * 2 + u * (crop + gap) + i, w * (crop + gap) + k, v * (crop + gap) + j], index * 3)
    }
  })
  return { positions, scales }
}

/* ---------- Shape notation ---------- */

type AxisSymbol = { text: string; axis: Axis; varies: Coordinate[] }
type Dimension = AxisSymbol[]

/** `H_X/4` renders as H with subscript X, then /4. */
function Notation({ text }: { text: string }) {
  const [, base, subscript, rest] = text.match(/^([^_]*)(?:_([A-Za-z]+))?(.*)$/)!
  return <>{base}{subscript && <sub>{subscript}</sub>}{rest}</>
}

function shapeOf(stage: Stage): Dimension[] {
  const symbol = (text: string, axis: Axis, varies: Coordinate[] = []): AxisSymbol => ({ text, axis, varies })
  const batch = symbol('B', 'batch', ['b'])
  const channel = symbol('C', 'channel', ['c'])
  const space = (['X', 'Y', 'Z'] as const).map((name, axis) => ({ name, crop: (['u', 'v', 'w'] as const)[axis], cell: (['i', 'j', 'k'] as const)[axis] }))
  const cropName = (name: string) => name.replace('X', 'U').replace('Y', 'V').replace('Z', 'W')
  const cropSpace = (name: string, cell: Coordinate) => symbol(`H_${name}`, 'spatial', [cell])
  if (stage.arrangement === 'volume') return [[batch], [channel], ...space.map(({ name, crop, cell }) => [symbol(name, 'spatial', [crop, cell])])]
  if (stage.arrangement === 'crops') return [[batch], [channel], ...space.map(({ name, crop, cell }) => [symbol(cropName(name), 'crop', [crop]), cropSpace(name, cell)])]
  return [[batch, channel, symbol('N', 'crop', ['u', 'v', 'w'])], [symbol('1', 'feature')], ...space.map(({ name, cell }) => [cropSpace(name, cell)])]
}

/** Size of one symbol in the toy tensor. */
function symbolValue(symbol: AxisSymbol, toy: Toy): number {
  const cropsPerAxis = TOY_EDGE / toy.crop
  if (symbol.text === 'B') return toy.batch
  if (symbol.text === 'C') return toy.channels
  if (symbol.text === 'N') return cropsPerAxis ** 3
  if ('UVW'.includes(symbol.text)) return cropsPerAxis
  if ('XYZ'.includes(symbol.text)) return cropsPerAxis * toy.crop
  if (symbol.text.startsWith('H_')) return toy.crop
  return Number(symbol.text)
}

/* ---------- Explorer: one toy tensor through every stage ---------- */

type Highlight = { varies: Coordinate[] } | undefined
/** An axis symbol held highlighted by click, valid on the stage it was chosen on. */
type Pin = { stage: number; text: string; varies: Coordinate[] }

/** Keep each voxel's original color while highlighting selected tensor axes. */
function elementColors(elements: Element[], toy: Toy, selected: number | undefined, highlight: Highlight, palette: Palette): Float32Array {
  const surface = oklchToLinear(palette.surface)
  const fixed: Coordinate[] = ['b', 'c', 'u', 'v', 'w', 'i', 'j', 'k']
  const anchor = selected === undefined ? undefined : elements[selected]
  const colors = new Float32Array(elements.length * 3)
  elements.forEach((element, index) => {
    const field = element.b * toy.channels + element.c
    let color: readonly number[] = linearColor(colorAt(toyValue(field, element.u * toy.crop + element.i, element.v * toy.crop + element.j, element.w * toy.crop + element.k), TOY_VALUE_SCALE))
    if (anchor) {
      const keep = highlight ? fixed.filter((name) => !highlight.varies.includes(name)) : fixed
      const matches = keep.every((name) => element[name] === anchor[name])
      if (!matches) color = dim(color, highlight ? 0.85 : 0.6, surface)
    }
    colors.set(color, index * 3)
  })
  return colors
}


/** Shape symbols with their toy sizes. Hovering or focusing a symbol highlights the cubes along its axis, clicking keeps it. */
function ShapeReadout({ stage, stageIndex, toy, pin, onHover, onPin }: {
  stage: Stage; stageIndex: number; toy: Toy; pin: Pin | undefined
  onHover: (highlight: Highlight) => void; onPin: (pin: Pin | undefined) => void
}) {
  const { theme } = useTheme()
  const palette = themeColors(theme)
  const shape = shapeOf(stage)
  const tuple = (render: (symbol: AxisSymbol) => ReactNode) => <>({shape.map((dimension, index) => <Fragment key={index}>{index > 0 && ', '}
    {dimension.map((symbol, part) => <Fragment key={part}>{part > 0 && '·'}{render(symbol)}</Fragment>)}</Fragment>)})</>
  return <div className="space-y-1">
    <p className="text-xs text-ink-muted">Shape of the toy tensor at this stage. Hover, focus or press an axis to highlight the cubes it runs along.</p>
    <p className="text-base tabular-nums">
      {tuple((symbol) => {
        const pinned = pin?.stage === stageIndex && pin.text === symbol.text
        return <button type="button" aria-pressed={pinned} aria-label={`Highlight axis ${symbol.text.replace('_', ' ')}, size ${symbolValue(symbol, toy)}`}
          style={{ color: oklchCss(palette.axes[symbol.axis]) }}
          className={`rounded px-px font-medium hover:bg-hover-strong ${pinned ? 'bg-hover-strong underline' : ''}`}
          onPointerEnter={() => onHover({ varies: symbol.varies })} onPointerLeave={() => onHover(undefined)}
          onFocus={() => onHover({ varies: symbol.varies })} onBlur={() => onHover(undefined)}
          onClick={() => onPin(pinned ? undefined : { stage: stageIndex, text: symbol.text, varies: symbol.varies })}><Notation text={symbol.text} /></button>
      })}
      <span className="text-ink-muted"> = {tuple((symbol) => symbolValue(symbol, toy))}</span>
    </p>
  </div>
}


const COUNT_OPTIONS = [1, 2, 3].map((value) => ({ value, label: String(value) }))


/** Text equivalent of the 3D scene at one stage. */
function sceneDescription(stage: Stage, toy: Toy): string {
  const { batch, channels, crop } = toy
  const fields = batch * channels
  const crops = (TOY_EDGE / crop) ** 3
  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`
  if (stage.arrangement === 'volume') return `${plural(fields, 'field')} of ${TOY_EDGE}×${TOY_EDGE}×${TOY_EDGE} values side by side, one cube per value.`
  if (stage.arrangement === 'crops') return `${plural(fields, 'field')}, each cut into ${plural(crops, 'crop')} of ${crop}×${crop}×${crop} values and pulled apart.`
  return `${plural(fields * crops, 'crop')} in the batch, each a ${crop}×${crop}×${crop} grid. Every original value is retained.`
}

const CUBE_HALF = 0.43

/**
 * Point on the bounding box of the matching elements' cubes in `layout`.
 *
 * - `top`: centre of the top face
 * - `corner`: lowest vertex, on the silhouette in the default view
 */
function groupAnchor(elements: Element[], layout: Layout, matches: (element: Element) => boolean, at: 'top' | 'corner'): THREE.Vector3Tuple {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  elements.forEach((element, index) => {
    if (!matches(element)) return
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], layout.positions[index * 3 + axis] - CUBE_HALF)
      max[axis] = Math.max(max[axis], layout.positions[index * 3 + axis] + CUBE_HALF)
    }
  })
  return at === 'top' ? [(min[0] + max[0]) / 2, max[1], (min[2] + max[2]) / 2] : [max[0], min[1], max[2]]
}

/** Name the shape symbols in the plot: samples, channels, crops and spatial extent of the current stage. */
function tensorCallouts(stage: Stage, toy: Toy, elements: Element[], layout: Layout, palette: Palette): Callout[] {
  const callout = (id: string, axis: Axis, symbol: string, word: string, anchor: THREE.Vector3Tuple): Callout => ({
    id, anchor, color: oklchCss(palette.axes[axis]),
    children: <><InlineMath>{String.raw`\textcolor{${oklchHex(palette.axes[axis])}}{${symbol}}`}</InlineMath><span className="max-sm:hidden"> {word}</span></>,
  })
  const firstField = (element: Element) => element.b === 0 && element.c === 0
  const isCrop = (element: Element, w: number) => element.u === 0 && element.v === 0 && element.w === w
  const firstCrop = (element: Element) => firstField(element) && isCrop(element, 0)
  const secondCrop = (element: Element) => firstField(element) && isCrop(element, 1)
  // Once cut, a sample or channel is anchored on its first crop, not on the centre of its scattered crops.
  const whole = (element: Element) => stage.arrangement === 'volume' || isCrop(element, 0)
  const callouts = [
    ...(toy.batch > 1 ? [callout('batch', 'batch', 'B', 'samples', groupAnchor(elements, layout, (element) => element.b === toy.batch - 1 && element.c === 0 && whole(element), 'top'))] : []),
    callout('channel', 'channel', 'C', 'channels', groupAnchor(elements, layout, (element) => element.b === 0 && element.c === toy.channels - 1 && whole(element), 'top')),
  ]
  if (stage.arrangement === 'volume') return [...callouts, callout('spatial', 'spatial', 'X, Y, Z', 'space', groupAnchor(elements, layout, firstField, 'corner'))]
  return [...callouts,
    callout('crop', 'crop', stage.arrangement === 'crops' ? 'U, V, W' : 'N', 'crops', groupAnchor(elements, layout, secondCrop, 'top')),
    callout('spatial', 'spatial', 'H', 'crop size', groupAnchor(elements, layout, firstCrop, 'corner'))]
}


export function TensorExample() {
  const { theme } = useTheme()
  const palette = themeColors(theme)
  const [counts, setCounts] = useState({ batch: 1, channels: 2 })
  const toy = useMemo<Toy>(() => ({ ...counts, crop: 4 }), [counts])
  const [position, setPosition] = useState(0)
  const [selected, setSelected] = useState<number | undefined>(undefined)
  const [hover, setHover] = useState<Highlight>(undefined)
  const [pin, setPin] = useState<Pin | undefined>(undefined)
  const elements = useMemo(() => toyElements(toy), [toy])
  const layouts = useMemo(() => STAGES.map((stage) => arrange(stage, toy, elements)), [toy, elements])
  const bounds = useMemo(() => boundsOf(layouts), [layouts])
  const stageIndex = position
  const stage = STAGES[position]
  const highlight = hover ?? (pin?.stage === stageIndex ? pin : undefined)
  const anchor = selected ?? (highlight ? 0 : undefined)
  const colors = useMemo(() => elementColors(elements, toy, anchor, highlight, palette), [elements, toy, anchor, highlight, palette])
  const goTo = (next: number) => {
    setPosition(next)
    setHover(undefined)
  }
  const updateCounts = (next: Partial<typeof counts>) => {
    setCounts({ ...counts, ...next })
    setSelected(undefined)
  }
  const description = sceneDescription(stage, toy)
  const callouts = useMemo(() => tensorCallouts(stage, toy, elements, layouts[position], palette), [stage, toy, elements, layouts, position, palette])
  return <Panel className="space-y-4 p-4">
    <p className="text-xs text-ink-muted"><strong className="font-medium text-ink">Synthetic data.</strong> A toy tensor of smooth blobs. These three steps only rearrange values, without learning or changing them.</p>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="max-w-2xl space-y-1">
        <p className="text-xs text-ink-muted">Rearrange · stage {position + 1} of {STAGES.length}</p>
        <h3 className="text-base font-medium">{stage.action}</h3>
        <p className="text-sm leading-relaxed text-ink-muted">{stage.explanation}</p>
      </div>
      <div className="flex gap-2">
        <button type="button" disabled={position === 0} onClick={() => goTo(position - 1)} className="rounded-lg bg-paper px-3 py-2 text-xs hover:bg-hover-strong disabled:opacity-40">← Previous</button>
        <button type="button" disabled={position === STAGES.length - 1} onClick={() => goTo(position + 1)} className="rounded-lg bg-ink px-3 py-2 text-xs text-paper disabled:opacity-40">Next →</button>
      </div>
    </div>
    <figure className="space-y-2">
      <Scene bounds={bounds} callouts={callouts} label={`Interactive 3D plot of a synthetic toy tensor, stage ${stage.title}. ${description} Callouts name ${callouts.map(({ id }) => id).join(', ')} in the shape colors.`}>
        <Voxels {...layouts[position]} colors={colors} onSelect={(index) => setSelected(index === selected ? undefined : index)} />
      </Scene>
      <figcaption className="text-xs text-ink-muted">
        {description} Colored = synthetic field value (viridis, 0 to 1).
      </figcaption>
    </figure>
    <ShapeReadout stage={stage} stageIndex={stageIndex} toy={toy} pin={pin} onHover={setHover} onPin={setPin} />
    <div className="space-y-1.5">
      <p className="text-xs"><span className="font-medium">{stage.title}</span> <span className="text-ink-muted">{stage.detail}</span></p>
      <Slider label="Stage" min={0} max={STAGES.length - 1} step={1} values={[position]} onChange={([next]) => goTo(next)} />
    </div>
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-xs">
      <span className="flex flex-wrap items-center gap-2">Samples (B) <Segmented label="Samples" value={counts.batch} onChange={(batch) => updateCounts({ batch })} options={COUNT_OPTIONS} /></span>
      <span className="flex flex-wrap items-center gap-2">Channels (C) <Segmented label="Channels per sample" value={counts.channels} onChange={(channels) => updateCounts({ channels })} options={COUNT_OPTIONS} /></span>
    </div>
  </Panel>
}

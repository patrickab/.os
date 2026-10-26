import { useMemo, useState } from 'react';
import * as THREE from 'three';
import { Disclosure, Eq, InlineMath, Panel } from '../../components/ui';
import { Segmented, Slider } from '../../components/PlotControls';
import { useTheme } from '../../lib/theme';
import { colorAt, oklchCss, oklchHex, oklchToLinear, themeColors } from '../../lib/colors';
import type { ColorScale } from '../../lib/colors';
import { HIDDEN_SCALE, Outline, Scene, Segments, Voxels, dim, linearColor } from '../../components/Scene';
import type { Callout } from '../../components/Scene';

/*
 * Adapted from Cool Frog's ConvolutionScene and AttentionScene (frontend/src/TensorScenes.tsx).
 * Everything below is synthetic: a hand-written kernel on a computed blob, and attention Q/K/V built from
 * closed-form angles. No data, no model, no learned weights. The numbers shown are the numbers the scenes use.
 */

const SYNTHETIC_NOTE = 'text-xs text-ink-muted';

/** CSS gradient that samples the same `colorAt` the 3D voxels use, so the legend is the plot's own scale. */
function scaleGradient(scale: ColorScale): string {
  const stops = Array.from({ length: 17 }, (_, index) => {
    const position = index / 16;
    const [r, g, b] = colorAt(scale.range[0] + (scale.range[1] - scale.range[0]) * position, scale);
    return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}) ${position * 100}%`;
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

function ScaleBar({ title, scale, low, high, mid }: { title: string; scale: ColorScale; low: string; high: string; mid?: string }) {
  return <div className="flex-1 space-y-1" style={{ minWidth: '9rem' }}>
    <p className="text-xs text-ink-muted">{title}</p>
    <div role="img" aria-label={`${title}: ${low} to ${high}${mid ? `, ${mid} in the middle` : ''}`}
      className="h-2.5 rounded-full ring-1 ring-divider-soft" style={{ background: scaleGradient(scale) }} />
    <div className="flex justify-between text-[11px] tabular-nums text-ink-muted" aria-hidden="true">
      <span>{low}</span>{mid && <span>{mid}</span>}<span>{high}</span>
    </div>
  </div>;
}

function Swatch({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5">
    <span aria-hidden="true" className="inline-block size-3 rounded-sm ring-1 ring-divider" style={{ background: color }} />{label}
  </span>;
}

/* ---------- Convolution: one kernel, from a 2D slice to a 3D volume to stride 2 ---------- */

const CONV_EDGE = 8;
const CONV_OFFSET = CONV_EDGE + 3;
const CONV_BOUNDS = new THREE.Box3(new THREE.Vector3(-1.5, -1.5, -1.5), new THREE.Vector3(CONV_OFFSET + CONV_EDGE - 0.5, CONV_EDGE + 0.5, CONV_EDGE + 0.5));
const CONV_STEPS = [{ value: 0, label: '1 · 2D kernel' }, { value: 1, label: '2 · Add depth' }, { value: 2, label: '3 · Stride 2' }];
const TOY_VALUE_SCALE: ColorScale = { colormap: 'sequential', range: [0, 1], log: false };
/** Toy input: a smooth blob, so the edge-detecting kernel has something to respond to. */
const convInput = (x: number, y: number, z: number) => Math.exp(-((x - 3.5) ** 2 + (y - 3.5) ** 2 + (z - 3.5) ** 2) / 6);
const SMOOTH = [1, 2, 1];
/** Toy kernel: change along x, smoothed along y and z (3D Sobel). The 2D step uses its dz = 0 slice. */
const convWeight = (dx: number, dy: number, dz: number) => dx * SMOOTH[dy + 1] * SMOOTH[dz + 1];
const convCoordinates = (index: number) => [Math.floor(index / CONV_EDGE ** 2), Math.floor(index / CONV_EDGE) % CONV_EDGE, index % CONV_EDGE];
const convIndex = ([x, y, z]: number[]) => (x * CONV_EDGE + y) * CONV_EDGE + z;
const inConvGrid = (...values: number[]) => values.every((value) => value >= 0 && value < CONV_EDGE);
const OFFSETS = [-1, 0, 1];
const CONV_DESCRIPTIONS = [
  'The same 9 weights slide over the slice: multiply, add, write one output. This kernel detects change along x, so the two sides of the blob get opposite signs.',
  'In 3D the kernel is 3 × 3 × 3, 27 weights per output.',
  'Stride 2 skips every second position, so each axis halves: 8³ → 4³. Real networks repeat this, shrinking the grid at every stage.',
];

/** Kernel output at `center`, zero padding outside the grid. */
function convOutput(center: number[], depth: boolean): number {
  let sum = 0;
  for (const dx of OFFSETS) for (const dy of OFFSETS) for (const dz of depth ? OFFSETS : [0]) {
    const [x, y, z] = [center[0] + dx, center[1] + dy, center[2] + dz];
    if (inConvGrid(x, y, z)) sum += convWeight(dx, dy, dz) * convInput(x, y, z);
  }
  return sum;
}

/** One 3 × 3 kernel slice: weight on top in `weightColor`, the input value it multiplies below, `pad` outside the grid. */
function KernelSlice({ center, dz, label, weightColor }: { center: number[]; dz: number; label: string; weightColor: string }) {
  return <div className="space-y-1">
    <p className="text-[11px] text-ink-muted">{label}</p>
    <div role="group" aria-label={`${label}: weight and input value for each kernel position, rows from y + 1 down to y − 1`} className="grid w-fit grid-cols-3 gap-1 tabular-nums">
      {[1, 0, -1].flatMap((dy) => OFFSETS.map((dx) => {
        const [x, y, z] = [center[0] + dx, center[1] + dy, center[2] + dz];
        const inside = inConvGrid(x, y, z);
        return <div key={`${dx},${dy}`} className="w-11 rounded-md bg-paper px-1 py-0.5 text-center leading-tight">
          <span className="block text-xs font-medium" style={{ color: weightColor }}>{convWeight(dx, dy, dz)}</span>
          <span className="block text-[10px] text-ink-muted">{inside ? convInput(x, y, z).toFixed(2) : 'pad'}</span>
        </div>;
      }))}
    </div>
  </div>;
}

/**
 * One toy kernel slid over a toy blob, in three user-driven steps on the same cubes.
 *
 * - 2D: one slice, a 3 × 3 kernel and the whole output feature map
 * - Depth: hidden layers grow out of the slice, the kernel becomes 3 × 3 × 3
 * - Stride 2: odd outputs vanish, the kept ones close up into a 4³ grid
 */
export function ConvolutionExample() {
  const { theme } = useTheme();
  const palette = themeColors(theme);
  const [step, setStep] = useState(0);
  const [center, setCenter] = useState([2, 4, 4]);
  const depth = step > 0;
  const strided = step === 2;
  const stride = strided ? 2 : 1;
  const changeStep = (next: number) => {
    if (next === 2) setCenter(center.map((value) => value - (value % 2)));
    setStep(next);
  };
  const select = (coordinates: number[]) => setCenter(coordinates.map((value, axis) =>
    axis === 2 && !depth ? center[2] : strided ? value - (value % 2) : value));
  const layout = useMemo(() => {
    const voxels = CONV_EDGE ** 3;
    const positions = new Float32Array(2 * voxels * 3);
    const scales = new Float32Array(positions.length);
    const colors = new Float32Array(positions.length);
    const outputs = Array.from({ length: voxels }, (_, index) => convOutput(convCoordinates(index), depth));
    const bound = Math.max(...outputs.map(Math.abs)) || 1;
    const outputScale: ColorScale = { colormap: 'diverging', range: [-bound, bound], log: false };
    for (let index = 0; index < voxels; index++) {
      const [x, y, z] = convCoordinates(index);
      const onSlice = z === center[2];
      const inKernel = Math.abs(x - center[0]) <= 1 && Math.abs(y - center[1]) <= 1 && (depth ? Math.abs(z - center[2]) <= 1 : onSlice);
      // Hidden layers wait on the shown slice, so adding depth grows them out of it. In 2D the kernel lifts toward the viewer
      positions.set([x, y, depth ? z : center[2] + (inKernel ? 0.35 : 0)], index * 3);
      scales.fill(depth ? (inKernel ? 0.86 : 0.26) : onSlice ? (inKernel ? 0.9 : 0.76) : HIDDEN_SCALE, index * 3, index * 3 + 3);
      colors.set(linearColor(colorAt(convInput(x, y, z), TOY_VALUE_SCALE)), index * 3);
      const output = voxels + index;
      const kept = !strided || (x % 2 === 0 && y % 2 === 0 && z % 2 === 0);
      const selected = x === center[0] && y === center[1] && z === center[2];
      positions.set(strided && kept ? [CONV_OFFSET + x / 2 + 2, y / 2 + 2, z / 2 + 2] : [CONV_OFFSET + x, y, depth ? z : center[2] + (selected ? 0.35 : 0)], output * 3);
      scales.fill(!kept || (!depth && !onSlice) ? HIDDEN_SCALE : selected ? 0.9 : !depth ? 0.76 : strided ? 0.5 : 0.26, output * 3, output * 3 + 3);
      colors.set(linearColor(colorAt(outputs[index], outputScale)), output * 3);
    }
    return { positions, scales, colors, value: outputs[convIndex(center)], bound };
  }, [center, depth, strided]);
  const kernelMin: THREE.Vector3Tuple = [center[0] - 1.5, center[1] - 1.5, center[2] + (depth ? -1.5 : -0.15)];
  const kernelMax: THREE.Vector3Tuple = [center[0] + 1.5, center[1] + 1.5, center[2] + (depth ? 1.5 : 0.85)];
  const outputPoint: THREE.Vector3Tuple = strided ? [CONV_OFFSET + center[0] / 2 + 2, center[1] / 2 + 2, center[2] / 2 + 2] : [CONV_OFFSET + center[0], center[1], center[2] + (depth ? 0 : 0.35)];
  const reads = OFFSETS.flatMap((dx) => OFFSETS.flatMap((dy) => (depth ? OFFSETS : [0]).map((dz) => inConvGrid(center[0] + dx, center[1] + dy, center[2] + dz))));
  const padded = reads.filter((inside) => !inside).length;
  const outputEdge = CONV_EDGE / stride;
  const outputIndex = center.map((value) => value / stride);
  const axes = depth ? ['x', 'y', 'z'] : ['x', 'y'];
  const bound = layout.bound.toFixed(2);
  // One color per symbol, shared by outline, link, callout, kernel table and formula.
  const symbolColors = { weight: palette.axes.crop, output: palette.axes.feature };
  const colored = (role: keyof typeof symbolColors, tex: string) => String.raw`\textcolor{${oklchHex(symbolColors[role])}}{${tex}}`;
  const weightCss = oklchCss(symbolColors.weight);
  const callouts: Callout[] = [
    { id: 'kernel', anchor: [kernelMin[0], kernelMax[1], center[2]], color: weightCss, children: <><InlineMath>{colored('weight', 'w_o')}</InlineMath><span className="max-sm:hidden"> kernel</span></> },
    { id: 'input', anchor: [-0.5, -0.5, depth ? CONV_EDGE - 0.5 : center[2]], color: oklchCss(palette.outline), children: <><InlineMath>x</InlineMath><span className="max-sm:hidden"> input</span></> },
    { id: 'output', anchor: [outputPoint[0], outputPoint[1] + 0.55, outputPoint[2]], color: oklchCss(symbolColors.output), children: <><InlineMath>{colored('output', 'y_p')}</InlineMath><span className="max-sm:hidden"> output</span></> },
  ];
  const kernelSet = depth ? String.raw`\{-1,0,1\}^3` : String.raw`\{-1,0,1\}^2`;
  return <Panel className="space-y-4">
    <p className={SYNTHETIC_NOTE}>Synthetic: a fixed toy kernel (3D Sobel: change along x, smoothed along y and z) on a computed Gaussian blob in an 8³ grid. Nothing is learned and no data is loaded.</p>
    <Segmented label="Convolution step" value={step} onChange={changeStep} options={CONV_STEPS} />
    <p className="max-w-3xl text-sm leading-relaxed">{CONV_DESCRIPTIONS[step]}</p>
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(15rem,1fr)]">
      <figure className="min-w-0 space-y-3">
        <div className={`grid gap-3 ${depth ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
          {axes.map((axis, index) => <div key={axis} className="space-y-1.5">
            <p className="text-xs tabular-nums">Output {axis} = {outputIndex[index]} <span className="text-ink-muted">(input {axis} = {center[index]})</span></p>
            <Slider label={`Convolution output ${axis}`} min={0} max={outputEdge - 1} step={1} values={[outputIndex[index]]}
              onChange={([next]) => setCenter(center.map((value, coordinate) => coordinate === index ? next * stride : value))} />
          </div>)}
        </div>
        <Scene bounds={CONV_BOUNDS} height={400} callouts={callouts} label={`Toy convolution. Left: input x, ${depth ? `${CONV_EDGE}³ volume` : 'slice'} colored by value, kernel w outlined in orange at (${center.join(', ')}). Right: output ${depth ? `${outputEdge}³ volume` : 'feature map'}, the selected output y_p outlined in purple and linked to its kernel.`}>
          <Voxels positions={layout.positions} scales={layout.scales} colors={layout.colors}
            onSelect={(index) => select(convCoordinates(index % CONV_EDGE ** 3))} />
          <Outline min={kernelMin} max={kernelMax} color={oklchToLinear(symbolColors.weight)} />
          <Outline min={outputPoint.map((value) => value - 0.55) as THREE.Vector3Tuple} max={outputPoint.map((value) => value + 0.55) as THREE.Vector3Tuple} color={oklchToLinear(symbolColors.output)} />
          <Segments points={[...center, ...outputPoint]} opacity={0.8} color={oklchToLinear(symbolColors.output)} />
        </Scene>
        <div className="space-y-2" aria-label="Live convolution formula">
          <p className="text-xs text-ink-muted">Output <InlineMath>{`${colored('output', 'p')}=(${outputIndex.slice(0, axes.length).join(',')})`}</InlineMath> · stride <InlineMath>{`s=${stride}`}</InlineMath> · kernel offsets <InlineMath>{`o\\in K=${kernelSet}`}</InlineMath></p>
          <Eq>{String.raw`${colored('output', 'y_p')} = \sum_{o\in K} ${colored('weight', 'w_o')}\,x_{s p+o} \qquad\approx ${layout.value.toFixed(3)}`}</Eq>
        </div>
        <figcaption className="space-y-2">
          <span className="block text-xs text-ink-muted">Left: input. Right: output. Click a cube or use the sliders to move the kernel; drag to orbit.</span>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <ScaleBar title="Input value (toy blob)" scale={TOY_VALUE_SCALE} low="0" high="1" />
            <ScaleBar title="Output value (kernel sum)" scale={{ colormap: 'diverging', range: [-layout.bound, layout.bound], log: false }} low={`−${bound}`} mid="0" high={`+${bound}`} />
          </div>
          <span className="block text-xs text-ink-muted">The output scale is symmetric around 0 and is set by the largest absolute output in the current step: blue negative, red positive.</span>
        </figcaption>
      </figure>
      <div className="space-y-3 text-sm">
        <p className="text-xs text-ink-muted"><InlineMath>{colored('weight', 'w_o')}</InlineMath> weight on top, the input <InlineMath>{String.raw`x_{sp+o}`}</InlineMath> it multiplies below</p>
        <div className="flex flex-wrap gap-3">
          {(depth ? [-1, 0, 1] : [0]).map((dz) => <KernelSlice key={dz} center={center} dz={dz} weightColor={weightCss} label={depth ? `Slice z ${dz < 0 ? '− 1' : dz > 0 ? '+ 1' : '(centre)'}` : 'Kernel'} />)}
        </div>
        <p className="text-xs text-ink-muted tabular-nums" aria-live="polite">Sum of all {reads.length} products: {layout.value.toFixed(8)}</p>
        {padded > 0 && <p className="text-xs text-ink-muted tabular-nums">{padded} inputs outside the grid count as 0 (zero padding)</p>}
      </div>
    </div>
  </Panel>;
}

/* ---------- Window attention ---------- */

const WINDOW = 4;
const HEADS = 4;
const ATTENTION_LEVELS = [16, 8, 4];
const ATTENTION_EDGE = 16;
const attentionIndex = ([x, y, z]: readonly number[]) => (x * ATTENTION_EDGE + y) * ATTENTION_EDGE + z;
const ATTENTION_COORDINATES: THREE.Vector3Tuple[] = Array.from({ length: ATTENTION_EDGE ** 3 }, (_, index) =>
  [Math.floor(index / ATTENTION_EDGE ** 2), Math.floor(index / ATTENTION_EDGE) % ATTENTION_EDGE, index % ATTENTION_EDGE]);
const ATTENTION_STEPS = [
  { value: 0, label: '1 · A 2D window' }, { value: 1, label: '2 · Add depth' }, { value: 2, label: '3 · Windows in a grid' },
];
const WEIGHT_DIM = 0.65;

/** The same query and window expand from a planar teaching example into spatial attention. */
export function AttentionExample() {
  const { theme } = useTheme();
  const palette = themeColors(theme);
  const [step, setStep] = useState(0);
  const [edge, setEdge] = useState(8);
  const [query, setQuery] = useState<THREE.Vector3Tuple>([0, 3, 0]);
  const [head, setHead] = useState(0);
  const [rank, setRank] = useState(0);
  const [qx, qy, qz] = query;
  const token = attentionIndex(query);
  const start = query.map((value) => Math.floor(value / WINDOW) * WINDOW);
  const [sx, sy, sz] = start;
  const plane = step === 0;
  const wholeGrid = step === 2;
  const data = useMemo(() => {
    const baseAngle = ([x, y, z]: readonly number[]) => x * 0.83 + y * 1.37 + z * 0.59;
    // Unit two-component features, distinct query/key rotations and a toy position bias.
    const queryAngle = baseAngle([qx, qy, qz]) + 0.65 + head * 0.45;
    const q = [Math.cos(queryAngle), Math.sin(queryAngle)];
    const partners = [];
    for (let x = sx; x < sx + WINDOW; x++) for (let y = sy; y < sy + WINDOW; y++)
      for (let z = sz; z < sz + WINDOW; z++) {
        if (plane && z !== qz) continue;
        const coordinate: THREE.Vector3Tuple = [x, y, z];
        const index = attentionIndex(coordinate);
        const angle = baseAngle(coordinate);
        const keyAngle = angle - head * 0.3;
        const cosine = q[0] * Math.cos(keyAngle) + q[1] * Math.sin(keyAngle);
        const bias = 0.12 * Math.cos((x - qx) - 0.7 * (y - qy) + 0.5 * (z - qz));
        const logit = 2 * cosine + bias;
        partners.push({ index, coordinate, logit, score: Math.exp(logit), value: Math.sin(angle + 0.4) });
      }
    const total = partners.reduce((sum, partner) => sum + partner.score, 0);
    const weighted = partners.map((partner) => ({ ...partner, weight: partner.score / total }));
    const strongest = [...weighted].sort((a, b) => b.weight - a.weight).slice(0, 4);
    return {
      partners: weighted, strongest,
      weightSum: weighted.reduce((sum, partner) => sum + partner.weight, 0),
      result: weighted.reduce((sum, partner) => sum + partner.weight * partner.value, 0),
    };
  }, [qx, qy, qz, sx, sy, sz, plane, head]);
  const layout = useMemo(() => {
    const positions = new Float32Array(ATTENTION_COORDINATES.length * 3);
    const scales = new Float32Array(positions.length);
    ATTENTION_COORDINATES.forEach(([x, y, z], index) => {
      const inWindow = x >= sx && x < sx + WINDOW && y >= sy && y < sy + WINDOW && z >= sz && z < sz + WINDOW;
      const visible = x < edge && y < edge && z < edge && (wholeGrid || inWindow) && (!plane || z === qz);
      // Hidden layers start on the query plane and unfold without replacing instances.
      positions.set([x - 1.5, y - 1.5, (plane ? qz : z) - 1.5], index * 3);
      scales.fill(!visible ? HIDDEN_SCALE : index === token ? 0.62 : inWindow ? 0.38 : 0.12, index * 3, index * 3 + 3);
    });
    return { positions, scales };
  }, [edge, wholeGrid, plane, qz, sx, sy, sz, token]);
  const colors = useMemo(() => {
    const colors = new Float32Array(ATTENTION_COORDINATES.length * 3);
    const weights = new Map(data.partners.map((partner) => [partner.index, partner.weight]));
    const surface = oklchToLinear(palette.surface);
    const ink = oklchToLinear(palette.ink);
    const queryColor = oklchToLinear(palette.axes.crop);
    const featureColor = oklchToLinear(palette.axes.feature);
    const outsideColor = dim(ink, 0.82, surface);
    const maxWeight = data.strongest[0].weight;
    for (let index = 0; index < ATTENTION_COORDINATES.length; index++) {
      const weight = weights.get(index);
      colors.set(index === token ? queryColor : weight !== undefined ? dim(featureColor, WEIGHT_DIM * (1 - weight / maxWeight), surface) : outsideColor, index * 3);
    }
    return colors;
  }, [data, token, palette]);
  // Keep the camera fixed while the plane unfolds, weights change or the query moves.
  const bounds = useMemo(() => {
    const min = wholeGrid ? [-2, -2, -2] : [sx - 2, sy - 2, sz - 2];
    const max = wholeGrid ? [edge - 1, edge - 1, edge - 1] : [sx + 3, sy + 3, sz + 3];
    return new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max));
  }, [wholeGrid, edge, sx, sy, sz]);
  const point = (coordinate: readonly number[]) => coordinate.map((value) => value - 1.5) as THREE.Vector3Tuple;
  const selected = data.strongest[rank];
  const selectedPoint = point(selected.coordinate);
  const querySubscript = `(${query.join(',')})`;
  const partnerSubscript = `(${selected.coordinate.join(',')})`;
  const queryPoint = point(query);
  const selectToken = (index: number) => {
    const coordinate = ATTENTION_COORDINATES[index];
    if (coordinate.every((value) => value < edge) && layout.scales[index * 3] > HIDDEN_SCALE) setQuery(coordinate);
  };
  const featureCss = oklchCss(palette.axes.feature);
  const surfaceCss = oklchCss(palette.surface);
  // Same linear-space mix toward the surface that `dim` applies to the voxels.
  const partnerCss = (dimming: number) => `color-mix(in srgb-linear, ${featureCss} ${100 * (1 - dimming)}%, ${surfaceCss})`;
  // One color per symbol, shared by cube, outline, link, callout and formula.
  const symbolColors = { query: palette.axes.crop, partner: palette.axes.batch, weight: palette.axes.feature };
  const colored = (role: keyof typeof symbolColors, tex: string) => String.raw`\textcolor{${oklchHex(symbolColors[role])}}{${tex}}`;
  const self = selected.index === token;
  // Right edge midpoint of the window outline, on the silhouette in the default view.
  const windowEdge: THREE.Vector3Tuple = [sx + 1.95, sy, plane ? qz - 1.5 : sz - 1.95];
  const callouts: Callout[] = [
    { id: 'query', anchor: queryPoint, color: oklchCss(symbolColors.query), children: <><InlineMath>{self ? `${colored('query', 'q_r')}, ${colored('partner', 'k_i, v_i')}` : colored('query', 'q_r')}</InlineMath><span className="max-sm:hidden"> {self ? 'query = partner' : 'query'}</span></> },
    ...(self ? [] : [{ id: 'partner', anchor: selectedPoint, color: oklchCss(symbolColors.partner), children: <><InlineMath>{colored('partner', 'k_i, v_i')}</InlineMath><span className="max-sm:hidden"> partner</span></> }]),
    { id: 'window', anchor: windowEdge, color: oklchCss(palette.outline), children: <><InlineMath>W(r)</InlineMath><span className="max-sm:hidden"> window</span></> },
  ];
  return <Panel className="space-y-4">
    <p className={SYNTHETIC_NOTE}>Synthetic illustration, not learned attention. Only points in the query’s window contribute.</p>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Segmented label="Attention illustration" value={step} onChange={setStep} options={ATTENTION_STEPS} />
      {wholeGrid && <Segmented label="Attention stage grid" value={edge} onChange={(next) => {
        setEdge(next);
        setQuery(query.map((value) => Math.min(value, next - 1)) as THREE.Vector3Tuple);
      }} options={ATTENTION_LEVELS.map((value) => ({ value, label: `${value}³ grid` }))} />}
    </div>
    <p className="max-w-3xl text-sm leading-relaxed">{plane
      ? 'Start with one query and its 4 × 4 window. Compare, weight, then mix the 16 values.'
      : wholeGrid ? `The ${edge}³ grid is divided into 4³ windows. ${edge === 4 ? 'One window covers the whole grid.' : 'The outlined window contributes 64 values. The muted context does not contribute.'}`
        : 'Add depth: the same operation now mixes 64 values in a 4 × 4 × 4 window.'}</p>
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(15rem,1fr)]">
      <figure className="min-w-0 space-y-3">
        <div className="grid grid-cols-3 gap-3">
          {(['x', 'y', 'z'] as const).map((axis, index) => <div key={axis} className="space-y-1.5">
            <p className="text-xs tabular-nums">{plane && axis === 'z' ? 'Slice' : 'Query'} {axis} = {query[index]}</p>
            <Slider label={`Attention query ${axis}`} min={wholeGrid ? 0 : start[index]} max={wholeGrid ? edge - 1 : start[index] + WINDOW - 1} step={1} values={[query[index]]}
              onChange={([value]) => setQuery(query.map((current, coordinate) => coordinate === index ? value : current) as THREE.Vector3Tuple)} />
          </div>)}
        </div>
        <Scene bounds={bounds} height={360} callouts={callouts} label={`Query q_r at (${query.join(', ')}) is orange. Selected partner k_i, v_i at (${selected.coordinate.join(', ')}) is outlined in blue. W(r) is the outlined active window. ${data.partners.length} partners including itself contribute. Four strongest links are shown, with partner ${rank + 1} emphasized. ${wholeGrid ? 'Other windows are muted and do not contribute.' : plane ? 'A planar teaching example.' : 'The same window expanded in depth.'}`}>
          <Voxels {...layout} colors={colors} onSelect={selectToken} />
          {wholeGrid && edge > WINDOW && <Outline min={[-1.95, -1.95, -1.95]} max={[edge - 1.05, edge - 1.05, edge - 1.05]} opacity={0.2} />}
          <Outline min={[sx - 1.95, sy - 1.95, (plane ? qz : sz) - 1.95]}
            max={[sx + 1.95, sy + 1.95, plane ? qz - 1.05 : sz + 1.95]} opacity={0.65} />
          <Outline min={queryPoint.map((value) => value - 0.4) as THREE.Vector3Tuple} max={queryPoint.map((value) => value + 0.4) as THREE.Vector3Tuple} color={oklchToLinear(symbolColors.query)} />
          <Outline min={selectedPoint.map((value) => value - 0.3) as THREE.Vector3Tuple} max={selectedPoint.map((value) => value + 0.3) as THREE.Vector3Tuple} color={oklchToLinear(symbolColors.partner)} />
          {data.strongest.map((partner, index) => <Segments key={partner.index} points={[...queryPoint, ...point(partner.coordinate)]}
            opacity={index === rank ? 0.95 : 0.2} color={index === rank ? oklchToLinear(symbolColors.partner) : undefined} />)}
        </Scene>
        <div className="space-y-2" aria-label="Live attention formula">
          <p className="text-xs text-ink-muted">Query <InlineMath>{`${colored('query', 'r')}=${querySubscript}`}</InlineMath> · selected partner <InlineMath>{`${colored('partner', 'i')}=${partnerSubscript}`}</InlineMath></p>
          <Eq>{String.raw`\begin{aligned}s_{r,i} &= 2\,${colored('query', 'q_r')}^\top ${colored('partner', 'k_i')} + b_{r,i} &&\approx ${selected.logit.toFixed(3)} \\[0.6em] ${colored('weight', 'a_{r,i}')} &= \frac{e^{s_{r,i}}}{\sum_{j\in W(r)}e^{s_{r,j}}} &&\approx ${selected.weight.toFixed(3)} \\[0.6em] y_r &= \sum_{j\in W(r)} ${colored('weight', 'a_{r,j}')}\,v_j &&\approx ${data.result.toFixed(3)}\end{aligned}`}</Eq>
        </div>
        <figcaption className="space-y-2 text-xs text-ink-muted">
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            <Swatch color={oklchCss(symbolColors.query)} label="Query" />
            <Swatch color={partnerCss(0)} label="More weight" />
            <Swatch color={partnerCss(WEIGHT_DIM)} label="Less weight" />
            {wholeGrid && edge > WINDOW && <Swatch color={`color-mix(in srgb-linear, ${oklchCss(palette.ink)} 18%, ${surfaceCss})`} label="Outside the window" />}
          </div>
          <p>Drag to orbit.</p>
        </figcaption>
      </figure>
      <div className="space-y-5 text-sm">
        <section className="space-y-2">
          <h3 className="font-medium">1. Select a query</h3>
          <p className="text-xs leading-relaxed text-ink-muted">Move the highlighted cell with the sliders or click a cube. Its query is compared with the keys inside the outlined window.</p>
        </section>
        <section className="space-y-2">
          <h3 className="font-medium">2. Give matching keys more weight</h3>
          <p className="text-xs leading-relaxed text-ink-muted"><InlineMath>{colored('query', 'q_r')}</InlineMath> is the query at coordinate <InlineMath>r</InlineMath>, <InlineMath>{colored('partner', 'k_i')}</InlineMath> the selected partner’s key, and <InlineMath>{String.raw`b_{r,i}`}</InlineMath> their position bias. Softmax turns scores <InlineMath>{String.raw`s_{r,i}`}</InlineMath> into weights <InlineMath>{colored('weight', 'a_{r,i}')}</InlineMath> over the query’s window <InlineMath>W(r)</InlineMath>.</p>
          <p className="text-xs text-ink-muted">This toy uses scale 2. Standard scaled dot-product attention uses <InlineMath>{String.raw`1/\sqrt{d_k}`}</InlineMath>, where <InlineMath>d_k</InlineMath> is the key dimension.</p>
          <p className="text-xs text-ink-muted">Four strongest partners. Select a row to follow its link.</p>
          <div className="space-y-0.5" role="group" aria-label="Strongest attention partners">
            {data.strongest.map((partner, index) => <button key={partner.index} type="button" aria-pressed={rank === index} onClick={() => setRank(index)}
              className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-xs tabular-nums ${rank === index ? 'bg-hover-strong font-medium text-ink' : 'text-ink-muted hover:bg-hover hover:text-ink'}`}>
              <span>#{index + 1} · ({partner.coordinate.join(', ')}){partner.index === token ? ' · self' : ''}</span>
              <span>{(100 * partner.weight).toFixed(1)}%</span>
            </button>)}
          </div>
          <p className="text-xs text-ink-muted" aria-live="polite">All {data.partners.length} weights sum to 1. Only four links are drawn.</p>
        </section>
        <section className="space-y-2 border-t border-divider-soft pt-4">
          <h3 className="font-medium">3. Mix the values</h3>
          <p className="text-xs leading-relaxed text-ink-muted">Each partner contributes its value multiplied by its weight, including those without a drawn link.</p>
          <p className="text-xs text-ink-muted">Selected partner’s contribution · weight × value</p>
          <p className="tabular-nums" aria-live="polite"><InlineMath>{String.raw`${colored('weight', 'a_{r,i}')}${colored('partner', 'v_i')} = ${selected.weight.toFixed(4)}\times(${selected.value.toFixed(3)}) \approx ${(selected.weight * selected.value).toFixed(4)}`}</InlineMath></p>
          <p className="text-xs text-ink-muted"><InlineMath>{colored('partner', 'v_i')}</InlineMath> is this partner’s value. The live formula beneath the plot sums every contribution to produce the query’s new value <InlineMath>y_r</InlineMath>.</p>
        </section>
      </div>
    </div>
    <Disclosure label={`Compare attention heads · head ${head + 1} of ${HEADS}`}>
      <p className="max-w-3xl text-sm text-ink-muted">Different heads can give the same partners different weights. Move the slider and watch the links and output change. These four heads use illustrative rotations, not learned projections.</p>
      <div className="max-w-xs space-y-1.5">
        <p className="text-xs tabular-nums">Head {head + 1} of {HEADS}</p>
        <Slider label="Attention head" min={0} max={HEADS - 1} step={1} values={[head]} onChange={([next]) => setHead(next)} />
      </div>
    </Disclosure>
    <Disclosure label="Numerical details and synthetic construction">
      <p className="text-xs tabular-nums" aria-live="polite">Sum of weights: {data.weightSum.toFixed(6)} · output: {data.result.toFixed(8)} (rounded).</p>
      <p className="text-xs text-ink-muted">Color is relative to the strongest weight, not an absolute probability scale. The lowest-weight color is mixed {Math.round(100 * WEIGHT_DIM)}% toward the background.</p>
      <Disclosure label="Synthetic vectors and source">
        <p className="text-xs text-ink-muted">Adapted from Cool Frog’s AttentionScene. No model or dataset is loaded. For a point at (x, y, z), let θ = 0.83x + 1.37y + 0.59z and h be the zero-based head.</p>
        <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-ink-muted">
          <li>Query: unit vector at angle θ(query) + 0.65 + 0.45h.</li>
          <li>Key: unit vector at angle θ − 0.3h.</li>
          <li>Score s = 2 cos(query angle − key angle) + 0.12 cos(Δx − 0.7Δy + 0.5Δz).</li>
          <li>Value v = sin(θ + 0.4). All {data.partners.length} partners participate, including the query itself.</li>
        </ul>
      </Disclosure>
    </Disclosure>
  </Panel>;
}

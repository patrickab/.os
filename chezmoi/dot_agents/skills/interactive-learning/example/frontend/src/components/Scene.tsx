/** 3D voxel scene with orbit, outlines, links and formula callouts, adapted from Cool Frog's `TensorScenes.tsx`. Lazy-load content that uses it. */
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { Component, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useTheme } from '../lib/theme'
import { oklchToLinear, themeColors } from '../lib/colors'

/** Scale at or below which an instance stands for "not shown" and is ignored when framing. */
export const HIDDEN_SCALE = 1e-3

const MATRIX = new THREE.Matrix4()
const COLOR = new THREE.Color()
const VIEW_DIRECTION = new THREE.Vector3(0.9, 1, 1.5).normalize()
const TRANSITION_MS = 700
const SCENE_CAMERA = { near: 1, far: 4000, position: [0, 0, 1000] as THREE.Vector3Tuple }

/** Mix a linear color toward the surface, 0 keeps it, 1 is the surface. */
export const dim = (color: readonly number[], amount: number, surface: readonly number[]) => color.map((component, index) => component + (surface[index] - component) * amount)

/** 8-bit sRGB to the linear working space of three.js. */
export const linearColor = (rgb: readonly number[]) => COLOR.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace).toArray()


const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Instanced cubes. Position and scale changes animate so every element can be followed, unless the user prefers reduced motion. Colors switch at once. */
export function Voxels({ positions, scales, colors, onHover, onSelect }: {
  positions: Float32Array; scales: Float32Array; colors: Float32Array
  onHover?: (index: number | undefined) => void; onSelect?: (index: number) => void
}) {
  const count = positions.length / 3
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  useEffect(() => () => geometry.dispose(), [geometry])
  const mesh = useRef<THREE.InstancedMesh>(null)
  const invalidate = useThree((state) => state.invalidate)
  const shown = useRef<{ positions: Float32Array; scales: Float32Array } | null>(null)
  const transition = useRef<{ positions: Float32Array; scales: Float32Array; start: number } | null>(null)
  const write = (shownPositions: Float32Array, shownScales: Float32Array) => {
    const instances = mesh.current!
    for (let index = 0; index < count; index++) {
      MATRIX.makeScale(shownScales[index * 3], shownScales[index * 3 + 1], shownScales[index * 3 + 2])
      MATRIX.setPosition(shownPositions[index * 3], shownPositions[index * 3 + 1], shownPositions[index * 3 + 2])
      instances.setMatrixAt(index, MATRIX)
    }
    instances.instanceMatrix.needsUpdate = true
    instances.boundingSphere = null
    instances.boundingBox = null
  }
  useLayoutEffect(() => {
    if (!shown.current || shown.current.positions.length !== positions.length || reducedMotion()) {
      shown.current = { positions: positions.slice(), scales: scales.slice() }
      transition.current = null
      write(positions, scales)
    } else {
      transition.current = { positions: shown.current.positions.slice(), scales: shown.current.scales.slice(), start: performance.now() }
    }
    invalidate()
  }, [positions, scales]) // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const instances = mesh.current!
    for (let index = 0; index < count; index++) instances.setColorAt(index, COLOR.setRGB(colors[index * 3], colors[index * 3 + 1], colors[index * 3 + 2]))
    instances.instanceColor!.needsUpdate = true
    invalidate()
  }, [colors, count, invalidate])
  useFrame(() => {
    const from = transition.current
    if (!from || !shown.current) return
    const progress = Math.min(1, (performance.now() - from.start) / TRANSITION_MS)
    const eased = progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2
    for (let index = 0; index < positions.length; index++) {
      shown.current.positions[index] = from.positions[index] + (positions[index] - from.positions[index]) * eased
      shown.current.scales[index] = from.scales[index] + (scales[index] - from.scales[index]) * eased
    }
    write(shown.current.positions, shown.current.scales)
    if (progress < 1) invalidate()
    else transition.current = null
  })
  const hover = (event: ThreeEvent<PointerEvent>) => { event.stopPropagation(); onHover?.(event.instanceId) }
  return <instancedMesh key={count} ref={mesh} args={[geometry, undefined, count]}
    onPointerMove={onHover && hover} onPointerOut={onHover && (() => onHover(undefined))}
    onClick={onSelect && ((event) => { event.stopPropagation(); if (event.instanceId !== undefined) onSelect(event.instanceId) })}>
    <meshLambertMaterial />
  </instancedMesh>
}

/** Line color: an explicit linear color, else the theme's ink. */
function useLineColor(color?: readonly number[]) {
  const { theme } = useTheme()
  const ink = themeColors(theme).ink
  const key = color?.join(',')
  return useMemo(() => new THREE.Color(...(color ?? oklchToLinear(ink))), [key, ink]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** Box outline from `min` to `max` corner, in ink unless `color` (linear RGB) is given. */
export function Outline({ min, max, opacity = 1, color }: { min: THREE.Vector3Tuple; max: THREE.Vector3Tuple; opacity?: number; color?: readonly number[] }) {
  const lineColor = useLineColor(color)
  const geometry = useMemo(() => {
    const box = new THREE.BoxGeometry(1, 1, 1)
    const edges = new THREE.EdgesGeometry(box)
    box.dispose()
    return edges
  }, [])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <lineSegments geometry={geometry} position={min.map((value, axis) => (value + max[axis]) / 2) as THREE.Vector3Tuple}
    scale={min.map((value, axis) => max[axis] - value) as THREE.Vector3Tuple}>
    <lineBasicMaterial color={lineColor} transparent={opacity < 1} opacity={opacity} />
  </lineSegments>
}

/** Straight segments between consecutive point pairs, in ink unless `color` (linear RGB) is given. */
export function Segments({ points, opacity = 1, color }: { points: number[]; opacity?: number; color?: readonly number[] }) {
  const lineColor = useLineColor(color)
  const geometry = useMemo(() => new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3)), [points])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <lineSegments geometry={geometry} renderOrder={1}>
    <lineBasicMaterial color={lineColor} transparent opacity={opacity} depthTest={false} />
  </lineSegments>
}

/** Annotation placed in the scene's side gutter, tied to `anchor` by a leader line in `color` (CSS). */
export type Callout = { id: string; anchor: THREE.Vector3Tuple; color: string; children: ReactNode }

const CALLOUT_INSET = 8
const CALLOUT_GAP = 6

type PlacedCallout = { box: HTMLElement; leader: SVGLineElement; dot: SVGCircleElement; anchor: THREE.Vector3Tuple; left: boolean; edgeX: number; edgeY: number }

/**
 * Place callouts beside the plot and keep their leader lines on the anchors.
 *
 * - Boxes are placed only when anchors, bounds, size or box sizes change, so orbiting never moves them
 * - Each box goes beside the projected `bounds` on its anchor's side, stacked without overlap
 * - Leaders follow the anchors every rendered frame. Styles are written directly, without React renders
 */
function CalloutLayout({ callouts, bounds, overlay }: { callouts: Callout[]; bounds: THREE.Box3; overlay: RefObject<HTMLDivElement | null> }) {
  const invalidate = useThree((state) => state.invalidate)
  const projected = useMemo(() => new THREE.Vector3(), [])
  const layout = useRef<{ key: string; placed: PlacedCallout[] }>({ key: '', placed: [] })
  useEffect(() => invalidate(), [callouts, invalidate])
  useFrame(({ camera, size }) => {
    const root = overlay.current
    if (!root) return
    // Orbit controls move the camera after the last render, so refresh its matrices before projecting.
    camera.updateMatrixWorld()
    const toScreen = (point: THREE.Vector3Tuple) => {
      projected.set(...point).project(camera)
      return [(projected.x + 1) / 2 * size.width, (1 - projected.y) / 2 * size.height]
    }
    const elements = callouts.map(({ id, anchor }) => ({
      anchor,
      box: root.querySelector<HTMLElement>(`[data-callout="${id}"]`)!,
      leader: root.querySelector<SVGLineElement>(`[data-leader="${id}"]`)!,
      dot: root.querySelector<SVGCircleElement>(`[data-dot="${id}"]`)!,
    }))
    if (elements.some(({ box, leader, dot }) => !box || !leader || !dot)) return
    const key = [size.width, size.height, ...bounds.min.toArray(), ...bounds.max.toArray(),
      ...elements.flatMap(({ anchor, box }) => [...anchor, box.offsetWidth, box.offsetHeight])].join(',')
    if (layout.current.key !== key) layout.current = { key, placed: placeCallouts(elements, bounds, size, toScreen) }
    for (const { leader, dot, anchor, edgeX, edgeY } of layout.current.placed) {
      const [x, y] = toScreen(anchor)
      leader.setAttribute('x1', String(edgeX))
      leader.setAttribute('y1', String(edgeY))
      leader.setAttribute('x2', String(x))
      leader.setAttribute('y2', String(y))
      dot.setAttribute('cx', String(x))
      dot.setAttribute('cy', String(y))
    }
  })
  return null
}

/** Stack callout boxes in the gutters beside the projected bounds, each near its anchor's height. */
function placeCallouts(
  elements: { anchor: THREE.Vector3Tuple; box: HTMLElement; leader: SVGLineElement; dot: SVGCircleElement }[],
  bounds: THREE.Box3, size: { width: number; height: number }, toScreen: (point: THREE.Vector3Tuple) => number[],
): PlacedCallout[] {
  const cornersX = Array.from({ length: 8 }, (_, corner) => toScreen([
    corner & 1 ? bounds.max.x : bounds.min.x, corner & 2 ? bounds.max.y : bounds.min.y, corner & 4 ? bounds.max.z : bounds.min.z])[0])
  const boundsLeft = Math.min(...cornersX)
  const boundsRight = Math.max(...cornersX)
  const items = elements.map((element) => {
    const [x, y] = toScreen(element.anchor)
    return { ...element, y, width: element.box.offsetWidth, height: element.box.offsetHeight, left: x < (boundsLeft + boundsRight) / 2, top: 0 }
  })
  for (const left of [true, false]) {
    const side = items.filter((item) => item.left === left).sort((a, b) => a.y - b.y)
    let next = CALLOUT_INSET
    for (const item of side) {
      item.top = Math.max(next, item.y - item.height / 2)
      next = item.top + item.height + CALLOUT_GAP
    }
    let limit = size.height - CALLOUT_INSET
    for (const item of side.reverse()) {
      item.top = Math.max(CALLOUT_INSET, Math.min(item.top, limit - item.height))
      limit = item.top - CALLOUT_GAP
    }
  }
  return items.map(({ box, leader, dot, anchor, width, height, left, top }) => {
    const boxLeft = left ? Math.max(CALLOUT_INSET, boundsLeft - width) : Math.min(size.width - CALLOUT_INSET - width, boundsRight)
    box.style.transform = `translate(${boxLeft}px, ${top}px)`
    box.style.visibility = 'visible'
    return { box, leader, dot, anchor, left, edgeX: left ? boxLeft + width : boxLeft, edgeY: top + height / 2 }
  })
}

/** Leader lines and callout boxes over the canvas. Decorative: the scene label carries the same meaning. */
function CalloutOverlay({ callouts, overlay }: { callouts: Callout[]; overlay: RefObject<HTMLDivElement | null> }) {
  return <div ref={overlay} aria-hidden="true" className="pointer-events-none absolute inset-0">
    <svg className="absolute inset-0 h-full w-full overflow-visible">
      {callouts.map(({ id, color }) => <g key={id} stroke={color} fill={color}>
        <line data-leader={id} strokeWidth={1.25} strokeOpacity={0.8} />
        <circle data-dot={id} r={2.5} stroke="none" />
      </g>)}
    </svg>
    {callouts.map(({ id, color, children }) => <div key={id} data-callout={id} style={{ borderColor: color, visibility: 'hidden' }}
      className="absolute top-0 left-0 rounded-md border-l-2 bg-surface/90 px-2 py-1 text-xs whitespace-nowrap text-ink-muted shadow-sm">
      {children}
    </div>)}
  </div>
}

/** Fit the source scene's fixed orthographic view to its bounds. */
function Fit({ bounds }: { bounds: THREE.Box3 }) {
  const { camera, size, controls, invalidate } = useThree()
  useLayoutEffect(() => {
    if (!size.width || !size.height) return
    const center = bounds.getCenter(new THREE.Vector3())
    camera.position.copy(center).addScaledVector(VIEW_DIRECTION, 1000)
    camera.lookAt(center)
    camera.updateMatrixWorld()
    const centerView = center.clone().applyMatrix4(camera.matrixWorldInverse)
    let halfWidth = 1
    let halfHeight = 1
    for (let corner = 0; corner < 8; corner++) {
      const point = new THREE.Vector3(corner & 1 ? bounds.max.x : bounds.min.x, corner & 2 ? bounds.max.y : bounds.min.y, corner & 4 ? bounds.max.z : bounds.min.z)
        .applyMatrix4(camera.matrixWorldInverse)
      halfWidth = Math.max(halfWidth, Math.abs(point.x - centerView.x))
      halfHeight = Math.max(halfHeight, Math.abs(point.y - centerView.y))
    }
    const ortho = camera as THREE.OrthographicCamera
    ortho.zoom = 0.94 * Math.min(size.width / (2 * halfWidth), size.height / (2 * halfHeight))
    camera.updateProjectionMatrix()
    const orbit = controls as unknown as { target: THREE.Vector3; update: () => void } | null
    orbit?.target.copy(center)
    orbit?.update()
    invalidate()
  }, [bounds, camera, size.width, size.height, controls, invalidate])
  return null
}

/** Source orbit controls, without intercepting page scroll for zoom. */
function Orbit() {
  const { camera, gl, invalidate, set } = useThree()
  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement)
    controls.enableZoom = false
    controls.enablePan = false
    gl.domElement.style.touchAction = 'pan-y'
    controls.addEventListener('change', () => invalidate())
    set({ controls })
    return () => { controls.dispose(); set({ controls: null }) }
  }, [camera, gl, invalidate, set])
  return null
}

function Unavailable({ height, detail }: { height: number; detail: string }) {
  return <div role="alert" style={{ minHeight: `min(${height}px, 70svh)` }}
    className="flex items-center justify-center rounded-lg bg-paper p-6 text-center text-sm text-ink-muted ring-1 ring-divider-soft">
    <p className="max-w-md">The 3D plot is unavailable: {detail} Nothing is drawn in its place. The text around this plot still describes what it shows.</p>
  </div>
}

class SceneBoundary extends Component<{ height: number; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <Unavailable height={this.props.height} detail="the browser could not start WebGL rendering." /> : this.props.children
  }
}

let webgl: boolean | undefined
/** Whether this browser can create a WebGL context, checked once. */
function webglAvailable(): boolean {
  if (webgl === undefined) {
    try {
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
      webgl = context !== null
      context?.getExtension('WEBGL_lose_context')?.loseContext()
    } catch {
      webgl = false
    }
  }
  return webgl
}

function SceneView({ bounds, label, height, callouts, children }: { bounds: THREE.Box3; label: string; height: number; callouts: Callout[]; children: ReactNode }) {
  const { theme } = useTheme()
  const background = useMemo(() => oklchToLinear(themeColors(theme).surface), [theme])
  const overlay = useRef<HTMLDivElement>(null)
  return <div role="img" aria-label={label} className="relative cursor-grab overflow-hidden rounded-lg active:cursor-grabbing" style={{ height: `min(${height}px, 70svh)` }}>
    <Canvas orthographic frameloop="demand" dpr={[1, 2]} camera={SCENE_CAMERA} gl={{ antialias: true }}>
      <color attach="background" args={background} />
      <ambientLight intensity={2.1} />
      <directionalLight position={[3, 10, 6]} intensity={1.4} />
      {children}
      <Orbit />
      <Fit bounds={bounds} />
      {callouts.length > 0 && <CalloutLayout callouts={callouts} bounds={bounds} overlay={overlay} />}
    </Canvas>
    {callouts.length > 0 && <CalloutOverlay callouts={callouts} overlay={overlay} />}
  </div>
}

/** Source canvas with theme colors, optional gutter callouts and a visible WebGL failure state. */
export function Scene({ bounds, label, height = 380, callouts = [], children }: {
  bounds: THREE.Box3; label: string; height?: number; callouts?: Callout[]; children: ReactNode
}) {
  if (!webglAvailable()) return <Unavailable height={height} detail="this browser cannot create a WebGL context." />
  return <SceneBoundary height={height}><SceneView bounds={bounds} label={label} height={height} callouts={callouts}>{children}</SceneView></SceneBoundary>
}

/** Box enclosing every visible instance (scale above `HIDDEN_SCALE`) of the layouts. */
export function boundsOf(layouts: { positions: Float32Array; scales: Float32Array }[]): THREE.Box3 {
  const box = new THREE.Box3()
  const point = new THREE.Vector3()
  for (const { positions, scales } of layouts)
    for (let index = 0; index < positions.length; index += 3) {
      if (scales[index] <= HIDDEN_SCALE) continue
      for (const sign of [-0.5, 0.5]) box.expandByPoint(point.set(
        positions[index] + sign * scales[index], positions[index + 1] + sign * scales[index + 1], positions[index + 2] + sign * scales[index + 2]))
    }
  return box
}

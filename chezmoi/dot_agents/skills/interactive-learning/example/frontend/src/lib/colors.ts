/** Theme palette, series colors and colormaps for plots, adapted from Cool Frog's `colormap.ts`. */

type Rgb = readonly [number, number, number]
type Range = readonly [min: number, max: number]

/**
 * Perceptually ordered colormaps, 9 stops sampled from matplotlib.
 *
 * - `sequential`: viridis, monotonic lightness, colorblind-safe
 * - `diverging`: RdBu reversed, light at 0, blue negative, red positive
 * - `magnitude`: Reds, light at 0, for nonnegative values
 */
export type Colormap = 'sequential' | 'diverging' | 'magnitude'
const COLORMAPS: Record<Colormap, readonly Rgb[]> = {
  sequential: [[68, 1, 84], [71, 45, 123], [59, 82, 139], [44, 114, 142], [33, 145, 140], [40, 174, 128], [94, 201, 98], [173, 220, 48], [253, 231, 37]],
  diverging: [[5, 48, 97], [42, 113, 178], [107, 172, 209], [194, 221, 236], [247, 246, 246], [251, 204, 180], [228, 128, 102], [186, 40, 50], [103, 0, 31]],
  magnitude: [[255, 245, 240], [254, 224, 210], [252, 187, 161], [252, 146, 114], [251, 105, 74], [238, 58, 44], [202, 24, 29], [163, 15, 21], [103, 0, 13]],
}

/** Colormap over `range`, `log` maps log10 of the value, values outside `range` clip to the end colors. */
export type ColorScale = { colormap: Colormap; range: Range; log: boolean }

/** Position of `value` on `scale` in [0, 1], clipped. */
function scalePosition(value: number, { range, log }: ColorScale): number {
  const transform = log ? (input: number) => Math.log10(Math.max(input, Number.MIN_VALUE)) : (input: number) => input
  const low = transform(range[0])
  const span = transform(range[1]) - low
  // A zero-width range would divide by zero, widen it.
  const width = span === 0 ? Math.max(Math.abs(low) * 0.01, 1) : span
  return Math.max(0, Math.min(1, (transform(value) - low) / width))
}

/** 8-bit sRGB color of `value` on `scale`. */
export function colorAt(value: number, scale: ColorScale): Rgb {
  const stops = COLORMAPS[scale.colormap]
  const position = scalePosition(value, scale) * (stops.length - 1)
  const index = Math.min(Math.floor(position), stops.length - 2)
  const fraction = position - index
  return stops[index].map((component, axis) => Math.round(component + (stops[index + 1][axis] - component) * fraction)) as unknown as Rgb
}

/** Tensor axis kinds of the shape notation, one fixed color each in formulas and 3D scenes. */
export type Axis = 'batch' | 'channel' | 'crop' | 'spatial' | 'feature'
type Oklch = readonly [number, number, number]
/** Renderer colors of one theme. */
export type Palette = { surface: Oklch; ink: Oklch; solid: Oklch; outline: Oklch; axes: Record<Axis, Oklch> }

/** Match Cool Frog's renderer palette and tensor axis colors. */
const THEME_COLORS: Record<'light' | 'dark', Palette> = {
  light: {
    surface: [0.975, 0.012, 85], ink: [0.3, 0.012, 85], solid: [0.84, 0.012, 85], outline: [0.72, 0.008, 85],
    axes: { batch: [0.5, 0.13, 255], channel: [0.5, 0.12, 150], crop: [0.52, 0.12, 55], spatial: [0.42, 0.015, 85], feature: [0.5, 0.15, 320] },
  },
  dark: {
    surface: [0.235, 0.008, 85], ink: [0.92, 0.012, 85], solid: [0.44, 0.008, 85], outline: [0.55, 0.008, 85],
    axes: { batch: [0.76, 0.10, 255], channel: [0.76, 0.10, 150], crop: [0.78, 0.10, 55], spatial: [0.78, 0.015, 85], feature: [0.76, 0.12, 320] },
  },
}

export const themeColors = (theme: 'light' | 'dark') => THEME_COLORS[theme]

export const oklchCss = ([lightness, chroma, hue]: readonly number[]) => `oklch(${lightness} ${chroma} ${hue})`

/** OKLCH to linear sRGB in [0, 1], the working color space of three.js. */
export function oklchToLinear([lightness, chroma, hue]: readonly number[]): [number, number, number] {
  const a = chroma * Math.cos((hue * Math.PI) / 180)
  const b = chroma * Math.sin((hue * Math.PI) / 180)
  const long = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const medium = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const short = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ].map((component) => Math.min(1, Math.max(0, component))) as [number, number, number]
}

/** OKLCH to `#rrggbb`, the color form KaTeX's `\textcolor` accepts. */
export function oklchHex(color: readonly number[]): string {
  const encode = (linear: number) => linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055
  return `#${oklchToLinear(color).map((component) => Math.round(255 * encode(component)).toString(16).padStart(2, '0')).join('')}`
}

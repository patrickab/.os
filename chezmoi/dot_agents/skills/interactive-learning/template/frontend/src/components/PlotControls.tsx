import { useId } from 'react'

/** Cool Frog's native radio group and segmented-control styling. */
export function Segmented<T extends string | number>({ label, value, options, onChange }: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  const name = useId()
  return <fieldset className="inline-flex max-w-full flex-wrap rounded-xl bg-hover-strong p-1">
    <legend className="sr-only">{label}</legend>
    {options.map((option) => <label key={option.value} className="cursor-pointer">
      <input type="radio" name={name} className="peer sr-only" checked={option.value === value} onChange={() => onChange(option.value)} />
      <span className="block rounded-lg px-3 py-1 text-xs text-ink-muted transition peer-checked:bg-surface-elevated peer-checked:text-ink peer-checked:shadow-[var(--shadow-sm)] peer-focus-visible:ring-2 peer-focus-visible:ring-divider hover:text-ink">{option.label}</span>
    </label>)}
  </fieldset>
}

/** Cool Frog's single-coordinate slider. */
export function Slider({ label, min, max, step = 1, values, onChange }: {
  label: string
  min: number
  max: number
  step?: number
  values: number[]
  onChange: (values: number[]) => void
}) {
  const fill = (values[0] - min) / (max - min || 1) * 100
  return <div className="relative h-4">
    <div className="absolute inset-x-2 top-1/2 h-1 -translate-y-1/2 rounded-full bg-hover-strong">
      <div className="absolute h-full rounded-full bg-ink" style={{ right: `${100 - fill}%` }} />
    </div>
    <input type="range" className="slider" min={min} max={max} step={step} value={values[0]} aria-label={label} onChange={(event) => onChange([+event.target.value])} />
  </div>
}

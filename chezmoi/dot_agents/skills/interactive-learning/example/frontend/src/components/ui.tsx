import { useId, useMemo } from 'react'
import type { ReactNode } from 'react'
import katex from 'katex'
import { formatNumber } from '../lib/format'

/** Subheading above a group of related controls or facts. Use `h3` below a section heading. */
export const HEADING = 'text-sm font-semibold tracking-tight text-ink'

/** Container for a meaningful experiment or aside. Plain prose stays outside panels. */
export function Panel({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`min-w-0 rounded-2xl bg-surface p-4 shadow-[var(--shadow-sm),var(--inner-highlight)] ${className}`}>{children}</div>
}

/** Native `details` with a rotating chevron. Keyboard and screen readers work without script. */
export function Disclosure({ label, defaultOpen, className = '', children }: {
  label: string; defaultOpen?: boolean; className?: string; children: ReactNode
}) {
  return <details open={defaultOpen} className={`group rounded-xl bg-paper text-sm ${className}`}>
    <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2 text-ink-muted transition hover:bg-hover hover:text-ink [&::-webkit-details-marker]:hidden">
      <span aria-hidden="true" className="inline-block transition group-open:rotate-90">›</span>
      {label}
    </summary>
    <div className="space-y-3 px-3 pt-1 pb-3">{children}</div>
  </details>
}


/** Labeled single-thumb slider with a numeric readout. */
export function RangeField({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void
}) {
  const id = useId()
  const fill = ((value - min) / (max - min)) * 100
  return <div>
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <label htmlFor={id}>{label}</label>
      <output htmlFor={id} className="tabular-nums text-ink-muted">{formatNumber(value, step >= 1 ? 0 : 2)}</output>
    </div>
    <div className="relative mt-1 h-6">
      <div className="absolute inset-x-2.5 top-1/2 h-1 -translate-y-1/2 rounded-full bg-hover-strong">
        <div className="absolute h-full rounded-full bg-ink" style={{ right: `${100 - fill}%` }} />
      </div>
      <input id={id} type="range" className="slider" min={min} max={max} step={step} value={value} onChange={(event) => onChange(+event.target.value)} />
    </div>
  </div>
}

export function Button({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick}
    className="rounded-xl bg-hover-strong px-3 py-1.5 text-xs text-ink transition hover:bg-divider">{children}</button>
}

/** Render authored TeX with accessible MathML, never trusted source HTML. */
function Typeset({ children, display = false }: { children: string; display?: boolean }) {
  const result = useMemo(() => {
    try {
      return {
        html: katex.renderToString(children, {
          displayMode: display,
          output: 'htmlAndMathml',
          trust: false,
          strict: 'error',
          throwOnError: true,
        }),
        error: null,
      }
    } catch (error) {
      return { html: '', error: error instanceof Error ? error.message : String(error) }
    }
  }, [children, display])

  if (result.error) return <span role="alert" className="text-danger">
    Invalid equation: <code>{children}</code><span className="sr-only"> {result.error}</span>
  </span>

  return <span className={display ? undefined : 'math-inline'} dangerouslySetInnerHTML={{ __html: result.html }} />
}

/** Typeset a display equation with keyboard-accessible overflow on narrow screens. */
export function Eq({ children }: { children: string }) {
  return <div className="math-display rounded-xl bg-paper px-4 py-3 text-ink" role="group" aria-label="Equation" tabIndex={0}>
    <Typeset display>{children}</Typeset>
  </div>
}

/** Typeset a compact expression inside prose, without dollar-sign delimiters. */
export function InlineMath({ children }: { children: string }) {
  return <Typeset>{children}</Typeset>
}

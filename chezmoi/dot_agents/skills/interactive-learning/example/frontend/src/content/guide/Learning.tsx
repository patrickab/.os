import { Fragment, useMemo, useState } from 'react'
import { Disclosure, Eq, HEADING, InlineMath, Panel, RangeField } from '../../components/ui'
import { formatNumber } from '../../lib/format'

/* ---------- shared helpers ---------- */

/** Single-choice button group. Buttons, not a native select, so every option stays visible. */
function Choice<T extends string | number>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void
}) {
  return <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
    {options.map((option) => {
      const selected = option.value === value
      return <button key={option.value} type="button" aria-pressed={selected} onClick={() => onChange(option.value)}
        className={`rounded-xl px-3 py-1.5 text-xs transition ${selected ? 'bg-ink text-paper' : 'bg-hover-strong text-ink hover:bg-divider'}`}>
        {option.label}
      </button>
    })}
  </div>
}

const PROSE = 'space-y-4 text-sm leading-relaxed [&>p]:max-w-3xl [&>details]:max-w-3xl'

/* ---------- ObjectiveSection ---------- */

const N_POINTS = 41
const XS = Array.from({ length: N_POINTS }, (_, i) => i / (N_POINTS - 1))
const PEAK_LO = 0.4
const PEAK_HI = 0.6
const inPeak = (x: number) => x >= PEAK_LO - 1e-9 && x <= PEAK_HI + 1e-9

const bump = (x: number, width: number) => Math.exp(-((x - 0.5) ** 2) / (2 * width ** 2))
/** Hand-built one-dimensional "field": one sharp feature on a gentle background. */
const TARGET = XS.map((x) => 0.15 * x + bump(x, 0.08))
/** Prediction 1: right overall shape, but the feature is too wide and too low. */
const SMOOTH = XS.map((x) => 0.15 * x + 0.62 * bump(x, 0.13))
const RIPPLE = XS.map((x) => Math.sin(2 * Math.PI * 7 * x))

const rms = (values: number[]) => Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / values.length)
/** Ripple amplitude chosen so both predictions have exactly the same unweighted RMS error. */
const RIPPLE_AMPLITUDE = rms(SMOOTH.map((v, i) => v - TARGET[i])) / rms(RIPPLE)
/** Prediction 2: the feature is the right size, but the field carries small oscillations everywhere. */
const RIPPLY = TARGET.map((v, i) => v + RIPPLE_AMPLITUDE * RIPPLE[i])

/** Weighted RMS error divided by the weighted RMS of the target, so it has no units. */
function normalizedError(prediction: number[], peakWeight: number) {
  let top = 0
  let bottom = 0
  let weights = 0
  XS.forEach((x, i) => {
    const w = inPeak(x) ? peakWeight : 1
    top += w * (prediction[i] - TARGET[i]) ** 2
    bottom += w * TARGET[i] ** 2
    weights += w
  })
  return Math.sqrt(top / weights) / Math.sqrt(bottom / weights)
}

const PLOT = { w: 320, h: 150, left: 26, right: 8, top: 10, bottom: 22, lo: -0.3, hi: 1.3 }
const px = (x: number) => PLOT.left + x * (PLOT.w - PLOT.left - PLOT.right)
const py = (y: number) => PLOT.top + (1 - (y - PLOT.lo) / (PLOT.hi - PLOT.lo)) * (PLOT.h - PLOT.top - PLOT.bottom)
const path = (values: number[]) => values.map((v, i) => `${i ? 'L' : 'M'}${px(XS[i]).toFixed(1)} ${py(v).toFixed(1)}`).join(' ')

function ProfilePlot({ prediction, label }: { prediction: number[]; label: string }) {
  return <svg viewBox={`0 0 ${PLOT.w} ${PLOT.h}`} role="img" aria-label={label} className="block h-auto w-full">
    <title>{label}</title>
    <rect x={px(PEAK_LO)} y={PLOT.top} width={px(PEAK_HI) - px(PEAK_LO)} height={PLOT.h - PLOT.top - PLOT.bottom} className="fill-hover-strong" />
    <text x={px(0.5)} y={PLOT.top + 9} textAnchor="middle" className="fill-ink-muted" fontSize="9">weighted region</text>
    <line x1={PLOT.left} x2={PLOT.w - PLOT.right} y1={py(0)} y2={py(0)} className="stroke-ink-faint" strokeWidth="1" />
    <path d={path(TARGET)} fill="none" stroke="var(--series-total)" strokeWidth="2.5" />
    <path d={path(prediction)} fill="none" stroke="var(--series-rotation)" strokeWidth="2" strokeDasharray="5 3" />
    <text x={PLOT.left} y={PLOT.h - 6} className="fill-ink-muted" fontSize="9">position along a line through the domain</text>
    <text x={PLOT.left - 4} y={py(1)} textAnchor="end" dominantBaseline="middle" className="fill-ink-muted" fontSize="9">1</text>
    <text x={PLOT.left - 4} y={py(0)} textAnchor="end" dominantBaseline="middle" className="fill-ink-muted" fontSize="9">0</text>
  </svg>
}

function ProfileCase({ title, caption, prediction, peakWeight }: {
  title: string; caption: string; prediction: number[]; peakWeight: number
}) {
  const peak = Math.max(...prediction)
  return <div className="min-w-0">
    <h3 className={HEADING}>{title}</h3>
    <ProfilePlot prediction={prediction} label={`${title}. Solid line: target. Dashed line: prediction. ${caption}`} />
    <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 text-xs tabular-nums">
      <dt className="text-ink-muted">Normalized error, current weighting</dt>
      <dd className="text-right">{formatNumber(normalizedError(prediction, peakWeight))}</dd>
      <dt className="text-ink-muted">Normalized error, equal weighting</dt>
      <dd className="text-right">{formatNumber(normalizedError(prediction, 1))}</dd>
      <dt className="text-ink-muted">Largest predicted value</dt>
      <dd className="text-right">{formatNumber(peak)} (target {formatNumber(Math.max(...TARGET))})</dd>
    </dl>
    <p className="mt-1 text-xs text-ink-muted">{caption}</p>
  </div>
}

export function ObjectiveSection() {
  const [peakWeight, setPeakWeight] = useState(1)
  const smooth = normalizedError(SMOOTH, peakWeight)
  const ripply = normalizedError(RIPPLY, peakWeight)
  const verdict = Math.abs(smooth - ripply) < 0.005
    ? 'The two predictions score the same.'
    : `${smooth < ripply ? 'Prediction 1 (smooth, low feature)' : 'Prediction 2 (right feature, oscillations)'} now scores better.`

  return <div className={PROSE}>
    <p>
      For each set of conditions the model produces a <b>prediction</b>, a field of values on the domain.
      The simulator&apos;s result for the same conditions is the <b>target</b>. Training changes the model&apos;s
      parameters to make a single number, the <b>loss</b>, smaller. The loss is a chosen stand-in for
      &ldquo;close to the target&rdquo;, and two predictions with the same loss can be wrong in very different ways.
    </p>
    <Eq>{String.raw`E = \sqrt{\frac{\sum_i w_i\,(\hat{y}_i - y_i)^2}{\sum_i w_i\, y_i^2}}, \qquad w_i = \begin{cases}\lambda & \text{inside the shaded region}\\ 1 & \text{elsewhere}\end{cases}`}</Eq>
    <p className="text-ink-muted">
      <InlineMath>{String.raw`\hat{y}_i`}</InlineMath> is the prediction and <InlineMath>{String.raw`y_i`}</InlineMath> the target at point <InlineMath>i</InlineMath>.
      The weight <InlineMath>\lambda</InlineMath> says how much the region with the sharp feature counts. With <InlineMath>\lambda = 1</InlineMath> this is the plain relative error over all points.
    </p>

    <Panel className="space-y-3">
      <p className="text-xs text-ink-muted">
        Hand-built curves, not model output or data. The oscillation size in Prediction 2 is set so both predictions
        have exactly equal error when every point counts equally.
      </p>
      <RangeField label="Weight λ on the shaded region" value={peakWeight} min={1} max={10} step={1} onChange={setPeakWeight} />
      <div className="grid gap-4 sm:grid-cols-2">
        <ProfileCase title="Prediction 1: smooth, low feature" prediction={SMOOTH} peakWeight={peakWeight}
          caption="Gets the overall shape but underestimates the sharp feature." />
        <ProfileCase title="Prediction 2: right feature, oscillations" prediction={RIPPLY} peakWeight={peakWeight}
          caption="Keeps the feature at the right height but adds small oscillations everywhere." />
      </div>
      <p aria-live="polite" className="text-sm"><b>{verdict}</b> Which one is &ldquo;better&rdquo; depends on whether the feature or the background matters for the task.</p>
    </Panel>

    <p className="text-ink-muted">
      A loss is a design decision. If the sharp feature is a shock, a peak load or a boundary layer, an average over all
      points can reward a model for missing it. Checks tied to the physical question (the peak value, a conserved
      total, a derived quantity) are used next to the loss because the loss alone does not show them.
    </p>

    <Disclosure label="Why do units and normalization matter?">
      <p>
        Suppose the model predicts pressure in pascals and velocity in metres per second. A plain sum of squared errors
        is dominated by whichever quantity has the larger numbers, regardless of importance. A common remedy is to
        divide each field by a typical scale before comparing:
      </p>
      <Eq>{String.raw`\text{loss} = \frac{1}{C\,N} \sum_{c=1}^{C} \sum_{i=1}^{N} w_c \, \frac{\left(\hat{y}_{c,i} - y_{c,i}\right)^2}{s_c^{2}}`}</Eq>
      <p>
        Here <InlineMath>{String.raw`C`}</InlineMath> is the number of fields, <InlineMath>{String.raw`N`}</InlineMath> the number of points,
        {' '}<InlineMath>{String.raw`\hat{y}_{c,i}`}</InlineMath> the prediction and <InlineMath>{String.raw`y_{c,i}`}</InlineMath> the target
        for field <InlineMath>{String.raw`c`}</InlineMath> at point <InlineMath>{String.raw`i`}</InlineMath>,
        {' '}<InlineMath>{String.raw`s_c`}</InlineMath> a scale for field <InlineMath>{String.raw`c`}</InlineMath> (for example its
        standard deviation in the training data), and <InlineMath>{String.raw`w_c`}</InlineMath> an optional importance weight. The result has no
        units, so a value is only meaningful relative to the scale and weights that were chosen. A small normalized error
        on a field whose scale is large can still be a large error in physical units.
      </p>
    </Disclosure>
  </div>
}

/* ---------- SplitSection ---------- */

const FAMILIES = ['Channel flow', 'Cylinder wake', 'Airfoil', 'Backward step']
const STATES = ['early', 'late']

interface Sample { index: number; family: number; run: number; state: number; label: string }
/** 4 families x 2 runs x 2 states = 16 illustrative samples. Row order is fixed. */
const SAMPLES: Sample[] = FAMILIES.flatMap((family, f) => [0, 1].flatMap((r) => STATES.map((state, s) => ({
  index: f * 4 + r * 2 + s, family: f, run: r, state: s, label: `${family}, run ${r + 1}, ${state} state`,
}))))

/**
 * Four fixed example draws of a sample-level split, one per held-out family. Each has the same
 * test size (4) as the family split, so the comparison is like for like. They are written out by hand
 * and are not generated by a random number generator.
 */
const SAMPLE_SPLIT_DRAWS: number[][] = [[1, 6, 8, 15], [3, 4, 10, 13], [0, 7, 9, 14], [2, 5, 6, 11]]

interface Assignment { test: boolean; sameRunInTrain: boolean; sameFamilyInTrain: boolean }

function assign(testIndices: Set<number>): Assignment[] {
  return SAMPLES.map((sample) => {
    const test = testIndices.has(sample.index)
    const train = SAMPLES.filter((other) => other.index !== sample.index && !testIndices.has(other.index))
    return {
      test,
      sameRunInTrain: test && train.some((o) => o.family === sample.family && o.run === sample.run),
      sameFamilyInTrain: test && train.some((o) => o.family === sample.family),
    }
  })
}

function summarize(assignments: Assignment[]) {
  const tests = assignments.filter((a) => a.test)
  return {
    total: tests.length,
    sameRun: tests.filter((a) => a.sameRunInTrain).length,
    sameFamily: tests.filter((a) => a.sameFamilyInTrain).length,
  }
}

function SplitCell({ assignment }: { assignment: Assignment }) {
  if (!assignment.test) return <td className="px-2 py-1.5 text-ink-muted">Train</td>
  return <td className="bg-series-rotation/20 px-2 py-1.5 font-medium">
    Test{assignment.sameRunInTrain ? <span className="font-normal"> · same run in train</span> : null}
  </td>
}

export function SplitSection() {
  const [heldOut, setHeldOut] = useState(2)
  const random = useMemo(() => assign(new Set(SAMPLE_SPLIT_DRAWS[heldOut])), [heldOut])
  const grouped = useMemo(() => assign(new Set(SAMPLES.filter((s) => s.family === heldOut).map((s) => s.index))), [heldOut])
  const randomSummary = summarize(random)
  const groupedSummary = summarize(grouped)

  return <div className={PROSE}>
    <p>
      Evaluation estimates how the model will do on cases it has not seen, so the test cases must be separated from
      training in a way that matches what &ldquo;new&rdquo; means for the intended use. Simulation states are
      not independent: the early and late states of one run share geometry, parameters and mesh, and runs of the same
      family share most of their structure. A split that shuffles individual states lets the model train on near-copies
      of its test cases. This is <b>leakage</b>, and it can make results look better than they are for genuinely new simulations.
    </p>

    <Panel className="space-y-3">
      <p className="text-xs text-ink-muted">
        Synthetic labels for illustration. No dataset is loaded, nothing is trained and no scores exist. Both splits
        put 4 of 16 states in the test set.
      </p>
      <div className="space-y-1.5">
        <h3 className={HEADING}>Family to hold out</h3>
        <Choice label="Family to hold out" value={heldOut} onChange={setHeldOut}
          options={FAMILIES.map((name, i) => ({ value: i, label: name }))} />
      </div>

      <div className="overflow-x-auto" role="region" aria-label="Sample assignments under two split strategies" tabIndex={0}>
        <table className="w-full min-w-[30rem] border-collapse text-left text-xs">
          <caption className="pb-2 text-left text-ink-muted">
            Each row is one simulation state. The two right columns show the same 16 states under each split.
          </caption>
          <thead>
            <tr className="border-b border-divider text-ink">
              <th scope="col" className="px-2 py-1.5 font-semibold">State</th>
              <th scope="col" className="px-2 py-1.5 font-semibold">Split by state (example draw)</th>
              <th scope="col" className="px-2 py-1.5 font-semibold">Split by family ({FAMILIES[heldOut]} held out)</th>
            </tr>
          </thead>
          <tbody>
            {SAMPLES.map((sample) => <tr key={sample.index} className={`border-b border-divider-soft ${sample.state === 1 && sample.run === 1 ? 'border-divider' : ''}`}>
              <th scope="row" className="px-2 py-1.5 font-normal">
                {sample.state === 0 && sample.run === 0 ? <b>{FAMILIES[sample.family]}</b> : <span className="text-ink-muted">{FAMILIES[sample.family]}</span>}
                <span className="text-ink-muted">, run {sample.run + 1}, {STATES[sample.state]}</span>
              </th>
              <SplitCell assignment={random[sample.index]} />
              <SplitCell assignment={grouped[sample.index]} />
            </tr>)}
          </tbody>
        </table>
      </div>

      <p aria-live="polite" className="text-sm">
        <b>By state:</b> {randomSummary.sameRun} of {randomSummary.total} test states have another state of the same run in
        training, and {randomSummary.sameFamily} of {randomSummary.total} have their family in training.{' '}
        <b>By family:</b> {groupedSummary.sameRun} of {groupedSummary.total} and {groupedSummary.sameFamily} of {groupedSummary.total}.
      </p>
    </Panel>

    <p className="text-ink-muted">
      Holding out a whole family answers a stricter question: how does the model do on a kind of simulation it has
      not seen? It does not answer every question about novelty. If all four families share the same governing
      equations, mesh generator and parameter ranges, a held-out family can still be easier than a truly new
      situation, and the split says nothing about shifts the families do not vary.
    </p>
    <p id="source-s1-split" className="text-xs text-ink-muted">
      Source: held-out evaluation under an i.i.d. assumption (<a href="https://www.deeplearningbook.org/contents/ml.html" className="underline" target="_blank" rel="noreferrer">S1</a>, Goodfellow et al., 2016, ch. 5 §5.2, pp. 108 to 111). The run and family grouping is our own reasoning about dependent simulation states; the book does not validate this split design.
    </p>

    <Disclosure label="How does leakage inflate a result?">
      <p>
        A flexible model can recall details of training states. When a test state is a close neighbour of a training
        state, such as the same run a short time later, answering it is nearer to interpolation between memorized points
        than to prediction. The reported error then describes &ldquo;states close to training states&rdquo;, which is
        easier than &ldquo;new simulations&rdquo;.
      </p>
      <p>
        The same applies to choices made along the way. If hyperparameters or the stopping point are selected by
        looking at the test set, it is no longer independent. A separate validation set, split the same way as the
        test set, is used for selection, and the test set is looked at once at the end.
      </p>
    </Disclosure>
  </div>
}

/* ---------- GeneralizationSection ---------- */

const TRAIN_VALUES = [1.0, 1.8, 2.5, 3.1, 5.8, 6.4, 7.0]
const AXIS = { w: 320, h: 78, left: 14, right: 14, max: 10 }
const ax = (v: number) => AXIS.left + (v / AXIS.max) * (AXIS.w - AXIS.left - AXIS.right)

function coverage(query: number) {
  const lo = TRAIN_VALUES[0]
  const hi = TRAIN_VALUES[TRAIN_VALUES.length - 1]
  if (query < lo || query > hi) {
    const distance = query < lo ? lo - query : query - hi
    return { inside: false, text: `Outside the sampled range: ${formatNumber(distance, 1)} units beyond the nearest training value. Any accuracy here would be extrapolation, and the training data gives no evidence about it.` }
  }
  const below = Math.max(...TRAIN_VALUES.filter((v) => v <= query))
  const above = Math.min(...TRAIN_VALUES.filter((v) => v >= query))
  if (below === above) return { inside: true, text: 'This parameter value was sampled in training. That alone does not establish independent test coverage or accuracy on a new case.' }
  return { inside: true, text: `Inside the sampled range, in a gap between training values ${formatNumber(below, 1)} and ${formatNumber(above, 1)}. The nearest training value is ${formatNumber(Math.min(query - below, above - query), 1)} units away.` }
}

const SHIFTS: { question: string; evidence: string; limit: string }[] = [
  {
    question: 'Does it work on new cases like the training ones?',
    evidence: 'Held-out runs from the same families and parameter ranges, split so related states stay together.',
    limit: 'Says nothing about cases that differ in kind from the training set.',
  },
  {
    question: 'Does it work between and beyond the sampled parameter values?',
    evidence: 'Test values inside gaps, and separately beyond the ends of the sampled range, reported apart.',
    limit: 'Interpolation results do not carry over to extrapolation.',
  },
  {
    question: 'Does it work on new geometry?',
    evidence: 'Whole shapes or shape families that were held out, including ones with features the training shapes lack.',
    limit: 'Small shape changes are not the same test as a new topology such as an extra hole or component.',
  },
  {
    question: 'Does it work on a different resolution or mesh?',
    evidence: 'The same cases evaluated on coarser and finer discretizations, against references at matching resolution.',
    limit: 'Some model designs accept other resolutions as input, but whether accuracy holds has to be measured.',
  },
  {
    question: 'Does it work when the physics changes?',
    evidence: 'Held-out regimes, for example a different dominant term or a different boundary condition, with simulator references.',
    limit: 'The model has only seen the equations behind its training data. Good scores on one regime are not evidence for another.',
  },
]

export function GeneralizationSection() {
  const [query, setQuery] = useState(4.4)
  const result = coverage(query)
  const label = `Parameter axis from 0 to 10. Seven training values lie between 1.0 and 7.0, with a wide gap between 3.1 and 5.8. The test value is ${formatNumber(query, 1)}. ${result.text}`

  return <div className={PROSE}>
    <p>
      Generalization is not one property. A model can be accurate on new runs of familiar problems and fail on a new
      geometry, on a parameter outside the sampled range, or on another resolution. Each is a separate question that
      needs its own test, and a single overall score can hide which of them the model passes.
    </p>
    <p id="source-s1-coverage" className="text-xs text-ink-muted">
      Sources: held-out error (<a href="https://www.deeplearningbook.org/contents/ml.html" className="underline" target="_blank" rel="noreferrer">S1</a> ch. 5 §5.2); sparse samples leave gaps as dimensions grow (S1 §5.11.1). The axis below is made up, not from the book.
    </p>

    <Panel className="space-y-3">
      <h3 className={HEADING}>Where a test case sits relative to the training data</h3>
      <p className="text-xs text-ink-muted">
        One made-up input parameter in arbitrary units, with seven made-up training values. This shows coverage only.
        No model is involved.
      </p>
      <RangeField label="Test value of the parameter" value={query} min={0} max={10} step={0.1} onChange={setQuery} />
      <svg viewBox={`0 0 ${AXIS.w} ${AXIS.h}`} role="img" aria-label={label} className="mx-auto block h-auto w-full max-w-md">
        <title>{label}</title>
        <rect x={ax(TRAIN_VALUES[0])} y={14} width={ax(TRAIN_VALUES[TRAIN_VALUES.length - 1]) - ax(TRAIN_VALUES[0])} height={26} rx={4} className="fill-hover-strong" />
        <text x={(ax(TRAIN_VALUES[0]) + ax(TRAIN_VALUES[TRAIN_VALUES.length - 1])) / 2} y={10} textAnchor="middle" className="fill-ink-muted" fontSize="9">sampled range</text>
        <line x1={ax(0)} x2={ax(10)} y1={27} y2={27} className="stroke-ink-faint" strokeWidth="1" />
        {TRAIN_VALUES.map((v) => <circle key={v} cx={ax(v)} cy={27} r={4} fill="var(--series-total)" />)}
        <path d={`M${ax(query)} 34 L${ax(query) - 6} 48 L${ax(query) + 6} 48 Z`} fill="var(--series-rotation)" />
        <line x1={ax(query)} x2={ax(query)} y1={14} y2={34} stroke="var(--series-rotation)" strokeWidth="2" />
        {[0, 5, 10].map((v) => <text key={v} x={ax(v)} y={64} textAnchor="middle" className="fill-ink-muted" fontSize="9">{v}</text>)}
        <text x={ax(query)} y={74} textAnchor={query < 2 ? 'start' : query > 8 ? 'end' : 'middle'} className="fill-ink" fontSize="9">test value</text>
      </svg>
      <p className="text-xs text-ink-muted">Circles: training values. Triangle: the test value. Shaded band: range of training values.</p>
      <p aria-live="polite" className="text-sm">{result.text}</p>
    </Panel>

    <div className="space-y-2">
      <h3 className={HEADING}>Question, evidence and what it cannot show</h3>
      <div className="overflow-x-auto" role="region" aria-label="Generalization questions and evidence" tabIndex={0}>
        <table className="w-full min-w-[34rem] border-collapse text-left text-xs leading-relaxed">
          <thead>
            <tr className="border-b border-divider">
              <th scope="col" className="w-1/4 px-2 py-1.5 font-semibold">Question</th>
              <th scope="col" className="w-[38%] px-2 py-1.5 font-semibold">Evidence that would answer it</th>
              <th scope="col" className="px-2 py-1.5 font-semibold">What it does not show</th>
            </tr>
          </thead>
          <tbody>
            {SHIFTS.map((row) => <tr key={row.question} className="border-b border-divider-soft align-top">
              <th scope="row" className="px-2 py-2 font-medium">{row.question}</th>
              <td className="px-2 py-2">{row.evidence}</td>
              <td className="px-2 py-2 text-ink-muted">{row.limit}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </div>

    <p className="text-ink-muted">
      The table lists what to ask, not what any particular model will do. Results from each row are reported
      separately, with the reference solver and the metric stated, so that a reader can see which kinds of
      novelty the model has and has not been tested on.
    </p>

    <Disclosure label="Why can a model fail on a shift that looks small?">
      <p>
        The model only sees numbers. A shift that is small to a person, such as a slightly different obstacle outline,
        may move the input into a region of the representation that training never covered. The opposite also
        happens: a shift that looks large may leave the physics nearly unchanged. Neither can be judged by
        appearance. They have to be tested, and the test cases need independent reference solutions.
      </p>
    </Disclosure>
  </div>
}

/* ---------- AdaptationSection ---------- */

type Strategy = 'frozen' | 'decoder' | 'all'

const BLOCKS = [
  { name: 'Encoder', role: 'Turns conditions and geometry into internal features.' },
  { name: 'Processor', role: 'Mixes those features across the domain.' },
  { name: 'Decoder', role: 'Turns the processed features into the predicted field.' },
]

const STRATEGIES: { value: Strategy; label: string; updated: boolean[]; note: string }[] = [
  {
    value: 'frozen', label: 'Frozen (no updates)', updated: [false, false, false],
    note: 'Nothing is trained. The model is used as it is, so any difference between the new problem and the training problems has to be expressed through its inputs.',
  },
  {
    value: 'decoder', label: 'Fine-tune decoder only', updated: [false, false, true],
    note: 'Can change how existing features are turned into the output field, but cannot change which features are built. Fewer parameters move, which limits how far the model can drift.',
  },
  {
    value: 'all', label: 'Fine-tune everything', updated: [true, true, true],
    note: 'Most freedom to fit the new data, including freedom to overfit a small adaptation set or to lose accuracy on the original conditions.',
  },
]

/** Adapt Cool Frog's shape-only LoRA rank experiment. */
function LoraRankPlot() {
  const [rank, setRank] = useState(2)
  const parameters = rank * 16
  return <Panel className="space-y-4">
    <h3 className={HEADING}>A small trainable correction beside a frozen layer</h3>
    <p className="text-sm text-ink-muted">Low-rank adaptation (LoRA) keeps the base matrix W₀ fixed and learns two smaller matrices. Increase the rank to see when the parameter saving disappears.</p>
    <Choice label="Illustrative adapter rank" value={rank} onChange={setRank}
      options={[1, 2, 4, 8].map((value) => ({ value, label: `r = ${value}` }))} />
    <Eq>{String.raw`y = W_0x + sB(Ax), \qquad \Delta W = sBA`}</Eq>
    <figure aria-label={`B is 8 by ${rank}, A is ${rank} by 8, and BA is 8 by 8 with rank at most ${rank}.`}>
      <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-1 text-center text-sm tabular-nums">
        {[{ name: 'B', rows: 8, columns: rank }, { name: 'A', rows: rank, columns: 8 }, { name: 'BA', rows: 8, columns: 8 }].map(({ name, rows, columns }, index) => <Fragment key={name}>
          {index > 0 && <span aria-hidden="true" className="text-ink-muted">{index === 1 ? '×' : '='}</span>}
          <div>
            <svg viewBox="0 0 128 128" aria-hidden="true" className="mx-auto w-full max-w-40" fill="none">
              <g transform={`translate(${(128 - columns * 14) / 2} ${(128 - rows * 14) / 2})`}>
                <rect width={columns * 14} height={rows * 14} fill="var(--hover-strong)" stroke="var(--ink-muted)" />
                {Array.from({ length: columns - 1 }, (_, column) => <path key={`c${column}`} d={`M${(column + 1) * 14} 0v${rows * 14}`} stroke="var(--divider)" />)}
                {Array.from({ length: rows - 1 }, (_, row) => <path key={`r${row}`} d={`M0 ${(row + 1) * 14}h${columns * 14}`} stroke="var(--divider)" />)}
              </g>
            </svg>
            <p className="font-medium">{name}</p>
            <p className="text-xs text-ink-muted">{rows} × {columns}</p>
          </div>
        </Fragment>)}
      </div>
      <figcaption className="mt-3 text-xs text-ink-muted">Adapted from Cool Frog’s LoraExplainer. Cells show parameter slots, not weights. The product may be dense even at rank 1. Compute B(Ax) during training without materializing BA.</figcaption>
    </figure>
    <p aria-live="polite" className="text-sm tabular-nums"><strong>{parameters} trainable parameters</strong> instead of 64 for a full update ({parameters / 64 * 100}% of the dense count).{rank === 4 ? ' No parameter saving at this rank.' : rank === 8 ? ' Twice the dense count, with no rank restriction.' : ''}</p>
    <p className="text-sm text-ink-muted">Here x and y have 8 features, r is the adapter rank and s is a scale. In general the adapter uses r(k + d) parameters instead of dk for a d × k layer. The rank limit applies to the correction, not the frozen base. More rank does not guarantee better held-out accuracy.</p>
    <p className="text-xs text-ink-muted">Source: <a className="underline" href="https://arxiv.org/abs/2106.09685">Hu et al., LoRA, §4.1</a>. Illustrative 8 × 8 layer, not a trained model.</p>
  </Panel>
}

export function AdaptationSection() {
  const [strategy, setStrategy] = useState<Strategy>('decoder')
  const current = STRATEGIES.find((s) => s.value === strategy) ?? STRATEGIES[0]
  const description = `Three blocks from left to right: ${BLOCKS.map((b, i) => `${b.name}, ${current.updated[i] ? 'updated' : 'fixed'}`).join('; ')}.`

  return <div className={PROSE}>
    <p>
      A trained model is often reused on a related problem, for example a new material or a new regime, where only
      a small number of new simulations exist. <b>Adaptation</b> continues training on those cases. Some or all
      of the model&apos;s parameters are changed by gradient steps, while the rest stay <b>frozen</b>. How much is
      allowed to change is a choice that trades flexibility against drift.
    </p>

    <Panel className="space-y-3">
      <div className="space-y-1.5">
        <h3 className={HEADING}>Which parameters are allowed to change</h3>
        <Choice label="Adaptation strategy" value={strategy} onChange={setStrategy}
          options={STRATEGIES.map((s) => ({ value: s.value, label: s.label }))} />
      </div>
      <ol aria-label={description} className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        {BLOCKS.map((block, i) => {
          const updated = current.updated[i]
          return <li key={block.name} className="flex min-w-0 flex-1 flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            <div className={`min-w-0 flex-1 rounded-xl p-3 text-xs ${updated
              ? 'border-2 border-solid border-series-rotation bg-paper'
              : 'border-2 border-dashed border-divider bg-hover'}`}>
              <p className="text-sm font-semibold text-ink">{block.name}</p>
              <p className="text-ink-muted">{block.role}</p>
              <p className="mt-1.5 font-medium">{updated ? 'Updated by training' : 'Fixed, not updated'}</p>
            </div>
            {i < BLOCKS.length - 1 ? <span aria-hidden="true" className="self-center text-ink-subtle">
              <span className="sm:hidden">↓</span><span className="hidden sm:inline">→</span>
            </span> : null}
          </li>
        })}
      </ol>
      <p className="text-xs text-ink-muted">
        Solid orange outline: parameters change during adaptation. Dashed grey outline: parameters stay as they were
        after the original training. The block names follow the general encoder, processor, decoder layout and are not
        a specific model.
      </p>
      <p aria-live="polite" className="text-sm">{current.note}</p>
    </Panel>
    <Disclosure label="How does a low-rank adapter reduce trainable parameters?">
      <LoraRankPlot />
    </Disclosure>

    <div className="space-y-2">
      <h3 className={HEADING}>Optimization is not evidence</h3>
      <p>
        A lower loss on the adaptation cases is not evidence that the model got better at the new problem.
        It can even come with worse accuracy on the original problem.
      </p>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-semibold">What fitting shows</dt>
          <dd className="text-ink-muted">If the loss on adaptation cases went down, the optimizer made progress on those cases. Nothing more.</dd>
        </div>
        <div>
          <dt className="font-semibold">What needs separate evaluation</dt>
          <dd className="text-ink-muted">
            Error on new target-problem cases that were not used to train, to choose settings, or to decide when to stop.
            Error on the original problem, to see whether it was lost.
          </dd>
        </div>
      </dl>
    </div>
    <Disclosure label="About the source for this section (S1)">
      <p id="source-s1-adaptation" className="text-xs text-ink-muted">
        The training-versus-held-out distinction behind this section is in <a href="https://www.deeplearningbook.org/contents/ml.html" className="underline" target="_blank" rel="noreferrer">S1</a> (Goodfellow et al., 2016, ch. 5 §5.2). The block diagram is our conceptual illustration of which parameters update. It shows no result and no evidence of improvement.
      </p>
    </Disclosure>

    <Disclosure label="How should the few new cases be divided?">
      <p>
        With a handful of cases there is a tension: every case used for the final check cannot be used to adapt. A common
        arrangement keeps three groups apart: cases that update the parameters, cases used to compare strategies and decide
        when to stop, and cases looked at once at the end. Related states of one run belong to the same group, as in the
        split section above.
      </p>
      <p>
        If there are too few cases to keep a final check, the honest report is that the adapted model has not been independently
        validated. A frozen model is a useful baseline, since the claim that adaptation helped is a comparison against it
        on the same untouched cases.
      </p>
    </Disclosure>

    <Disclosure label="Why might changing every parameter be worse than changing few?">
      <p>
        More freedom means more ways to fit the adaptation cases exactly, including their quirks. It also moves
        parameters that the original problem depends on, so earlier accuracy can drop. Restricting updates, or adding small
        new parameters beside the original ones, limits that. Whether the restriction costs accuracy on the new problem
        varies by case, and has to be checked with the same independent evaluation.
      </p>
    </Disclosure>
  </div>
}

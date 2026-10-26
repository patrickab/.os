import { Disclosure, Eq, InlineMath } from '../components/ui'

export function HelmholtzLimits() {
  return <div className="max-w-3xl space-y-4 text-sm leading-relaxed">
    <p>
      The components above are defined by formulas, not recovered from the total field.
      A general decomposition needs a specified domain and boundary or decay conditions.
      Without them, a harmonic field can move between the parts without changing their sum.
    </p>
    <p className="text-ink-muted">
      These fields grow with distance, so the usual whole-plane decay assumption does not apply.
      Their divergence and curl are exact, but the displayed split is not a claim of uniqueness.
    </p>
    <Disclosure label="Why can a harmonic field move between the parts?">
      <p>
        A harmonic field is both curl free and divergence free. A constant field <InlineMath>{String.raw`(c, 0)`}</InlineMath> is a simple example.
        Adding it to one part and subtracting it from the other preserves the total and both differential properties.
      </p>
      <Eq>{String.raw`\begin{aligned} \mathbf{P}' &= \mathbf{P} + \begin{pmatrix} c \\ 0 \end{pmatrix}, \\ \mathbf{R}' &= \mathbf{R} - \begin{pmatrix} c \\ 0 \end{pmatrix} \end{aligned}`}</Eq>
      <p>
        At <InlineMath>{String.raw`(1, 0)`}</InlineMath>, the shifted parts are <InlineMath>{String.raw`(a + c, 0)`}</InlineMath> and <InlineMath>{String.raw`(-c, b)`}</InlineMath>.
        Their sum is still <InlineMath>{String.raw`(a, b)`}</InlineMath>. Suitable boundary conditions remove this ambiguity.
      </p>
    </Disclosure>
  </div>
}

import { HEADING, Panel } from '../components/ui'

const ASSUMPTIONS: [string, string][] = [
  ['Dimension', 'Two dimensional fields on the plane, with x and y as the only coordinates.'],
  ['Fields', 'Exact formulas. The potential part is a(x, y) and the rotation part is b(−y, x).'],
  ['Parameters', 'a and b are numbers in [0, 2]. The backend rejects values outside this range.'],
  ['Grid', '9 × 9 sample points, evenly spaced from −1 to 1 on both axes, ends included.'],
  ['Units', 'None. All values are dimensionless.'],
  ['Computation', 'The backend computes every number and the browser only draws them. No noise, no measured data.'],
]

const CLAIMS: [string, string][] = [
  ['Divergence of the total field is 2a', 'Derived in “Why is the divergence 2a and the curl 2b?” under The idea, and returned by the API.'],
  ['Curl of the total field is 2b', 'Derived in “Why is the divergence 2a and the curl 2b?” under The idea, and returned by the API.'],
  ['Without boundary conditions the split is not unique on a bounded region', 'Demonstrated by shifting a constant harmonic field between the parts under Boundaries and harmonic fields. No external reference is cited here.'],
]

export function Assumptions() {
  return <Panel className="space-y-3">
    <h3 className={HEADING}>What the example assumes</h3>
    <dl className="divide-y divide-divider-soft text-sm">
      {ASSUMPTIONS.map(([term, text]) => <div key={term} className="grid gap-1 py-2 sm:grid-cols-[8rem_1fr]">
        <dt className="text-ink-muted">{term}</dt>
        <dd className="text-pretty">{text}</dd>
      </div>)}
    </dl>
  </Panel>
}

export function Sources() {
  return <>
    <Panel className="space-y-3">
      <h3 className={HEADING}>Citations</h3>
      <p className="text-sm text-pretty">
        This template cites no studies, papers or datasets. Its scientific claims follow from the formulas shown in the lesson.
        When you adapt the template, list only sources you have opened and read, and add them to the evidence table of your report.
      </p>
    </Panel>
    <Panel className="space-y-3">
      <h3 className={HEADING}>Where each claim comes from</h3>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Claims and their basis</caption>
        <thead className="text-ink-muted">
          <tr><th scope="col" className="py-1.5 pr-3 font-medium">Claim</th><th scope="col" className="py-1.5 font-medium">Basis</th></tr>
        </thead>
        <tbody>
          {CLAIMS.map(([claim, basis]) => <tr key={claim} className="border-t border-divider-soft align-top">
            <td className="py-2 pr-3 text-pretty">{claim}</td>
            <td className="py-2 text-ink-muted text-pretty">{basis}</td>
          </tr>)}
        </tbody>
      </table>
    </Panel>
  </>
}

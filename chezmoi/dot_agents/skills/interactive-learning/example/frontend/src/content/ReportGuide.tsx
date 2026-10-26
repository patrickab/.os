import { useState } from 'react'
import { Disclosure, HEADING, Panel } from '../components/ui'

const STEPS: { title: string; summary: string; detail: string }[] = [
  { title: 'Question', summary: 'Write one question that a source could answer.', detail: 'State the population, the quantity and the comparison if there is one. A report with no question collects facts without a use.' },
  { title: 'Scope', summary: 'Decide in advance what counts as a source.', detail: 'Record the inclusion and exclusion rules, the time window and the languages. Write them before searching so the results cannot shape them.' },
  { title: 'Search record', summary: 'Log where and how you searched.', detail: 'For each search keep the tool, the date, the exact query and the number of results. Outside this app, use whatever literature tools you trust. This app does not search anything.' },
  { title: 'Reading and extraction', summary: 'Open each source and copy out what it states.', detail: 'Record the claim, the evidence type, the sample or data and the page or section. Mark anything you only know from an abstract or a secondary description.' },
  { title: 'Synthesis', summary: 'Group claims by what they support.', detail: 'Say where sources agree, where they disagree and why. Do not average conclusions across studies of different design without saying so.' },
  { title: 'Uncertainty and gaps', summary: 'State what the evidence does not show.', detail: 'List missing sources, weak designs and claims you could not verify. If you found nothing, write that and do not fill the gap with a plausible answer.' },
]

export function ReportMethod() {
  return <>
    <Panel className="space-y-3">
      <h3 className={HEADING}>Six steps</h3>
      <p className="text-sm text-pretty">A report is only as strong as the record of how it was made. Each step leaves something a reader can check.</p>
      <ol className="space-y-2">
        {STEPS.map((step, index) => <li key={step.title}>
          <Disclosure label={`${index + 1}. ${step.title}`}>
            <p className="text-pretty">{step.summary}</p>
            <p className="text-ink-muted text-pretty">{step.detail}</p>
          </Disclosure>
        </li>)}
      </ol>
    </Panel>
    <Panel className="space-y-3">
      <h3 className={HEADING}>Rules against invented evidence</h3>
      <ul className="list-disc space-y-1.5 pl-5 text-sm text-pretty marker:text-ink-subtle">
        <li>Never write a citation, quote, number or identifier you have not read in the source.</li>
        <li>Label a claim as unverified when you cannot trace it to a source you opened.</li>
        <li>Report searches that found nothing. An empty result is a finding about your search.</li>
        <li>Keep the wording of the source and your own interpretation visibly separate.</li>
      </ul>
    </Panel>
  </>
}

const OUTLINE: [string, string][] = [
  ['Summary', 'Answer to the question, strength of evidence, main limitation.'],
  ['Question and scope', 'The question and the rules for including sources.'],
  ['Method', 'Search record and how claims were extracted.'],
  ['Evidence table', 'One row per source you opened.'],
  ['Synthesis', 'What the sources support together, including disagreement.'],
  ['Limits', 'Gaps, weak designs and unverified claims.'],
  ['References', 'Full entries for every source in the evidence table.'],
]

const COLUMNS = ['Source', 'Claim as stated', 'Evidence type', 'Where verified', 'Confidence']

export function ReportTemplate() {
  return <>
    <Panel className="space-y-3">
      <h3 className={HEADING}>Report outline</h3>
      <p className="text-sm text-ink-muted">Structure only. This page contains no findings.</p>
      <ol className="divide-y divide-divider-soft text-sm">
        {OUTLINE.map(([title, text], index) => <li key={title} className="grid gap-1 py-2 sm:grid-cols-[2rem_11rem_1fr]">
          <span className="tabular-nums text-ink-muted">{index + 1}</span>
          <span className="font-medium">{title}</span>
          <span className="text-ink-muted text-pretty">{text}</span>
        </li>)}
      </ol>
    </Panel>
    <Panel className="space-y-3">
      <h3 className={HEADING}>Evidence table layout</h3>
      <div role="region" aria-label="Evidence table layout" tabIndex={0} className="overflow-x-auto rounded-lg">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <caption className="sr-only">Empty evidence table showing the columns to fill</caption>
          <thead className="text-ink-muted">
            <tr>{COLUMNS.map((column) => <th key={column} scope="col" className="py-1.5 pr-3 font-medium">{column}</th>)}</tr>
          </thead>
          <tbody>
            <tr className="border-t border-divider-soft text-ink-muted">
              <td colSpan={COLUMNS.length} className="py-3 italic">No rows. Add a row only for a source you opened.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-muted text-pretty">
        Confidence is a short judgment such as low, moderate or high, with a reason in the same cell.
        Where verified names the page, section or table you checked.
      </p>
    </Panel>
  </>
}

const CHECKS = [
  'Each claim in the summary appears in the evidence table.',
  'Each evidence row names a source I opened.',
  'The search record lists tool, date and query.',
  'Searches with no useful result are reported.',
  'Unverified claims are labeled as unverified.',
  'Limits state what the evidence does not show.',
]

export function ReportChecklist() {
  const [checked, setChecked] = useState<ReadonlySet<number>>(() => new Set())
  const toggle = (index: number) => setChecked((current) => {
    const next = new Set(current)
    if (!next.delete(index)) next.add(index)
    return next
  })
  return <Panel className="space-y-3">
    <div className="flex items-baseline justify-between gap-3">
      <h3 className={HEADING}>Before sharing a report</h3>
      <p role="status" className="text-xs text-ink-muted tabular-nums">{checked.size} of {CHECKS.length} checked</p>
    </div>
    <ul className="space-y-1 text-sm">
      {CHECKS.map((text, index) => <li key={text}>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 transition hover:bg-hover">
          <input type="checkbox" checked={checked.has(index)} onChange={() => toggle(index)} className="mt-0.5 size-4 shrink-0 accent-ink" />
          <span className="text-pretty">{text}</span>
        </label>
      </li>)}
    </ul>
  </Panel>
}

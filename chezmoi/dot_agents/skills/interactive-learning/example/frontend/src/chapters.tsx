import { Assumptions, Sources } from './content/Assumptions'
import { HelmholtzExplorer } from './content/HelmholtzExplorer'
import { HelmholtzIdea } from './content/HelmholtzIdea'
import { HelmholtzLimits } from './content/HelmholtzLimits'
import { ReportChecklist, ReportMethod, ReportTemplate } from './content/ReportGuide'
import type { Chapter } from './navigation'

/** Define chapter order, section anchors, and concise section introductions. */
export const chapters: Chapter[] = [
  {
    id: 'helmholtz',
    title: 'Helmholtz decomposition',
    sections: [
      { id: 'idea', title: 'The idea', summary: 'A flow splits into a part that spreads out and a part that spins.', content: <HelmholtzIdea /> },
      { id: 'explorer', title: 'Explore the field', summary: 'Change the two strengths and see how the total, potential and rotation fields respond.', content: <HelmholtzExplorer /> },
      { id: 'limits', title: 'Boundaries and harmonic fields', summary: 'Without boundary conditions the split is not unique, so this example states its split by formula.', content: <HelmholtzLimits /> },
    ],
  },
  {
    id: 'basis',
    title: 'Sources and assumptions',
    sections: [
      { id: 'assumptions', title: 'Assumptions', summary: 'The example is exact for its formulas and says nothing about real data.', content: <Assumptions /> },
      { id: 'sources', title: 'Sources', summary: 'This template cites no studies, and each claim lists its basis.', content: <Sources /> },
    ],
  },
  {
    id: 'reports',
    title: 'Research reports',
    sections: [
      { id: 'method', title: 'Method', summary: 'Six steps that leave a record a reader can check.', content: <ReportMethod /> },
      { id: 'template', title: 'Structure', summary: 'An outline and an empty evidence table, with no findings.', content: <ReportTemplate /> },
      { id: 'checklist', title: 'Checklist', summary: 'Questions to answer before a report leaves your hands.', content: <ReportChecklist /> },
    ],
  },
]

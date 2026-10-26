import { chapters } from './chapters'
import type { Lesson } from './navigation'
import { ScopeSection, TaskSection, UseCaseSection, WorkflowSection } from './content/guide/Overview'
import { BottleneckSection, ProcessingSection, RepresentationSection, ResolutionSection } from './content/guide/Architecture'
import { AdaptationSection, GeneralizationSection, ObjectiveSection, SplitSection } from './content/guide/Learning'
import { AttentionPlotSection, ConvolutionPlotSection, TensorPlotSection } from './content/plots/Examples'

export const APP_TITLE = 'Interactive learning'

/** Two example lessons. More than one lesson shows a lesson picker above the sidebar. */
export const lessons: Lesson[] = [
  {
    id: 'complex',
    title: 'Scientific model guide',
    description: 'Multi-page example · frontend only',
    pages: [
      {
        id: 'overview', title: 'Overview', chapters: [
          {
            id: 'guide-purpose', title: 'What is being predicted?', sections: [
              { id: 'task', title: 'From conditions to a field', summary: 'A surrogate approximates a mapping, not just an image.', content: <TaskSection /> },
              { id: 'workflow', title: 'Reference and prediction', summary: 'Learning uses reference examples. Inference uses the resulting model.', content: <WorkflowSection /> },
            ],
          },
          {
            id: 'guide-scope', title: 'When does it help?', sections: [
              { id: 'uses', title: 'Choose the role before the model', summary: 'Useful approximations depend on how their outputs will be used.', content: <UseCaseSection /> },
              { id: 'limits', title: 'Explanation is not evidence', summary: 'Understanding the mechanism does not establish performance.', content: <ScopeSection /> },
            ],
          },
        ],
      },
      {
        id: 'architecture', title: 'Inside the model', chapters: [
          {
            id: 'guide-representation', title: 'Representing a field', sections: [
              { id: 'representation', title: 'Keep the physical meaning', summary: 'A representation changes how values are organized, not what they mean.', content: <RepresentationSection /> },
              { id: 'bottleneck', title: 'What compression discards', summary: 'Fewer degrees of freedom can remove detail that matters.', content: <BottleneckSection /> },
            ],
          },
          {
            id: 'guide-processing', title: 'Moving information', sections: [
              { id: 'mixing', title: 'Local and contextual mixing', summary: 'Different operations expose a location to different parts of the field.', content: <ProcessingSection /> },
              { id: 'resolution', title: 'Resolution is not information', summary: 'More output locations do not automatically recover missing structure.', content: <ResolutionSection /> },
            ],
          },
        ],
      },
      {
        id: 'learning', title: 'Learning & evaluation', chapters: [
          {
            id: 'guide-learning', title: 'Learning from examples', sections: [
              { id: 'objective', title: 'What the loss rewards', summary: 'The training objective is a proxy for the behavior you need.', content: <ObjectiveSection /> },
              { id: 'splits', title: 'Separate the right things', summary: 'A test split is only independent if related examples do not leak across it.', content: <SplitSection /> },
            ],
          },
          {
            id: 'guide-evaluation', title: 'Testing a claim', sections: [
              { id: 'generalization', title: 'Name the distribution shift', summary: 'A new sample and a new physical regime ask different questions.', content: <GeneralizationSection /> },
              { id: 'adaptation', title: 'Adapt, then verify', summary: 'Updating parameters is an intervention, not proof of improvement.', content: <AdaptationSection /> },
            ],
          },
        ],
      },
      {
        id: 'plots', title: 'Example plots', chapters: [
          {
            id: 'example-tensors', title: 'Tensors', sections: [
              { id: 'tensor', title: 'Crops and batches', summary: 'Large fields are cut into crops that the network processes independently.', content: <TensorPlotSection /> },
            ],
          },
          {
            id: 'example-cnn', title: 'Convolution', sections: [
              { id: 'convolution', title: 'CNN: one kernel, many positions', summary: 'A small shared kernel reads each neighborhood the same way, everywhere in the field.', content: <ConvolutionPlotSection /> },
            ],
          },
          {
            id: 'example-attention', title: 'Window attention', sections: [
              { id: 'attention', title: 'Attention: weights from content', summary: 'Each location decides from the data how much to draw from each partner in its window.', content: <AttentionPlotSection /> },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'simple', title: 'Field decomposition', description: 'Single-page lesson · Python experiment',
    pages: [{ id: 'field', title: 'Field decomposition', chapters }],
  },
]

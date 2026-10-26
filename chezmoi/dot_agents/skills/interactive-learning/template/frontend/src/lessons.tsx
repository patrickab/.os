import { Introduction } from './content/Introduction'
import type { Lesson } from './navigation'

export const APP_TITLE = 'Interactive learning'

/** Lesson → pages → chapters → sections. Sidebar, page tabs, deep links and headings are generated from this structure. */
export const lessons: Lesson[] = [
  {
    id: 'lesson', title: 'Lesson', description: '',
    pages: [{
      id: 'main', title: 'Lesson', chapters: [
        {
          id: 'start', title: 'Start here', sections: [
            { id: 'question', title: 'The question', summary: 'Replace this section with the answer to the learner’s question.', content: <Introduction /> },
          ],
        },
      ],
    }],
  },
]

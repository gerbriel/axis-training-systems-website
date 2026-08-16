import type { GuideContent } from '../../lib/guideContent'
import ChecklistView from './ChecklistView'
import QuizView from './QuizView'
import ReferenceView from './ReferenceView'
import SectionsView from './SectionsView'
import WorksheetView from './WorksheetView'

/**
 * Stored guide content, rendered.
 *
 * The switch is exhaustive over GuideContent and has no default branch on
 * purpose: a sixth content type added to the union stops compiling here, which
 * is the reminder to write its view rather than the card silently rendering
 * nothing.
 *
 * Content this component is handed has been through validateGuideContent. The
 * views assume that much: they read the shape without re-checking it, so do not
 * hand them a raw `config.content`.
 */
export default function GuideContentView({ content }: { content: GuideContent }) {
  switch (content.type) {
    case 'checklist': return <ChecklistView content={content} />
    case 'quiz':      return <QuizView content={content} />
    case 'reference': return <ReferenceView content={content} />
    case 'sections':  return <SectionsView content={content} />
    case 'worksheet': return <WorksheetView content={content} />
  }
}

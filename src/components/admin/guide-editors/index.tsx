import type { GuideContent } from '../../../lib/guideContent'
import ChecklistEditor from './ChecklistEditor'
import QuizEditor from './QuizEditor'
import ReferenceEditor from './ReferenceEditor'
import SectionsEditor from './SectionsEditor'
import WorksheetEditor from './WorksheetEditor'

/**
 * guide-editors
 *
 * The five shapes a guide's content can take, one editor each, and the switch
 * that picks between them.
 *
 * The switch is on `value.type` rather than on the row, deliberately: the
 * content carries its own type, so a guide that has been given a checklist is
 * edited as a checklist whether it is one of the six that shipped, an override
 * on one, or something made this morning. The panel above never has to know
 * which editor it is showing.
 *
 * There is no editor for the attempt calculator. Its guide is driven by the
 * numbers in migration 042 rather than by anything stored on the row, which is
 * why `defaultContentFor('attempts')` answers null and the panel shows a note
 * pointing at the Calculators tab instead of a form.
 */
export default function GuideContentEditor({
  value, onChange, disabled,
}: {
  value: GuideContent
  onChange: (next: GuideContent) => void
  disabled?: boolean
}) {
  switch (value.type) {
    case 'checklist':
      return <ChecklistEditor value={value} onChange={onChange} disabled={disabled} />
    case 'quiz':
      return <QuizEditor value={value} onChange={onChange} disabled={disabled} />
    case 'reference':
      return <ReferenceEditor value={value} onChange={onChange} disabled={disabled} />
    case 'sections':
      return <SectionsEditor value={value} onChange={onChange} disabled={disabled} />
    case 'worksheet':
      return <WorksheetEditor value={value} onChange={onChange} disabled={disabled} />
    default:
      // A type the bundle does not know about. Not reachable through the panel,
      // which only ever hands over what parseGuideContent returned, and worth a
      // sentence rather than a blank space if a hand-edited row ever gets here.
      return (
        <p style={{ color: 'var(--text-4)', fontSize: '.75rem', lineHeight: 1.6 }}>
          This guide is stored in a format this version of the site does not have an editor for.
          Nothing has been changed. Reload the page, and if it is still here, it needs a developer.
        </p>
      )
  }
}

export { ChecklistEditor, QuizEditor, ReferenceEditor, SectionsEditor, WorksheetEditor }

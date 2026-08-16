/**
 * The five guide bodies, one per content type in src/lib/guideContent.ts.
 *
 * They render content and nothing else: no fetching, no gating, no card chrome.
 * That is what lets the public page render a built-in's defaults and the admin
 * panel preview an unsaved draft through exactly the same component, so a
 * preview cannot look like something the page will not.
 */
export { default as ChecklistView } from './ChecklistView'
export { default as QuizView } from './QuizView'
export { default as ReferenceView } from './ReferenceView'
export { default as SectionsView } from './SectionsView'
export { default as WorksheetView } from './WorksheetView'
export { default as GuideContentView } from './GuideContentView'

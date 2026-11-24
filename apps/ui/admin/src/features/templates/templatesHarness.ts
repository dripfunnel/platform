// States (?state=): loading, empty, error. There is no denied or read-only state: every role reads the list and may
// open a preview.
export const templatesStates = ['loading', 'empty', 'error'] as const
export type TemplatesScreenState = (typeof templatesStates)[number]

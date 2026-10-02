export const plansStates = ['loading', 'empty', 'error', 'readonly', 'denied'] as const
export type PlansState = (typeof plansStates)[number]

export const planEditorStates = ['loading', 'error', 'readonly', 'denied', 'confirm'] as const
export type PlanEditorState = (typeof planEditorStates)[number]

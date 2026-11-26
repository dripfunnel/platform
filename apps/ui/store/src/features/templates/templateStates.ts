// Templates' states under ?state= (ui/README.md §6): loading, error, empty, denied.
export const templateStates = ['loading', 'error', 'empty', 'denied'] as const
export type TemplateState = (typeof templateStates)[number]

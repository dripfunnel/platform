// States (?state=): loading, empty, error, readonly (the list as a role without storeCategories.manage sees it),
// confirm (Add category open). There is no denied state: every role reads the list.
export const storeCategoriesStates = ['loading', 'empty', 'error', 'readonly', 'confirm'] as const
export type StoreCategoriesScreenState = (typeof storeCategoriesStates)[number]

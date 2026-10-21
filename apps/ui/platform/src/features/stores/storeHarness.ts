export const storesStates = ['loading', 'empty', 'error', 'readonly', 'denied'] as const
export type StoresState = (typeof storesStates)[number]

export const createStates = ['loading', 'error', 'readonly', 'denied'] as const
export type CreateState = (typeof createStates)[number]

export const storeStates = ['loading', 'error', 'readonly', 'denied', 'confirm'] as const
export type StoreScreenState = (typeof storeStates)[number]

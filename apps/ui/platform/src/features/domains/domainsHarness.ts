export const domainsStates = ['loading', 'error', 'empty', 'denied'] as const
export type DomainsState = (typeof domainsStates)[number]

export const addDomainStates = ['loading', 'error', 'denied'] as const
export type AddDomainState = (typeof addDomainStates)[number]

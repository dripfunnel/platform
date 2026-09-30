export const partnersStates = ['loading', 'empty', 'error', 'readonly', 'denied'] as const
export type PartnersState = (typeof partnersStates)[number]

export const partnerStates = ['loading', 'error', 'readonly', 'denied', 'confirm'] as const
export type PartnerScreenState = (typeof partnerStates)[number]

export const brandingStates = ['loading', 'error', 'readonly', 'denied', 'confirm'] as const
export type BrandingState = (typeof brandingStates)[number]

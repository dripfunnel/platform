// The harness's states: the screen's own. The money is the API's (#201).
export const billingStates = ['loading', 'error', 'denied'] as const
export type BillingState = (typeof billingStates)[number]

// The harness's states: the screen's own, and the sample's (#201 gives these an API).
export const billingStates = ['loading', 'error', 'denied', 'sample', 'failedPayments', 'payoutHeld', 'firstPayout', 'stale', 'prelive', 'own'] as const
export type BillingState = (typeof billingStates)[number]

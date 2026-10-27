/** Why a sheet ended without a payment, in the words the checkout has for it (messages checkout.pay.*). */
export type StopReason = 'cancelled' | 'declined' | 'timeout' | 'unavailable'

export type Shown = 'done' | StopReason

/** `pending`: the sheet closed fine but the provider's webhook has not said it is paid within the wait, so the shopper must not pay again. */
export type Outcome = { kind: 'paid' } | { kind: 'pending' } | { kind: 'stopped'; reason: StopReason }

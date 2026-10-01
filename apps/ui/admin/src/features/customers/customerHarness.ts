// Every staff role may open Customers and nobody may act on one, so there is no denied state
// (decided on #42): Read-only is the view to check, and `nomatch` is a search that finds no one.
export const customersStates = ['loading', 'empty', 'error', 'readonly', 'nomatch'] as const
export type CustomersState = (typeof customersStates)[number]

export const customerStates = ['loading', 'error', 'readonly'] as const
export type CustomerScreenState = (typeof customerStates)[number]

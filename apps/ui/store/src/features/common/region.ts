/** Whether the store's country says "shipping" rather than "delivery" (OFFERS-DESIGN G4, T5): the one place that decides. */
export const saysShipping = (country: string | null): boolean => country === 'US' || country === 'CA'

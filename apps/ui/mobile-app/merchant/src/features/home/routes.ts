// Where Home's rows lead (DESIGN.md §3): a list already on the chip that matches the count, the Catalogue tab, and an order's own screen.
export const ordersHref = '/orders'
export const ordersToShipHref = '/orders?filter=TO_SHIP'
export const catalogueHref = '/catalogue'
export const productsFilterHref = (filter: 'pending' | 'low_stock'): string => `/catalogue?filter=${filter}`
